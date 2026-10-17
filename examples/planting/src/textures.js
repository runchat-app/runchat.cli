// Procedural, seamlessly tiling material textures for the scene apps: colour
// maps plus normal maps derived from a height field, and alpha-cut foliage
// atlases. Each material knows the real-world size of one tile (metres), so
// geometry can set UVs at true scale.
import { clamp01, createNoise, smoothstep } from "./noise.js";
import { pngTexture } from "./png.js";

export const VERSION = "v2";

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Run fn(u, v) over a size × size tile; fn returns [colour, height]. */
function paint(size, fn) {
  const color = new Uint8Array(size * size * 3);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [c, h] = fn(x / size, y / size);
      const i = y * size + x;
      color[i * 3] = Math.max(0, Math.min(255, c[0]));
      color[i * 3 + 1] = Math.max(0, Math.min(255, c[1]));
      color[i * 3 + 2] = Math.max(0, Math.min(255, c[2]));
      height[i] = h;
    }
  }
  return { color, height };
}

/** Tangent-space normal map from a wrapping height field, at half resolution. */
function normalMap(height, size, strength) {
  const out = size / 2;
  const n = new Uint8Array(out * out * 3);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const sx = x * 2;
      const sy = y * 2;
      const dx = (h(sx + 2, sy) - h(sx - 2, sy)) * strength;
      const dy = (h(sx, sy + 2) - h(sx, sy - 2)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * out + x) * 3;
      n[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      n[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      n[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    }
  }
  return { pixels: n, size: out };
}

const MATERIALS = {
  brick: {
    tile: 0.9,
    strength: 6,
    paint(N) {
      const reds = [
        "#8e3b2a",
        "#9c4a32",
        "#7d3526",
        "#a65a3c",
        "#6f3024",
        "#94462e",
      ].map(hex);
      const mortar = hex("#b5ac9c");
      return (u, v) => {
        const cv = v * 12;
        const course = Math.floor(cv);
        const bu = u * 4 + (course % 2 ? 0.5 : 0);
        const brick = Math.floor(bu);
        const fu = bu - brick;
        const fv = cv - course;
        const mu = 0.045;
        const mv = 0.13;
        const edge = Math.min(
          fu - mu,
          1 - mu - fu,
          (fv - mv) * 0.33,
          (1 - mv - fv) * 0.33,
        );
        const id = N.hash(brick % 4, course % 12);
        const grain = N.fbm2(u * 32, v * 32, 3, 32);
        if (edge < 0)
          return [scale(mortar, 0.9 + grain * 0.15), 0.05 + grain * 0.04];
        const base = mix(
          reds[Math.floor(id * reds.length)],
          reds[Math.floor(N.hash(brick % 4, course % 12, 7) * reds.length)],
          0.35,
        );
        const speck = N.n2(u * 160, v * 160, 160) > 0.55 ? 0.75 : 1;
        const burnt =
          1 -
          smoothstep(0, 0.04, edge) * 0.0 -
          (1 - smoothstep(0, 0.05, edge)) * 0.18;
        return [
          scale(base, (0.92 + grain * 0.18) * speck * burnt),
          0.6 + smoothstep(0, 0.03, edge) * 0.4 + grain * 0.05,
        ];
      };
    },
  },
  boards: {
    tile: 1.2,
    strength: 4,
    paint(N) {
      const tones = ["#a0703f", "#9a683a", "#ad7a48", "#8f6034", "#b5824f"].map(
        hex,
      );
      return (u, v) => {
        const bu = u * 8;
        const board = Math.floor(bu);
        const fu = bu - board;
        const groove = Math.min(fu, 1 - fu);
        const warp = N.fbm2(fu * 3 + board * 5.1, v * 4, 3, 4) * 0.6;
        const rings =
          Math.sin((fu * 9 + warp * 6 + board) * Math.PI) * 0.5 + 0.5;
        const knot = N.worley2(u * 8, v * 3, 8);
        const knotDark =
          knot.id > 0.93 ? 1 - smoothstep(0.05, 0.16, knot.f1) : 0;
        let c = scale(
          tones[(board % 8) % tones.length],
          0.86 + rings * 0.16 + N.fbm2(u * 64, v * 4, 2, 64) * 0.06,
        );
        c = mix(c, hex("#4a2e18"), knotDark * 0.8);
        if (groove < 0.035) return [scale(c, 0.35), 0];
        return [c, 0.8 + rings * 0.08 - knotDark * 0.2];
      };
    },
  },
  charred: {
    tile: 1.2,
    strength: 9,
    paint(N) {
      return (u, v) => {
        const fu = (u * 8) % 1;
        const w = N.worley2(u * 18, v * 26, 0);
        const crack = smoothstep(0.0, 0.09, w.f2 - w.f1);
        const sheen = 0.9 + N.fbm2(u * 24, v * 24, 3, 24) * 0.25;
        let c = mix(hex("#0c0b0a"), hex("#2f2b27"), crack * sheen);
        if (Math.min(fu, 1 - fu) < 0.02) c = scale(c, 0.5);
        return [c, crack * 0.8 + (1 - w.f1) * 0.2];
      };
    },
  },
  concrete: {
    tile: 2.4,
    strength: 3,
    paint(N) {
      const base = hex("#b9b5ac");
      return (u, v) => {
        const band = Math.floor(v * 16);
        const bandTone = (N.hash(band, 0, 9) - 0.5) * 0.06;
        const fv = (v * 16) % 1;
        const mark = Math.min(fv, 1 - fv) < 0.02 ? -0.08 : 0;
        const pu = (u * 2) % 1;
        const pv = (v * 2) % 1;
        const joint = Math.min(pu, 1 - pu, pv, 1 - pv) < 0.004 ? -0.12 : 0;
        const tie = [0.25, 0.75].some((a) =>
          [0.25, 0.75].some((b) => Math.hypot(pu - a, pv - b) < 0.008),
        )
          ? -0.45
          : 0;
        const mottle = N.fbm2(u * 6, v * 6, 4, 6) * 0.07;
        const pore = N.n2(u * 300, v * 300, 300) > 0.7 ? -0.18 : 0;
        const k = 1 + bandTone + mark + joint + tie + mottle + pore;
        return [scale(base, k), 0.5 + mark + tie * 1.2 + pore * 0.4 + joint];
      };
    },
  },
  render: {
    tile: 2,
    strength: 1.5,
    paint(N) {
      const base = hex("#ece6da");
      return (u, v) => {
        const m =
          N.fbm2(u * 4, v * 4, 4, 4) * 0.05 +
          N.n2(u * 200, v * 200, 200) * 0.02;
        return [scale(base, 1 + m), m * 4];
      };
    },
  },
  corten: {
    tile: 1.5,
    strength: 3,
    paint(N) {
      return (u, v) => {
        const m = N.fbm2(u * 5, v * 5, 5, 5);
        const streak = N.fbm2(u * 40, v * 3, 3, 40);
        let c = mix(hex("#7a3b22"), hex("#a65a30"), clamp01(m * 0.8 + 0.5));
        c = mix(c, hex("#4d2414"), smoothstep(0.2, 0.6, streak) * 0.45);
        const pit = N.n2(u * 220, v * 220, 220) > 0.6 ? 0.8 : 1;
        return [scale(c, pit), m * 0.6 + streak * 0.2];
      };
    },
  },
  zinc: {
    tile: 2,
    strength: 10,
    paint(N) {
      const base = hex("#8a9096");
      return (u, v) => {
        const fu = (u * 4) % 1;
        const seam = 1 - smoothstep(0.0, 0.025, Math.abs(fu - 0.5) - 0.012);
        const brushed = N.fbm2(u * 160, v * 6, 2, 160) * 0.04;
        const patina = N.fbm2(u * 3, v * 3, 4, 3) * 0.05;
        return [scale(base, 1 + brushed + patina + seam * 0.12), seam];
      };
    },
  },
  tiles: {
    tile: 1.2,
    strength: 8,
    paint(N) {
      const tones = ["#9c4a30", "#a85a36", "#8a3e28", "#b0623a", "#7a3a26"].map(
        hex,
      );
      return (u, v) => {
        const row = Math.floor(v * 4);
        const tu = u * 4 + (row % 2) * 0.5;
        const t = Math.floor(tu);
        const fu = tu - t;
        const fv = v * 4 - row;
        const profile = Math.pow(Math.sin(Math.PI * fu), 0.7);
        const shadow = smoothstep(0.78, 1, fv) * 0.45;
        const c = scale(
          tones[Math.floor(N.hash(t % 4, row % 4) * tones.length)],
          (0.75 + profile * 0.3) *
            (1 - shadow) *
            (0.94 + N.fbm2(u * 30, v * 30, 3, 30) * 0.1),
        );
        return [c, profile * 0.7 + (1 - fv) * 0.3];
      };
    },
  },
  sedum: {
    tile: 1.5,
    strength: 6,
    paint(N) {
      const greens = [
        "#5f7f3a",
        "#6f8f45",
        "#7a9a4a",
        "#4e6b30",
        "#86a052",
      ].map(hex);
      const accents = ["#b5524b", "#c9b34a", "#a04a5c"].map(hex);
      return (u, v) => {
        const w = N.worley2(u * 22, v * 22, 22);
        let c =
          w.id > 0.9
            ? accents[Math.floor(w.id * 31) % accents.length]
            : greens[Math.floor(w.id * greens.length * 1.1) % greens.length];
        const dome = 1 - smoothstep(0.15, 0.7, w.f1);
        c = scale(c, 0.55 + dome * 0.5 + N.n2(u * 180, v * 180, 180) * 0.12);
        if (w.f1 > 0.62) c = mix(c, hex("#3a2a1c"), 0.6);
        return [c, dome];
      };
    },
  },
  oak_bark: {
    tile: 1,
    strength: 10,
    paint(N) {
      return (u, v) => {
        const warp = N.fbm2(u * 3, v * 2, 3, 2) * 0.5;
        const ridge = 1 - Math.abs(N.n2(u * 16 + warp * 4, v * 1.5, 16));
        const fine = 1 - Math.abs(N.n2(u * 48 + warp * 6, v * 4, 48));
        const block = N.fbm2(u * 16, v * 3, 2, 16) * 0.5 + 0.5;
        const r = Math.pow(ridge, 1.6) * 0.6 + fine * 0.25 + block * 0.15;
        const c = mix(
          hex("#3a2f25"),
          hex("#8f8170"),
          smoothstep(0.15, 0.85, r),
        );
        const moss = smoothstep(0.3, 0.7, N.fbm2(u * 3, v * 3, 3, 3)) * 0.25;
        return [mix(c, hex("#5d6b3a"), moss), r];
      };
    },
  },
  pine_bark: {
    tile: 1,
    strength: 9,
    paint(N) {
      return (u, v) => {
        const w = N.worley2(u * 6, v * 3, 6);
        const plate = smoothstep(0.02, 0.12, w.f2 - w.f1);
        const c = mix(
          hex("#3a281c"),
          mix(hex("#8a5a3a"), hex("#a96c43"), w.id),
          plate,
        );
        return [scale(c, 0.9 + N.fbm2(u * 30, v * 15, 2, 30) * 0.15), plate];
      };
    },
  },
  birch_bark: {
    tile: 1,
    strength: 4,
    paint(N) {
      return (u, v) => {
        const patch = smoothstep(0.25, 0.6, N.fbm2(u * 3, v * 5, 4, 3));
        const lent = N.worley2(u * 3, v * 22, 3);
        const dash = lent.f1 < 0.18 && lent.id > 0.35 ? 1 : 0;
        let c = mix(hex("#ece8de"), hex("#bdb7aa"), patch * 0.6);
        c = mix(c, hex("#1e1b18"), dash * 0.85);
        return [c, 1 - dash * 0.6 - patch * 0.2];
      };
    },
  },
  rock: {
    tile: 3,
    strength: 7,
    paint(N) {
      return (u, v) => {
        const base = N.fbm2(u * 4, v * 4, 5, 4);
        const ridged = 1 - Math.abs(N.fbm2(u * 8 + 3, v * 8, 4, 8));
        const strata = Math.sin((v * 18 + base * 3) * Math.PI) * 0.5 + 0.5;
        let c = mix(
          hex("#5f5c57"),
          hex("#9a958c"),
          clamp01(base * 0.7 + 0.5 + strata * 0.15),
        );
        c = scale(c, 0.75 + ridged * 0.35);
        const lichen = N.worley2(u * 14, v * 14, 14);
        if (lichen.id > 0.9 && lichen.f1 < 0.18)
          c = mix(c, lichen.id > 0.95 ? hex("#d9d4b0") : hex("#9aa35a"), 0.6);
        return [c, base * 0.5 + ridged * 0.5];
      };
    },
  },
  water: {
    tile: 6,
    strength: 3,
    paint(N) {
      return (u, v) => {
        const h =
          N.fbm2(u * 6, v * 6, 4, 6) + N.fbm2(u * 14 + 5, v * 14, 3, 14) * 0.4;
        return [hex("#2c5d70"), h];
      };
    },
  },
};

/** Real-world metres covered by one tile of a material. */
export const TILE_M = Object.fromEntries(
  Object.entries(MATERIALS).map(([k, m]) => [k, m.tile]),
);

export const colorId = (name) => `${name}-${VERSION}`;
export const normalId = (name) => `${name}-n-${VERSION}`;

/** Colour and normal textures for materials not yet in ctx.assets. */
export async function materialTextures(names, assets = {}, size = 512) {
  const out = [];
  for (const name of new Set(names)) {
    const m = MATERIALS[name];
    if (!m) throw new Error(`Unknown material texture ${name}`);
    if (assets[colorId(name)] && assets[normalId(name)]) continue;
    const N = createNoise(name.length * 7919 + 13);
    const { color, height } = paint(size, m.paint(N));
    const normal = normalMap(height, size, m.strength);
    if (!assets[colorId(name)])
      out.push(await pngTexture(colorId(name), size, size, color, 3));
    if (!assets[normalId(name)])
      out.push(
        await pngTexture(
          normalId(name),
          normal.size,
          normal.size,
          normal.pixels,
          3,
        ),
      );
  }
  return out;
}

/** Material fields for a textured surface. */
export function textured(name, extra = {}) {
  return {
    map: `texture:${colorId(name)}`,
    normalMap: `texture:${normalId(name)}`,
    color: "#ffffff",
    roughness: 0.85,
    ...extra,
  };
}

// ── Foliage atlases: 2 × 2 cells of alpha-cut twigs, leaves, needles, blades ──

const FOLIAGE = {
  oak_leaves: {
    leaves: 24,
    len: 0.3,
    width: 0.15,
    lobes: 5,
    colors: ["#3f6a2e", "#4e7a36", "#5d8a3c", "#36602a"],
  },
  birch_leaves: {
    leaves: 34,
    len: 0.19,
    width: 0.12,
    lobes: 0,
    colors: ["#7fa64a", "#8fb555", "#6f9a40", "#9cbc5c"],
  },
  shrub_leaves: {
    leaves: 28,
    len: 0.22,
    width: 0.11,
    lobes: 0,
    colors: ["#4a7034", "#56803c", "#3e6430", "#628a44"],
  },
  needles: {
    needles: 150,
    colors: ["#3a6a3c", "#457a44", "#335e36", "#4f8648"],
  },
  grass_blades: {
    blades: 22,
    colors: ["#7f9a45", "#8fa850", "#a6ad5c", "#6c8a3c", "#b8b06a"],
  },
  fern: { fern: true, colors: ["#4f7d34", "#5e8c3c", "#456f2e"] },
};

export const FOLIAGE_KINDS = Object.keys(FOLIAGE);

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(
    ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1),
  );
  return [Math.hypot(px - ax - dx * t, py - ay - dy * t), t];
}

