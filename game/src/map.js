// Vesper Yard: an original golden-hour freight depot. One warehouse (three rooms, four
// doors), a container mid with two lanes, a fenced fuel yard, and two plant sites. The
// same box list drives the meshes, the AABB colliders and line-of-sight, so what you
// see is what blocks you. Waypoints are auto-linked by distance + line of sight into
// the bot graph.

// Named regions of the yard — the radio callouts bots use ("contact, Fuel Yard").
export const CALLOUTS = [
  { name: 'Warehouse', test: (x, z) => x < -8 && z > -10 && z < 10 },
  { name: 'the Dock', test: (x, z) => x >= -8 && x < 0 && z > -7 && z < 5 },
  { name: 'Fuel Yard', test: (x, z) => x >= 18 && z <= -9 },
  { name: 'Tanks', test: (x, z) => x >= 14 && z <= -9 },
  { name: 'Mid Crates', test: (x, z) => z > -6 && z < 8 },
  { name: 'North Lane', test: (x, z) => z >= 8 },
  { name: 'South Lane', test: (x, z) => z < -6 },
];
export function calloutAt(x, z) {
  for (const c of CALLOUTS) if (c.test(x, z)) return c.name;
  return 'Mid Crates';
}
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeTextures } from './textures.js';

export const BOUNDS = { minX: -34, maxX: 34, minZ: -24, maxZ: 24 };

