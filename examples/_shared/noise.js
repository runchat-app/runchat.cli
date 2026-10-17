// Seeded noise for geometry and textures. The 2D functions take an optional
// period so textures tile seamlessly.

function hash3(x, y, z, seed) {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 1440662683) ^
    Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a, p) => (p ? ((a % p) + p) % p : a);

export function createNoise(seed = 1) {
  /** Value noise in [-1, 1]; repeats every `period` cells when given. */
  function n2(x, y, period = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const h = (a, b) => hash3(mod(a, period), mod(b, period), 0, seed) * 2 - 1;
    const a = h(ix, iy);
    const b = h(ix + 1, iy);
    const c = h(ix, iy + 1);
    const d = h(ix + 1, iy + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  function n3(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);
    const h = (a, b, c) => hash3(a, b, c, seed) * 2 - 1;
    const lerp = (a, b, t) => a + (b - a) * t;
    const plane = (zz) =>
      lerp(
        lerp(h(ix, iy, zz), h(ix + 1, iy, zz), fx),
        lerp(h(ix, iy + 1, zz), h(ix + 1, iy + 1, zz), fx),
        fy,
      );
    return lerp(plane(iz), plane(iz + 1), fz);
  }
  /** Fractal sum of n2; with a period the base octave repeats every period cells. */
  function fbm2(x, y, octaves = 4, period = 0, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * n2(x * f, y * f, period ? period * f : 0);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
  function fbm3(x, y, z, octaves = 4, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * n3(x * f, y * f, z * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
  /** Cellular noise: distances to the nearest two feature points and the cell id. */
  function worley2(x, y, period = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const hx = mod(cx, period);
        const hy = mod(cy, period);
        const px = cx + hash3(hx, hy, 1, seed);
        const py = cy + hash3(hx, hy, 2, seed);
        const d = Math.hypot(px - x, py - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = hash3(hx, hy, 3, seed);
        } else if (d < f2) f2 = d;
      }
    }
    return { f1, f2, id };
  }
  return {
    n2,
    n3,
    fbm2,
    fbm3,
    worley2,
    hash: (a, b, c = 0) => hash3(a, b, c, seed),
  };
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
