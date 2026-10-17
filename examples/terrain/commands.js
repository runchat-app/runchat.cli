// Terrain designer: shape one landscape design — landform, water, cliffs with
// overhangs, boulders, building pads — and see it in the app. The shared 3D
// scene changes only on publish_to_scene, which writes the textured ground
// (named "terrain", with its height grid inside so other apps can sit things
// on it), cliffs and boulders. Metres, Z up, centred on the origin.
import { DEFAULTS, PALETTES, buildTerrain, heightAt } from "./src/terrain.js";
import { designHash, designOf, landscapeMeshes, landscapeTextures } from "./src/landscape.js";
import { rng } from "./src/geom.js";

const xy = { type: "array", items: { type: "number" }, description: "[x, y] metres" };
const ROCK_VARIANTS = 6;
const MAX_ROCKS = 600;

const paramsOf = (state) => ({ ...DEFAULTS, ...(state.params ?? {}) });

/** Result for an edit: the design changed in the app, not yet in the scene. */
function edited(state, change, ops, note = {}) {
  const design = { ...designOf(state), ...change };
  const t = buildTerrain(design.params, design.features);
  const unpublished = designHash(design.params, design.features) + ":" + design.rocks.length !== state.published;
  return {
    ops,
    result: { ...t.stats, cliffs: design.features.filter((f) => f.type === "cliff").length, rocks: design.rocks.length, ...note, ...(unpublished && { scene: "not updated — run publish_to_scene to put this landscape in the scene" }) },
  };
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
  publish_to_scene: {
    description:
      "Put the current landscape design into the shared 3D scene (ground, water, cliffs, boulders), replacing what this app published before. Other apps sit their plants and buildings on it; run their settle command after re-publishing a changed landform.",
    async run(_args, ctx) {
      const design = designOf(ctx.state);
      const { meshes, key, terrain } = landscapeMeshes(design, ctx.group);
      const textures = await landscapeTextures(design, key, terrain, ctx.assets);
      const scene = ctx.scene.some((o) => o.id === ctx.group) ? [] : [{ op: "add", kind: "group", id: ctx.group, name: "Landscape" }];
      const live = new Set(meshes.map((m) => m.id));
      for (const o of ctx.scene) {
        if (/^cliff-\d+$/.test(o.id) && !live.has(o.id)) scene.push({ op: "remove", id: o.id });
        const m = /^(rocks-\d+)-\d+$/.exec(o.id);
        if (m && !live.has(m[1])) scene.push({ op: "remove", id: o.id });
      }
      return {
        ops: [{ op: "set", key: "published", value: key + ":" + design.rocks.length }],
        scene,
        meshes,
        textures,
        result: { ...terrain.stats, published: true, cliffs: meshes.filter((m) => m.id.startsWith("cliff-")).length, rocks: design.rocks.length },
      };
    },
  },
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
      return edited(ctx.state, { params }, [
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
      return edited(ctx.state, { features: all }, [
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
      return edited(ctx.state, { features: all }, [
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
      return edited(ctx.state,
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
      return edited(ctx.state,
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
      const out = await edited(ctx.state, { features: all }, [
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
      return edited(ctx.state, { params }, [
        { op: "set", key: "params", value: params },
      ]);
    },
  },
  clear_features: {
    description:
      "Remove every hill, valley, ridge, cliff and pad (boulders stay; remove_rocks clears them).",
    async run(_args, ctx) {
      return edited(ctx.state, { features: [] }, [
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
