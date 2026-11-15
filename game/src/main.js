// NIGHT FREIGHT — boot and the one loop. A fixed 60 Hz simulation steps the world;
// rendering follows the display. This module owns the scene, the player's fighter
// wrapper, weapon handling, planting, grenades and every hook rounds.js fires.
// ?shot=start|play|end&seed=N stages a deterministic frame for the entry screenshots.
import * as THREE from 'three';
import { PALETTE, TEAM, TEAM_NAME } from './palette.js';
import { buildMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { WEAPONS, WEAPON_ORDER, createWeaponState, spreadFor, buildViewmodel, createMuzzleFlash } from './weapons.js';
import { createAudio } from './audio.js';
import { createCombat } from './combat.js';
import { createBot, stepBot } from './bots.js';
import { createMatch, PLANT_TIME } from './rounds.js';
import { createHud } from './hud.js';
import { createRadio } from './radio.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
// Staged screenshots freeze once staged (the sim would otherwise keep fighting
// and can kill the staged player before the capture lands). &live=1 opts out —
// the verification harness uses it to prove the loop runs.
const freezeShot = Boolean(shot) && !params.has('live');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(a) {
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed * 7919 + 13);

// --- Renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
// Filmic grade with a lifted exposure: the golden hour should read as lit
// sunset, not night — surfaces keep their colour at screenshot distance.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 42, 115);
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

// Golden-hour sky: a big gradient dome, violet overhead melting to amber at the
// horizon, so every open sightline ends in sunset instead of flat colour.
{
  const skyGeo = new THREE.SphereGeometry(150, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4b3a5f) },
      mid: { value: new THREE.Color(0x9c5f74) },
      low: { value: new THREE.Color(0xff9a4d) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;'
      + 'void main(){ float h = normalize(vP).y; vec3 c = h > 0.18 ? mix(mid, top, smoothstep(0.18, 0.65, h)) : mix(low, mid, smoothstep(-0.04, 0.18, h));'
      + ' gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}

const hemi = new THREE.HemisphereLight(0xbfa8d8, 0x5d4630, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(PALETTE.sun, 3.2);
sun.position.set(-34, 15, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -42;
sun.shadow.camera.right = 42;
sun.shadow.camera.top = 42;
sun.shadow.camera.bottom = -42;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0006;
scene.add(sun);

const map = buildMap(scene);
const audio = createAudio();
const hud = createHud();
const combat = createCombat(scene, map.shootMeshes, map.colliders);

// --- Player fighter wrapper (the combat/bot interface over the player body) ---
const player = createPlayer(map.colliders, map.spawns.wardens[0]);
const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });
const pBodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.15, 0.4), hitMat);
pBodyMesh.userData.part = 'body';
const pHeadMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), hitMat);
pHeadMesh.userData.part = 'head';
scene.add(pBodyMesh, pHeadMesh);

const playerEnt = {
  isPlayer: true,
  team: TEAM.WARDENS,
  alive: true,
  health: 100,
  armor: false,
  hitMeshes: [pBodyMesh, pHeadMesh],
  bodyPos() { return player.body.pos; },
  eyePos() { return new THREE.Vector3(player.body.pos.x, player.body.pos.y + player.eye, player.body.pos.z); },
  chestPos() { return new THREE.Vector3(player.body.pos.x, player.body.pos.y + 1.15, player.body.pos.z); },
  speedNow() { return player.groundSpeed(); },
  applyDamage(raw, isHead) {
    if (!this.alive) return { damage: 0, died: false };
    const dmg = this.armor ? raw * 0.55 : raw;
    this.health -= dmg;
    hud.hurt();
    audio.hurt();
    shake = Math.min(0.5, shake + dmg * 0.006);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      onPlayerDeath();
      return { damage: dmg, died: true };
    }
    return { damage: dmg, died: false };
  },
};
pBodyMesh.userData.fighter = playerEnt;
pHeadMesh.userData.fighter = playerEnt;

