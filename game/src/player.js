// The local player's body: acceleration-based movement on the shared physics, mouse
// look, crouch and jump. Standing still or crouching is what makes shots accurate —
// weapons.js reads speedRatio() and crouching to size the spread.
import { moveBody } from './physics.js';

const WALK_SPEED = 5.1;
const CROUCH_SPEED = 2.2;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 6;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;

export function createPlayer(colliders, spawn) {
  const body = {
    pos: { x: spawn[0], y: 0, z: spawn[1] },
    vy: 0,
    radius: 0.42,
    grounded: true,
  };
  const vel = { x: 0, z: 0 };
  let yaw = -Math.PI / 4; // face north-east, into the yard
  let pitch = 0;
  let crouching = false;
  let eye = EYE_STAND;
  let recoilPitch = 0;
  let recoilYaw = 0;

  function reset(at) {
    body.pos.x = at[0];
    body.pos.z = at[1];
    body.pos.y = 0;
    body.vy = 0;
    vel.x = 0;
    vel.z = 0;
    yaw = -Math.PI / 4;
    pitch = 0;
    recoilPitch = 0;
    recoilYaw = 0;
  }

  function look(dx, dy) {
    const S = 0.0021;
    yaw -= dx * S;
    pitch -= dy * S;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
  }

  function step(dt, keys) {
    crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const targetEye = crouching ? EYE_CROUCH : EYE_STAND;
    eye += (targetEye - eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Yaw 0 looks down -Z; forward vector is (-sin, -cos) in plan view.
    let wishX = (-sin * forward + cos * strafe);
    let wishZ = (-cos * forward - sin * strafe);
    const len = Math.hypot(wishX, wishZ);
    if (len > 0) {
      wishX /= len;
      wishZ /= len;
    }
    const walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = crouching ? CROUCH_SPEED : walking ? 2.4 : WALK_SPEED;
    const accel = body.grounded ? ACCEL_GROUND : ACCEL_AIR;
    vel.x += wishX * accel * dt;
    vel.z += wishZ * accel * dt;
    const vLen = Math.hypot(vel.x, vel.z);
    if (vLen > speed) {
      vel.x = (vel.x / vLen) * speed;
      vel.z = (vel.z / vLen) * speed;
    }
    if (len === 0 && body.grounded) {
      // Friction: bleed speed fast so stopping to shoot is snappy.
      const f = Math.max(0, 1 - dt * 10);
      vel.x *= f;
      vel.z *= f;
    }
    if (keys.has('Space') && body.grounded && !crouching) {
      body.vy = 6.6;
      body.grounded = false;
    }
    moveBody(colliders, body, vel.x * dt, vel.z * dt, dt);
    // Recoil recovers toward zero; the camera reads yaw/pitch + recoil.
    recoilPitch *= Math.max(0, 1 - dt * 9);
    recoilYaw *= Math.max(0, 1 - dt * 9);
  }

  return {
    body,
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get eye() { return eye; },
    get crouching() { return crouching; },
    get recoilPitch() { return recoilPitch; },
    get recoilYaw() { return recoilYaw; },
    speedRatio() {
      return Math.min(1, Math.hypot(vel.x, vel.z) / WALK_SPEED);
    },
    groundSpeed() {
      return Math.hypot(vel.x, vel.z);
    },
    addRecoil(p, y) {
      recoilPitch += p;
      recoilYaw += y;
    },
    look,
    step,
    reset,
  };
}
