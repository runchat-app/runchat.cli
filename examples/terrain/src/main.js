// Terrain designer UI: the landscape design, built and textured in the page
// from the same code the commands use. Tools run the same commands an agent
// would; Publish puts the design into the shared scene.
import { createViewer } from "./viewer.js";
import {
  designHash,
  designOf,
  landscapeMeshes,
  landscapeTextures,
} from "./landscape.js";
import { materialTextures } from "./textures.js";

const statusEl = document.getElementById("status");
let tool = "orbit";
let busy = false;
let state = {};
let shown = "";

async function run(command, args) {
  if (busy) return;
  busy = true;
  statusEl.textContent = `${command}…`;
  try {
    const r = await runchat.command(command, args);
    const s = r.result ?? {};
    statusEl.textContent = s.published
      ? "published to the scene"
      : s.lowest_m !== undefined
        ? `${s.lowest_m.toFixed(1)}–${s.highest_m.toFixed(1)} m · not yet in the scene`
        : "done";
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    busy = false;
  }
}

// Textures: the app's uploads when it has them; otherwise baked here.
const local = new Map();
let current = null;
function resolve(id) {
  if (state._assets?.[id]) return state._assets[id];
  if (!local.has(id)) {
    const make = id.startsWith("terrain-")
      ? landscapeTextures(current.design, current.key, current.terrain, {})
      : materialTextures([id.replace(/-n-v\d+$|-v\d+$/, "")]);
    const made = make.then((list) => {
      for (const t of list)
        if (t.id !== id && !local.has(t.id))
          local.set(t.id, Promise.resolve(`data:image/png;base64,${t.png}`));
      const own = list.find((t) => t.id === id);
      return own ? `data:image/png;base64,${own.png}` : null;
    });
    local.set(id, made);
  }
  return local.get(id);
}

let cliffStart = null;
const viewer = createViewer(document.getElementById("view"), {
  onPick: ([x, y]) => {
    if (tool === "hill")
      run("add_features", {
        features: [{ type: "hill", at: [x, y], radius: 10, height: 5 }],
      });
    if (tool === "valley")
      run("add_features", {
        features: [{ type: "valley", at: [x, y], radius: 10, height: 4 }],
      });
    if (tool === "pad") run("flatten", { at: [x, y], size: [12, 8] });
    if (tool === "rocks")
      run("place_rocks", { center: [x, y], radius: 6, count: 10 });
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

function render() {
  const design = designOf(state);
  const key = JSON.stringify(design);
  if (key === shown) return;
  shown = key;
  const built = landscapeMeshes(design, null);
  current = { design, key: built.key, terrain: built.terrain };
  const published =
    state.published ===
    `${designHash(design.params, design.features)}:${design.rocks.length}`;
  if (!busy)
    statusEl.textContent = published
      ? "in the scene"
      : "design · not yet in the scene";
  viewer.showMeshes(built.meshes, resolve, { ground: false });
}

runchat.state.subscribe((next) => {
  state = next;
  const amp = state.params?.amplitude;
  if (amp != null) document.getElementById("amp").value = amp;
  render();
});

document.getElementById("new").onclick = () =>
  run("generate", { seed: Math.floor(Math.random() * 9999) });
document.getElementById("amp").onchange = (e) =>
  run("generate", { amplitude: Number(e.target.value) });
document.getElementById("water").onclick = () =>
  run("generate", { water_level: -2 });
document.getElementById("publish").onclick = () => run("publish_to_scene", {});
for (const b of document.querySelectorAll("[data-tool]")) {
  b.onclick = () => {
    tool = tool === b.dataset.tool ? "orbit" : b.dataset.tool;
    for (const o of document.querySelectorAll("[data-tool]"))
      o.classList.toggle("on", o.dataset.tool === tool);
  };
}
document.getElementById("frame").onclick = () => viewer.frame();
render();