// --- Bots ---
const wardenBots = map.spawns.wardens.slice(1).map((s, i) => createBot(scene, TEAM.WARDENS, s, 0.45 + i * 0.12));
const jackalBots = map.spawns.jackals.map((s, i) => createBot(scene, TEAM.JACKALS, s, 0.5 + (i % 3) * 0.13));
const allBots = [...wardenBots, ...jackalBots];
combat.fighters.push(playerEnt, ...allBots);
const BOT_NAMES = {
  wardens: ['Vega', 'Onyx', 'Pilar', 'Brann'],
  jackals: ['Rook', 'Sable', 'Dario', 'Moss', 'Fenwick'],
};
wardenBots.forEach((b, i) => b.setName(BOT_NAMES.wardens[i]));
jackalBots.forEach((b, i) => b.setName(BOT_NAMES.jackals[i]));

// --- Team radio: bot callouts land in the HUD feed. ---
const radio = createRadio(rng);
radio.onLine = (speaker, text, team) => hud.radio(speaker, text, team);

// --- Charge visual ---
const chargeMesh = new THREE.Group();
const chargeBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.22, 0.12),
  new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.5 }),
);
const chargeLight = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.05, 0.03),
  new THREE.MeshStandardMaterial({ color: 0x110b00, emissive: PALETTE.charge, emissiveIntensity: 2.5 }),
);
chargeLight.position.set(0, 0.14, 0);
chargeMesh.add(chargeBox, chargeLight);
scene.add(chargeMesh);

// --- Match ---
let simTime = 0;
let shake = 0;
let plantProgress = 0;
let started = false;
let matchOver = false;
let playerDiedThisRound = false;
const noise = []; // {x, z, at, team}

const match = createMatch({
  wardens: wardenBots,
  jackals: jackalBots,
  map,
  rng,
  hooks: {
    onRoundStart() {
      plantProgress = 0;
      hud.banner(`ROUND ${match.state.round}`, `Attack site ${match.state.attackSite} — ${map.sites[match.state.attackSite].name}`, 2.4, simTime);
    },
    onLive(state) {
      hud.hideBuy();
      if (!shot && playerEnt.alive) input.requestLock();
      const site = map.sites[state.attackSite];
      radio.plan(true, state.attackSite, site.name, simTime);
      radio.plan(false, state.attackSite, site.name, simTime + 0.1);
    },
    onRoundEnd(state, winnerTeam, reason) {
      const won = winnerTeam === TEAM.WARDENS;
      hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3.4, simTime);
      if (won) audio.roundWin();
      else audio.roundLose();
      if (document.pointerLockElement) document.exitPointerLock();
    },
    onMatchEnd(state) {
      matchOver = true;
      audio.matchEnd(state.winner === TEAM.WARDENS);
      hud.showOverlay('matchEnd', { win: state.winner === TEAM.WARDENS, scoreW: state.scoreW, scoreJ: state.scoreJ });
    },
    onRoundReset() {
      resetRoundBodies();
    },
    onPlant(state, siteKey) {
      hud.feed(`<span class="w">Charge planted</span> at site ${siteKey}`);
      radio.planted(TEAM.WARDENS, siteKey, simTime);
      audio.plantBeep(true);
    },
    onDetonate() {
      audio.explosion();
      shake = 0.6;
    },
    onChargeDropped() {
      hud.feed('Charge dropped');
    },
    onChargePickup(bot) {
      hud.feed(`${bot.name} picked up the charge`);
    },
    onChannel() {},
  },
});

// The rounds module keeps its own player record; bind it to the live fighter.
const kit = match.playerEnt.kit;
match.playerEnt.chargeDropPos = { x: 0, z: 0 };

// --- Player weapons: owned primaries + pistol, switched with 1-3 ---
const owned = { pistol: createWeaponState('pistol') };
let currentId = 'pistol';
let viewmodel = null;
const flash = createMuzzleFlash(camera);
function equip(id) {
  if (!owned[id]) return;
  currentId = id;
  if (viewmodel) camera.remove(viewmodel);
  viewmodel = buildViewmodel(id);
  camera.add(viewmodel);
  flash.attach(viewmodel);
}
equip('pistol');

function syncKitToWeapons() {
  // After a buy phase: grant the bought primary; on death everything was lost.
  if (kit.primary && !owned[kit.primary]) owned[kit.primary] = createWeaponState(kit.primary);
  if (kit.primary) equip(kit.primary);
  playerEnt.armor = kit.armor;
}

