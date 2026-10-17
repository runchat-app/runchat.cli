// Watercolour rendering and stroke maths, shared by the UI and commands.js.
// Coordinates are normalised: x and y run 0–1 across the sheet (y down);
// widths are in sheet pixels on a 1200 × 900 sheet.

export const SHEET = { width: 1200, height: 900 };
export const PIGMENTS = {
  ultramarine: "#2b4c9b",
  "burnt sienna": "#a0522d",
  "quinacridone rose": "#c2366b",
  "hansa yellow": "#f2c230",
  "sap green": "#4f7a28",
  "payne's grey": "#3b4654",
  cerulean: "#3a8fb7",
  "raw umber": "#7a5c3a",
};
export const MAX_STROKES = 1500;

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round3 = (v) => Math.round(v * 1000) / 1000;

export function resolveColor(color) {
  if (!color) return PIGMENTS.ultramarine;
  const named = PIGMENTS[String(color).toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  throw new Error(
    `Unknown colour ${color}. Use a hex colour or one of: ${Object.keys(PIGMENTS).join(", ")}`,
  );
}

/** Validate and normalise strokes from a caller. */
export function cleanStrokes(strokes, idPrefix) {
  return strokes.map((s, i) => {
    const kind = s.kind === "wash" ? "wash" : "stroke";
    const points = (s.points ?? [])
      .filter(
        (p) =>
          Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]),
      )
      .map(([x, y]) => [round3(x), round3(y)]);
    if (points.length < (kind === "wash" ? 3 : 1)) {
      throw new Error(
        `stroke ${i}: a ${kind} needs at least ${kind === "wash" ? 3 : 1} points`,
      );
    }
    if (points.length > 400) throw new Error(`stroke ${i}: at most 400 points`);
    return {
      id: `${idPrefix}-${i}`,
      kind,
      points,
      color: resolveColor(s.color),
      width: Math.max(1, Math.min(200, Number(s.width ?? 18))),
      wetness: Math.max(0, Math.min(1, Number(s.wetness ?? 0.5))),
      ...(s.label ? { label: String(s.label).slice(0, 60) } : {}),
    };
  });
}

function deform(poly, depth, variance, rand) {
  if (depth === 0) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = () => (rand() + rand() + rand() - 1.5) * 0.66;
    out.push(a, [
      (a[0] + b[0]) / 2 + g() * len * variance,
      (a[1] + b[1]) / 2 + g() * len * variance,
    ]);
  }
  return deform(out, depth - 1, variance, rand);
}

function strokeOutline(points, width) {
  if (points.length === 1) {
    const [x, y] = points[0];
    const r = width / 2;
    return Array.from({ length: 10 }, (_, i) => [
      x + Math.cos((i / 10) * Math.PI * 2) * r,
      y + Math.sin((i / 10) * Math.PI * 2) * r,
    ]);
  }
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const n = Math.hypot(nx, ny) || 1;
    const taper = Math.sin(
      Math.PI * Math.min(1, Math.max(0.15, i / (points.length - 1))),
    );
    const w = (width / 2) * (0.55 + 0.45 * taper);
    nx = (nx / n) * w;
    ny = (ny / n) * w;
    left.push([p[0] + nx, p[1] + ny]);
    right.push([p[0] - nx, p[1] - ny]);
  }
  return [...left, ...right.reverse()];
}

/** Paint one stroke or wash as layered, deformed translucent glazes. */
export function paintStroke(ctx, stroke, scale) {
  const rand = rng(hashString(stroke.id));
  const pts = stroke.points.map(([x, y]) => [
    x * SHEET.width,
    y * SHEET.height,
  ]);
  const base = stroke.kind === "wash" ? pts : strokeOutline(pts, stroke.width);
  const shape = deform(base, 2, 0.5 + stroke.wetness * 0.6, rand);
  const layers = stroke.kind === "wash" ? 18 : 10;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = stroke.color;
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < layers; i++) {
    const poly = deform(shape, 2, 0.25 + stroke.wetness * 0.4, rand);
    ctx.globalAlpha = 0.045 + (1 - stroke.wetness) * 0.035;
    ctx.beginPath();
    poly.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  // Pigment pools at the edge as the water dries.
  ctx.globalAlpha = 0.12 * (0.4 + stroke.wetness);
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  shape.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function describeStrokes(strokes) {
  const colors = {};
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const s of strokes) {
    colors[s.color] = (colors[s.color] ?? 0) + 1;
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    strokes: strokes.length,
    washes: strokes.filter((s) => s.kind === "wash").length,
    colors,
    ...(strokes.length && {
      painted_box: { min: [minX, minY], max: [maxX, maxY] },
    }),
    labels: strokes
      .filter((s) => s.label)
      .map((s) => s.label)
      .slice(-40),
  };
}
