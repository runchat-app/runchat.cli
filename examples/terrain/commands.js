// Terrain's API: shape a landscape and publish it to the shared 3D scene —
// a textured ground mesh (named "terrain", with its height grid inside so
// other apps can sit things on it), overhanging cliff faces, boulders and
// water. Metres, Z up, centred on the origin.
import {
  DEFAULTS,
  PALETTES,
  bakeTerrain,
  buildTerrain,
  cliffFace,
  heightAt,
  rockModel,
} from "./src/terrain.js";
import { materialTextures, textured, TILE_M } from "./src/textures.js";
import { pngTexture } from "./src/png.js";
import { rng } from "./src/geom.js";

const xy = {
  type: "array",
  items: { type: "number" },
  description: "[x, y] metres",
};
const ROCK_VARIANTS = 6;
const MAX_ROCKS = 600;

const paramsOf = (state) => ({ ...DEFAULTS, ...(state.params ?? {}) });

function docHash(params, features) {
  const text = JSON.stringify([params, features]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Everything a landscape document puts in the scene. */
async function publish(
  state,
  ctx,
  { params, features, rocks },
  extraOps = [],
  note = {},
) {
  params = params ?? paramsOf(state);
  features = features ?? state.features ?? [];
  rocks = rocks ?? state.rocks ?? [];
  const t = buildTerrain(params, features);
  const key = docHash(params, features);
  const textures = await materialTextures(["rock", "water"], ctx.assets);
  const groundId = `terrain-${key}`;
  if (!ctx.assets[groundId]) {
    const baked = bakeTerrain(t, params, features);
    textures.push(
      await pngTexture(groundId, baked.size, baked.size, baked.color, 3),
    );
    textures.push(
      await pngTexture(
        `terrain-n-${key}`,
        baked.normalSize,
        baked.normalSize,
        baked.normal,
        3,
      ),
    );
  }
  const ground = {
    vertices: t.vertices,
    grid: [t.cols, t.rows],
    material: {
      map: `texture:${groundId}`,
      normalMap: `texture:terrain-n-${key}`,
      color: "#ffffff",
      roughness: 0.95,
    },
    extras: {
      heightfield: {
        cols: t.cols,
        rows: t.rows,
        min: t.min,
        max: t.max,
        heights: t.heights,
        water: params.water_level,
      },
    },
  };
  const parts = [ground];
  if (params.water_level != null) {
    const [x0, y0] = t.min;
    const [x1, y1] = t.max;
    const z = params.water_level;
    const tile = TILE_M.water;
    parts.push({
      vertices: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
      faces: [0, 1, 2, 0, 2, 3],
      uvs: [
        x0 / tile,
        y0 / tile,
        x1 / tile,
        y0 / tile,
        x1 / tile,
        y1 / tile,
        x0 / tile,
        y1 / tile,
      ],
      material: {
        ...textured("water"),
        map: undefined,
        color: "#24566a",
        roughness: 0.06,
        metalness: 0.05,
        opacity: 0.82,
      },
    });
  }
  parts.push(skirt(t));
  const meshes = [{ id: "terrain", name: "Terrain", parent: ctx.group, parts }];
  const cliffs = features.filter((f) => f.type === "cliff");
  cliffs.forEach((f, i) => {
    const face = cliffFace(f, params, features);
    meshes.push({
      id: `cliff-${i}`,
      name: `Cliff ${i + 1}`,
      parent: ctx.group,
      parts: [{ ...face, material: textured("rock", { roughness: 0.92 }) }],
    });
  });
  const byVariant = new Map();
  for (const r of rocks) {
    if (!byVariant.has(r.v)) byVariant.set(r.v, []);
    byVariant.get(r.v).push(r);
  }
  for (const [v, list] of byVariant) {
    meshes.push({
      id: `rocks-${v}`,
      name: "Boulder",
      parent: ctx.group,
      parts: [
        { ...rockModel(v), material: textured("rock", { roughness: 0.9 }) },
      ],
      instances: list.map((r) => ({
        position: [
          r.x,
          r.y,
          +(heightAt(params, features, r.x, r.y) - r.s * r.sink).toFixed(3),
        ],
        rotation: [r.tilt, r.tilt * 0.5, r.rot],
        scale: [r.s, r.s * r.sy, r.s],
      })),
    });
  }
  const scene = ctx.scene.some((o) => o.id === ctx.group)
    ? []
    : [{ op: "add", kind: "group", id: ctx.group, name: "Landscape" }];
  const liveCliffs = new Set(cliffs.map((_, i) => `cliff-${i}`));
  const liveRocks = new Set([...byVariant.keys()].map((v) => `rocks-${v}`));
  for (const o of ctx.scene) {
    if (/^cliff-\d+$/.test(o.id) && !liveCliffs.has(o.id))
      scene.push({ op: "remove", id: o.id });
    const m = /^(rocks-\d+)-\d+$/.exec(o.id);
    if (m && !liveRocks.has(m[1])) scene.push({ op: "remove", id: o.id });
  }
  return {
    ops: extraOps,
    scene,
    meshes,
    textures,
    result: { ...t.stats, cliffs: cliffs.length, rocks: rocks.length, ...note },
  };
}

/** Earth sides down to a base below the lowest ground: the site as a cut-away block. */
function skirt(t) {
  const base = Math.min(t.stats.lowest_m, 0) - 3;
  const { cols, rows, heights, min, max } = t;
  const vertices = [];
  const faces = [];
  const colors = [];
  const edge = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, ah] = pts[i];
      const [bx, by, bh] = pts[i + 1];
      const k = vertices.length / 3;
      vertices.push(ax, ay, base, bx, by, base, bx, by, bh, ax, ay, ah);
      colors.push("#3b2f24", "#3b2f24", "#6a5440", "#6a5440");
      faces.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  };
  const x = (c) => min[0] + ((max[0] - min[0]) * c) / (cols - 1);
  const y = (r) => min[1] + ((max[1] - min[1]) * r) / (rows - 1);
  const h = (c, r) => heights[r * cols + c];
  edge(Array.from({ length: cols }, (_, c) => [x(c), y(0), h(c, 0)]));
  edge(Array.from({ length: rows }, (_, r) => [x(cols - 1), y(r), h(cols - 1, r)]));
  edge(Array.from({ length: cols }, (_, c) => [x(cols - 1 - c), y(rows - 1), h(cols - 1 - c, rows - 1)]));
  edge(Array.from({ length: rows }, (_, r) => [x(0), y(rows - 1 - r), h(0, rows - 1 - r)]));
  const k = vertices.length / 3;
  vertices.push(min[0], min[1], base, min[0], max[1], base, max[0], max[1], base, max[0], min[1], base);
  colors.push("#2e251d", "#2e251d", "#2e251d", "#2e251d");
  faces.push(k, k + 1, k + 2, k, k + 2, k + 3);
  return { vertices, faces, colors, material: { roughness: 1 } };
}

