// The basketry model: rods, joints and anchors kept in app state, the shape
// generators for arches, loops and hoops, and the edits the commands make.
// Plain maths only, so the UI and the commands share it.
import {
  DEFAULT_MATERIAL,
  analyze,
  buildSim,
  relax,
  restSegment,
  profiles,
  rodPoints,
  rodProps,
  WORK_PER_MS,
} from "./sim.js";

export const SHARDS = 8;
const shardOf = (id) => `rods.${Number(id.slice(1)) % SHARDS}`;

// ---------- vectors ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const round = (p) => p.map((v) => Math.round(v * 1000) / 1000);
const UP = [0, 0, 1];

function perpendicular(v, hint = UP) {
  const p = sub(hint, mul(v, dot(hint, v)));
  if (len(p) > 1e-6) return norm(p);
  return norm(cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- state ----------
export function readModel(state = {}) {
  const rods = new Map();
  for (const key of Object.keys(state)) {
    if (!key.startsWith("rods.")) continue;
    for (const r of Object.values(state[key] ?? {})) rods.set(r.id, r);
  }
  const sorted = [...rods.values()].sort(
    (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
  );
  return {
    rods: new Map(sorted.map((r) => [r.id, r])),
    joints: [...(state.joints ?? [])],
    meta: { stage: 0, next: 1, ...(state.meta ?? {}) },
    material: { ...DEFAULT_MATERIAL, ...(state.material ?? {}) },
  };
}

/** The state ops that turn `state` into `model`, touching only changed keys. */
export function modelOps(model, state = {}) {
  const shards = {};
  for (const r of model.rods.values()) {
    const k = shardOf(r.id);
    (shards[k] ??= {})[r.id] = r;
  }
  const ops = [];
  for (let i = 0; i < SHARDS; i++) {
    const k = `rods.${i}`;
    if (shards[k]) {
      if (JSON.stringify(shards[k]) !== JSON.stringify(state[k]))
        ops.push({ op: "set", key: k, value: shards[k] });
    } else if (state[k]) ops.push({ op: "delete", key: k });
  }
  if (JSON.stringify(model.joints) !== JSON.stringify(state.joints ?? []))
    ops.push({ op: "set", key: "joints", value: model.joints });
  if (JSON.stringify(model.meta) !== JSON.stringify(state.meta))
    ops.push({ op: "set", key: "meta", value: model.meta });
  return ops;
}

export const nextId = (model, prefix) => `${prefix}${model.meta.next++}`;

// ---------- simulation over the model ----------
export function simulate(model, carry) {
  return buildSim(
    [...model.rods.values()],
    model.joints,
    model.material,
    carry,
  );
}

/** Writes solved node positions back into the rods (bumping each moved rod's
 * version so viewers adopt them). */
export function storePositions(model, sim, ids = [...model.rods.keys()]) {
  let moved = 0;
  let a = null;
  for (const id of ids) {
    const rod = model.rods.get(id);
    if (!rod || !sim.index.has(id)) continue;
    const pts = rodPoints(sim, id).map(round);
    const change = Math.max(...pts.map((p, i) => dist(p, rod.pts[i] ?? p)));
    const needsK0 = !rod.k0 && sim.residual < 1e-5;
    if (change > 0.0015 || pts.length !== rod.pts.length || needsK0) {
      const next = { ...rod, pts, v: (rod.v ?? 0) + 1 };
      if (needsK0) {
        a ??= analyze(sim);
        const { off, n } = sim.index.get(id);
        next.k0 = Array.from(a.kappa.subarray(off, off + n), (k) => Math.round(k * 1000));
      }
      model.rods.set(id, next);
      moved++;
    }
  }
  return moved;
}

export const SLIP_FACTOR = 3;

/** Removes lashings carrying more than SLIP_FACTOR times their capacity: they
 * would slip or break. Returns the removed ids. */
export function slipTies(model, sim) {
  const limit = SLIP_FACTOR * sim.P.joint_capacity_n;
  const gone = new Set(sim.jointIds.filter((_, k) => Math.abs(sim.jointF[k]) > limit));
  if (gone.size) model.joints = model.joints.filter((j) => !gone.has(j.id));
  return [...gone];
}

export function relaxModel(model, opts = {}) {
  let sim;
  let run;
  const slipped = [];
  // Slip rounds share one budget, so a command never runs long.
  let left = opts.budgetMs ?? 2500;
  for (let round = 0; round < 4; round++) {
    sim = simulate(model, round ? carryFrom(sim) : undefined);
    run = relax(sim, { ...opts, budgetMs: Math.max(150, left) });
    left -= (run.iterations * sim.N) / WORK_PER_MS;
    const gone = slipped.length < 50 ? slipTies(model, sim) : [];
    if (!gone.length) break;
    slipped.push(...gone);
  }
  storePositions(model, sim);
  return { sim, run: { ...run, slipped } };
}

/** Continues a new simulation from an earlier one's node positions. */
export function carryFrom(old) {
  return (rod) => {
    const o = old?.index.get(rod.id);
    if (!o || o.n !== rod.pts.length) return null;
    return {
      X: old.X.subarray(3 * o.off, 3 * (o.off + o.n)),
      V: old.V.subarray(3 * o.off, 3 * (o.off + o.n)),
    };
  };
}

// ---------- shape generators ----------
const segmentsFor = (L, material) =>
  Math.max(6, Math.round(L / (material.segment_m ?? 0.3)));

function resample(curve, n, closed) {
  const pts = closed ? [...curve, curve[0]] : curve;
  const acc = [0];
  for (let i = 1; i < pts.length; i++)
    acc.push(acc[i - 1] + dist(pts[i], pts[i - 1]));
  const total = acc[acc.length - 1];
  const out = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (closed ? n : n - 1);
    while (j < acc.length - 1 && acc[j] < s) j++;
    const t = (s - acc[j - 1]) / (acc[j] - acc[j - 1] || 1);
    out.push(lerp(pts[j - 1], pts[j], t));
  }
  return out;
}

/** Circular arc of length L from a to b bulging towards `up`. Returns the
 * points and the tangents pointing into the rod at each end. */
export function arcShape(a, b, L, up, n) {
  const D = dist(a, b);
  const e1 = norm(sub(b, a));
  if (D >= L * 0.999) {
    const pts = Array.from({ length: n }, (_, i) => lerp(a, b, i / (n - 1)));
    return { pts, da: e1, db: mul(e1, -1), L: D };
  }
  const e2 = perpendicular(e1, up);
  const ratio = D / L;
  let lo = 1e-6;
  let hi = Math.PI - 1e-6;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (Math.sin(m) / m > ratio) lo = m;
    else hi = m;
  }
  const th = (lo + hi) / 2;
  const R = L / (2 * th);
  const centre = sub(lerp(a, b, 0.5), mul(e2, R * Math.cos(th)));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = -th + (2 * th * i) / (n - 1);
    pts.push(
      add(centre, add(mul(e1, R * Math.sin(p)), mul(e2, R * Math.cos(p)))),
    );
  }
  pts[0] = a;
  pts[n - 1] = b;
  return {
    pts,
    da: add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th))),
    db: add(mul(e1, -Math.cos(th)), mul(e2, Math.sin(th))),
    L,
  };
}

