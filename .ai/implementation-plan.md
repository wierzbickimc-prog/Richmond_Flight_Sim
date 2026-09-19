# Implementation Plan: SR-71 Independent Boost Speed + Orange Velocity Glow

## Objective & Verified Current Behavior

**Goal**: Give the SR-71 Blackbird its own boost ceiling of 2,193.2 mph (980.45 m/s) while the Cessna 172 retains the existing 620 m/s cap. Add an orange additive-blend envelope glow around the SR-71 that fades in as it approaches the new ceiling.

**Verified current behavior** (confirmed in source):

- `flightModel.js` line 57: `state.speed = Math.max(MIN_SPEED * 0.6, Math.min(MAX_SPEED * BOOST_MULTIPLIER, state.speed));` — hard-clamps **all** aircraft to 620 m/s.
- `flightModel.js` line 54: `targetSpeed = normalTargetSpeed * (state.boostActive ? BOOST_MULTIPLIER : 1)` — boost target is throttle-scaled × 10, maxing at 620 m/s.
- `main.js` `setBoost()`: on activation, `flight.speed = Math.min(FlightLimits.MAX_SPEED * FlightLimits.BOOST_MULTIPLIER, flight.speed * FlightLimits.BOOST_MULTIPLIER)` — instant jump also capped at 620 m/s.
- `sr71.js` `buildSR71()` returns `{ group, afterburners, cockpitHidden }`. No glow mesh exists.
- `sr71.js` `updateSR71Effects(afterburners, throttle, boostActive, time)` — no speed parameter, no glow animation.
- `main.js` `animate()` calls `updateSR71Effects(sr71.afterburners, flight.throttle, flight.boostActive, debug.simTime)`.
- HUD displays speed in knots via `MS_TO_KT = 1.94384`. At 980.45 m/s the readout will be ≈ 1 906 kt.

**Conversion check**: 2 193.2 mph × 0.44704 = **980.45 m/s**.

## Files & Behavioral Contracts to Change

| File | Contract change |
|---|---|
| `src/flightModel.js` | `updateFlightModel` gains a 5th optional parameter `boostMaxSpeed` (default `MAX_SPEED * BOOST_MULTIPLIER`). Both the boost target and the hard clamp use this value. New exported constant `SR71_BOOST_MAX_SPEED = 980.45`. |
| `src/sr71.js` | `buildSR71()` return object gains `glowMesh`. `updateSR71Effects` gains `speed` and `glowMesh` parameters and animates the glow's opacity based on speed relative to `SR71_BOOST_MAX_SPEED`. |
| `src/main.js` | Passes `SR71_BOOST_MAX_SPEED` to `updateFlightModel` when the active aircraft is the SR-71. `setBoost` uses the aircraft-specific ceiling for the instant speed jump. `updateSR71Effects` call passes `flight.speed` and `sr71.glowMesh`. |

No other files change. `hud.js`, `controls.js`, `aircraft.js`, `effects.js`, `camera.js`, and all data files are untouched.

## Ordered Implementation Steps

### Step 1 — `src/flightModel.js`

1. Add a module-level constant:
   ```js
   const SR71_BOOST_MAX_SPEED = 2193.2 * 0.44704; // ≈ 980.45 m/s
   ```
2. Change `updateFlightModel` signature to:
   ```js
   export function updateFlightModel(state, input, dt, getGroundHeight, boostMaxSpeed = MAX_SPEED * BOOST_MULTIPLIER)
   ```
3. Replace the boost target line (current line 54) with:
   ```js
   const targetSpeed = state.boostActive
     ? (normalTargetSpeed / MAX_SPEED) * boostMaxSpeed
     : normalTargetSpeed;
   ```
   This preserves the throttle-proportional scaling (at throttle 1 → full `boostMaxSpeed`; at throttle 0 → `MIN_SPEED/MAX_SPEED * boostMaxSpeed`).
4. Replace the clamp line (current line 57) with:
   ```js
   state.speed = Math.max(MIN_SPEED * 0.6, Math.min(boostMaxSpeed, state.speed));
   ```
