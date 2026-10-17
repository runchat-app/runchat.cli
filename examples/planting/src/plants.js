// A parametric plant: one design (form, trunk, branching, crown, foliage,
// bark) grown into a model 1 unit tall standing on the origin. Templates are
// starting points; agents and people tune the parameters from there.
import { card, finish, part, quad, rng, tube, vec } from "./geom.js";
import {
  FOLIAGE_KINDS,
  foliageCellUV,
  foliageMaterial,
  textured,
} from "./textures.js";

export const VARIANTS = 3;
export const FORMS = [
  "broadleaf",
  "conifer",
  "columnar",
  "shrub",
  "fern",
  "grass",
];
export const CROWNS = [
  "round",
  "oval",
  "spreading",
  "vase",
  "weeping",
  "conical",
  "columnar",
];
export const BARKS = ["oak_bark", "pine_bark", "birch_bark"];
export const LEAVES = FOLIAGE_KINDS;

const BASE = {
  name: "plant",
  form: "broadleaf",
  height: [9, 16],
  trunk: { height: 0.42, radius: 0.04, lean: 0.06, gnarl: 0.12 },
  branching: {
    levels: 3,
    counts: [7, 4, 3],
    angles: [58, 42, 36],
    lengths: [0.95, 0.55, 0.45],
    droop: [0.02, 0.06, 0.1],
    start: [0.55, 0.2, 0.3],
    wander: 0.3,
  },
  crown: "round",
  conifer: { whorls: 12, arms: 5, reach: 0.24, start: 0.2 },
  foliage: {
    kind: "oak_leaves",
    size: 0.115,
    density: 6,
    tint: "#ffffff",
    variation: 0.12,
  },
  bark: { kind: "oak_bark", tint: "#ffffff" },
  seed: 1,
};

const T = (over) => mergeDesign(BASE, over);
export const TEMPLATES = {
  oak: T({ name: "English oak" }),
  maple: T({
    name: "Japanese maple",
    height: [3, 6],
    crown: "vase",
    trunk: { height: 0.25, radius: 0.03, lean: 0.12, gnarl: 0.2 },
    branching: {
      counts: [6, 4, 3],
      angles: [45, 38, 32],
      lengths: [0.8, 0.6, 0.5],
    },
    foliage: { kind: "shrub_leaves", size: 0.13, density: 7, tint: "#ff6a4a" },
  }),
  willow: T({
    name: "Weeping willow",
    height: [8, 14],
    crown: "weeping",
    foliage: { kind: "birch_leaves", size: 0.1, density: 9, tint: "#d8f0a0" },
    branching: { droop: [0.1, 0.5, 0.9], counts: [8, 4, 4] },
  }),
  birch: T({
    name: "Silver birch",
    height: [8, 15],
    crown: "oval",
    trunk: { height: 0.7, radius: 0.022, lean: 0.05, gnarl: 0.08 },
    branching: {
      counts: [9, 4, 3],
      angles: [38, 35, 30],
      lengths: [0.48, 0.5, 0.45],
      droop: [0.05, 0.25, 0.5],
      start: [0.35, 0.25, 0.3],
    },
    foliage: { kind: "birch_leaves", size: 0.085, density: 7 },
    bark: { kind: "birch_bark" },
  }),
  pine: T({
    name: "Scots pine",
    form: "conifer",
    height: [12, 22],
    crown: "round",
    conifer: { whorls: 8, arms: 5, reach: 0.2, start: 0.55 },
    foliage: { kind: "needles", size: 0.085, density: 6 },
    bark: { kind: "pine_bark" },
  }),
  spruce: T({
    name: "Norway spruce",
    form: "conifer",
    height: [10, 20],
    crown: "conical",
    conifer: { whorls: 14, arms: 6, reach: 0.25, start: 0.15 },
    foliage: { kind: "needles", size: 0.075, density: 7, tint: "#c8e0c8" },
    bark: { kind: "pine_bark" },
  }),
  cypress: T({
    name: "Italian cypress",
    form: "columnar",
    height: [7, 14],
    crown: "columnar",
    foliage: { kind: "needles", size: 0.075, density: 70, tint: "#b8d0b0" },
    bark: { kind: "pine_bark" },
  }),
  hazel: T({
    name: "Hazel shrub",
    form: "shrub",
    height: [1.5, 3.5],
    crown: "round",
    branching: {
      counts: [8, 4, 3],
      angles: [0, 45, 40],
      lengths: [0.75, 0.45, 0.4],
      droop: [0, 0.1, 0.2],
    },
    foliage: { kind: "shrub_leaves", size: 0.24, density: 5 },
  }),
  bracken: T({
    name: "Bracken fern",
    form: "fern",
    height: [0.6, 1.2],
    foliage: { kind: "fern", size: 0.32, density: 11 },
  }),
  meadow_grass: T({
    name: "Meadow grass",
    form: "grass",
    height: [0.4, 1],
    foliage: { kind: "grass_blades", size: 0.5, density: 5 },
  }),
};

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge a partial design onto a base (arrays replace whole). */
export function mergeDesign(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = isObject(v) && isObject(base[k]) ? mergeDesign(base[k], v) : v;
  }
  return out;
}

