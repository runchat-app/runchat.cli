// Tiny mesh builders for Runchat app commands. Everything is metres, Z up,
// written into a part { vertices, faces, colors? } so it can be returned in
// a command's `meshes`. Faces are split per side so flat shading stays crisp.

export function part() {
  return { vertices: [], faces: [], colors: [] };
}

function rotate([x, y], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

/** A quad (4 points, counter-clockwise from outside) as two triangles. */
export function quad(p, pts, color) {
  const base = p.vertices.length / 3;
  for (const v of pts) {
    p.vertices.push(round(v[0]), round(v[1]), round(v[2]));
    if (color) p.colors.push(color);
  }
  p.faces.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function tri(p, pts, color) {
  const base = p.vertices.length / 3;
  for (const v of pts) {
    p.vertices.push(round(v[0]), round(v[1]), round(v[2]));
    if (color) p.colors.push(color);
  }
  p.faces.push(base, base + 1, base + 2);
}

const round = (v) => Math.round(v * 1000) / 1000;

/** Box centred on (cx, cy) in plan, from z0 to z0 + h, turned by angle (rad). */
export function box(p, { cx, cy, z0, w, d, h, angle = 0, color }) {
  const c = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map((q) => {
    const [x, y] = rotate(q, angle);
    return [cx + x, cy + y];
  });
  const lo = c.map(([x, y]) => [x, y, z0]);
  const hi = c.map(([x, y]) => [x, y, z0 + h]);
  quad(p, [lo[3], lo[2], lo[1], lo[0]], color);
  quad(p, [hi[0], hi[1], hi[2], hi[3]], color);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(p, [lo[i], lo[j], hi[j], hi[i]], color);
  }
}

/** Ridged roof over a w × d box top at z0, ridge along the w axis. */
export function gable(
  p,
  { cx, cy, z0, w, d, rise, angle = 0, overhang = 0.3, color },
) {
  const W = w / 2 + overhang;
  const D = d / 2 + overhang;
  const pt = (x, y, z) => {
    const [rx, ry] = rotate([x, y], angle);
    return [cx + rx, cy + ry, z];
  };
  const eave = z0 - overhang * (rise / (d / 2));
  quad(
    p,
    [
      pt(-W, -D, eave),
      pt(W, -D, eave),
      pt(W, 0, z0 + rise),
      pt(-W, 0, z0 + rise),
    ],
    color,
  );
  quad(
    p,
    [
      pt(W, D, eave),
      pt(-W, D, eave),
      pt(-W, 0, z0 + rise),
      pt(W, 0, z0 + rise),
    ],
    color,
  );
  tri(
    p,
    [pt(-w / 2, -d / 2, z0), pt(-w / 2, 0, z0 + rise), pt(-w / 2, d / 2, z0)],
    color,
  );
  tri(
    p,
    [pt(w / 2, d / 2, z0), pt(w / 2, 0, z0 + rise), pt(w / 2, -d / 2, z0)],
    color,
  );
}

/** Mono-pitch roof rising across d. */
export function shed(p, { cx, cy, z0, w, d, rise, angle = 0, color }) {
  const pt = (x, y, z) => {
    const [rx, ry] = rotate([x, y], angle);
    return [cx + rx, cy + ry, z];
  };
  const W = w / 2 + 0.25;
  const D = d / 2 + 0.25;
  quad(
    p,
    [pt(-W, -D, z0), pt(W, -D, z0), pt(W, D, z0 + rise), pt(-W, D, z0 + rise)],
    color,
  );
  quad(
    p,
    [pt(-W, D, z0 + rise), pt(W, D, z0 + rise), pt(W, -D, z0), pt(-W, -D, z0)],
    color,
  );
  tri(
    p,
    [
      pt(-w / 2, -d / 2, z0),
      pt(-w / 2, d / 2, z0 + rise),
      pt(-w / 2, d / 2, z0),
    ],
    color,
  );
  tri(
    p,
    [pt(w / 2, d / 2, z0), pt(w / 2, d / 2, z0 + rise), pt(w / 2, -d / 2, z0)],
    color,
  );
}

/** Tapered cylinder (or cone when r1 = 0) standing at (x, y, z0). */
export function cylinder(
  p,
  { x, y, z0, h, r0, r1 = r0, sides = 7, color, twist = 0 },
) {
  const ring = (r, z) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + twist;
      return [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
    });
  const bottom = ring(r0, z0);
  const top = ring(r1, z0 + h);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    if (r1 === 0) tri(p, [bottom[i], bottom[j], [x, y, z0 + h]], color);
    else quad(p, [bottom[i], bottom[j], top[j], top[i]], color);
  }
}

const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((q) => {
    const l = Math.hypot(...q);
    return q.map((c) => c / l);
  });
  const f = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  return { v, f };
})();

/** A lumpy low-poly blob: canopy, shrub or boulder. */
export function blob(
  p,
  { x, y, z, rx, ry = rx, rz, color, rand = Math.random, lump = 0.18 },
) {
  const jitter = ICO.v.map(() => 1 - lump + rand() * lump * 2);
  const at = (i) => [
    x + ICO.v[i][0] * rx * jitter[i],
    y + ICO.v[i][1] * ry * jitter[i],
    z + ICO.v[i][2] * rz * jitter[i],
  ];
  for (const [a, b, c] of ICO.f) tri(p, [at(a), at(b), at(c)], color);
}

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hex colour nudged lighter or darker by up to amount (0–1). */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amount))));
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => f(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Strip empty colour lists so parts stay valid. */
export function finish(p) {
  if (p.colors.length === 0) delete p.colors;
  return p;
}