5. Add `SR71_BOOST_MAX_SPEED` to the `FlightLimits` export (or export it as a separate named export — either works; the `FlightLimits` bag already groups speed-related constants).

### Step 2 — `src/sr71.js`

1. **Glow mesh in `buildSR71()`**: After the existing geometry construction (before `group.traverse`), create:
   ```js
   const glowGeo = new THREE.SphereGeometry(1, 32, 20);
   const glowMat = new THREE.MeshBasicMaterial({
     color: '#ff6600',
     transparent: true,
     opacity: 0,
     blending: THREE.AdditiveBlending,
     depthWrite: false,
     side: THREE.BackSide,
   });
   const glowMesh = new THREE.Mesh(glowGeo, glowMat);
   glowMesh.scale.set(11, 3.5, 17);   // ellipsoid wrapping the SR-71 (wingspan ~17, length ~25)
   glowMesh.visible = false;           // hidden until speed crosses threshold
   group.add(glowMesh);
   ```
   Add `glowMesh` to the returned object: `{ group, afterburners, cockpitHidden, glowMesh }`.

2. **Extend `updateSR71Effects`**: New signature:
   ```js
   export function updateSR71Effects(afterburners, throttle, boostActive, time, speed, glowMesh)
   ```
   At the end of the function (after the afterburner loop), add glow logic:
   ```js
   // Orange envelope glow: fades in over 85 % → 100 % of the SR-71 boost ceiling.
   const SR71_BOOST_MAX = 980.45;
   if (glowMesh) {
     const frac = speed / SR71_BOOST_MAX;
     const rampStart = 0.85;
     let targetOpacity = 0;
     if (frac >= rampStart) {
       targetOpacity = Math.min(1, (frac - rampStart) / (1 - rampStart)) * 0.38;
     }
     if (targetOpacity > 0.01) {
       glowMesh.visible = true;
       // Slow sine pulse (~4 s period) simulating atmospheric entrainment.
       const pulse = 0.82 + 0.18 * Math.sin(time * 1.5);
       glowMesh.material.opacity = targetOpacity * pulse;
     } else {
       glowMesh.visible = false;
     }
   }
   ```
   The `SR71_BOOST_MAX` constant here is duplicated from `flightModel.js` to avoid a circular import (sr71.js is a leaf module). Acceptable for a single magic number; alternatively import from flightModel.js if the import graph allows (it does — flightModel has no import of sr71). **Prefer importing `FlightLimits.SR71_BOOST_MAX_SPEED` from `flightModel.js`** to keep a single source of truth.

### Step 3 — `src/main.js`

1. **Import the new constant**:
   ```js
   import { createFlightState, updateFlightModel, FlightLimits, SR71_BOOST_MAX_SPEED } from './flightModel.js';
   ```

2. **`setBoost` function**: Replace the two speed-jump lines with aircraft-aware logic:
   ```js
   function setBoost(active) {
     const wasActive = flight.boostActive;
     const boostCeil = activeAircraft.mode === 'sr71' ? SR71_BOOST_MAX_SPEED : FlightLimits.MAX_SPEED * FlightLimits.BOOST_MULTIPLIER;
     if (active && !wasActive) {
       flight.speed = Math.min(boostCeil, flight.speed * FlightLimits.BOOST_MULTIPLIER);
     } else if (!active && wasActive) {
       flight.speed = Math.max(FlightLimits.MIN_SPEED, flight.speed / FlightLimits.BOOST_MULTIPLIER);
     }
     // …rest unchanged
   }
   ```

3. **`animate` loop — flight model call**: Pass the aircraft-specific ceiling:
   ```js
   const boostCeil = activeAircraft.mode === 'sr71' ? SR71_BOOST_MAX_SPEED : undefined;
   updateFlightModel(flight, input, dt, getGroundHeight, boostCeil);
   ```
   (`undefined` triggers the default parameter = 620 m/s for the Cessna.)

4. **`animate` loop — SR-71 effects call**:
   ```js
   updateSR71Effects(sr71.afterburners, flight.throttle, flight.boostActive, debug.simTime, flight.speed, sr71.glowMesh);
   ```