const clamp = (v, a, b, d) =>
  typeof v === "number" && isFinite(v) ? Math.min(b, Math.max(a, v)) : d;

/** A complete, valid design from any partial one. */
export function normalizeDesign(input) {
  const d = mergeDesign(BASE, input ?? {});
  if (!FORMS.includes(d.form)) d.form = "broadleaf";
  if (!CROWNS.includes(d.crown)) d.crown = "round";
  if (!LEAVES.includes(d.foliage.kind)) d.foliage.kind = "oak_leaves";
  if (!BARKS.includes(d.bark.kind)) d.bark.kind = "oak_bark";
  d.height = [
    clamp(d.height?.[0], 0.2, 60, 8),
    clamp(d.height?.[1], 0.2, 60, 14),
  ].sort((a, b) => a - b);
  d.trunk.height = clamp(d.trunk.height, 0.05, 0.95, 0.42);
  d.trunk.radius = clamp(d.trunk.radius, 0.005, 0.15, 0.04);
  d.branching.levels = Math.round(clamp(d.branching.levels, 1, 4, 3));
  d.foliage.size = clamp(d.foliage.size, 0.02, 1, 0.1);
  d.foliage.density = clamp(d.foliage.density, 1, 120, 6);
  for (const key of ["counts", "angles", "lengths", "droop", "start"]) {
    const arr = Array.isArray(d.branching[key])
      ? d.branching[key]
      : BASE.branching[key];
    d.branching[key] = [0, 1, 2, 3].map((i) =>
      typeof arr[i] === "number" ? arr[i] : (arr[arr.length - 1] ?? 0),
    );
  }
  d.seed = Math.round(clamp(d.seed, 0, 1e6, 1));
  return d;
}

/** Stable key for a design: placements of the same design share one model. */
export function designKey(d) {
  const text = JSON.stringify(d);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  const slug = String(d.name || "plant")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 20);
  return `${slug}_${(h >>> 0).toString(36)}`;
}

export function designTextures(d) {
  return {
    barks: d.form === "fern" || d.form === "grass" ? [] : [d.bark.kind],
    foliage: [d.foliage.kind],
  };
}

const BARK_TILE = 0.07;

function rotateAround(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = vec.dot(axis, v);
  const cr = vec.cross(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * d * (1 - c),
    v[1] * c + cr[1] * s + axis[1] * d * (1 - c),
    v[2] * c + cr[2] * s + axis[2] * d * (1 - c),
  ];
}

const perpendicular = (dir) =>
  vec.norm(
    Math.abs(dir[2]) < 0.9
      ? vec.cross(dir, [0, 0, 1])
      : vec.cross(dir, [1, 0, 0]),
  );

