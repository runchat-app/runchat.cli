// Basketry's API, shared by its UI and by agents. Units are metres, Z up, the
// ground is z = 0. Every edit relaxes the whole structure (bending, self
// weight, lashings) before it returns, so results include stresses. Lashings
// carrying more than 3x joint_capacity_n slip off and are removed
// (reported as slipped_ties).
import {
  addArch,
  addHoop,
  addJoint,
  addLoop,
  addPolyline,
  addPreset,
  autoJoin,
  beginStage,
  cutList,
  setProfile,
  loadDesignOps,
  snapshotDesign,
  modelOps,
  readModel,
  relaxModel,
  removeRods,
  report,
  scatterHoops,
  simulate,
  weave,
} from "./src/model.js";
import { DEFAULT_MATERIAL, PROFILE_FIELDS, profiles, rodPoints } from "./src/sim.js";

const vec = { type: "array", items: { type: "number" } };
const place = {
  description:
    "Where an end goes: [x, y, z] (z = 0 is a ground socket; a point within 0.35 m of a rod lashes to it; otherwise free), or {rod, t} with t 0..1 along an existing rod.",
};
const rodRef = { type: "string", description: "Rod id, e.g. r3." };
const length = {
  type: "number",
  description: "Rod length in metres (default 8).",
};
const socket = {
  type: "string",
  enum: ["tangent", "vertical", "pin"],
  description:
    "Ground ends: clamped along the rod's natural tangent (default), clamped vertical, or pinned.",
};
const lash = {
  type: "number",
  description:
    "Ends on rods: lashed at 1 node (a pin, default) or 2 nodes (the end overlaps the host for one segment, resisting rotation).",
};
const profile = {
  type: "string",
  description:
    "Section profile: primary (32 mm steam-bent ash, for stiff frames), rod (20 mm, default) or weave (10 mm rattan, for basket weaving); set_material can add more.",
};
const bundle = {
  type: "number",
  description: "Lash this many rods together along their length into one stiffer member (default 1, max 12).",
};

/** Runs an edit, relaxes, and returns the ops plus a short report. */
function edit(state, ctx, fn, relaxOpts) {
  const model = readModel(state);
  const stage = beginStage(model);
  const made = fn(model, stage) ?? [];
  const ids = (Array.isArray(made) ? made : [made]).map((x) => x.id);
  let summary;
  if (ctx?.local) summary = { stage };
  else {
    const { sim, run } = relaxModel(model, relaxOpts);
    summary = { ...report(model, sim), iterations: run.iterations };
    if (run.slipped.length) summary.slipped_ties = run.slipped;
  }
  const long = ids.filter((id) => model.rods.get(id)?.L > model.material.max_rod_m);
  if (long.length) summary.over_max_length = long;
  return { ops: modelOps(model, state), result: { added: ids, ...summary } };
}