## Scope Boundaries & Safety Constraints

- **Cessna behavior is unchanged.** When `activeAircraft.mode === 'cessna'`, the flight model receives no extra argument (defaults to 620 m/s), `setBoost` uses the original ceiling, and the glow mesh is never visible (it belongs to the SR-71 group, which is hidden).
- **No new npm dependencies.** All geometry and materials use existing Three.js primitives already imported.
- **No HUD text change.** The "10× ENGAGED" label remains. (The effective multiplier for the SR-71 is ≈ 15.8×, but the label was not in scope.)
- **No change to `MIN_SPEED`, `MAX_SPEED`, `BOOST_MULTIPLIER`, or normal (non-boost) speed behavior.**
- **Glow mesh uses `depthWrite: false` + `AdditiveBlending`** so it never z-fights with the aircraft geometry or the afterburner cones.
- **`glowMesh.visible = false` when opacity < 0.01** avoids a draw call for an invisible mesh.

## Tests & Acceptance Criteria

No automated test suite exists in this repository. Verification is manual via Vite dev mode:

1. **Cessna unchanged**: `npm run dev` → start flight → press `B`. Speed climbs and caps at ≈ 1 205 kt (620 m/s). HUD reads "10× ENGAGED." No orange glow visible.
2. **SR-71 boost speed**: Toggle to Sebbie Mode (aircraft-mode button or `?sebbie` query param) → press `B` → hold throttle to 100 %. Speed should asymptotically approach ≈ 1 906 kt (980.45 m/s). HUD speed readout confirms.
3. **Glow fade-in**: During the SR-71 boost, watch the orange envelope: invisible below ≈ 85 % of 980 m/s (≈ 833 m/s ≈ 1 621 kt), gradually brightening through the 85–100 % band, reaching a steady soft orange at the ceiling. A slow (~4 s) pulse modulates the brightness.
4. **Glow off**: Disengage boost or switch to Cessna — glow disappears immediately (SR-71 group hidden for Cessna; opacity drops to 0 for disengaged SR-71).
5. **Throttle interaction**: At 50 % throttle + boost in SR-71 mode, top speed ≈ 953 kt (half of 980 m/s minus the MIN_SPEED offset), and the glow never fully fades in (stays in the lower part of the ramp).
6. **Production build**: `npm run build` completes without errors.

## Discrepancies & Unsupported Claims in the Scout Report

| Scout claim | Assessment |
|---|---|
| "Inject a secondary acceleration vector in `main.js` immediately after `updateFlightModel()`" | **Design difference, not a factual error.** The plan instead parameterises `updateFlightModel` with a `boostMaxSpeed` argument, which is a smaller diff and avoids two competing lerps in the same frame. The scout's approach would work but is less clean. |
| "linearly interpolate remaining distance from the legacy 620 m/s cap to 2193.2 × 0.44704 m/s using the existing `BOOST_SPEED_LERP` rate" | The lerp is already handled internally by `updateFlightModel`; a post-hoc secondary lerp in `main.js` would fight the primary one. The parameterised approach eliminates this issue. |
| "Bounds changes to two files (`main.js`, `sr71.js`)" | **Undercount.** `flightModel.js` must also change to accept the new ceiling. Three files are affected. |
| "Risks: `[]`" (empty) | Minor risk: the glow mesh's `BackSide` sphere could interact with the Cesium terrain rendering if the camera is very close. Low probability given the `depthWrite: false` setting, but worth watching in dev. |
| Verification "HUD reads ~1,900 kt (2,193 mph)" | Correct. 980.45 m/s × 1.94384 = 1 905.8 kt. |

No [ESCALATE] marker is needed; all design decisions are resolvable from the code and the requester's requirements.

## Work items

