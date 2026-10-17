// Terrain UI: the shared scene, with controls that run the same commands an
// agent would.
import { createViewer } from "./viewer.js";

const statusEl = document.getElementById("status");
let tool = "orbit";
let busy = false;

async function run(command, args) {
  if (busy) return;
  busy = true;
  statusEl.textContent = `${command}…`;
  try {
    const r = await runchat.command(command, args);
    const s = r.result ?? {};
    statusEl.textContent =
      s.lowest_m !== undefined
        ? `${s.lowest_m.toFixed(1)}–${s.highest_m.toFixed(1)} m`
        : "done";
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    busy = false;
  }
}

let cliffStart = null;
const viewer = createViewer(document.getElementById("view"), {
  onPick: ([x, y]) => {
    if (tool === "hill") run("add_features", { features: [{ type: "hill", at: [x, y], radius: 10, height: 5 }] });
    if (tool === "valley") run("add_features", { features: [{ type: "valley", at: [x, y], radius: 10, height: 4 }] });
    if (tool === "pad") run("flatten", { at: [x, y], size: [12, 8] });
    if (tool === "rocks") run("place_rocks", { center: [x, y], radius: 6, count: 10 });
    if (tool === "cliff") {
      if (!cliffStart) {
        cliffStart = [x, y];
        statusEl.textContent = "click where the cliff ends";
      } else {
        run("add_cliff", { at: cliffStart, to: [x, y], height: 6 });
        cliffStart = null;
      }
    }
  },
});

runchat.scene.subscribe((objects) => viewer.setObjects(objects));
runchat.state.subscribe((state) => {
  const p = state.params;
  if (p) document.getElementById("amp").value = p.amplitude;
});

document.getElementById("new").onclick = () =>
  run("generate", { seed: Math.floor(Math.random() * 9999) });
document.getElementById("amp").onchange = (e) =>
  run("generate", { amplitude: Number(e.target.value) });
document.getElementById("water").onclick = () =>
  run("generate", { water_level: -2 });
for (const b of document.querySelectorAll("[data-tool]")) {
  b.onclick = () => {
    tool = tool === b.dataset.tool ? "orbit" : b.dataset.tool;
    for (const o of document.querySelectorAll("[data-tool]"))
      o.classList.toggle("on", o.dataset.tool === tool);
  };
}
document.getElementById("frame").onclick = () => viewer.frame();
