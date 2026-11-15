// NIGHT FREIGHT — entry program for make.fun threejs-fps-02 (Node 22, stdlib only).
// The game itself is the static site under game/ (ES modules, vendored three.js, no
// build step, no network). This program hands it in: it copies game/ and screenshots/
// into the output directory and writes dossier.json with the kit's own library, byte
// for byte the way the scorer rebuilds it.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   node serve.ts            → play at http://localhost:8080

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// Caps mirror reference/gate.json so this program refuses anything the scorer would:
// at most 993 entries and 48 MiB under game/, at most 4 screenshots of 256 KiB each,
// and the dossier text capped at 163,840 bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
console.log(`night-freight: game + screenshots + dossier.json written to ${out}`);
