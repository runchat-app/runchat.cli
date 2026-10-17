// Terrain maths shared by the UI and commands.js: seeded fractal noise plus
// placed features (hills, valleys, ridges, cliffs, flat pads), a baked
// surface texture, overhanging cliff faces and boulder models.
// Metres, Z up, centred on the origin.
import { createNoise, smoothstep } from "./noise.js";
import { icosphere, part, finish, rng, vec } from "./geom.js";
import { TILE_M } from "./textures.js";

export const DEFAULTS = {
  size: 80,
  resolution: 97,
  seed: 7,
  amplitude: 6,
  octaves: 5,
  roughness: 0.5,
  scale: 35,
  water_level: null,
  palette: "temperate",
};

export const PALETTES = {
  temperate: {
    lush: "#4f7430",
    grass: "#6a8a38",
    dry: "#9c9a5c",
    dirt: "#7a6a4f",
    sand: "#c9b98d",
    wet: "#8a7f62",
    rock: "#8a857c",
    rockDark: "#5e5a54",
    snow: "#f1f1ec",
  },
  arid: {
    lush: "#8c8a4a",
    grass: "#b39a5e",
    dry: "#d4b27a",
    dirt: "#a07a50",
    sand: "#e3cc9a",
    wet: "#a8916a",
    rock: "#a6764c",
    rockDark: "#6e4a30",
    snow: "#e8d8bc",
  },
  alpine: {
    lush: "#46682e",
    grass: "#5c7c3a",
    dry: "#8a8c5a",
    dirt: "#6e6450",
    sand: "#b8b29c",
    wet: "#7c7864",
    rock: "#7d7a74",
    rockDark: "#55524d",
    snow: "#f6f6f4",
  },
};