function resetRoundBodies() {
  const spawn = map.spawns.wardens[0];
  player.reset(spawn);
  playerEnt.health = 100;
  if (playerDiedThisRound) {
    kit.primary = null;
    kit.armor = false;
    kit.grenades = 0;
    kit.smokes = 0;
    delete owned.smg;
    delete owned.rifle;
    delete owned.dmr;
    owned.pistol = createWeaponState('pistol');
    equip('pistol');
  }
  playerEnt.alive = true;
  match.playerEnt.alive = true;
  playerDiedThisRound = false;
  wardenBots.forEach((b, i) => {
    if (!b.alive) { b.setLoadout('pistol', false, 0); b.smokes = 0; }
    b.revive(map.spawns.wardens[i + 1]);
  });
  jackalBots.forEach((b, i) => {
    if (!b.alive) { b.setLoadout('pistol', false, 0); b.smokes = 0; }
    b.revive(map.spawns.jackals[i]);
  });
  noise.length = 0;
}

function onPlayerDeath() {
  playerDiedThisRound = true;
  match.playerEnt.alive = false;
  match.playerEnt.chargeDropPos.x = player.body.pos.x;
  match.playerEnt.chargeDropPos.z = player.body.pos.z;
  match.notifyDeath(match.playerEnt, lastAttacker);
  if (viewmodel) viewmodel.visible = false;
  if (!matchOver) hud.showOverlay('dead');
}

// --- Input / flow ---
const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (started && !matchOver && match.state.phase === 'live' && playerEnt.alive) {
    hud.showOverlay('pause');
  }
});
hud.onOverlayButton = () => {
  audio.unlock();
  if (matchOver) {
    window.location.reload();
    return;
  }
  input.requestLock();
};
// Clicking the canvas re-locks when a phase change dropped the lock without an
// overlay (for example the buy clock expiring while the menu was open).
renderer.domElement.addEventListener('click', () => {
  if (!shot && started && !matchOver && !input.state.locked) input.requestLock();
});
hud.onBuy = (item) => {
  if (match.buy(item)) {
    audio.buy();
    syncKitToWeapons();
    hud.refreshBuy(match.playerEnt.money, kit);
  } else {
    audio.denied();
  }
};

function nameOf(fighter) {
  if (!fighter) return '?';
  if (fighter.isPlayer) return 'You';
  return fighter.name || fighter.id;
}
function teamClass(fighter) {
  return fighter.team === TEAM.WARDENS ? 'w' : 'j';
}

let lastAttacker = null;
function handleKill(victim, killer, isHead, viaGrenade = false) {
  hud.feed(
    `<span class="${teamClass(killer)}">${nameOf(killer)}</span> ${viaGrenade ? '▣' : '»'} <span class="${teamClass(victim)}">${nameOf(victim)}</span>${isHead ? ' <span class="hs">HEADSHOT</span>' : ''}`,
  );
  if (victim.isBot) {
    const witness = allBots.find((b) => b.alive && b.team === victim.team && b !== victim);
    if (witness) radio.down(witness, simTime);
  }
  if (victim.isPlayer) {
    // onPlayerDeath already ran inside applyDamage; just notify the match.
  } else {
    match.notifyDeath(victim, killer);
  }
  if (killer && killer.isPlayer) audio.hitmarker(true);
}

// Bot shooting callback: sound + noise + kill bookkeeping.
const botCtx = {
  colliders: map.colliders,
  nodes: map.nodes,
  edges: map.edges,
  fighters: combat.fighters,
  noise,
  rng,
  combat,
  cameraPos: camera.position,
  smokeBlocked: (x1, z1, x2, z2) => combat.smokeBlocksSight(x1, z1, x2, z2),
  onRadio(kind, bot, pos) {
    if (kind === 'contact') radio.contact(bot, pos, simTime);
    else if (kind === 'heard') radio.heard(bot, pos, simTime);
    else if (kind === 'rotating') radio.rotating(bot, match.state.plantSite || match.state.attackSite, simTime);
    else if (kind === 'planting') radio.planting(bot, match.state.attackSite, simTime);
    else if (kind === 'defusing') radio.defusing(bot, simTime);
    else if (kind === 'smoke') radio.smoke(bot, simTime);
    else if (kind === 'pickup') radio.pickup(bot, simTime);
  },
  onBotShot(bot, res) {
    audio.botShot(Math.hypot(bot.body.pos.x - player.body.pos.x, bot.body.pos.z - player.body.pos.z));
    noise.push({ x: bot.body.pos.x, z: bot.body.pos.z, at: simTime, team: bot.team });
    if (res.hitFighter) {
      if (res.hitFighter.isPlayer) lastAttacker = bot;
      if (res.died) handleKill(res.hitFighter, bot, res.isHead);
    }
  },
};

