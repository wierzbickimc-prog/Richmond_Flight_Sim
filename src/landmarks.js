import * as THREE from 'three';
import { RIVER_SURFACE_LEVEL } from './terrain.js';

const GOLD = new THREE.Color('#ffcc33');
const CYAN = new THREE.Color('#33ccff');
const VISITED = new THREE.Color('#39ff8a');

function makeLabelSprite(text, primary) {
  const W = 1024;
  const H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Shrink the type until the longest names fit rather than clipping them.
  const basePx = primary ? 60 : 52;
  let fontPx = basePx;
  const font = (px) => `bold ${px}px system-ui, -apple-system, sans-serif`;
  ctx.font = font(fontPx);
  const maxTextW = W - 90;
  while (ctx.measureText(text).width > maxTextW && fontPx > 22) {
    fontPx -= 2;
    ctx.font = font(fontPx);
  }
  const textW = ctx.measureText(text).width;

  const padX = 30;
  const boxW = textW + padX * 2;
  const boxH = fontPx + 34;
  const boxX = (W - boxW) / 2;
  const boxY = (H - boxH) / 2;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8, 14, 19, 0.62)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 14);
  ctx.fill();
  ctx.strokeStyle = primary ? 'rgba(255,214,102,0.75)' : 'rgba(150,220,255,0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = font(fontPx);
  ctx.fillStyle = primary ? '#ffd966' : '#c9eeff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  // Scale from the drawn box so every label reads at the same physical size.
  const worldW = primary ? 300 : 250;
  sprite.scale.set(worldW, (worldW * H) / W, 1);
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

    const beamHeight = lm.primary ? 620 : 420;
    const beamGeo = new THREE.CylinderGeometry(3.5, 9, beamHeight, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: lm.primary ? 0.34 : 0.24,
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
    label.position.y = beamHeight * 0.55;
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