function hash(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(x - ix);
  const v = s(y - iy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

/** Position relative to a cliff line: t along it (0–1), d across (+ behind, the high side). */
export function cliffCoords(f, x, y) {
  const [ax, ay] = f.at;
  const [bx, by] = f.to;
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy) || 1;
  return {
    t: ((x - ax) * dx + (y - ay) * dy) / (L * L),
    d: ((x - ax) * -dy + (y - ay) * dx) / L,
    length: L,
  };
}

export function baseHeight(p, x, y) {
  let h = 0;
  let amp = 1;
  let freq = 1 / p.scale;
  let norm = 0;
  for (let o = 0; o < p.octaves; o++) {
    h += amp * (valueNoise(x * freq, y * freq, p.seed + o * 101) - 0.5);
    norm += amp;
    amp *= p.roughness;
    freq *= 2;
  }
  return (h / norm) * 2 * p.amplitude;
}

export function cliffLift(f, x, y) {
  const s = cliffCoords(f, x, y);
  const ends = smoothstep(-0.3, 0.18, s.t) * (1 - smoothstep(0.82, 1.3, s.t));
  const behind = smoothstep(-0.6, 0.9, s.d);
  const falloff = Math.exp(-Math.max(0, s.d - 3) / (f.depth ?? 22));
  return f.height * behind * falloff * ends;
}

export function heightAt(p, features, x, y) {
  let h = baseHeight(p, x, y);
  for (const f of features) {
    if (f.type === "hill" || f.type === "valley") {
      const d = Math.hypot(x - f.at[0], y - f.at[1]);
      h +=
        (f.type === "hill" ? 1 : -1) *
        f.height *
        Math.exp(-((d / f.radius) ** 2));
    } else if (f.type === "ridge") {
      h +=
        f.height *
        Math.exp(
          -((segmentDistance(x, y, f.at, f.to ?? f.at) / f.radius) ** 2),
        );
    } else if (f.type === "cliff") {
      h += cliffLift(f, x, y);
    }
  }
  for (const f of features) {
    if (f.type !== "pad") continue;
    const [cx, cy] = f.at;
    const [w, d] = f.size;
    const a = ((f.rotation ?? 0) * Math.PI) / 180;
    const lx =
      Math.abs((x - cx) * Math.cos(a) + (y - cy) * Math.sin(a)) - w / 2;
    const ly =
      Math.abs(-(x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)) - d / 2;
    const outside = Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
    const blend = 1 - smoothstep(0, f.margin ?? 4, outside);
    h = h * (1 - blend) + f.height * blend;
  }
  return h;
}

/** Sample the terrain on its grid, plus the numbers commands report. */
export function buildTerrain(p, features) {
  const cols = Math.max(9, Math.min(129, Math.round(p.resolution)));
  const rows = cols;
  const half = p.size / 2;
  const step = p.size / (cols - 1);
  const heights = new Array(cols * rows);
  const vertices = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -half + c * step;
      const y = -half + r * step;
      const h = Math.round(heightAt(p, features, x, y) * 1000) / 1000;
      heights[r * cols + c] = h;
      vertices.push(x, y, h);
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of heights) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return {
    cols,
    rows,
    vertices,
    heights,
    min: [-half, -half],
    max: [half, half],
    stats: {
      lowest_m: lo,
      highest_m: hi,
      size_m: p.size,
      grid: [cols, rows],
      cell_m: +step.toFixed(3),
    },
  };
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixc = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Paint the ground: grass in patches, dry grass on crests, dirt in hollows,
 * wet sand at the shore, layered rock on steep ground, snow on peaks. Returns
 * an RGB colour map and a half-size normal map covering the whole terrain.
 */
export function bakeTerrain(t, p, features, size = 1024) {
  const pal = Object.fromEntries(
    Object.entries(PALETTES[p.palette] ?? PALETTES.temperate).map(([k, v]) => [
      k,
      hex(v),
    ]),
  );
  const N = createNoise(p.seed * 31 + 7);
  const { cols, rows, heights, min, max } = t;
  const span = max[0] - min[0];
  const cell = span / (cols - 1);
  const sample = (gx, gy) => {
    const c = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
    const r = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
    const fu = Math.min(1, Math.max(0, gx - c));
    const fv = Math.min(1, Math.max(0, gy - r));
    const h = (a, b) => heights[b * cols + a];
    return (
      (h(c, r) * (1 - fu) + h(c + 1, r) * fu) * (1 - fv) +
      (h(c, r + 1) * (1 - fu) + h(c + 1, r + 1) * fu) * fv
    );
  };
  const range = t.stats.highest_m - t.stats.lowest_m || 1;
  const color = new Uint8Array(size * size * 3);
  const detail = new Float32Array(size * size);
  const water = p.water_level;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = min[0] + (px / (size - 1)) * span;
      const y = min[1] + (py / (size - 1)) * span;
      const gx = (px / (size - 1)) * (cols - 1);
      const gy = (py / (size - 1)) * (rows - 1);
      const h = sample(gx, gy);
      const dx = (sample(gx + 0.5, gy) - sample(gx - 0.5, gy)) / cell;
      const dy = (sample(gx, gy + 0.5) - sample(gx, gy - 0.5)) / cell;
      const slope = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
      const curvature =
        sample(gx, gy) * 2 - sample(gx - 2, gy) - sample(gx + 2, gy);
      const patches = N.fbm2(x * 0.06, y * 0.06, 4);
      const fine = N.fbm2(x * 0.9, y * 0.9, 3);
      const tuft = N.n2(x * 4, y * 4);
      let c = mixc(pal.lush, pal.grass, smoothstep(-0.3, 0.3, patches));
      c = mixc(
        c,
        pal.dry,
        smoothstep(0.15, 0.55, patches + curvature * 0.4) * 0.8,
      );
      c = mixc(
        c,
        pal.dirt,
        smoothstep(0.25, 0.6, -patches * 0.7 - curvature * 0.6 + fine * 0.3) *
          0.7,
      );
      c = mixc(
        c,
        mixc(c, [255, 255, 230], 0.2),
        smoothstep(0.4, 0.9, tuft) * 0.3,
      );
      if (water != null) {
        const shore = 1 - smoothstep(water + 0.2, water + 1.1 + fine * 0.4, h);
        c = mixc(c, pal.sand, shore);
        c = mixc(c, pal.wet, 1 - smoothstep(water - 0.2, water + 0.25, h));
      }
      const strata = Math.sin((h * 2.2 + fine * 1.5) * Math.PI) * 0.5 + 0.5;
      const rock = mixc(
        pal.rockDark,
        pal.rock,
        strata * 0.7 + fine * 0.3 + 0.15,
      );
      const rocky = smoothstep(26, 38, slope + fine * 6);
      c = mixc(c, rock, rocky);
      const t01 = (h - t.stats.lowest_m) / range;
      if (p.amplitude >= 8)
        c = mixc(
          c,
          pal.snow,
          smoothstep(0.82, 0.92, t01 + fine * 0.05) * (1 - rocky * 0.6),
        );
      const shadeK = 0.9 + fine * 0.12;
      const i = (py * size + px) * 3;
      color[i] = Math.min(255, c[0] * shadeK);
      color[i + 1] = Math.min(255, c[1] * shadeK);
      color[i + 2] = Math.min(255, c[2] * shadeK);
      detail[py * size + px] = fine * 0.6 + tuft * 0.15 + rocky * strata * 0.8;
    }
  }
  const out = size / 2;
  const normal = new Uint8Array(out * out * 3);
  const d = (x, y) =>
    detail[
      Math.min(size - 1, Math.max(0, y)) * size +
        Math.min(size - 1, Math.max(0, x))
    ];
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const nx = (d(x * 2 + 2, y * 2) - d(x * 2 - 2, y * 2)) * 3;
      const ny = (d(x * 2, y * 2 + 2) - d(x * 2, y * 2 - 2)) * 3;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * out + x) * 3;
      normal[i] = ((-nx / l) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    }
  }
  return { color, normal, size, normalSize: out };
}

