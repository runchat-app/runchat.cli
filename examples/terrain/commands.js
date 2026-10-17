// Terrain's API: shape a landscape and publish it to the shared 3D scene as
// the "terrain" mesh, with its height grid in the model so other apps can sit
// things on it. Metres, Z up, centred on the origin.
import { DEFAULTS, PALETTES, buildTerrain, heightAt } from "./src/terrain.js";

const xy = {
  type: "array",
  items: { type: "number" },
  description: "[x, y] metres",
};

function paramsOf(state) {
  return { ...DEFAULTS, ...(state.params ?? {}) };
}

/** State ops plus the scene output for a terrain document. */
function publish(params, features, ctx, extraOps = []) {
  const t = buildTerrain(params, features);
  const parts = [
    {
      vertices: t.vertices,
      grid: [t.cols, t.rows],
      colors: t.colors,
      material: {
        roughness: 0.95,
        ...(params.texture && { map: params.texture, color: "#ffffff" }),
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
    },
  ];
  if (params.water_level != null) {
    const [x0, y0] = t.min;
    const [x1, y1] = t.max;
    const z = params.water_level;
    parts.push({
      vertices: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
      faces: [0, 1, 2, 0, 2, 3],
      material: {
        color: "#3f7fa6",
        opacity: 0.62,
        roughness: 0.12,
        metalness: 0.1,
      },
    });
  }
  const hasGroup = ctx.scene.some((o) => o.id === ctx.group);
  return {
    ops: extraOps,
    scene: hasGroup
      ? []
      : [{ op: "add", kind: "group", id: ctx.group, name: "Landscape" }],
    meshes: [{ id: "terrain", name: "Terrain", parent: ctx.group, parts }],
    result: t.stats,
  };
}

export const commands = {
  generate: {
    description:
      "Generate the base landscape and publish it to the scene. size = side length (m, default 80); resolution = grid points per side (9–97); amplitude = relief (m); scale = size of the main landforms (m); octaves/roughness = detail; seed = variation; water_level = height (m) of a water plane, or null; palette temperate|arid|alpine. Unspecified values keep their current setting.",
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
    run(args, ctx) {
      const params = { ...paramsOf(ctx.state), ...args };
      return publish(params, ctx.state.features ?? [], ctx, [
        { op: "set", key: "params", value: params },
      ]);
    },
  },
  add_features: {
    description:
      "Shape the land. hill/valley: at [x, y], radius (m), height (m). ridge: from at to to [x, y], radius, height. Features add to the base noise.",
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
    run({ features }, ctx) {
      const clean = features.map((f) => ({ radius: 10, height: 4, ...f }));
      const all = [...(ctx.state.features ?? []), ...clean].slice(-200);
      return publish(paramsOf(ctx.state), all, ctx, [
        { op: "set", key: "features", value: all },
      ]);
    },
  },
  flatten: {
    description:
      "Level a building pad: a w × d rectangle at [x, y] (rotation degrees) blended into the slope over margin metres. height defaults to the current ground height at the centre. Returns the pad height.",
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
    run({ at, size, rotation = 0, height, margin = 4 }, ctx) {
      const params = paramsOf(ctx.state);
      const features = ctx.state.features ?? [];
      const level =
        height ?? +heightAt(params, features, at[0], at[1]).toFixed(2);
      const all = [
        ...features,
        { type: "pad", at, size, rotation, height: level, margin },
      ];
      const out = publish(params, all, ctx, [
        { op: "set", key: "features", value: all },
      ]);
      return { ...out, result: { ...out.result, pad_height_m: level } };
    },
  },
  set_style: {
    description:
      "Change the look: palette temperate|arid|alpine, and/or texture: an https image URL draped over the terrain (null to remove).",
    input: {
      type: "object",
      properties: {
        palette: { type: "string" },
        texture: { type: ["string", "null"] },
      },
    },
    run(args, ctx) {
      const params = { ...paramsOf(ctx.state), ...args };
      return publish(params, ctx.state.features ?? [], ctx, [
        { op: "set", key: "params", value: params },
      ]);
    },
  },
  clear_features: {
    description:
      "Remove every hill, valley, ridge and pad, back to the base landscape.",
    run(_args, ctx) {
      return publish(paramsOf(ctx.state), [], ctx, [
        { op: "delete", key: "features" },
      ]);
    },
  },
  describe: {
    description:
      "The current landscape: size, grid, lowest and highest ground, water level, features.",
    run(_args, ctx) {
      const params = paramsOf(ctx.state);
      const t = buildTerrain(params, ctx.state.features ?? []);
      return {
        result: {
          ...t.stats,
          water_level: params.water_level,
          palette: params.palette,
          features: ctx.state.features ?? [],
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