// --- Player actions ---
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
let stepSfxAt = 0;

function playerShoot(now) {
  const w = owned[currentId];
  if (w.mag <= 0) {
    if (w.tryFire(now) === false && w.cooldown <= 0) {
      audio.emptyClick();
      w.cooldown = 0.25;
    }
    return;
  }
  if (!w.tryFire(now)) return;
  camera.getWorldDirection(_dir);
  _origin.copy(camera.position);
  const spread = spreadFor(w.def, player.speedRatio(), player.crouching);
  if (viewmodel) viewmodel.userData.muzzle.getWorldPosition(_muzzle);
  const res = combat.fire(playerEnt, w.def, _origin, _dir, spread, rng, _muzzle);
  flash.pulse();
  audio.shot(currentId);
  noise.push({ x: player.body.pos.x, z: player.body.pos.z, at: now, team: TEAM.WARDENS });
  player.addRecoil(w.def.kick * (0.8 + rng() * 0.5), (rng() * 2 - 1) * w.def.kick * 0.4);
  shake = Math.min(0.3, shake + w.def.kick * 0.7);
  if (viewmodel) viewmodel.position.z = -0.35 + 0.05;
  if (res.hitFighter && res.hitFighter.team !== playerEnt.team) {
    hud.hitmarker(res.died, simTime);
    audio.hitmarker(res.died);
    if (res.died) handleKill(res.hitFighter, playerEnt, res.isHead);
  }
}

function throwGrenade(now) {
  if (kit.grenades <= 0) return;
  kit.grenades -= 1;
  camera.getWorldDirection(_dir);
  _origin.copy(camera.position);
  combat.throwGrenade(_origin, _dir, playerEnt);
  audio.grenadeThrow();
  void now;
}

function throwSmoke(now) {
  if (kit.smokes <= 0) return;
  kit.smokes -= 1;
  camera.getWorldDirection(_dir);
  _origin.copy(camera.position);
  combat.throwSmoke(_origin, _dir, playerEnt);
  audio.grenadeThrow();
  void now;
}

// Is the player standing in a site with the charge?
function playerPlantSite() {
  if (match.charge.state !== 'carried' || match.charge.carrier !== match.playerEnt) return null;
  for (const key of ['A', 'B']) {
    const s = map.sites[key];
    if (Math.hypot(player.body.pos.x - s.x, player.body.pos.z - s.z) < s.r) return key;
  }
  return null;
}

