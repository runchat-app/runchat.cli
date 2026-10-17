// Plant designer: work on one parametric plant design at a time (start from a
// template, tune it, look at it), keep a library of designs, and add a design
// to the shared 3D scene — scattered or at points, standing on the terrain.
// The scene gets one model per design variant, placed many times.
import { loadGround } from "./src/ground.js";
import { rng } from "./src/geom.js";
import {
  BARKS,
  CROWNS,
  FORMS,
  LEAVES,
  TEMPLATES,
  VARIANTS,
  designKey,
  designTextures,
  growPlant,
  mergeDesign,
  normalizeDesign,
  summarize,
} from "./src/plants.js";
import { foliageTexture, materialTextures } from "./src/textures.js";

const xy = {
  type: "array",
  items: { type: "number" },
  description: "[x, y] metres",
};
const MAX_PLANTS = 1500;

const current = (state) => normalizeDesign(state.design ?? TEMPLATES.oak);

/** Scene output for the placements of the given design keys. */
async function publish(state, ctx, placed, keys) {
  const ground = await loadGround(ctx.scene);
  const meshes = [];
  const textures = [];
  const have = { ...ctx.assets };
  const scene = ctx.scene.some((o) => o.id === ctx.group)
    ? []
    : [{ op: "add", kind: "group", id: ctx.group, name: "Planting" }];
  for (const key of keys) {
    const entry = placed[key];
    if (!entry || entry.items.length === 0) {
      for (const o of ctx.scene)
        if (o.id.startsWith(`plant-${key}-`))
          scene.push({ op: "remove", id: o.id });
      continue;
    }
    const need = designTextures(entry.design);
    for (const t of await materialTextures(need.barks, have)) {
      textures.push(t);
      have[t.id] = true;
    }
    for (const kind of need.foliage) {
      for (const t of await foliageTexture(kind, have)) {
        textures.push(t);
        have[t.id] = true;
      }
    }
    for (let v = 0; v < VARIANTS; v++) {
      const items = entry.items.filter((p) => p.v === v);
      const id = `plant-${key}-${v}`;
      if (items.length === 0) {
        for (const o of ctx.scene)
          if (o.id.startsWith(`${id}-`)) scene.push({ op: "remove", id: o.id });
        continue;
      }
      meshes.push({
        id,
        name: entry.design.name,
        parent: ctx.group,
        parts: growPlant(entry.design, v),
        instances: items.map((p) => ({
          position: [
            p.x,
            p.y,
            ground ? +(ground.sample(p.x, p.y) - 0.05).toFixed(3) : 0,
          ],
          rotation: [0, 0, p.r],
          scale: [p.h, p.h, p.h],
        })),
      });
    }
  }
  return { scene, meshes, textures, on_terrain: !!ground };
}

function total(placed) {
  return Object.values(placed).reduce((n, e) => n + e.items.length, 0);
}

