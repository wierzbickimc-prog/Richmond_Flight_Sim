import * as THREE from 'three';
import { fbm2D } from './noise.js';

// James River centerline control points (lat, lon), west to east, hand-picked from
// geocoded landmarks plus a couple of extra points so the curve exits the map cleanly.
const RIVER_CONTROL_POINTS = [
  { lat: 37.556, lon: -77.531 }, // west edge
  { lat: 37.5535, lon: -77.5201 }, // Pony Pasture
  { lat: 37.548, lon: -77.505 }, // near Cooper's / Reedy Creek area
  { lat: 37.5364, lon: -77.4939 }, // CSX A-Line bridge crossing
  { lat: 37.53, lon: -77.4535 }, // Hollywood Rapids
  { lat: 37.5292, lon: -77.4528 }, // Belle Isle
  { lat: 37.534, lon: -77.4423 }, // Brown's Island
  { lat: 37.5329, lon: -77.4383 }, // Pipeline Rapids
  { lat: 37.538, lon: -77.415 }, // east edge
];
const RIVER_WIDTHS = [70, 90, 130, 170, 190, 190, 170, 160, 150];

const WORLD_SIZE_X = 9000;
const WORLD_SIZE_Z = 8600;
const GROUND_SEGMENTS = 140;
const RIVER_SAMPLES = 220;

const RIVERBED_Y = -3.2;
const RIVER_SURFACE_Y = -1.4;
const BANK_FALLOFF = 55;

export const RIVER_SURFACE_LEVEL = RIVER_SURFACE_Y;

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}
function smoothstep(t) {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
function widthAt(t) {
  const f = t * (RIVER_WIDTHS.length - 1);
  const i = Math.min(RIVER_WIDTHS.length - 2, Math.floor(f));
  return lerp(RIVER_WIDTHS[i], RIVER_WIDTHS[i + 1], f - i);
}

function buildRiverCurve(projector) {
  const pts = RIVER_CONTROL_POINTS.map(({ lat, lon }) => {
    const { x, z } = projector.toWorld(lat, lon);
    return new THREE.Vector3(x, 0, z);
  });
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
}

// Precompute dense samples with position, tangent, normal (XZ plane) and width.
function sampleRiver(curve) {
  const samples = [];
  const points = curve.getSpacedPoints(RIVER_SAMPLES);
  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const tangent = curve.getTangentAt(Math.min(0.999, Math.max(0.001, t))).clone();
    tangent.y = 0;
    tangent.normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    samples.push({ p: points[i], tangent, normal, width: widthAt(t), t });
  }
  return samples;
}

function nearestSample(samples, x, z, hint) {
  let best = null;
  let bestD = Infinity;
  let bestI = -1;
  const lo = hint ? Math.max(0, hint.i - 40) : 0;
  const hi = hint ? Math.min(samples.length - 1, hint.i + 40) : samples.length - 1;
  for (let i = lo; i <= hi; i++) {
    const s = samples[i];
    const dx = x - s.p.x;
    const dz = z - s.p.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = s;
      bestI = i;
    }
  }
  return { sample: best, dist: Math.sqrt(bestD), i: bestI };
}

// Belle Isle footprint, derived from the same landmark point used for the river bend.
function bellIsleFootprint(projector) {
  const { x, z } = projector.toWorld(37.5292, -77.4528);
  return { x, z, a: 380, b: 175, angle: 0.35, height: 9 };
}

// Bluff behind Hollywood Cemetery / Oregon Hill, overlooking Hollywood Rapids.
function bluffFootprint(projector) {
  const { x, z } = projector.toWorld(37.5335, -77.457);
  return { x, z, radius: 520, height: 34 };
}

function downtownRect(projector) {
  const c = projector.toWorld(37.5395, -77.435);
  return { x: c.x, z: c.z, halfX: 620, halfZ: 520 };
}

function seddonRect(projector) {
  const c = projector.toWorld(37.5812115, -77.4675572);
  return { x: c.x, z: c.z, halfX: 420, halfZ: 380 };
}