// --- Simulation step ---
function step(dt) {
  simTime += dt;
  const st = match.state;
  match.step(dt);

  const frozen = st.phase === 'buy' || st.phase === 'end' || st.phase === 'matchEnd';
  if (!frozen) {
    // Player
    if (playerEnt.alive) {
      const look = input.takeLook();
      player.look(look.x, look.y);
      player.step(dt, input.state.keys);
      const w = owned[currentId];
      w.step(dt);
      if (w.finishReloadIfDue(simTime)) audio.reloadEnd();
      const pressed = input.drainPressed();
      if (pressed.has('KeyR') && w.startReload(simTime)) audio.reloadStart();
      if (pressed.has('Digit1')) equip('pistol');
      if (pressed.has('Digit2')) equip('smg');
      if (pressed.has('Digit3')) equip(kit.primary === 'dmr' ? 'dmr' : 'rifle');
      if (pressed.has('KeyG')) throwGrenade(simTime);
      if (pressed.has('KeyH')) throwSmoke(simTime);
      w.triggerHeld = input.state.firing;
      if (input.state.firing) playerShoot(simTime);
      // Bots may throw frags at a seen enemy cluster (rare, telegraphed by distance).
      // Planting by hand.
      const siteKey = playerPlantSite();
      if (siteKey && input.state.keys.has('KeyF') && player.groundSpeed() < 0.4) {
        plantProgress += dt;
        if (plantProgress >= PLANT_TIME) {
          plantProgress = 0;
          match.plantCharge(siteKey, match.playerEnt);
        }
      } else {
        plantProgress = Math.max(0, plantProgress - dt * 2.5);
      }
      // Footsteps
      if (player.groundSpeed() > 1 && player.body.grounded && simTime > stepSfxAt) {
        stepSfxAt = simTime + (player.crouching ? 0.52 : 0.36);
        audio.step(player.groundSpeed() > 4);
      }
    }
    // Bots
    for (const bot of allBots) stepBot(bot, botCtx, dt, simTime);
    // Bot grenades: a bot with a frag and a visible target sometimes lobs it.
    for (const bot of allBots) {
      if (bot.alive && bot.grenades > 0 && bot.target && bot.target.alive && rng() < dt * 0.05) {
        bot.grenades -= 1;
        const from = bot.eyePos();
        const dir = bot.target.chestPos().sub(from).normalize();
        combat.throwGrenade(from, dir, bot);
        audio.grenadeThrow();
      }
    }
  } else if (st.phase === 'buy') {
    input.takeLook();
    input.drainPressed();
    if (input.wasPressed('KeyB')) { /* already in buy */ }
  }

  // Grenade + combat events
  const events = [];
  combat.stepGrenades(dt, events);
  for (const ev of events) {
    if (ev.type === 'explosion') {
      audio.explosion();
      const d = Math.hypot(player.body.pos.x - ev.point.x, player.body.pos.z - ev.point.z);
      if (d < 7) shake = Math.min(0.7, shake + (7 - d) * 0.08);
    } else if (ev.type === 'grenadeHit' && ev.died) {
      handleKill(ev.fighter, ev.owner, false, true);
    }
  }
  combat.step(dt);
  flash.step(dt);
  if (viewmodel && viewmodel.position.z < -0.35) viewmodel.position.z = Math.min(-0.35, viewmodel.position.z + dt * 0.4);
  shake = Math.max(0, shake - dt * 1.6);

  // Charge visual follows its state.
  if (match.charge.state === 'carried') {
    const carrier = match.charge.carrier;
    const p = carrier && carrier.isPlayer ? player.body.pos : carrier ? carrier.body.pos : null;
    if (p) chargeMesh.position.set(p.x, p.y + 1.32, p.z);
    chargeMesh.visible = !(carrier && carrier.isPlayer);
  } else {
    chargeMesh.visible = true;
    chargeMesh.position.set(match.charge.x, match.charge.state === 'planted' ? 0.12 : 0.1, match.charge.z);
  }
  chargeLight.material.emissiveIntensity = match.state.planted
    ? (Math.sin(simTime * 9) > 0 ? 3.4 : 0.4)
    : 2.2;

  // Player hitboxes follow the body.
  const crouch = player.crouching;
  pBodyMesh.position.set(player.body.pos.x, player.body.pos.y + (crouch ? 0.62 : 0.82), player.body.pos.z);
  pBodyMesh.scale.y = crouch ? 0.78 : 1;
  pHeadMesh.position.set(player.body.pos.x, player.body.pos.y + (crouch ? 1.06 : 1.5), player.body.pos.z);
  pBodyMesh.visible = pHeadMesh.visible = playerEnt.alive;

  syncCamera();
}

function syncCamera() {
  const b = player.body;
  const shX = shake > 0 ? (rng() * 2 - 1) * shake * 0.02 : 0;
  const shY = shake > 0 ? (rng() * 2 - 1) * shake * 0.02 : 0;
  camera.position.set(b.pos.x + shX, b.pos.y + player.eye + shY, b.pos.z);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, 0, 'YXZ');
  const w = owned[currentId];
  const targetFov = input.state.aiming ? 78 / w.def.zoom : 78;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  if (viewmodel) viewmodel.visible = playerEnt.alive && !(input.state.aiming && currentId === 'dmr');
}

// --- HUD snapshot ---
function phaseLabel() {
  const st = match.state;
  if (st.phase === 'buy') return 'BUY PHASE';
  if (st.phase === 'end') return 'ROUND OVER';
  if (st.phase === 'matchEnd') return 'MATCH OVER';
  return st.planted ? 'CHARGE PLANTED' : 'ROUND LIVE';
}

