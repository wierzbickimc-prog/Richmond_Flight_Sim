import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export function buildWarpEffect(scene) {
  const rng = mulberry32(711967);
  const count = 180;
  const positions = new Float32Array(count * 6);
  const speeds = new Float32Array(count);
  const radii = new Float32Array(count);
  const angles = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    radii[i] = 5 + Math.pow(rng(), 0.6) * 52;
    angles[i] = rng() * Math.PI * 2;
    speeds[i] = 0.75 + rng() * 1.45;
    const z = -180 + rng() * 260;
    const x = Math.cos(angles[i]) * radii[i];
    const y = Math.sin(angles[i]) * radii[i] * 0.58;
    const o = i * 6;
    positions.set([x, y, z, x, y, z + 4], o);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: '#a8e9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 30;
  lines.visible = false;
  scene.add(lines);

  return { lines, positions, speeds, radii, angles, intensity: 0 };
}

export function updateWarpEffect(effect, aircraft, active, speed, dt) {
  effect.intensity += ((active ? 1 : 0) - effect.intensity) * Math.min(1, dt * (active ? 8 : 4));
  effect.lines.visible = effect.intensity > 0.015;
  effect.lines.material.opacity = effect.intensity * 0.74;
  effect.lines.position.copy(aircraft.position);
  effect.lines.quaternion.copy(aircraft.quaternion);

  const travel = Math.max(40, speed) * dt * 1.65;
  const length = 3 + effect.intensity * 28;
  for (let i = 0; i < effect.speeds.length; i++) {
    const o = i * 6;
    let z = effect.positions[o + 2] + travel * effect.speeds[i];
    if (z > 92) z -= 280;
    const x = Math.cos(effect.angles[i]) * effect.radii[i];
    const y = Math.sin(effect.angles[i]) * effect.radii[i] * 0.58;
    effect.positions[o] = effect.positions[o + 3] = x;
    effect.positions[o + 1] = effect.positions[o + 4] = y;
    effect.positions[o + 2] = z;
    effect.positions[o + 5] = z + length * effect.speeds[i];
  }
  effect.lines.geometry.attributes.position.needsUpdate = true;
}
