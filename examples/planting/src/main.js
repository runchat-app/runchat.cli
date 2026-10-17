// Plant designer UI: one plant design, grown in the page from the same code
// the commands use. Controls edit the shared design directly, so an agent
// tuning the same design is seen live; "Add to scene" places it.
import { createViewer } from "./viewer.js";
import {
  BARKS,
  CROWNS,
  LEAVES,
  TEMPLATES,
  VARIANTS,
  growPlant,
  mergeDesign,
  normalizeDesign,
} from "./plants.js";
import { FOLIAGE_KINDS, foliageTexture, materialTextures } from "./textures.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const fill = (el, values, label = (v) => v) => {
  for (const v of values) el.append(new Option(label(v), v));
};
fill($("template"), Object.keys(TEMPLATES), (k) => TEMPLATES[k].name);
fill($("crown"), CROWNS);
fill($("leaf"), LEAVES, (k) => k.replace(/_/g, " "));
fill($("bark"), BARKS, (k) => k.replace(/_/g, " "));

let design = normalizeDesign(TEMPLATES.oak);
let assets = {};
let variant = 0;
let shownKey = "";
let busy = false;

const local = new Map();
function resolve(id) {
  if (assets[id]) return assets[id];
  if (!local.has(id)) {
    const name = id.replace(/-n-v\d+$|-v\d+$/, "");
    const made = (
      FOLIAGE_KINDS.includes(name)
        ? foliageTexture(name)
        : materialTextures([name])
    ).then((list) => {
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
  const key = JSON.stringify([design, variant]);
  if (key === shownKey && !reframe) return;
  shownKey = key;
  const parts = growPlant(design, variant);
  const tris = parts.reduce((n, p) => n + p.faces.length / 3, 0);
  statusEl.textContent = `${design.name} · ${design.height[0]}–${design.height[1]} m · ${tris} triangles · variant ${variant + 1}/${VARIANTS}`;
  const template = Object.keys(TEMPLATES).find((k) => TEMPLATES[k].name === design.name);
  if (template) $("template").value = template;
  viewer.showMeshes([{ parts }], resolve, { reframe });
  $("crown").value = design.crown;
  $("leaf").value = design.foliage.kind;
  $("bark").value = design.bark.kind;
  $("height").value = design.height[1];
  $("size").value = design.foliage.size;
  $("density").value = design.foliage.density;
  $("tint").value = design.foliage.tint;
}

/** Write a change to the shared design (instant, no command round trip). */
function edit(params) {
  design = normalizeDesign(mergeDesign(design, params));
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
      r.result?.added != null
        ? `added ${r.result.added} · ${r.result.total} plants in the scene`
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
  variant = 0;
  edit(TEMPLATES[e.target.value]);
  render(true);
};
$("crown").onchange = (e) => edit({ crown: e.target.value });
$("leaf").onchange = (e) => edit({ foliage: { kind: e.target.value } });
$("bark").onchange = (e) => edit({ bark: { kind: e.target.value } });
$("height").onchange = (e) => {
  const max = Number(e.target.value);
  edit({ height: [+(max * 0.6).toFixed(1), max] });
};
$("size").oninput = (e) => edit({ foliage: { size: Number(e.target.value) } });
$("density").oninput = (e) =>
  edit({ foliage: { density: Number(e.target.value) } });
$("tint").oninput = (e) => edit({ foliage: { tint: e.target.value } });
$("reseed").onclick = () => edit({ seed: Math.floor(Math.random() * 99999) });
$("variant").onclick = () => {
  variant = (variant + 1) % VARIANTS;
  render();
};
$("save").onclick = () => run("save_design", {});
$("add").onclick = () =>
  run("add_to_scene", {
    scatter: { center: [0, 0], radius: 35, count: Number($("count").value) },
  });
$("frame").onclick = () => render(true);
render(true);
