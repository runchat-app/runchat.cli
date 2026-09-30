// Static top-level help, and the per-tool help renderer (driven by the live
// JSON schema from tools/list).

import { CLI_NAME, CLI_VERSION, DEFAULT_BASE_URL } from "../constants.js";
import { c, typeLabel } from "../format.js";
import type { McpTool } from "../mcp.js";

export function topLevelHelp(): string {
  const b = c.bold;
  const d = c.dim;
  return `${b("runchat")} — command-line interface for Runchat (v${CLI_VERSION})

Build and run node-based AI workflows from the terminal. A CLI port of the
Runchat MCP server: every MCP tool is available as a command.

${b("USAGE")}
  ${CLI_NAME} <command> [options]
  ${CLI_NAME} <tool> [--arg value ...]        run any Runchat tool
  ${CLI_NAME} call <tool> [--arg value ...]   same, explicit form

${b("BUILT-IN COMMANDS")}
  tools                 List every available tool with a one-line description
  <tool> [<tool>...] --help  Show full description and parameters
  guide                 Print the agent getting-started guide (from the server)
  login                 Sign in with your browser (or save an API key)
  logout                Remove saved credentials
  status                Show auth status (exit 3 = not signed in)
  setup claude          Install the Runchat skill for Claude Code
  version               Print the CLI version
  help                  Show this help

${b("RUNNING TOOLS")}
  Discover tools, then call them by name. Examples:

    ${d("# list tools, then read one tool's parameters")}
    ${CLI_NAME} tools
    ${CLI_NAME} create_node --help

    ${d("# workspace tools")}
    ${CLI_NAME} list_runchats --query invoice --limit 5
    ${CLI_NAME} create_runchat --name "My flow" --tags '["demo"]'

    ${d("# canvas tools take --runchat_id")}
    ${CLI_NAME} get_canvas --runchat_id <id>
    ${CLI_NAME} run_nodes --runchat_id <id>

${b("PASSING ARGUMENTS")}
  --key value           Set an argument. Values are smart-typed: numbers,
                        true/false/null and JSON ([...]/{...}) are parsed;
                        everything else is a string.
  --key '[1,2]'         Arrays and objects: pass JSON, or without JSON:
  --ids a,b             lists (or repeat --ids); a single value → [value]
  --params.prompt "x"   set one field of an object argument
  --json '{"a":1}'      Provide the whole argument object at once (individual
                        --flags override keys in it).
  --key @file.txt       Read the value from a file.
  --key @-              Read the value from stdin.
  --runchat-id <id>     Dashes and underscores are interchangeable in arg names.

${b("OUTPUT")}
  Results print as pretty JSON. Use ${d("--raw")} for the server's exact text.
  Exit codes: 0 ok · 1 tool error · 2 usage · 3 auth · 4 network.

${b("AUTHENTICATION")}
  ${CLI_NAME} login                 open the browser, sign in, done (session
                                auto-refreshes). --no-browser prints the URL
                                instead; --timeout <s> (default 300).
  ${CLI_NAME} login --paste         open ${DEFAULT_BASE_URL} to create an API key,
                                then paste it
  API keys can also be passed directly (highest precedence first):
    --api-key <key>             per-command flag
    RUNCHAT_API_KEY=<key>       environment variable (best for CI)
    ${CLI_NAME} login --api-key <key>  stores it in your user config

${b("CONFIGURATION")}
  RUNCHAT_API_KEY       API key (or RUNCHAT_TOKEN)
  RUNCHAT_BASE_URL      Override the server (default ${DEFAULT_BASE_URL})
  RUNCHAT_CONFIG_DIR    Override where config/cache are stored
  --base-url <url>      Per-command base URL override

${d(`Docs: ${DEFAULT_BASE_URL}/auth.md · Repo: github.com/runchat-app/runchat.cli`)}
`;
}

/** Render full help for a single tool from its input schema. */
export function renderToolHelp(tool: McpTool): string {
  const b = c.bold;
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const names = Object.keys(props);

  const lines: string[] = [];
  lines.push(`${b(tool.name)}`);
  lines.push("");
  if (tool.description) {
    lines.push(wrapText(tool.description, 76));
    lines.push("");
  }

  // Usage line with required args inline.
  const reqArgs = names
    .filter((n) => required.has(n))
    .map((n) => `--${n} <${typeLabel(props[n])}>`)
    .join(" ");
  lines.push(b("USAGE"));
  lines.push(`  ${CLI_NAME} ${tool.name}${reqArgs ? " " + reqArgs : ""} [options]`);
  lines.push("");

  if (names.length === 0) {
    lines.push(c.dim("This tool takes no arguments."));
    return lines.join("\n") + "\n";
  }

  lines.push(b("ARGUMENTS"));
  for (const name of names) {
    const p = props[name];
    const req = required.has(name) ? c.yellow(" (required)") : "";
    const type = c.dim(typeLabel(p));
    lines.push(`  --${name}  ${type}${req}`);
    if (p.description) {
      lines.push(indent(wrapText(p.description, 70), 6));
    }
    if (p.enum) {
      lines.push(indent(c.dim(`choices: ${p.enum.join(", ")}`), 6));
    }
  }
  return lines.join("\n") + "\n";
}

function wrapText(text: string, width: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out.join("\n");
}

function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
