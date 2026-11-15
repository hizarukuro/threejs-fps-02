// Bot fighters. A bot is a physics body, a two-box hit model (body + head) and a small
// state machine: follow orders over the waypoint graph, perceive enemies by sight
// (field of view + line of sight) and by gunfire noise, and fight in bursts with a
// human reaction delay. Orders come from rounds.js: push a site, hold a spot, plant,
// defuse, fetch the dropped charge, cover the planter.
import * as THREE from 'three';
import { moveBody } from './physics.js';
import { findPath, nearestNode, segmentBlocked } from './map.js';
import { WEAPONS, createWeaponState, spreadFor } from './weapons.js';
import { PALETTE, TEAM } from './palette.js';

const EYE = 1.52;
const PREFERRED_RANGE = { pistol: 9, smg: 10, rifle: 16, dmr: 25 };

const bodyMats = {
  [TEAM.WARDENS]: new THREE.MeshStandardMaterial({ color: PALETTE.teamWardens, roughness: 0.7 }),
  [TEAM.JACKALS]: new THREE.MeshStandardMaterial({ color: PALETTE.teamJackals, roughness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.85 }),
  head: new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.65 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.5, metalness: 0.4 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5, metalness: 0.5 }),
};

let botSeq = 0;

// Floating nameplate: a small canvas sprite over the head, team-coloured, so a
// squad reads as named people at a glance (and in screenshots).
function makeNameplate(name, team) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10,12,16,0.55)';
  ctx.beginPath();
  ctx.roundRect(28, 6, 200, 44, 10);
  ctx.fill();
  ctx.font = '600 29px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = team === TEAM.WARDENS ? '#2fd4c4' : '#ff7847';
  ctx.fillText(name, 128, 29);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.55, 0.34, 1);
  sp.position.y = 2.02;
  return sp;
}

export function createBot(scene, team, spawn, skill) {
  botSeq += 1;
  const group = new THREE.Group();
  const mat = bodyMats[team];
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.55, 0.3), bodyMats.dark);
  legs.position.y = 0.28;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat);
  torso.position.y = 0.92;
  torso.userData.part = 'body';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), bodyMats.head);
  head.position.y = 1.5;
  head.userData.part = 'head';
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), bodyMats.helmet);
  helmet.position.y = 1.68;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.55), bodyMats.gun);
  gun.position.set(0.18, 1.12, -0.3);
  for (const m of [legs, torso, head, helmet]) m.castShadow = true;
  group.add(legs, torso, head, helmet, gun);
  scene.add(group);

  const bot = {
    id: `bot${botSeq}`,
    isBot: true,
    team,
    group,
    hitMeshes: [torso, head],
    body: { pos: { x: spawn[0], y: 0, z: spawn[1] }, vy: 0, radius: 0.42, grounded: true },
    yaw: team === TEAM.WARDENS ? -Math.PI / 4 : Math.PI * 0.75,
    health: 100,
    armor: false,
    alive: true,
    skill, // 0..1 — reaction time and aim error scale with it
    weapon: createWeaponState('pistol'),
    grenades: 0,
    smokes: 0,
    nameplate: null,
    contactCd: 0,
    heardCd: 0,
    orderCd: 0,
    lastOrderType: 'hold',
    setName(name) {
      this.name = name;
      if (!this.nameplate) {
        this.nameplate = makeNameplate(name, this.team);
        this.group.add(this.nameplate);
      }
    },
    order: { type: 'hold', x: spawn[0], z: spawn[1] },
    // brain state
    path: [],
    pathIdx: 0,
    state: 'route',
    target: null,
    lastKnown: null,
    lastSeenAt: -9,
    perceiveAt: Math.random() * 0.12,
    reactUntil: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    strafeDir: 1,
    strafeFlipAt: 0,
    crouching: false,
    channel: null, // { type:'plant'|'defuse', progress } while channeling
    speedNow: 0,
    stepPhase: Math.random() * 6,

    bodyPos() {
      return this.body.pos;
    },
    eyePos() {
      return new THREE.Vector3(this.body.pos.x, this.body.pos.y + EYE, this.body.pos.z);
    },
    chestPos() {
      return new THREE.Vector3(this.body.pos.x, this.body.pos.y + 1.1, this.body.pos.z);
    },
    applyDamage(raw, isHead) {
      if (!this.alive) return { damage: 0, died: false };
      const dmg = this.armor ? raw * 0.55 : raw;
      this.health -= dmg;
      if (this.health <= 0) {
        this.health = 0;
        this.alive = false;
        this.channel = null;
        this.group.rotation.z = Math.PI / 2.1;
        this.group.position.y = 0.25;
        if (this.nameplate) this.nameplate.visible = false;
        return { damage: dmg, died: true };
      }
      return { damage: dmg, died: false };
    },
    setLoadout(weaponId, armor, grenades) {
      this.weapon = createWeaponState(weaponId);
      this.armor = armor;
      this.grenades = grenades;
    },
    revive(at) {
      this.alive = true;
      this.health = 100;
      this.channel = null;
      this.target = null;
      this.lastKnown = null;
      if (this.nameplate) this.nameplate.visible = true;
      this.path = [];
      this.body.pos.x = at[0];
      this.body.pos.z = at[1];
      this.body.pos.y = 0;
      this.body.vy = 0;
      this.group.rotation.z = 0;
      this.group.position.y = 0;
      this.state = 'route';
    },
  };
  torso.userData.fighter = bot;
  head.userData.fighter = bot;
  syncMesh(bot);
  return bot;
}

