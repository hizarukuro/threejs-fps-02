// Weapon definitions and the first-person viewmodel. Damage, spread and price live in
// one table; the same table drives bot guns, so both sides play by the same numbers.
// Spread is in radians and grows hard with movement: standing or crouching is accurate,
// running is not — that is the tactical heart of the game.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 3.0,
    rpm: 380, mag: 12, reserveStart: 48, reloadMs: 1400,
    spreadBase: 0.007, spreadMove: 0.030, spreadCrouch: 0.004,
    falloffStart: 14, auto: false, zoom: 1.0, kick: 0.010,
  },
  smg: {
    id: 'smg', name: 'Raptor SMG', price: 900, damage: 21, headMult: 3.0,
    rpm: 820, mag: 30, reserveStart: 90, reloadMs: 1900,
    spreadBase: 0.013, spreadMove: 0.042, spreadCrouch: 0.009,
    falloffStart: 12, auto: true, zoom: 1.0, kick: 0.007,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Carbine', price: 2400, damage: 34, headMult: 3.0,
    rpm: 600, mag: 30, reserveStart: 90, reloadMs: 2200,
    spreadBase: 0.0035, spreadMove: 0.052, spreadCrouch: 0.002,
    falloffStart: 22, auto: true, zoom: 1.12, kick: 0.013,
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', price: 3200, damage: 72, headMult: 2.5,
    rpm: 95, mag: 6, reserveStart: 24, reloadMs: 2600,
    spreadBase: 0.0008, spreadMove: 0.060, spreadCrouch: 0.0004,
    falloffStart: 40, auto: false, zoom: 2.1, kick: 0.030,
  },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'dmr'];
export const ARMOR_PRICE = 650;
export const GRENADE_PRICE = 300;
export const SMOKE_PRICE = 300;

export function spreadFor(def, speedRatio, crouching) {
  const base = crouching ? def.spreadCrouch : def.spreadBase;
  return base + def.spreadMove * speedRatio * speedRatio;
}

export function damageAt(def, dist, isHead) {
  let dmg = def.damage * (isHead ? def.headMult : 1);
  if (dist > def.falloffStart) {
    dmg *= Math.max(0.45, 1 - (dist - def.falloffStart) * 0.008);
  }
  return dmg;
}

// One weapon instance: magazine, reserve, cooldowns. Pure state, no rendering.
export function createWeaponState(id) {
  const def = WEAPONS[id];
  return {
    def,
    mag: def.mag,
    reserve: def.reserveStart,
    cooldown: 0,
    reloadingUntil: 0,
    triggerHeld: false,
    shotsFired: 0,
    tryFire(now) {
      if (now < this.reloadingUntil) return false;
      if (this.cooldown > 0) return false;
      if (this.mag <= 0) return false;
      if (!def.auto && this.triggerHeld) return false;
      this.mag -= 1;
      this.shotsFired += 1;
      this.cooldown = 60 / def.rpm;
      return true;
    },
    startReload(now) {
      if (this.mag >= def.mag || this.reserve <= 0 || now < this.reloadingUntil) return false;
      this.reloadingUntil = now + def.reloadMs / 1000;
      return true;
    },
    finishReloadIfDue(now) {
      if (this.reloadingUntil && now >= this.reloadingUntil) {
        const take = Math.min(def.mag - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloadingUntil = 0;
        return true;
      }
      return false;
    },
    step(dt) {
      if (this.cooldown > 0) this.cooldown -= dt;
    },
  };
}

// --- Viewmodel: a low, dark gun built from boxes, parented to the camera. ---
const gunMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.55, metalness: 0.6 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.85 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x3d434c, roughness: 0.4, metalness: 0.7 }),
};

export function buildViewmodel(weaponId) {
  const g = new THREE.Group();
  const def = WEAPONS[weaponId];
  const long = weaponId === 'dmr' ? 0.62 : weaponId === 'pistol' ? 0.26 : 0.48;
  const add = (w, h, d, x, y, z, mat = gunMats.body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  add(0.075, 0.11, long, 0, 0, -long / 2); // receiver
  add(0.05, 0.05, long * 0.55, 0, 0.045, -long - long * 0.2, gunMats.accent); // barrel shroud
  add(0.06, 0.16, 0.09, 0, -0.12, -0.06, gunMats.grip); // grip
  if (weaponId !== 'pistol') add(0.05, 0.17, 0.08, 0, -0.13, -long * 0.45, gunMats.grip); // magazine
  if (def.zoom > 1.5) add(0.045, 0.07, 0.16, 0, 0.1, -0.12, gunMats.accent); // scope
  else add(0.02, 0.05, 0.03, 0, 0.085, -long * 0.7, gunMats.accent); // front post
  // Muzzle reference point for flash placement.
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -long - long * 0.45);
  g.add(muzzle);
  g.position.set(0.24, -0.22, -0.35);
  g.userData.muzzle = muzzle;
  return g;
}

// Muzzle flash: a shared additive sprite + point light, pulsed by combat.
export function createMuzzleFlash(camera) {
  const mat = new THREE.SpriteMaterial({
    color: 0xffc36b, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.34, 0.34, 1);
  const light = new THREE.PointLight(0xffb45e, 0, 9, 2);
  return {
    attach(viewmodel) {
      const muzzle = viewmodel.userData.muzzle;
      muzzle.add(sprite);
      muzzle.add(light);
    },
    pulse() {
      mat.opacity = 0.95;
      light.intensity = 26;
      sprite.material.rotation = Math.random() * Math.PI;
    },
    step(dt) {
      if (mat.opacity > 0) mat.opacity = Math.max(0, mat.opacity - dt * 14);
      if (light.intensity > 0) light.intensity = Math.max(0, light.intensity - dt * 300);
    },
  };
}
