import * as THREE from 'three';
import './style.css';
import { makeProjector } from './geo.js';
import { buildWorld } from './terrain.js';
import { buildAircraft } from './aircraft.js';
import { buildLandmarkMarkers, updateLandmarkDetection, setMarkersVisible, distanceTo } from './landmarks.js';
import { createFlightState, updateFlightModel, FlightLimits } from './flightModel.js';
import { createControls } from './controls.js';
import { createCameraRig, toggleCameraMode, updateCamera } from './camera.js';
import { createHud } from './hud.js';

const canvas = document.getElementById('scene');

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3d7fc9');
  grad.addColorStop(0.55, '#a9d3ec');
  grad.addColorStop(1, '#e8f3f7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function main() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xaed3ec, 1600, 6200);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 9000);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a5a3c, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.1);
  sun.position.set(-1200, 1400, 800);
  scene.add(sun);

  const landmarksData = await fetch('/data/landmarks.json').then((r) => r.json());
  const projector = makeProjector(landmarksData.origin.lat, landmarksData.origin.lon);

  const { getGroundHeight } = buildWorld(scene, projector);
  const markers = buildLandmarkMarkers(scene, projector, landmarksData, getGroundHeight);
  const primaryMarker = markers.find((m) => m.primary);

  const { group: aircraftGroup, propGroup } = buildAircraft();
  scene.add(aircraftGroup);

  // Spawn over the downtown river stretch, facing toward the primary objective.
  const spawnLatLon = { lat: 37.535, lon: -77.475 };
  const spawnGround = projector.toWorld(spawnLatLon.lat, spawnLatLon.lon);
  const spawnGroundY = getGroundHeight(spawnGround.x, spawnGround.z);
  const spawnAltitude = 165;
  const spawnPos = new THREE.Vector3(spawnGround.x, spawnGroundY + spawnAltitude, spawnGround.z);

  let spawnHeading = 0;
  if (primaryMarker) {
    const dx = primaryMarker.worldPos.x - spawnPos.x;
    const dz = primaryMarker.worldPos.z - spawnPos.z;
    spawnHeading = Math.atan2(dx, -dz);
  }

  const flight = createFlightState(spawnPos, spawnHeading);

  const cameraRig = createCameraRig();
  const hud = createHud(markers);
  let hudVisible = true;
  let markersVisible = true;
  let paused = false;
  let started = false;

  const { input } = createControls({
    onToggleCamera: () => toggleCameraMode(cameraRig),
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
  document.getElementById('start-btn').addEventListener('click', () => {
    started = true;
    startOverlay.style.display = 'none';
  });

  const upWorld = new THREE.Vector3(0, 1, 0);
  const rollAxisTmp = new THREE.Vector3();
  const upTmp = new THREE.Vector3();
  const lookTargetTmp = new THREE.Vector3();

  function orientAircraft() {
    rollAxisTmp.copy(flight.forward);
    upTmp.copy(upWorld).applyAxisAngle(rollAxisTmp, -flight.roll);
    aircraftGroup.up.copy(upTmp);
    lookTargetTmp.copy(flight.position).add(flight.forward);
    aircraftGroup.position.copy(flight.position);
    aircraftGroup.lookAt(lookTargetTmp);
  }
  orientAircraft();
  updateCamera(camera, cameraRig, aircraftGroup, 1);

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);
  onResize();

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());

    if (started && !paused) {
      updateFlightModel(flight, input, dt, getGroundHeight);
      orientAircraft();
      propGroup.rotation.z += (2 + flight.throttle * 24) * dt;

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

    updateCamera(camera, cameraRig, aircraftGroup, dt);
    renderer.render(scene, camera);
  }
  animate();
}

main();