function foliageCell(spec, N, cell) {
  const rand = (() => {
    let s = cell * 9973 + 17;
    return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  })();
  const shapes = [];
  if (spec.leaves) {
    for (let i = 0; i < spec.leaves; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.04 + Math.sqrt(rand()) * 0.34;
      shapes.push({
        kind: "leaf",
        x: 0.5 + Math.cos(a) * r * 0.9,
        y: 0.45 + Math.sin(a) * r * 0.9,
        angle: a + (rand() - 0.5) * 0.9,
        len: spec.len * (0.75 + rand() * 0.5),
        width: spec.width * (0.8 + rand() * 0.4),
        color: hex(spec.colors[Math.floor(rand() * spec.colors.length)]),
        shade: 0.8 + rand() * 0.35,
      });
    }
  }
  if (spec.needles) {
    for (let i = 0; i < spec.needles; i++) {
      const t = rand();
      const bx = 0.5 + (t - 0.5) * 0.15;
      const by = 0.95 - t * 0.85;
      const a = (rand() - 0.5) * Math.PI * 1.6 - Math.PI / 2;
      const l = 0.16 + rand() * 0.18;
      shapes.push({
        kind: "line",
        ax: bx,
        ay: by,
        bx: bx + Math.cos(a) * l,
        by: by + Math.sin(a) * l,
        w: 0.008,
        color: hex(spec.colors[Math.floor(rand() * spec.colors.length)]),
      });
    }
    shapes.unshift({
      kind: "line",
      ax: 0.5,
      ay: 0.98,
      bx: 0.5,
      by: 0.08,
      w: 0.012,
      color: hex("#5a4030"),
    });
  }
  if (spec.blades) {
    for (let i = 0; i < spec.blades; i++) {
      shapes.push({
        kind: "blade",
        x0: 0.15 + rand() * 0.7,
        bend: (rand() - 0.5) * 0.5,
        h: 0.55 + rand() * 0.42,
        w: 0.025 + rand() * 0.02,
        color: hex(spec.colors[Math.floor(rand() * spec.colors.length)]),
      });
    }
  }
  if (spec.fern) {
    const color = hex(spec.colors[cell % spec.colors.length]);
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const y = 0.95 - t * 0.85;
      const x = 0.5 + Math.sin(t * 2) * 0.05;
      const l = 0.22 * Math.sin(Math.PI * (0.15 + t * 0.85));
      for (const side of [-1, 1]) {
        shapes.push({
          kind: "leaf",
          x: x + side * l * 0.5,
          y: y - l * 0.15,
          angle: side < 0 ? Math.PI + 0.3 : -0.3,
          len: l,
          width: 0.035,
          color,
          shade: 0.85 + t * 0.2,
        });
      }
    }
    shapes.unshift({
      kind: "line",
      ax: 0.5,
      ay: 0.98,
      bx: 0.52,
      by: 0.08,
      w: 0.008,
      color: hex("#4a5a2a"),
    });
  }
  return shapes;
}

