// Single source of truth for defaults and identity.

export const CLI_NAME = "runchat";
export const CLI_VERSION = "0.2.0";

export const DEFAULT_BASE_URL = "https://runchat.com";

// MCP transport: the Runchat MCP server is exposed as stateless Streamable HTTP
// at this path. Every JSON-RPC message is a self-contained POST.
export const MCP_PATH = "/api/mcp";

// Latest MCP protocol revision the server advertises. Sent on every request.
export const MCP_PROTOCOL_VERSION = "2025-06-18";

// Process exit codes — stable so scripts/agents can branch on them.
export const EXIT = {
  OK: 0,
  /** Tool ran but reported an error (isError), or a server-side failure. */
  TOOL_ERROR: 1,
  /** Bad CLI usage — unknown command, missing required arg, etc. */
  USAGE: 2,
  /** Authentication / authorization problem (401/403, no key configured). */
  AUTH: 3,
  /** Network / transport failure reaching the server. */
  NETWORK: 4,
} as const;
