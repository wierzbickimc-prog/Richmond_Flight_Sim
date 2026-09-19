import * as THREE from 'three';
import { FlightLimits } from './flightModel.js';

const skin = new THREE.MeshStandardMaterial({ color: '#090b0d', roughness: 0.5, metalness: 0.66 });
const edge = new THREE.MeshStandardMaterial({ color: '#171b1e', roughness: 0.42, metalness: 0.72 });
const inlet = new THREE.MeshStandardMaterial({ color: '#262b2e', roughness: 0.25, metalness: 0.9 });
const glass = new THREE.MeshPhysicalMaterial({
  color: '#163140', roughness: 0.1, metalness: 0.25, transmission: 0.12, transparent: true, opacity: 0.92,
});

// Extrude a top-down polygon into a thin, closed lifting surface.
function planformGeometry(points, thickness = 0.16) {
  const positions = [];
  const indices = [];
  const n = points.length;
  for (const y of [thickness / 2, -thickness / 2]) {
    for (const [x, z] of points) positions.push(x, y, z);
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i, i + 1, n, n + i + 1, n + i);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, n + i, j, j, n + i, n + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeFin(side) {
  const shape = new THREE.Shape();
  shape.moveTo(-2.2, 0);
  shape.lineTo(0.2, 3.8);
  shape.lineTo(2.15, 3.2);
  shape.lineTo(1.35, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(side * 3.15, 0.16, 6.5);
  const fin = new THREE.Mesh(geo, skin);
  fin.rotation.z = -side * 0.12;
  return fin;
}

function makePanelLines() {
  const points = [];
  const add = (x1, z1, x2, z2) => points.push(x1, 0.16, z1, x2, 0.16, z2);
  for (const side of [-1, 1]) {
    add(side * 2.0, -7.2, side * 7.25, 1.3);
    add(side * 2.45, -2.8, side * 6.2, 2.7);
    add(side * 2.9, 2.1, side * 3.0, 7.8);
    add(side * 4.0, 1.0, side * 7.3, 2.2);
  }
  add(-1.7, -9.0, 1.7, -9.0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#3b4246', transparent: true, opacity: 0.62 }));
}

function makeAfterburner(x) {
  const group = new THREE.Group();
  group.position.set(x, -0.04, 9.45);
  const hotMat = new THREE.MeshBasicMaterial({
    color: '#e8fcff', transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const blueMat = new THREE.MeshBasicMaterial({
    color: '#269cff', transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const amberMat = new THREE.MeshBasicMaterial({
    color: '#ff9a3c', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.72, 6.3, 20, 1, true), blueMat);
  outer.rotation.x = Math.PI / 2;
  outer.position.z = 3.0;
  group.add(outer);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.32, 3.9, 16, 1, true), amberMat);
  core.rotation.x = Math.PI / 2;
  core.position.z = 1.65;
  group.add(core);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.56, 24), hotMat);
  glow.position.z = 0.02;
  group.add(glow);

  const diamonds = [];
  for (let i = 0; i < 4; i++) {
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), hotMat.clone());
    diamond.scale.set(0.82 - i * 0.1, 0.82 - i * 0.1, 1.2 + i * 0.12);
    diamond.position.z = 1.25 + i * 1.28;
    group.add(diamond);
    diamonds.push(diamond);
  }
  group.userData = { outer, core, glow, diamonds, materials: [hotMat, blueMat, amberMat] };
  return group;
}

export function buildSR71() {
  const group = new THREE.Group();
  group.name = 'Sebbie Mode — SR-71 Blackbird';
  const planform = [
    [0, -13.2], [1.65, -10.2], [2.25, -6.5], [8.45, 1.4], [8.15, 3.25],
    [3.45, 2.95], [2.5, 10.6], [0, 11.4], [-2.5, 10.6], [-3.45, 2.95],
    [-8.15, 3.25], [-8.45, 1.4], [-2.25, -6.5], [-1.65, -10.2],
  ];
  const wing = new THREE.Mesh(planformGeometry(planform, 0.22), skin);
  group.add(wing);

  const profile = [
    [0.03, 0], [0.2, 0.7], [0.48, 2.2], [0.72, 4.1], [0.88, 7.0],
    [0.9, 13.5], [0.78, 19.0], [0.58, 23.1], [0.16, 25.1], [0.03, 25.4],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fuseGeo = new THREE.LatheGeometry(profile, 24);
  fuseGeo.rotateX(Math.PI / 2);
  fuseGeo.translate(0, 0, -13.0);
  const fuselage = new THREE.Mesh(fuseGeo, edge);
  fuselage.scale.y = 0.82;
  group.add(fuselage);

  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 8.5, 5, 12), edge);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(0, 0.38, -1.1);
  group.add(spine);

  const canopies = [];
  for (const [z, scale] of [[-7.5, 1], [-5.85, 0.84]]) {
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), glass);
    canopy.scale.set(0.62 * scale, 0.42 * scale, 1.12 * scale);
    canopy.position.set(0, 0.54, z);
    group.add(canopy);
    canopies.push(canopy);
  }

  const afterburners = [];
  for (const side of [-1, 1]) {
    const nacelle = new THREE.Group();
    nacelle.position.x = side * 4.25;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 1.02, 13.7, 24), edge);
    body.rotation.x = Math.PI / 2;
    body.position.z = 2.6;
    nacelle.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.12, 8, 28), inlet);
    rim.position.z = -4.28;
    nacelle.add(rim);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.76, 24), new THREE.MeshBasicMaterial({ color: '#020303' }));
    intake.position.z = -4.25;
    nacelle.add(intake);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.39, 2.45, 20), inlet);
    spike.rotation.x = -Math.PI / 2;
    spike.position.z = -5.25;
    nacelle.add(spike);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.78, 1.15, 20, 1, true), inlet);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 9.65;
    nacelle.add(nozzle);
    group.add(nacelle);

    const burner = makeAfterburner(side * 4.25);
    group.add(burner);
    afterburners.push(burner);
  }

  // Orange afterburner glow shell, revealed once the Blackbird nears its
  // top speed (see updateSR71Effects). Additive + BackSide so it reads as a
  // soft halo around the airframe rather than a solid ball.
  const glowMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({
      color: '#ff6600',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  glowMesh.scale.set(11, 3.5, 17);
  glowMesh.visible = false;
  group.add(glowMesh);

  group.add(makeFin(-1), makeFin(1), makePanelLines());
  const accentMat = new THREE.MeshBasicMaterial({ color: '#aa2024' });
  for (const side of [-1, 1]) {
    const accent = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.018, 2.2), accentMat);
    accent.position.set(side * 2.1, 0.19, -5.0);
    accent.rotation.y = side * 0.13;
    group.add(accent);
  }
  group.traverse((obj) => {
    if (obj.isMesh && !obj.material.transparent) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return { group, afterburners, glowMesh, cockpitHidden: [fuselage, spine, wing, ...canopies] };
}

export function updateSR71Effects(afterburners, throttle, boostActive, time, speed, glowMesh) {
  const power = 0.42 + throttle * 0.58;
  const boost = boostActive ? 2.25 : 1;
  const pulse = 0.94 + Math.sin(time * 31) * 0.055 + Math.sin(time * 17.3) * 0.035;
  for (let e = 0; e < afterburners.length; e++) {
    const { outer, core, glow, diamonds, materials } = afterburners[e].userData;
    outer.scale.set(0.82 + power * 0.2, 0.82 + power * 0.2, power * boost * pulse);
    core.scale.set(0.85, 0.85, power * (boostActive ? 1.65 : 0.82) * pulse);
    glow.scale.setScalar(0.8 + power * 0.42 + (boostActive ? 0.35 : 0));
    materials[0].opacity = Math.min(1, 0.58 + power * 0.32 + (boostActive ? 0.1 : 0));
    materials[1].opacity = 0.3 + power * 0.24 + (boostActive ? 0.2 : 0);
    materials[2].opacity = 0.2 + power * 0.22;
    for (let i = 0; i < diamonds.length; i++) {
      const d = diamonds[i];
      d.material.opacity = (boostActive ? 0.92 : 0.58) - i * 0.075;
      const flicker = pulse * (1 + Math.sin(time * 23 + i * 2.7 + e) * 0.045);
      d.scale.z = (1.25 + i * 0.14) * flicker * (boostActive ? 1.45 : 1);
    }
  }

  // Speed-based orange halo: fades in over the top 15% of the Blackbird's
  // boost speed range, with a slow ~4 s breathing pulse.
  if (glowMesh) {
    const ratio = speed / FlightLimits.SR71_BOOST_MAX_SPEED;
    if (ratio >= 0.85) {
      const t = Math.min(1, (ratio - 0.85) / 0.15);
      const breathe = 0.82 + Math.sin(time * ((Math.PI * 2) / 4)) * 0.18;
      glowMesh.visible = true;
      glowMesh.material.opacity = 0.38 * t * breathe;
    } else {
      glowMesh.visible = false;
    }
  }
}
