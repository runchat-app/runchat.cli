// Bending-active rod solver, shared by the UI and the commands. Rods are
// polylines of nodes (metres, Z up) relaxed with dynamic relaxation: axial
// springs, discrete bending (second differences), self weight, lashings as
// linear springs (their gap opens with the force they carry), and ground
// anchors that pin or clamp a rod end. Square sections bend the same both
// ways, so torsion is left out. Each rod has a profile (its section and
// timber) and may be a bundle of several rods lashed together.

export const DEFAULT_MATERIAL = {
  E_gpa: 10,
  density: 650,
  section_mm: 20,
  strength_mpa: 60,
  segment_m: 0.3,
  joint_stiffness: 20000,
  joint_capacity_n: 600,
  gravity: 1,
  max_rod_m: 9,
  lap_m: 0.3,
  bundle_action: 0.5,
};

// The top-level E_gpa/density/section_mm/strength_mpa are the "rod" profile;
// these are the others (material.profiles adds to or overrides them).
export const DEFAULT_PROFILES = {
  primary: { label: "Primary · steam-bent ash", section_mm: 32, E_gpa: 11, strength_mpa: 80, density: 680, steam_bent: true },
  weave: { label: "Weave · rattan", section_mm: 10, E_gpa: 6, strength_mpa: 55, density: 550 },
};
export const PROFILE_FIELDS = ["section_mm", "E_gpa", "strength_mpa", "density"];

export function profiles(material) {
  const m = { ...DEFAULT_MATERIAL, ...material };
  const rod = { label: "Rod · bent timber" };
  for (const k of PROFILE_FIELDS) rod[k] = m[k];
  const extra = m.profiles ?? {};
  return {
    primary: { ...DEFAULT_PROFILES.primary, ...extra.primary },
    rod: { ...rod, ...(extra.rod?.label ? { label: extra.rod.label } : {}) },
    weave: { ...DEFAULT_PROFILES.weave, ...extra.weave },
    ...Object.fromEntries(
      Object.entries(extra).filter(([k]) => !["primary", "rod", "weave"].includes(k)).map(([k, v]) => [k, { label: k, ...rod, ...v }]),
    ),
  };
}

/** Section properties of one rod: its profile, times `bundle` rods lashed
 * together. bundle_action runs from 0 (the rods slide past each other: n×I)
 * to 1 (fully composite: n²×I for a square bundle). Bundled rods are bent one
 * at a time before lashing, so forming stress uses one rod's depth (c1) while
 * later loads see the bundle's (c). Steam-bent profiles keep the shape they
 * were bent to as their rest shape. */
export function rodProps(material, rod) {
  const m = { ...DEFAULT_MATERIAL, ...material };
  const name = rod?.profile ?? "rod";
  const p = profiles(m)[name] ?? profiles(m).rod;
  const n = Math.max(1, Math.round(rod?.bundle ?? 1));
  const act = Math.min(1, Math.max(0, m.bundle_action));
  const b = p.section_mm / 1000;
  const E = p.E_gpa * 1e9;
  const A = n * b * b;
  const I = n * (b ** 4 / 12) * n ** act;
  return {
    profile: name,
    bundle: n,
    section_mm: p.section_mm,
    density: p.density,
    E,
    A,
    I,
    EI: E * I,
    c: (b / 2) * n ** (act / 2),
    c1: b / 2,
    steamBent: !!p.steam_bent,
    width: b * Math.sqrt(n),
    weight: p.density * A * 9.81 * (m.gravity ?? 1),
    fb: p.strength_mpa * 1e6,
  };
}

// Axial stiffness is held at this multiple of the bending stiffness so the
// relaxation converges quickly. Forces at equilibrium are unaffected; rods
// just stretch a little more than real timber would.
const AXIAL_RATIO = 30;

export function properties(material) {
  const m = { ...DEFAULT_MATERIAL, ...material };
  const b = m.section_mm / 1000;
  const A = b * b;
  const I = b ** 4 / 12;
  const E = m.E_gpa * 1e9;
  return {
    ...m,
    E,
    A,
    I,
    EI: E * I,
    c: b / 2,
    weight: m.density * A * 9.81 * (m.gravity ?? 1),
    fb: m.strength_mpa * 1e6,
  };
}

export const restSegment = (rod) =>
  rod.L / (rod.closed ? rod.pts.length : rod.pts.length - 1);

