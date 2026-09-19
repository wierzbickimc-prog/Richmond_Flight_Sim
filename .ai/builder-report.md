## Work item ledger

- W1 (Parameterise boost ceiling in flightModel.js and export SR-71 constant): verified, changed src/flightModel.js
- W2 (Add orange glow mesh to SR-71 and extend updateSR71Effects for speed-based glow): verified, changed src/sr71.js
- W3 (Wire SR-71 boost speed and glow through main.js animate loop and setBoost): verified, changed src/main.js

## W1: Parameterise boost ceiling in flightModel.js and export SR-71 constant

## Changes made to `src/flightModel.js`

1. **Added `SR71_BOOST_MAX_SPEED` constant** (line 13): `export const SR71_BOOST_MAX_SPEED = 2193.2 * 0.44704;` → evaluates to **980.448 m/s**. Exported as a named export AND included in the `FlightLimits` object (line 84).

2. **Parameterised `updateFlightModel`** (line 43): added optional 5th parameter `boostMaxSpeed = MAX_SPEED * BOOST_MULTIPLIER` (default 620 m/s, preserving Cessna behaviour exactly).

3. **Boost target speed** (line 59): changed from `normalTargetSpeed * BOOST_MULTIPLIER` to `(normalTargetSpeed / MAX_SPEED) * boostMaxSpeed`. At full throttle with default param this yields exactly 620 m/s (unchanged for Cessna); with `SR71_BOOST_MAX_SPEED` it yields ~980.45 m/s.

4. **Hard clamp** (line 62): changed upper bound from `MAX_SPEED * BOOST_MULTIPLIER` to `boostMaxSpeed`.

## Verification

- **Node simulation** (run via `node --input-type=module`):
  - Cessna boost steady-state: **620.00 m/s** ✓ (matches plan's ~1205 kt / 620 m/s)
  - SR-71 boost steady-state: **980.45 m/s** ✓
  - Non-boost cruise: unchanged formula, converges correctly ✓
- **`npx vite build`**: builds successfully with no errors.

## Caveats / out of scope

- The requester also asked for an **orange glow around the Blackbird** once it reaches max speed. That is a rendering concern (shader/emissive material) outside this unit's file scope (`src/flightModel.js` only). It should be handled by a later work item that has access to the scene graph.
- No existing callers of `updateFlightModel` were modified (none exist yet in the codebase beyond what will be wired up by later units), so Cessna behaviour is provably unchanged.

## W2: Add orange glow mesh to SR-71 and extend updateSR71Effects for speed-based glow

Implemented W2 in src/sr71.js only (the sole file in scope).

Changes:
1. buildSR71() now creates a glowMesh — a THREE.Mesh with SphereGeometry(1, 32, 24) and MeshBasicMaterial (color #ff6600, AdditiveBlending, depthWrite false, BackSide, transparent, initial opacity 0), scaled (11, 3.5, 17), visible=false, added to the SR-71 group. It is returned as part of the object: { group, afterburners, glowMesh, cockpitHidden }.
2. updateSR71Effects signature extended to (afterburners, throttle, boostActive, time, speed, glowMesh). Added a speed-based halo block: ratio = speed / FlightLimits.SR71_BOOST_MAX_SPEED; when ratio >= 0.85 it sets glowMesh.visible=true and ramps opacity linearly from 0 to 0.38 across the 85%-100% band (t = min(1,(ratio-0.85)/0.15)), modulated by a slow ~4 s sine pulse (breathe = 0.82 + sin(time*2π/4)*0.18); below 85% it sets glowMesh.visible=false. Guarded with if (glowMesh) so existing 4-arg callers don't crash.
3. Added import { FlightLimits } from './flightModel.js' at the top.

Note on caller wiring: the plan scoped this unit to src/sr71.js only ("do not edit anything else"), so I did NOT modify main.js line 308, which still calls updateSR71Effects(sr71.afterburners, flight.throttle, flight.boostActive, debug.simTime) without the new speed/glowMesh args. That means the glow will not actually render until a later unit wires the call site to pass flight.speed and sr71.glowMesh. This is consistent with the plan's "later units depend on it" framing, but flagging it explicitly since the manual verification (?sebbie&boost&autostart → orange glow fades in) cannot pass until that call-site update lands. The function itself is backward-compatible (extra params are simply undefined), so nothing breaks today.

Verification run (actual output):
- npm run build → exit code 0, "✓ built in 704ms", all 1471 modules transformed (only the pre-existing >500 kB chunk-size warning).
- node --check src/sr71.js → "SYNTAX OK".
- A node script replicating the exact glow math against the real FlightLimits.SR71_BOOST_MAX_SPEED (confirmed = 980.45 m/s ≈ 2193.2 mph × 0.44704) showed: low speed (34 m/s) → {visible:false}; at exactly 85% → {visible:true, opacity:0}; mid-band 92.5% → opacity ≈ 0.156; full 100% → opacity ≈ 0.312 (peak of the pulse reaches 0.38). Band edges and pulse behave as specified.

No automated test suite exists in the project; the manual browser check listed in the plan is the remaining gate and depends on the out-of-scope main.js call-site change noted above.

## W3: Wire SR-71 boost speed and glow through main.js animate loop and setBoost

Wired SR-71 boost speed and glow through src/main.js per plan. Changes (only src/main.js edited):
1. Import: added SR71_BOOST_MAX_SPEED to the flightModel.js import.
2. setBoost(): now computes an aircraft-specific ceiling — SR71_BOOST_MAX_SPEED (~980.45 m/s, i.e. 2193.2 mph) for sr71, FlightLimits.MAX_SPEED * FlightLimits.BOOST_MULTIPLIER (620 m/s) for cessna — and clamps the instant speed jump on engage against that ceiling.
3. animate loop: updateFlightModel is called with SR71_BOOST_MAX_SPEED as the 5th argument when activeAircraft.mode === 'sr71', otherwise with no 5th argument (default 620).
4. animate loop: updateSR71Effects is now called with flight.speed as the 5th arg and sr71.glowMesh as the 6th arg, enabling the orange halo that fades in above 85% of ~980.45 m/s (~833 m/s) with a slow ~4 s pulse; it stays hidden below that and never applies to the Cessna.

Verification: ran `npm run build` — exit code 0, vite built successfully (1471 modules transformed, only the pre-existing chunk-size warning). Manual acceptance (dev server, visual glow check) was not performed in this session; the runner will execute it.