// Generates add_rods payloads for floating basket volumes.
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const len = (a) => Math.hypot(...a);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r3 = (p) => p.map((v) => Math.round(v * 1000) / 1000);

// Samples f(t) densely and keeps a stretch of arc length L starting at s0.
function cut(f, t0, t1, L, s0 = 0, n = 800) {
  const pts = [];
  let s = 0;
  let prev = f(t0);
  for (let k = 1; k <= n; k++) {
    const p = f(t0 + ((t1 - t0) * k) / n);
    s += len(sub(p, prev));
    if (s >= s0 && s <= s0 + L) pts.push(p);
    prev = p;
  }
  const out = [];
  let acc = Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i && (acc += len(sub(pts[i], pts[i - 1]))) < 0.25 && i < pts.length - 1) continue;
    out.push(r3(pts[i]));
    acc = 0;
  }
  return out;
}
const lift = (pts) => pts.map((p) => [p[0], p[1], Math.max(0.15, p[2])]);

function randomUnit(r) {
  const th = r() * 2 * Math.PI;
  const z = 2 * r() - 1;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(th), s * Math.sin(th), z];
}
function basis(n) {
  const a = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(n, a));
  return [u, cross(n, u)];
}

// A leg from a ground point curving up to a target in the weave.
function leg(ground, target, bulge = 0.6) {
  const mid = add(mul(add(ground, target), 0.5), mul(norm(sub([ground[0], ground[1], 0], [target[0], target[1], 0])), bulge));
  mid[2] = target[2] * 0.6;
  const f = (t) => add(add(mul(ground, (1 - t) ** 2), mul(mid, 2 * t * (1 - t))), mul(target, t * t));
  return { kind: "leg", points: cut(f, 0, 1, 99) };
}
function legsUnder(centre, spread, attachZ, count, r, attachR) {
  return Array.from({ length: count }, (_, k) => {
    const a = (2 * Math.PI * k) / count + r() * 0.4;
    const d = [Math.cos(a), Math.sin(a), 0];
    return leg(add([centre[0], centre[1], 0], mul(d, spread)), add([centre[0], centre[1], attachZ], mul(d, attachR)));
  });
}

// An arch from ground to ground whose crown passes through the underside of a
// volume, so the weave rests and is lashed on it.
function cradle(centre, angle, span, crownZ, sag = 0) {
  const d = [Math.cos(angle), Math.sin(angle), 0];
  const a = add([centre[0], centre[1], 0], mul(d, -span / 2));
  const b = add([centre[0], centre[1], 0], mul(d, span / 2));
  const f = (t) => {
    const p = add(a, mul(sub(b, a), t));
    const u = 2 * t - 1;
    p[2] = crownZ * (1 - u * u) * (1 + sag * u * u);
    return p;
  };
  return { kind: "cradle", points: cut(f, 0, 1, 99) };
}
const cradles = (centre, count, span, crownZ, offset = 0) =>
  Array.from({ length: count }, (_, k) => cradle(centre, offset + (Math.PI * k) / count, span, crownZ, 0.25));

export function cocoon(seed = 1) {
  const r = rng(seed);
  const c = [0, 0, 3.1];
  const R = [2.3, 1.7, 1.5];
  const rods = [];
  for (let k = 0; k < 34; k++) {
    const [u, v] = basis(randomUnit(r));
    const f = (t) => add(c, [0, 1, 2].map((i) => R[i] * (u[i] * Math.cos(t) + v[i] * Math.sin(t))));
    rods.push({ kind: "shell", points: lift(cut(f, 0, 4 * Math.PI, 7 + 1.5 * r(), r() * 4)) });
  }
  rods.push(...cradles(c, 4, 5.6, 2.05, 0.3));
  return rods;
}

