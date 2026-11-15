// Procedural canvas textures: the game ships no image files. Every surface is painted
// once at boot into a small canvas and reused as a repeating texture.
import * as THREE from 'three';

function canvasTexture(size, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function speckle(ctx, size, base, flecks, count, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = flecks[i % flecks.length];
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

export function makeTextures() {
  const asphalt = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#35322e', ['#2b2925', '#403d37', '#48443c'], 2600, 0.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  }, 24, 18);

  const concrete = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#83868a', ['#76797d', '#93969a', '#6b6e72'], 1500, 0.45);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, s - 10, s, 10);
  }, 1, 1);

  const containerSide = (hex) => canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, s, s);
    // Corrugation: vertical ribs with a light and a dark edge.
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, 0, 3, s);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + 9, 0, 5, s);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, s, 8);
    ctx.fillRect(0, s - 8, s, 8);
    speckle(ctx, s, 'rgba(0,0,0,0)', ['rgba(30,20,12,0.5)', 'rgba(255,255,255,0.06)'], 260, 0.35);
  }, 2, 1);

  const crate = canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#8a6b42', ['#795c36', '#9a7a4e'], 500, 0.5);
    ctx.strokeStyle = 'rgba(40,26,10,0.65)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, s);
    ctx.moveTo(s, 0);
    ctx.lineTo(0, s);
    ctx.stroke();
  }, 1, 1);

  const metal = canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#707a84', ['#646e78', '#7e8892'], 700, 0.4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const [x, y] of [[8, 8], [s - 8, 8], [8, s - 8], [s - 8, s - 8]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 1, 1);

  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#22242a';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, s);
      ctx.lineTo(x + 16 + s, 0);
      ctx.lineTo(x + s, 0);
      ctx.fill();
    }
  }, 3, 1);

  // Painted site roundel, drawn on a transparent ground decal.
  const siteMark = (letter, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 128, 104, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '700 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 136);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };

  // Painted wall sign: dark board, big site letter, the site's name under it.
  const signBoard = (letter, name, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#22242a';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, 488, 232);
    ctx.fillStyle = color;
    ctx.font = '700 120px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, 256, 138);
    ctx.fillStyle = '#eef0ea';
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.fillText(name.toUpperCase(), 256, 208);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };

  return { asphalt, concrete, containerSide, crate, metal, hazard, siteMark, signBoard };
}
