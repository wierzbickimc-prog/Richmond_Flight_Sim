# Richmond Flight Sim

A browser-based arcade flight simulator: fly a Cessna 172 or switch into **Sebbie
Mode** for an SR-71 Blackbird over Richmond, Virginia, and locate **1916 Seddon Rd**
plus five James River landmarks. Runs locally
on macOS with Vite + Three.js — no game engine install, no API keys.

## Run it locally

Requires Node.js (18+) and npm.

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`) in Chrome, Safari, or
Firefox. Click **Start Flight**.

`npm run build` produces a static production build in `dist/` — you can also just
open that folder with any static file server if you ever want to run it without Vite.

## Controls

| Key | Action |
| --- | --- |
| W / S | Throttle up / down |
| A / D | Roll left / right (bank to turn) |
| ↑ / ↓ | Pitch up / down |
| ← / → | Yaw (rudder) left / right |
| F | Toggle chase camera / cockpit camera |
| R | Reset aircraft to the starting position |
| H | Toggle HUD |
| M | Toggle landmark markers |
| P | Pause / resume |
| G | Toggle **Sebbie Mode** (Cessna 172 / SR-71 Blackbird) |
| B / Space | Toggle 10× rocket boost |

Flight is arcade-simple by design: throttle sets your target speed, pitch sets a
gentle climb/descend rate, and altitude is clamped to a band (roughly 25–520 m /
80–1700 ft above the ground) so you're always low enough to see the ground and
never crash. There's no stall model and no game-over state.

The large on-screen buttons duplicate the aircraft and booster controls. Rocket
boost immediately multiplies the current airspeed by 10 and adds a wide-angle
warp-speed streak effect. In Sebbie Mode, the Blackbird's twin afterburners remain
lit at normal speed and show animated shock/Mach diamonds; boost lengthens and
brightens both plumes.

In cockpit view, obstructing fuselage/canopy parts are hidden. On the Cessna, the
propeller blades fade into a translucent blur disc as RPM rises.

## The mission

**"Richmond River & Seddon Run"** — free flight with a non-blocking objective. The
HUD tracks distance to the primary objective and a checklist of every landmark.
Fly within a landmark's marked radius (the glowing beam + ring on the ground) to
check it off:

1. **1916 Seddon Rd** (primary objective, gold beacon) — Ginter Park / Rosedale,
   Richmond's Northside
2. **Belle Isle** — wooded island standing in a broad, boulder-strewn reach of the James
3. **CSX A-Line (Atlantic Coast Line) Bridge** — 1919 multi-span concrete arch bridge
4. **Hollywood Rapids** — whitewater below Hollywood Cemetery
5. **Pipeline Rapids** — whitewater near Brown's Island
6. **Cooper's Island** — see note below

Nothing is required to "win" — this is free flight with an objective overlay, not a
scored mission.

## Where the map data came from

This is not a photogrammetric or satellite-tile recreation of Richmond — that would
require a licensed Google Maps/Earth API key. Instead:

- Every landmark's lat/lon was geocoded from OpenStreetMap (Nominatim) and
  cross-checked against Wikipedia/park-map sources where available.
- The river channel, Belle Isle's footprint, the CSX bridge crossing point, and the
  Seddon Rd neighborhood are procedurally generated from those coordinates using a
  local flat-earth (equirectangular) projection — see `src/geo.js`. Terrain,
  roads, buildings, and trees are stylized low-poly, not real building footprints.
- All landmark coordinates live in [`public/data/landmarks.json`](public/data/landmarks.json)
  as plain lat/lon — edit that file to nudge, add, or remove a marker without
  touching any code.

Two markers carry `"confidence": "approximate"` rather than `"geocoded"`:

- **Cooper's Island** could not be confirmed as an officially named, precisely
  mapped feature — it doesn't appear in USGS/Wikipedia/OSM data. The closest
  match is a "Coopers" rapid/hole labeled on the official James River Park System
  map, between Pony Pasture and the CSX bridge, so that's where the marker sits.
- **Hollywood Rapids** geocodes to 37.52995, -77.45347 — but that's where the
  interpretive *sign* stands on Belle Isle, about 110 m from the Belle Isle
  marker, far too close to tell apart from the air. The marker is instead placed
  in the channel below Hollywood Cemetery, which is where the rapid actually runs.

If you have more exact locations (e.g. from Google Earth or local knowledge),
update their `lat`/`lon` in `public/data/landmarks.json`.

### If you want to use Google Earth to verify or refine locations

Google Earth is great for visually confirming a spot and exporting a precise
placemark, even though the game doesn't load Google's map tiles directly (that
requires a paid Google Maps Platform key and has licensing restrictions on reuse).
To pull a coordinate out of Google Earth for this project:

1. Open [Google Earth](https://earth.google.com/web/) (web or desktop) or Google
   Earth Pro.
2. Search for or navigate to the location (e.g. "1916 Seddon Rd, Richmond, VA" or
   "Cooper's Island Richmond VA").
3. Click **Add Placemark** (the pin icon), drop it exactly where you want it, and
   name it.
4. In the Places sidebar, right-click the placemark → **Save Place As...** → choose
   **KML** (not KMZ, so it stays plain text/XML) and save it.
5. Open the `.kml` file in a text editor — you'll see a `<coordinates>` tag like:
   ```xml
   <coordinates>-77.4675572,37.5812115,0</coordinates>
   ```
   That's `longitude,latitude,altitude`. Note the order — it's reversed from how
   this project's JSON lists them.
6. Copy the `lat`/`lon` values into the matching entry in
   `public/data/landmarks.json` (or add a new landmark object following the same
   shape).
7. Refresh the browser — no rebuild needed in dev mode.

You can also drop multiple placemarks in one Google Earth "project," export them
all as one KML, and hand that file to a future session to batch-update the
landmark list.

## Project structure

```
index.html                   Page shell, HUD markup, start screen
src/main.js                  App bootstrap, render loop, sun/shadow rig
src/geo.js                   Lat/lon <-> local world-meters projection
src/terrain.js               Ground, river, Belle Isle, bluffs, roads, skyline, bridge, trees
src/aircraft.js              Cessna 172 (primitives only, no external assets)
src/sr71.js                  Sebbie Mode SR-71 + afterburner/Mach-diamond effects
src/effects.js               10× boost warp-speed streak field
src/flightModel.js           Arcade flight physics
src/controls.js              Keyboard input
src/camera.js                Chase / cockpit camera rig
src/sky.js                   Sky gradient and cumulus billboards
src/landmarks.js             Landmark beacons + objective-radius detection
src/hud.js                   HUD DOM overlay
src/noise.js                 Value noise, tileable fBm, seeded PRNG
public/data/landmarks.json   All landmark coordinates and metadata
```

In `npm run dev` only, the sim exposes `window.__sim` (`flight` state plus a
frame/sim-time counter). It's handy for poking at the physics from the browser
console, and Vite strips it from production builds.

## Notes on realism / scope

- Aircraft, terrain, and city have no external model or texture dependencies, so
  the whole sim stays a lightweight page. Ground relief, irregular cloud sprites,
  animated reflective river water, moving whitewater foam, cascade curtains, and
  spray are generated procedurally at load time. The terrain remains an artistic
  approximation rather than photogrammetry.
- Distances and terrain shapes are approximate, built from geocoded points rather
  than a survey-grade GIS dataset. The road network is eyeballed from the city's
  street layout — it makes the ground read as a city, but it is not routable and
  the alignments are not survey-accurate.
- The world is roughly 9.6 × 9.2 km. Terrain is a single 420×420 heightfield mesh;
  trees (~16k), rapids boulders and low-rise buildings are instanced. Measured at
  a steady 60 FPS on an M3 MacBook at 1440×900.
- No NPC traffic, no day/night cycle, no weather — free flight, day only, as scoped.
