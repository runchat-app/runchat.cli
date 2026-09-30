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

function typesOf(prop: JsonSchemaProp | undefined): string[] {
  if (!prop?.type) return [];
  return Array.isArray(prop.type) ? prop.type : [prop.type];
}

/** True when a schema property only accepts structured JSON (object/array). */
function wantsJson(prop: JsonSchemaProp | undefined): boolean {
  const types = typesOf(prop);
  return !types.includes("string") && types.some((t) => t === "object" || t === "array");
}

/**
 * Fit a smart-coerced flag value to the tool's schema, when we know it:
 *
 * - array params accept a bare value or a comma list: `--node_ids a` → ["a"],
 *   `--node_ids a,b` → ["a","b"]. This also repairs `'["a"]'` after Windows
 *   PowerShell strips the inner quotes (it arrives as `[a]`).
 * - string-only params keep the raw text (`--name 2024` stays "2024").
 * - object-only params given non-JSON text fail fast with a usable hint,
 *   instead of the server receiving a string.
 */
function fitToSchema(value: unknown, raw: string, key: string, prop?: JsonSchemaProp): unknown {
  const types = typesOf(prop);
  if (types.length === 0) return value;

  if (types.length === 1 && types[0] === "string") return raw;

  if (types.includes("array") && !types.includes("string") && !Array.isArray(value)) {
    if (typeof value !== "string") return [value];
    let body = value.trim();
    if (body.startsWith("[") && body.endsWith("]")) body = body.slice(1, -1);
    const itemIsString = typesOf(prop?.items).every((t) => t === "string");
    return body
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .filter((part) => part !== "")
      .map((part) => (itemIsString ? part : coerceValue(part)));
  }

  if (types.includes("object") && !types.includes("string") && typeof value === "string") {
    throw new UsageError(
      `--${key} expects a JSON object, got: ${raw}\n` +
        `Windows PowerShell mangles inline JSON (it strips inner quotes and splits on spaces). ` +
        `Set fields with dotted flags instead: --${key}.<field> "value" (e.g. --${key}.prompt "a red chair"), ` +
        `or put the JSON in a file and pass --${key} @file.json.`
    );
  }
  return value;
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
  else if (raw.startsWith("@@")) return fitToSchema(coerceValue(raw.slice(1)), raw.slice(1), key, prop); // literal leading @
  else if (raw.startsWith("@")) text = readFileSync(raw.slice(1), "utf8");
  else return fitToSchema(coerceValue(raw), raw, key, prop);
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

  // Dotted flags go last so they merge into (not get replaced by) a whole-object flag.
  const entries = Object.entries(flags).sort(([a], [b]) => Number(a.includes(".")) - Number(b.includes(".")));
  for (const [key, value] of entries) {
    if (RESERVED.has(key)) continue;
    // Dotted flags set nested fields without writing JSON (which Windows
    // PowerShell mangles): --params.prompt "a cat" → { params: { prompt: "a cat" } }.
    if (key.includes(".")) {
      const [head, ...rest] = key.split(".");
      let target = args[head];
      if (typeof target !== "object" || target === null || Array.isArray(target)) {
        target = args[head] = {};
      }
      let obj = target as Record<string, unknown>;
      for (const part of rest.slice(0, -1)) {
        if (typeof obj[part] !== "object" || obj[part] === null) obj[part] = {};
        obj = obj[part] as Record<string, unknown>;
      }
      const leaf = [value].flat().pop();
      obj[rest[rest.length - 1]] = leaf === true ? true : resolveScalar(String(leaf), key);
      continue;
    }
    if (value === true) {
      args[key] = true;
    } else if (Array.isArray(value)) {
      const prop = schema[key];
      const items = value.map((v) => resolveScalar(v, key, prop?.items));
      // Repeated flags build a list; a string param only keeps the last one.
      args[key] = typesOf(prop).length && !typesOf(prop).includes("array") ? items[items.length - 1] : items;
    } else {
      args[key] = resolveScalar(String(value), key, schema[key]);
    }
  }

  return args;
}

export class UsageError extends Error {}

/**
 * Schema properties for the tool, from the cached catalog (one tools/list per
 * hour at most), used to fit flag values to the declared types. Best-effort:
 * without a catalog, values are smart-typed only.
 */
async function toolArgSchema(
  client: McpClient,
  baseUrl: string,
  toolName: string
): Promise<Record<string, JsonSchemaProp>> {
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
  const args = buildToolArgs(flags, await toolArgSchema(client, baseUrl, toolName));
  const result = await client.callTool(toolName, args);
  const isError = printToolResult(result, { raw: flags["raw"] === true });
  return isError ? EXIT.TOOL_ERROR : EXIT.OK;
}
