import * as THREE from 'three';
import { fbm2D, mulberry32 } from './noise.js';

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
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const radial = Math.max(0, 1 - Math.hypot(dx, dy));
      const billow = fbm2D(x * 0.027, y * 0.027, 5);
      const edge = Math.max(0, Math.min(1, (radial * 1.32 + billow * 0.38 - 0.36) * 2.25));
      const shade = 225 + Math.max(0, 1 - dy) * 15 + billow * 14;
      const i = (y * size + x) * 4;
      image.data[i] = Math.min(255, shade + 5);
      image.data[i + 1] = Math.min(255, shade + 8);
      image.data[i + 2] = Math.min(255, shade + 12);
      image.data[i + 3] = edge * radial * 245;
    }
  }
  ctx.putImageData(image, 0, 0);
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
