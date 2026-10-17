// `runchat deploy [dir] --runchat_id <id> [--node_id <id>]` — put a local web
// app (index.html + ES modules, optional package.json and commands.js) on a
// Runchat canvas as an html code node, or update the node it was deployed to.
// Runchat bundles it with esbuild, so a few Vite-isms are rewritten on the
// way up (CSS imported from JS, import.meta.env).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CLI_NAME, EXIT } from "../constants.js";
import { c, err, info } from "../format.js";
import { McpHttpError, type McpClient, type ToolCallResult } from "../mcp.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "test",
  "tests",
  "__tests__",
  ".vite",
  ".claude",
  ".github",
]);
const TEXT_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".json",
  ".svg",
  ".glsl",
  ".wgsl",
  ".vert",
  ".frag",
  ".txt",
  ".csv",
]);
const SKIP_FILES =
  /(^|\/)(package-lock\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|vitest\.config\.[^/]+|[^/]+\.test\.[^/]+|[^/]+\.spec\.[^/]+|launch\.json)$/;
const MAX_FILE_BYTES = 512 * 1024;

export interface DeployFile {
  path: string;
  content: string;
}

export function collectFiles(root: string): DeployFile[] {
  const out: DeployFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      const path = relative(root, full).split(sep).join("/");
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (!TEXT_EXTENSIONS.has(ext) || SKIP_FILES.test(path)) continue;
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(
          `${path} is ${Math.round(stat.size / 1024)} KB; files over ${MAX_FILE_BYTES / 1024} KB can't be deployed (host big assets and load them by URL).`,
        );
      }
      out.push({ path, content: readFileSync(full, "utf8") });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const CSS_IMPORT = /^[ \t]*import\s+["']([^"']+\.css)["'];?[ \t]*\r?\n?/gm;
const SCRIPT_EXT = /\.(m?[jt]sx?|cjs)$/;

