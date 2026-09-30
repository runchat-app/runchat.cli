// Browser sign-in for `runchat login`: OAuth 2.1 authorization code + PKCE
// against Runchat's authorization server, with a loopback redirect (RFC 8252).
//
// Everything is discovered from <baseUrl>/.well-known/oauth-authorization-server,
// and the CLI registers itself as a public client via dynamic client
// registration on first use. The server matches redirect URIs exactly
// (including the port), so we register a small fixed set of loopback ports and
// listen on the first free one.
//
// The MCP endpoint accepts the resulting access token as a Bearer token, just
// like an API key. Access tokens are short-lived; `getFreshOAuthToken` refreshes
// them, serialised across concurrent CLI processes with a lock file (agents
// often fire several commands in parallel, and refresh tokens are single-use).

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmdirSync, statSync } from "node:fs";
import { CLI_NAME } from "./constants.js";
import { configDir, readConfig, writeConfig, type StoredOAuth } from "./config.js";

export const LOOPBACK_PORTS = [53682, 53683, 53684, 53685, 53686];
const SCOPES = "openid email profile";
/** Refresh this long before the access token actually expires. */
const REFRESH_SKEW_MS = 2 * 60 * 1000;

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function discover(baseUrl: string): Promise<AuthServerMetadata> {
  const url = `${baseUrl}/.well-known/oauth-authorization-server`;
  const res = await fetchOrThrow(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new OAuthError(`OAuth discovery failed (${res.status}) at ${url}`);
  const meta = (await res.json()) as AuthServerMetadata;
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new OAuthError(`OAuth discovery at ${url} is missing endpoints`);
  }
  return meta;
}

function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

async function registerClient(meta: AuthServerMetadata): Promise<string> {
  if (!meta.registration_endpoint) {
    throw new OAuthError("The authorization server does not support client registration.");
  }
  const res = await fetchOrThrow(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Runchat CLI",
      redirect_uris: LOOPBACK_PORTS.map(redirectUri),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: string };
  if (!res.ok || !body.client_id) {
    throw new OAuthError(`Client registration failed (${res.status}).`);
  }
  return body.client_id;
}

export interface LoginOptions {
  baseUrl: string;
  /** Try to open the system browser (otherwise just print the URL). */
  openBrowser: boolean;
  timeoutMs: number;
  /** Called with the authorization URL before we start waiting. */
  onUrl: (url: string, opened: boolean) => void;
}

/** Run the full browser flow and return the tokens to store. */
export async function browserLogin(opts: LoginOptions): Promise<StoredOAuth> {
  const meta = await discover(opts.baseUrl);

  // Reuse a previously registered client for this issuer, if any.
  const saved = readConfig().oauthClient;
  let clientId = saved?.issuer === meta.issuer ? saved.clientId : undefined;
  if (!clientId) {
    clientId = await registerClient(meta);
    writeConfig({ oauthClient: { issuer: meta.issuer, clientId } });
  }

  const { server, port } = await listenOnFirstFreePort(LOOPBACK_PORTS);
  try {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(16));
    const redirect = redirectUri(port);

    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    const codePromise = waitForCode(server, state, opts.timeoutMs);
    const opened = opts.openBrowser ? openInBrowser(authUrl.toString()) : false;
    opts.onUrl(authUrl.toString(), opened);
    const code = await codePromise;

    const tokens = await tokenRequest(meta.token_endpoint, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    });
    return toStored(tokens, { clientId, issuer: meta.issuer, tokenEndpoint: meta.token_endpoint, baseUrl: opts.baseUrl });
  } finally {
    server.close();
  }
}

