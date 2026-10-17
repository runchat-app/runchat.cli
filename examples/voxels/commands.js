// The voxel modeller's API, shared by its UI and by agents. Cells are integer
// grid coordinates [x, y, z], Z up; one cell is voxel_size metres.
import {
  PALETTE,
  DEFAULT_SIZE,
  boxCells,
  describe,
  parseKey,
  withCells,
  withoutCells,
} from "./src/voxels.js";

const cells = {
  type: "array",
  items: { type: "array", items: { type: "number" } },
  description: "Integer [x, y, z] cells, Z up.",
};
const vec = { type: "array", items: { type: "number" } };
const color = { type: "string", description: "Hex colour, e.g. #c8553d." };
const sizeOf = (state) => state.voxel_size ?? DEFAULT_SIZE;
const setVoxels = (voxels, result) => ({
  ops: [{ op: "set", key: "voxels", value: voxels }],
  result,
});

export const commands = {
  add_voxels: {
    description:
      "Add voxels at grid cells (replacing the colour of any already there).",
    input: {
      type: "object",
      properties: { cells, color },
      required: ["cells"],
    },
    run({ cells, color = PALETTE[0] }, { state }) {
      const voxels = withCells(state.voxels, cells, color);
      return setVoxels(voxels, { count: Object.keys(voxels).length });
    },
  },
  remove_voxels: {
    description: "Remove voxels at grid cells.",
    input: { type: "object", properties: { cells }, required: ["cells"] },
    run({ cells }, { state }) {
      const voxels = withoutCells(state.voxels, cells);
      return setVoxels(voxels, { count: Object.keys(voxels).length });
    },
  },
  fill_box: {
    description:
      "Fill (or with hollow: true, shell) the box of cells between min and max, inclusive.",
    input: {
      type: "object",
      properties: { min: vec, max: vec, color, hollow: { type: "boolean" } },
      required: ["min", "max"],
    },
    run({ min, max, color = PALETTE[1], hollow = false }, { state }) {
      const voxels = withCells(state.voxels, boxCells(min, max, hollow), color);
      return setVoxels(voxels, { count: Object.keys(voxels).length });
    },
  },
  import_points: {
    description:
      "Voxelise points given in metres (Z up), e.g. from another app's export: each point fills the cell it falls in.",
    input: {
      type: "object",
      properties: {
        points: {
          type: "array",
          items: vec,
          description: "[x, y, z] in metres.",
        },
        color,
        offset: { ...vec, description: "Metres added to every point first." },
      },
      required: ["points"],
    },
    run({ points, color = PALETTE[2], offset = [0, 0, 0] }, { state }) {
      const size = sizeOf(state);
      const found = points.map((p) =>
        p.map((v, i) => Math.floor((v + (offset[i] ?? 0)) / size)),
      );
      const voxels = withCells(state.voxels, found, color);
      return setVoxels(voxels, {
        added_from: points.length,
        count: Object.keys(voxels).length,
      });
    },
  },
  set_voxel_size: {
    description:
      "Set the size of one voxel in metres (default 0.5). Cells keep their grid positions.",
    input: {
      type: "object",
      properties: { size: { type: "number" } },
      required: ["size"],
    },
    run({ size }) {
      if (!(size > 0)) throw new Error("size must be positive");
      return { set: { voxel_size: size }, result: { voxel_size: size } };
    },
  },
  clear: {
    description: "Remove every voxel.",
    run() {
      return [{ op: "delete", key: "voxels" }];
    },
  },
  describe: {
    description:
      "Summarise the model: voxel count, cell bounds, extent in metres and colours used.",
    run(_args, { state }) {
      return { result: describe(state.voxels, sizeOf(state)) };
    },
  },
  export_points: {
    description:
      "Voxel centres in metres (Z up) with colours, for moving the model into another app. At most limit points (default 2000).",
    input: { type: "object", properties: { limit: { type: "number" } } },
    run({ limit = 2000 }, { state }) {
      const size = sizeOf(state);
      const entries = Object.entries(state.voxels ?? {});
      const step = Math.max(1, Math.ceil(entries.length / limit));
      const points = [];
      for (let i = 0; i < entries.length; i += step) {
        const c = parseKey(entries[i][0]);
        points.push({
          p: c.map((v) => +((v + 0.5) * size).toFixed(3)),
          color: entries[i][1],
        });
      }
      return { result: { voxel_size_m: size, total: entries.length, points } };
    },
  },
  get_cells: {
    description:
      "List occupied cells (optionally only one colour), at most limit (default 500).",
    input: { type: "object", properties: { color, limit: { type: "number" } } },
    run({ color, limit = 500 }, { state }) {
      const list = Object.entries(state.voxels ?? {})
        .filter(([, c]) => !color || c === color)
        .slice(0, limit)
        .map(([k, c]) => ({ cell: parseKey(k), color: c }));
      return { result: list };
    },
  },
};
