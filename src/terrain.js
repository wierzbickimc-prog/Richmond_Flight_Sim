import * as THREE from 'three';
import { fbm2D, tileableFbm, mulberry32 } from './noise.js';

// James River centerline (lat, lon), west to east. Anchored on geocoded landmarks,
// with extra points so the channel enters and exits the playable area cleanly.
const RIVER_CONTROL_POINTS = [
  { lat: 37.5585, lon: -77.534 },
  { lat: 37.556, lon: -77.5255 },
  { lat: 37.5535, lon: -77.5201 }, // Pony Pasture
  { lat: 37.5508, lon: -77.513 },
  { lat: 37.548, lon: -77.505 }, // Cooper's / Reedy Creek reach
  { lat: 37.5432, lon: -77.4995 },
  { lat: 37.5364, lon: -77.4939 }, // CSX A-Line bridge crossing
  { lat: 37.5318, lon: -77.479 },
  { lat: 37.53, lon: -77.465 },
  { lat: 37.5305, lon: -77.4578 }, // Hollywood Rapids
  { lat: 37.5292, lon: -77.4528 }, // Belle Isle
  { lat: 37.5312, lon: -77.447 },
  { lat: 37.534, lon: -77.4423 }, // Brown's Island
  { lat: 37.5329, lon: -77.4383 }, // Pipeline Rapids
  { lat: 37.532, lon: -77.427 },
  { lat: 37.535, lon: -77.413 },
];
// The reach through Hollywood Rapids and Belle Isle is broad and braided -- it
// has to be wider than the island itself, or Belle Isle silts up into both banks
// instead of standing in the channel.
const RIVER_WIDTHS = [80, 95, 110, 125, 145, 165, 190, 230, 330, 430, 470, 380, 240, 190, 180, 185];

const WORLD_SIZE_X = 9600;
const WORLD_SIZE_Z = 9200;
const GROUND_SEGMENTS = 420;
const RIVER_SAMPLES = 300;

const RIVERBED_Y = -4.0;
const RIVER_SURFACE_Y = -1.4;
const BANK_FALLOFF = 46;
const GRID_CELL = 220;

export const RIVER_SURFACE_LEVEL = RIVER_SURFACE_Y;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

function widthAt(t) {
  const f = t * (RIVER_WIDTHS.length - 1);
  const i = Math.min(RIVER_WIDTHS.length - 2, Math.floor(f));
  return lerp(RIVER_WIDTHS[i], RIVER_WIDTHS[i + 1], f - i);
}

// ---------------------------------------------------------------- river geometry

