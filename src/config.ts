// Resolves where the CLI gets its API key and base URL from, and persists the
// on-disk config written by `runchat login`.
//
// Precedence (highest first):
//   token     : --api-key flag  >  RUNCHAT_API_KEY env  >  config file
//               (a saved API key, else a saved browser-login session)
//   base URL  : --base-url flag >  RUNCHAT_BASE_URL env >  config file > default
//
// Env/flags win over the file so agents and CI can stay stateless.

import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
} from "node:fs";
import { DEFAULT_BASE_URL } from "./constants.js";
import { getFreshOAuthToken } from "./oauth.js";

/** A browser-login (OAuth) session, written by `runchat login`. */
export interface StoredOAuth {
  /** The Runchat server these tokens are for. */
  baseUrl: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
  oauth?: StoredOAuth;
  /** The CLI's dynamically registered OAuth client, reused across logins. */
  oauthClient?: { issuer: string; clientId: string };
}

export type TokenSource = "flag" | "env" | "config" | "oauth" | "none";

/** Per-user config directory. Honours RUNCHAT_CONFIG_DIR, then XDG / APPDATA. */
export function configDir(): string {
  const override = process.env.RUNCHAT_CONFIG_DIR;
  if (override) return override;

  if (platform() === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "runchat");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "runchat");
  return join(homedir(), ".config", "runchat");
}

export function configFile(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): StoredConfig {
  try {
    const raw = readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored config and write it back (0600 where supported). */
export function writeConfig(patch: StoredConfig): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const merged = { ...readConfig(), ...patch };
  const file = configFile();
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
  // Best-effort: lock down the file holding the secret. No-op on Windows.
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
  return file;
}

/** Remove the saved API key and browser session. Returns false if neither existed. */
export function clearStoredCredentials(): boolean {
  const cfg = readConfig();
  if (cfg.apiKey === undefined && cfg.oauth === undefined) return false;
  delete cfg.apiKey;
  delete cfg.oauth;
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return true;
}

export function configExists(): boolean {
  return existsSync(configFile());
}

export function deleteConfig(): boolean {
  if (!existsSync(configFile())) return false;
  rmSync(configFile());
  return true;
}

export interface ResolvedAuth {
  token: string | undefined;
  source: TokenSource;
}

/**
 * Resolve the Bearer token for this invocation. A saved browser session is
 * refreshed here if its access token has expired (may throw OAuthError).
 */
export async function resolveToken(
  flags: Record<string, unknown>,
  baseUrl: string
): Promise<ResolvedAuth> {
  const flagKey = flags["api_key"] ?? flags["token"];
  if (typeof flagKey === "string" && flagKey) {
    return { token: flagKey, source: "flag" };
  }
  const envKey = process.env.RUNCHAT_API_KEY ?? process.env.RUNCHAT_TOKEN;
  if (envKey) return { token: envKey, source: "env" };

  const cfg = readConfig();
  if (cfg.apiKey) return { token: cfg.apiKey, source: "config" };

  const oauthToken = await getFreshOAuthToken(baseUrl);
  if (oauthToken) return { token: oauthToken, source: "oauth" };

  return { token: undefined, source: "none" };
}

export function resolveBaseUrl(flags: Record<string, unknown>): string {
  const flagUrl = flags["base_url"];
  if (typeof flagUrl === "string" && flagUrl) return stripTrailingSlash(flagUrl);

  const envUrl = process.env.RUNCHAT_BASE_URL;
  if (envUrl) return stripTrailingSlash(envUrl);

  const cfg = readConfig();
  if (cfg.baseUrl) return stripTrailingSlash(cfg.baseUrl);

  return DEFAULT_BASE_URL;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Mask a secret for display: keep a short head/tail, hide the middle. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
