// Building designer UI: one building design, built in the page from the same
// code the commands use. Controls edit the shared design directly; "Add to
// scene" places it.
import { createViewer } from "./viewer.js";
import { ROOFS, ROOF_FORMS, WALLS, buildingParts } from "./buildings.js";
import {
  TEMPLATES,
  WINDOW_STYLES,
  normalizeDesign,
  toInternal,
} from "./design.js";
import { materialTextures } from "./textures.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const fill = (el, values, label = (v) => v) => {
  for (const v of values) el.append(new Option(label(v), v));
};
fill($("template"), Object.keys(TEMPLATES), (k) => TEMPLATES[k].name);
fill($("roof"), ROOF_FORMS);
fill($("wall"), Object.keys(WALLS));
fill($("roofMaterial"), Object.keys(ROOFS));
fill($("window"), WINDOW_STYLES);

let design = normalizeDesign(TEMPLATES.cabin);
let assets = {};
let shown = "";
let busy = false;

const local = new Map();
function resolve(id) {
  if (assets[id]) return assets[id];
  if (!local.has(id)) {
    const name = id.replace(/-n-v\d+$|-v\d+$/, "");
    const made = materialTextures([name]).then((list) => {
      for (const t of list)
        if (t.id !== id)
          local.set(t.id, Promise.resolve(`data:image/png;base64,${t.png}`));
      const own = list.find((t) => t.id === id);
      return own ? `data:image/png;base64,${own.png}` : null;
    });
    local.set(id, made);
  }
  return local.get(id);
}

const viewer = createViewer($("view"));

function render(reframe = false) {
  const key = JSON.stringify(design);
  if (key === shown && !reframe) return;
  shown = key;
  statusEl.textContent = `${design.name} · ${design.width}×${design.depth} m · ${design.floors} floor${design.floors > 1 ? "s" : ""}`;
  const template = Object.keys(TEMPLATES).find((k) => TEMPLATES[k].name === design.name);
  if (template) $("template").value = template;
  viewer.showMeshes(
    [{ parts: buildingParts(toInternal(design), 0.6) }],
    resolve,
    { reframe },
  );
  for (const [id, key] of [
    ["roof", "roof"],
    ["wall", "wall"],
    ["roofMaterial", "roof_material"],
    ["window", "window"],
    ["width", "width"],
    ["depth", "depth"],
    ["floors", "floors"],
    ["pitch", "roof_pitch"],
  ])
    $(id).value = design[key];
  $("balcony").checked = design.balcony;
}

function edit(params) {
  design = normalizeDesign({ ...design, ...params });
  render();
  runchat.state.apply([{ op: "set", key: "design", value: design }]);
}

async function run(command, args) {
  if (busy) return;
  busy = true;
  statusEl.textContent = `${command}…`;
  try {
    const r = await runchat.command(command, args);
    statusEl.textContent =
      r.result?.id != null
        ? `placed #${r.result.id} · ${r.result.total} in the scene`
        : "done";
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    busy = false;
  }
}

runchat.state.subscribe((state) => {
  assets = state._assets ?? {};
  if (state.design) {
    const next = normalizeDesign(state.design);
    if (JSON.stringify(next) !== JSON.stringify(design)) design = next;
  }
  render();
});

$("template").onchange = (e) => {
  edit(TEMPLATES[e.target.value]);
  render(true);
};
$("roof").onchange = (e) => edit({ roof: e.target.value });
$("wall").onchange = (e) => edit({ wall: e.target.value });
$("roofMaterial").onchange = (e) => edit({ roof_material: e.target.value });
$("window").onchange = (e) => edit({ window: e.target.value });
for (const [id, key] of [
  ["width", "width"],
  ["depth", "depth"],
  ["floors", "floors"],
  ["pitch", "roof_pitch"],
])
  $(id).onchange = (e) => edit({ [key]: Number(e.target.value) });
$("balcony").onchange = (e) => edit({ balcony: e.target.checked });
$("save").onclick = () => run("save_design", {});
$("add").onclick = () =>
  run("add_to_scene", {
    at: [Number($("x").value), Number($("y").value)],
    rotation: Number($("rot").value),
  });
$("frame").onclick = () => render(true);
render(true);
