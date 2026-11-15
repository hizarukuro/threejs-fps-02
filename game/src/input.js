// Keyboard + mouse state and pointer lock. The simulation reads `keys` and drains the
// look delta once a frame; nothing here knows about the game.
export function createInput(domElement, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered, drained by the reader
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });
  domElement.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === domElement;
    if (!locked) {
      firing = false;
      aiming = false;
    }
    onLockChange(locked);
  });

  return {
    state: { keys, get firing() { return firing; }, get aiming() { return aiming; }, get locked() { return locked; } },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    drainPressed() {
      const out = new Set(pressed);
      pressed.clear();
      return out;
    },
    requestLock() {
      domElement.requestPointerLock();
    },
  };
}
