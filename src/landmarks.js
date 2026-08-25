import * as THREE from 'three';
import { RIVER_SURFACE_LEVEL } from './terrain.js';

const GOLD = new THREE.Color('#ffcc33');
const CYAN = new THREE.Color('#33ccff');
const VISITED = new THREE.Color('#39ff8a');

function makeLabelSprite(text, primary) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10, 16, 20, 0.55)';
  ctx.beginPath();
  ctx.roundRect(8, 24, 496, 80, 14);
  ctx.fill();
  ctx.font = primary ? 'bold 40px system-ui, sans-serif' : 'bold 34px system-ui, sans-serif';
  ctx.fillStyle = primary ? '#ffd966' : '#bdeeff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(46, 11.5, 1);
  return sprite;
}

export function buildLandmarkMarkers(scene, projector, landmarksData, getGroundHeight) {
  const markers = [];

  for (const lm of landmarksData.landmarks) {
    const { x, z } = projector.toWorld(lm.lat, lm.lon);
    const groundY = Math.max(getGroundHeight(x, z), RIVER_SURFACE_LEVEL + 0.4);
    const color = lm.primary ? GOLD : CYAN;

    const group = new THREE.Group();
    group.position.set(x, groundY, z);
    scene.add(group);

    const beamHeight = 130;
    const beamGeo = new THREE.CylinderGeometry(1.6, 3.2, beamHeight, 10, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = beamHeight / 2;
    group.add(beam);

    const postGeo = new THREE.CylinderGeometry(0.6, 0.6, 6, 8);
    const postMat = new THREE.MeshBasicMaterial({ color });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 3;
    group.add(post);

    const ringGeo = new THREE.RingGeometry(lm.radius_m - 1.2, lm.radius_m, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    group.add(ring);

    const label = makeLabelSprite(lm.name, lm.primary);
    label.position.y = beamHeight * 0.34;
    group.add(label);

    markers.push({
      id: lm.id,
      name: lm.name,
      primary: !!lm.primary,
      radius: lm.radius_m,
      worldPos: new THREE.Vector3(x, groundY, z),
      visited: false,
      beamMat,
      postMat,
      ringMat,
      group,
    });
  }

  markers.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  return markers;
}

export function setMarkersVisible(markers, visible) {
  for (const m of markers) m.group.visible = visible;
}

// Returns any markers newly visited this frame.
export function updateLandmarkDetection(markers, aircraftPos) {
  const newlyVisited = [];
  for (const m of markers) {
    if (m.visited) continue;
    const dx = aircraftPos.x - m.worldPos.x;
    const dz = aircraftPos.z - m.worldPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= m.radius) {
      m.visited = true;
      m.beamMat.color.copy(VISITED);
      m.postMat.color.copy(VISITED);
      m.ringMat.color.copy(VISITED);
      newlyVisited.push(m);
    }
  }
  return newlyVisited;
}

export function distanceTo(markerId, markers, aircraftPos) {
  const m = markers.find((mk) => mk.id === markerId);
  if (!m) return null;
  return Math.hypot(aircraftPos.x - m.worldPos.x, aircraftPos.z - m.worldPos.z);
}
