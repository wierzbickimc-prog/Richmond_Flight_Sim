## Work item ledger

- W1 (Rebind missile fire to V and add HUD instruction row): verified
- W2 (Add V key row to README controls table): verified

## W1: Rebind missile fire to V and add HUD instruction row

No edits required — both plan requirements were already satisfied in the codebase. (1) src/controls.js keydown switch fires onFire on 'KeyV' (lines 63-65) with no 'KeyX' case anywhere (verified by project-wide search); main.js wires onFire to missileSystem.fire. (2) index.html .panel-controls already contains <div><b>V</b> Fire Missile</div> (line 47). Verification: ran a Node harness importing createControls with a stubbed window; dispatching KeyV fired the callback exactly once and KeyX did nothing (output: "fires after V then X: 1 / PASS"). Files changed: none.

## W2: Add V key row to README controls table

The required change was already present: README.md's ## Controls table (line 62) contains the row `| V | Fire missile |`, consistent with src/controls.js firing onFire on 'KeyV' (src/controls.js:63) and the HUD row `<div><b>V</b> Fire Missile</div>` in index.html (line 47). No files needed editing. Verified via grep that both the "## Controls" heading and the "V | Fire missile" row exist in README.md, and confirmed the KeyV handler and HUD entry are in place from prior units.