function tintHex(k, tint) {
  const n = parseInt(tint.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => f(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** How far branches may reach at height z (0–1) for a crown shape. */
function envelope(crown, z, crownZ) {
  switch (crown) {
    case "oval":
      return Math.max(0.25, 1 - Math.abs(z - crownZ) * 1.1);
    case "spreading":
      return Math.max(0.35, 1.25 - Math.abs(z - crownZ) * 1.8);
    case "vase":
      return Math.max(0.3, 0.45 + (z - 0.2) * 1.1);
    case "weeping":
      return Math.max(0.4, 1.1 - Math.abs(z - crownZ) * 1.2);
    case "conical":
      return Math.max(0.15, 1.2 - z * 1.05);
    case "columnar":
      return 0.35;
    default:
      return Math.max(0.25, 1 - Math.abs(z - crownZ) * 1.4);
  }
}

/** Grow one variant of a design: parts for a model 1 unit tall. */
export function growPlant(design, variant = 0) {
  const d = normalizeDesign(design);
  const rand = rng(d.seed * 7919 + variant * 104729 + 17);
  const bark = part();
  const leaves = part();
  const cards = [];
  const leafAt = (at, dir, size) =>
    cards.push({ at, dir, size, cell: Math.floor(rand() * 4) });
  const br = d.branching;

  function limb(
    start,
    dir,
    length,
    r0,
    r1,
    { gravity = 0, wander = 0.25, segments = 6, sides = 6 } = {},
  ) {
    const path = [[...start, r0]];
    let dd = vec.norm(dir);
    let at = start;
    for (let i = 1; i <= segments; i++) {
      const k = i / segments;
      dd = vec.norm([
        dd[0] + (rand() - 0.5) * wander,
        dd[1] + (rand() - 0.5) * wander,
        dd[2] + (rand() - 0.5) * wander * 0.6 - gravity * k,
      ]);
      at = vec.add(at, vec.scale(dd, length / segments));
      path.push([...at, r0 + (r1 - r0) * k]);
    }
    tube(bark, path, { sides, tile: BARK_TILE });
    return path;
  }
  const pointOn = (path, t) => {
    const f = t * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    const k = f - i;
    return [0, 1, 2, 3].map(
      (j) => path[i][j] + (path[i + 1][j] - path[i][j]) * k,
    );
  };
  const dirOn = (path, t) => {
    const i = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
    return vec.norm(vec.sub(path[i + 1].slice(0, 3), path[i].slice(0, 3)));
  };

  const crownZ = d.trunk.height + (1 - d.trunk.height) * 0.45;
  function branchOut(path, level) {
    const length = vec.len(
      vec.sub(path[path.length - 1].slice(0, 3), path[0].slice(0, 3)),
    );
    if (level >= br.levels) {
      for (let i = 0; i < d.foliage.density; i++) {
        const p = pointOn(path, 0.35 + rand() * 0.65);
        const dir = vec.norm([
          rand() - 0.5,
          rand() - 0.5,
          rand() - (d.crown === "weeping" ? 0.6 : 0.2),
        ]);
        leafAt(
          vec.add(p.slice(0, 3), vec.scale(dir, d.foliage.size * 0.3)),
          dir,
          d.foliage.size * (0.75 + rand() * 0.5),
        );
      }
      return;
    }
    const count = Math.round(br.counts[level]);
    let twist = rand() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const t =
        br.start[level] +
        (1 - br.start[level]) * ((i + rand() * 0.6) / Math.max(1, count));
      const p = pointOn(path, t);
      const along = dirOn(path, t);
      twist += 2.39996;
      const side = rotateAround(perpendicular(along), along, twist);
      const angle = (br.angles[level] + (rand() - 0.5) * 18) * (Math.PI / 180);
      const dir = vec.norm(
        vec.add(
          vec.scale(along, Math.cos(angle)),
          vec.scale(side, Math.sin(angle)),
        ),
      );
      const len =
        length *
        br.lengths[level] *
        (1.1 - t * 0.45) *
        envelope(d.crown, p[2], crownZ) *
        (0.8 + rand() * 0.4);
      if (len < 0.01) continue;
      const r = Math.max(0.0015, p[3] * 0.62);
      const child = limb(p.slice(0, 3), dir, len, r, r * 0.35, {
        gravity: br.droop[level],
        wander: br.wander,
        segments: level === 0 ? 5 : 4,
        sides: level === 0 ? 6 : 4,
      });
      branchOut(child, level + 1);
    }
  }

  if (d.form === "broadleaf") {
    const lean = [
      (rand() - 0.5) * d.trunk.lean * 2,
      (rand() - 0.5) * d.trunk.lean * 2,
      1,
    ];
    const trunk = limb(
      [0, 0, 0],
      lean,
      d.trunk.height,
      d.trunk.radius,
      d.trunk.radius * 0.65,
      { wander: d.trunk.gnarl, segments: 6, sides: 9 },
    );
    branchOut(trunk, 0);
  } else if (d.form === "shrub") {
    const stems = Math.max(2, Math.round(br.counts[0]));
    for (let i = 0; i < stems; i++) {
      const ang = (i / stems) * Math.PI * 2 + rand();
      const dir = [Math.cos(ang) * 0.45, Math.sin(ang) * 0.45, 1];
      const stem = limb(
        [Math.cos(ang) * 0.05, Math.sin(ang) * 0.05, 0],
        dir,
        br.lengths[0] * (0.8 + rand() * 0.35),
        d.trunk.radius * 0.45,
        d.trunk.radius * 0.15,
        { segments: 4, sides: 5, wander: 0.3 },
      );
      branchOut(stem, 1);
    }
  } else if (d.form === "conifer") {
    const c = d.conifer;
    const trunk = limb(
      [0, 0, 0],
      [(rand() - 0.5) * d.trunk.lean, (rand() - 0.5) * d.trunk.lean, 1],
      1,
      d.trunk.radius * 0.8,
      0.004,
      { wander: d.trunk.gnarl * 0.4, segments: 10, sides: 8 },
    );
    const whorls = Math.round(c.whorls);
    for (let w = 0; w < whorls; w++) {
      const t = c.start + (w / whorls) * (0.97 - c.start);
      const p = pointOn(trunk, t);
      const arms = Math.round(c.arms) + Math.floor(rand() * 2);
      const spin = rand() * Math.PI * 2;
      const reach = c.reach * envelope(d.crown, t, 0.75) + 0.03;
      for (let a = 0; a < arms; a++) {
        const ang = spin + (a / arms) * Math.PI * 2 + (rand() - 0.5) * 0.5;
        const up =
          d.crown === "conical" ? -0.12 + rand() * 0.1 : 0.25 + rand() * 0.2;
        const dir = [Math.cos(ang), Math.sin(ang), up];
        const arm = limb(
          p.slice(0, 3),
          dir,
          reach * (0.8 + rand() * 0.4),
          p[3] * 0.45,
          0.002,
          { gravity: br.droop[0] + 0.03, wander: 0.15, segments: 4, sides: 4 },
        );
        for (let i = 0; i < d.foliage.density; i++) {
          const q = pointOn(arm, 0.25 + (i / d.foliage.density) * 0.75);
          leafAt(
            q.slice(0, 3),
            vec.norm([
              dir[0] + (rand() - 0.5) * 0.6,
              dir[1] + (rand() - 0.5) * 0.6,
              up + 0.3 + rand() * 0.3,
            ]),
            d.foliage.size * (0.8 + rand() * 0.4),
          );
        }
      }
    }
    for (let i = 0; i < 3; i++)
      leafAt(
        pointOn(trunk, 0.97 + i * 0.01).slice(0, 3),
        [0, 0, 1],
        d.foliage.size * 0.8,
      );
  } else if (d.form === "columnar") {
    const trunk = limb(
      [0, 0, 0],
      [0, 0, 1],
      0.98,
      d.trunk.radius * 0.75,
      0.004,
      { wander: 0.02, segments: 8, sides: 7 },
    );
    const twigs = Math.round(d.foliage.density);
    for (let i = 0; i < twigs; i++) {
      const t = 0.08 + (i / twigs) * 0.9;
      const p = pointOn(trunk, t);
      const ang = i * 2.39996;
      const reach = 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.02;
      const dir = vec.norm([Math.cos(ang), Math.sin(ang), 1.6]);
      const twig = limb(p.slice(0, 3), dir, reach * 1.2, p[3] * 0.4, 0.002, {
        segments: 2,
        sides: 3,
        wander: 0.1,
      });
      for (let k = 0; k < 2; k++)
        leafAt(
          pointOn(twig, 0.5 + k * 0.4).slice(0, 3),
          vec.norm([dir[0], dir[1], 0.8]),
          d.foliage.size * (0.8 + rand() * 0.4),
        );
    }
  } else if (d.form === "fern" || d.form === "grass") {
    const fern = d.form === "fern";
    const n = Math.round(d.foliage.density);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * (fern ? 2 : 1) + rand() * 0.5;
      const [u0, v0, u1, v1] = foliageCellUV(Math.floor(rand() * 4));
      const color = tintHex(0.85 + rand() * 0.3, d.foliage.tint);
      if (fern) {
        const tilt = 0.6 + rand() * 0.5;
        const out = [Math.cos(ang), Math.sin(ang), 0];
        const up = vec.norm([out[0] * tilt, out[1] * tilt, 1]);
        const side = vec.norm(vec.cross(up, out));
        const tip = vec.scale(up, 0.85 + rand() * 0.25);
        const w = d.foliage.size;
        quad(
          leaves,
          [
            vec.scale(side, -w / 2),
            vec.scale(side, w / 2),
            vec.add(tip, vec.scale(side, w / 2)),
            vec.add(tip, vec.scale(side, -w / 2)),
          ],
          color,
          [
            [u0, v1],
            [u1, v1],
            [u1, v0],
            [u0, v0],
          ],
        );
      } else {
        const off = [(rand() - 0.5) * 0.25, (rand() - 0.5) * 0.25, 0];
        const side = [
          Math.cos(ang) * d.foliage.size,
          Math.sin(ang) * d.foliage.size,
          0,
        ];
        const lean = [
          (rand() - 0.5) * 0.25,
          (rand() - 0.5) * 0.25,
          0.8 + rand() * 0.3,
        ];
        quad(
          leaves,
          [
            vec.sub(off, side),
            vec.add(off, side),
            vec.add(vec.add(off, side), lean),
            vec.add(vec.sub(off, side), lean),
          ],
          color,
          [
            [u0, v1],
            [u1, v1],
            [u1, v0],
            [u0, v0],
          ],
        );
      }
    }
  }

  if (cards.length) {
    const centre = cards
      .reduce((c, k) => vec.add(c, k.at), [0, 0, 0])
      .map((v) => v / cards.length);
    const radius =
      Math.max(...cards.map((k) => vec.len(vec.sub(k.at, centre)))) || 1;
    for (const k of cards) {
      const outward = vec.len(vec.sub(k.at, centre)) / radius;
      const light =
        0.55 +
        outward * 0.5 +
        (k.at[2] - centre[2]) * 0.4 +
        (rand() - 0.5) * d.foliage.variation * 2;
      const up = Math.abs(k.dir[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
      card(
        leaves,
        k.at,
        k.dir,
        up,
        k.size,
        foliageCellUV(k.cell),
        tintHex(Math.max(0.35, Math.min(1.15, light)), d.foliage.tint),
      );
    }
  }

  let top = 0;
  for (const q of [bark, leaves])
    for (let i = 2; i < q.vertices.length; i += 3)
      top = Math.max(top, q.vertices[i]);
  if (top > 0)
    for (const q of [bark, leaves])
      q.vertices = q.vertices.map((v) => Math.round((v / top) * 1000) / 1000);

  const parts = [];
  if (bark.faces.length)
    parts.push({
      ...finish(bark),
      material: textured(d.bark.kind, { color: d.bark.tint, roughness: 0.95 }),
    });
  if (leaves.faces.length)
    parts.push({
      ...finish(leaves),
      material: foliageMaterial(d.foliage.kind),
    });
  return parts;
}

/** A compact summary of a design for agents. */
export function summarize(d) {
  return {
    name: d.name,
    form: d.form,
    crown: d.crown,
    height_m: d.height,
    trunk: d.trunk,
    branching:
      d.form === "broadleaf" || d.form === "shrub" ? d.branching : undefined,
    conifer: d.form === "conifer" ? d.conifer : undefined,
    foliage: d.foliage,
    bark: d.bark,
    seed: d.seed,
  };
}