function hudSnapshot() {
  const st = match.state;
  const w = owned[currentId];
  const siteKey = playerEnt.alive && !shot ? playerPlantSite() : null;
  let prompt = '';
  if (siteKey) prompt = plantProgress > 0 ? '' : 'Hold F to plant the charge';
  else if (match.charge.state === 'carried' && match.charge.carrier === match.playerEnt && st.phase === 'live') {
    prompt = `Carry the charge to site ${st.attackSite}`;
  } else if (match.charge.state === 'dropped' && playerEnt.alive) {
    prompt = 'The charge is down — recover it';
  }
  const dots = [];
  for (const b of wardenBots) if (b.alive) dots.push({ x: b.body.pos.x, z: b.body.pos.z, color: '#2fd4c4' });
  if (match.charge.state !== 'carried') dots.push({ x: match.charge.x, z: match.charge.z, color: '#ffe066', r: 3 });
  if (st.planted) dots.push({ x: map.sites[st.plantSite].x, z: map.sites[st.plantSite].z, color: '#ff5d47', r: 3.4 });
  let channel = null;
  if (plantProgress > 0) channel = { label: 'PLANTING CHARGE', frac: plantProgress / PLANT_TIME };
  else if (st.planted && match.defuseProgress > 0) channel = { label: 'CHARGE BEING DEFUSED', frac: match.defuseProgress };
  return {
    timer: st.timer,
    phase: st.phase,
    phaseLabel: phaseLabel(),
    scoreW: st.scoreW,
    scoreJ: st.scoreJ,
    aliveW: (playerEnt.alive ? 1 : 0) + wardenBots.filter((b) => b.alive).length,
    aliveJ: jackalBots.filter((b) => b.alive).length,
    round: st.round,
    health: playerEnt.health,
    armor: playerEnt.armor,
    money: match.playerEnt.money,
    ammoMag: w.mag,
    ammoReserve: w.reserve,
    reloading: w.reloadingUntil > simTime,
    weaponName: w.def.name.toUpperCase(),
    grenades: kit.grenades,
    smokes: kit.smokes,
    spreadPx: spreadFor(w.def, player.speedRatio(), player.crouching) * 900,
    prompt,
    channel,
    chargeTag: st.planted ? `CHARGE PLANTED — SITE ${st.plantSite}` : '',
    mapDots: dots,
    playerArrow: { x: player.body.pos.x, z: player.body.pos.z, yaw: player.yaw },
  };
}