function spineFrame(spine, s, h = 1e-3) {
  const t = norm(sub(spine(s + h), spine(s - h)));
  const n = norm(cross(t, [0, 0, 1]));
  return [t, n, cross(t, n)];
}
function helices(spine, radius, count, angleDeg, L, r, s0 = 0, s1 = 1, rooted = false) {
  const rods = [];
  const tanA = Math.tan((angleDeg * Math.PI) / 180);
  // spine length for converting arc length to parameter
  let SL = 0;
  for (let k = 1; k <= 200; k++) SL += len(sub(spine(s0 + ((s1 - s0) * k) / 200), spine(s0 + ((s1 - s0) * (k - 1)) / 200)));
  for (let k = 0; k < count; k++) {
    const hand = k % 2 ? 1 : -1;
    const phase = r() * 2 * Math.PI;
    const start = rooted && k % 2 === 0 ? s0 : s0 + r() * (s1 - s0) * 0.6;
    const f = (s) => {
      const [, n, b] = spineFrame(spine, s);
      const rad = radius(s);
      const th = phase + hand * ((s - s0) * SL * tanA) / rad;
      return add(spine(s), add(mul(n, rad * Math.cos(th)), mul(b, rad * Math.sin(th))));
    };
    const pts = lift(cut(f, start, s1, L + r() * 1.5));
    if (rooted && start === s0) pts[0] = [pts[0][0], pts[0][1], 0];
    rods.push({ kind: "tube", points: pts });
  }
  return rods;
}

// Hoops around a spine: the third direction that stops a helical lattice
// scissoring like a finger trap.
function rings(spine, radius, stations) {
  return stations.map((s) => {
    const [, n, b] = spineFrame(spine, s);
    const p = spine(s);
    const rad = radius(s);
    const N = Math.max(12, Math.round((2 * Math.PI * rad) / 0.25));
    const pts = Array.from({ length: N }, (_, i) => {
      const t = (2 * Math.PI * i) / N;
      return r3(add(p, add(mul(n, rad * Math.cos(t)), mul(b, rad * Math.sin(t)))));
    });
    return { kind: "ring", closed: true, points: lift(pts) };
  });
}

export function tube(seed = 2) {
  const r = rng(seed);
  const spine = (s) => [-4.5 + 9 * s, 1.6 * Math.sin(s * Math.PI * 1.3), 3.0 + 0.6 * Math.sin(s * Math.PI * 2.1)];
  const radius = (s) => 0.85 + 0.45 * Math.sin(s * Math.PI);
  const rods = [...rings(spine, radius, [0.04, 0.17, 0.3, 0.43, 0.57, 0.7, 0.83, 0.96]), ...helices(spine, radius, 40, 38, 7, r)];
  for (const s of [0.1, 0.32, 0.55, 0.78, 0.95]) {
    const p = spine(s);
    const [, n] = spineFrame(spine, s);
    rods.push(cradle(p, Math.atan2(n[1], n[0]) + (s - 0.5) * 0.8, 4.6, p[2] - radius(s) * 0.55));
  }
  return rods;
}

export function cells(seed = 3) {
  const r = rng(seed);
  const cellsAt = [
    [[-1.4, 0, 2.6], 1.35],
    [[0.9, 0.6, 2.9], 1.35],
    [[0.2, -1.4, 2.2], 1.25],
    [[-0.2, 0.9, 4.0], 1.2],
    [[1.9, -0.9, 3.9], 1.1],
  ];
  const rods = [];
  for (const [c, R] of cellsAt)
    for (let k = 0; k < 7; k++) {
      const [u, v] = basis(randomUnit(r));
      const N = 40;
      const pts = Array.from({ length: N }, (_, i) => {
        const t = (2 * Math.PI * i) / N;
        return r3(add(c, add(mul(u, R * Math.cos(t)), mul(v, R * Math.sin(t)))));
      });
      rods.push({ kind: "cell", closed: true, points: lift(pts) });
    }
  rods.push(...cradles([0, -0.1, 0], 3, 5.8, 1.75, 0.2));
  rods.push(...cradles([0.4, 0, 0], 2, 4.2, 2.6, 0.9));
  return rods;
}