function makeRocks(
  params,
  features,
  existing,
  {
    center = [0, 0],
    radius = 10,
    count = 12,
    size = [0.4, 1.6],
    seed,
    minSlope = 0,
    maxSlope = 90,
  },
) {
  const rand = rng(seed ?? Date.now());
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 30; tries++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * radius;
    const x = center[0] + Math.cos(a) * d;
    const y = center[1] + Math.sin(a) * d;
    const e = 0.6;
    const gx =
      (heightAt(params, features, x + e, y) -
        heightAt(params, features, x - e, y)) /
      (2 * e);
    const gy =
      (heightAt(params, features, x, y + e) -
        heightAt(params, features, x, y - e)) /
      (2 * e);
    const slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    if (slope < minSlope || slope > maxSlope) continue;
    if (
      params.water_level != null &&
      heightAt(params, features, x, y) < params.water_level - 0.3
    )
      continue;
    const s = size[0] + Math.pow(rand(), 2.2) * (size[1] - size[0]);
    if (
      [...existing, ...out].some(
        (r) => Math.hypot(r.x - x, r.y - y) < (r.s + s) * 0.45,
      )
    )
      continue;
    out.push({
      x: +x.toFixed(2),
      y: +y.toFixed(2),
      s: +s.toFixed(2),
      sy: +(0.8 + rand() * 0.5).toFixed(2),
      v: Math.floor(rand() * ROCK_VARIANTS),
      rot: Math.round(rand() * 360),
      tilt: Math.round((rand() - 0.5) * 24),
      sink: +(0.15 + rand() * 0.25).toFixed(2),
    });
  }
  return out;
}

