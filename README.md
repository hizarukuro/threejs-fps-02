# Night Freight — threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the browser, built on three.js 0.187.0. **Night Freight** is set in Vesper Yard, a freight depot at golden hour: your five **Haulers** carry a charge into the yard against five defending **Jackals**. Plant the charge at the Loading Bay or the Fuel Yard — or eliminate the defence — before the round clock runs out. First to 7 rounds takes the match, at most 12.

Everything is original: the map, the names, the art (procedural canvas textures), and every sound (synthesized WebAudio) are made for this game. It runs fully offline from static files — no build step, no network requests.

## Play it

```sh
node serve.ts          # then open http://localhost:8080
```

Any static file server pointed at `game/` works the same. Click to lock the mouse and play.

| Key | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Click / right-click | Fire / aim (DMR scopes in) |
| R · 1–3 | Reload · switch weapon |
| Ctrl · Shift · Space | Crouch · walk quiet · jump |
| F (hold, on a site) | Plant the charge |
| G / H | Throw a frag grenade / a smoke canister |
| B | Buy menu during the buy phase |

## The tactical rules

- **Accuracy is a position, not a reflex.** Spread blooms hard while moving and shrinks to a point standing still or crouched. Headshots triple damage; the VK-7 kills in one.
- **Money between rounds.** Kills, plants and round wins pay; the buy phase sells an SMG, a carbine, a DMR, kevlar, frag grenades and smoke canisters. Die and your primary is gone.
- **Smoke is a wall you can throw.** A smoke canister blooms into a cloud that blocks sight for bots and players alike — cross behind it, or plant inside it. Attackers smoke their own crossings; defenders smoke the gate.
- **Bots play the objective — and say so.** Defenders hold both sites, rotate on the plant and defuse under fire; attackers push a site together, recover the charge when its carrier drops, and plant it themselves if you fall. The squad talks on the radio: round plans, contact calls with map callouts ("Contact — Mid Crates!"), rotations, plant and defuse warnings.
- **Sound is information.** Bots hear gunfire and hunt the last known position — and call that out too.

## Layout

- `main.ts` — the entry program: copies `game/` + `screenshots/` to the output and writes `dossier.json` via `vendor/makefun-threejs.ts` (the kit's library, unchanged).
- `game/index.html` — the page, HUD and menus; one import map pins `three` to the vendored 0.187.0 build in `game/vendor/three/`.
- `game/src/` — one module per job: `map` (Vesper Yard + waypoint graph + callouts), `physics` (shared capsule/AABB movement), `player`, `bots` (perception, orders, gunplay, nameplates), `rounds` (phases, economy, plant/defuse), `weapons`, `combat` (hitscan, tracers, frag + smoke grenades), `radio` (team callouts), `audio` (synthesized SFX), `hud`, `textures`, `palette`, `input`, `main` (fixed-step loop).
- `screenshots/` — four renders of the game itself, staged with `?shot=start|buy|play|end`.

The simulation runs at a fixed 60 Hz, decoupled from rendering; hot loops reuse pooled objects throughout.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=c23ct4sn&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
