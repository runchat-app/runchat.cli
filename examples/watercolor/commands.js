// The watercolour painter's API, shared by its UI and by agents. The sheet is
// normalised: x and y run 0–1 (y down). Widths are pixels on a 1200 × 900 sheet.
import {
  MAX_STROKES,
  PIGMENTS,
  cleanStrokes,
  describeStrokes,
  resolveColor,
  round3,
} from "./src/paint.js";

const point = { type: "array", items: { type: "number" } };
const color = {
  type: "string",
  description: `Hex colour or a pigment: ${Object.keys(PIGMENTS).join(", ")}.`,
};
const wetness = {
  type: "number",
  description: "0 (dry, crisp) to 1 (wet, blooming). Default 0.5.",
};
const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const append = (strokes) => ({
  ops: [{ op: "append", key: "strokes", items: strokes, max: MAX_STROKES }],
  result: { added: strokes.length },
});

export const commands = {
  paint: {
    description:
      "Paint brush strokes. Each stroke is a polyline of normalised [x, y] points (0–1, y down) with a colour, width in sheet pixels (default 18) and wetness. Paint light to dark: lay washes first, then shapes, then details.",
    input: {
      type: "object",
      properties: {
        strokes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              points: { type: "array", items: point },
              color,
              width: { type: "number" },
              wetness,
              label: {
                type: "string",
                description: "What this stroke depicts.",
              },
            },
            required: ["points"],
          },
        },
      },
      required: ["strokes"],
    },
    run({ strokes }) {
      return append(cleanStrokes(strokes, newId()));
    },
  },
  wash: {
    description:
      "Lay a flat wash over a polygon of normalised [x, y] points (at least 3). Use for skies, grounds and large shadow shapes.",
    input: {
      type: "object",
      properties: {
        polygon: { type: "array", items: point },
        color,
        wetness,
        label: { type: "string" },
      },
      required: ["polygon"],
    },
    run({ polygon, color, wetness = 0.7, label }) {
      return append(
        cleanStrokes(
          [{ kind: "wash", points: polygon, color, wetness, label }],
          newId(),
        ),
      );
    },
  },
  project_points: {
    description:
      "Paint 3D points (metres, Z up) from another app as dabs, fitted onto the sheet in plan (x, y) or elevation (x, z). Returns how the points were fitted.",
    input: {
      type: "object",
      properties: {
        points: {
          type: "array",
          items: {
            anyOf: [
              point,
              {
                type: "object",
                properties: { p: point, color: { type: "string" } },
              },
            ],
          },
        },
        view: { type: "string", enum: ["plan", "elevation"] },
        color,
        size: { type: "number", description: "Dab width in sheet pixels." },
        margin: {
          type: "number",
          description: "Sheet margin, 0–0.4 (default 0.12).",
        },
      },
      required: ["points"],
    },
    run({ points, view = "elevation", color, size = 24, margin = 0.12 }) {
      const items = points.map((p) =>
        Array.isArray(p) ? { p, color } : { p: p.p, color: color ?? p.color },
      );
      const axes = view === "plan" ? [0, 1] : [0, 2];
      const xs = items.map((i) => i.p[axes[0]]);
      const ys = items.map((i) => i.p[axes[1]]);
      const [x0, x1, y0, y1] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
      ];
      const span = Math.max(x1 - x0, (y1 - y0) * (4 / 3), 1e-6);
      const fit = 1 - 2 * margin;
      const toSheet = (x, y) => [
        round3(margin + ((x - x0) / span) * fit),
        round3(
          view === "plan"
            ? margin + ((y1 - y) / span) * fit * (4 / 3)
            : 1 - margin - ((y - y0) / span) * fit * (4 / 3),
        ),
      ];
      const strokes = items.map((i) => ({
        points: [toSheet(i.p[axes[0]], i.p[axes[1]])],
        color: i.color ?? "payne's grey",
        width: size,
        wetness: 0.4,
      }));
      return {
        ...append(cleanStrokes(strokes, newId())),
        result: {
          added: strokes.length,
          view,
          metres_per_sheet_width: +(span / fit).toFixed(3),
        },
      };
    },
  },
  undo: {
    description: "Remove the last n strokes (default 1).",
    input: { type: "object", properties: { n: { type: "number" } } },
    run({ n = 1 }, { state }) {
      const strokes = state.strokes ?? [];
      return {
        ops: [
          {
            op: "set",
            key: "strokes",
            value: strokes.slice(0, Math.max(0, strokes.length - n)),
          },
        ],
        result: { removed: Math.min(n, strokes.length) },
      };
    },
  },
  clear: {
    description: "Start a fresh sheet.",
    run() {
      return [{ op: "delete", key: "strokes" }];
    },
  },
  set_paper: {
    description: "Set the paper colour (default warm white #f7f1e3).",
    input: { type: "object", properties: { color }, required: ["color"] },
    run({ color }) {
      return { set: { paper: resolveColor(color) } };
    },
  },
  describe: {
    description:
      "Summarise the painting: stroke and wash counts, colours, painted area and stroke labels.",
    run(_args, { state }) {
      return { result: describeStrokes(state.strokes ?? []) };
    },
  },
  export_strokes: {
    description:
      "The last limit strokes (default 100) with their points, for copying into another app.",
    input: { type: "object", properties: { limit: { type: "number" } } },
    run({ limit = 100 }, { state }) {
      return { result: (state.strokes ?? []).slice(-limit) };
    },
  },
};
