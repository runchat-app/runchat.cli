// `runchat init [dir]` — scaffold a Runchat app: a UI that renders from the
// app's shared state, and commands.js, the API its UI and agents both call.
// Deploy it with `runchat deploy`.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI_NAME, EXIT } from "../constants.js";
import { c, err, info } from "../format.js";

const TEMPLATE: Record<string, string> = {
  "index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Dots</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <header><b>Dots</b> <span id="status">connecting…</span> <button id="clear">Clear</button></header>
    <canvas id="board"></canvas>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  "src/styles.css": `body { margin: 0; font: 13px system-ui, sans-serif; background: #faf8f5; color: #222; }
header { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #e5e0d8; }
#status { color: #888; flex: 1; }
canvas { display: block; width: 100%; height: calc(100vh - 36px); cursor: crosshair; }
`,
  "src/main.js": `// The UI renders from shared state and changes it through commands, the
// same commands agents call, so people and agents always see one document.
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
let dots = [];

function draw() {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  for (const d of dots) {
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x * width, d.y * height, d.r ?? 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

runchat.state.subscribe((state) => {
  dots = state.dots ?? [];
  document.getElementById("status").textContent = dots.length + " dots";
  draw();
});

canvas.addEventListener("click", (e) => {
  const box = canvas.getBoundingClientRect();
  const dot = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  runchat.command("add_dots", { dots: [dot] });
});
document.getElementById("clear").onclick = () => runchat.command("clear");
addEventListener("resize", draw);
`,
  "commands.js": `// The app's API. Each command gets its arguments and the current shared
// state and returns ops: set, merge, append (with optional max), delete, clear.
// Commands run server-side, so keep them pure: no DOM.
const PALETTE = ["#c8553d", "#2f6690", "#f2a541", "#3a7d44", "#7d5ba6"];

export const commands = {
  add_dots: {
    description: "Add dots. x and y run 0–1 across the board; r is the radius in px (default 8).",
    input: {
      type: "object",
      properties: {
        dots: {
          type: "array",
          items: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" }, r: { type: "number" }, color: { type: "string" } },
            required: ["x", "y"],
          },
        },
      },
      required: ["dots"],
    },
    run({ dots }, { state }) {
      const start = (state.dots ?? []).length;
      const items = dots.map((d, i) => ({ ...d, color: d.color ?? PALETTE[(start + i) % PALETTE.length] }));
      return { ops: [{ op: "append", key: "dots", items, max: 5000 }], result: { total: start + items.length } };
    },
  },
  clear: {
    description: "Remove every dot.",
    run() {
      return [{ op: "delete", key: "dots" }];
    },
  },
  describe: {
    description: "Summarise the board: dot count and bounding box.",
    run(_args, { state }) {
      const dots = state.dots ?? [];
      const xs = dots.map((d) => d.x);
      const ys = dots.map((d) => d.y);
      return {
        result: dots.length
          ? { count: dots.length, min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] }
          : { count: 0 },
      };
    },
  },
};
`,
  "README.md": `# Runchat app

- \`index.html\` + \`src/\`: the UI. It renders from \`runchat.state.subscribe\` and acts through \`runchat.command\`.
- \`commands.js\`: the API. People (through the UI), Runchat agents and external agents call the same commands.

Deploy to a canvas. Make one with \`${CLI_NAME} create_runchat --name "My app"\` (or find one with
\`${CLI_NAME} list_runchats\`); its \`id\` is the runchat id:

    ${CLI_NAME} deploy . --runchat_id <id>            # first time: creates the app node
    ${CLI_NAME} deploy . --runchat_id <id> --node_id <node>   # update it

Drive it from a terminal:

    ${CLI_NAME} read_app --runchat_id <id> --node_id <node>
    ${CLI_NAME} app_command --runchat_id <id> --node_id <node> --command add_dots --args '{"dots":[{"x":0.5,"y":0.5}]}'

The full app contract (state ops, commands, publishing to the shared 3D scene) is in
\`${CLI_NAME} use_skill --name html-code\`. Check scene output with \`${CLI_NAME} read_scene --runchat_id <id>\`.

npm packages: add a package.json with dependencies and import them by name. Bundling is esbuild:
link CSS from index.html, and host binary assets elsewhere.
`,
};

export const INIT_HELP = `Usage: ${CLI_NAME} init [dir]

Scaffold a Runchat app in dir (default: the current folder, which must be
empty): index.html and src/ for the UI, and commands.js, the API that its UI
and agents both call. No sign-in needed.

Then:
  ${CLI_NAME} create_runchat --name "My app"     make a canvas; note its id
  ${CLI_NAME} deploy <dir> --runchat_id <id>     put the app on it
  ${CLI_NAME} use_skill --name html-code         the app contract: state,
                                             commands, the shared 3D scene
`;

export function initCommand(dir: string | undefined): number {
  const root = dir ?? ".";
  if (existsSync(root) && readdirSync(root).length > 0) {
    err(`${root} is not empty. Pick a new folder: ${CLI_NAME} init my-app`);
    return EXIT.USAGE;
  }
  for (const [path, content] of Object.entries(TEMPLATE)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  info(`${c.green("✓")} Created a Runchat app in ${c.bold(root)}`);
  info(`  Next: make a canvas with ${CLI_NAME} create_runchat --name "My app" (or list_runchats),`);
  info(`        then ${CLI_NAME} deploy ${root} --runchat_id <id>`);
  info(`  App contract: ${CLI_NAME} use_skill --name html-code`);
  return EXIT.OK;
}