export const commands = {
  generate: {
    description:
      "Generate the base landscape and publish it to the scene. size = side length (m, default 80); resolution = grid points per side (9–129, default 97); amplitude = relief (m); scale = size of the main landforms (m); octaves/roughness = detail; seed = variation; water_level = height (m) of a water surface, or null; palette temperate|arid|alpine. Unspecified values keep their current setting.",
    input: {
      type: "object",
      properties: {
        size: { type: "number" },
        resolution: { type: "number" },
        amplitude: { type: "number" },
        scale: { type: "number" },
        octaves: { type: "number" },
        roughness: { type: "number" },
        seed: { type: "number" },
        water_level: { type: ["number", "null"] },
        palette: { type: "string", enum: Object.keys(PALETTES) },
      },
    },
    async run(args, ctx) {
      const params = { ...paramsOf(ctx.state), ...args };
      return publish(ctx.state, ctx, { params }, [
        { op: "set", key: "params", value: params },
      ]);
    },
  },
  add_features: {
    description:
      "Shape the land. hill/valley: at [x, y], radius (m), height (m). ridge: from at to to [x, y], radius, height.",
    input: {
      type: "object",
      properties: {
        features: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["hill", "valley", "ridge"] },
              at: xy,
              to: xy,
              radius: { type: "number" },
              height: { type: "number" },
            },
            required: ["type", "at"],
          },
        },
      },
      required: ["features"],
    },
    async run({ features }, ctx) {
      const all = [
        ...(ctx.state.features ?? []),
        ...features.map((f) => ({ radius: 10, height: 4, ...f })),
      ].slice(-200);
      return publish(ctx.state, ctx, { features: all }, [
        { op: "set", key: "features", value: all },
      ]);
    },
  },
  add_cliff: {
    description:
      "Raise a rock cliff along the line from at to to [x, y]: the ground on the LEFT of the direction of travel rises by height (m) behind a textured rock face, which leans out into an overhang (m, default a quarter of the height) near the top. depth = how far back the raised ground runs before easing down (m, default 22).",
    input: {
      type: "object",
      properties: {
        at: xy,
        to: xy,
        height: { type: "number" },
        overhang: { type: "number" },
        depth: { type: "number" },
      },
      required: ["at", "to", "height"],
    },
    async run({ at, to, height, overhang, depth }, ctx) {
      const all = [
        ...(ctx.state.features ?? []),
        {
          type: "cliff",
          at,
          to,
          height,
          ...(overhang != null && { overhang }),
          ...(depth != null && { depth }),
        },
      ];
      return publish(ctx.state, ctx, { features: all }, [
        { op: "set", key: "features", value: all },
      ]);
    },
  },
  place_rocks: {
    description:
      "Scatter boulders in a circle (center, radius): count rocks between size [min, max] metres across, bedded into the ground. min_slope/max_slope (degrees) restrict them to steep or flat ground, e.g. min_slope 25 for scree under cliffs.",
    input: {
      type: "object",
      properties: {
        center: xy,
        radius: { type: "number" },
        count: { type: "number" },
        size: xy,
        min_slope: { type: "number" },
        max_slope: { type: "number" },
        seed: { type: "number" },
      },
      required: ["center"],
    },
    async run(
      { center, radius, count, size, min_slope, max_slope, seed },
      ctx,
    ) {
      const params = paramsOf(ctx.state);
      const features = ctx.state.features ?? [];
      const existing = ctx.state.rocks ?? [];
      const added = makeRocks(params, features, existing, {
        center,
        radius,
        count,
        size,
        seed,
        minSlope: min_slope,
        maxSlope: max_slope,
      });
      const rocks = [...existing, ...added].slice(-MAX_ROCKS);
      return publish(
        ctx.state,
        ctx,
        { rocks },
        [{ op: "set", key: "rocks", value: rocks }],
        { added_rocks: added.length },
      );
    },
  },
  remove_rocks: {
    description:
      "Remove boulders inside a circle (center, radius), or all of them with all: true.",
    input: {
      type: "object",
      properties: {
        center: xy,
        radius: { type: "number" },
        all: { type: "boolean" },
      },
    },
    async run({ center, radius = 5, all }, ctx) {
      const before = ctx.state.rocks ?? [];
      const rocks = all
        ? []
        : before.filter(
            (r) =>
              !center || Math.hypot(r.x - center[0], r.y - center[1]) > radius,
          );
      return publish(
        ctx.state,
        ctx,
        { rocks },
        [{ op: "set", key: "rocks", value: rocks }],
        { removed_rocks: before.length - rocks.length },
      );
    },
  },
  flatten: {
    description:
      "Level a building pad: a w × d rectangle at [x, y] (rotation degrees) blended into the slope over margin metres. height defaults to the ground height at the centre. Returns the pad height.",
    input: {
      type: "object",
      properties: {
        at: xy,
        size: xy,
        rotation: { type: "number" },
        height: { type: "number" },
        margin: { type: "number" },
      },
      required: ["at", "size"],
    },
    async run({ at, size, rotation = 0, height, margin = 4 }, ctx) {
      const params = paramsOf(ctx.state);
      const features = ctx.state.features ?? [];
      const level =
        height ?? +heightAt(params, features, at[0], at[1]).toFixed(2);
      const all = [
        ...features,
        { type: "pad", at, size, rotation, height: level, margin },
      ];
      const out = await publish(ctx.state, ctx, { features: all }, [
        { op: "set", key: "features", value: all },
      ]);
      return { ...out, result: { ...out.result, pad_height_m: level } };
    },
  },
  set_style: {
    description: "Change the ground palette: temperate|arid|alpine.",
    input: {
      type: "object",
      properties: { palette: { type: "string", enum: Object.keys(PALETTES) } },
      required: ["palette"],
    },
    async run(args, ctx) {
      const params = { ...paramsOf(ctx.state), ...args };
      return publish(ctx.state, ctx, { params }, [
        { op: "set", key: "params", value: params },
      ]);
    },
  },
  clear_features: {
    description:
      "Remove every hill, valley, ridge, cliff and pad (boulders stay; remove_rocks clears them).",
    async run(_args, ctx) {
      return publish(ctx.state, ctx, { features: [] }, [
        { op: "delete", key: "features" },
      ]);
    },
  },
  describe: {
    description:
      "The current landscape: size, grid, lowest and highest ground, water level, features, cliffs and boulder count.",
    run(_args, ctx) {
      const params = paramsOf(ctx.state);
      const t = buildTerrain(params, ctx.state.features ?? []);
      return {
        result: {
          ...t.stats,
          water_level: params.water_level,
          palette: params.palette,
          features: ctx.state.features ?? [],
          rocks: (ctx.state.rocks ?? []).length,
          published: ctx.scene.some((o) => o.id === "terrain"),
        },
      };
    },
  },
  sample_heights: {
    description: "Ground height (m) at [x, y] points.",
    input: {
      type: "object",
      properties: { points: { type: "array", items: xy } },
      required: ["points"],
    },
    run({ points }, ctx) {
      const params = paramsOf(ctx.state);
      const features = ctx.state.features ?? [];
      return {
        result: points
          .slice(0, 500)
          .map(([x, y]) => [
            x,
            y,
            +heightAt(params, features, x, y).toFixed(3),
          ]),
      };
    },
  },
};