export function buildWorld(scene, projector) {
  const curve = buildRiverCurve(projector);
  const samples = sampleRiver(curve);
  const island = bellIsleFootprint(projector);
  const bluff = bluffFootprint(projector);
  const downtown = downtownRect(projector);
  const seddon = seddonRect(projector);

  function islandHeight(x, z) {
    const dx = x - island.x;
    const dz = z - island.z;
    const ca = Math.cos(island.angle);
    const sa = Math.sin(island.angle);
    const rx = dx * ca + dz * sa;
    const rz = -dx * sa + dz * ca;
    const d = Math.sqrt((rx / island.a) ** 2 + (rz / island.b) ** 2);
    if (d >= 1) return 0;
    return island.height * smoothstep(1 - d / 0.85 + 0.15);
  }

  function bluffHeight(x, z) {
    const d = Math.hypot(x - bluff.x, z - bluff.z);
    if (d >= bluff.radius) return 0;
    return bluff.height * smoothstep(1 - d / bluff.radius);
  }

  function riverCarve(x, z, hint) {
    const { sample, dist, i } = nearestSample(samples, x, z, hint);
    const band = sample.width / 2 + BANK_FALLOFF;
    if (dist >= band) return { carved: null, i };
    const inner = sample.width / 2;
    let h;
    if (dist <= inner) {
      h = RIVERBED_Y;
    } else {
      const t = (dist - inner) / (band - inner);
      h = lerp(RIVERBED_Y, 0.4, smoothstep(t));
    }
    return { carved: h, dist, band, inner, i };
  }

  // Ground height used both for mesh generation and runtime queries (soft floor, beacon placement).
  function getGroundHeight(x, z, hint) {
    const base = 0.4 + fbm2D(x * 0.0009, z * 0.0009) * 3.2;
    const withBluff = base + bluffHeight(x, z);
    const river = riverCarve(x, z, hint);
    let h = river.carved !== null ? river.carved : withBluff;
    const isl = islandHeight(x, z);
    if (isl > 0) h = Math.max(h, isl + fbm2D(x * 0.004, z * 0.004) * 0.6);
    return h;
  }

  buildGroundMesh(scene, getGroundHeight, samples, downtown, seddon, island);
  buildRiverMesh(scene, samples, projector);
  buildSkyline(scene, downtown, getGroundHeight);
  buildIslandTrees(scene, island, getGroundHeight);
  const bridgeInfo = buildBridge(scene, projector, samples, getGroundHeight);
  buildNeighborhood(scene, seddon, getGroundHeight);

  return {
    getGroundHeight,
    worldSize: { x: WORLD_SIZE_X, z: WORLD_SIZE_Z },
    bridgeInfo,
  };
}

