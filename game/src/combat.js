// Hitscan resolution shared by the player and the bots, plus pooled tracers, impact
// sparks and frag grenades. Nothing here allocates in the hot loop: pools are built
// once and recycled.
import * as THREE from 'three';
import { damageAt } from './weapons.js';
import { segmentBlocked } from './map.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _end = new THREE.Vector3();

export function createCombat(scene, shootMeshes, colliders) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  const fighters = []; // filled by main: { team, alive, hitMeshes, applyDamage }

  // Tracer pool.
  const tracerMat = new THREE.LineBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < 28; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, ttl: 0 });
  }
  let tracerIdx = 0;

  // Impact spark pool.
  const sparks = [];
  const sparkMat = new THREE.SpriteMaterial({
    color: 0xffc36b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < 16; i += 1) {
    const s = new THREE.Sprite(sparkMat.clone());
    s.visible = false;
    scene.add(s);
    sparks.push({ s, ttl: 0 });
  }
  let sparkIdx = 0;

  function tracer(from, to) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.55;
    t.ttl = 0.05;
  }

  function spark(point, big = false) {
    const sp = sparks[sparkIdx];
    sparkIdx = (sparkIdx + 1) % sparks.length;
    sp.s.position.copy(point);
    sp.s.scale.setScalar(big ? 0.9 : 0.32);
    sp.s.visible = true;
    sp.s.material.opacity = 0.9;
    sp.ttl = 0.12;
  }

  // Fire one hitscan round. `shooter` is a fighter (or the player wrapper); returns
  // { hitFighter, died, damage, isHead, point, dist } or a wall-only result.
  function fire(shooter, def, origin, dir, spread, rng, muzzlePoint) {
    _dir.copy(dir);
    if (spread > 0) {
      _dir.x += (rng() * 2 - 1) * spread;
      _dir.y += (rng() * 2 - 1) * spread;
      _dir.z += (rng() * 2 - 1) * spread;
      _dir.normalize();
    }
    _origin.copy(origin);
    raycaster.set(_origin, _dir);
    // Gather targets: static geometry + every living fighter's hit meshes.
    const targets = shootMeshes;
    let best = null;
    const wallHits = raycaster.intersectObjects(targets, false);
    if (wallHits.length) best = { dist: wallHits[0].distance, point: wallHits[0].point, fighter: null };
    for (const f of fighters) {
      if (!f.alive || f === shooter) continue;
      const hits = raycaster.intersectObjects(f.hitMeshes, false);
      if (hits.length && (!best || hits[0].distance < best.dist)) {
        best = {
          dist: hits[0].distance,
          point: hits[0].point,
          fighter: f,
          part: hits[0].object.userData.part,
        };
      }
    }
    _end.copy(_origin).addScaledVector(_dir, best ? best.dist : 90);
    tracer(muzzlePoint || _origin, _end);
    if (!best) return { hitFighter: null, died: false, damage: 0, dist: 90 };
    if (!best.fighter) {
      spark(best.point);
      return { hitFighter: null, died: false, damage: 0, dist: best.dist, point: best.point };
    }
    const isHead = best.part === 'head';
    const raw = damageAt(def, best.dist, isHead);
    const applied = best.fighter.applyDamage(raw, isHead, shooter);
    spark(best.point);
    return {
      hitFighter: best.fighter, died: applied.died, damage: applied.damage, isHead, dist: best.dist, point: best.point,
    };
  }

  // --- Frag grenades ---
  const grenadeMeshGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 0.5, metalness: 0.4 });
  const grenades = [];
  const explosionLight = new THREE.PointLight(0xffa050, 0, 16, 1.8);
  scene.add(explosionLight);
  let explosionTtl = 0;

  function throwGrenade(from, dir, owner) {
    const mesh = new THREE.Mesh(grenadeMeshGeo, grenadeMat);
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      vel: new THREE.Vector3(dir.x * 13, dir.y * 13 + 4.5, dir.z * 13),
      fuse: 1.7,
      owner,
      kind: 'frag',
    });
  }

  // --- Smoke canisters: same arc and bounce, but they bloom into a sight-blocking
  // cloud instead of exploding. The cloud is a set of soft sprites plus a plan-view
  // disc that bot perception tests against, so smoke cuts both ways: it hides the
  // pusher and blinds the holder.
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.6, metalness: 0.3 });
  // Soft radial sprite texture — a plain square sprite reads as a white slab.
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = 128;
  puffCanvas.height = 128;
  {
    const ctx = puffCanvas.getContext('2d');
    const blob = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    };
    blob(64, 64, 62, 0.75);
    blob(38, 48, 30, 0.35);
    blob(90, 52, 28, 0.35);
    blob(56, 88, 30, 0.3);
    blob(84, 86, 24, 0.3);
  }
  const puffMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(puffCanvas), color: 0xa79fb2, transparent: true, opacity: 0, depthWrite: false,
  });
  const smokeClouds = []; // { x, z, r, ttl, puffs: [{s, phase}] }

  function throwSmoke(from, dir, owner) {
    const mesh = new THREE.Mesh(grenadeMeshGeo, smokeMat);
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({
      mesh,
      vel: new THREE.Vector3(dir.x * 12, dir.y * 12 + 4, dir.z * 12),
      fuse: 1.1,
      owner,
      kind: 'smoke',
    });
  }

  function deploySmoke(p) {
    const puffs = [];
    for (let i = 0; i < 9; i += 1) {
      const s = new THREE.Sprite(puffMat.clone());
      const a = (i / 9) * Math.PI * 2;
      const rr = i === 0 ? 0 : 1.1 + (i % 3) * 0.5;
      s.position.set(p.x + Math.cos(a) * rr, 0.9 + (i % 4) * 0.45, p.z + Math.sin(a) * rr);
      s.scale.setScalar(1.2);
      scene.add(s);
      puffs.push({ s, phase: i * 0.7 });
    }
    smokeClouds.push({ x: p.x, z: p.z, r: 3.1, ttl: 16, puffs });
  }

  // Does the segment pass through a live smoke cloud? (Plan view, like segmentBlocked.)
  function smokeBlocksSight(x1, z1, x2, z2) {
    for (const c of smokeClouds) {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((c.x - x1) * dx + (c.z - z1) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + dx * t;
      const pz = z1 + dz * t;
      if (Math.hypot(c.x - px, c.z - pz) < c.r * 0.85) return true;
    }
    return false;
  }

  function stepSmoke(dt) {
    for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
      const c = smokeClouds[i];
      c.ttl -= dt;
      const age = 16 - c.ttl;
      const grow = Math.min(1, age / 1.3);
      const fade = c.ttl < 2.5 ? Math.max(0, c.ttl / 2.5) : 1;
      for (const p of c.puffs) {
        p.s.scale.setScalar(1.2 + grow * 4.6 + Math.sin(age * 0.7 + p.phase) * 0.3);
        p.s.material.opacity = 0.44 * grow * fade;
      }
      if (c.ttl <= 0) {
        for (const p of c.puffs) scene.remove(p.s);
        smokeClouds.splice(i, 1);
      }
    }
  }

  function explode(g, events) {
    const p = g.mesh.position;
    explosionLight.position.set(p.x, p.y + 0.5, p.z);
    explosionLight.intensity = 120;
    explosionTtl = 0.22;
    spark(p, true);
    events.push({ type: 'explosion', point: p.clone() });
    for (const f of fighters) {
      if (!f.alive) continue;
      const fp = f.eyePos();
      const dist = Math.hypot(fp.x - p.x, fp.z - p.z);
      const dy = Math.abs((fp.y - 0.8) - p.y);
      const range = Math.hypot(dist, dy);
      if (range > 5.5) continue;
      if (segmentBlocked(colliders, p.x, p.z, fp.x, fp.z, 1.0)) continue;
      const dmg = 95 * Math.max(0.12, 1 - range / 5.5);
      const applied = f.applyDamage(dmg, false, g.owner);
      events.push({ type: 'grenadeHit', fighter: f, died: applied.died, damage: applied.damage, owner: g.owner });
    }
  }

  function stepGrenades(dt, events) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 18 * dt;
      const p = g.mesh.position;
      p.addScaledVector(g.vel, dt);
      if (p.y < 0.09) {
        p.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      // Bounce off walls in plan view.
      for (const c of colliders) {
        if (c.h < 0.5) continue;
        if (p.x > c.minX - 0.09 && p.x < c.maxX + 0.09 && p.z > c.minZ - 0.09 && p.z < c.maxZ + 0.09 && p.y < c.h) {
          const dxMin = Math.abs(p.x - c.minX);
          const dxMax = Math.abs(p.x - c.maxX);
          const dzMin = Math.abs(p.z - c.minZ);
          const dzMax = Math.abs(p.z - c.maxZ);
          const m = Math.min(dxMin, dxMax, dzMin, dzMax);
          if (m === dxMin) { p.x = c.minX - 0.09; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
          else if (m === dxMax) { p.x = c.maxX + 0.09; g.vel.x = Math.abs(g.vel.x) * 0.4; }
          else if (m === dzMin) { p.z = c.minZ - 0.09; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
          else { p.z = c.maxZ + 0.09; g.vel.z = Math.abs(g.vel.z) * 0.4; }
        }
      }
      if (g.fuse <= 0) {
        if (g.kind === 'smoke') {
          deploySmoke(g.mesh.position);
          events.push({ type: 'smoke', point: g.mesh.position.clone() });
        } else {
          explode(g, events);
        }
        scene.remove(g.mesh);
        grenades.splice(i, 1);
      }
    }
    stepSmoke(dt);
    if (explosionTtl > 0) {
      explosionTtl -= dt;
      if (explosionTtl <= 0) explosionLight.intensity = 0;
    }
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.ttl > 0) {
        t.ttl -= dt;
        t.line.material.opacity = Math.max(0, t.ttl / 0.05) * 0.55;
        if (t.ttl <= 0) t.line.visible = false;
      }
    }
    for (const sp of sparks) {
      if (sp.ttl > 0) {
        sp.ttl -= dt;
        sp.s.material.opacity = Math.max(0, sp.ttl / 0.12) * 0.9;
        if (sp.ttl <= 0) sp.s.visible = false;
      }
    }
  }

  return { fighters, fire, throwGrenade, throwSmoke, smokeBlocksSight, stepGrenades, step };
}
