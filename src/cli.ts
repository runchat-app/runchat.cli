#!/usr/bin/env node
// Entry point: parse argv, resolve auth, route to a built-in command or treat
// the first token as a tool name and dispatch it to the MCP server.

import { parseArgs } from "./args.js";
import { CLI_VERSION, EXIT } from "./constants.js";
import { resolveToken, resolveBaseUrl } from "./config.js";
import { c, err, info } from "./format.js";
import {
  McpClient,
  McpHttpError,
  McpRpcError,
  McpNetworkError,
} from "./mcp.js";
import { getTools, findTool } from "./catalog.js";
import { OAuthError } from "./oauth.js";
import { topLevelHelp, renderToolHelp } from "./commands/help.js";
import { toolsCommand } from "./commands/tools.js";
import { callCommand, UsageError } from "./commands/call.js";
import { guideCommand } from "./commands/guide.js";
import { loginCommand, logoutCommand, statusCommand } from "./commands/auth.js";
import { setupCommand } from "./commands/setup.js";

// Built-in command names that are NOT Runchat tools.
const BUILTINS = new Set([
  "help",
  "version",
  "tools",
  "login",
  "logout",
  "status",
  "whoami",
  "guide",
  "call",
  "setup",
]);

async function main(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv);
  const wantsHelp = flags["help"] === true || flags["h"] === true;
  const command = positionals[0];

  // No command: --version / --help / bare invocation.
  if (!command) {
    if (flags["version"] === true || flags["v"] === true) {
      process.stdout.write(CLI_VERSION + "\n");
      return EXIT.OK;
    }
    process.stdout.write(topLevelHelp());
    return EXIT.OK;
  }

  // Built-ins that need neither network nor auth.
  if (command === "version") {
    process.stdout.write(CLI_VERSION + "\n");
    return EXIT.OK;
  }
  if (command === "help" && !positionals[1]) {
    process.stdout.write(topLevelHelp());
    return EXIT.OK;
  }
  if (command === "logout") {
    return logoutCommand();
  }
  if (command === "login") {
    return loginCommand(flags);
  }
  if (command === "setup") {
    return setupCommand(positionals[1], flags);
  }

  // Everything below talks to the server.
  const baseUrl = resolveBaseUrl(flags);
  if (command === "status" || command === "whoami") {
    return statusCommand(flags);
  }

  const { token } = await resolveToken(flags, baseUrl);
  const client = new McpClient(baseUrl, token);

  // `help <tool>` and `<tool> --help` both render per-tool help.
  if (command === "help" && positionals[1]) {
    return showToolHelp(client, baseUrl, positionals[1], flags);
  }

  if (command === "tools") {
    requireToken(token, "list tools");
    return toolsCommand(client, baseUrl, flags);
  }
  if (command === "guide") {
    requireToken(token, "fetch the guide");
    return guideCommand(client);
  }

  // A tool invocation. Two forms:
  //   runchat <tool> [--flags]
  //   runchat call <tool> [--flags]
  let toolName = command;
  if (command === "call") {
    toolName = positionals[1];
    if (!toolName) {
      err("`call` needs a tool name: runchat call <tool> [--flags]");
      return EXIT.USAGE;
    }
  } else if (!BUILTINS.has(command)) {
    toolName = command;
  }

  if (wantsHelp) {
    return showToolHelp(client, baseUrl, toolName, flags);
  }

  requireToken(token, `run \`${toolName}\``);
  return callCommand(client, baseUrl, toolName, flags);
}

function requireToken(token: string | undefined, action: string): void {
  if (!token) {
    throw new AuthMissingError(
      `Not signed in — cannot ${action}.\n` +
        `Run \`runchat login\` to sign in with your browser ` +
        `(or set RUNCHAT_API_KEY / pass --api-key).`
    );
  }
}

class AuthMissingError extends Error {}

async function showToolHelp(
  client: McpClient,
  baseUrl: string,
  toolName: string,
  flags: Record<string, unknown>
): Promise<number> {
  let tools;
  try {
    ({ tools } = await getTools(client, baseUrl, {
      refresh: flags["refresh"] === true,
    }));
  } catch {
    err(
      `Cannot load tool definitions (need an API key, or no cached catalog yet).\n` +
        `Authenticate, then run \`runchat tools\`. See \`runchat --help\`.`
    );
    return EXIT.AUTH;
  }
  const tool = findTool(tools, toolName);
  if (!tool) {
    err(`Unknown tool "${toolName}". Run \`runchat tools\` to see all tools.`);
    return EXIT.USAGE;
  }
  process.stdout.write(renderToolHelp(tool));
  return EXIT.OK;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    // Centralised, friendly mapping of the failure modes to exit codes.
    if (e instanceof AuthMissingError) {
      err(e.message);
      process.exit(EXIT.AUTH);
    }
    if (e instanceof OAuthError) {
      err(e.message);
      process.exit(EXIT.AUTH);
    }
    if (e instanceof UsageError) {
      err(e.message);
      process.exit(EXIT.USAGE);
    }
    if (e instanceof McpHttpError) {
      if (e.status === 401 || e.status === 403) {
        err(`Authentication failed (${e.status}): ${e.message}`);
        info(c.dim("Run `runchat login` to sign in again, or `runchat status` to check."));
        process.exit(EXIT.AUTH);
      }
      if (e.status === 429) {
        err(`Rate limit exceeded (429). Slow down and retry.`);
        process.exit(EXIT.TOOL_ERROR);
      }
      err(`Server error (${e.status}): ${e.message}`);
      process.exit(EXIT.TOOL_ERROR);
    }
    if (e instanceof McpRpcError) {
      // -32602 = invalid params / unknown tool.
      if (e.code === -32602) {
        err(e.message);
        info(c.dim("Run `runchat <tool> --help` to check the arguments."));
        process.exit(EXIT.USAGE);
      }
      err(e.message);
      process.exit(EXIT.TOOL_ERROR);
    }
    if (e instanceof McpNetworkError) {
      err(e.message);
      process.exit(EXIT.NETWORK);
    }
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
      err(`File not found: ${(e as Error).message}`);
      process.exit(EXIT.USAGE);
    }
    err((e as Error)?.message || String(e));
    process.exit(EXIT.TOOL_ERROR);
  });
