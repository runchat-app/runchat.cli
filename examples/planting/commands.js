// Planting's API: place and scatter plants on the shared terrain. Each species
// variant is one model in the scene placed many times (instances), standing
// on the ground wherever the Terrain app has put it. Metres, Z up.
import { loadGround } from "./src/ground.js";
import { rng } from "./src/geom.js";
import { SPECIES, VARIANTS, unitModel } from "./src/plants.js";

const xy = {
  type: "array",
  items: { type: "number" },
  description: "[x, y] metres",
};
const species = { type: "string", enum: Object.keys(SPECIES) };
const MAX_PLANTS = 1200;

function meshId(sp, v) {
  return `plants-${sp}-${v}`;
}

/** The scene output for a planting list: one instanced model per species variant. */
async function publish(plants, ctx, ops, result) {
  const ground = await loadGround(ctx.scene);
  const groups = new Map();
  for (const p of plants) {
    const key = `${p.species}:${p.v}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const meshes = [...groups].map(([key, list]) => {
    const [sp, v] = key.split(":");
    return {
      id: meshId(sp, v),
      name: SPECIES[sp].label,
      parent: ctx.group,
      parts: unitModel(sp, Number(v)),
      instances: list.map((p) => ({
        position: [
          p.x,
          p.y,
          ground ? +ground.sample(p.x, p.y).toFixed(3) - 0.05 : 0,
        ],
        rotation: [0, 0, p.r],
        scale: [p.h, p.h, p.h],
      })),
    };
  });
  const live = new Set(meshes.map((m) => m.id));
  const scene = ctx.scene.some((o) => o.id === ctx.group)
    ? []
    : [{ op: "add", kind: "group", id: ctx.group, name: "Planting" }];
  for (const o of ctx.scene) {
    const m = /^(plants-[a-z]+-\d+)-\d+$/.exec(o.id);
    if (m && !live.has(m[1])) scene.push({ op: "remove", id: o.id });
  }
  return {
    ops,
    scene,
    meshes,
    result: {
      ...result,
      total: plants.length,
      on_terrain: !!ground,
      ...(!ground && {
        note: "No terrain in the scene yet; plants stand at z = 0. Run settle after the terrain exists.",
      }),
    },
  };
}

function makePlant(sp, x, y, height, rand) {
  const [lo, hi] = SPECIES[sp].height;
  return {
    species: sp,
    x: +x.toFixed(2),
    y: +y.toFixed(2),
    h: +(height ?? lo + rand() * (hi - lo)).toFixed(2),
    v: Math.floor(rand() * VARIANTS),
    r: Math.round(rand() * 360),
  };
}

export const commands = {
  list_species: {
    description:
      "Species available, with their height ranges (m) and crown spread (fraction of height).",
    run() {
      return {
        result: Object.fromEntries(
          Object.entries(SPECIES).map(([k, s]) => [
            k,
            { label: s.label, height_m: s.height, spread: s.spread },
          ]),
        ),
      };
    },
  },
  plant: {
    description:
      "Plant individual plants at [x, y] points. height (m) defaults to a random height within the species' range.",
    input: {
      type: "object",
      properties: {
        plants: {
          type: "array",
          items: {
            type: "object",
            properties: { species, at: xy, height: { type: "number" } },
            required: ["species", "at"],
          },
        },
      },
      required: ["plants"],
    },
    async run({ plants }, ctx) {
      const rand = rng(Date.now());
      const added = plants.map((p) => {
        if (!SPECIES[p.species])
          throw new Error(`Unknown species ${p.species}`);
        return makePlant(p.species, p.at[0], p.at[1], p.height, rand);
      });
      const all = [...(ctx.state.plants ?? []), ...added].slice(-MAX_PLANTS);
      return publish(all, ctx, [{ op: "set", key: "plants", value: all }], {
        added: added.length,
      });
    },
  },
  scatter: {
    description:
      "Scatter count plants of a species inside a circle (center, radius) or a box (min, max), at least min_spacing metres apart, skipping slopes steeper than max_slope degrees and ground below the water level.",
    input: {
      type: "object",
      properties: {
        species,
        count: { type: "number" },
        center: xy,
        radius: { type: "number" },
        min: xy,
        max: xy,
        min_spacing: { type: "number" },
        max_slope: { type: "number" },
        seed: { type: "number" },
      },
      required: ["species", "count"],
    },
    async run(
      {
        species: sp,
        count,
        center,
        radius = 10,
        min,
        max,
        min_spacing,
        max_slope = 30,
        seed,
      },
      ctx,
    ) {
      if (!SPECIES[sp]) throw new Error(`Unknown species ${sp}`);
      const rand = rng(seed ?? Date.now());
      const ground = await loadGround(ctx.scene);
      const existing = ctx.state.plants ?? [];
      const spacing =
        min_spacing ??
        Math.max(0.6, SPECIES[sp].height[1] * SPECIES[sp].spread * 0.6);
      const added = [];
      const taken = [...existing, ...added];
      for (let tries = 0; added.length < count && tries < count * 40; tries++) {
        let x, y;
        if (min && max) {
          x = min[0] + rand() * (max[0] - min[0]);
          y = min[1] + rand() * (max[1] - min[1]);
        } else {
          const c = center ?? [0, 0];
          const a = rand() * Math.PI * 2;
          const d = Math.sqrt(rand()) * radius;
          x = c[0] + Math.cos(a) * d;
          y = c[1] + Math.sin(a) * d;
        }
        if (ground) {
          if (ground.slope(x, y) > max_slope) continue;
          if (ground.water != null && ground.sample(x, y) < ground.water + 0.3)
            continue;
        }
        if (taken.some((p) => Math.hypot(p.x - x, p.y - y) < spacing)) continue;
        const plant = makePlant(sp, x, y, undefined, rand);
        added.push(plant);
        taken.push(plant);
      }
      const all = [...existing, ...added].slice(-MAX_PLANTS);
      return publish(all, ctx, [{ op: "set", key: "plants", value: all }], {
        added: added.length,
        asked: count,
        spacing_m: +spacing.toFixed(2),
      });
    },
  },
  remove: {
    description:
      "Remove plants inside a circle (center, radius), optionally only one species.",
    input: {
      type: "object",
      properties: { center: xy, radius: { type: "number" }, species },
      required: ["center", "radius"],
    },
    async run({ center, radius, species: sp }, ctx) {
      const before = ctx.state.plants ?? [];
      const all = before.filter(
        (p) =>
          (sp && p.species !== sp) ||
          Math.hypot(p.x - center[0], p.y - center[1]) > radius,
      );
      return publish(all, ctx, [{ op: "set", key: "plants", value: all }], {
        removed: before.length - all.length,
      });
    },
  },
  clear: {
    description: "Remove every plant.",
    async run(_args, ctx) {
      return publish([], ctx, [{ op: "delete", key: "plants" }], {
        removed: (ctx.state.plants ?? []).length,
      });
    },
  },
  settle: {
    description:
      "Re-seat every plant on the current terrain (after the landscape changed).",
    async run(_args, ctx) {
      return publish(ctx.state.plants ?? [], ctx, [], {});
    },
  },
  describe: {
    description: "Counts per species, the planted area and the height range.",
    run(_args, { state }) {
      const plants = state.plants ?? [];
      const by = {};
      for (const p of plants) by[p.species] = (by[p.species] ?? 0) + 1;
      if (!plants.length) return { result: { total: 0 } };
      const xs = plants.map((p) => p.x);
      const ys = plants.map((p) => p.y);
      return {
        result: {
          total: plants.length,
          by_species: by,
          area: {
            min: [Math.min(...xs), Math.min(...ys)],
            max: [Math.max(...xs), Math.max(...ys)],
          },
        },
      };
    },
  },
};
