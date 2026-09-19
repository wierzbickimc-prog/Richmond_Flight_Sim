## Relevant Files, Symbols, and Execution Paths
- **`src/controls.js`**: Defines `createControls()`. Contains a `keydown` event listener that maps raw `e.code` strings to game callbacks via a `switch` statement. Currently maps `'KeyX'` to `onFire`.
- **`index.html`**: Provides the DOM shell for the game overlay. The `.panel.panel-controls` element holds the hardcoded keyboard instruction rows displayed on-screen.
- **`src/main.js`**: Bootstraps the Three.js/Cesium worlds, initializes `createMissileSystem(scene, getGroundHeight)`, and passes `{ onFire: () => missileSystem.fire(...) }` into `createControls`. Drives the `animate()` loop which calls `missileSystem.update(dt)`.
- **`src/missiles.js`**: Implements `createMissileSystem`. The exported `fire(origin, forward, speed)` method enforces a `FIRE_COOLDOWN` (1.0s), instantiates a `THREE.ConeGeometry` projectile, and injects it into the scene graph. Collision with `getGroundHeight` triggers `createFireball`.

**Execution Path:**
1. User presses `V` (target).
2. Browser fires `keydown` → captured by `controls.js` global listener.
3. `e.code` evaluates to `'KeyV'` → `onFire` callback executes.
4. `main.js` invokes `missileSystem.fire(flight.position, flight.forward, flight.speed)`.
5. `missiles.js` applies a 1-second cooldown lock, spawns a mesh oriented along `forward`, applies `MISSILE_SPEED_BONUS`, and lets the `update()` delta-integrate gravity and trajectory until ground impact.

## Existing Tests and Commands
No automated test suites or spec files were included in the repository snapshot. Validation is purely runtime-based via a Vite development server.
Recommended local run commands:
```bash
npm install
npm run dev   # Starts dev server (usually http://localhost:5173)
npm run build # Static production export to ./dist
```
Development smoke-testing can leverage the exposed debug handle:
`window.__sim.missileSystem` (only available under `import.meta.env.DEV`).

## Observed Behavior
- The missile firing mechanism is fully implemented but completely undocumented. The source code binds it to `KeyX`, but the on-screen HUD instructions and the README control table do not list it. Consequently, users cannot discover or activate the feature.
- Missiles follow a ballistic arc subject to `GRAVITY = -9.81 m/s²` and a base airspeed offset of `MISSILE_SPEED_BONUS = 60 m/s`. Upon hitting terrain, they instantly spawn a large radial fireball particle system and point light, then self-destruct after `FIREBALL_LIFETIME` (2.2s).
- The fire action is gated by a 1-second cooldown tracked in `missiles.js` (`lastFireTime`). Rapid consecutive presses within this window safely return `false` without spawning duplicates.

## Risks and Unknowns
- **Risk**: Reassigning the default from `X` to `V` removes the undocumented legacy shortcut. Playtesters who discovered `X` mid-session will need to adapt immediately.
- **Unknown**: The prompt requests a HUD update but does not specify whether a visual cooldown indicator or fire-ready status should accompany the instruction text in the `.panel-controls` box.
- **Scope**: The change is strictly data-driven configuration and static text injection. No geometry, physics integration, or state-machine modifications are required.

## Routing assessment
{"complexity":"simple", "reasons":["The task requires changing a single string literal in a key-code switch statement and appending a static HTML line to the HUD overlay.","All targeted files (`src/controls.js`, `index.html`, `README.md`) are fully provided and structurally independent regarding this feature.","Behavioral verification is straightforward via browser playtesting without requiring compilation or environment setup."], "affected_files":["src/controls.js", "index.html", "README.md"], "risks":["Removing the undocumented `KeyX` binding eliminates a hidden shortcut that early testers may have committed to muscle memory."], "verification":"Run `npm run dev`, load the simulator, and press `V`. Confirm a metallic cone missile spawns traveling forward with a 1-second interval between shots. Immediately verify that the bottom-left HUD panel renders a new row reading `V` (e.g., `Fire Missile` or similar)."}

## Open questions
- Should the original `KeyX` binding be kept as a secondary alias alongside `KeyV` to preserve discovery for testers who already used the undocumented default?
- What exact phrasing should populate the HUD instruction line (e.g., `Fire Missile`, `Launch Rocket`, `Release Weapon`)?
- Would a brief visual cue (cooldown timer, ready-state color shift, or muzzle flash) be expected alongside the keybind to signal when the weapon is actually usable?
- Should the README controls table be formatted to group weapons separately from navigation/camera toggles for better scannability?
- Does the existing silent fire behavior require an accompanying audio cue, or is the pure-visual implementation satisfactory for this scope?