function buildGroundMesh(scene, getGroundHeight, samples, downtown, seddon, island) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE_X, WORLD_SIZE_Z, GROUND_SEGMENTS, GROUND_SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const greenA = new THREE.Color('#4a7a3c');
  const greenB = new THREE.Color('#5f9450');
  const sand = new THREE.Color('#c9b385');
  const gray = new THREE.Color('#8a8f96');
  const parkGreen = new THREE.Color('#3f6b34');

  let hint = null;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = getGroundHeight(x, z, hint);
    pos.setY(i, h);

    const nearRiverBand = (() => {
      const dx = x;
      const dz = z;
      let bestD = Infinity;
      let bestW = 150;
      for (let s = 0; s < samples.length; s += 6) {
        const sample = samples[s];
        const d = Math.hypot(dx - sample.p.x, dz - sample.p.z);
        if (d < bestD) {
          bestD = d;
          bestW = sample.width;
        }
      }
      return bestD - bestW / 2;
    })();

    let color = fbm2D(x * 0.003, z * 0.003) > 0.5 ? greenA : greenB;
    if (nearRiverBand > 0 && nearRiverBand < 30) {
      color = sand;
    }
    const inDowntown = Math.abs(x - downtown.x) < downtown.halfX && Math.abs(z - downtown.z) < downtown.halfZ;
    const inSeddon = Math.abs(x - seddon.x) < seddon.halfX && Math.abs(z - seddon.z) < seddon.halfZ;
    if (inDowntown) color = gray;
    if (inSeddon) color = greenB;
    const dIsl = Math.hypot(x - island.x, z - island.z);
    if (dIsl < island.a * 1.1) color = parkGreen.clone().lerp(color, clamp01(dIsl / (island.a * 1.1)));

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildRiverMesh(scene, samples, projector) {
  const positions = [];
  const colors = [];
  const indices = [];
  const water = new THREE.Color('#3a6ea5');
  const foam = new THREE.Color('#cfe3ee');

  const rapidPoints = [
    projector.toWorld(37.529950, -77.453467), // Hollywood Rapids
    projector.toWorld(37.5328704, -77.4383416), // Pipeline Rapids
  ];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const halfW = s.width / 2;
    const left = s.p.clone().addScaledVector(s.normal, halfW);
    const right = s.p.clone().addScaledVector(s.normal, -halfW);
    left.y = RIVER_SURFACE_Y;
    right.y = RIVER_SURFACE_Y;
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

    let isRapid = false;
    for (const r of rapidPoints) {
      if (Math.hypot(s.p.x - r.x, s.p.z - r.z) < 140) isRapid = true;
    }
    const c = isRapid ? foam : water;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);

    if (i > 0) {
      const a = (i - 1) * 2;
      const b = i * 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    shininess: 60,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSkyline(scene, downtown, getGroundHeight) {
  const rng = mulberry32(1916);
  const count = 46;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#b9c2cc' });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const x = downtown.x + (rng() - 0.5) * downtown.halfX * 1.8;
    const z = downtown.z + (rng() - 0.5) * downtown.halfZ * 1.8;
    const h = 18 + rng() * rng() * 130;
    const w = 22 + rng() * 26;
    const d = 22 + rng() * 26;
    const base = getGroundHeight(x, z);
    dummy.position.set(x, base + h / 2, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = rng() * Math.PI;
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  scene.add(mesh);
}

function buildIslandTrees(scene, island, getGroundHeight) {
  const rng = mulberry32(54);
  const count = 90;
  const trunkGeo = new THREE.ConeGeometry(4, 16, 6);
  const mat = new THREE.MeshLambertMaterial({ color: '#2f5a26' });
  const mesh = new THREE.InstancedMesh(trunkGeo, mat, count);
  const dummy = new THREE.Object3D();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 6) {
    attempts++;
    const rx = (rng() - 0.5) * 2 * island.a * 0.9;
    const rz = (rng() - 0.5) * 2 * island.b * 0.9;
    const ca = Math.cos(island.angle);
    const sa = Math.sin(island.angle);
    const x = island.x + rx * ca - rz * sa;
    const z = island.z + rx * sa + rz * ca;
    const d = Math.sqrt((rx / island.a) ** 2 + (rz / island.b) ** 2);
    if (d > 0.85) continue;
    const base = getGroundHeight(x, z);
    const s = 0.6 + rng() * 0.9;
    dummy.position.set(x, base + 8 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = rng() * Math.PI;
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

function buildBridge(scene, projector, samples, getGroundHeight) {
  const target = projector.toWorld(37.5364, -77.4939);
  const { sample } = nearestSample(samples, target.x, target.z);
  const span = sample.width + 90;
  const deckThickness = 4.5;
  const deckWidth = 11;
  const riverY = RIVER_SURFACE_Y;
  const deckY = riverY + 14;

  const deckGeo = new THREE.BoxGeometry(span, deckThickness, deckWidth);
  const deckMat = new THREE.MeshLambertMaterial({ color: '#9a9a92' });
  const deck = new THREE.Mesh(deckGeo, deckMat);

  const m = new THREE.Matrix4();
  const xAxis = sample.normal.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = sample.tangent.clone().normalize();
  m.makeBasis(xAxis, yAxis, zAxis);
  deck.quaternion.setFromRotationMatrix(m);
  deck.position.set(sample.p.x, deckY, sample.p.z);
  deck.castShadow = true;
  scene.add(deck);

  const pierMat = new THREE.MeshLambertMaterial({ color: '#7d7d76' });
  const pierCount = 4;
  for (let i = 1; i < pierCount; i++) {
    const t = i / pierCount - 0.5;
    const off = xAxis.clone().multiplyScalar(t * span * 0.92);
    const px = sample.p.x + off.x;
    const pz = sample.p.z + off.z;
    const groundY = getGroundHeight(px, pz);
    const pierHeight = deckY - groundY - deckThickness / 2;
    if (pierHeight <= 0.5) continue;
    const pierGeo = new THREE.BoxGeometry(6, pierHeight, 6);
    const pier = new THREE.Mesh(pierGeo, pierMat);
    pier.position.set(px, groundY + pierHeight / 2, pz);
    scene.add(pier);
  }

  return { position: sample.p.clone(), normal: sample.normal.clone(), deckY };
}

function buildNeighborhood(scene, seddon, getGroundHeight) {
  const rng = mulberry32(1801);
  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofMat = new THREE.MeshLambertMaterial({ color: '#8a5a44' });
  const houseCount = 42;
  const mesh = new THREE.InstancedMesh(houseGeo, roofMat, houseCount);
  const dummy = new THREE.Object3D();

  const cols = 7;
  const rows = 6;
  let idx = 0;
  for (let r = 0; r < rows && idx < houseCount; r++) {
    for (let c = 0; c < cols && idx < houseCount; c++) {
      const gx = (c / (cols - 1) - 0.5) * seddon.halfX * 1.7 + (rng() - 0.5) * 20;
      const gz = (r / (rows - 1) - 0.5) * seddon.halfZ * 1.7 + (rng() - 0.5) * 20;
      const x = seddon.x + gx;
      const z = seddon.z + gz;
      const base = getGroundHeight(x, z);
      const h = 5.5 + rng() * 3.5;
      dummy.position.set(x, base + h / 2, z);
      dummy.scale.set(9 + rng() * 3, h, 10 + rng() * 3);
      dummy.rotation.y = (rng() - 0.5) * 0.3;
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      idx++;
    }
  }
  mesh.count = idx;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  // A couple of simple road strips through the neighborhood grid for visual context.
  const roadMat = new THREE.MeshLambertMaterial({ color: '#555a5f' });
  for (let r = -1; r <= 1; r += 2) {
    const geo = new THREE.PlaneGeometry(seddon.halfX * 2, 7);
    geo.rotateX(-Math.PI / 2);
    const road = new THREE.Mesh(geo, roadMat);
    const z = seddon.z + r * seddon.halfZ * 0.55;
    road.position.set(seddon.x, getGroundHeight(seddon.x, z) + 0.15, z);
    scene.add(road);
  }
}
