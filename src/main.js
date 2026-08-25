import * as THREE from 'three';
import './style.css';
import { makeProjector } from './geo.js';
import { buildWorld } from './terrain.js';
import { buildAircraft } from './aircraft.js';
import { makeSkyTexture, buildClouds } from './sky.js';
import { buildLandmarkMarkers, updateLandmarkDetection, setMarkersVisible, distanceTo } from './landmarks.js';
import { createFlightState, updateFlightModel, FlightLimits } from './flightModel.js';
import { createControls } from './controls.js';
import { createCameraRig, toggleCameraMode, updateCamera } from './camera.js';
import { createHud } from './hud.js';

const canvas = document.getElementById('scene');

// Let the browser paint the loading screen before the (synchronous) world build.
const yieldToPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function main() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xbcd6e8, 2200, 8200);

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

  status.textContent = 'Generating Richmond terrain…';
  await yieldToPaint();
  const { getGroundHeight, worldSize } = buildWorld(scene, projector);

  status.textContent = 'Placing landmarks…';
  await yieldToPaint();
  const markers = buildLandmarkMarkers(scene, projector, landmarksData, getGroundHeight);
  const primaryMarker = markers.find((m) => m.primary);
  buildClouds(scene, worldSize);

  const { group: aircraftGroup, propGroup, propDisc, propBladeMat, cockpitHidden } = buildAircraft();
  scene.add(aircraftGroup);
  const applyCameraMode = () => {
    const inCockpit = cameraRig.mode === 'cockpit';
    for (const part of cockpitHidden) part.visible = !inCockpit;
  };

  // Start over the river just east of the CSX bridge, pointed downstream toward
  // Belle Isle and downtown, so the opening view has the good scenery in it.
  const spawn = projector.toWorld(37.5345, -77.49);
  const spawnPos = new THREE.Vector3(spawn.x, getGroundHeight(spawn.x, spawn.z) + 235, spawn.z);

  const aim = projector.toWorld(37.5292, -77.4528); // Belle Isle
  const spawnHeading = Math.atan2(aim.x - spawnPos.x, -(aim.z - spawnPos.z));

  const flight = createFlightState(spawnPos, spawnHeading);

  const cameraRig = createCameraRig();
  const hud = createHud(markers);
  let hudVisible = true;
  let markersVisible = true;
  let paused = false;
  let started = false;

  const { input } = createControls({
    onToggleCamera: () => {
      toggleCameraMode(cameraRig);
      applyCameraMode();
    },
    onReset: () => {
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
  });

  const startOverlay = document.getElementById('start-overlay');
  startBtn.addEventListener('click', () => {
    started = true;
    startOverlay.style.display = 'none';
  });

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
  }
  window.addEventListener('resize', onResize);
  onResize();

  status.textContent = 'Ready for departure.';
  startBtn.disabled = false;
  startBtn.textContent = 'Start Flight';

  const clock = new THREE.Clock();
  let propAngle = 0;

  // Dev-only handle for driving the sim from automated smoke tests.
  const debug = { frames: 0, simTime: 0 };
  if (import.meta.env.DEV) window.__sim = { flight, debug };

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    debug.frames++;
    debug.simTime += dt;

    if (started && !paused) {
      updateFlightModel(flight, input, dt, getGroundHeight);
      orientAircraft();

      // Spin the blades, and cross-fade to a blur disc as RPM climbs.
      const rpm = 3 + flight.throttle * 26;
      propAngle += rpm * dt;
      propGroup.rotation.z = propAngle;
      propDisc.material.opacity = Math.min(0.18, flight.throttle * 0.22);
      propBladeMat.opacity = 1 - Math.min(0.88, flight.throttle * 1.05);

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
      });
    }

    // Keep the shadow frustum tight around the aircraft so shadows stay sharp
    // across a 9km world instead of smearing over one huge map.
    sun.target.position.copy(flight.position);
    sun.target.updateMatrixWorld();
    sun.position.copy(flight.position).add(SUN_OFFSET);

    updateCamera(camera, cameraRig, aircraftGroup, dt);
    renderer.render(scene, camera);
  }
  animate();
}

main();
