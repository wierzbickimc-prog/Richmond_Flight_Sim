# Implementation Plan: Missile Firing & Large Fireball Explosion

## Objective & Verified Current Behavior

**Objective:** Add the ability to fire missiles from either aircraft (Cessna 172 or SR-71). When a missile strikes the ground, spawn a fireball that is approximately 5× the size of a typical game explosion (target: 30 m max radius core, ~40 m particle spread) and is "very easy to see" from the sim's flight envelope (25–520 m AGL).

**Verified current behavior:**
- No projectile, weapon, particle-explosion, or fireball code exists anywhere in the source tree.
- `src/controls.js` maps WASD/arrows to flight input, `KeyB`/`Space` to boost, `KeyF`/`KeyR`/`KeyH`/`KeyM`/`KeyP`/`KeyG` to toggles. No fire key.
- `src/effects.js` contains only the warp-streak line effect (`buildWarpEffect`, `updateWarpEffect`).
- `src/main.js` `animate()` loop calls: `updateFlightModel` → `orientAircraft` → prop/afterburner effects → landmark detection → `hud.update` → shadow tracking → `updateLandmarkGrounding` → `updateWarpEffect` → `updateCamera` → `cesiumWorld.render` → `renderer.render`.
- `cesiumWorld.getGroundHeight(x, z)` is a **synchronous** call (uses `viewer.scene.sampleHeight` or `globe.getHeight` on already-loaded tiles). Suitable for per-frame missile ground queries.
- No test runner is configured (`package.json` scripts: `dev`, `build`, `preview` only). Verification is manual via `npm run dev`.
- Dev-only `window.__sim` handle exposes `flight`, `debug`, `cameraRig`, `toggleBoost`, `toggleAircraft`, `cesiumWorld`.

## Exact Files & Behavioral Contracts to Change

| File | Change |
|------|--------|
| `src/missiles.js` **(new)** | Exports `createMissileSystem(scene, getGroundHeight)` returning `{ fire(origin, forward, speed), update(dt) }`. Internal: missile ballistic integration, ground-collision detection, fireball spawn + animation, cleanup. |
| `src/controls.js` | Add `onFire` callback parameter. Map `KeyX` in the `keydown` switch to call `onFire()`. |
| `src/main.js` | Import `createMissileSystem`. Initialize after scene setup. Pass `onFire` to `createControls`. Call `missileSystem.update(dt)` inside the `started && !paused` block. Expose `missileSystem` on `window.__sim`. |

**Behavioral contract for `src/missiles.js`:**
- `fire(origin: THREE.Vector3, forward: THREE.Vector3, aircraftSpeed: number)` spawns a missile at `origin` with velocity `forward * (aircraftSpeed + 60)`. Respects a 1-second cooldown; returns `false` if on cooldown, `true` if spawned.
- `update(dt: number)` advances all active missiles by gravity (−9.81 m/s² on Y) and velocity each frame. When a missile's Y ≤ `getGroundHeight(x, z)`, it is destroyed and a fireball is spawned at the impact point.
- Fireball: max core radius **30 m**, expansion duration **1.4 s**, particle burst of 60 points spreading to ~40 m over **2.2 s**, a brief `THREE.PointLight` flash (intensity 40, decays to 0 over 0.8 s). All materials use `AdditiveBlending`, `toneMapped: false`, `depthWrite: false`. Removed from scene graph after full lifetime.
- Unlimited missiles (no ammo pool). Cooldown prevents machine-gun spam.

## Ordered Implementation Steps

