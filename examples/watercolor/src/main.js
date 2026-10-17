// Watercolour painter UI. Renders the shared strokes and appends the strokes
// a person paints, so people and agents work on one sheet.
import { PIGMENTS, SHEET, cleanStrokes, paintStroke, rng } from "./paint.js";

const canvas = document.getElementById("sheet");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
let strokes = [];
let paper = "#f7f1e3";
let color = PIGMENTS.ultramarine;
let width = 18;
let drawn = 0;
let scale = 1;
let grain = null;

function makeGrain() {
  const g = document.createElement("canvas");
  g.width = SHEET.width;
  g.height = SHEET.height;
  const gc = g.getContext("2d");
  const image = gc.createImageData(g.width, g.height);
  const rand = rng(7);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 235 + rand() * 20;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  gc.putImageData(image, 0, 0);
  return g;
}

function fit() {
  const box = canvas.parentElement.getBoundingClientRect();
  scale = Math.max(0.05, Math.min((box.width - 20) / SHEET.width, (box.height - 20) / SHEET.height));
  canvas.width = Math.round(SHEET.width * scale * devicePixelRatio);
  canvas.height = Math.round(SHEET.height * scale * devicePixelRatio);
  canvas.style.width = `${SHEET.width * scale}px`;
  canvas.style.height = `${SHEET.height * scale}px`;
  redraw();
}

function redraw() {
  const s = scale * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  grain ??= makeGrain();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(grain, 0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) paintStroke(ctx, stroke, s);
  drawn = strokes.length;
}

runchat.state.subscribe((state) => {
  const next = state.strokes ?? [];
  const nextPaper = state.paper ?? "#f7f1e3";
  const appended =
    nextPaper === paper &&
    next.length > drawn &&
    next[drawn - 1]?.id === strokes[drawn - 1]?.id;
  strokes = next;
  if (appended) {
    for (const stroke of next.slice(drawn))
      paintStroke(ctx, stroke, scale * devicePixelRatio);
    drawn = next.length;
  } else {
    paper = nextPaper;
    redraw();
  }
  statusEl.textContent = `${strokes.length} strokes`;
});

const palette = document.getElementById("palette");
for (const [name, hex] of Object.entries(PIGMENTS)) {
  const b = document.createElement("button");
  b.title = name;
  b.style.background = hex;
  b.className = hex === color ? "on" : "";
  b.onclick = () => {
    color = hex;
    for (const el of palette.children) el.className = el === b ? "on" : "";
  };
  palette.appendChild(b);
}
document.getElementById("width").oninput = (e) =>
  (width = Number(e.target.value));
document.getElementById("undo").onclick = () =>
  runchat.command("undo", { n: 1 });

let current = null;
const toSheet = (e) => {
  const box = canvas.getBoundingClientRect();
  return [
    (e.clientX - box.left) / box.width,
    (e.clientY - box.top) / box.height,
  ];
};
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  current = [toSheet(e)];
});
canvas.addEventListener("pointermove", (e) => {
  if (!current) return;
  const p = toSheet(e);
  const last = current[current.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.006) current.push(p);
});
canvas.addEventListener("pointerup", () => {
  if (!current) return;
  const [stroke] = cleanStrokes(
    [{ points: current.slice(0, 400), color, width, wetness: 0.55 }],
    `ui-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  );
  current = null;
  runchat.state.apply([
    { op: "append", key: "strokes", items: [stroke], max: 1500 },
  ]);
});

new ResizeObserver(fit).observe(canvas.parentElement);