function sampleRiver(projector) {
  const pts = RIVER_CONTROL_POINTS.map(({ lat, lon }) => {
    const { x, z } = projector.toWorld(lat, lon);
    return new THREE.Vector3(x, 0, z);
  });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  const points = curve.getSpacedPoints(RIVER_SAMPLES);

  const samples = [];
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

// Uniform grid so per-vertex "distance to river" is a small local lookup rather
// than a scan over every sample (the ground mesh alone issues ~180k queries).
function buildSampleGrid(samples) {
  const grid = new Map();
  for (let i = 0; i < samples.length; i++) {
    const cx = Math.floor(samples[i].p.x / GRID_CELL);
    const cz = Math.floor(samples[i].p.z / GRID_CELL);
    const key = `${cx},${cz}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(i);
  }
  return grid;
}

function queryRiver(samples, grid, x, z) {
  const cx = Math.floor(x / GRID_CELL);
  const cz = Math.floor(z / GRID_CELL);
  let best = null;
  let bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bucket = grid.get(`${cx + dx},${cz + dz}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const s = samples[i];
        const d = (x - s.p.x) ** 2 + (z - s.p.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
  }
  if (!best) return null;
  return { sample: best, dist: Math.sqrt(bestD) };
}

// ---------------------------------------------------------------- named footprints

function footprints(projector) {
  const at = (lat, lon) => projector.toWorld(lat, lon);
  return {
    belle: { ...at(37.5292, -77.4528), a: 400, b: 135, angle: 0.16, height: 12 },
    bluff: { ...at(37.5348, -77.457), radius: 620, height: 46 },
    churchHill: { ...at(37.532, -77.42), radius: 500, height: 40 },
    downtown: { ...at(37.541, -77.439), rx: 780, rz: 620 },
    seddon: { ...at(37.5812115, -77.4675572), rx: 560, rz: 500 },
    manchester: { ...at(37.524, -77.44), rx: 620, rz: 460 },
    fan: { ...at(37.551, -77.462), rx: 820, rz: 400 },
  };
}

// Soft, noise-perturbed zone falloff. Rectangular `inRect` tests stamp visible
// hard-edged boxes onto the terrain; this fades out with an irregular boundary.
function zoneWeight(x, z, zone) {
  const dx = (x - zone.x) / zone.rx;
  const dz = (z - zone.z) / zone.rz;
  const d = Math.hypot(dx, dz) + (fbm2D(x * 0.0035, z * 0.0035, 2) - 0.5) * 0.3;
  return 1 - smoothstep((d - 0.5) / 0.5);
}

// ---------------------------------------------------------------- world assembly

export function buildWorld(scene, projector) {
  const samples = sampleRiver(projector);
  const grid = buildSampleGrid(samples);
  const fp = footprints(projector);

  function islandHeight(x, z) {
    const { belle } = fp;
    const dx = x - belle.x;
    const dz = z - belle.z;
    const ca = Math.cos(belle.angle);
    const sa = Math.sin(belle.angle);
    const rx = dx * ca + dz * sa;
    const rz = -dx * sa + dz * ca;
    const d = Math.sqrt((rx / belle.a) ** 2 + (rz / belle.b) ** 2);
    if (d >= 1) return 0;
    return belle.height * smoothstep((1 - d) / 0.35);
  }

  function hillHeight(x, z, hill) {
    const d = Math.hypot(x - hill.x, z - hill.z);
    if (d >= hill.radius) return 0;
    return hill.height * smoothstep(1 - d / hill.radius);
  }

  function riverInfo(x, z) {
    const q = queryRiver(samples, grid, x, z);
    if (!q) return { dist: Infinity, halfWidth: 0, outside: Infinity };
    const halfWidth = q.sample.width / 2;
    return { dist: q.dist, halfWidth, outside: q.dist - halfWidth };
  }

  // Shared woodland field. Ground colour and tree scatter both read from this, so
  // dark canopy on the ground always lines up with actual trees standing on it.
  function forestDensity(x, z) {
    const clump = fbm2D(x * 0.0021, z * 0.0021, 4);
    let d = smoothstep((clump - 0.40) / 0.26);
    const info = riverInfo(x, z);
    if (info.outside < 380) d = Math.max(d, 0.55 * (1 - info.outside / 380) + d * 0.45);
    d *= 1 - 0.95 * zoneWeight(x, z, fp.downtown);
    d *= 1 - 0.8 * zoneWeight(x, z, fp.manchester);
    d *= 1 - 0.7 * zoneWeight(x, z, fp.fan);
    d *= 1 - 0.45 * zoneWeight(x, z, fp.seddon);
    return clamp01(d);
  }

  function getGroundHeight(x, z) {
    const rolling =
      fbm2D(x * 0.00055, z * 0.00055, 4) * 34 +
      fbm2D(x * 0.0018, z * 0.0018, 3) * 10 +
      fbm2D(x * 0.006, z * 0.006, 2) * 2.5;
    let h = 2 + rolling;
    h += hillHeight(x, z, fp.bluff);
    h += hillHeight(x, z, fp.churchHill);

    const info = riverInfo(x, z);
    if (info.outside < BANK_FALLOFF) {
      if (info.outside <= 0) {
        h = RIVERBED_Y;
      } else {
        h = lerp(RIVERBED_Y, h, smoothstep(info.outside / BANK_FALLOFF));
      }
    }

    const isl = islandHeight(x, z);
    if (isl > 0) h = Math.max(h, RIVER_SURFACE_Y + isl);
    return h;
  }

  buildGroundMesh(scene, getGroundHeight, riverInfo, forestDensity, fp);
  const riverAnimation = buildRiverSurface(scene, samples, projector);
  buildRapidRocks(scene, projector, samples, grid);
  const whitewaterAnimation = buildWhitewaterCascades(scene, projector, samples, grid);
  buildRoads(scene, projector, getGroundHeight);
  buildDowntown(scene, fp, getGroundHeight);
  buildNeighborhood(scene, fp, getGroundHeight);
  buildTrees(scene, getGroundHeight, forestDensity);
  buildArchBridge(scene, projector, samples, grid, getGroundHeight);

  return {
    getGroundHeight,
    riverInfo,
    worldSize: { x: WORLD_SIZE_X, z: WORLD_SIZE_Z },
    updateWorld(time) {
      riverAnimation.update(time);
      whitewaterAnimation.update(time);
    },
  };
}

// ---------------------------------------------------------------- ground

// Mottled canopy/soil detail so the ground reads as terrain rather than flat colour.
function makeGroundDetailTexture() {
  const size = 256;
  const period = 24;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period;
      const v = (y / size) * period;
      const n = tileableFbm(u, v, period, 4) * 0.6 + tileableFbm(u * 3, v * 3, period * 3, 3) * 0.4;
      // Wider spread than a subtle wash -- this is what stops the ground reading
      // as a flat billiard table from altitude.
      const shade = 118 + n * 150;
      const i = (y * size + x) * 4;
      img.data[i] = shade * 0.92;
      img.data[i + 1] = shade;
      img.data[i + 2] = shade * 0.8;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(260, 260);
  tex.anisotropy = 8;
  return tex;
}

function buildGroundMesh(scene, getGroundHeight, riverInfo, forestDensity, fp) {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE_X, WORLD_SIZE_Z, GROUND_SEGMENTS, GROUND_SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const canopy = new THREE.Color('#2d4a26');
  const scrub = new THREE.Color('#54763f');
  const grass = new THREE.Color('#6d8b4c');
  const dryField = new THREE.Color('#93975a');
  const pavement = new THREE.Color('#83817c');
  const suburb = new THREE.Color('#5f8047');
  const sand = new THREE.Color('#b9a97f');
  const tmp = new THREE.Color();
  const zoneTmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getGroundHeight(x, z));

    // Open ground varies between grass and dry field...
    const field = fbm2D(x * 0.0032, z * 0.0032, 3);
    tmp.copy(grass).lerp(dryField, clamp01((field - 0.45) * 2.2));
    tmp.lerp(scrub, clamp01((0.5 - field) * 1.4));

    // ...then woodland darkens it wherever trees actually stand.
    tmp.lerp(canopy, forestDensity(x, z) * 0.9);

    // Narrow sand/rock margin right at the waterline.
    const info = riverInfo(x, z);
    if (info.outside > -4 && info.outside < 20) {
      tmp.lerp(sand, 0.75 * (1 - clamp01(Math.abs(info.outside - 5) / 15)));
    }

    // Built-up zones, blended with soft irregular edges.
    const wDown = zoneWeight(x, z, fp.downtown);
    const wMan = zoneWeight(x, z, fp.manchester);
    const wFan = zoneWeight(x, z, fp.fan);
    const wSed = zoneWeight(x, z, fp.seddon);
    if (wDown > 0.01) tmp.lerp(pavement, wDown * 0.85);
    if (wMan > 0.01) tmp.lerp(pavement, wMan * 0.6);
    if (wFan > 0.01) tmp.lerp(zoneTmp.copy(pavement).lerp(suburb, 0.5), wFan * 0.6);
    if (wSed > 0.01) tmp.lerp(suburb, wSed * 0.55);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const detail = makeGroundDetailTexture();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    bumpMap: detail,
    bumpScale: 1.3,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ---------------------------------------------------------------- water

function buildRiverSurface(scene, samples, projector) {
  const positions = [];
  const colors = [];
  const indices = [];

  const deep = new THREE.Color('#163b4b');
  const shallow = new THREE.Color('#356d76');
  const foam = new THREE.Color('#dfeef4');
  const tmp = new THREE.Color();

  const rapids = [
    projector.toWorld(37.5305, -77.4578),
    projector.toWorld(37.5329, -77.4383),
    projector.toWorld(37.5535, -77.5201),
  ];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const halfW = s.width / 2;

    let rapidStrength = 0;
    for (const r of rapids) {
      const d = Math.hypot(s.p.x - r.x, s.p.z - r.z);
      rapidStrength = Math.max(rapidStrength, 1 - clamp01(d / 220));
    }

    for (const side of [1, -1]) {
      const p = s.p.clone().addScaledVector(s.normal, halfW * side);
      p.y = RIVER_SURFACE_Y + Math.sin(i * 0.55 + side) * 0.25 * (0.3 + rapidStrength);
      positions.push(p.x, p.y, p.z);

      tmp.copy(deep).lerp(shallow, 0.3 + 0.45 * fbm2D(s.p.x * 0.004, s.p.z * 0.004, 2));
      if (rapidStrength > 0) tmp.lerp(foam, rapidStrength * 0.8);
      colors.push(tmp.r, tmp.g, tmp.b);
    }

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

  const uniforms = { time: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexColors: true,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float time;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 p = position;
        float waveA = sin(p.x * 0.075 + p.z * 0.031 - time * 2.2);
        float waveB = sin(p.x * -0.043 + p.z * 0.088 - time * 1.55);
        p.y += (waveA + waveB) * 0.055;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * world;
        vColor = color;
        vWorld = world.xyz;
        vNormal = normalize(normalMatrix * normal);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vView;
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
      }
      float waterFbm(vec2 p) {
        float n = valueNoise(p) * 0.57;
        n += valueNoise(p * 2.03 + 9.2) * 0.28;
        n += valueNoise(p * 4.11 - 3.7) * 0.15;
        return n;
      }
      void main() {
        vec2 flowUv = vWorld.xz * 0.036 + vec2(-time * 0.32, time * 0.08);
        float broad = waterFbm(flowUv);
        float crossed = waterFbm(flowUv * vec2(1.7, 0.7) + vec2(time * 0.08, -time * 0.19));
        float ripple = broad * 0.62 + crossed * 0.38;
        float fine = waterFbm(flowUv * 5.2 + vec2(time * 0.42, -time * 0.3)) * 2.0 - 1.0;
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.6);
        float foamBase = smoothstep(1.75, 2.45, vColor.r + vColor.g + vColor.b);
        float foamBreak = smoothstep(0.56, 0.8, ripple + fine * 0.08);
        vec3 water = vColor * (0.72 + ripple * 0.38);
        water += vec3(0.18, 0.34, 0.43) * fresnel * 0.8;
        water += vec3(0.72, 0.9, 1.0) * pow(max(0.0, fine), 8.0) * 0.16;
        water = mix(water, vec3(0.9, 0.96, 0.98), foamBase * (0.62 + foamBreak * 0.38));
        gl_FragColor = vec4(water, 0.94);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { update: (time) => { uniforms.time.value = time; } };
}

// Exposed boulders through the fall-line rapids -- the visual signature of the
// Richmond whitewater reach.
function buildRapidRocks(scene, projector, samples, grid) {
  const rng = mulberry32(7731);
  const centers = [
    projector.toWorld(37.5305, -77.4578),
    projector.toWorld(37.5329, -77.4383),
    projector.toWorld(37.5535, -77.5201),
    projector.toWorld(37.5292, -77.4528),
  ];

  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#6c6861', roughness: 0.72, metalness: 0.04, flatShading: true });
  const count = 420;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 14) {
    attempts++;
    const c = centers[Math.floor(rng() * centers.length)];
    const x = c.x + (rng() - 0.5) * 520;
    const z = c.z + (rng() - 0.5) * 520;
    const q = queryRiver(samples, grid, x, z);
    if (!q || q.dist > q.sample.width / 2 - 5) continue;

    const s = 1.8 + rng() * 4.6;
    dummy.position.set(x, RIVER_SURFACE_Y + s * 0.22, z);
    dummy.scale.set(s, s * (0.45 + rng() * 0.4), s * (0.7 + rng() * 0.5));
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    color.setHSL(0.09, 0.07, 0.4 + rng() * 0.2);
    mesh.setColorAt(placed, color);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  scene.add(mesh);
}

function makeFoamTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 12;
      const v = (y / size) * 12;
      const broad = tileableFbm(u, v, 12, 4);
      const threads = Math.abs(Math.sin(v * 3.4 + broad * 8 + Math.sin(u * 1.7) * 2));
      const alpha = clamp01((broad - 0.38) * 2.3) * clamp01((threads - 0.2) * 1.7);
      const i = (y * size + x) * 4;
      img.data[i] = 232;
      img.data[i + 1] = 246;
      img.data[i + 2] = 252;
      img.data[i + 3] = alpha * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.5, 1.2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(245,252,255,0.78)');
  g.addColorStop(0.45, 'rgba(226,244,250,0.34)');
  g.addColorStop(1, 'rgba(220,240,248,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// Richmond's named "falls" are a fall-line whitewater system rather than one
// giant cliff. Layered foam tongues, low curtains, and spray make those ledges
// read as moving cascades instead of white polygons painted on blue water.
function buildWhitewaterCascades(scene, projector, samples, grid) {
  const rng = mulberry32(91734);
  const foamTexture = makeFoamTexture();
  const foamMat = new THREE.MeshBasicMaterial({
    map: foamTexture, transparent: true, opacity: 0.74, depthWrite: false,
    blending: THREE.NormalBlending, side: THREE.DoubleSide,
  });
  const curtainMat = new THREE.MeshPhysicalMaterial({
    color: '#cdebf3', transparent: true, opacity: 0.68, roughness: 0.18,
    transmission: 0.12, depthWrite: false, side: THREE.DoubleSide,
  });
  const mistMat = new THREE.SpriteMaterial({
    map: makeMistTexture(), transparent: true, opacity: 0.32, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mist = [];
  const centers = [
    projector.toWorld(37.5305, -77.4578),
    projector.toWorld(37.5329, -77.4383),
    projector.toWorld(37.5535, -77.5201),
  ];

  for (const center of centers) {
    const q = queryRiver(samples, grid, center.x, center.z);
    if (!q) continue;
    const s = q.sample;
    const angle = Math.atan2(-s.normal.z, s.normal.x);
    for (let tier = -3; tier <= 3; tier++) {
      const width = s.width * (0.3 + rng() * 0.28);
      const length = 13 + rng() * 23;
      const p = s.p.clone().addScaledVector(s.tangent, tier * 31 + (rng() - 0.5) * 16);
      p.addScaledVector(s.normal, (rng() - 0.5) * s.width * 0.24);

      const tongue = new THREE.Mesh(new THREE.PlaneGeometry(width, length, 12, 3), foamMat);
      // Apply yaw before pitch so the foam stays horizontal. With the default
      // XYZ Euler order, combining these rotations tips the sheet into the air.
      tongue.rotation.order = 'YXZ';
      tongue.rotation.set(-Math.PI / 2, angle, 0);
      tongue.position.set(p.x, RIVER_SURFACE_Y + 0.08 + rng() * 0.05, p.z);
      tongue.renderOrder = 3;
      scene.add(tongue);

      if (tier % 2 === 0) {
        const curtain = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.55, 2.2 + rng() * 2.2, 10, 2), curtainMat);
        curtain.rotation.y = angle;
        curtain.position.set(p.x, RIVER_SURFACE_Y - 0.35, p.z);
        scene.add(curtain);
      }

      for (let i = 0; i < 4; i++) {
        const sprite = new THREE.Sprite(mistMat.clone());
        sprite.position.copy(p).addScaledVector(s.normal, (rng() - 0.5) * width * 0.8);
        sprite.position.y = RIVER_SURFACE_Y + 1.0 + rng() * 3.8;
        const scale = 12 + rng() * 27;
        sprite.scale.set(scale * 1.7, scale, 1);
        sprite.userData.phase = rng() * Math.PI * 2;
        sprite.userData.baseY = sprite.position.y;
        mist.push(sprite);
        scene.add(sprite);
      }
    }
  }

  return {
    update(time) {
      foamTexture.offset.y = -time * 0.18;
      for (const sprite of mist) {
        sprite.position.y = sprite.userData.baseY + Math.sin(time * 0.7 + sprite.userData.phase) * 1.1;
        sprite.material.opacity = 0.22 + (Math.sin(time * 1.1 + sprite.userData.phase) * 0.5 + 0.5) * 0.2;
      }
    },
  };
}

// ---------------------------------------------------------------- roads

// Approximate alignments for Richmond's major arteries. These are eyeballed from
// the city's street layout, not surveyed centrelines -- they exist so the ground
// reads as a city, not as a routable map.
const ROADS = [
  { width: 18, color: '#4a4e53', pts: [[37.5455, -77.431], [37.5495, -77.446], [37.553, -77.462], [37.556, -77.48], [37.5588, -77.498], [37.5605, -77.515]] },
  { width: 14, color: '#4f5358', pts: [[37.5525, -77.452], [37.554, -77.465], [37.5548, -77.478], [37.5552, -77.49]] },
  { width: 15, color: '#4f5358', pts: [[37.529, -77.476], [37.54, -77.4772], [37.55, -77.478], [37.564, -77.479]] },
  { width: 15, color: '#4f5358', pts: [[37.547, -77.439], [37.559, -77.448], [37.572, -77.457], [37.585, -77.465], [37.596, -77.47]] },
  { width: 12, color: '#52565b', pts: [[37.5545, -77.47], [37.568, -77.4715], [37.581, -77.4728], [37.593, -77.4736]] },
  { width: 11, color: '#52565b', pts: [[37.534, -77.509], [37.5305, -77.493], [37.5278, -77.476], [37.5262, -77.46], [37.5258, -77.446]] },
  { width: 13, color: '#4f5358', pts: [[37.533, -77.472], [37.5372, -77.456], [37.5398, -77.442], [37.5378, -77.428], [37.533, -77.418]] },
  { width: 26, color: '#3f4347', pts: [[37.52, -77.429], [37.533, -77.4258], [37.5455, -77.4262], [37.56, -77.433], [37.576, -77.441], [37.59, -77.447]] },
  { width: 22, color: '#3f4347', pts: [[37.515, -77.515], [37.529, -77.506], [37.542, -77.496], [37.556, -77.49]] },
];

function buildRibbon(points3, width, colorHex, getGroundHeight, yOffset) {
  const curve = new THREE.CatmullRomCurve3(points3, false, 'catmullrom', 0.3);
  const n = Math.max(24, Math.round(curve.getLength() / 25));
  const pts = curve.getSpacedPoints(n);

  const positions = [];
  const indices = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, t)));
    const normal = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    for (const side of [1, -1]) {
      const p = pts[i].clone().addScaledVector(normal, (width / 2) * side);
      p.y = getGroundHeight(p.x, p.z) + yOffset;
      positions.push(p.x, p.y, p.z);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      const b = i * 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorHex }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildRoads(scene, projector, getGroundHeight) {
  for (const road of ROADS) {
    const pts = road.pts.map(([lat, lon]) => {
      const { x, z } = projector.toWorld(lat, lon);
      return new THREE.Vector3(x, 0, z);
    });
    scene.add(buildRibbon(pts, road.width, road.color, getGroundHeight, 0.7));
  }
}

// Local street grid, drawn as a single merged mesh per district. Segments are
// clipped to the district's ellipse so streets stop at the edge of the built-up
// area instead of running out across open country.
function buildStreetGrid(scene, zone, spacing, width, getGroundHeight) {
  const positions = [];
  const indices = [];

  const inside = (x, z) => Math.hypot((x - zone.x) / zone.rx, (z - zone.z) / zone.rz) <= 1;

  const addStrip = (fixed, horizontal) => {
    const span = horizontal ? zone.rx : zone.rz;
    const steps = Math.max(8, Math.round((span * 2) / 35));
    let runStart = -1; // index of the first vertex pair in the current run

    for (let i = 0; i <= steps; i++) {
      const t = -span + (i / steps) * span * 2;
      const cx = horizontal ? zone.x + t : zone.x + fixed;
      const cz = horizontal ? zone.z + fixed : zone.z + t;

      if (!inside(cx, cz)) {
        runStart = -1; // break the strip here
        continue;
      }

      const ax = horizontal ? cx : cx - width / 2;
      const az = horizontal ? cz - width / 2 : cz;
      const bx = horizontal ? cx : cx + width / 2;
      const bz = horizontal ? cz + width / 2 : cz;
      positions.push(ax, getGroundHeight(ax, az) + 0.55, az);
      positions.push(bx, getGroundHeight(bx, bz) + 0.55, bz);

      const here = positions.length / 3 - 2;
      if (runStart >= 0) {
        indices.push(here - 2, here - 1, here, here - 1, here + 1, here);
      } else {
        runStart = here;
      }
    }
  };

  for (let o = -zone.rz; o <= zone.rz; o += spacing) addStrip(o, true);
  for (let o = -zone.rx; o <= zone.rx; o += spacing) addStrip(o, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#55595e' }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ---------------------------------------------------------------- buildings

function buildDowntown(scene, fp, getGroundHeight) {
  const rng = mulberry32(1916);
  buildStreetGrid(scene, fp.downtown, 105, 12, getGroundHeight);

  // From the air, what makes a skyline read is height spread, facade colour and
  // cast shadow -- window detail is sub-pixel at cruising altitude.
  const palette = ['#8fa3b8', '#9fa6ac', '#7d8fa4', '#a89f92', '#6f8296', '#b0a493'];
  const roofMat = new THREE.MeshLambertMaterial({ color: '#4e5155' });

  const towers = 150;
  for (let i = 0; i < towers; i++) {
    // Bias radius toward the centre so the cluster has a dense, tall core.
    const rad = Math.pow(rng(), 1.5);
    const ang = rng() * Math.PI * 2;
    const x = fp.downtown.x + Math.cos(ang) * rad * fp.downtown.rx;
    const z = fp.downtown.z + Math.sin(ang) * rad * fp.downtown.rz;

    const centrality = 1 - rad;
    const h = 14 + Math.pow(centrality, 1.7) * 165 * (0.55 + rng() * 0.85);
    const w = 16 + rng() * 24;
    const d = 16 + rng() * 24;

    const side = new THREE.MeshLambertMaterial({ color: palette[Math.floor(rng() * palette.length)] });
    const mats = [side, side, roofMat, roofMat, side, side];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    mesh.position.set(x, getGroundHeight(x, z) + h / 2, z);
    mesh.rotation.y = Math.round(rng() * 4) * (Math.PI / 8);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Low-rise fill across Manchester (south bank) and the Fan (west of downtown).
  const districts = [fp.manchester, fp.fan];
  const perDistrict = 190;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
    districts.length * perDistrict
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let idx = 0;
  for (const zone of districts) {
    for (let i = 0; i < perDistrict; i++) {
      const rad = Math.pow(rng(), 0.85);
      const ang = rng() * Math.PI * 2;
      const x = zone.x + Math.cos(ang) * rad * zone.rx;
      const z = zone.z + Math.sin(ang) * rad * zone.rz;
      const h = 7 + rng() * 15;
      dummy.position.set(x, getGroundHeight(x, z) + h / 2, z);
      dummy.scale.set(11 + rng() * 15, h, 11 + rng() * 15);
      dummy.rotation.y = Math.round(rng() * 4) * (Math.PI / 8);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      color.setHSL(0.06 + rng() * 0.06, 0.16, 0.42 + rng() * 0.22);
      mesh.setColorAt(idx, color);
      idx++;
    }
  }
  mesh.count = idx;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// Ginter Park / Rosedale: a residential grid of houses with pitched roofs.
function buildNeighborhood(scene, fp, getGroundHeight) {
  const rng = mulberry32(1801);
  const seddon = fp.seddon;
  const SPACING = 78;
  buildStreetGrid(scene, seddon, SPACING, 9, getGroundHeight);

  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.72, 1, 4);
  const bodyMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });

  // Sized to cover the whole platted area -- a cap that runs out partway leaves
  // half the district as bare streets.
  const LOT_WIDTH = 32;
  const MAX = 1100;
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, MAX);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  let idx = 0;
  // Two rows of lots facing each street, the way a real block is platted.
  for (let gz = -seddon.rz; gz <= seddon.rz && idx < MAX; gz += SPACING) {
    for (const lotSide of [-1, 1]) {
      for (let gx = -seddon.rx; gx <= seddon.rx && idx < MAX; gx += LOT_WIDTH) {
        if (rng() < 0.22) continue; // vacant lots break up the rows
        const x = seddon.x + gx + (rng() - 0.5) * 7;
        const z = seddon.z + gz + lotSide * (16 + rng() * 5);
        if (Math.hypot((x - seddon.x) / seddon.rx, (z - seddon.z) / seddon.rz) > 1) continue;

        const base = getGroundHeight(x, z);
        const w = 10 + rng() * 3.5;
        const d = 11 + rng() * 3.5;
        const bodyH = 5.5 + rng() * 2.5;
        const roofH = 3 + rng() * 1.4;
        const rot = (rng() - 0.5) * 0.12;

        dummy.position.set(x, base + bodyH / 2, z);
        dummy.scale.set(w, bodyH, d);
        dummy.rotation.set(0, rot, 0);
        dummy.updateMatrix();
        bodies.setMatrixAt(idx, dummy.matrix);
        color.setHSL(0.09, 0.12, 0.6 + rng() * 0.26);
        bodies.setColorAt(idx, color);

        // Cone spans +/-0.5 in unit space, so its base sits exactly on the walls.
        dummy.position.set(x, base + bodyH + roofH / 2, z);
        dummy.scale.set(w * 1.22, roofH, d * 1.22);
        dummy.rotation.set(0, rot + Math.PI / 4, 0);
        dummy.updateMatrix();
        roofs.setMatrixAt(idx, dummy.matrix);
        color.setHSL(0.025 + rng() * 0.05, 0.34, 0.26 + rng() * 0.14);
        roofs.setColorAt(idx, color);
        idx++;
      }
    }
  }

  bodies.count = idx;
  roofs.count = idx;
  bodies.instanceMatrix.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  bodies.castShadow = roofs.castShadow = true;
  bodies.receiveShadow = roofs.receiveShadow = true;
  scene.add(bodies, roofs);
}

// ---------------------------------------------------------------- trees

function buildTrees(scene, getGroundHeight, forestDensity) {
  const rng = mulberry32(20250824);
  const TARGET = 16000;

  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.46, 5, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#493425', roughness: 1 });
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TARGET);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, TARGET);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  let placed = 0;
  let attempts = 0;
  while (placed < TARGET && attempts < TARGET * 6) {
    attempts++;
    const x = (rng() - 0.5) * WORLD_SIZE_X * 0.97;
    const z = (rng() - 0.5) * WORLD_SIZE_Z * 0.97;

    // Reject by actual ground height rather than distance from the centreline, so
    // Belle Isle (which sits inside the channel) still gets its woods.
    const y = getGroundHeight(x, z);
    if (y < RIVER_SURFACE_Y + 1.4) continue;

    // Woodland is clumped, so most rejections happen in the clearings and the
    // survivors form actual stands of trees rather than an even sprinkle.
    if (rng() > forestDensity(x, z) * 0.96 + 0.02) continue;

    const scale = 3.4 + rng() * 4.8;
    const rot = rng() * Math.PI;

    dummy.position.set(x, y + 2.5, z);
    dummy.scale.set(1, 1 + rng() * 0.5, 1);
    dummy.rotation.set(0, rot, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);

    dummy.position.set(x, y + 4.2 + scale * 0.5, z);
    dummy.scale.set(scale, scale * (0.78 + rng() * 0.5), scale);
    dummy.rotation.set(rng() * 0.4, rot, rng() * 0.4);
    dummy.updateMatrix();
    canopies.setMatrixAt(placed, dummy.matrix);
    color.setHSL(0.23 + rng() * 0.08, 0.32 + rng() * 0.22, 0.17 + rng() * 0.13);
    canopies.setColorAt(placed, color);

    placed++;
  }

  trunks.count = placed;
  canopies.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  canopies.castShadow = true;
  canopies.receiveShadow = true;
  scene.add(trunks, canopies);
}

