// `runchat <tool> [--flags]` / `runchat call <tool> [--flags]` — the generic
// dispatcher. Builds an arguments object from flags and forwards it to the MCP
// server's tools/call. No per-tool code, so the CLI never drifts from the
// server's tool surface.

import { readFileSync } from "node:fs";
import { coerceValue } from "../args.js";
import { printToolResult } from "../format.js";
import { EXIT } from "../constants.js";
import { getTools, findTool } from "../catalog.js";
import type { McpClient, JsonSchemaProp } from "../mcp.js";

// Flags consumed by the CLI itself — never forwarded as tool arguments.
const RESERVED = new Set([
  "raw",
  "json",
  "base_url",
  "api_key",
  "token",
  "help",
  "h",
]);

/** True when a schema property only accepts structured JSON (object/array). */
function wantsJson(prop: JsonSchemaProp | undefined): boolean {
  if (!prop?.type) return false;
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  return !types.includes("string") && types.some((t) => t === "object" || t === "array");
}

/**
 * Resolve a single raw flag string into its value, honouring @file / @- / @@.
 * File and stdin contents stay raw strings (code, HTML, prompts) unless the
 * tool's schema says the argument is an object or array, in which case the
 * contents are parsed as JSON — so `--inputs @inputs.json` works.
 */
function resolveScalar(raw: string, key: string, prop?: JsonSchemaProp): unknown {
  let text: string;
  if (raw === "@-") text = readStdin();
  else if (raw.startsWith("@@")) return coerceValue(raw.slice(1)); // literal leading @
  else if (raw.startsWith("@")) text = readFileSync(raw.slice(1), "utf8");
  else return coerceValue(raw);
  if (!wantsJson(prop)) return text; // string, uncoerced
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`--${key} expects JSON (${String(prop?.type)}) but ${raw} is not valid JSON: ${(e as Error).message}`);
  }
}

let stdinCache: string | undefined;
function readStdin(): string {
  if (stdinCache === undefined) {
    try {
      stdinCache = readFileSync(0, "utf8"); // fd 0
    } catch {
      stdinCache = "";
    }
  }
  return stdinCache;
}

/** Build the tool-argument object from parsed flags. */
export function buildToolArgs(
  flags: Record<string, string | boolean | string[]>,
  schema: Record<string, JsonSchemaProp> = {}
): Record<string, unknown> {
  let args: Record<string, unknown> = {};

  // --json supplies the whole argument object; individual flags override keys.
  const jsonFlag = flags["json"];
  if (typeof jsonFlag === "string") {
    const text = jsonFlag === "@-" ? readStdin() : jsonFlag.startsWith("@") ? readFileSync(jsonFlag.slice(1), "utf8") : jsonFlag;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new UsageError(`--json is not valid JSON: ${(e as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new UsageError("--json must be a JSON object");
    }
    args = { ...(parsed as Record<string, unknown>) };
  }

  for (const [key, value] of Object.entries(flags)) {
    if (RESERVED.has(key)) continue;
    if (value === true) {
      args[key] = true;
    } else if (Array.isArray(value)) {
      args[key] = value.map((v) => resolveScalar(v, key, schema[key]?.items));
    } else {
      args[key] = resolveScalar(String(value), key, schema[key]);
    }
  }

  return args;
}

export class UsageError extends Error {}

/**
 * Schema properties for the tool, fetched (from the cached catalog) only when a
 * flag reads a file or stdin — plain calls stay a single request. Best-effort:
 * without a catalog, file contents fall back to raw strings.
 */
async function fileArgSchema(
  client: McpClient,
  baseUrl: string,
  toolName: string,
  flags: Record<string, string | boolean | string[]>
): Promise<Record<string, JsonSchemaProp>> {
  const readsFile = Object.entries(flags).some(([key, v]) =>
    !RESERVED.has(key) && [v].flat().some((x) => typeof x === "string" && x.startsWith("@") && !x.startsWith("@@")));
  if (!readsFile) return {};
  try {
    const { tools } = await getTools(client, baseUrl);
    return findTool(tools, toolName)?.inputSchema?.properties ?? {};
  } catch {
    return {};
  }
}

export async function callCommand(
  client: McpClient,
  baseUrl: string,
  toolName: string,
  flags: Record<string, string | boolean | string[]>
): Promise<number> {
  const args = buildToolArgs(flags, await fileArgSchema(client, baseUrl, toolName, flags));
  const result = await client.callTool(toolName, args);
  const isError = printToolResult(result, { raw: flags["raw"] === true });
  return isError ? EXIT.TOOL_ERROR : EXIT.OK;
}