### Step 1 — Create `src/missiles.js`
1. Define constants: `GRAVITY = 9.81`, `MISSILE_SPEED_BOOST = 60`, `COOLDOWN_S = 1.0`, `FIREBALL_MAX_RADIUS = 30`, `FIREBALL_EXPAND_DURATION = 1.4`, `PARTICLE_COUNT = 60`, `PARTICLE_SPREAD = 40`, `PARTICLE_DURATION = 2.2`, `LIGHT_FLASH_DURATION = 0.8`.
2. `createMissileSystem(scene, getGroundHeight)`:
   - Internal arrays: `missiles[]`, `fireballs[]`.
   - `fire(origin, forward, speed)`: check cooldown timestamp; if ready, push a missile `{ pos: origin.clone(), vel: forward.clone().normalize().multiplyScalar(speed + MISSILE_SPEED_BOOST), mesh: <small cone> }` into `missiles[]` and add mesh to scene. Set cooldown timer.
   - `update(dt)`:
     - For each missile: integrate `vel.y -= GRAVITY * dt`; `pos += vel * dt`; update mesh position/rotation. Query `getGroundHeight(pos.x, pos.z)`. If `pos.y <= groundH`, remove missile mesh, call `spawnFireball(pos, groundH)`.
     - For each fireball: advance age. Core sphere scales from 2 m → `FIREBALL_MAX_RADIUS` (ease-out). Material color lerps white → orange → red → transparent. Opacity fades to 0. Particles update positions (radial burst + gravity). Light intensity decays. When age > `PARTICLE_DURATION`, remove all children from scene, push fireball to GC.
   - `spawnFireball(pos, groundY)`:
     - Create a `THREE.SphereGeometry(1, 24, 18)` scaled per-frame; material: `MeshBasicMaterial({ color: 0xffaa33, transparent, blending: AdditiveBlending, depthWrite: false, toneMapped: false })`.
     - Create `THREE.Points` with 60 vertices at origin; `PointsMaterial({ size: 2.5, color: 0xff6600, transparent, blending: AdditiveBlending, depthWrite: false, toneMapped: false })`. Store per-particle velocity vectors (random sphere directions × random speed 8–25 m/s).
     - Create `THREE.PointLight(0xff8822, 40, 80, 2)`.
     - Group all under a `THREE.Group` at `pos`, add to scene.
3. Export the factory.

### Step 2 — Wire controls (`src/controls.js`)
1. Add `onFire` to the destructured options object.
2. In the `keydown` switch, add `case 'KeyX': onFire && onFire(); break;` (before the `default`).
3. No `keyup` needed (discrete trigger, not hold).

### Step 3 — Integrate in `src/main.js`
1. `import { createMissileSystem } from './missiles.js';`
2. After `const warpEffect = buildWarpEffect(scene);`, add: `const missileSystem = createMissileSystem(scene, getGroundHeight);`
3. In the `createControls({...})` call, add `onFire: () => { missileSystem.fire(flight.position, flight.forward, flight.speed); }`.
4. Inside the `if (started && !paused)` block in `animate()`, after `orientAircraft()`, add: `missileSystem.update(dt);`
5. In the `window.__sim` block, add `missileSystem` to the exported object.

## Scope Boundaries & Safety Constraints

- **No new dependencies.** All geometry is primitive Three.js (`SphereGeometry`, `BufferGeometry` for points, `ConeGeometry` for missile). No GLTF, no shader files, no post-processing chain.
- **No changes to `src/flightModel.js`.** Weapon state (cooldown) lives inside the missile module, not the flight state.
- **No changes to `src/cesiumWorld.js`.** We consume `getGroundHeight(x, z)` as-is.
- **No changes to `public/data/landmarks.json`.**
- **Performance guardrails:** Max 1 active missile at a time (cooldown prevents stacking). Fireball meshes are disposed and removed from scene after their lifetime. No per-frame allocations in the fireball update loop (reuse vectors).
- **Memory safety:** All `THREE.Mesh`, `THREE.Points`, `THREE.PointLight`, `THREE.Group` created during a fireball are removed via `scene.remove(group)` and their geometries/materials `.dispose()`-d at end of life.
- **Both aircraft can fire.** No mode gating.
- **No audio.** The sim has no audio system; adding one is out of scope.

## Tests & Acceptance Criteria

No automated test runner exists. Acceptance is verified via `npm run dev`:

1. **Build check:** `npm run build` completes without errors or warnings about unresolved imports.
2. **Missile fires:** Click "Start Flight", press **X**. A small cone appears at the aircraft nose and accelerates forward+down.
3. **Cooldown:** Rapidly pressing X within 1 s does not spawn a second missile.
4. **Ground impact:** Fly over a terrain patch (~100–300 m AGL), fire. The missile follows a ballistic arc and disappears at the ground surface (not below it, not in the air).
5. **Fireball visibility:** At impact, a large (≥ 30 m radius) orange/white expanding glow is clearly visible from the pilot's cockpit and chase-camera views. It is not clipped by the terrain (additive blending + `depthWrite: false` + high `renderOrder`).
6. **Expansion & fade:** The glow expands smoothly over ~1.4 s, shifts from white-hot to deep orange/red, then fades. Particles scatter outward over ~2 s.
7. **Cleanup:** After ~2.5 s the fireball is fully gone; no lingering geometry (verify via DevTools → Elements → canvas children, or by firing 10+ missiles and confirming FPS does not degrade).
8. **Both aircraft:** Toggle to SR-71 (G), fire, confirm same behavior.
9. **No regression:** Boost (B), camera (F), HUD toggle (H), aircraft toggle (G), pause (P) all still function.

