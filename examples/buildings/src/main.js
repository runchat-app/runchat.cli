// Buildings UI: click the scene to place a building with the settings in the
// header — the same add_buildings command an agent runs.
import { createViewer } from "./viewer.js";
import { ROOFS, ROOF_FORMS, WALLS } from "./buildings.js";

const statusEl = document.getElementById("status");
const fill = (id, keys) => {
  const el = document.getElementById(id);
  for (const k of keys) el.append(new Option(k, k));
  return el;
};
const roof = fill("roof", ROOF_FORMS);
const wall = fill("wall", Object.keys(WALLS));
const roofMaterial = fill("roofMaterial", Object.keys(ROOFS));
let busy = false;

async function run(command, args) {
  if (busy) return;
  busy = true;
  statusEl.textContent = `${command}…`;
  try {
    const r = await runchat.command(command, args);
    statusEl.textContent = `${r.result?.total ?? ""} buildings`;
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    busy = false;
  }
}

const viewer = createViewer(document.getElementById("view"), {
  onPick: ([x, y]) =>
    run("add_buildings", {
      buildings: [
        {
          at: [x, y],
          floors: Number(document.getElementById("floors").value),
          roof: roof.value,
          wall: wall.value,
          roof_material: roofMaterial.value,
          rotation: Number(document.getElementById("rot").value),
        },
      ],
    }),
});
const contextEl = document.getElementById("context");
let group = null;
const applyFilter = () => viewer.setFilter({ only: group, context: contextEl.checked });
runchat.ready.then((ready) => {
  group = ready?.app?.instanceId ? `app-${ready.app.instanceId}` : null;
  applyFilter();
});
contextEl.onchange = applyFilter;
runchat.scene.subscribe((objects) => viewer.setObjects(objects));
runchat.state.subscribe((state) => {
  if (!busy)
    statusEl.textContent = `${(state.buildings ?? []).length} buildings`;
});
document.getElementById("settle").onclick = () => run("settle", {});
document.getElementById("clear").onclick = () => run("clear", {});
document.getElementById("frame").onclick = () => viewer.frame();