export function nest(seed = 4) {
  const r = rng(seed);
  const c = [0, 0, 3.0];
  const R = [2.3, 1.8, 1.7];
  const rods = [];
  for (let k = 0; k < 56; k++) {
    // a small circle on the unit sphere (cap angle al around axis w), scaled to the egg
    const w = randomUnit(r);
    const [u, v] = basis(w);
    const al = 0.55 + 0.45 * r();
    const f = (t) => {
      const q = add(mul(w, Math.cos(al)), mul(add(mul(u, Math.cos(t)), mul(v, Math.sin(t))), Math.sin(al)));
      const egg = q[2] < 0 ? 1 : 1 - 0.18 * q[2];
      return add(c, [0, 1, 2].map((i) => R[i] * q[i] * (i < 2 ? egg : 1)));
    };
    rods.push({ kind: "nest", points: lift(cut(f, 0, 2 * Math.PI * 1.15, 5.5 + 3 * r(), r() * 2)) });
  }
  rods.push(...cradles(c, 4, 5.6, c[2] - R[2] + 0.12, 0.2));
  return rods;
}

export function branches(seed = 5) {
  const r = rng(seed);
  const bez = (a, b, c, d) => (s) => [0, 1, 2].map((i) => (1 - s) ** 3 * a[i] + 3 * (1 - s) ** 2 * s * b[i] + 3 * (1 - s) * s * s * c[i] + s ** 3 * d[i]);
  const trunk = bez([0, 0, 0], [0.45, 0, 1.4], [0.1, 0, 2.6], [0, 0, 3.4]);
  const left = bez([0, 0, 3.1], [-0.8, 0.3, 4.4], [-2.8, 0.8, 4.8], [-4.4, 0.5, 3.6]);
  const right = bez([0, 0, 3.1], [0.9, -0.3, 4.2], [3.0, -1.0, 5.2], [4.6, -1.3, 4.2]);
  const trunkR = (s) => 1.15 - 0.2 * s;
  const armR = (s) => 0.95 - 0.25 * s;
  const rods = [
    ...rings(trunk, trunkR, [0.25, 0.55, 0.85]),
    ...rings(left, armR, [0.3, 0.6, 0.88]),
    ...rings(right, armR, [0.3, 0.6, 0.88]),
    ...helices(trunk, trunkR, 18, 26, 7, r, 0, 1, true),
    ...helices(left, armR, 14, 30, 7, r),
    ...helices(right, armR, 14, 30, 7, r),
  ];
  for (const [p, a] of [
    [left(0.7), 0.4],
    [right(0.75), -0.5],
  ])
    rods.push(cradle(p, a + Math.PI / 2, 5, p[2] - 0.6));
  return rods;
}

export function torus(seed = 6) {
  const r = rng(seed);
  const c = [0, 0, 2.9];
  const Rmaj = 2.4;
  const Rmin = 0.75;
  const tilt = 0.32;
  const rot = (p) => [p[0], p[1] * Math.cos(tilt) - p[2] * Math.sin(tilt), p[1] * Math.sin(tilt) + p[2] * Math.cos(tilt)];
  const rods = [];
  for (let k = 0; k < 40; k++) {
    const hand = k % 2 ? 1 : -1;
    const wind = hand * (0.6 + r() * 0.6);
    const ph = r() * 2 * Math.PI;
    const f = (t) => {
      const ph2 = ph + wind * t;
      const rr = Rmaj + Rmin * Math.cos(ph2);
      return add(c, rot([rr * Math.cos(t), rr * Math.sin(t), Rmin * Math.sin(ph2)]));
    };
    rods.push({ kind: "torus", points: lift(cut(f, 0, 2 * Math.PI, 7 + 1.5 * r(), r() * 6)) });
  }
  for (let k = 0; k < 12; k++) {
    const t = (2 * Math.PI * k) / 12;
    const N = 20;
    const pts = Array.from({ length: N }, (_, i) => {
      const ph = (2 * Math.PI * i) / N;
      const rr = Rmaj + Rmin * Math.cos(ph);
      return r3(add(c, rot([rr * Math.cos(t), rr * Math.sin(t), Rmin * Math.sin(ph)])));
    });
    rods.push({ kind: "ring", closed: true, points: lift(pts) });
  }
  for (let k = 0; k < 5; k++) {
    const a = (2 * Math.PI * k) / 5 + 0.4;
    const t = add(c, rot([Rmaj * Math.cos(a), Rmaj * Math.sin(a), -Rmin * 0.6]));
    rods.push(cradle(t, a + Math.PI / 2, 4.2, t[2]));
  }
  return rods;
}