// ---------------------------------------------------------------- CSX A-Line bridge

// The real structure is a 1919 multi-span concrete arch bridge, so it gets proper
// arch rings rather than a flat slab -- it is one of the named landmarks.
function buildArchBridge(scene, projector, samples, grid, getGroundHeight) {
  const target = projector.toWorld(37.5364, -77.4939);
  const q = queryRiver(samples, grid, target.x, target.z);
  const sample = q ? q.sample : samples[Math.floor(samples.length / 2)];

  const ARCH_R = 22;
  const ARCH_THICK = 4;
  const DECK_W = 12;
  const SPRING_Y = 4;
  const DECK_Y = SPRING_Y + ARCH_R + 3;

  // Span the wetted channel plus a short approach at each end, rather than a
  // fixed length that would run hundreds of metres out across dry ground.
  const needed = sample.width + 150;
  const ARCH_COUNT = Math.max(5, Math.round(needed / (ARCH_R * 2)));
  const totalLength = ARCH_COUNT * ARCH_R * 2;

  const concrete = new THREE.MeshLambertMaterial({ color: '#b5b1a7' });
  const concreteDark = new THREE.MeshLambertMaterial({ color: '#948f86' });

  const axis = sample.normal.clone().normalize(); // across the river
  const flow = sample.tangent.clone().normalize(); // along the river
  const basis = new THREE.Matrix4().makeBasis(axis, new THREE.Vector3(0, 1, 0), flow);
  const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

  // Arch ring profile: outer semicircle traced back along an inner semicircle.
  const shape = new THREE.Shape();
  const outerR = ARCH_R;
  const innerR = ARCH_R - ARCH_THICK;
  shape.moveTo(-outerR, 0);
  shape.absarc(0, 0, outerR, Math.PI, 0, true);
  shape.lineTo(innerR, 0);
  shape.absarc(0, 0, innerR, 0, Math.PI, false);
  shape.lineTo(-outerR, 0);
  const archGeo = new THREE.ExtrudeGeometry(shape, { depth: DECK_W, bevelEnabled: false });
  archGeo.translate(0, 0, -DECK_W / 2);

  const group = new THREE.Group();

  for (let i = 0; i < ARCH_COUNT; i++) {
    const offset = (i - (ARCH_COUNT - 1) / 2) * ARCH_R * 2;
    const local = new THREE.Vector3(offset, 0, 0).applyQuaternion(quat);
    const px = sample.p.x + local.x;
    const pz = sample.p.z + local.z;

    const arch = new THREE.Mesh(archGeo, concrete);
    arch.position.set(px, SPRING_Y, pz);
    arch.quaternion.copy(quat);
    arch.castShadow = true;
    arch.receiveShadow = true;
    group.add(arch);

    const groundY = getGroundHeight(px, pz);
    const pierH = SPRING_Y - groundY;
    if (pierH > 1) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(ARCH_THICK * 1.7, pierH, DECK_W), concreteDark);
      pier.position.set(px, groundY + pierH / 2, pz);
      pier.quaternion.copy(quat);
      pier.castShadow = true;
      group.add(pier);
    }
  }

  const deck = new THREE.Mesh(new THREE.BoxGeometry(totalLength, 3, DECK_W), concrete);
  deck.position.set(sample.p.x, DECK_Y, sample.p.z);
  deck.quaternion.copy(quat);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Parapets and twin ballasted track beds -- it carries two tracks.
  for (const side of [1, -1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(totalLength, 1.3, 0.9), concreteDark);
    const off = flow.clone().multiplyScalar(side * (DECK_W / 2 - 0.45));
    rail.position.set(sample.p.x + off.x, DECK_Y + 2.1, sample.p.z + off.z);
    rail.quaternion.copy(quat);
    group.add(rail);

    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(totalLength, 0.6, 3),
      new THREE.MeshLambertMaterial({ color: '#6f665c' })
    );
    const bedOff = flow.clone().multiplyScalar(side * 3);
    bed.position.set(sample.p.x + bedOff.x, DECK_Y + 1.8, sample.p.z + bedOff.z);
    bed.quaternion.copy(quat);
    group.add(bed);
  }

  scene.add(group);
}