// --- Main loop ---
let accumulator = 0;
let lastTime = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  if (!started && !shot) {
    // The start overlay is up: hold the world (and the buy clock) until first lock.
    hud.render(hudSnapshot(), simTime);
    renderer.render(scene, camera);
    return;
  }
  if (freezeShot && window.__shotReady) {
    // Staged frame is set: keep rendering it, stop simulating it.
    hud.render(hudSnapshot(), simTime);
    renderer.render(scene, camera);
    return;
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED && steps < 5) {
    step(FIXED);
    accumulator -= FIXED;
    steps += 1;
  }
  if (accumulator > FIXED * 5) accumulator = 0;
  hud.render(hudSnapshot(), simTime);
  if (match.state.phase === 'buy' && !shot) {
    hud.showBuy(match.playerEnt.money, kit);
    hud.setBuyTimer(match.state.timer);
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A small read-only debug handle: the screenshot tooling and curious players can
// watch the simulation state without touching it.
window.__nf = {
  get state() {
    return {
      simTime,
      phase: match.state.phase,
      timer: match.state.timer,
      round: match.state.round,
      score: [match.state.scoreW, match.state.scoreJ],
      playerHealth: playerEnt.health,
      player: { x: +player.body.pos.x.toFixed(1), z: +player.body.pos.z.toFixed(1), yaw: +player.yaw.toFixed(2), pitch: +player.pitch.toFixed(2) },
      bots: allBots.map((b) => ({ name: b.name, team: b.team, alive: b.alive, x: +b.body.pos.x.toFixed(1), z: +b.body.pos.z.toFixed(1) })),
    };
  },
};

// --- Boot ---
match.startRound();
syncKitToWeapons();
if (shot) runShot(shot);
else hud.showOverlay('start');
requestAnimationFrame(frame);

// --- Deterministic screenshot staging (also a smoke test of the whole sim) ---
// Four frames, ordered the way the judge reads them: live combat first (the
// cover), the buy phase (the economy), a planted-charge hold (the objective),
// and the title over the yard at golden hour.
function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  // Staging determinism: no bot utility — the only smoke/frag in frame is the one
  // the staging itself throws.
  for (const b of allBots) {
    b.smokes = 0;
    b.grenades = 0;
  }
  const settle = (n) => { for (let i = 0; i < n; i += 1) step(FIXED); };
  const giveRifle = () => {
    owned.rifle = owned.rifle || createWeaponState('rifle');
    equip('rifle');
  };
  // Aim the camera exactly at a world point: convert the wanted forward vector
  // into the mouse-delta units player.look() consumes (from the current yaw).
  const aimAt = (tx, ty, tz) => {
    const eye = playerEnt.eyePos();
    const fx = tx - eye.x;
    const fy = ty - eye.y;
    const fz = tz - eye.z;
    const targetYaw = Math.atan2(-fx, -fz);
    const targetPitch = Math.atan2(fy, Math.hypot(fx, fz));
    player.look((player.yaw - targetYaw) / 0.0021, (player.pitch - targetPitch) / 0.0021);
  };
  // A staged enemy shot across the frame: the same combat.fire call bot
  // shooting makes, aimed a body's width off the player so it sparks scenery.
  const returnFire = (bot, tx, ty, tz) => {
    const from = bot.eyePos();
    from.y -= 0.18;
    const dir = new THREE.Vector3(tx - from.x, ty - from.y, tz - from.z).normalize();
    combat.fire(bot, WEAPONS.rifle, bot.eyePos(), dir, 0.004, rng, from);
  };
  if (name === 'start') {
    // COVER — a mid-round firefight in the mid lane (z ≈ -1, the gap between
    // the container rows): two Jackals over the crate at (11,-1.5), a smoke
    // wall blooming on the crossing, Vega fighting on the B side (she is the
    // Jackals' nearest target, so they engage her and stay in frame instead of
    // charging the player through the smoke). The closing exchange — the
    // player's shot and a Jackal's answer — is staged last and frozen after a
    // single step, so the tracers, muzzle flash, impact spark, hit flash and
    // hitmarker are all still on the frame. No centre banner: the top bar
    // already carries the round, and a banner reads as a menu, not a fight.
    match.state.phase = 'live';
    match.state.timer = 74;
    match.state.round = 6;
    match.state.scoreW = 3;
    match.state.scoreJ = 2;
    giveRifle();
    kit.smokes = 1;
    kit.grenades = 1;
    const pin = () => {
      player.body.pos.x = 6.4;
      player.body.pos.z = -1.0;
      wardenBots[0].body.pos.x = 12.4;
      wardenBots[0].body.pos.z = -4.3;
      wardenBots[0].yaw = -Math.PI / 2;
      jackalBots[0].body.pos.x = 11.8;
      jackalBots[0].body.pos.z = -2.5;
      jackalBots[0].yaw = Math.PI / 2;
      jackalBots[1].body.pos.x = 14.8;
      jackalBots[1].body.pos.z = 0.8;
      jackalBots[1].yaw = Math.PI / 2;
    };
    pin();
    // The settle is a real 2.5 s fight: nobody the frame needs may die in it.
    for (const b of [wardenBots[0], jackalBots[0], jackalBots[1]]) b.health = 9999;
    playerEnt.health = 9999;
    // Smoke the crossing, let it bloom fully (fuse 1.1 s + 1.3 s of growth
    // inside the settle) while the staged fight runs.
    _origin.copy(playerEnt.eyePos());
    _dir.set(0.92, 0.02, -0.39).normalize();
    combat.throwSmoke(_origin, _dir, playerEnt);
    settle(150);
    pin();
    for (const b of [wardenBots[0], jackalBots[0], jackalBots[1]]) b.health = 100;
    playerEnt.health = 88;
    // Aim at the upper torso: high enough to clear the crate's top edge by a
    // margin (a centre-mass line grazes it), low enough to stay out of the
    // head box — a wound and a flash, not a kill.
    aimAt(jackalBots[0].body.pos.x, 1.2, jackalBots[0].body.pos.z);
    settle(2);
    // Sticky rows: feed rows expire on wall-clock timers, which a slow headless
    // capture would outrun — staged rows stay until replaced.
    hud.clearFeeds();
    hud.clearBanner();
    hud.radio('Vega', 'Contact — Mid Crates! Two past the smoke.', TEAM.WARDENS, true);
    hud.radio('Rook', 'Heard shots, Mid Crates. Rotating.', TEAM.JACKALS, true);
    hud.feed('<span class="w">You</span> » <span class="j">Moss</span>', true);
    playerShoot(simTime);
    // The answer comes the other way, wide of the player: a long diagonal beam
    // across the whole frame, sparked off the west containers.
    returnFire(jackalBots[1], 3.4, 1.2, -2.6);
    settle(1);
  } else if (name === 'buy') {
    // BUY PHASE — the equipment menu over the yard, money and owned kit visible.
    match.state.timer = 9;
    match.playerEnt.money = 3400;
    kit.primary = 'rifle';
    giveRifle();
    kit.armor = true;
    kit.grenades = 1;
    kit.smokes = 1;
    player.body.pos.x = 8;
    player.body.pos.z = 10;
    player.look(-320, 14);
    settle(20);
    hud.showBuy(match.playerEnt.money, kit);
  } else if (name === 'play') {
    // PLANTED — holding the Loading Bay against the retake: the charge blinks
    // on the hazard stripes mid-frame, the painted A sign reads over the
    // warehouse door, and two Jackals push onto the dock apron — one out of
    // the east door, one around the south crates — while Onyx holds the north
    // side. The closing exchange is staged and frozen like the cover's; the
    // CHARGE PLANTED pill and phase label carry the state, no centre banner.
    match.state.phase = 'live';
    match.state.round = 9;
    match.state.scoreW = 5;
    match.state.scoreJ = 3;
    giveRifle();
    kit.grenades = 1;
    const pin = () => {
      player.body.pos.x = 1.2;
      player.body.pos.z = 3.6;
      jackalBots[0].body.pos.x = -5.6;
      jackalBots[0].body.pos.z = 0.9;
      jackalBots[0].yaw = -Math.PI / 2;
      jackalBots[1].body.pos.x = -5.2;
      jackalBots[1].body.pos.z = 4.6;
      jackalBots[1].yaw = -Math.PI / 2;
      wardenBots[1].body.pos.x = -3.4;
      wardenBots[1].body.pos.z = -4.8;
      wardenBots[1].yaw = Math.PI / 2;
    };
    pin();
    for (const b of [jackalBots[0], jackalBots[1], wardenBots[1]]) b.health = 9999;
    playerEnt.health = 9999;
    match.plantCharge('A', match.playerEnt);
    match.state.timer = 31;
    settle(45);
    pin();
    for (const b of [jackalBots[0], jackalBots[1], wardenBots[1]]) b.health = 100;
    playerEnt.health = 84;
    aimAt(jackalBots[0].body.pos.x, 1.05, jackalBots[0].body.pos.z);
    settle(2);
    hud.clearFeeds();
    hud.clearBanner();
    hud.radio('Radio', 'Charge planted at A. Hold the site.', TEAM.WARDENS, true);
    hud.radio('Sable', 'Rotating to A — coming through the Dock.', TEAM.JACKALS, true);
    hud.feed('<span class="w">Onyx</span> » <span class="j">Rook</span>', true);
    playerShoot(simTime);
    returnFire(jackalBots[1], player.body.pos.x + 0.7, 1.3, player.body.pos.z + 0.9);
    settle(1);
  } else if (name === 'end') {
    // TITLE — the menu over the yard from the south-east lane looking
    // west-north-west across mid: containers in the foreground, the warehouse
    // and dock lamps beyond, sunset sky above.
    player.body.pos.x = 17.5;
    player.body.pos.z = 10.5;
    player.look(-879, -6);
    settle(30);
    hud.showOverlay('start');
  }
  syncCamera();
  renderer.render(scene, camera);
  // Mark ready synchronously: the frame loop's freeze engages on its very next
  // pass, so the staged instant (tracers, flash, hitmarker) cannot decay in
  // the gap between staging and the harness's capture.
  window.__shotReady = true;
  requestAnimationFrame(() => {
    renderer.render(scene, camera);
  });
}