function resolveRelative(fromFile: string, spec: string): string {
  if (spec.startsWith("/")) return spec.slice(1);
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of spec.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/**
 * Rewrite the Vite-only bits esbuild rejects: CSS imported from JS becomes a
 * <link> in index.html, and import.meta.env reads become production literals.
 */
export function viteCompat(files: DeployFile[]): {
  files: DeployFile[];
  notes: string[];
} {
  const notes: string[] = [];
  const links: string[] = [];
  const next = files.map((file) => {
    if (!SCRIPT_EXT.test(file.path)) return file;
    let content = file.content.replace(CSS_IMPORT, (_line, spec: string) => {
      const target = resolveRelative(file.path, spec);
      if (!links.includes(target)) links.push(target);
      notes.push(`${file.path}: CSS import ${spec} → <link> in index.html`);
      return "";
    });
    const before = content;
    content = content
      .replace(/import\.meta\.env\.DEV\b/g, "false")
      .replace(/import\.meta\.env\.PROD\b/g, "true")
      .replace(/import\.meta\.env\.MODE\b/g, '"production"')
      .replace(/import\.meta\.env\.BASE_URL\b/g, '"/"')
      .replace(/import\.meta\.env\.SSR\b/g, "false");
    if (content !== before)
      notes.push(`${file.path}: import.meta.env → literals`);
    return content === file.content ? file : { ...file, content };
  });
  if (links.length > 0) {
    const index = next.find((f) => f.path === "index.html");
    if (index) {
      const tags = links
        .map((href) => `<link rel="stylesheet" href="/${href}">`)
        .join("\n    ");
      index.content = /<\/head>/i.test(index.content)
        ? index.content.replace(/<\/head>/i, `  ${tags}\n  </head>`)
        : `${tags}\n${index.content}`;
    }
  }
  return { files: next, notes };
}

function parseResult(result: ToolCallResult & { structuredContent?: unknown }) {
  if (result.isError) {
    const text = result.content?.find((part) => part.type === "text")?.text;
    throw new Error(text || "Tool call failed");
  }
  if (
    result.structuredContent &&
    typeof result.structuredContent === "object"
  ) {
    return result.structuredContent as Record<string, any>;
  }
  const text =
    result.content?.find((part) => part.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return { text };
  }
}

export const DEPLOY_HELP = `Usage: ${CLI_NAME} deploy [dir] --runchat_id <id> [--node_id <id>] [--label <name>] [--no-prune]

Put the app in dir (default: the current folder) on a canvas as an html code
node. dir needs index.html at its root; ES modules, CSS, package.json and
commands.js come along. Runchat bundles it with esbuild.

  --runchat_id <id>   The canvas. Make one with \`${CLI_NAME} create_runchat --name "My app"\`
                      or find one with \`${CLI_NAME} list_runchats\`.
  --node_id <id>      Update this app node in place instead of creating a new
                      one. The first deploy prints the id.
  --label <name>      Name for a new node (default: the folder name).
  --no-prune          On update, keep remote files that are no longer local
                      (by default they are deleted).
  --no-vite-compat    Don't rewrite CSS imports and import.meta.env.

After deploying, drive it:
  ${CLI_NAME} read_app --runchat_id <id> --node_id <node>
  ${CLI_NAME} app_command --runchat_id <id> --node_id <node> --command <name> --args '{...}'
  ${CLI_NAME} read_scene --runchat_id <id>        what the app put in the 3D scene
`;

export async function deployCommand(
  client: McpClient,
  baseUrl: string,
  dir: string | undefined,
  flags: Record<string, unknown>,
): Promise<number> {
  const runchatId = flags["runchat_id"];
  if (typeof runchatId !== "string" || !runchatId) {
    err("deploy needs --runchat_id.");
    process.stderr.write("\n" + DEPLOY_HELP);
    return EXIT.USAGE;
  }
  const root = dir ?? ".";
  let files = collectFiles(root);
  if (flags["no_vite_compat"] !== true) {
    const compat = viteCompat(files);
    files = compat.files;
    for (const note of compat.notes) info(c.dim(`  ${note}`));
  }
  const entry = files.find((f) => f.path === "index.html");
  if (!entry) {
    err(`No index.html in ${root}. An app needs index.html at its root.`);
    return EXIT.USAGE;
  }
  const rest = files.filter((f) => f.path !== "index.html");
  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, any>> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return parseResult(
          await client.callTool(name, { runchat_id: runchatId, ...args }),
        );
      } catch (e) {
        if (!(e instanceof McpHttpError) || e.status !== 429 || attempt >= 6) {
          throw e;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  };

  let nodeId =
    typeof flags["node_id"] === "string" ? flags["node_id"] : undefined;

  if (!nodeId) {
    const label =
      typeof flags["label"] === "string"
        ? flags["label"]
        : root === "."
          ? "App"
          : root.split(/[\\/]/).filter(Boolean).pop();
    const created = await call("create_code_node", {
      language: "html",
      code: entry.content,
      label,
    });
    nodeId = created.id ?? created.nodes?.[0]?.id;
    if (!nodeId) throw new Error("create_code_node returned no node id");
    if (rest.length > 0) {
      const res = await call("create_files", { node_id: nodeId, files: rest });
      if (res.bundle_check) info(c.dim(`  ${res.bundle_check}`));
    }
    info(
      `${c.green("✓")} Created app node ${c.bold(nodeId)} with ${files.length} files`,
    );
  } else {
    const remote = await call("read_files", { node_id: nodeId });
    const remotePaths = ((remote.files ?? []) as Array<{ path: string }>)
      .map((f) => f.path)
      .filter((p) => p !== "index.html");
    const local = new Set(files.map((f) => f.path));
    const stale = remotePaths.filter((p) => !local.has(p));
    const prune = flags["no_prune"] !== true;
    const toDelete = remotePaths.filter((p) => local.has(p) || prune);
    await call("edit_file", {
      node_id: nodeId,
      file: "index.html",
      new_text: entry.content,
    });
    if (toDelete.length > 0) {
      await call("delete_files", { node_id: nodeId, files: toDelete });
    }
    if (rest.length > 0) {
      const res = await call("create_files", { node_id: nodeId, files: rest });
      if (res.bundle_check) info(c.dim(`  ${res.bundle_check}`));
    }
    info(
      `${c.green("✓")} Updated app node ${c.bold(nodeId)}: ${files.length} files` +
        (prune && stale.length > 0 ? `, ${stale.length} removed` : ""),
    );
  }
  info(`  Open: ${baseUrl.replace(/\/$/, "")}/editor?id=${runchatId}`);
  info(
    `  Drive it: ${CLI_NAME} read_app --runchat_id ${runchatId} --node_id ${nodeId}`,
  );
  process.stdout.write(
    JSON.stringify({ runchat_id: runchatId, node_id: nodeId }) + "\n",
  );
  return EXIT.OK;
}
