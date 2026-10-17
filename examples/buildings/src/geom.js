// Mesh builders for Runchat app commands. Metres, Z up, written into a part
// { vertices, faces, colors?, uvs? } that a command returns in `meshes`.
// Faces are split per side so flat surfaces shade crisply; UVs are in metres
// divided by a material's tile size, so textures tile at real scale.

export function part() {
  return { vertices: [], faces: [], colors: [], uvs: [] };
}

const round = (v) => Math.round(v * 1000) / 1000;

function push(p, v, uv, color) {
  p.vertices.push(round(v[0]), round(v[1]), round(v[2]));
  if (uv) p.uvs.push(round(uv[0] * 1000) / 1000, round(uv[1] * 1000) / 1000);
  if (color) p.colors.push(color);
  return p.vertices.length / 3 - 1;
}

/** A quad (4 points, counter-clockwise seen from outside) as two triangles. */
export function quad(p, pts, color, uvs) {
  const ids = pts.map((v, i) => push(p, v, uvs?.[i], color));
  p.faces.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
}

export function tri(p, pts, color, uvs) {
  const ids = pts.map((v, i) => push(p, v, uvs?.[i], color));
  p.faces.push(ids[0], ids[1], ids[2]);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vec = {
  sub,
  dot,
  cross,
  len,
  norm,
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
};

/** UVs for points on a flat face: u along `axis` (horizontal), v up, in tiles. */
export function faceUV(pts, origin, axis, tile) {
  return pts.map((q) => {
    const d = sub(q, origin);
    return [dot(d, axis) / tile, -q[2] / tile];
  });
}

/** A textured quad on a face: UVs from the face's own horizontal direction. */
export function wall(p, pts, tile, color) {
  const axis = norm(sub(pts[1], pts[0]));
  const flat = Math.abs(axis[2]) > 0.9;
  if (flat) {
    quad(
      p,
      pts,
      color,
      pts.map((q) => [q[0] / tile, q[1] / tile]),
    );
  } else {
    quad(p, pts, color, faceUV(pts, pts[0], axis, tile));
  }
}

function rotate([x, y], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

/** Box centred on (cx, cy) in plan, from z0 to z0 + h, turned by angle (rad). */
export function box(p, { cx, cy, z0, w, d, h, angle = 0, color, tile }) {
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
  const face = (pts) =>
    tile ? wall(p, pts, tile, color) : quad(p, pts, color);
  const flat = (pts) =>
    tile
      ? quad(
          p,
          pts,
          color,
          pts.map((q) => [q[0] / tile, q[1] / tile]),
        )
      : quad(p, pts, color);
  flat([lo[3], lo[2], lo[1], lo[0]]);
  flat([hi[0], hi[1], hi[2], hi[3]]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    face([lo[i], lo[j], hi[j], hi[i]]);
  }
}

/**
 * A tapered tube along a path of [x, y, z, radius] points: branches, trunks,
 * stems. Rings follow the path with parallel-transported frames; UVs wrap
 * around (u) and run along the length (v), in tiles.
 */
export function tube(
  p,
  path,
  { sides = 6, tile = 1, color, capEnd = false } = {},
) {
  if (path.length < 2) return;
  let normal = null;
  let along = 0;
  let prevRing = null;
  for (let i = 0; i < path.length; i++) {
    const at = path[i];
    const next = path[Math.min(path.length - 1, i + 1)];
    const prev = path[Math.max(0, i - 1)];
    const t = norm(sub(next.slice(0, 3), prev.slice(0, 3)));
    if (!normal) {
      normal =
        Math.abs(t[2]) < 0.9
          ? norm(cross(t, [0, 0, 1]))
          : norm(cross(t, [1, 0, 0]));
    } else {
      normal = norm(sub(normal, vec.scale(t, dot(normal, t))));
    }
    const binormal = cross(t, normal);
    if (i > 0) along += len(sub(at.slice(0, 3), path[i - 1].slice(0, 3)));
    const r = at[3];
    const ring = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const dir = vec.add(
        vec.scale(normal, Math.cos(a)),
        vec.scale(binormal, Math.sin(a)),
      );
      ring.push(
        push(
          p,
          vec.add(at.slice(0, 3), vec.scale(dir, r)),
          [
            ((s / sides) *
              Math.max(1, Math.round(((2 * Math.PI * r) / tile) * 2))) /
              2,
            along / tile,
          ],
          color,
        ),
      );
    }
    if (prevRing) {
      for (let s = 0; s < sides; s++) {
        p.faces.push(
          prevRing[s],
          prevRing[s + 1],
          ring[s + 1],
          prevRing[s],
          ring[s + 1],
          ring[s],
        );
      }
    }
    prevRing = ring;
  }
  if (capEnd) {
    const end = path[path.length - 1];
    const tip = push(p, end.slice(0, 3), [0.5, along / tile], color);
    for (let s = 0; s < sides; s++)
      p.faces.push(prevRing[s], prevRing[s + 1], tip);
  }
}

/**
 * Two crossed quads (a "card") carrying one foliage atlas cell, centred on
 * `at`, facing roughly along `dir`, size metres across.
 */
export function card(p, at, dir, up, size, cellUV, color) {
  const [u0, v0, u1, v1] = cellUV;
  const side = norm(cross(dir, up));
  const realUp = norm(cross(side, dir));
  for (const axis of [side, norm(vec.add(side, vec.scale(dir, 1)))]) {
    const h = size / 2;
    const a = vec.add(at, vec.add(vec.scale(axis, -h), vec.scale(realUp, -h)));
    const b = vec.add(at, vec.add(vec.scale(axis, h), vec.scale(realUp, -h)));
    const c = vec.add(at, vec.add(vec.scale(axis, h), vec.scale(realUp, h)));
    const d = vec.add(at, vec.add(vec.scale(axis, -h), vec.scale(realUp, h)));
    quad(p, [a, b, c, d], color, [
      [u0, v1],
      [u1, v1],
      [u1, v0],
      [u0, v0],
    ]);
  }
}

/** Unit icosphere subdivided `level` times: { v: [[x,y,z]], f: [[a,b,c]] }. */
export function icosphere(level = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [
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
  ].map(norm);
  let f = [
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
  for (let l = 0; l < level; l++) {
    const mid = new Map();
    const m = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!mid.has(key)) {
        v.push(norm(vec.scale(vec.add(v[a], v[b]), 0.5)));
        mid.set(key, v.length - 1);
      }
      return mid.get(key);
    };
    f = f.flatMap(([a, b, c]) => {
      const ab = m(a, b);
      const bc = m(b, c);
      const ca = m(c, a);
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  }
  return { v, f };
}

/** Kept for the simpler apps: a lumpy low-poly blob. */
export function blob(
  p,
  { x, y, z, rx, ry = rx, rz, color, rand = Math.random, lump = 0.18 },
) {
  const ico = icosphere(0);
  const jitter = ico.v.map(() => 1 - lump + rand() * lump * 2);
  const at = (i) => [
    x + ico.v[i][0] * rx * jitter[i],
    y + ico.v[i][1] * ry * jitter[i],
    z + ico.v[i][2] * rz * jitter[i],
  ];
  for (const [a, b, c] of ico.f) tri(p, [at(a), at(b), at(c)], color);
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

/** Drop empty lists so parts stay valid; refuse half-filled ones. */
export function finish(p) {
  const n = p.vertices.length / 3;
  if (p.colors.length === 0) delete p.colors;
  else if (p.colors.length !== n)
    throw new Error("part has colours on only some vertices");
  if (p.uvs.length === 0) delete p.uvs;
  else if (p.uvs.length !== n * 2)
    throw new Error("part has UVs on only some vertices");
  return p;
}