export const commands = {
  list_templates: {
    description:
      "Plant templates to start a design from, with their form and height range.",
    run() {
      return {
        result: Object.fromEntries(
          Object.entries(TEMPLATES).map(([k, t]) => [
            k,
            { name: t.name, form: t.form, crown: t.crown, height_m: t.height },
          ]),
        ),
      };
    },
  },
  new_design: {
    description:
      "Start a new plant design from a template (list_templates). The app shows the design; nothing is added to the scene until add_to_scene.",
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
    description: `Change the current design. Pass any subset; nested objects merge. form: ${FORMS.join("|")}; crown: ${CROWNS.join("|")}; height: [min, max] metres; trunk: { height (fraction of the plant before it branches), radius (fraction of height), lean, gnarl }; branching: { levels 1–4, counts [per level], angles [degrees from parent], lengths [fraction of parent], droop [per level, + bends down], start [where on the parent children begin, 0–1], wander }; conifer: { whorls, arms, reach, start }; foliage: { kind ${LEAVES.join("|")}, size (fraction of height), density (cards per twig), tint (hex multiplied in), variation }; bark: { kind ${BARKS.join("|")}, tint }; seed. Look at the result with view_image on this node.`,
    input: {
      type: "object",
      properties: { params: { type: "object" } },
      required: ["params"],
    },
    run({ params }, { state }) {
      const design = normalizeDesign(mergeDesign(current(state), params));
      return { set: { design }, result: summarize(design) };
    },
  },
  describe: {
    description:
      "The current design, saved designs and what is in the scene per design.",
    run(_args, { state }) {
      const placed = state.placed ?? {};
      return {
        result: {
          design: summarize(current(state)),
          saved: Object.keys(state.library ?? {}),
          in_scene: Object.fromEntries(
            Object.entries(placed).map(([k, e]) => [
              k,
              { name: e.design.name, count: e.items.length },
            ]),
          ),
          templates: Object.keys(TEMPLATES),
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
      "Add the current design (or a saved one by name) to the shared 3D scene, standing on the terrain: at points [[x, y], …], and/or scattered in a circle (scatter: center, radius, count, min_spacing m, max_slope degrees; skips water). Each plant gets a height within the design's range, a turn and one of its variants.",
    input: {
      type: "object",
      properties: {
        design: {
          type: "string",
          description: "Saved design name; default the current design.",
        },
        points: { type: "array", items: xy },
        scatter: {
          type: "object",
          properties: {
            center: xy,
            radius: { type: "number" },
            count: { type: "number" },
            min_spacing: { type: "number" },
            max_slope: { type: "number" },
            seed: { type: "number" },
          },
        },
      },
    },
    async run({ design: name, points = [], scatter }, ctx) {
      const design = name
        ? normalizeDesign(
            ctx.state.library?.[name] ??
              (() => {
                throw new Error(`No saved design ${name}`);
              })(),
          )
        : current(ctx.state);
      const key = designKey(design);
      const placed = { ...(ctx.state.placed ?? {}) };
      const entry = { design, items: [...(placed[key]?.items ?? [])] };
      const rand = rng(scatter?.seed ?? Date.now());
      const make = (x, y) => ({
        x: +x.toFixed(2),
        y: +y.toFixed(2),
        h: +(
          design.height[0] +
          rand() * (design.height[1] - design.height[0])
        ).toFixed(2),
        v: Math.floor(rand() * VARIANTS),
        r: Math.round(rand() * 360),
      });
      const added = points.map(([x, y]) => make(x, y));
      if (scatter) {
        const ground = await loadGround(ctx.scene);
        const all = Object.values(placed).flatMap((e) => e.items);
        const spacing =
          scatter.min_spacing ?? Math.max(0.5, design.height[1] * 0.35);
        const count = Math.min(scatter.count ?? 10, MAX_PLANTS);
        const [cx, cy] = scatter.center ?? [0, 0];
        const radius = scatter.radius ?? 10;
        for (
          let tries = 0;
          added.length - points.length < count && tries < count * 40;
          tries++
        ) {
          const a = rand() * Math.PI * 2;
          const d = Math.sqrt(rand()) * radius;
          const x = cx + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d;
          if (ground) {
            if (ground.slope(x, y) > (scatter.max_slope ?? 30)) continue;
            if (
              ground.water != null &&
              ground.sample(x, y) < ground.water + 0.3
            )
              continue;
          }
          if (
            [...all, ...added].some(
              (p) => Math.hypot(p.x - x, p.y - y) < spacing,
            )
          )
            continue;
          added.push(make(x, y));
        }
      }
      entry.items.push(...added);
      placed[key] = entry;
      if (total(placed) > MAX_PLANTS)
        throw new Error(
          `The scene holds at most ${MAX_PLANTS} plants from this app.`,
        );
      const out = await publish(ctx.state, ctx, placed, [key]);
      return {
        ops: [{ op: "set", key: "placed", value: placed }],
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: {
          design: design.name,
          added: added.length,
          of_this_design: entry.items.length,
          total: total(placed),
          on_terrain: out.on_terrain,
        },
      };
    },
  },
  remove_from_scene: {
    description:
      "Remove plants from the scene: inside a circle (center, radius), only one saved design (design), or everything (all: true).",
    input: {
      type: "object",
      properties: {
        center: xy,
        radius: { type: "number" },
        design: { type: "string" },
        all: { type: "boolean" },
      },
    },
    async run({ center, radius = 5, design, all }, ctx) {
      const placed = { ...(ctx.state.placed ?? {}) };
      let removed = 0;
      for (const [key, e] of Object.entries(placed)) {
        if (design && e.design.name !== design) continue;
        const keep = all
          ? []
          : e.items.filter(
              (p) =>
                !center ||
                Math.hypot(p.x - center[0], p.y - center[1]) > radius,
            );
        removed += e.items.length - keep.length;
        placed[key] = { ...e, items: keep };
      }
      const out = await publish(ctx.state, ctx, placed, Object.keys(placed));
      for (const key of Object.keys(placed))
        if (placed[key].items.length === 0) delete placed[key];
      return {
        ops: [{ op: "set", key: "placed", value: placed }],
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: { removed, total: total(placed) },
      };
    },
  },
  settle: {
    description:
      "Re-seat every plant on the current terrain (after the landscape changed).",
    async run(_args, ctx) {
      const placed = ctx.state.placed ?? {};
      const out = await publish(ctx.state, ctx, placed, Object.keys(placed));
      return {
        scene: out.scene,
        meshes: out.meshes,
        textures: out.textures,
        result: { total: total(placed) },
      };
    },
  },
  clear_scene: {
    description:
      "Remove everything this app has put in the scene (its group), including leftovers from older versions.",
    run(_args, ctx) {
      const ids = new Set([ctx.group]);
      for (const o of ctx.scene) if (o.parent === ctx.group) ids.add(o.id);
      return {
        ops: [{ op: "delete", key: "placed" }],
        scene: [{ op: "remove", id: ctx.group }],
        result: { removed: ids.size },
      };
    },
  },
};
