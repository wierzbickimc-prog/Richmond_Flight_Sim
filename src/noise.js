// Cheap deterministic 2D value noise (no deps). Good enough for gentle terrain rolling.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const tl = hash(xi, yi);
  const tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1);
  const br = hash(xi + 1, yi + 1);

  const u = smooth(xf);
  const v = smooth(yf);

  return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
}

// Fractal sum of a few octaves for more natural rolling hills.
export function fbm2D(x, y, octaves = 4) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / maxValue;
}

// --- Tileable variants, used for the repeating ground detail texture. ---
// The lattice wraps modulo `period`, so the resulting image tiles seamlessly.
function wrap(v, period) {
  return ((v % period) + period) % period;
}

function tileableValueNoise(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const x0 = wrap(xi, period);
  const x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period);
  const y1 = wrap(yi + 1, period);

  const tl = hash(x0, y0);
  const tr = hash(x1, y0);
  const bl = hash(x0, y1);
  const br = hash(x1, y1);

  const u = smooth(xf);
  const v = smooth(yf);

  return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
}

export function tileableFbm(x, y, period, octaves = 4) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += tileableValueNoise(x * frequency, y * frequency, period * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / maxValue;
}

// Small deterministic PRNG for scatter placement.
export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
