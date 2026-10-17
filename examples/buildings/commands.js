// Buildings' API: place building masses on the shared terrain. Each building
// is one mesh in the scene (walls, glazing, roof with real materials), set on
// the ground and cut into slopes. Metres, Z up.
import { loadGround } from "./src/ground.js";
import { materialTextures } from "./src/textures.js";
import {
  texturesFor,
  DEFAULT_BUILDING,
  ROOFS,
  ROOF_FORMS,
  WALLS,
  buildingParts,
  footprintCorners,
} from "./src/buildings.js";

const xy = {
  type: "array",
  items: { type: "number" },
  description: "[x, y] metres",
};
const fields = {
  width: { type: "number", description: "Along the ridge, metres." },
  depth: { type: "number", description: "Across, metres." },
  rotation: { type: "number", description: "Degrees about Z." },
  floors: { type: "number" },
  floor_height: { type: "number" },
  roof: { type: "string", enum: ROOF_FORMS },
  wall: { type: "string", enum: Object.keys(WALLS) },
  roof_material: { type: "string", enum: Object.keys(ROOFS) },
  wall_texture: {
    type: ["string", "null"],
    description: "https image URL tiled on the walls.",
  },
  balcony: { type: "boolean", description: "Glass-fronted balconies on upper floors (default true)." },
  window: { type: "string", enum: ["regular", "wide"], description: "regular punched windows or wide picture windows." },
  name: { type: "string" },
};

function normalise(input, base = DEFAULT_BUILDING) {
  const b = {
    ...base,
    ...(input.at && { x: +input.at[0], y: +input.at[1] }),
    ...(input.width && { w: input.width }),
    ...(input.depth && { d: input.depth }),
    ...(input.rotation !== undefined && { rot: input.rotation }),
    ...(input.floors && { floors: Math.round(input.floors) }),
    ...(input.floor_height && { fh: input.floor_height }),
    ...(input.roof && { roof: input.roof }),
    ...(input.wall && { wall: input.wall }),
    ...(input.roof_material && { roof_material: input.roof_material }),
    ...(input.wall_texture !== undefined && {
      wall_texture: input.wall_texture,
    }),
    ...(input.name && { name: input.name }),
    ...(input.balcony !== undefined && { balcony: !!input.balcony }),
    ...(input.window && { window: input.window }),
  };
  if (!WALLS[b.wall]) throw new Error(`Unknown wall ${b.wall}`);
  if (!ROOFS[b.roof_material])
    throw new Error(`Unknown roof material ${b.roof_material}`);
  if (!ROOF_FORMS.includes(b.roof)) throw new Error(`Unknown roof ${b.roof}`);
  if (!(b.w > 0 && b.d > 0 && b.floors >= 1 && b.floors <= 30))
    throw new Error("width, depth and floors (1–30) are required");
  return b;
}

async function meshesFor(list, ctx) {
  const ground = await loadGround(ctx.scene);
  ctx.textures = [...(ctx.textures ?? []), ...(await materialTextures(list.flatMap(texturesFor), { ...ctx.assets, ...Object.fromEntries((ctx.textures ?? []).map((t) => [t.id, true])) }))];
  return list.map((b) => {
    const heights = ground
      ? footprintCorners(b).map(([x, y]) => ground.sample(x, y))
      : [0];
    const base = Math.min(...heights);
    const depth = Math.max(...heights) - base + 0.4;
    return {
      id: `bldg-${b.id}`,
      name: b.name ?? `Building ${b.id}`,
      parent: ctx.group,
      position: [b.x, b.y, +base.toFixed(3)],
      rotation: [0, 0, b.rot],
      parts: buildingParts(b, depth),
    };
  });
}

function groupOp(ctx) {
  return ctx.scene.some((o) => o.id === ctx.group)
    ? []
    : [{ op: "add", kind: "group", id: ctx.group, name: "Buildings" }];
}

function summary(b) {
  return {
    id: b.id,
    name: b.name,
    at: [b.x, b.y],
    width: b.w,
    depth: b.d,
    rotation: b.rot,
    floors: b.floors,
    height_m: +(b.floors * b.fh).toFixed(2),
    roof: b.roof,
    wall: b.wall,
    roof_material: b.roof_material,
  };
}

