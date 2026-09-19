import * as THREE from 'three';
import './style.css';
import { makeProjector } from './geo.js';
import { buildAircraft } from './aircraft.js';
import { buildSR71, updateSR71Effects } from './sr71.js';
import { buildWarpEffect, updateWarpEffect } from './effects.js';
import { createCesiumWorld, saveRuntimeCredentials } from './cesiumWorld.js';
import {
  buildCesiumLandmarkMarkers,
  distanceTo,
  setMarkersVisible,
  updateLandmarkDetection,
  updateLandmarkGrounding,
} from './cesiumLandmarks.js';
import { createFlightState, updateFlightModel, FlightLimits } from './flightModel.js';
import { createControls } from './controls.js';
import { createCameraRig, setCameraAircraftMode, toggleCameraMode, updateCamera } from './camera.js';
import { createHud } from './hud.js';
import { createMissileSystem } from './missiles.js';

const canvas = document.getElementById('scene');

// Let the browser paint the loading screen before the (synchronous) world build.
const yieldToPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function main() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 12000);

  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x51603f, 1.25);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const SHADOW_EXTENT = 800;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 4200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 2.0;
  scene.add(sun);
  scene.add(sun.target);
  // Mid-morning sun from the southeast.
  const SUN_OFFSET = new THREE.Vector3(900, 1500, 1100);

  const status = document.getElementById('start-status');
  const startBtn = document.getElementById('start-btn');

  status.textContent = 'Loading landmark data…';
  const landmarksData = await fetch('data/landmarks.json').then((r) => r.json());
  const projector = makeProjector(landmarksData.origin.lat, landmarksData.origin.lon);

  status.textContent = 'Starting CesiumJS…';
  await yieldToPaint();
  const cesiumWorld = await createCesiumWorld(
    document.getElementById('cesium-scene'),
    projector,
    (message) => { status.textContent = message; }
  );
  const { getGroundHeight } = cesiumWorld;

  status.textContent = 'Placing landmarks…';
  await yieldToPaint();
  const markers = buildCesiumLandmarkMarkers(
    cesiumWorld.viewer,
    projector,
    landmarksData,
    cesiumWorld.sampleGroundAt
  );
  const primaryMarker = markers.find((m) => m.primary);
  cesiumWorld.setHeightExclusions(
    markers.flatMap((marker) => [marker.beamEntity, marker.postEntity, marker.ringEntity, marker.labelEntity])
  );

  const cessna = buildAircraft();
  cessna.mode = 'cessna';
  cessna.name = 'CESSNA 172';
  const sr71 = buildSR71();
  sr71.mode = 'sr71';
  sr71.name = 'SR-71 BLACKBIRD';
  sr71.group.visible = false;
  scene.add(cessna.group, sr71.group);
  let activeAircraft = cessna;
  let aircraftGroup = activeAircraft.group;

  const applyCameraMode = () => {
    const inCockpit = cameraRig.mode === 'cockpit';
    for (const model of [cessna, sr71]) {
      for (const part of model.cockpitHidden) part.visible = true;
    }
    if (inCockpit) {
      for (const part of activeAircraft.cockpitHidden) part.visible = false;
    }
  };

  // Start over the river just east of the CSX bridge, pointed downstream toward
  // Belle Isle and downtown, so the opening view has the good scenery in it.
  const spawn = projector.toWorld(37.5345, -77.49);
  const spawnPos = new THREE.Vector3(spawn.x, getGroundHeight(spawn.x, spawn.z) + 235, spawn.z);

  const aim = projector.toWorld(37.5292, -77.4528); // Belle Isle
  const spawnHeading = Math.atan2(aim.x - spawnPos.x, -(aim.z - spawnPos.z));

  const flight = createFlightState(spawnPos, spawnHeading);

  const cameraRig = createCameraRig();
  const missileSystem = createMissileSystem(scene, getGroundHeight);
  const hud = createHud(markers);
  let hudVisible = true;
  let markersVisible = true;
  let paused = false;
  let started = false;

  const boostBtn = document.getElementById('boost-btn');
  const aircraftModeBtn = document.getElementById('aircraft-mode-btn');
  const aircraftModeLabel = document.getElementById('aircraft-mode-label');
  const warpOverlay = document.getElementById('warp-overlay');
  const mapDataBadge = document.getElementById('map-data-badge');
  const warpEffect = buildWarpEffect(scene);

  if (cesiumWorld.mode === 'google-photorealistic') {
    mapDataBadge.textContent = 'GOOGLE PHOTOREALISTIC 3D · CESIUMJS';
  } else if (cesiumWorld.mode === 'cesium-photorealistic-evaluation') {
    mapDataBadge.textContent = 'PHOTOREALISTIC 3D · CESIUM EVALUATION';
  } else if (cesiumWorld.mode === 'cesium-terrain-osm') {
    mapDataBadge.textContent = 'CESIUM WORLD TERRAIN · OPENSTREETMAP';
  } else {
    mapDataBadge.textContent = 'OPENSTREETMAP FALLBACK';
    mapDataBadge.classList.add('fallback');
  }

  function setBoost(active) {
    const wasActive = flight.boostActive;
    if (active && !wasActive) {
      flight.speed = Math.min(FlightLimits.MAX_SPEED * FlightLimits.BOOST_MULTIPLIER, flight.speed * FlightLimits.BOOST_MULTIPLIER);
    } else if (!active && wasActive) {
      flight.speed = Math.max(FlightLimits.MIN_SPEED, flight.speed / FlightLimits.BOOST_MULTIPLIER);
    }
    flight.boostActive = active;
    cameraRig.boostActive = active;
    boostBtn.classList.toggle('active', active);
    boostBtn.setAttribute('aria-pressed', String(active));
    warpOverlay.classList.toggle('active', active);
    if (active && !wasActive) hud.toast('Rocket boost engaged — 10× speed!');
  }

  function toggleBoost() {
    setBoost(!flight.boostActive);
  }

  function toggleAircraft() {
    setBoost(false);
    for (const part of activeAircraft.cockpitHidden) part.visible = true;
    activeAircraft.group.visible = false;
    activeAircraft = activeAircraft === cessna ? sr71 : cessna;
    aircraftGroup = activeAircraft.group;
    aircraftGroup.visible = true;
    setCameraAircraftMode(cameraRig, activeAircraft.mode);
    aircraftModeLabel.textContent = activeAircraft === sr71 ? 'EXIT SEBBIE MODE' : 'SEBBIE MODE';
    aircraftModeBtn.classList.toggle('active', activeAircraft === sr71);
    orientAircraft();
    applyCameraMode();
    hud.toast(activeAircraft === sr71 ? 'Sebbie Mode: SR-71 Blackbird online' : 'Cessna 172 restored');
  }

  const { input } = createControls({
    onToggleCamera: () => {
      toggleCameraMode(cameraRig);
      applyCameraMode();
    },
    onReset: () => {
      setBoost(false);
      flight.position.copy(spawnPos);
      flight.heading = spawnHeading;
      flight.pitch = 0;
      flight.roll = 0;
      flight.speed = FlightLimits.CRUISE_SPEED;
      flight.throttle = 0.55;
    },
    onToggleHud: () => {
      hudVisible = !hudVisible;
      hud.setVisible(hudVisible);
    },
    onToggleMarkers: () => {
      markersVisible = !markersVisible;
      setMarkersVisible(markers, markersVisible);
    },
    onTogglePause: () => {
      paused = !paused;
      hud.setPaused(paused);
    },
    onToggleBoost: toggleBoost,
    onToggleAircraft: toggleAircraft,
    onFire: () => missileSystem.fire(flight.position, flight.forward, flight.speed),
  });

  boostBtn.addEventListener('click', toggleBoost);
  aircraftModeBtn.addEventListener('click', toggleAircraft);

  const startOverlay = document.getElementById('start-overlay');
  startBtn.addEventListener('click', () => {
    started = true;
    startOverlay.style.display = 'none';
  });

  const mapConfig = document.getElementById('map-config');
  const mapConfigError = document.getElementById('map-config-error');
  document.getElementById('save-map-credentials').addEventListener('click', () => {
    const googleKey = document.getElementById('google-maps-key').value.trim();
    const ionToken = document.getElementById('cesium-ion-token').value.trim();
    if (!googleKey && !ionToken) {
      mapConfigError.textContent = 'Enter at least one credential.';
      return;
    }
    saveRuntimeCredentials({ googleKey, ionToken });
    window.location.reload();
  });
  if (cesiumWorld.loadError) {
    mapConfig.open = true;
    mapConfigError.textContent = 'Photorealistic tiles could not load. Add or replace a credential.';
  }

  // Orientation: the model's nose is local -Z. Three's Object3D.lookAt() aims a
  // non-camera object's +Z at the target, which would fly the plane tail-first, so
  // set the rotation explicitly instead.
  //   heading is a compass bearing (clockwise from north) -> negative Y euler
  //   roll right drops the right wing                      -> negative Z euler
  const aircraftEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  function orientAircraft() {
    aircraftEuler.set(flight.pitch, -flight.heading, -flight.roll, 'YXZ');
    aircraftGroup.quaternion.setFromEuler(aircraftEuler);
    aircraftGroup.position.copy(flight.position);
  }
  orientAircraft();
  applyCameraMode();
  updateCamera(camera, cameraRig, aircraftGroup, 1);

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    cesiumWorld.resize();
  }
  window.addEventListener('resize', onResize);
  onResize();

  status.textContent = cesiumWorld.mode === 'osm-fallback'
    ? 'Ready — OpenStreetMap fallback active.'
    : cesiumWorld.mode === 'cesium-terrain-osm'
    ? 'Ready — real terrain and OpenStreetMap imagery are streaming.'
    : 'Ready — real Richmond 3D data is streaming.';
  startBtn.disabled = false;
  startBtn.textContent = 'Start Flight';

  const timer = new THREE.Timer();
  timer.connect(document);
  let propAngle = 0;

  // Dev-only handle for driving the sim from automated smoke tests.
  const debug = { frames: 0, simTime: 0 };
  if (import.meta.env.DEV) {
    window.__sim = { flight, debug, cameraRig, toggleBoost, toggleAircraft, cesiumWorld, missileSystem };
    const smoke = new URLSearchParams(window.location.search);
    if (smoke.has('autostart')) startBtn.click();
    if (smoke.has('sebbie')) toggleAircraft();
    if (smoke.has('boost')) toggleBoost();
  }

  function animate(timestamp) {
    requestAnimationFrame(animate);
    timer.update(timestamp);
    const dt = Math.min(0.05, timer.getDelta());
    debug.frames++;
    debug.simTime += dt;

    if (started && !paused) {
      updateFlightModel(flight, input, dt, getGroundHeight);
      orientAircraft();
      missileSystem.update(dt);

      // Spin the blades, and cross-fade to a blur disc as RPM climbs.
      const rpm = 3 + flight.throttle * 26 + (flight.boostActive ? 34 : 0);
      propAngle += rpm * dt;
      cessna.propGroup.rotation.z = propAngle;
      cessna.propDisc.material.opacity = Math.min(0.18, flight.throttle * 0.22);
      cessna.propBladeMat.opacity = 1 - Math.min(0.88, flight.throttle * 1.05);
      updateSR71Effects(sr71.afterburners, flight.throttle, flight.boostActive, debug.simTime);

      const newly = updateLandmarkDetection(markers, flight.position);
      for (const m of newly) {
        hud.markVisited(m);
        hud.toast(m.primary ? `Objective reached: ${m.name}` : `Landmark located: ${m.name}`);
      }
      const visitedCount = markers.filter((m) => m.visited).length;
      if (visitedCount === markers.length && markers.length > 0) {
        hud.toast('Mission complete — all Richmond landmarks located!');
      }

      const groundY = getGroundHeight(flight.position.x, flight.position.z);
      hud.update({
        agl: flight.position.y - groundY,
        speed: flight.speed,
        heading: flight.heading,
        throttle: flight.throttle,
        distanceToPrimary: primaryMarker ? distanceTo(primaryMarker.id, markers, flight.position) : null,
        visitedCount,
        total: markers.length,
        aircraftName: activeAircraft.name,
        boostActive: flight.boostActive,
      });
    }

    // Keep the shadow frustum tight around the aircraft so shadows stay sharp
    // across a 9km world instead of smearing over one huge map.
    sun.target.position.copy(flight.position);
    sun.target.updateMatrixWorld();
    sun.position.copy(flight.position).add(SUN_OFFSET);

    updateLandmarkGrounding(markers, cesiumWorld.sampleGroundAt, debug.simTime);
    updateWarpEffect(warpEffect, aircraftGroup, started && flight.boostActive, flight.speed, dt);
    updateCamera(camera, cameraRig, aircraftGroup, dt);
    cesiumWorld.render(camera);
    renderer.render(scene, camera);
  }
  animate();
}

main();