/** Teardrop loop standing on `base`, in the plane of `side` and `up`, with its
 * two feet `feet` metres apart along `side`. */
export function loopShape(base, L, side, up, feet, n) {
  const s1 = norm(side);
  const u1 = perpendicular(s1, up);
  const K = 400;
  const unit = [];
  for (let k = 0; k <= K; k++) {
    const t = (2 * Math.PI * k) / K;
    unit.push([Math.sin(t) * Math.sin(t / 2), 1 - Math.cos(t), t]);
  }
  let total = 0;
  for (let k = 1; k <= K; k++)
    total += Math.hypot(unit[k][0] - unit[k - 1][0], unit[k][1] - unit[k - 1][1]);
  const scale = L / total;
  const world = unit.map(([h, v, t]) =>
    add(base, add(mul(s1, h * scale + (feet / 2) * (1 - t / Math.PI)), mul(u1, v * scale))),
  );
  const pts = resample(world, n, false);
  return {
    pts,
    da: norm(sub(pts[1], pts[0])),
    db: norm(sub(pts[n - 2], pts[n - 1])),
  };
}

export function hoopShape(centre, L, normal, n) {
  const nn = norm(normal);
  const e1 = perpendicular(nn, Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : UP);
  const e2 = cross(nn, e1);
  const r = L / (2 * Math.PI);
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return add(centre, add(mul(e1, r * Math.cos(a)), mul(e2, r * Math.sin(a))));
  });
}