export const commands = {
  list_materials: {
    description: "Wall materials, roof materials and roof forms.",
    run() {
      return {
        result: {
          walls: Object.keys(WALLS),
          roof_materials: Object.keys(ROOFS),
          roofs: ROOF_FORMS,
        },
      };
    },
  },
  add_buildings: {
    description:
      "Add buildings at [x, y]. Each sits on the terrain (its walls run down into sloping ground). Defaults: 10 × 7 m, 2 floors of 3.1 m, gable roof, timber walls, zinc roof. Returns their ids.",
    input: {
      type: "object",
      properties: {
        buildings: {
          type: "array",
          items: {
            type: "object",
            properties: { at: xy, ...fields },
            required: ["at"],
          },
        },
      },
      required: ["buildings"],
    },
    async run({ buildings }, ctx) {
      const existing = ctx.state.buildings ?? [];
      let next = existing.reduce((m, b) => Math.max(m, b.id), 0);
      const added = buildings.map((input) => ({
        ...normalise(input),
        id: ++next,
      }));
      const all = [...existing, ...added];
      return {
        ops: [{ op: "set", key: "buildings", value: all }],
        scene: groupOp(ctx),
        meshes: await meshesFor(added, ctx),
        textures: ctx.textures ?? [],
        result: { added: added.map(summary), total: all.length },
      };
    },
  },
  update_building: {
    description:
      "Change a building by id: any of at, width, depth, rotation, floors, floor_height, roof, wall, roof_material, wall_texture, name.",
    input: {
      type: "object",
      properties: { id: { type: "number" }, at: xy, ...fields },
      required: ["id"],
    },
    async run(input, ctx) {
      const list = ctx.state.buildings ?? [];
      const current = list.find((b) => b.id === input.id);
      if (!current)
        throw new Error(`No building ${input.id}. describe lists them.`);
      const updated = { ...normalise(input, current), id: current.id };
      const all = list.map((b) => (b.id === current.id ? updated : b));
      return {
        ops: [{ op: "set", key: "buildings", value: all }],
        scene: groupOp(ctx),
        meshes: await meshesFor([updated], ctx),
        textures: ctx.textures ?? [],
        result: summary(updated),
      };
    },
  },
  remove_buildings: {
    description: "Remove buildings by id.",
    input: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "number" } } },
      required: ["ids"],
    },
    run({ ids }, ctx) {
      const all = (ctx.state.buildings ?? []).filter(
        (b) => !ids.includes(b.id),
      );
      return {
        ops: [{ op: "set", key: "buildings", value: all }],
        scene: ids
          .filter((id) => ctx.scene.some((o) => o.id === `bldg-${id}`))
          .map((id) => ({ op: "remove", id: `bldg-${id}` })),
        result: { total: all.length },
      };
    },
  },
  clear: {
    description: "Remove every building.",
    run(_args, ctx) {
      return {
        ops: [{ op: "delete", key: "buildings" }],
        scene: ctx.scene
          .filter((o) => /^bldg-\d+$/.test(o.id))
          .map((o) => ({ op: "remove", id: o.id })),
        result: { total: 0 },
      };
    },
  },
  settle: {
    description:
      "Re-seat every building on the current terrain (after the landscape changed).",
    async run(_args, ctx) {
      const all = ctx.state.buildings ?? [];
      return {
        scene: groupOp(ctx),
        meshes: await meshesFor(all.slice(0, 40), ctx),
        textures: ctx.textures ?? [],
        result: { settled: Math.min(40, all.length) },
      };
    },
  },
  describe: {
    description:
      "Every building with its position, size, height and materials, plus total floor area.",
    run(_args, { state }) {
      const list = state.buildings ?? [];
      return {
        result: {
          buildings: list.map(summary),
          floor_area_m2: Math.round(
            list.reduce((s, b) => s + b.w * b.d * b.floors, 0),
          ),
        },
      };
    },
  },
};