// Segment vs AABB in plan view; a collider blocks sight only above `minH` metres.
export function segmentBlocked(colliders, x1, z1, x2, z2, minH) {
  for (const c of colliders) {
    if (c.h < minH) continue;
    const dx = x2 - x1;
    const dz = z2 - z1;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    if (Math.abs(dx) < 1e-9) {
      if (x1 < c.minX || x1 > c.maxX) ok = false;
    } else {
      let ta = (c.minX - x1) / dx;
      let tb = (c.maxX - x1) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (ok) {
      if (Math.abs(dz) < 1e-9) {
        if (z1 < c.minZ || z1 > c.maxZ) ok = false;
      } else {
        let ta = (c.minZ - z1) / dz;
        let tb = (c.maxZ - z1) / dz;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
    }
    if (ok && t0 <= t1 && t1 > 0.02 && t0 < 0.98) return true;
  }
  return false;
}

export function buildMap(scene) {
  const tex = makeTextures();
  const colliders = [];
  const shootMeshes = [];
  const group = new THREE.Group();
  scene.add(group);

  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95 }),
    concreteDark: new THREE.MeshStandardMaterial({ map: tex.concrete, color: 0x9aa0a4, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.6, metalness: 0.55 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.9 }),
    hazard: new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xb9c0c4, roughness: 0.35, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.9 }),
  };
  const containerMats = [PALETTE.containerTeal, PALETTE.containerRust, PALETTE.containerSand, PALETTE.containerSlate]
    .map((hex) => new THREE.MeshStandardMaterial({
      map: tex.containerSide('#' + hex.toString(16).padStart(6, '0')),
      roughness: 0.72,
      metalness: 0.25,
    }));

  const geoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `${w}|${h}|${d}`;
    let geo = geoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      geoCache.set(key, geo);
    }
    return geo;
  }

  // A solid box: mesh + collider. h is its full height from the ground.
  function solid(cx, cz, w, d, h, mat, y0 = 0) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.castShadow = h > 0.9;
    mesh.receiveShadow = true;
    group.add(mesh);
    shootMeshes.push(mesh);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h: y0 + h, y0 });
    return mesh;
  }
  // A wall run along one axis with door gaps: spans are [from, to] pairs on that axis.
  function wallRun(axis, fixed, spans, thickness, h, mat) {
    for (const [a, b] of spans) {
      const mid = (a + b) / 2;
      const len = b - a;
      if (axis === 'x') solid(mid, fixed, len, thickness, h, mat);
      else solid(fixed, mid, thickness, len, h, mat);
    }
  }

  // Ground and apron.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 56),
    new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  shootMeshes.push(ground);

  // Perimeter.
  wallRun('x', BOUNDS.minZ, [[BOUNDS.minX, BOUNDS.maxX]], 0.6, 4.5, mats.concreteDark);
  wallRun('x', BOUNDS.maxZ, [[BOUNDS.minX, BOUNDS.maxX]], 0.6, 4.5, mats.concreteDark);
  wallRun('z', BOUNDS.minX, [[BOUNDS.minZ, BOUNDS.maxZ]], 0.6, 4.5, mats.concreteDark);
  wallRun('z', BOUNDS.maxX, [[BOUNDS.minZ, BOUNDS.maxZ]], 0.6, 4.5, mats.concreteDark);

  // Warehouse: x -30..-8, z -10..10. Doors: north x[-14,-12], south x[-20,-18],
  // east z[-2,0] and z[6,8]. Partitions make a west-north room and a west-south room.
  const WH = 5;
  wallRun('z', -30, [[-10, 10]], 0.4, WH, mats.concrete);
  wallRun('x', -10, [[-30, -14], [-12, -8]], 0.4, WH, mats.concrete);
  wallRun('x', 10, [[-30, -20], [-18, -8]], 0.4, WH, mats.concrete);
  wallRun('z', -8, [[-10, -2], [0, 6], [8, 10]], 0.4, WH, mats.concrete);
  wallRun('z', -19, [[-10, -1], [1, 10]], 0.4, WH, mats.concrete);
  wallRun('x', -4, [[-30, -27], [-25, -19]], 0.4, WH, mats.concrete);
  // Roof slab so the interior reads as a building from the dock crane view and doors
  // spill lamp light; it is above every sightline and never collides.
  const roof = new THREE.Mesh(boxGeo(22.8, 0.3, 20.8), mats.dark);
  roof.position.set(-19, WH + 0.15, 0);
  group.add(roof);
  // Interior crates and a workbench wall.
  solid(-26, 6, 2.2, 2.2, 1.1, mats.crate);
  solid(-26, 6, 2.2, 2.2, 1.1, mats.crate, 1.1);
  solid(-11, -6, 3.2, 1.1, 1.1, mats.crate);
  solid(-22, -7.5, 2.2, 2.2, 1.1, mats.crate);

  // Containers in mid: two lanes with cross gaps, two of them stacked.
  const box6 = (x, z, alongX, mat, y0 = 0) => (alongX
    ? solid(x, z, 6.1, 2.44, 2.6, mat, y0)
    : solid(x, z, 2.44, 6.1, 2.6, mat, y0));
  box6(1, -9, true, containerMats[0]);
  box6(1, -5.2, true, containerMats[1]);
  box6(9, -14.5, false, containerMats[2]);
  box6(6, -14, true, containerMats[3]);
  box6(6, -14, true, containerMats[0], 2.6);
  box6(14, -6, true, containerMats[1]);
  box6(8, 2, true, containerMats[2]);
  box6(13.5, 6.5, false, containerMats[0]);
  box6(3, 11, true, containerMats[3]);
  box6(-2, 16.5, true, containerMats[1]);
  box6(16, 14.5, false, containerMats[2]);
  box6(22, 2, true, containerMats[0]);
  box6(-4, -16, true, containerMats[2]);

  // Crate clusters: low cover you can vault onto.
  const crateAt = (x, z, stack = 1) => {
    solid(x, z, 1.6, 1.6, 1.1, mats.crate);
    if (stack > 1) solid(x, z, 1.6, 1.6, 1.1, mats.crate, 1.1);
  };
  crateAt(-4, 7.5);
  crateAt(-4, 9.3);
  crateAt(6, 15);
  crateAt(18, -3, 2);
  crateAt(-1, -1);
  crateAt(20, 10);
  crateAt(-13, 14, 2);
  crateAt(11, -1.5);

  // Hazard-striped dock edge in front of the warehouse east doors (site A apron).
  const dock = new THREE.Mesh(boxGeo(7.5, 0.18, 11), mats.hazard);
  dock.position.set(-4.2, 0.09, -1);
  dock.receiveShadow = true;
  group.add(dock);
  shootMeshes.push(dock);
  colliders.push({ minX: -7.95, maxX: -0.45, minZ: -6.5, maxZ: 4.5, h: 0.18, y0: 0, step: true });

  // Fuel yard (site B): low fence with two gaps, three tanks.
  wallRun('x', -21, [[18, 31]], 0.3, 1.15, mats.steel);
  wallRun('x', -9, [[18, 25], [27, 31]], 0.3, 1.15, mats.steel);
  wallRun('z', 31, [[-21, -9]], 0.3, 1.15, mats.steel);
  wallRun('z', 18, [[-21, -17], [-13, -9]], 0.3, 1.15, mats.steel);
  const tankGeo = new THREE.CylinderGeometry(1.7, 1.7, 3.4, 18);
  for (const [tx, tz] of [[22, -12.5], [26.5, -17.5], [29.5, -11.5]]) {
    const tank = new THREE.Mesh(tankGeo, mats.tank);
    tank.position.set(tx, 1.7, tz);
    tank.castShadow = true;
    tank.receiveShadow = true;
    group.add(tank);
    shootMeshes.push(tank);
    colliders.push({ minX: tx - 1.7, maxX: tx + 1.7, minZ: tz - 1.7, maxZ: tz + 1.7, h: 3.4, y0: 0 });
  }

  // Lamp posts: emissive heads everywhere, real point lights on four of them.
  const lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0x554422, emissive: PALETTE.lampGlow, emissiveIntensity: 2.4,
  });
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8);
  const lampSpots = [[-6, -14], [12, -17], [-2, 6], [20, 8], [-24, -16], [28, 16], [-13, -1], [24, -15]];
  lampSpots.forEach(([lx, lz], i) => {
    const pole = new THREE.Mesh(poleGeo, mats.dark);
    pole.position.set(lx, 2.3, lz);
    group.add(pole);
    const head = new THREE.Mesh(boxGeo(0.7, 0.18, 0.4), lampHeadMat);
    head.position.set(lx, 4.65, lz);
    group.add(head);
    colliders.push({ minX: lx - 0.15, maxX: lx + 0.15, minZ: lz - 0.15, maxZ: lz + 0.15, h: 4.6, y0: 0 });
    if (i % 2 === 0) {
      const light = new THREE.PointLight(PALETTE.lampGlow, 110, 20, 1.9);
      light.position.set(lx, 4.4, lz);
      scene.add(light);
    }
  });

  // Site decals.
  const sites = {
    A: { x: -4.2, z: -1, r: 3.6, name: 'Loading Bay' },
    B: { x: 24.5, z: -15, r: 3.8, name: 'Fuel Yard' },
  };
  const decal = (site, letter, color) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(site.r * 2, site.r * 2),
      new THREE.MeshBasicMaterial({ map: tex.siteMark(letter, color), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(site.x, 0.02, site.z);
    group.add(m);
  };
  decal(sites.A, 'A', '#ffc44d');
  decal(sites.B, 'B', '#6ec3ff');

  // Painted site signs on the two walls every approach reads: the warehouse east
  // wall over the dock (A) and the fuel-yard fence line (B).
  const sign = (site, letter, color, x, y, z, rotY) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 2.3),
      new THREE.MeshBasicMaterial({ map: tex.signBoard(letter, site.name, color) }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    group.add(m);
  };
  sign(sites.A, 'A', '#ffc44d', -7.78, 3.1, -1, Math.PI / 2);
  sign(sites.B, 'B', '#6ec3ff', 24.5, 2.6, -8.8, 0);

  const spawns = {
    wardens: [[-28, 18], [-25, 20.5], [-30.5, 15], [-22, 16.5], [-31, 20]],
    jackals: [[28, -19.5], [25, -21], [30.5, -16.5], [22, -20], [31.5, -21]],
  };

  // Waypoints: spawns, doors, lane junctions, site hearts and cover spots.
  const nodes = [
    [-26, 17.5], [-19, 14], [-13, 13.5], [-6, 13], [2, 14.5], [10, 11], [19, 11], [27, 12],
    [-19, 7], [-13, 4], [-5, 3.5], [4, 5.5], [11, 3], [19, 4.5], [27, 5],
    [-24, 0], [-15, -0.5], [-4, -1], [4, -2.5], [12, -3.5], [20, -1], [28, -3],
    [-26, -7], [-15, -6.5], [-6, -7], [3, -7.2], [11, -8.5], [19, -7.5], [27, -6],
    [-19, -14], [-10, -14.5], [-1, -12], [7, -11.5], [15, -12], [24.5, -15], [29, -18],
    [-28, 8], [-11, 7.5], [-19, -0.5], [16, -15.5], [21, -19], [-13, -13],
  ].map(([x, z]) => ({ x, z }));

  // Link nodes that can see each other within 12 m (sight blocked above knee height).
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 12) continue;
      if (segmentBlocked(colliders, a.x, a.z, b.x, b.z, 0.6)) continue;
      edges[i].push(j);
      edges[j].push(i);
    }
  }

  // Where defenders like to stand at each site, and the yaw they watch.
  const holdSpots = {
    A: [
      { x: -11, z: -6, yaw: -Math.PI / 2 },  // inside warehouse, watching the dock door
      { x: -1, z: -7.5, yaw: 2.7 },          // behind the mid containers, watching A apron
      { x: -13, z: 4, yaw: -2.1 },           // warehouse east room, east door
    ],
    B: [
      { x: 21, z: -19, yaw: 2.5 },           // behind tank 2, watching the west gate
      { x: 29, z: -18.5, yaw: 2.2 },         // fence corner, watching the site
      { x: 19, z: -11, yaw: 1.3 },           // yard gate
    ],
  };

  return { group, colliders, shootMeshes, sites, spawns, nodes, edges, holdSpots };
}

// Shortest path over the waypoint graph (BFS); returns a list of node indices.
export function findPath(nodes, edges, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toIdx) break;
    for (const next of edges[cur]) {
      if (prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (prev[toIdx] === -1) return [fromIdx];
  const path = [toIdx];
  let cur = toIdx;
  while (cur !== fromIdx) {
    cur = prev[cur];
    path.push(cur);
  }
  return path.reverse();
}

export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