// ---------- finding points on rods ----------
function nodeIndex(rod, t) {
  const n = rod.pts.length;
  return Math.round(Math.min(1, Math.max(0, t)) * (rod.closed ? n : n - 1)) % n;
}

export function nearestNode(model, p, { exclude, within = Infinity } = {}) {
  let best = null;
  for (const rod of model.rods.values()) {
    if (exclude?.has(rod.id)) continue;
    rod.pts.forEach((q, i) => {
      const d = dist(p, q);
      if (d < within && (!best || d < best.d))
        best = { rod: rod.id, i, d, p: q };
    });
  }
  return best;
}

export function rodTangent(rod, i) {
  const n = rod.pts.length;
  const a = rod.pts[rod.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
  const b = rod.pts[rod.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  return norm(sub(b, a));
}

/** Where an end goes: the ground (z ≈ 0), a rod ({rod, t} or a point near a
 * rod), or free in the air. */
export function resolvePoint(model, spec, snap = 0.35) {
  if (spec && !Array.isArray(spec) && spec.rod) {
    const rod = model.rods.get(spec.rod);
    if (!rod) throw new Error(`no rod ${spec.rod}`);
    const i = spec.i ?? nodeIndex(rod, spec.t ?? 0.5);
    return { kind: "rod", rod: rod.id, i, p: rod.pts[i] };
  }
  const p = Array.isArray(spec) ? spec : spec?.near;
  if (!Array.isArray(p) || p.length < 2)
    throw new Error("expected a point [x, y, z] or {rod, t}");
  const q = [p[0], p[1], p[2] ?? 0];
  const near = nearestNode(model, q, { within: spec?.near ? Infinity : snap });
  if (near) return { kind: "rod", rod: near.rod, i: near.i, p: near.p };
  if (q[2] <= 0.05) return { kind: "ground", p: [q[0], q[1], 0] };
  return { kind: "free", p: q };
}

// ---------- edits ----------
function joint(model, a, ia, b, ib, stage, extra = {}) {
  const j = { id: nextId(model, "j"), a, ia, b, ib, stage, ...extra };
  model.joints.push(j);
  return j;
}

/** Fixes a rod end at its target: a ground socket (pinned, clamped along the
 * end tangent unless socket is "pin" or "vertical"), or lashed to a rod over
 * `lash` nodes. */
function attachEnd(model, rod, end, target, dir, opts, stage) {
  const i = end === 0 ? 0 : rod.pts.length - 1;
  if (target.kind === "ground") {
    const socket = opts.socket ?? "tangent";
    const d =
      socket === "pin" ? undefined : socket === "vertical" ? UP : round(dir);
    (rod.fix ??= []).push({ i, p: round(target.p), ...(d ? { d } : {}) });
  } else if (target.kind === "rod") {
    const host = model.rods.get(target.rod);
    joint(model, rod.id, i, host.id, target.i, stage);
    if ((opts.lash ?? 1) >= 2) {
      const next = end === 0 ? 1 : rod.pts.length - 2;
      const n = host.pts.length;
      const cands = [target.i - 1, target.i + 1]
        .map((k) => (host.closed ? (k + n) % n : k))
        .filter((k) => k >= 0 && k < n);
      const k = cands.sort(
        (x, y) =>
          dist(host.pts[x], rod.pts[next]) - dist(host.pts[y], rod.pts[next]),
      )[0];
      if (k !== undefined) joint(model, rod.id, next, host.id, k, stage);
    }
  }
}

/** Profile and bundle fields for a new or changed rod, checked against the
 * material's profiles. */
export function profileFields(model, { profile, bundle } = {}) {
  const out = {};
  if (profile && profile !== "rod") {
    if (!profiles(model.material)[profile])
      throw new Error(`no profile "${profile}"; use ${Object.keys(profiles(model.material)).join(", ")}`);
    out.profile = profile;
  }
  const n = Math.round(bundle ?? 1);
  if (n > 1) out.bundle = Math.min(n, 12);
  return out;
}

function newRod(model, kind, pts, L, stage, closed = false, args = {}) {
  const rod = {
    id: nextId(model, "r"),
    kind,
    stage,
    closed,
    L: Math.round(L * 1000) / 1000,
    pts: pts.map(round),
    fix: [],
    v: 1,
    ...profileFields(model, args),
  };
  if (rodProps(model.material, rod).steamBent) rod.rest = rod.pts;
  model.rods.set(rod.id, rod);
  return rod;
}

export function beginStage(model) {
  model.meta.stage += 1;
  return model.meta.stage;
}

export function addArch(model, args, stage) {
  const L = args.length ?? 8;
  const a = resolvePoint(model, args.a);
  const b = resolvePoint(model, args.b);
  const n = segmentsFor(L, model.material) + 1;
  const shape = arcShape(a.p, b.p, L, args.up ?? UP, n);
  const rod = newRod(model, args.kind ?? "arch", shape.pts, shape.L, stage, false, args);
  attachEnd(model, rod, 0, a, shape.da, args, stage);
  attachEnd(model, rod, 1, b, shape.db, args, stage);
  return rod;
}

export function addLoop(model, args, stage) {
  const L = args.length ?? 6;
  const base = resolvePoint(model, args.at);
  const n = segmentsFor(L, model.material) + 1;
  let side = args.side;
  if (!side) {
    if (base.kind === "rod") {
      const t = rodTangent(model.rods.get(base.rod), base.i);
      side = len([t[0], t[1], 0]) > 0.2 ? t : [1, 0, 0];
    } else {
      const az = ((args.azimuth ?? 0) * Math.PI) / 180;
      side = [Math.cos(az), Math.sin(az), 0];
    }
  }
  const tilt = ((args.tilt ?? 0) * Math.PI) / 180;
  const s1 = norm(side);
  const lean = norm(cross(s1, UP));
  const up = norm(add(mul(UP, Math.cos(tilt)), mul(lean, Math.sin(tilt))));
  const feet = args.feet ?? 0.3;
  const shape = loopShape(base.p, L, s1, up, feet, n);
  const onHost = (p) => {
    if (base.kind !== "rod") return { ...base, p };
    const host = model.rods.get(base.rod);
    let i = 0;
    host.pts.forEach((q, k) => {
      if (dist(q, p) < dist(host.pts[i], p)) i = k;
    });
    return { kind: "rod", rod: host.id, i, p: host.pts[i] };
  };
  const footA = onHost(shape.pts[0]);
  const footB = onHost(shape.pts[n - 1]);
  const rod = newRod(model, "loop", shape.pts, L, stage, false, args);
  const opts = { lash: base.kind === "rod" ? 1 : 2, ...args };
  attachEnd(model, rod, 0, base.kind === "free" ? { kind: "free" } : footA, shape.da, opts, stage);
  attachEnd(model, rod, 1, base.kind === "free" ? { kind: "free" } : footB, shape.db, opts, stage);
  if (base.kind === "rod") autoJoin(model, [rod.id], { radius: 0.5, per_rod: 4, spacing: 1 }, stage);
  return rod;
}

export function addHoop(model, args, stage) {
  const L = args.length ?? 8;
  const n = segmentsFor(L, model.material);
  const centre = args.centre ?? args.center ?? [0, 0, 1.5];
  const pts = hoopShape(centre, L, args.normal ?? [0, 1, 0], n);
  return newRod(model, "hoop", pts, L, stage, true, args);
}

export function addPolyline(model, args, stage) {
  const pts0 = args.points;
  if (!Array.isArray(pts0) || pts0.length < 2)
    throw new Error("points needs at least two [x, y, z]");
  let total = 0;
  for (let i = 1; i < pts0.length; i++) total += dist(pts0[i], pts0[i - 1]);
  const closed = !!args.closed;
  const L = args.length ?? total;
  const n = segmentsFor(L, model.material) + (closed ? 0 : 1);
  const pts = resample(pts0, n, closed);
  const ends = closed ? [] : [resolvePoint(model, pts0[0]), resolvePoint(model, pts0[pts0.length - 1])];
  const rod = newRod(model, args.kind ?? "rod", pts, L, stage, closed, args);
  if (!closed) {
    attachEnd(model, rod, 0, ends[0], norm(sub(pts[1], pts[0])), args, stage);
    attachEnd(model, rod, 1, ends[1], norm(sub(pts[n - 2], pts[n - 1])), args, stage);
  }
  return rod;
}

export function addJoint(model, args, stage) {
  const a = resolvePoint(model, args.a, Infinity);
  const b = resolvePoint(model, args.b, Infinity);
  if (a.kind !== "rod" || b.kind !== "rod")
    throw new Error("both ends of a joint must be on rods");
  if (a.rod === b.rod && a.i === b.i)
    throw new Error("joint ends are the same point");
  return joint(model, a.rod, a.i, b.rod, b.i, stage, {
    ...(args.stiffness != null ? { k: args.stiffness } : {}),
  });
}

/** Node indices fixed by ground anchors (and their clamped neighbours). */
function anchored(rod) {
  const held = new Set();
  for (const f of rod.fix ?? []) {
    held.add(f.i);
    if (f.d) held.add(f.i === 0 ? 1 : f.i - 1);
  }
  return held;
}

/** Ties the given rods to whatever passes within `radius`: closest pairs
 * first, at most `per_rod` new joints per rod, and no two joints on a rod
 * closer than `spacing` metres along it. */
export function autoJoin(
  model,
  ids,
  { radius = 0.8, per_rod = 6, spacing = 0.9, per_pair = 2 } = {},
  stage,
) {
  const own = new Set(ids);
  const cell = Math.max(radius, 0.2);
  const grid = new Map();
  const key = (p) =>
    `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  for (const rod of model.rods.values()) {
    const held = anchored(rod);
    rod.pts.forEach((p, i) => {
      if (held.has(i)) return;
      const k = key(p);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([rod.id, i]);
    });
  }
  const cands = [];
  const seen = new Set();
  for (const id of ids) {
    const rod = model.rods.get(id);
    const held = rod ? anchored(rod) : new Set();
    rod?.pts.forEach((p, i) => {
      if (held.has(i)) return;
      const [cx, cy, cz] = [0, 1, 2].map((d) => Math.floor(p[d] / cell));
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++)
            for (const [oid, j] of grid.get(`${cx + x},${cy + y},${cz + z}`) ??
              []) {
              if (oid === id) continue;
              const pair =
                id < oid ? `${id}:${i}|${oid}:${j}` : `${oid}:${j}|${id}:${i}`;
              if (own.has(oid) && seen.has(pair)) continue;
              const d = dist(p, model.rods.get(oid).pts[j]);
              if (d < radius) {
                seen.add(pair);
                cands.push({ a: id, i, b: oid, j, d });
              }
            }
    });
  }
  cands.sort((x, y) => x.d - y.d);
  const onRod = new Map();
  const pairs = new Map();
  for (const j of model.joints) {
    (onRod.get(j.a) ?? onRod.set(j.a, []).get(j.a)).push(j.ia);
    (onRod.get(j.b) ?? onRod.set(j.b, []).get(j.b)).push(j.ib);
    const pk = [j.a, j.b].sort().join("|");
    pairs.set(pk, (pairs.get(pk) ?? 0) + 1);
  }
  const added = new Map();
  const made = [];
  const clear = (rid, idx) => {
    const rod = model.rods.get(rid);
    const l0 = restSegment(rod);
    const n = rod.pts.length;
    return (onRod.get(rid) ?? []).every((k) => {
      const gap = Math.abs(k - idx);
      return (rod.closed ? Math.min(gap, n - gap) : gap) * l0 >= spacing;
    });
  };
  for (const c of cands) {
    if ((added.get(c.a) ?? 0) >= per_rod) continue;
    if (own.has(c.b) && (added.get(c.b) ?? 0) >= per_rod) continue;
    const pk = [c.a, c.b].sort().join("|");
    if ((pairs.get(pk) ?? 0) >= per_pair) continue;
    if (!clear(c.a, c.i) || !clear(c.b, c.j)) continue;
    made.push(joint(model, c.a, c.i, c.b, c.j, stage));
    (onRod.get(c.a) ?? onRod.set(c.a, []).get(c.a)).push(c.i);
    (onRod.get(c.b) ?? onRod.set(c.b, []).get(c.b)).push(c.j);
    pairs.set(pk, (pairs.get(pk) ?? 0) + 1);
    added.set(c.a, (added.get(c.a) ?? 0) + 1);
    if (own.has(c.b)) added.set(c.b, (added.get(c.b) ?? 0) + 1);
  }
  return made;
}

export function structureCentre(model) {
  const pts = [...model.rods.values()].flatMap((r) => r.pts);
  if (!pts.length) return [0, 0, 1];
  return mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
}

export function bounds(model) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const r of model.rods.values())
    for (const p of r.pts)
      for (let d = 0; d < 3; d++) {
        min[d] = Math.min(min[d], p[d]);
        max[d] = Math.max(max[d], p[d]);
      }
  return model.rods.size ? { min, max } : null;
}

/** Bridges two rods with `count` rods, lashed to each, bulging away from the
 * structure. "diagonal" crosses them in pairs and ties the crossings. */
export function weave(model, args, stage) {
  const A = model.rods.get(args.a?.rod ?? args.a);
  const B = model.rods.get(args.b?.rod ?? args.b);
  if (!A || !B) throw new Error("weave needs two existing rods a and b");
  const count = Math.max(1, Math.min(40, args.count ?? 6));
  const [a0, a1] = args.a_range ?? [0.15, 0.85];
  const [b0, b1] = args.b_range ?? [0.15, 0.85];
  const slack = args.slack ?? 1.25;
  const centre = structureCentre(model);
  const made = [];
  const span =
    count === 1
      ? [0.5]
      : Array.from({ length: count }, (_, i) => i / (count - 1));
  const shift =
    args.pattern === "diagonal" ? Math.max(1, Math.round(count / 3)) : 0;
  const links = [];
  span.forEach((s, i) => {
    if (shift) {
      const k = Math.min(count - 1, i + shift);
      if (k !== i) links.push([s, span[k]], [span[k], s]);
    } else links.push([s, s]);
  });
  for (const [sa, sb] of links) {
    const pa = { rod: A.id, t: a0 + (a1 - a0) * sa };
    const pb = { rod: B.id, t: b0 + (b1 - b0) * sb };
    const ea = resolvePoint(model, pa);
    const eb = resolvePoint(model, pb);
    const mid = lerp(ea.p, eb.p, 0.5);
    const out = norm(add(sub(mid, centre), [0, 0, 0.3]));
    if (dist(ea.p, eb.p) < 0.5) continue;
    const L = Math.max(1, dist(ea.p, eb.p) * slack);
    made.push(
      addArch(
        model,
        { a: pa, b: pb, length: L, up: args.up ?? out, kind: "weave", profile: args.profile, bundle: args.bundle },
        stage,
      ),
    );
  }
  if (shift)
    autoJoin(
      model,
      made.map((r) => r.id),
      { radius: 0.25, per_rod: 4, spacing: 0.6 },
      stage,
    );
  return made;
}

/** Drops hoops at random through a region and ties each to what it touches;
 * hoops that catch fewer than `min_joints` are discarded. */
export function scatterHoops(model, args, stage) {
  const rnd = seeded(args.seed ?? Date.now());
  const b = bounds(model);
  const region =
    args.region ??
    (b
      ? {
          min: [b.min[0], b.min[1], Math.max(0.6, b.min[2])],
          max: [b.max[0], b.max[1], Math.max(1.2, b.max[2] * 0.9)],
        }
      : { min: [-2, -2, 0.8], max: [2, 2, 2.5] });
  const count = Math.max(1, Math.min(60, args.count ?? 8));
  const radius = args.attach_radius ?? 0.7;
  const kept = [];
  for (let k = 0; k < count; k++) {
    const centre = [0, 1, 2].map(
      (d) => region.min[d] + (region.max[d] - region.min[d]) * rnd(),
    );
    const th = rnd() * Math.PI * 2;
    const ph = Math.acos(2 * rnd() - 1);
    const normal = [
      Math.sin(ph) * Math.cos(th),
      Math.sin(ph) * Math.sin(th),
      Math.cos(ph),
    ];
    const L = (args.length ?? 6) * (0.8 + 0.4 * rnd());
    const hoop = addHoop(model, { centre, length: L, normal, profile: args.profile, bundle: args.bundle }, stage);
    const ties = autoJoin(
      model,
      [hoop.id],
      { radius, per_rod: args.per_rod ?? 4, spacing: 0.8, per_pair: 2 },
      stage,
    );
    if (ties.length < (args.min_joints ?? 2)) {
      removeRods(model, [hoop.id]);
    } else kept.push(hoop);
  }
  return kept;
}

export function removeRods(model, ids) {
  const gone = new Set(ids);
  for (const id of ids) model.rods.delete(id);
  model.joints = model.joints.filter((j) => !gone.has(j.a) && !gone.has(j.b));
}

/** Starter frames on the ground around `centre`. */
export function addPreset(model, args, stage) {
  const c = args.centre ?? args.center ?? [0, 0, 0];
  const span = args.span ?? 5;
  const L = args.length ?? 8;
  const at = (dx, dy) => [c[0] + dx, c[1] + dy, 0];
  const made = [];
  const arch = (a, b, up) =>
    made.push(
      addArch(model, { a, b, length: L, up, socket: args.socket, profile: args.profile, bundle: args.bundle }, stage),
    );
  const type = args.type ?? "cross";
  if (type === "cross") {
    arch(at(-span / 2, 0), at(span / 2, 0));
    arch(at(0, -span / 2), at(0, span / 2));
  } else if (type === "dome") {
    const n = args.count ?? 3;
    for (let k = 0; k < n; k++) {
      const a = (Math.PI * k) / n;
      arch(
        at((Math.cos(a) * span) / 2, (Math.sin(a) * span) / 2),
        at((-Math.cos(a) * span) / 2, (-Math.sin(a) * span) / 2),
      );
    }
  } else if (type === "tunnel") {
    const n = args.count ?? 4;
    const gap = args.spacing ?? 1.2;
    for (let k = 0; k < n; k++) {
      const y = (k - (n - 1) / 2) * gap;
      arch(at(-span / 2, y), at(span / 2, y));
    }
    const apex = (rod) => rod.pts.reduce((a, p) => (p[2] > a[2] ? p : a));
    const ridge = addPolyline(
      model,
      { points: [apex(made[0]), apex(made[made.length - 1])], kind: "ridge", profile: args.profile, bundle: args.bundle },
      stage,
    );
    autoJoin(model, [ridge.id], { radius: 0.35, per_rod: n, spacing: gap * 0.8, per_pair: 1 }, stage);
    made.push(ridge);
  } else if (type === "tripod") {
    const pts = [0, 1, 2].map((k) => {
      const a = (2 * Math.PI * k) / 3 + Math.PI / 2;
      return at((Math.cos(a) * span) / 2, (Math.sin(a) * span) / 2);
    });
    arch(pts[0], pts[1]);
    arch(pts[1], pts[2]);
    arch(pts[2], pts[0]);
  } else
    throw new Error(
      `unknown preset ${type}; use cross, dome, tunnel or tripod`,
    );
  if (type !== "tunnel")
    autoJoin(
      model,
      made.map((r) => r.id),
      { radius: 0.3, per_rod: 4, spacing: 1, per_pair: 1 },
      stage,
    );
  return made;
}

// ---------- reports ----------
export function report(model, sim = simulate(model), detail = false) {
  const a = analyze(sim);
  const P = sim.P;
  let total = 0;
  let mass = 0;
  const rods = sim.rods.map((r, k) => {
    total += r.L * sim.rodP[k].bundle;
    mass += r.L * sim.rodP[k].A * sim.rodP[k].density;
    return {
      id: r.id,
      kind: r.kind,
      profile: sim.rodP[k].profile,
      ...(sim.rodP[k].bundle > 1 ? { bundle: sim.rodP[k].bundle } : {}),
      stage: r.stage,
      length_m: r.L,
      utilization: +a.rodMax[k].toFixed(3),
      max_stress_mpa: +a.rodStress[k].toFixed(1),
      added_stress_mpa: +a.rodLoad[k].toFixed(1),
    };
  });
  const joints = sim.jointIds.map((id, k) => ({
    id,
    force_n: Math.round(a.jointF[k]),
  }));
  const over = rods.filter((r) => r.utilization > 1);
  const b = bounds(model);
  const out = {
    stage: model.meta.stage,
    rods: rods.length,
    joints: joints.length,
    total_length_m: +total.toFixed(2),
    mass_kg: +mass.toFixed(2),
    max_utilization: +Math.max(0, ...rods.map((r) => r.utilization)).toFixed(3),
    rods_over_strength: over.map((r) => r.id),
    rods_over_length: rods.filter((r) => r.length_m > model.material.max_rod_m).map((r) => r.id),
    max_joint_force_n: Math.max(0, ...joints.map((j) => Math.abs(j.force_n))),
    joints_over_capacity: joints
      .filter((j) => Math.abs(j.force_n) > P.joint_capacity_n)
      .map((j) => j.id),
    bounds: b && { min: round(b.min), max: round(b.max) },
    settled: sim.residual < 1e-5 || sim.residual === Infinity,
    material: model.material,
  };
  if (detail) {
    out.rod_list = rods;
    out.joint_list = joints;
  } else {
    out.worst_rods = [...rods]
      .sort((x, y) => y.utilization - x.utilization)
      .slice(0, 5);
  }
  return out;
}

/** Cut lengths grouped to `step` metres (rounded up), longest first. Closed
 * hoops get lap_m extra for the overlap where the ring is lashed to itself;
 * rods over max_rod_m need splicing from several pieces of stock. */
export function cutList(model, step = 0.05) {
  const { max_rod_m: max, lap_m: lap } = model.material;
  const profs = profiles(model.material);
  const groups = new Map();
  const byProfile = {};
  let total = 0;
  const over = [];
  let pieces = 0;
  let count = 0;
  for (const r of model.rods.values()) {
    const p = rodProps(model.material, r);
    const cut = Math.ceil((r.L + (r.closed ? lap : 0)) / step - 1e-9) * step;
    const key = `${p.profile}|${cut.toFixed(2)}`;
    const g = groups.get(key) ?? {
      profile: p.profile,
      section_mm: p.section_mm,
      length_m: +cut.toFixed(2),
      count: 0,
      kinds: new Set(),
      rods: [],
    };
    g.count += p.bundle;
    g.kinds.add(p.bundle > 1 ? `${r.kind} ×${p.bundle}` : r.kind);
    g.rods.push(r.id);
    groups.set(key, g);
    const bp = (byProfile[p.profile] ??= { label: profs[p.profile]?.label ?? p.profile, section_mm: p.section_mm, rods: 0, total_m: 0 });
    bp.rods += p.bundle;
    bp.total_m = +(bp.total_m + cut * p.bundle).toFixed(2);
    total += cut * p.bundle;
    count += p.bundle;
    if (cut > max) over.push(r.id);
    pieces += Math.ceil(cut / max - 1e-9) * p.bundle;
  }
  const order = Object.keys(profs);
  const rows = [...groups.values()]
    .sort((a, b) => order.indexOf(a.profile) - order.indexOf(b.profile) || b.length_m - a.length_m)
    .map((g) => ({ ...g, kinds: [...g.kinds], over_max: g.length_m > max }));
  return {
    rows,
    by_profile: byProfile,
    rods: count,
    members: model.rods.size,
    total_m: +total.toFixed(2),
    stock_max_m: max,
    stock_pieces: pieces,
    over_max: over,
    lashings: model.joints.length,
    ground_sockets: [...model.rods.values()].reduce((n, r) => n + (r.fix?.length ?? 0), 0),
  };
}

/** Changes the profile and/or bundle count of existing rods. */
export function setProfile(model, { rods, profile, bundle }) {
  const changed = [];
  for (const id of rods ?? []) {
    const r = model.rods.get(id);
    if (!r) continue;
    const next = { ...r };
    if (profile !== undefined) delete next.profile;
    if (bundle !== undefined) delete next.bundle;
    Object.assign(next, profileFields(model, { profile: profile ?? r.profile, bundle: bundle ?? r.bundle }));
    // Steaming a rod in place sets its current shape; anything else springs back.
    if (rodProps(model.material, next).steamBent) next.rest ??= r.pts;
    else delete next.rest;
    next.v = (r.v ?? 0) + 1;
    model.rods.set(id, next);
    changed.push(id);
  }
  return changed;
}

// ---------- design iterations ----------
const isDesignKey = (k) => k.startsWith("rods.") || k === "joints" || k === "meta" || k === "material";

/** The keys that make up the current design, for saving or exporting. */
export function snapshotDesign(state) {
  return Object.fromEntries(Object.entries(state).filter(([k]) => isDesignKey(k)));
}

/** Ops that replace the current design with `design`. Loaded rods get newer
 * versions than anything live, so open views adopt their positions. */
export function loadDesignOps(state, design) {
  let maxV = 0;
  for (const r of readModel(state).rods.values()) maxV = Math.max(maxV, r.v ?? 0);
  const ops = Object.keys(state)
    .filter((k) => isDesignKey(k) && !(k in design))
    .map((key) => ({ op: "delete", key }));
  for (const [key, value] of Object.entries(design)) {
    if (!isDesignKey(key)) continue;
    const v = key.startsWith("rods.")
      ? Object.fromEntries(Object.entries(value).map(([id, r]) => [id, { ...r, v: (r.v ?? 0) + maxV + 1 }]))
      : value;
    ops.push({ op: "set", key, value: v });
  }
  return ops;
}
