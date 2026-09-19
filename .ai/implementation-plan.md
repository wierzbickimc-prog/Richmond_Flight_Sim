# Implementation Plan: Bind Missile Fire to V and Document in HUD

## Objective

Change the missile fire key binding from the undocumented `KeyX` to `KeyV`, and add a visible instruction for the new key in both the on-screen HUD controls panel and the README controls table so players can discover the feature.

## Verified Current Behavior

- **`src/controls.js`** — The `keydown` switch statement contains `case 'KeyX': onFire && onFire(); break;`. The `onFire` callback is already accepted as a parameter to `createControls()`.
- **`src/main.js`** — Already passes `onFire: () => missileSystem.fire(flight.position, flight.forward, flight.speed)` into `createControls`. The `missileSystem` is created via `createMissileSystem(scene, getGroundHeight)` and updated each frame in `animate()`.
- **`src/missiles.js`** — `fire(origin, forward, speed)` enforces a 1-second cooldown, spawns a cone mesh, and integrates ballistic motion. No changes needed here.
- **`index.html`** — The `.panel.panel-controls` div lists W/S, A/D, arrows, F/R, G/B/Space, and H/M/P. No row mentions X or V or any missile/weapon action.
- **`README.md`** — The Controls table lists the same keys as the HUD. No X or V entry.

No automated test suite exists in the repository. Verification is manual via the Vite dev server.

## Files and Behavioral Contracts to Change

| File | Change |
|---|---|
| `src/controls.js` | Replace `case 'KeyX':` with `case 'KeyV':` in the `keydown` switch. Remove the old `KeyX` case (it was undocumented; the user explicitly requested V). |
| `index.html` | Add a new `<div>` row inside `.panel-controls` displaying the V key and "Fire Missile" label, placed on the line with G/B/Space or as its own line. |
| `README.md` | Add a row `| V | Fire missile |` to the Controls table. |

No changes to `src/main.js` or `src/missiles.js` are required; the wiring is already in place.

## Ordered Implementation Steps

### Step 1 — Rebind the key in `src/controls.js`

In the `keydown` function's `switch (e.code)` block, replace:

```js
case 'KeyX':
  onFire && onFire();
  break;
```

with:

```js
case 'KeyV':
  onFire && onFire();
  break;
```

This is a one-to-one replacement. No other part of the file references `KeyX`.

### Step 2 — Add the instruction to the HUD in `index.html`

Inside the `<div class="panel panel-controls">` block, add a new row. Place it after the existing `G / B / Space` line to group weapon/boost actions together:

```html
<div><b>V</b> Fire Missile</div>
```

The existing rows use `<b>` for the key and plain text for the action, so this matches the established pattern.

### Step 3 — Add the entry to the README controls table

In `README.md`, in the `## Controls` markdown table, add a new row after the `B / Space` row:

```
| V | Fire missile |
```

This keeps the table in the same loose group (weapon/boost actions near the end of flight controls).

## Scope Boundaries and Safety Constraints

- **Key replacement, not addition.** The old `KeyX` binding is removed. It was undocumented and never surfaced to users; the requester explicitly asked for V. Keeping X as a silent alias is out of scope unless the requester revises the request.
- **No changes to `src/missiles.js` or `src/main.js`.** The fire callback, cooldown, projectile spawning, and animation logic are already correct and wired.
- **No cooldown indicator, audio cue, or muzzle flash.** The scout report lists these as open questions, but the requester only asked for the keybind and HUD text. Adding a visual cooldown timer or sound effect is out of scope.
- **No CSS changes.** The new HUD row uses the same `<div>` / `<b>` pattern as existing rows; no new classes or styles are needed.
- **No changes to the `KEY_MAP` object.** That object only handles held-state keys (throttle, roll, pitch, yaw). The fire action is a discrete `keydown` event handled in the `switch`, so no `KEY_MAP` entry is added.

## Tests and Acceptance Criteria

Because the repository has no test framework, acceptance is verified manually:

1. **Keybinding works:** Run `npm run dev`, load the page, click **Start Flight**, then press **V**. A metallic cone mesh should spawn at the aircraft position, travel forward along the nose axis, arc under gravity, and detonate into a fireball on ground impact. Press V again within 1 second — no second missile spawns (cooldown). Press V after 1 second — a second missile spawns.
2. **Old key is gone:** Press **X** while flying. No missile spawns. No console errors.
3. **HUD displays the instruction:** With the HUD visible (default), the bottom-left `.panel-controls` box shows a row reading **V** **Fire Missile** (or equivalent phrasing) among the other key rows.
4. **README table updated:** Open `README.md` and confirm the Controls table contains a `V | Fire missile` row.
5. **No regressions:** All other keys (W/S/A/D/arrows/F/R/H/M/P/G/B/Space) still function normally. The flight model, camera toggle, boost, Sebbie Mode, and pause behave as before.

## Discrepancies or Unsupported Claims in the Scout Report

- **Execution path describes the desired state, not the current state.** The scout's "Execution Path" section says "User presses `V` (target)" and "`e.code` evaluates to `'KeyV'`", but the actual code in `src/controls.js` currently checks `case 'KeyX'`. This is a forward-looking description of the post-change behavior, not a description of the current code. It is not a factual error but could mislead a reader into thinking V is already bound.
- **Scout lists `src/missiles.js` in "Relevant Files" but not in `affected_files`.** This is consistent with the plan (no changes needed to `missiles.js`), so no discrepancy—just a note that the file was correctly identified as context-only.
- **No other discrepancies found.** All other claims (cooldown value, fireball parameters, DOM structure, README table contents, main.js wiring) match the provided file contents exactly.

## Open Questions (Non-Blocking)

These do not block implementation but are noted for the requester:

- Whether a visual cooldown indicator (e.g., a small timer or color shift in the HUD) should accompany the "V — Fire Missile" instruction. The current scope is text-only.
- Whether `KeyX` should be retained as a hidden alias. The plan removes it per the requester's explicit "make launching missles activated by pressing V."

---

## Work items

```json
{"items": [
  {"id": "W1", "title": "Rebind missile fire to V and add HUD instruction row",
   "files": ["src/controls.js", "index.html"],
   "depends_on": [],
   "establishes": [
     "The keydown switch in src/controls.js fires the onFire callback on 'KeyV' and no longer fires on 'KeyX'.",
     "The .panel-controls div in index.html contains a row displaying 'V' and 'Fire Missile' so the player can see the binding in the HUD."
   ],
   "verification": [
     {"check": "manual", "selector": "npm run dev → Start Flight → press V → cone missile spawns; press X → nothing happens"},
     {"check": "manual", "selector": "index.html .panel-controls contains a <div> with <b>V</b> and text 'Fire Missile'"}
   ]
  },
  {"id": "W2", "title": "Add V key row to README controls table",
   "files": ["README.md"],
   "depends_on": ["W1"],
   "consumes": [
     "The keydown switch in src/controls.js fires the onFire callback on 'KeyV' and no longer fires on 'KeyX'."
   ],
   "establishes": [
     "The README.md Controls table includes a row 'V | Fire missile' consistent with the keybinding implemented in src/controls.js."
   ],
   "verification": [
     {"check": "manual", "selector": "README.md ## Controls table contains a row with V and 'Fire missile'"}
   ]
  }
]}
```