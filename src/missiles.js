import * as THREE from 'three';

// --- Tunables -------------------------------------------------------------
const GRAVITY = -9.81;          // m/s^2, applied to Y each frame
const FIRE_COOLDOWN = 1.0;      // seconds between launches
const MISSILE_SPEED_BONUS = 60; // added on top of caller-supplied speed

// Fireball: requester asked for a much bigger, very visible burst — 5x the
// original spec (core 30 m -> 150 m, particles ~40 m -> ~200 m).
const CORE_START_RADIUS = 10;   // scaled up 5x from 2 m
const CORE_END_RADIUS = 150;    // scaled up 5x from 30 m
const CORE_DURATION = 1.4;      // seconds
const PARTICLE_COUNT = 60;
const PARTICLE_SPREAD = 200;    // radial burst distance, 5x of ~40 m
const PARTICLE_DURATION = 2.2;  // seconds
const LIGHT_COLOR = 0xff8822;
const LIGHT_INTENSITY = 40;
const LIGHT_DISTANCE = 80;
const LIGHT_DECAY = 2;
const LIGHT_FADE_TIME = 0.8;    // seconds to decay intensity to 0
const FIREBALL_LIFETIME = 2.2;  // remove everything after this age

// Color ramp white -> orange -> red -> transparent over core life.
const COLOR_STOPS = [
  { t: 0.0, color: new THREE.Color(0xffffff), opacity: 1.0 },
  { t: 0.35, color: new THREE.Color(0xffaa33), opacity: 1.0 },
  { t: 0.7, color: new THREE.Color(0xff3311), opacity: 0.85 },
  { t: 1.0, color: new THREE.Color(0xff2200), opacity: 0.0 },
];

function sampleFireballColor(t, out) {
  const clamped = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < COLOR_STOPS.length - 1 && COLOR_STOPS[i + 1].t < clamped) i++;
  const a = COLOR_STOPS[i];
  const b = COLOR_STOPS[Math.min(i + 1, COLOR_STOPS.length - 1)];
  const span = b.t - a.t || 1;
  const f = Math.max(0, Math.min(1, (clamped - a.t) / span));
  out.color.copy(a.color).lerp(b.color, f);
  out.opacity = a.opacity + (b.opacity - a.opacity) * f;
}

// --- Missile mesh ---------------------------------------------------------
let missileGeometry = null;
let missileMaterial = null;

function getMissileMesh() {
  if (!missileGeometry) {
    missileGeometry = new THREE.ConeGeometry(0.5, 3, 8);
    missileGeometry.rotateX(Math.PI / 2); // point +Z so we can align with velocity
    missileMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8d8e0,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x331100,
      emissiveIntensity: 0.4,
    });
  }
  return new THREE.Mesh(missileGeometry, missileMaterial);
}

// --- Fireball -------------------------------------------------------------
function makeRadialDirections(count) {
  const dirs = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform-ish sphere directions via golden angle spiral.
    const phi = Math.acos(1 - 2 * ((i + 0.5) / count));
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    dirs[i * 3] = Math.sin(phi) * Math.cos(theta);
    dirs[i * 3 + 1] = Math.cos(phi);
    dirs[i * 3 + 2] = Math.sin(phi) * Math.sin(theta);
  }
  return dirs;
}

function createFireball(scene, impactPoint) {
  const group = new THREE.Group();
  group.position.copy(impactPoint);

  // Core sphere: scales from CORE_START_RADIUS to CORE_END_RADIUS over CORE_DURATION.
  const coreGeo = new THREE.SphereGeometry(1, 24, 16);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.scale.setScalar(CORE_START_RADIUS);
  core.renderOrder = 20;
  group.add(core);

  // Particles: 60 vertices bursting radially to ~PARTICLE_SPREAD over PARTICLE_DURATION.
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const dirs = makeRadialDirections(PARTICLE_COUNT);
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xffbb55,
    size: 2.5,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  particles.frustumCulled = false;
  particles.renderOrder = 21;
  group.add(particles);

  // Light: decays to 0 over LIGHT_FADE_TIME.
  const light = new THREE.PointLight(LIGHT_COLOR, LIGHT_INTENSITY, LIGHT_DISTANCE, LIGHT_DECAY);
  group.add(light);

  scene.add(group);

  return {
    group,
    core,
    coreGeo,
    coreMat,
    particles,
    particleGeo,
    particleMat,
    dirs,
    light,
    age: 0,
  };
}