export function buildSim(rods, joints, material, carry) {
  const P = properties(material);
  const index = new Map();
  let N = 0;
  for (const r of rods) {
    index.set(r.id, { off: N, n: r.pts.length, rod: r });
    N += r.pts.length;
  }
  const X = new Float64Array(3 * N);
  const V = new Float64Array(3 * N);
  const F = new Float64Array(3 * N);
  const S = new Float64Array(N);
  const W = new Float64Array(N);
  const fixed = new Uint8Array(N);
  const nodeRod = new Int32Array(N);
  const seg = [];
  const tri = [];
  const tri0 = [];
  const rodP = rods.map((r) => rodProps(material, r));

  rods.forEach((r, ri) => {
    const { off, n } = index.get(r.id);
    const l0 = restSegment(r);
    const RP = rodP[ri];
    const kb = RP.EI / l0 ** 3;
    const ka = AXIAL_RATIO * kb;
    const from = carry?.(r);
    for (let i = 0; i < n; i++) {
      const g = off + i;
      const p = from
        ? [from.X[3 * i], from.X[3 * i + 1], from.X[3 * i + 2]]
        : r.pts[i];
      X[3 * g] = p[0];
      X[3 * g + 1] = p[1];
      X[3 * g + 2] = p[2];
      if (from) {
        V[3 * g] = from.V[3 * i];
        V[3 * g + 1] = from.V[3 * i + 1];
        V[3 * g + 2] = from.V[3 * i + 2];
      }
      nodeRod[g] = ri;
      W[g] = RP.weight * l0 * (!r.closed && (i === 0 || i === n - 1) ? 0.5 : 1);
    }
    const segs = r.closed ? n : n - 1;
    for (let i = 0; i < segs; i++)
      seg.push(off + i, off + ((i + 1) % n), l0, ka);
    for (let i = 0; i < n; i++) {
      if (!r.closed && (i === 0 || i === n - 1)) continue;
      tri.push(off + ((i - 1 + n) % n), off + i, off + ((i + 1) % n), kb);
      // Steam-bent rods rest in the shape they were set to (in world axes,
      // which holds while the frame they belong to stays put).
      const rest = RP.steamBent && r.rest?.length === n ? r.rest : null;
      if (rest) {
        const [a, b, c] = [rest[(i - 1 + n) % n], rest[i], rest[(i + 1) % n]];
        tri0.push(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]);
      } else tri0.push(0, 0, 0);
    }
    for (const f of r.fix ?? []) {
      const g = off + f.i;
      fixed[g] = 1;
      X.set(f.p, 3 * g);
      if (f.d) {
        const j = off + (f.i === 0 ? 1 : f.i - 1);
        fixed[j] = 1;
        for (let k = 0; k < 3; k++) X[3 * j + k] = f.p[k] + f.d[k] * l0;
      }
    }
  });

  const jt = [];
  const jointIds = [];
  for (const j of joints) {
    const a = index.get(j.a);
    const b = index.get(j.b);
    if (!a || !b) continue;
    const ia = Math.min(Math.max(j.ia, 0), a.n - 1);
    const ib = Math.min(Math.max(j.ib, 0), b.n - 1);
    jt.push(
      a.off + ia,
      b.off + ib,
      0,
      j.k ?? P.joint_stiffness,
    );
    jointIds.push(j.id);
  }

  for (let s = 0; s < seg.length; s += 4) {
    S[seg[s]] += 2 * seg[s + 3];
    S[seg[s + 1]] += 2 * seg[s + 3];
  }
  for (let t = 0; t < tri.length; t += 4) {
    S[tri[t]] += 4 * tri[t + 3];
    S[tri[t + 1]] += 8 * tri[t + 3];
    S[tri[t + 2]] += 4 * tri[t + 3];
  }
  for (let j = 0; j < jt.length; j += 4) {
    S[jt[j]] += 2 * jt[j + 3];
    S[jt[j + 1]] += 2 * jt[j + 3];
  }
  const M = new Float64Array(N);
  for (let i = 0; i < N; i++) M[i] = Math.max(S[i], 1) * 0.45;

  const sim = {
    P,
    N,
    X,
    V,
    F,
    M,
    S,
    W,
    fixed,
    nodeRod,
    rods,
    rodP,
    index,
    seg: Float64Array.from(seg),
    tri: Float64Array.from(tri),
    tri0: Float64Array.from(tri0),
    jt: Float64Array.from(jt),
    jointIds,
    segN: new Float64Array(seg.length / 4),
    jointF: new Float64Array(jt.length / 4),
    damping: 0.995,
    residual: Infinity,
    iterations: 0,
  };
  forces(sim);
  return sim;
}