/** RGBA atlas for a foliage kind: four cells, cut out by alpha. */
export async function foliageTexture(kind, assets = {}, size = 512) {
  const id = colorId(kind);
  if (assets[id]) return [];
  const spec = FOLIAGE[kind];
  if (!spec) throw new Error(`Unknown foliage ${kind}`);
  const N = createNoise(kind.length * 31 + 5);
  const px = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let cell = 0; cell < 4; cell++) {
    const shapes = foliageCell(spec, N, cell);
    const ox = (cell % 2) * half;
    const oy = Math.floor(cell / 2) * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const u = x / half;
        const v = y / half;
        let hit = null;
        let tint = 1;
        for (const s of shapes) {
          if (s.kind === "leaf") {
            const dx = u - s.x;
            const dy = v - s.y;
            const ca = Math.cos(-s.angle);
            const sa = Math.sin(-s.angle);
            const lu = (dx * ca - dy * sa) / s.len + 0.5;
            const lv = (dx * sa + dy * ca) / s.len;
            if (lu < 0 || lu > 1) continue;
            let w =
              Math.pow(Math.sin(Math.PI * lu), 0.8) * (s.width / s.len) * 0.5;
            if (spec.lobes)
              w *= 0.7 + 0.3 * Math.abs(Math.sin(lu * Math.PI * spec.lobes));
            if (Math.abs(lv) > w) continue;
            hit = s;
            const vein = Math.abs(lv) < w * 0.08 ? 0.75 : 1;
            tint =
              s.shade *
              vein *
              (0.85 + lu * 0.25) *
              (1 - (Math.abs(lv) / w) * 0.18);
          } else if (s.kind === "line") {
            const [d] = segmentDistance(u, v, s.ax, s.ay, s.bx, s.by);
            if (d < s.w) {
              hit = s;
              tint = 0.85 + (1 - d / s.w) * 0.25;
            }
          } else if (s.kind === "blade") {
            const t = 1 - v;
            if (t > s.h) continue;
            const k = t / s.h;
            const cx = s.x0 + s.bend * k * k;
            const w = s.w * (1 - k) * 0.5 + 0.002;
            if (Math.abs(u - cx) < w) {
              hit = s;
              tint = 0.65 + k * 0.5;
            }
          }
        }
        const i = ((oy + y) * size + ox + x) * 4;
        if (!hit) continue;
        const noise = 0.92 + N.n2(u * 60 + cell * 7, v * 60) * 0.1;
        px[i] = Math.min(255, hit.color[0] * tint * noise);
        px[i + 1] = Math.min(255, hit.color[1] * tint * noise);
        px[i + 2] = Math.min(255, hit.color[2] * tint * noise);
        px[i + 3] = 255;
      }
    }
  }
  return [await pngTexture(id, size, size, px, 4)];
}

/** UV rectangle [u0, v0, u1, v1] of one atlas cell (glTF UVs: v down). */
export function foliageCellUV(cell) {
  const u0 = (cell % 2) * 0.5;
  const v0 = Math.floor(cell / 2) * 0.5;
  return [u0, v0, u0 + 0.5, v0 + 0.5];
}

export function foliageMaterial(kind, extra = {}) {
  return {
    map: `texture:${colorId(kind)}`,
    color: "#ffffff",
    roughness: 0.75,
    alphaMode: "MASK",
    alphaCutoff: 0.5,
    doubleSided: true,
    ...extra,
  };
}