## Discrepancies / Unsupported Claims in the Scout Report

| Scout claim | Actual finding |
|---|---|
| "`window.__sim` (`src/main.js` line ~136)" | The `if (import.meta.env.DEV)` block is at approximately line 196 in the provided file. Minor line-number inaccuracy; the handle itself is confirmed present. |
| "Weapon state … could be attached to the flight state object" (`flightModel.js`) | Unnecessary. A self-contained cooldown timer inside the missile module is simpler and avoids coupling weapon logic to the physics model. This plan keeps weapon state in `src/missiles.js`. |
| "A new key (e.g., `KeyX`) and callback would be required" | Correct and adopted. |
| Affected files list includes `src/hud.js` | A HUD weapons indicator is a nice-to-have but not required for the stated feature. This plan omits it to keep scope tight; it can be a follow-up. |
| "Cesium terrain tiles load asynchronously… introducing latency if not cached" | `viewer.scene.sampleHeight` is synchronous on already-loaded tiles (the code confirms this path). For the sim's small playable area around Richmond, tiles are resident. No async pipeline is needed. |

## Open Questions

- **None blocking.** The "5× larger" baseline is resolved by defining a standard explosion at ~6 m radius and targeting 30 m (5×). If the requester had a specific prior mockup in mind, the constants at the top of `src/missiles.js` are trivially adjustable.

---

## Work items

```json
{"items": [
  {"id": "W1", "title": "Create src/missiles.js with ballistic missile and 30 m fireball system",
   "files": ["src/missiles.js"],
   "depends_on": [],
   "establishes": [
     "createMissileSystem(scene, getGroundHeight) returns { fire(origin, forward, speed): boolean, update(dt): void }",
     "fire() spawns a cone-mesh missile at origin with velocity forward*(speed+60); returns false and does nothing if within 1 s cooldown",
     "update(dt) integrates gravity (-9.81 m/s² Y) per frame; on pos.y <= getGroundHeight(pos.x,pos.z) the missile is removed and a fireball Group is added to scene at the impact point",
     "Fireball core: SphereGeometry scaled 2→30 m over 1.4 s, MeshBasicMaterial AdditiveBlending toneMapped:false, color lerps white→orange→red→transparent",
     "Fireball particles: THREE.Points with 60 vertices, radial burst to ~40 m over 2.2 s, PointsMaterial size 2.5 AdditiveBlending",
     "Fireball light: THREE.PointLight(0xff8822, 40, 80, 2) decaying to 0 over 0.8 s",
     "All fireball children are scene.remove() and geometry/material .dispose() when age exceeds 2.2 s"
   ],
   "verification": [{"check": "build", "selector": "npm run build"}]},
  {"id": "W2", "title": "Wire KeyX fire trigger in controls.js and integrate missile system in main.js",
   "files": ["src/controls.js", "src/main.js"],
   "depends_on": ["W1"],
   "consumes": [
     "createMissileSystem(scene, getGroundHeight) returns { fire(origin, forward, speed): boolean, update(dt): void }",
     "fire() spawns a cone-mesh missile at origin with velocity forward*(speed+60); returns false and does nothing if within 1 s cooldown",
     "update(dt) integrates gravity (-9.81 m/s² Y) per frame; on pos.y <= getGroundHeight(pos.x,pos.z) the missile is removed and a fireball Group is added to scene at the impact point"
   ],
   "establishes": [
     "Pressing X (KeyX) calls the onFire callback in createControls; no keyup handling needed",
     "main.js initialises missileSystem = createMissileSystem(scene, getGroundHeight) after scene setup",
     "main.js passes onFire: () => missileSystem.fire(flight.position, flight.forward, flight.speed) to createControls",
     "main.js calls missileSystem.update(dt) inside the started && !paused block of animate(), after orientAircraft()",
     "window.__sim (DEV only) now includes missileSystem for scripted debugging"
   ],
   "verification": [{"check": "manual", "selector": "npm run dev → press X → observe missile arc and 30 m fireball on ground impact; fire 10× and confirm no FPS drop or lingering geometry"}]}
]}
```