/**
 * A rock face along a cliff line: rises from below the low ground to the top
 * of the scarp, bulging out into an overhang near the top, rough with 3D
 * noise. UVs in rock-texture tiles.
 */
export function cliffFace(f, p, features) {
  const N = createNoise(
    Math.round(f.at[0] * 13 + f.at[1] * 7 + f.height * 101),
  );
  const { length } = cliffCoords(f, f.to[0], f.to[1]);
  const along = vec.norm([f.to[0] - f.at[0], f.to[1] - f.at[1], 0]);
  const out = [along[1], -along[0], 0];
  const cols = Math.max(8, Math.round(length / 0.4));
  const rows = 26;
  const tile = TILE_M.rock;
  const overhang = f.overhang ?? f.height * 0.25;
  const vertices = [];
  const uvs = [];
  for (let r = 0; r < rows; r++) {
    const k = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1);
      const end = Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.06 - 0.03)));
      const bx = f.at[0] + along[0] * length * t;
      const by = f.at[1] + along[1] * length * t;
      const ground = heightAt(
        p,
        features.filter((g) => g !== f),
        bx + out[0] * 3,
        by + out[1] * 3,
      );
      const top = heightAt(p, features, bx - out[0] * 2.5, by - out[1] * 2.5);
      const z = ground - 0.8 + (top + 0.3 - ground + 0.8) * k;
      const bulge =
        overhang *
        Math.pow(smoothstep(0.45, 0.92, k), 1.4) *
        (1 - smoothstep(0.92, 1, k) * 0.7) *
        end;
      const n =
        N.fbm3(bx * 0.22, by * 0.22, z * 0.3, 4) * 1.6 +
        N.fbm3(bx * 1.1, by * 1.1, z * 1.1, 3) * 0.45;
      const gully = Math.pow(Math.abs(Math.sin(t * length * 0.55 + n * 1.5)), 3) * -0.9;
      const ledge = Math.pow(Math.max(0, Math.sin(z * 1.4 + n * 1.2)), 6) * 0.7;
      const push = bulge + (n + ledge + gully) * end - (1 - end) * 1.5 - 0.6;
      vertices.push(bx + out[0] * push, by + out[1] * push, z);
      uvs.push((t * length) / tile, -z / tile);
    }
  }
  const faces = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      faces.push(a, a + cols + 1, a + cols, a, a + 1, a + cols + 1);
    }
  }
  return {
    vertices: vertices.map((v) => Math.round(v * 1000) / 1000),
    faces,
    uvs,
  };
}

/** A boulder: a displaced, flattened icosphere, 1 m across, sitting on z = 0. */
export function rockModel(variant) {
  const N = createNoise(variant * 7717 + 3);
  const rand = rng(variant * 104729 + 11);
  const { v, f } = icosphere(3);
  const squash = [0.8 + rand() * 0.5, 0.7 + rand() * 0.5, 0.45 + rand() * 0.35];
  const pts = v.map(([x, y, z]) => {
    const d =
      1 +
      N.fbm3(x * 1.6, y * 1.6, z * 1.6, 4) * 0.45 +
      Math.abs(N.n3(x * 4, y * 4, z * 4)) * -0.12;
    let pz = z * d * squash[2];
    if (pz < -0.1) pz = -0.1 + (pz + 0.1) * 0.25;
    return [x * d * squash[0] * 0.5, y * d * squash[1] * 0.5, pz * 0.5 + 0.12];
  });
  const p = part();
  const tile = TILE_M.rock / 2;
  for (const [a, b, c] of f) {
    const tri = [pts[a], pts[b], pts[c]];
    const n = vec.cross(vec.sub(tri[1], tri[0]), vec.sub(tri[2], tri[0]));
    const ax =
      Math.abs(n[0]) > Math.abs(n[1])
        ? Math.abs(n[0]) > Math.abs(n[2])
          ? 0
          : 2
        : Math.abs(n[1]) > Math.abs(n[2])
          ? 1
          : 2;
    const [iu, iv] = ax === 0 ? [1, 2] : ax === 1 ? [0, 2] : [0, 1];
    const base = p.vertices.length / 3;
    for (const q of tri) {
      p.vertices.push(...q.map((c) => Math.round(c * 1000) / 1000));
      p.uvs.push(q[iu] / tile, -q[iv] / tile);
    }
    p.faces.push(base, base + 1, base + 2);
  }
  return finish(p);
}
