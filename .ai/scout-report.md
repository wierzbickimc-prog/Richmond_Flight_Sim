# Code Investigation Report

## Relevant Files & Symbols
- **`src/flightModel.js`**: Defines global physics constants. `MAX_SPEED = 62` (m/s) and `BOOST_MULTIPLIER = 10` result in a hardcoded boost ceiling of `620 m/s` (~1,389 mph) applied to all aircraft.
- **`src/main.js`**: Main application loop (`animate`). Calls `updateFlightModel(flight, ...)` for physics, then triggers `updateSR71Effects(...)`. Manages `activeAircraft` switching between `cessna` and `sr71`.
- **`src/sr71.js`**: Exports `buildSR71()` (constructs the Three.js group) and `updateSR71Effects()` (animates afterburners/Mach diamonds). Currently has no speed-dependent visual glow.
- **`src/hud.js`**: Updates HUD telemetry, including `speed` displayed in knots. Uses `MS_TO_KT = 1.94384` conversion factor.
- **Execution path**: `animate()` → `updateFlightModel(...)` → `updateSR71Effects(...)` → renders `sr71.group`.

## Existing Tests & Commands
- **Development run**: `npm run dev` (runs Vite dev server)
- **Production build**: `npm run build`
- **Tests**: No automated test suite exists in the repository. Smoke testing relies on Vite's query params (e.g., `?autostart&sebbie&boost`) exposed via `window.__sim`.

## Observed Behavior
- **Current Boost Ceiling**: When pressing `B`/`Space`, `setBoost()` instantaneously multiplies `flight.speed` by 10. The simulation physics loop (`updateFlightModel`) immediately clamps speed to `MAX_SPEED * BOOST_MULTIPLIER` (`62 m/s * 10 = 620 m/s`). This caps both aircraft at approximately 1,389 mph.
- **SR-71 Visuals**: The afterburners grow and brighten when `boostActive` is true, but there is no ambient envelope glow tied to absolute velocity thresholds.
- **Unit Conversion**: Speed is tracked internally in meters per second (m/s). Player-facing display converts to knots. 2,193.2 mph equates to exactly `980.452928 m/s`.

## Implementation Path
The request requires overriding the global physics cap for the SR-71 *only* and mapping a visual threshold to that new maximum.
1. **Velocity Override**: Inject a secondary acceleration vector in `main.js` immediately after `updateFlightModel()`. If `activeAircraft.mode === 'sr71' && flight.boostActive`, linearly interpolate remaining distance from the legacy `620 m/s` cap to `2193.2 * 0.44704 m/s` using the existing `BOOST_SPEED_LERP` rate. This preserves arcade feel while extending the tail-end of the acceleration curve.
2. **Visual Overlay**: Add a slightly elongated, additive-blended sphere geometry (`THREE.MeshBasicMaterial` with `color: '#ff6600'`) to the SR-71 group in `buildSR71()`. Return this mesh alongside existing props.
3. **Activation Logic**: Update `updateSR71Effects()` to accept `speed` and `glowMesh`. Compute opacity based on a 85%~100% ramp of the new 2,193.2 mph threshold. Apply a slow sine-wave pulse to simulate atmospheric entrainment at hypersonic speeds.

---

## Routing Assessment
{"complexity":"simple", "reasons":["Bounds changes to two files (main.js, sr71.js) using existing patterns.","Uses additive blending mesh for visually cheap but effective glow.","Physics modification adds a non-destructive post-step override rather than refactoring the global flight model contract.","Constant math (mph to m/s) avoids floating-point ambiguity.","No external assets or dependencies required."], "affected_files":["src/main.js","src/sr71.js"], "risks":[],"verification":"Toggle Sebbie Mode and Rocket Boost in dev mode; verify HUD reads ~1,900 kt (2,193 mph) at top speed, confirm orange additive envelope fades in gradually as velocity crosses ~1,625 mph and stabilizes near full brightness at the limit."}

## Open questions
- None