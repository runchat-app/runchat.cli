// Pure voxel maths shared by the UI and commands.js. Cells are integer
// [x, y, z] with Z up; the model is a map "x,y,z" → "#rrggbb".

export const DEFAULT_SIZE = 0.5;
export const PALETTE = [
  "#c8553d",
  "#2f6690",
  "#f2a541",
  "#3a7d44",
  "#7d5ba6",
  "#d9d4c7",
  "#3d3a36",
];
const MAX_VOXELS = 12000;

export const cellKey = ([x, y, z]) =>
  `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
export const parseKey = (key) => key.split(",").map(Number);

export function withCells(voxels, cells, color) {
  const next = { ...(voxels ?? {}) };
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length < 3) continue;
    next[cellKey(cell)] = color;
  }
  if (Object.keys(next).length > MAX_VOXELS)
    throw new Error(`A model holds at most ${MAX_VOXELS} voxels.`);
  return next;
}

export function withoutCells(voxels, cells) {
  const next = { ...(voxels ?? {}) };
  for (const cell of cells) delete next[cellKey(cell)];
  return next;
}

export function boxCells(min, max, hollow = false) {
  const lo = min.map((v, i) => Math.round(Math.min(v, max[i])));
  const hi = min.map((v, i) => Math.round(Math.max(v, max[i])));
  const count = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
  if (count > MAX_VOXELS * 4)
    throw new Error(
      `That box spans ${count} cells; keep it under ${MAX_VOXELS}.`,
    );
  const cells = [];
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) {
        const edge =
          x === lo[0] ||
          x === hi[0] ||
          y === lo[1] ||
          y === hi[1] ||
          z === lo[2] ||
          z === hi[2];
        if (!hollow || edge) cells.push([x, y, z]);
      }
  return cells;
}

export function describe(voxels, size) {
  const keys = Object.keys(voxels ?? {});
  if (keys.length === 0) return { count: 0, voxel_size_m: size };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const colors = {};
  for (const key of keys) {
    const c = parseKey(key);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], c[i]);
      hi[i] = Math.max(hi[i], c[i]);
    }
    colors[voxels[key]] = (colors[voxels[key]] ?? 0) + 1;
  }
  return {
    count: keys.length,
    voxel_size_m: size,
    min_cell: lo,
    max_cell: hi,
    extent_m: hi.map((v, i) => +((v - lo[i] + 1) * size).toFixed(3)),
    colors,
  };
}