// The nest weave on a cage of steam-bent ribs that run from the ground, over
// the egg and back down, so the shape is held and carried straight to ground.
export function ribbedNest(seed = 4) {
  const rods = nest(seed).filter((r) => r.kind !== "cradle");
  const c = [0, 0, 3.0];
  const R = [2.3, 1.8, 1.7];
  const egg = (q) => {
    const e = q[2] < 0 ? 1 : 1 - 0.18 * q[2];
    return add(c, [0, 1, 2].map((i) => R[i] * q[i] * (i < 2 ? e : 1)));
  };
  for (let k = 0; k < 4; k++) {
    const a = 0.3 + (Math.PI * k) / 4;
    const d = [Math.cos(a), Math.sin(a)];
    const f = (t) => egg([d[0] * Math.sin(t), d[1] * Math.sin(t), Math.cos(t)]);
    const arc = cut(f, -2.0, 2.0, 99);
    const foot = (p) => [p[0] * 1.35, p[1] * 1.35, 0];
    const legPts = (from, to) => Array.from({ length: 6 }, (_, i) => r3(add(from, mul(sub(to, from), i / 5))));
    rods.push({
      kind: "rib",
      points: [...legPts(foot(arc[0]), arc[0]).slice(0, -1), ...arc, ...legPts(arc[arc.length - 1], foot(arc[arc.length - 1])).slice(1)],
    });
  }
  for (const z of [-0.3, 0.35]) {
    const k = Math.sqrt(1 - z * z);
    const ring = (t) => egg([Math.cos(t) * k, Math.sin(t) * k, z]);
    rods.push({ kind: "rib", points: cut(ring, 0, Math.PI * 1.04, 99) }, { kind: "rib", points: cut(ring, Math.PI, 2.04 * Math.PI, 99) });
  }
  return rods;
}

export const DESIGNS = { cocoon, tube, cells, nest, ribbedNest, branches, torus };

// Rods longer than stock get split into consecutive pieces (lashed at the overlap by auto-join).
export function stock(rods, max = 8.8) {
  const out = [];
  for (const rod of rods) {
    if (rod.closed) {
      out.push(rod);
      continue;
    }
    let piece = [rod.points[0]];
    let s = 0;
    for (let i = 1; i < rod.points.length; i++) {
      s += len(sub(rod.points[i], rod.points[i - 1]));
      piece.push(rod.points[i]);
      if (s > max - 0.3 && i < rod.points.length - 2) {
        out.push({ ...rod, points: piece });
        piece = rod.points.slice(Math.max(0, i - 2), i + 1);
        s = len(sub(piece[piece.length - 1], piece[0]));
      }
    }
    if (piece.length > 1) out.push({ ...rod, points: piece });
  }
  return out;
}

export const JOIN = { nest: { join_radius: 0.35 }, ribbedNest: { join_radius: 0.4 } };

// Primary structure in steam-bent bundles, rings in rod, the basket in rattan.
export const PROFILE_BY_KIND = {
  cradle: { profile: "primary", bundle: 2 },
  rib: { profile: "primary" },
  ring: { profile: "rod" },
  default: { profile: "weave" },
};
export const withProfiles = (rods) =>
  rods.map((r) => ({ ...r, ...(PROFILE_BY_KIND[r.kind] ?? PROFILE_BY_KIND.default) }));
