// Terrain maths shared by the UI and commands.js: seeded fractal noise plus
// placed features (hills, valleys, ridges, flat pads), sampled on a grid.
// Metres, Z up, centred on the origin.

export const DEFAULTS = {
  size: 80,
  resolution: 65,
  seed: 7,
  amplitude: 6,
  octaves: 4,
  roughness: 0.5,
  scale: 35,
  water_level: null,
  palette: "temperate",
  texture: null,
};

export const PALETTES = {
  temperate: {
    shore: "#d6c79c",
    low: "#7f9c55",
    high: "#5e7d3f",
    rock: "#8b8378",
    peak: "#f1f1ec",
  },
  arid: {
    shore: "#e6cf9f",
    low: "#d9ac74",
    high: "#bf8550",
    rock: "#8d5a3a",
    peak: "#e8d3b0",
  },
  alpine: {
    shore: "#b8b39f",
    low: "#6f8f4c",
    high: "#4d6b3a",
    rock: "#7d7a74",
    peak: "#f6f6f4",
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
  const fx = x - ix;
  const fy = y - iy;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  const u = s(fx);
  const v = s(fy);
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

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

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
      const d = segmentDistance(x, y, f.at, f.to ?? f.at);
      h += f.height * Math.exp(-((d / f.radius) ** 2));
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
    const blend = 1 - smooth(0, f.margin ?? 4, outside);
    h = h * (1 - blend) + f.height * blend;
  }
  return h;
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s) =>
    Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return (
    "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")
  );
}

/** Sample the terrain on its grid, with colours and the numbers commands report. */
export function buildTerrain(p, features) {
  const cols = Math.max(9, Math.min(97, Math.round(p.resolution)));
  const rows = cols;
  const half = p.size / 2;
  const step = p.size / (cols - 1);
  const heights = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[r * cols + c] =
        Math.round(
          heightAt(p, features, -half + c * step, -half + r * step) * 1000,
        ) / 1000;
    }
  }
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  const palette = PALETTES[p.palette] ?? PALETTES.temperate;
  const vertices = [];
  const colors = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heights[r * cols + c];
      vertices.push(-half + c * step, -half + r * step, h);
      const hx =
        heights[r * cols + Math.min(cols - 1, c + 1)] -
        heights[r * cols + Math.max(0, c - 1)];
      const hy =
        heights[Math.min(rows - 1, r + 1) * cols + c] -
        heights[Math.max(0, r - 1) * cols + c];
      const slope =
        (Math.atan(Math.hypot(hx, hy) / (2 * step)) * 180) / Math.PI;
      const t = (h - lo) / (hi - lo || 1);
      let color = mix(palette.low, palette.high, smooth(0.2, 0.7, t));
      if (p.water_level != null && h < p.water_level + 0.5)
        color = palette.shore;
      color = mix(color, palette.rock, smooth(24, 38, slope));
      if (t > 0.86 && p.amplitude >= 6)
        color = mix(color, palette.peak, smooth(0.86, 0.95, t));
      const grain = (hash(c, r, p.seed) - 0.5) * 0.12;
      colors.push(
        mix(color, grain > 0 ? "#ffffff" : "#000000", Math.abs(grain)),
      );
    }
  }
  return {
    cols,
    rows,
    vertices,
    colors,
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
