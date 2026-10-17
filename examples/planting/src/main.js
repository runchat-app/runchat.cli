// Planting UI: click the scene to plant the chosen species, or scatter a
// drift around the click.
import { createViewer } from "./viewer.js";
import { SPECIES } from "./plants.js";

const statusEl = document.getElementById("status");
const pick = document.getElementById("species");
for (const [key, s] of Object.entries(SPECIES))
  pick.append(new Option(s.label, key));
let busy = false;

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
    const mode = document.getElementById("mode").value;
    if (mode === "one")
      run("plant", { plants: [{ species: pick.value, at: [x, y] }] });
    else
      run("scatter", {
        species: pick.value,
        count: 12,
        center: [x, y],
        radius: 8,
      });
  },
});
runchat.scene.subscribe((objects) => viewer.setObjects(objects));
runchat.state.subscribe((state) => {
  if (!busy) statusEl.textContent = `${(state.plants ?? []).length} plants`;
});
document.getElementById("settle").onclick = () => run("settle", {});
document.getElementById("clear").onclick = () => run("clear", {});
document.getElementById("frame").onclick = () => viewer.frame();