```json
{"items": [
  {"id": "W1", "title": "Parameterise boost ceiling in flightModel.js and export SR-71 constant",
   "files": ["src/flightModel.js"],
   "depends_on": [],
   "establishes": [
     "updateFlightModel accepts an optional 5th parameter boostMaxSpeed (default MAX_SPEED * BOOST_MULTIPLIER = 620); the boost target is (normalTargetSpeed / MAX_SPEED) * boostMaxSpeed and the hard clamp uses boostMaxSpeed instead of MAX_SPEED * BOOST_MULTIPLIER",
     "SR71_BOOST_MAX_SPEED is exported as a named export and also included in the FlightLimits object; its value is 2193.2 * 0.44704 ≈ 980.45"
   ],
   "verification": [{"check": "manual", "selector": "npm run dev → Cessna boost still caps at ~1205 kt (620 m/s); no visual or behavioural change for Cessna"}]},
  {"id": "W2", "title": "Add orange glow mesh to SR-71 and extend updateSR71Effects for speed-based glow",
   "files": ["src/sr71.js"],
   "depends_on": ["W1"],
   "consumes": ["SR71_BOOST_MAX_SPEED is exported as a named export and also included in the FlightLimits object; its value is 2193.2 * 0.44704 ≈ 980.45"],
   "establishes": [
     "buildSR71() returns an object that includes a glowMesh property: a THREE.Mesh with SphereGeometry, MeshBasicMaterial (color #ff6600, AdditiveBlending, depthWrite false, BackSide, transparent, initial opacity 0), scaled (11, 3.5, 17), initially visible=false, added to the SR-71 group",
     "updateSR71Effects signature is (afterburners, throttle, boostActive, time, speed, glowMesh); when speed/FlightLimits.SR71_BOOST_MAX_SPEED >= 0.85 it sets glowMesh.visible=true and ramps opacity linearly from 0 to 0.38 over the 85%-100% band, modulated by a slow sine pulse (period ~4 s); below 85% it sets glowMesh.visible=false"
   ],
   "verification": [{"check": "manual", "selector": "npm run dev → ?sebbie&boost&autostart → at high speed an orange additive ellipsoid fades in around the SR-71 with a slow pulse; at low speed it is invisible"}]},
  {"id": "W3", "title": "Wire SR-71 boost speed and glow through main.js animate loop and setBoost",
   "files": ["src/main.js"],
   "depends_on": ["W1", "W2"],
   "consumes": [
     "updateFlightModel accepts an optional 5th parameter boostMaxSpeed (default MAX_SPEED * BOOST_MULTIPLIER = 620); the boost target is (normalTargetSpeed / MAX_SPEED) * boostMaxSpeed and the hard clamp uses boostMaxSpeed instead of MAX_SPEED * BOOST_MULTIPLIER",
     "SR71_BOOST_MAX_SPEED is exported as a named export and also included in the FlightLimits object; its value is 2193.2 * 0.44704 ≈ 980.45",
     "buildSR71() returns an object that includes a glowMesh property: a THREE.Mesh with SphereGeometry, MeshBasicMaterial (color #ff6600, AdditiveBlending, depthWrite false, BackSide, transparent, initial opacity 0), scaled (11, 3.5, 17), initially visible=false, added to the SR-71 group",
     "updateSR71Effects signature is (afterburners, throttle, boostActive, time, speed, glowMesh); when speed/FlightLimits.SR71_BOOST_MAX_SPEED >= 0.85 it sets glowMesh.visible=true and ramps opacity linearly from 0 to 0.38 over the 85%-100% band, modulated by a slow sine pulse (period ~4 s); below 85% it sets glowMesh.visible=false"
   ],
   "establishes": [
     "In the animate loop, updateFlightModel is called with SR71_BOOST_MAX_SPEED as the 5th argument when activeAircraft.mode === 'sr71', and with no 5th argument (default 620) otherwise",
     "setBoost uses aircraft-specific ceiling: SR71_BOOST_MAX_SPEED for sr71, FlightLimits.MAX_SPEED * FlightLimits.BOOST_MULTIPLIER for cessna",
     "updateSR71Effects is called with flight.speed as the 5th argument and sr71.glowMesh as the 6th argument"
   ],
   "verification": [{"check": "manual", "selector": "npm run dev → full acceptance pass: Cessna caps at 620 m/s, SR-71 caps at ~980 m/s (~1906 kt), orange glow fades in above ~833 m/s with slow pulse, glow absent on Cessna, npm run build succeeds"}]}
]}
```