function toStored(
  tokens: TokenResponse,
  ctx: Pick<StoredOAuth, "clientId" | "issuer" | "tokenEndpoint" | "baseUrl">,
  previousRefresh?: string
): StoredOAuth {
  return {
    ...ctx,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}

async function tokenRequest(
  endpoint: string,
  params: Record<string, string>
): Promise<TokenResponse> {
  const res = await fetchOrThrow(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
    msg?: string;
  };
  if (!res.ok || !body.access_token) {
    const why = body.error_description || body.msg || body.error || res.statusText;
    throw new OAuthError(`Token request failed (${res.status}): ${why}`);
  }
  return body;
}

/**
 * Return a usable access token for `baseUrl` from the stored OAuth session,
 * refreshing it first if it is (nearly) expired. Returns undefined when there
 * is no stored session for this server. Throws OAuthError if refresh fails.
 */
export async function getFreshOAuthToken(baseUrl: string): Promise<string | undefined> {
  const current = readConfig().oauth;
  if (!current?.accessToken || current.baseUrl !== baseUrl) return undefined;
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return current.accessToken;

  return withLock(async () => {
    // Another process may have refreshed while we waited for the lock.
    const latest = readConfig().oauth;
    if (!latest?.accessToken || latest.baseUrl !== baseUrl) return undefined;
    if (latest.expiresAt - REFRESH_SKEW_MS > Date.now()) return latest.accessToken;
    if (!latest.refreshToken) {
      throw new OAuthError(`Session expired. Run \`${CLI_NAME} login\` to sign in again.`);
    }
    let tokens: TokenResponse;
    try {
      tokens = await tokenRequest(latest.tokenEndpoint, {
        grant_type: "refresh_token",
        refresh_token: latest.refreshToken,
        client_id: latest.clientId,
      });
    } catch (e) {
      throw new OAuthError(
        `Could not refresh your session (${(e as Error).message}). Run \`${CLI_NAME} login\` to sign in again.`
      );
    }
    const next = toStored(tokens, latest, latest.refreshToken);
    writeConfig({ oauth: next });
    return next.accessToken;
  });
}

/** Read an unverified claim from a JWT (display only — never for auth decisions). */
export function jwtClaim(token: string, claim: string): string | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const v = payload?.[claim];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

// --- loopback server ---------------------------------------------------------

function listenOnFirstFreePort(ports: number[]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const tryAt = (i: number) => {
      if (i >= ports.length) {
        reject(
          new OAuthError(
            `Could not start the sign-in callback server: ports ${ports.join(", ")} are all in use.`
          )
        );
        return;
      }
      const server = createServer();
      server.once("error", () => {
        server.close();
        tryAt(i + 1);
      });
      server.listen(ports[i], "127.0.0.1", () => resolve({ server, port: ports[i] }));
    };
    tryAt(0);
  });
}

function waitForCode(server: Server, state: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OAuthError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for browser sign-in.`));
    }, timeoutMs);
    timer.unref();

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");

      let failure: string | undefined;
      if (error) failure = url.searchParams.get("error_description") || error;
      else if (gotState !== state) failure = "State mismatch — please retry `runchat login`.";
      else if (!code) failure = "No authorization code returned.";

      res.writeHead(failure ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackPage(failure));
      clearTimeout(timer);
      if (failure) reject(new OAuthError(`Sign-in failed: ${failure}`));
      else resolve(code!);
    });
  });
}

function callbackPage(failure?: string): string {
  const title = failure ? "Sign-in failed" : "Signed in to Runchat";
  const body = failure
    ? escapeHtml(failure)
    : "You can close this tab and return to your terminal.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#fafafa;color:#111}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}main{text-align:center;padding:24px}h1{font-weight:500}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// --- helpers -----------------------------------------------------------------

/** Best-effort: open `url` in the default browser. Returns false if we couldn't try. */
export function openInBrowser(url: string): boolean {
  if (process.env.RUNCHAT_NO_BROWSER) return false;
  const os = platform();
  // rundll32 avoids cmd.exe's mangling of "&" in URLs.
  const [cmd, args] =
    os === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : os === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = join(configDir(), "oauth.lock");
  mkdirSync(configDir(), { recursive: true });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // Break a lock left behind by a crashed process.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) rmdirSync(lock);
      } catch {
        /* raced with its removal */
      }
      if (Date.now() > deadline) throw new OAuthError("Timed out waiting for another runchat process to refresh the session.");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      /* ignore */
    }
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new OAuthError(`Could not reach ${new URL(url).host}: ${(e as Error).message}`);
  }
}
