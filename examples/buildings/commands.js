// Building designer: model one building at a time (start from a template,
// tune its parameters, look at it), keep a library of designs, and place a
// design in the shared 3D scene on the terrain. Several placements of the same
// design share one model. Metres, Z up.
import { loadGround } from "./src/ground.js";
import {
  ROOFS,
  ROOF_FORMS,
  WALLS,
  buildingParts,
  texturesFor,
} from "./src/buildings.js";
import {
  TEMPLATES,
  WINDOW_STYLES,
  designKey,
  normalizeDesign,
  summarize,
  toInternal,
} from "./src/design.js";
import { materialTextures } from "./src/textures.js";

const xy = {
  type: "array",
  items: { type: "number" },
  description: "[x, y] metres",
};
const PLINTH_DEPTH = 3;

const current = (state) => normalizeDesign(state.design ?? TEMPLATES.cabin);

function corners(design, x, y, rot) {
  const a = (rot * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, 0],
  ].map(([sx, sy]) => {
    const px = (sx * design.width) / 2;
    const py = (sy * design.depth) / 2;
    return [
      x + px * Math.cos(a) - py * Math.sin(a),
      y + px * Math.sin(a) + py * Math.cos(a),
    ];
  });
}

/** Scene output for the placements of the given design keys. */
async function publish(ctx, placed, keys) {
  const ground = await loadGround(ctx.scene);
  const meshes = [];
  const textures = [];
  const have = { ...ctx.assets };
  const scene = ctx.scene.some((o) => o.id === ctx.group)
    ? []
    : [{ op: "add", kind: "group", id: ctx.group, name: "Buildings" }];
  for (const key of keys) {
    const entry = placed[key];
    const id = `bldg-${key}`;
    if (!entry || entry.items.length === 0) {
      for (const o of ctx.scene)
        if (o.id.startsWith(`${id}-`)) scene.push({ op: "remove", id: o.id });
      continue;
    }
    const internal = toInternal(entry.design);
    for (const t of await materialTextures(texturesFor(internal), have)) {
      textures.push(t);
      have[t.id] = true;
    }
    meshes.push({
      id,
      name: entry.design.name,
      parent: ctx.group,
      parts: buildingParts(internal, PLINTH_DEPTH),
      instances: entry.items.map((p) => {
        const heights = ground
          ? corners(entry.design, p.x, p.y, p.rot).map(([x, y]) =>
              ground.sample(x, y),
            )
          : [0];
        return {
          name: p.name,
          position: [p.x, p.y, +Math.min(...heights).toFixed(3)],
          rotation: [0, 0, p.rot],
        };
      }),
    });
  }
  return { scene, meshes, textures, on_terrain: !!ground };
}

const placements = (placed) =>
  Object.entries(placed).flatMap(([key, e]) =>
    e.items.map((p) => ({ ...p, design: e.design.name, key })),
  );

