// Shared body physics for the player and every bot: a vertical capsule treated as a
// circle in plan view, resolved per axis against the map's AABBs. Low boxes (crates,
// the dock slab) are floors you can step or jump onto, not walls.
export const STEP_HEIGHT = 0.55;
export const GRAVITY = 22;

export function floorHeightAt(colliders, x, z, currentY) {
  let floor = 0;
  for (const c of colliders) {
    if (x > c.minX - 0.01 && x < c.maxX + 0.01 && z > c.minZ - 0.01 && z < c.maxZ + 0.01) {
      // A box is a floor when its top is at or below where the body already stands.
      if (c.h <= currentY + STEP_HEIGHT && c.h > floor) floor = c.h;
    }
  }
  return floor;
}

function collideAxis(colliders, body, axis) {
  const r = body.radius;
  for (const c of colliders) {
    if (c.h <= body.pos.y + STEP_HEIGHT) continue; // steppable: not a wall at this height
    if (c.y0 !== undefined && c.y0 >= body.pos.y + 1.7) continue; // overhead (roof slab)
    const nearX = Math.max(c.minX, Math.min(body.pos.x, c.maxX));
    const nearZ = Math.max(c.minZ, Math.min(body.pos.z, c.maxZ));
    const dx = body.pos.x - nearX;
    const dz = body.pos.z - nearZ;
    if (dx * dx + dz * dz < r * r) {
      if (axis === 'x') body.pos.x = body.pos.x < (c.minX + c.maxX) / 2 ? c.minX - r : c.maxX + r;
      else body.pos.z = body.pos.z < (c.minZ + c.maxZ) / 2 ? c.minZ - r : c.maxZ + r;
    }
  }
}

// Move a body by (dx, dz) with collision, then settle vertical motion. Bodies are
// { pos:{x,y,z}, vy, radius, grounded }.
export function moveBody(colliders, body, dx, dz, dt) {
  body.pos.x += dx;
  collideAxis(colliders, body, 'x');
  body.pos.z += dz;
  collideAxis(colliders, body, 'z');
  body.pos.x = Math.max(-33.4, Math.min(33.4, body.pos.x));
  body.pos.z = Math.max(-23.4, Math.min(23.4, body.pos.z));

  body.vy -= GRAVITY * dt;
  body.pos.y += body.vy * dt;
  const floor = floorHeightAt(colliders, body.pos.x, body.pos.z, body.pos.y);
  if (body.pos.y <= floor) {
    body.pos.y = floor;
    body.vy = 0;
    body.grounded = true;
  } else {
    body.grounded = body.pos.y - floor < 0.02;
  }
}
