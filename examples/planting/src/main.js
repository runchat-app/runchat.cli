// Planting UI: a turning specimen of the chosen species (grown in the page
// from the same code the commands use), or the plants this app has placed,
// optionally in the context of the whole scene.
import { createViewer } from "./viewer.js";
import { SPECIES, VARIANTS, unitModel } from "./plants.js";
import { FOLIAGE_KINDS, foliageTexture, materialTextures } from "./textures.js";

const statusEl = document.getElementById("status");
const pick = document.getElementById("species");
const modeEl = document.getElementById("mode");
const contextEl = document.getElementById("context");
for (const [key, s] of Object.entries(SPECIES))
  pick.append(new Option(s.label, key));
let busy = false;
let variant = 0;
let assets = {};
let group = null;

// Textures come from the app's uploads when it has them, otherwise they are
// generated here, so a species can be previewed before it is ever planted.
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

async function run(command, args) {
  if (busy) return;
  busy = true;
  statusEl.textContent = `${command}…`;
  try {
    const r = await runchat.command(command, args);
    statusEl.textContent = `${r.result?.total ?? 0} plants`;
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    busy = false;
  }
}

const viewer = createViewer(document.getElementById("view"), {
  onPick: ([x, y]) => {
    if (modeEl.value !== "planted") return;
    run("scatter", {
      species: pick.value,
      count: 12,
      center: [x, y],
      radius: 8,
    });
  },
});

function show() {
  const specimen = modeEl.value === "specimen";
  document.getElementById("variant").hidden = !specimen;
  contextEl.parentElement.hidden = specimen;
  if (specimen) {
    const s = SPECIES[pick.value];
    statusEl.textContent = `${s.label} · ${s.height[0]}–${s.height[1]} m · variant ${variant + 1}/${VARIANTS}`;
    viewer.showParts(unitModel(pick.value, variant), resolve);
  } else {
    viewer.setFilter({ only: group, context: contextEl.checked });
  }
}

runchat.ready.then((ready) => {
  group = ready?.app?.instanceId ? `app-${ready.app.instanceId}` : null;
  show();
});
runchat.scene.subscribe((objects) => viewer.setObjects(objects));
runchat.state.subscribe((state) => {
  assets = state._assets ?? {};
  if (!busy && modeEl.value === "planted")
    statusEl.textContent = `${(state.plants ?? []).length} plants`;
});
pick.onchange = () => {
  variant = 0;
  show();
};
modeEl.onchange = show;
contextEl.onchange = show;
document.getElementById("variant").onclick = () => {
  variant = (variant + 1) % VARIANTS;
  show();
};
document.getElementById("settle").onclick = () => run("settle", {});
document.getElementById("clear").onclick = () => run("clear", {});
document.getElementById("frame").onclick = () => viewer.frame();