export const commands = {
  add_arch: {
    description:
      "Bend a rod into an arch between two places (ground sockets or points on rods). The rod is longer than the span, so it buckles up towards `up` and the solver finds its bent shape.",
    input: {
      type: "object",
      properties: {
        a: place,
        b: place,
        length,
        up: { ...vec, description: "Bulge direction (default [0,0,1])." },
        socket,
        lash,
        profile,
        bundle,
      },
      required: ["a", "b"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => addArch(m, args, s));
    },
  },
  add_loop: {
    description:
      "Stand a teardrop loop on a point: both rod ends meet at the base (feet ~0.3 m apart). On a rod the loop sits in the rod's plane, pinned at both feet and tied to any rod it touches; with nothing else bracing it, it hinges over under its own weight (rods have little torsional stiffness), so lash it to neighbours. On the ground the feet are clamped sockets and it faces `azimuth`.",
    input: {
      type: "object",
      properties: {
        at: place,
        length: { type: "number", description: "Rod length (default 6)." },
        azimuth: {
          type: "number",
          description:
            "Degrees, ground loops: direction the loop's width runs.",
        },
        tilt: {
          type: "number",
          description: "Degrees to lean the loop over (default 0).",
        },
        side: {
          ...vec,
          description: "Explicit width direction, overrides azimuth.",
        },
        feet: {
          type: "number",
          description: "Distance between the feet (default 0.3).",
        },
        socket,
        lash,
        profile,
        bundle,
      },
      required: ["at"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => addLoop(m, args, s));
    },
  },
  add_hoop: {
    description:
      "Add a closed hoop (a rod bent into a ring and lashed to itself), then tie it to every rod within attach_radius. Untied hoops fall under gravity.",
    input: {
      type: "object",
      properties: {
        centre: vec,
        length: { type: "number", description: "Circumference (default 8)." },
        normal: {
          ...vec,
          description: "Ring axis (default [0,1,0], a standing ring).",
        },
        attach_radius: {
          type: "number",
          description: "Default 0.7 m; 0 for none.",
        },
        profile,
        bundle,
      },
      required: ["centre"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => {
        const hoop = addHoop(m, args, s);
        if ((args.attach_radius ?? 0.7) > 0)
          autoJoin(m, [hoop.id], { radius: args.attach_radius ?? 0.7 }, s);
        return hoop;
      });
    },
  },
  add_rod: {
    description:
      "Add a rod along a polyline guess (resampled), e.g. to weave freely. Its ends attach like arch ends. The solver then bends it into equilibrium.",
    input: {
      type: "object",
      properties: {
        points: { type: "array", items: vec },
        length: {
          type: "number",
          description: "Defaults to the polyline length.",
        },
        closed: { type: "boolean" },
        socket,
        lash,
        profile,
        bundle,
      },
      required: ["points"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => addPolyline(m, args, s));
    },
  },
  add_rods: {
    description:
      "Add many rods in one edit, e.g. a dense weave you generated as curves on a surface (helices round a tube, arcs over a cocoon, a tangle inside a volume). Each rod follows its polyline guess; ends at z = 0 become ground sockets and ends near earlier rods lash to them. Then every new rod is tied wherever it passes within join_radius of another rod, and the structure relaxes. Volumes off the ground need legs: include rods from ground points up into the weave, listed last.",
    input: {
      type: "object",
      properties: {
        rods: {
          type: "array",
          items: {
            type: "object",
            properties: {
              points: { type: "array", items: vec },
              length: { type: "number" },
              closed: { type: "boolean" },
              profile,
              bundle,
              kind: { type: "string", description: "Label, e.g. shell, leg, hoop." },
            },
            required: ["points"],
          },
        },
        join_radius: { type: "number", description: "Tie crossings closer than this (default 0.3 m; 0 for none)." },
        per_rod: { type: "number", description: "Max new ties per rod (default 12)." },
        spacing: { type: "number", description: "Min metres between ties on a rod (default 0.6)." },
        per_pair: { type: "number", description: "Max ties between any two rods (default 3)." },
        min_ties: {
          type: "number",
          description: "Drop new rods held by fewer ties + ground sockets than this (default 2): rods the weave didn't catch.",
        },
        budget_ms: { type: "number", description: "Relaxation time budget (default 2000, max 4000; call relax to continue)." },
        socket,
        profile,
        bundle,
      },
      required: ["rods"],
    },
    run(args, ctx) {
      const { rods, join_radius = 0.3, per_rod = 12, spacing = 0.6, per_pair = 3, min_ties = 2 } = args;
      if (!Array.isArray(rods) || !rods.length) throw new Error("rods needs at least one {points}");
      if (rods.length > 200) throw new Error("at most 200 rods per call");
      return edit(
        ctx.state,
        ctx,
        (m, s) => {
          const made = rods.map((r) =>
            addPolyline(m, { socket: args.socket, profile: args.profile, bundle: args.bundle, ...r }, s),
          );
          if (join_radius > 0)
            autoJoin(m, made.map((r) => r.id), { radius: join_radius, per_rod, spacing, per_pair }, s);
          const held = (r) =>
            (r.fix?.length ?? 0) + m.joints.filter((j) => j.a === r.id || j.b === r.id).length;
          const loose = made.filter((r) => held(r) < min_ties).map((r) => r.id);
          removeRods(m, loose);
          return made.filter((r) => !loose.includes(r.id));
        },
        { budgetMs: Math.min(args.budget_ms ?? 2000, 4000) },
      );
    },
  },
  add_preset: {
    description:
      "Start a stiff frame on the ground: cross (two crossing arches), dome (count arches radiating), tunnel (count parallel arches tied together) or tripod (three arches in a triangle).",
    input: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["cross", "dome", "tunnel", "tripod"] },
        centre: vec,
        span: { type: "number", description: "Default 5 m." },
        length,
        count: { type: "number" },
        spacing: {
          type: "number",
          description: "Tunnel arch spacing (default 1.2 m).",
        },
        socket,
        profile,
        bundle,
      },
      required: ["type"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => addPreset(m, args, s));
    },
  },
  add_joint: {
    description:
      "Lash two rods together. The lashing is a spring that pulls the rods together; a gap opens in proportion to the force it carries (force / stiffness), so heavily loaded ties show as gaps.",
    input: {
      type: "object",
      properties: {
        a: {
          description: "{rod, t} or a point (snaps to the nearest rod node).",
        },
        b: { description: "{rod, t} or a point." },
        stiffness: { type: "number", description: "N/m, default 20000." },
      },
      required: ["a", "b"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => {
        addJoint(m, args, s);
        return [];
      });
    },
  },
  auto_join: {
    description:
      "Tie rods to any rod passing within radius, closest first (spaced along each rod). Use after adding rods freely so they self-organise into the structure.",
    input: {
      type: "object",
      properties: {
        rods: {
          type: "array",
          items: rodRef,
          description: "Default: rods from the latest stage.",
        },
        radius: { type: "number", description: "Default 0.5 m." },
        per_rod: {
          type: "number",
          description: "Max new joints per rod (default 6).",
        },
        spacing: {
          type: "number",
          description: "Min metres between joints on a rod (default 0.9).",
        },
      },
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => {
        const ids =
          args.rods ??
          [...m.rods.values()]
            .filter((r) => r.stage === s - 1)
            .map((r) => r.id);
        autoJoin(
          m,
          ids,
          {
            radius: args.radius ?? 0.5,
            per_rod: args.per_rod,
            spacing: args.spacing,
          },
          s,
        );
        return [];
      });
    },
  },
  weave: {
    description:
      "Fill between two rods with `count` bridging rods lashed to both, bulging away from the structure: a basket surface. pattern 'diagonal' crosses them and ties the crossings.",
    input: {
      type: "object",
      properties: {
        a: rodRef,
        b: rodRef,
        count: { type: "number", description: "Default 6." },
        a_range: {
          ...vec,
          description: "[t0, t1] along a (default [0.15, 0.85]).",
        },
        b_range: { ...vec, description: "[t0, t1] along b." },
        slack: {
          type: "number",
          description: "Rod length / gap (default 1.25).",
        },
        profile,
        bundle,
        pattern: { type: "string", enum: ["parallel", "diagonal"] },
        up: vec,
      },
      required: ["a", "b"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => weave(m, args, s));
    },
  },
  scatter_hoops: {
    description:
      "Drop many hoops at random through a region (default: inside the structure's bounds) and tie each to rods it touches; hoops catching fewer than min_joints are discarded. The kept hoops pull the rods into nest-like volumes.",
    input: {
      type: "object",
      properties: {
        count: { type: "number", description: "Default 8, max 60." },
        length: {
          type: "number",
          description: "Mean circumference (default 6).",
        },
        region: { type: "object", properties: { min: vec, max: vec } },
        attach_radius: { type: "number", description: "Default 0.7." },
        min_joints: { type: "number", description: "Default 2." },
        profile,
        bundle,
        seed: { type: "number" },
      },
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m, s) => scatterHoops(m, args, s));
    },
  },
  remove: {
    description: "Remove rods (with their lashings) and/or joints by id.",
    input: {
      type: "object",
      properties: {
        rods: { type: "array", items: rodRef },
        joints: { type: "array", items: { type: "string" } },
      },
    },
    run({ rods = [], joints = [] }, ctx) {
      return edit(ctx.state, ctx, (m) => {
        removeRods(m, rods);
        const gone = new Set(joints);
        m.joints = m.joints.filter((j) => !gone.has(j.id));
        return [];
      });
    },
  },
  undo: {
    description: "Remove everything added in the latest stage and relax.",
    run(_args, ctx) {
      const model = readModel(ctx.state);
      const stage = model.meta.stage;
      removeRods(
        model,
        [...model.rods.values()]
          .filter((r) => r.stage === stage)
          .map((r) => r.id),
      );
      model.joints = model.joints.filter((j) => j.stage !== stage);
      model.meta.stage = Math.max(0, stage - 1);
      const summary = ctx?.local ? {} : report(model, relaxModel(model).sim);
      return {
        ops: modelOps(model, ctx.state),
        result: { undone: stage, ...summary },
      };
    },
  },
  set_material: {
    description:
      "Change the timber and solver settings, then relax. Profiles: rods use the base 'rod' profile (the top-level fields) unless they name another; primary (32 mm, E 11, 80 MPa, 680 kg/m3) and weave (10 mm, E 6, 55 MPa, 550 kg/m3) are built in; pass profile to edit or define one. bundle_action 0.5: how composite a bundle of lashed rods acts (0 = rods slide, n×I; 1 = glued, n²×I). Base defaults: E_gpa 10, density 650 kg/m3, section_mm 20 (square), strength_mpa 60, joint_stiffness 20000 N/m, joint_capacity_n 600, gravity 1 (multiplier), max_rod_m 9 (longest stock; longer rods are flagged), lap_m 0.3 (hoop overlap in the cut list). segment_m only affects new rods.",
    input: {
      type: "object",
      properties: {
        ...Object.fromEntries(Object.keys(DEFAULT_MATERIAL).map((k) => [k, { type: "number" }])),
        profile: {
          type: "string",
          description:
            "Apply section_mm / E_gpa / strength_mpa / density (and label) to this profile instead of the base rod profile; a new name defines a new profile.",
        },
        label: { type: "string" },
        steam_bent: { type: "boolean", description: "With profile: rods of this profile keep the shape they're placed in (no forming stress)." },
      },
    },
    run(args, ctx) {
      const model = readModel(ctx.state);
      const { profile: name, label, steam_bent, ...rest } = args;
      if (name && name !== "rod") {
        const fields = Object.fromEntries(Object.entries(rest).filter(([k]) => PROFILE_FIELDS.includes(k)));
        const others = Object.fromEntries(Object.entries(rest).filter(([k]) => !PROFILE_FIELDS.includes(k)));
        const profs = { ...(model.material.profiles ?? {}) };
        profs[name] = {
          ...profs[name],
          ...fields,
          ...(label ? { label } : {}),
          ...(steam_bent !== undefined ? { steam_bent } : {}),
        };
        model.material = { ...model.material, ...others, profiles: profs };
        // Steaming sets the rods of this profile in their current shape.
        for (const [id, r] of model.rods)
          if ((r.profile ?? "rod") === name)
            model.rods.set(id, steam_bent ? { ...r, rest: r.rest ?? r.pts } : steam_bent === false ? (({ rest: _, ...o }) => o)(r) : r);
      } else model.material = { ...model.material, ...rest };
      const ops = [{ op: "set", key: "material", value: model.material }];
      const summary = ctx?.local ? {} : report(model, relaxModel(model).sim);
      return { ops: [...ops, ...modelOps(model, ctx.state)], result: summary };
    },
  },
  set_profile: {
    description:
      "Change existing rods' profile and/or bundle count, e.g. upgrade the frame arches to primary ×3 bundles so they carry the weave, then relax.",
    input: {
      type: "object",
      properties: { rods: { type: "array", items: rodRef }, profile, bundle },
      required: ["rods"],
    },
    run(args, ctx) {
      return edit(ctx.state, ctx, (m) => {
        setProfile(m, args);
        return [];
      });
    },
  },
  list_profiles: {
    description: "The available rod profiles with their section, stiffness, strength and density.",
    run(_args, ctx) {
      return { result: profiles(readModel(ctx.state).material) };
    },
  },
  relax: {
    description:
      "Run the solver further (if a previous edit did not settle) and store the result.",
    input: {
      type: "object",
      properties: {
        budget_ms: { type: "number", description: "Default 2500, max 4000 (run again to continue)." },
      },
    },
    run({ budget_ms = 2500 }, ctx) {
      const model = readModel(ctx.state);
      const { sim, run } = relaxModel(model, {
        budgetMs: Math.min(budget_ms, 4000),
      });
      return {
        ops: modelOps(model, ctx.state),
        result: { ...report(model, sim), iterations: run.iterations },
      };
    },
  },
  describe: {
    description:
      "Summarise the structure: rods, joints, length, mass, bounds, the most stressed rods (utilization = total stress / strength; added_stress_mpa = stress added by loads since the rod was placed, i.e. excluding the bending needed to form it) and overloaded lashings. detail: true lists every rod and joint.",
    input: { type: "object", properties: { detail: { type: "boolean" } } },
    run({ detail = false }, ctx) {
      const model = readModel(ctx.state);
      const sim = simulate(model);
      return { result: report(model, sim, detail) };
    },
  },
  export_rods: {
    description:
      "Rod centrelines in metres (Z up) with their stage and utilization, for moving the structure into CAD. step thins the points (default 1 = every node).",
    input: {
      type: "object",
      properties: {
        step: { type: "number" },
        rods: { type: "array", items: rodRef },
      },
    },
    run({ step = 1, rods }, ctx) {
      const model = readModel(ctx.state);
      const sim = simulate(model);
      const rep = report(model, sim, true);
      const util = new Map(rep.rod_list.map((r) => [r.id, r.utilization]));
      const want = rods ? new Set(rods) : null;
      return {
        result: {
          section_mm: model.material.section_mm,
          rods: [...model.rods.values()]
            .filter((r) => !want || want.has(r.id))
            .map((r) => ({
              id: r.id,
              kind: r.kind,
              stage: r.stage,
              closed: r.closed,
              utilization: util.get(r.id),
              points: rodPoints(sim, r.id).filter(
                (_, i, a) => i % step === 0 || i === a.length - 1,
              ),
            })),
          joints: model.joints.map(({ id, a, ia, b, ib }) => ({
            id,
            a,
            ia,
            b,
            ib,
          })),
        },
      };
    },
  },
  cut_list: {
    description:
      "Cut list: rod lengths grouped (rounded up to step metres, default 0.05) with counts, total metres, stock pieces needed at max_rod_m, rods over the max, lashing and ground-socket counts.",
    input: { type: "object", properties: { step: { type: "number" } } },
    run({ step = 0.05 }, ctx) {
      return { result: cutList(readModel(ctx.state), step) };
    },
  },
  save_iteration: {
    description:
      "Save the current design as a named iteration (kept with the app, alongside the live design). Returns its id.",
    input: {
      type: "object",
      properties: {
        name: { type: "string" },
        note: { type: "string" },
        thumbnail: { type: "string", description: "Optional small image data URL (the UI sends one)." },
      },
    },
    run({ name, note, thumbnail }, ctx) {
      const model = readModel(ctx.state);
      const rep = report(model, simulate(model));
      const index = ctx.state.iterations ?? [];
      const id = `i${Date.now().toString(36)}`;
      const entry = {
        id,
        name: name || `Iteration ${index.length + 1}`,
        ...(note ? { note } : {}),
        at: new Date().toISOString(),
        stage: model.meta.stage,
        rods: rep.rods,
        joints: rep.joints,
        total_length_m: rep.total_length_m,
        max_utilization: rep.max_utilization,
      };
      return {
        ops: [
          { op: "set", key: `iter.${id}`, value: { ...entry, design: snapshotDesign(ctx.state), ...(thumbnail ? { thumbnail } : {}) } },
          { op: "set", key: "iterations", value: [...index, entry] },
        ],
        result: entry,
      };
    },
  },
  list_iterations: {
    description: "List saved design iterations (id, name, time, rods, length, peak utilization).",
    run(_args, ctx) {
      return { result: ctx.state.iterations ?? [] };
    },
  },
  load_iteration: {
    description:
      "Replace the current design with a saved iteration (by id), or with an exported design object ({design}). Save the current one first if you want to keep it.",
    input: {
      type: "object",
      properties: {
        id: { type: "string" },
        design: { type: "object", description: "A design exported from the app (its rods.*, joints, meta and material keys)." },
      },
    },
    run({ id, design }, ctx) {
      const data = design ?? ctx.state[`iter.${id}`]?.design;
      if (!data) throw new Error(`no iteration ${id}; see list_iterations`);
      const ops = loadDesignOps(ctx.state, data);
      return { ops, result: { loaded: id ?? "design", keys: ops.length } };
    },
  },
  delete_iteration: {
    description: "Delete a saved iteration by id.",
    input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run({ id }, ctx) {
      return {
        ops: [
          { op: "delete", key: `iter.${id}` },
          { op: "set", key: "iterations", value: (ctx.state.iterations ?? []).filter((e) => e.id !== id) },
        ],
        result: { deleted: id },
      };
    },
  },
  clear: {
    description: "Remove every rod and joint (material settings stay).",
    run(_args, ctx) {
      const ops = Object.keys(ctx.state)
        .filter((k) => k.startsWith("rods.") || k === "joints" || k === "meta")
        .map((key) => ({ op: "delete", key }));
      return { ops, result: { cleared: true } };
    },
  },
};
