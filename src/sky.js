import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#1f5fae');
  grad.addColorStop(0.35, '#4e8fd0');
  grad.addColorStop(0.72, '#9fc8e6');
  grad.addColorStop(1.0, '#dbe9f2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePuffTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(252,253,255,0.72)');
  grad.addColorStop(0.75, 'rgba(228,238,248,0.28)');
  grad.addColorStop(1.0, 'rgba(220,232,245,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// Fair-weather cumulus, built from clustered billboards. Kept above the
// aircraft's altitude ceiling so they add depth without ever blocking the view.
export function buildClouds(scene, worldSize) {
  const rng = mulberry32(4242);
  const tex = makePuffTexture();
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });

  const group = new THREE.Group();
  const CLOUDS = 70;

  for (let i = 0; i < CLOUDS; i++) {
    const cx = (rng() - 0.5) * worldSize.x * 1.5;
    const cz = (rng() - 0.5) * worldSize.z * 1.5;
    const cy = 620 + rng() * 700;
    const scale = 190 + rng() * 320;
    const puffs = 4 + Math.floor(rng() * 4);

    for (let p = 0; p < puffs; p++) {
      const sprite = new THREE.Sprite(material);
      sprite.position.set(
        cx + (rng() - 0.5) * scale * 1.5,
        cy + (rng() - 0.5) * scale * 0.28,
        cz + (rng() - 0.5) * scale * 1.5
      );
      const s = scale * (0.55 + rng() * 0.6);
      sprite.scale.set(s, s * (0.5 + rng() * 0.22), 1);
      group.add(sprite);
    }
  }

  scene.add(group);
  return group;
}