function forces(sim) {
  const { X, F, W, seg, tri, tri0, jt, segN, jointF } = sim;
  F.fill(0);
  for (let i = 0; i < sim.N; i++) F[3 * i + 2] -= W[i];
  for (let s = 0, k = 0; s < seg.length; s += 4, k++) {
    const a = 3 * seg[s];
    const b = 3 * seg[s + 1];
    const dx = X[b] - X[a];
    const dy = X[b + 1] - X[a + 1];
    const dz = X[b + 2] - X[a + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const t = seg[s + 3] * (L - seg[s + 2]);
    segN[k] = t;
    const f = t / L;
    F[a] += f * dx;
    F[a + 1] += f * dy;
    F[a + 2] += f * dz;
    F[b] -= f * dx;
    F[b + 1] -= f * dy;
    F[b + 2] -= f * dz;
  }
  for (let t = 0, q = 0; t < tri.length; t += 4, q += 3) {
    const a = 3 * tri[t];
    const b = 3 * tri[t + 1];
    const c = 3 * tri[t + 2];
    const k = tri[t + 3];
    for (let d = 0; d < 3; d++) {
      const delta = k * (X[a + d] - 2 * X[b + d] + X[c + d] - tri0[q + d]);
      F[a + d] -= delta;
      F[b + d] += 2 * delta;
      F[c + d] -= delta;
    }
  }
  for (let j = 0, k = 0; j < jt.length; j += 4, k++) {
    const a = 3 * jt[j];
    const b = 3 * jt[j + 1];
    const kj = jt[j + 3];
    const dx = X[b] - X[a];
    const dy = X[b + 1] - X[a + 1];
    const dz = X[b + 2] - X[a + 2];
    jointF[k] = kj * Math.sqrt(dx * dx + dy * dy + dz * dz);
    F[a] += kj * dx;
    F[a + 1] += kj * dy;
    F[a + 2] += kj * dz;
    F[b] -= kj * dx;
    F[b + 1] -= kj * dy;
    F[b + 2] -= kj * dz;
  }
}

/** Runs dynamic relaxation with viscous damping. Returns the residual: the
 * largest out-of-balance force divided by the node's stiffness, in metres. */
export function step(sim, iterations) {
  const { X, V, F, M, S, fixed } = sim;
  let residual = 0;
  for (let it = 0; it < iterations; it++) {
    forces(sim);
    residual = 0;
    let speed = 0;
    for (let i = 0; i < sim.N; i++) {
      if (fixed[i]) continue;
      const i3 = 3 * i;
      const inv = 1 / M[i];
      for (let d = 0; d < 3; d++) {
        const v = V[i3 + d] * sim.damping + F[i3 + d] * inv;
        V[i3 + d] = v;
        X[i3 + d] += v;
      }
      if (X[i3 + 2] < 0) {
        X[i3 + 2] = 0;
        if (V[i3 + 2] < 0) V[i3 + 2] = 0;
        V[i3] *= 0.5;
        V[i3 + 1] *= 0.5;
        if (F[i3 + 2] < 0) F[i3 + 2] = 0;
      }
      const r = Math.hypot(F[i3], F[i3 + 1], F[i3 + 2]) / Math.max(S[i], 1);
      if (r > residual) residual = r;
      const sp = Math.abs(V[i3]) + Math.abs(V[i3 + 1]) + Math.abs(V[i3 + 2]);
      if (sp > speed) speed = sp;
    }
    // Runaway guard: if anything moves more than 20 cm in one step, stop it
    // and make every node heavier.
    if (!(speed < 0.2)) {
      V.fill(0);
      for (let i = 0; i < sim.N; i++) M[i] *= 1.25;
    }
    sim.iterations++;
  }
  sim.residual = residual;
  return residual;
}

export const SETTLED = 5e-7;

// Node-iterations per millisecond of budget. Workers freeze Date.now() while a
// request runs, so the budget is enforced as an amount of work, not just time.
export const WORK_PER_MS = 10000;

/** Relaxes until settled or the budget runs out. */
export function relax(sim, { budgetMs = 2500, maxIterations = 200000 } = {}) {
  const start = Date.now();
  const cap = Math.min(maxIterations, Math.max(200, (budgetMs * WORK_PER_MS) / Math.max(1, sim.N)));
  let n = 0;
  while (n < cap && Date.now() - start < budgetMs) {
    if (step(sim, 50) < SETTLED) break;
    n += 50;
  }
  return {
    iterations: n,
    residual: sim.residual,
    settled: sim.residual < SETTLED,
  };
}

export function rodPoints(sim, id) {
  const { off, n } = sim.index.get(id);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const g = 3 * (off + i);
    pts.push([sim.X[g], sim.X[g + 1], sim.X[g + 2]]);
  }
  return pts;
}