export const commands = {
  list_templates: {
    description: "Building templates to start a design from.",
    run() {
      return {
        result: Object.fromEntries(
          Object.entries(TEMPLATES).map(([k, t]) => [k, summarize(t)]),
        ),
      };
    },
  },
  new_design: {
    description:
      "Start a new building design from a template (list_templates). The app shows the design; nothing is added to the scene until add_to_scene.",
    input: {
      type: "object",
      properties: {
        template: { type: "string", enum: Object.keys(TEMPLATES) },
        name: { type: "string" },
      },
      required: ["template"],
    },
    run({ template, name }) {
      const design = normalizeDesign({
        ...TEMPLATES[template],
        ...(name && { name }),
      });
      return { set: { design }, result: summarize(design) };
    },
  },
  set_params: {
    description: `Change the current building design; pass any subset. width/depth (m, footprint), floors, floor_height (m), roof ${ROOF_FORMS.join("|")}, roof_pitch (degrees), overhang (m), wall ${Object.keys(WALLS).join("|")}, roof_material ${Object.keys(ROOFS).join("|")}, window ${WINDOW_STYLES.join("|")}, window_width (m), window_spacing (m, centre to centre), sill (m above floor), window_height (fraction of floor height), balcony (bool), chimney (true|false|"auto"), frame_color (hex), wall_texture (https image URL or null). Look at the result with view_image on this node.`,
    input: {
      type: "object",
      properties: { params: { type: "object" } },
      required: ["params"],
    },
    run({ params }, { state }) {
      const design = normalizeDesign({ ...current(state), ...params });
      return { set: { design }, result: summarize(design) };
    },
  },
  describe: {
    description:
      "The current design, saved designs, and every building placed in the scene with its id.",
    run(_args, { state }) {
      return {
        result: {
          design: summarize(current(state)),
          saved: Object.keys(state.library ?? {}),
          in_scene: placements(state.placed ?? {}),
        },
      };
    },
  },
  save_design: {
    description:
      "Save the current design to the library under its name (or a new name).",
    input: { type: "object", properties: { name: { type: "string" } } },
    run({ name }, { state }) {
      const design = { ...current(state), ...(name && { name }) };
      return {
        set: {
          design,
          library: { ...(state.library ?? {}), [design.name]: design },
        },
        result: { saved: design.name },
      };
    },
  },
  load_design: {
    description: "Make a saved design current.",
    input: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    run({ name }, { state }) {
      const design = state.library?.[name];
      if (!design)
        throw new Error(
          `No saved design ${name}. Saved: ${Object.keys(state.library ?? {}).join(", ") || "none"}`,
        );
      return { set: { design }, result: summarize(design) };
    },
  },
  add_to_scene: {
    description:
      "Place the current design (or a saved one by name) in the shared 3D scene at [x, y] with rotation (degrees). It sits on the terrain, its plinth cut into slopes; flatten a pad with the terrain designer first on steep ground. Returns the placement id.",
    input: {
      type: "object",
      properties: {
        at: xy,
        rotation: { type: "number" },
        design: { type: "string" },
        name: { type: "string", description: "Label for this placement." },
      },
      required: ["at"],
    },
    async run({ at, rotation = 0, design: saved, name }, ctx) {
      const design = saved
        ? normalizeDesign(
            ctx.state.library?.[saved] ??
              (() => {
                throw new Error(`No saved design ${saved}`);
              })(),
          )
        : current(ctx.state);
      const key = designKey(design);
      const placed = { ...(ctx.state.placed ?? {}) };
      const id = ctx.state.next_id ?? 1;
      placed[key] = {
        design,
        items: [
          ...(placed[key]?.items ?? []),
          {
            id,
            x: +at[0],
            y: +at[1],
            rot: +rotation,
            name: name ?? `${design.name} ${id}`,
          },
        ],
      };
      const out = await publish(ctx, placed, [key]);
      return {
        ops: [
          { op: "set", key: "placed", value: placed },
          { op: "set", key: "next_id", value: id + 1 },
        ],
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: {
          id,
          design: design.name,
          on_terrain: out.on_terrain,
          total: placements(placed).length,
        },
      };
    },
  },
  move_in_scene: {
    description: "Move or turn a placed building by id (describe lists ids).",
    input: {
      type: "object",
      properties: {
        id: { type: "number" },
        at: xy,
        rotation: { type: "number" },
      },
      required: ["id"],
    },
    async run({ id, at, rotation }, ctx) {
      const placed = { ...(ctx.state.placed ?? {}) };
      const key = Object.keys(placed).find((k) =>
        placed[k].items.some((p) => p.id === id),
      );
      if (!key) throw new Error(`No placed building ${id}`);
      placed[key] = {
        ...placed[key],
        items: placed[key].items.map((p) =>
          p.id === id
            ? {
                ...p,
                ...(at && { x: at[0], y: at[1] }),
                ...(rotation != null && { rot: rotation }),
              }
            : p,
        ),
      };
      const out = await publish(ctx, placed, [key]);
      return {
        ops: [{ op: "set", key: "placed", value: placed }],
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: { moved: id },
      };
    },
  },
  remove_from_scene: {
    description:
      "Remove placed buildings by id, or all of them with all: true.",
    input: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "number" } },
        all: { type: "boolean" },
      },
    },
    async run({ ids = [], all }, ctx) {
      const placed = { ...(ctx.state.placed ?? {}) };
      for (const key of Object.keys(placed))
        placed[key] = {
          ...placed[key],
          items: all
            ? []
            : placed[key].items.filter((p) => !ids.includes(p.id)),
        };
      const out = await publish(ctx, placed, Object.keys(placed));
      for (const key of Object.keys(placed))
        if (placed[key].items.length === 0) delete placed[key];
      return {
        ops: [{ op: "set", key: "placed", value: placed }],
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: { total: placements(placed).length },
      };
    },
  },
  settle: {
    description:
      "Re-seat every placed building on the current terrain (after the landscape changed).",
    async run(_args, ctx) {
      const placed = ctx.state.placed ?? {};
      const out = await publish(ctx, placed, Object.keys(placed));
      return {
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: { total: placements(placed).length },
      };
    },
  },
  clear_scene: {
    description:
      "Remove everything this app has put in the scene (its group), including leftovers from older versions.",
    run(_args, ctx) {
      return {
        ops: [{ op: "delete", key: "placed" }],
        scene: ctx.scene.some((o) => o.id === ctx.group)
          ? [{ op: "remove", id: ctx.group }]
          : [],
        result: { cleared: true },
      };
    },
  },
};