function disposeFireball(scene, fb) {
  scene.remove(fb.group);
  fb.coreGeo.dispose();
  fb.coreMat.dispose();
  fb.particleGeo.dispose();
  fb.particleMat.dispose();
}

function updateFireball(scene, fb, dt) {
  fb.age += dt;
  if (fb.age >= FIREBALL_LIFETIME) {
    disposeFireball(scene, fb);
    return false;
  }

  const coreT = Math.min(1, fb.age / CORE_DURATION);
  const radius = CORE_START_RADIUS + (CORE_END_RADIUS - CORE_START_RADIUS) * coreT;
  fb.core.scale.setScalar(radius);
  const scratch = { color: new THREE.Color(), opacity: 0 };
  sampleFireballColor(coreT, scratch);
  fb.coreMat.color.copy(scratch.color);
  fb.coreMat.opacity = scratch.opacity;

  const pT = Math.min(1, fb.age / PARTICLE_DURATION);
  const posAttr = fb.particleGeo.getAttribute('position');
  const arr = posAttr.array;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const d = pT * PARTICLE_SPREAD;
    arr[i * 3] = fb.dirs[i * 3] * d;
    arr[i * 3 + 1] = fb.dirs[i * 3 + 1] * d;
    arr[i * 3 + 2] = fb.dirs[i * 3 + 2] * d;
  }
  posAttr.needsUpdate = true;
  fb.particleMat.opacity = 1 - pT;

  const lT = Math.min(1, fb.age / LIGHT_FADE_TIME);
  fb.light.intensity = LIGHT_INTENSITY * (1 - lT);

  return true;
}

// --- System ---------------------------------------------------------------
export function createMissileSystem(scene, getGroundHeight) {
  const missiles = [];
  const fireballs = [];
  let lastFireTime = -Infinity;
  const clock = { now: 0 }; // accumulated simulation time

  const _forward = new THREE.Vector3();
  const _velocity = new THREE.Vector3();
  const _impact = new THREE.Vector3();

  function fire(origin, forward, speed) {
    if (clock.now - lastFireTime < FIRE_COOLDOWN) return false;
    lastFireTime = clock.now;

    const mesh = getMissileMesh();
    mesh.position.copy(origin);
    _forward.copy(forward).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _forward);
    scene.add(mesh);

    _velocity.copy(_forward).multiplyScalar(speed + MISSILE_SPEED_BONUS);
    missiles.push({ mesh, velocity: _velocity.clone() });
    return true;
  }

  function update(dt) {
    clock.now += dt;

    // Missiles: integrate gravity, move, check ground collision.
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.velocity.y += GRAVITY * dt;
      m.mesh.position.addScaledVector(m.velocity, dt);
      m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _forward.copy(m.velocity).normalize());

      const groundY = getGroundHeight(m.mesh.position.x, m.mesh.position.z);
      if (m.mesh.position.y <= groundY) {
        _impact.copy(m.mesh.position);
        _impact.y = groundY;
        scene.remove(m.mesh);
        missiles.splice(i, 1);
        fireballs.push(createFireball(scene, _impact));
      }
    }

    // Fireballs: animate and cull expired ones.
    for (let i = fireballs.length - 1; i >= 0; i--) {
      if (!updateFireball(scene, fireballs[i], dt)) {
        fireballs.splice(i, 1);
      }
    }
  }

  return { fire, update };
}