/** Stress per segment (MPa and utilisation of the bending strength), the part
 * of it added since each rod was placed (MPa), per rod summaries, and joint
 * forces. Bending stress comes from the curvature at each node, axial stress
 * from the segment force. */
export function analyze(sim) {
  const { X, tri, tri0, seg, segN, jointF, rodP } = sim;
  const kappa = new Float64Array(sim.N);
  const kappaRest = new Float64Array(sim.N);
  for (let t = 0, q = 0; t < tri.length; t += 4, q += 3) {
    const a = 3 * tri[t];
    const b = 3 * tri[t + 1];
    const c = 3 * tri[t + 2];
    const ux = X[b] - X[a];
    const uy = X[b + 1] - X[a + 1];
    const uz = X[b + 2] - X[a + 2];
    const vx = X[c] - X[b];
    const vy = X[c + 1] - X[b + 1];
    const vz = X[c + 2] - X[b + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const angle = Math.atan2(
      Math.hypot(cx, cy, cz),
      ux * vx + uy * vy + uz * vz,
    );
    const l = 0.5 * (Math.hypot(ux, uy, uz) + Math.hypot(vx, vy, vz));
    kappa[tri[t + 1]] = angle / Math.max(l, 1e-6);
    kappaRest[tri[t + 1]] = Math.hypot(tri0[q], tri0[q + 1], tri0[q + 2]) / Math.max(l * l, 1e-9);
  }
  // Curvature each rod had when it was placed (rod.k0, 1/1000 m), so the
  // stress added by later loads can be told apart from bending it into shape.
  const kappa0 = new Float64Array(sim.N).fill(NaN);
  for (const r of sim.rods) {
    if (!r.k0) continue;
    const { off, n } = sim.index.get(r.id);
    for (let i = 0; i < n && i < r.k0.length; i++) kappa0[off + i] = r.k0[i] / 1000;
  }
  const segStress = new Float64Array(segN.length);
  const segUtil = new Float64Array(segN.length);
  const segLoad = new Float64Array(segN.length);
  const rodMax = new Float64Array(sim.rods.length);
  const rodStress = new Float64Array(sim.rods.length);
  const rodLoad = new Float64Array(sim.rods.length);
  for (let s = 0, k = 0; s < seg.length; s += 4, k++) {
    const a = seg[s];
    const b = seg[s + 1];
    const r = sim.nodeRod[a];
    const P = rodP[r];
    const axial = Math.abs(segN[k]) / P.A;
    // forming: bending each rod from its rest shape to how it was placed;
    // load: everything since, carried by the whole bundle.
    const base = (i) => (Number.isNaN(kappa0[i]) ? kappa[i] : kappa0[i]);
    const form = (i) => Math.abs(base(i) - kappaRest[i]);
    const dk = (i) => Math.abs(kappa[i] - base(i));
    const load = axial + P.E * P.c * Math.max(dk(a), dk(b));
    const sigma = load + P.E * P.c1 * Math.max(form(a), form(b));
    segStress[k] = sigma / 1e6;
    segUtil[k] = sigma / P.fb;
    segLoad[k] = load / 1e6;
    if (segUtil[k] > rodMax[r]) {
      rodMax[r] = segUtil[k];
      rodStress[r] = segStress[k];
    }
    if (segLoad[k] > rodLoad[r]) rodLoad[r] = segLoad[k];
  }
  return { kappa, segStress, segUtil, segLoad, rodMax, rodStress, rodLoad, jointF };
}