function syncMesh(bot) {
  bot.group.position.set(bot.body.pos.x, bot.body.pos.y, bot.body.pos.z);
  if (bot.alive) bot.group.rotation.y = bot.yaw;
}

function angleTo(bot, x, z) {
  return Math.atan2(-(x - bot.body.pos.x), -(z - bot.body.pos.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function canSee(bot, other, colliders, smokeBlocked) {
  const a = bot.eyePos();
  const b = other.chestPos();
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  if (dist > 40) return false;
  if (dist > 4.5) {
    const facing = angleTo(bot, b.x, b.z);
    if (Math.abs(angleDiff(facing, bot.yaw)) > 1.35) return false;
  }
  if (segmentBlocked(colliders, a.x, a.z, b.x, b.z, 1.3)) return false;
  // A smoke cloud between the two cuts sight just like a container does.
  if (smokeBlocked && smokeBlocked(a.x, a.z, b.x, b.z)) return false;
  return true;
}

// Route toward (x, z) over the waypoint graph; returns true on arrival.
function routeTo(bot, ctx, x, z, dt, speed) {
  const here = nearestNode(ctx.nodes, bot.body.pos.x, bot.body.pos.z);
  const goal = nearestNode(ctx.nodes, x, z);
  if (!bot.path.length || bot.pathGoal !== goal) {
    bot.path = findPath(ctx.nodes, ctx.edges, here, goal);
    bot.pathIdx = 0;
    bot.pathGoal = goal;
  }
  let tx = x;
  let tz = z;
  if (bot.pathIdx < bot.path.length) {
    const node = ctx.nodes[bot.path[bot.pathIdx]];
    tx = node.x;
    tz = node.z;
    if (Math.hypot(tx - bot.body.pos.x, tz - bot.body.pos.z) < 0.9) {
      bot.pathIdx += 1;
      return routeTo(bot, ctx, x, z, dt, speed);
    }
  }
  return moveToward(bot, ctx, tx, tz, dt, speed, Math.hypot(x - bot.body.pos.x, z - bot.body.pos.z) < 1.1);
}

function moveToward(bot, ctx, tx, tz, dt, speed, arrived) {
  const dx = tx - bot.body.pos.x;
  const dz = tz - bot.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (arrived || dist < 0.05) {
    bot.speedNow = 0;
    return true;
  }
  const want = angleTo(bot, tx, tz);
  bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, angleDiff(want, bot.yaw)));
  const stepLen = Math.min(dist, speed * dt);
  moveBody(ctx.colliders, bot.body, (dx / dist) * stepLen, (dz / dist) * stepLen, dt);
  bot.speedNow = speed;
  bot.stepPhase += dt * speed * 1.6;
  return false;
}

export function stepBot(bot, ctx, dt, now) {
  if (!bot.alive) return;
  bot.weapon.step(dt);
  bot.weapon.finishReloadIfDue(now);
  const { colliders } = ctx;

  // --- Perception (staggered) ---
  bot.perceiveAt -= dt;
  if (bot.perceiveAt <= 0) {
    bot.perceiveAt = 0.12;
    let best = null;
    let bestDist = Infinity;
    for (const other of ctx.fighters) {
      if (!other.alive || other.team === bot.team) continue;
      if (canSee(bot, other, colliders, ctx.smokeBlocked)) {
        const d = Math.hypot(other.bodyPos().x - bot.body.pos.x, other.bodyPos().z - bot.body.pos.z);
        if (d < bestDist) {
          bestDist = d;
          best = other;
        }
      }
    }
    if (best) {
      if (bot.target !== best) {
        bot.reactUntil = now + 0.55 - bot.skill * 0.28;
        if (ctx.onRadio && now > bot.contactCd) {
          bot.contactCd = now + 6;
          ctx.onRadio('contact', bot, best.bodyPos());
        }
      }
      bot.target = best;
      bot.lastKnown = { x: best.bodyPos().x, z: best.bodyPos().z };
      bot.lastSeenAt = now;
    } else if (bot.target && now - bot.lastSeenAt > 0.4) {
      bot.target = null;
    }
    // Hearing: a recent enemy shot near us points us at the shooter.
    if (!bot.target) {
      for (const n of ctx.noise) {
        if (n.team !== bot.team && now - n.at < 1.6 && Math.hypot(n.x - bot.body.pos.x, n.z - bot.body.pos.z) < 16) {
          if (!bot.lastKnown && ctx.onRadio && now > bot.heardCd) {
            bot.heardCd = now + 8;
            ctx.onRadio('heard', bot, n);
          }
          bot.lastKnown = { x: n.x, z: n.z };
        }
      }
    }
  }

  const engage = bot.target && bot.target.alive;
  bot.channel = null;

  if (engage) {
    // --- Fight: hold a weapon-appropriate range, strafe, fire in bursts. ---
    const t = bot.target;
    const tp = t.bodyPos();
    const dx = tp.x - bot.body.pos.x;
    const dz = tp.z - bot.body.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = angleTo(bot, tp.x, tp.z);
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, angleDiff(want, bot.yaw)));
    const range = PREFERRED_RANGE[bot.weapon.def.id];
    let mx = 0;
    let mz = 0;
    if (now > bot.strafeFlipAt) {
      bot.strafeFlipAt = now + 0.7 + ctx.rng() * 0.8;
      bot.strafeDir = ctx.rng() < 0.5 ? -1 : 1;
    }
    const strafeX = (-dz / (dist || 1)) * bot.strafeDir;
    const strafeZ = (dx / (dist || 1)) * bot.strafeDir;
    const radial = dist > range + 2 ? 1 : dist < range - 3 ? -0.7 : 0;
    mx = strafeX * 0.8 + (dx / (dist || 1)) * radial;
    mz = strafeZ * 0.8 + (dz / (dist || 1)) * radial;
    const mLen = Math.hypot(mx, mz) || 1;
    const speed = 3.1;
    moveBody(colliders, bot.body, (mx / mLen) * speed * dt, (mz / mLen) * speed * dt, dt);
    bot.speedNow = speed;
    bot.crouching = (bot.weapon.def.id === 'dmr' || bot.weapon.def.id === 'rifle') && radial === 0 && ctx.rng() < 0.4;

    if (now >= bot.reactUntil) {
      if (bot.burstLeft <= 0 && now >= bot.burstPauseUntil) {
        bot.burstLeft = 3 + Math.floor(ctx.rng() * 3);
      }
      if (bot.burstLeft > 0) {
        if (bot.weapon.mag === 0) bot.weapon.startReload(now);
        else if (bot.weapon.tryFire(now)) {
          bot.burstLeft -= 1;
          const aim = t.chestPos();
          if (bot.skill > 0.55 && ctx.rng() < 0.22) aim.y += 0.42; // sometimes the head
          const dir = aim.sub(bot.eyePos()).normalize();
          const err = (1 - bot.skill) * 0.035 + 0.008;
          const tSpeed = typeof t.speedNow === 'function' ? t.speedNow() : (t.speedNow || 0);
          const spread = spreadFor(bot.weapon.def, Math.min(1, tSpeed / 5), bot.crouching) + err;
          const muzzle = bot.eyePos();
          muzzle.y -= 0.18;
          const res = ctx.combat.fire(bot, bot.weapon.def, bot.eyePos(), dir, spread, ctx.rng, muzzle);
          ctx.onBotShot(bot, res);
          if (bot.burstLeft === 0) bot.burstPauseUntil = now + 0.4 + ctx.rng() * 0.55;
        }
      }
    }
  } else if (bot.lastKnown && now - bot.lastSeenAt < 4) {
    // Hunt the last known position, then fall back to orders.
    if (routeTo(bot, ctx, bot.lastKnown.x, bot.lastKnown.z, dt, 4.4)) bot.lastSeenAt = -9;
  } else {
    // --- Orders ---
    const order = bot.order;
    bot.crouching = false;
    // Radio: speak up when the plan changes under us.
    if (order.type !== bot.lastOrderType) {
      if (ctx.onRadio && order.type === 'defuseAt' && now > bot.orderCd) {
        bot.orderCd = now + 10;
        ctx.onRadio('rotating', bot);
      }
      if (ctx.onRadio && order.type === 'pickup') ctx.onRadio('pickup', bot);
      bot.lastOrderType = order.type;
    }
    // Smoke the crossing on the way in: an attacker with a canister and open
    // ground ahead sometimes hides the push (defenders do it at their gate too).
    if (bot.smokes > 0 && (order.type === 'push' || order.type === 'plant')) {
      const dObj = Math.hypot(order.x - bot.body.pos.x, order.z - bot.body.pos.z);
      if (dObj > 5 && dObj < 17 && ctx.rng() < dt * 0.22) {
        bot.smokes -= 1;
        const from = bot.eyePos();
        const dir = new THREE.Vector3(order.x - from.x, -0.1, order.z - from.z).normalize();
        ctx.combat.throwSmoke(from, dir, bot);
        if (ctx.onRadio) ctx.onRadio('smoke', bot);
      }
    }
    if (order.type === 'hold') {
      if (!moveToward(bot, ctx, order.x, order.z, dt, 4.2, Math.hypot(order.x - bot.body.pos.x, order.z - bot.body.pos.z) < 0.7)) {
        // still walking
      } else {
        bot.speedNow = 0;
        const want = order.yaw !== undefined ? order.yaw : bot.yaw;
        bot.yaw += Math.max(-2 * dt, Math.min(2 * dt, angleDiff(want, bot.yaw)));
        bot.crouching = order.crouch === true;
      }
    } else if (order.type === 'push' || order.type === 'pickup' || order.type === 'defuse') {
      routeTo(bot, ctx, order.x, order.z, dt, 4.5);
    } else if (order.type === 'plant') {
      const arrived = routeTo(bot, ctx, order.x, order.z, dt, 4.5);
      if (arrived) {
        bot.speedNow = 0;
        bot.channel = { type: 'plant', site: order.site };
      }
    } else if (order.type === 'defuseAt') {
      const arrived = routeTo(bot, ctx, order.x, order.z, dt, 4.6);
      if (arrived) {
        bot.speedNow = 0;
        bot.channel = { type: 'defuse' };
      }
    }
  }

  // Radio: announce a channel once, when it starts.
  if (bot.channel && !bot.channelCalled && ctx.onRadio) {
    bot.channelCalled = true;
    if (bot.channel.type === 'plant') ctx.onRadio('planting', bot);
    if (bot.channel.type === 'defuse') ctx.onRadio('defusing', bot);
  }
  if (!bot.channel) bot.channelCalled = false;

  if (bot.weapon.mag === 0 && !engage) bot.weapon.startReload(now);
  syncMesh(bot);
  // Nameplates are fixed-size sprites: point-blank they fill the screen, so
  // fade them out when the bot is on top of the camera.
  if (bot.nameplate && ctx.cameraPos) {
    const d = Math.hypot(bot.body.pos.x - ctx.cameraPos.x, bot.body.pos.z - ctx.cameraPos.z);
    bot.nameplate.visible = bot.alive && d > 2.4;
  }
  // A gentle bob while walking so the model does not glide.
  if (bot.alive && bot.speedNow > 0.2) {
    bot.group.position.y = bot.body.pos.y + Math.abs(Math.sin(bot.stepPhase)) * 0.045;
  }
}
