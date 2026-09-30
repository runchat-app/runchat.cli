// `runchat login` / `logout` / `status` — manage stored credentials.
//
// `login` signs in through the browser by default (OAuth 2.1 + PKCE with a
// loopback redirect — see oauth.ts), which works from a terminal agent with no
// TTY: the user just approves in the browser. API keys remain supported for CI
// and headless machines: `--api-key <key>`, piped on stdin, or `--paste`.

import { createInterface } from "node:readline";
import { CLI_NAME, DEFAULT_BASE_URL, EXIT } from "../constants.js";
import { c, err, info } from "../format.js";
import {
  writeConfig,
  readConfig,
  clearStoredCredentials,
  resolveToken,
  resolveBaseUrl,
  maskKey,
  configFile,
  type ResolvedAuth,
} from "../config.js";
import { McpClient, McpHttpError } from "../mcp.js";
import { browserLogin, jwtClaim, openInBrowser, OAuthError } from "../oauth.js";

const DEFAULT_LOGIN_TIMEOUT_S = 300;

/** Verify a token works by listing tools (cheap, spends no credits). */
async function verify(baseUrl: string, token: string): Promise<number> {
  const tools = await new McpClient(baseUrl, token).listTools();
  return tools.length;
}

/** Page that opens the account menu and creates a fresh API key. */
function newKeyUrl(baseUrl: string): string {
  return `${baseUrl}/dashboard?newkey=true`;
}

export async function loginCommand(
  flags: Record<string, unknown>
): Promise<number> {
  const baseUrl = resolveBaseUrl(flags);

  // 1. Explicit key.
  const flagKey = flags["api_key"] ?? flags["token"];
  if (typeof flagKey === "string" && flagKey) {
    return saveApiKey(baseUrl, flagKey.trim());
  }

  // 2. Key piped on stdin (`echo $KEY | runchat login`). Agents usually run us
  //    with stdin closed or idle, so only wait briefly for data.
  if (!process.stdin.isTTY && flags["paste"] !== true) {
    const piped = (await readStdinIfAny(300)).trim();
    if (piped) return saveApiKey(baseUrl, piped);
  }

  // 3. Paste flow: open the new-key page, then read the key.
  if (flags["paste"] === true) {
    const url = newKeyUrl(baseUrl);
    const opened = flags["no_browser"] === true ? false : openInBrowser(url);
    info(`${opened ? "Opened" : "Open"} ${c.cyan(url)} to create an API key${opened ? "" : " (then copy it)"}.`);
    const key = process.stdin.isTTY
      ? (await prompt("Paste your Runchat API key: ")).trim()
      : (await readAll()).trim();
    if (!key) {
      err("No API key provided.");
      return EXIT.USAGE;
    }
    return saveApiKey(baseUrl, key);
  }

  // 4. Default: browser sign-in.
  const timeoutS = Number(flags["timeout"] ?? DEFAULT_LOGIN_TIMEOUT_S) || DEFAULT_LOGIN_TIMEOUT_S;
  try {
    const session = await browserLogin({
      baseUrl,
      openBrowser: flags["no_browser"] !== true,
      timeoutMs: timeoutS * 1000,
      onUrl: (url, opened) => {
        info(
          opened
            ? "Opened your browser to sign in to Runchat. If it didn't open, visit:"
            : "Open this URL in a browser to sign in to Runchat:"
        );
        info(`\n  ${url}\n`);
        info(c.dim(`Waiting for sign-in (up to ${timeoutS}s)…`));
      },
    });
    const count = await verify(baseUrl, session.accessToken);
    // One stored credential at a time: a browser session replaces a saved key.
    const file = writeConfig({
      apiKey: undefined,
      oauth: session,
      ...(baseUrl !== DEFAULT_BASE_URL ? { baseUrl } : {}),
    });
    const who = jwtClaim(session.accessToken, "email");
    info(`${c.green("✓")} Signed in${who ? ` as ${c.bold(who)}` : ""} (${count} tools available).`);
    info(c.dim(`  Session saved to ${file}`));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof OAuthError) {
      err(e.message);
      info(c.dim(`Alternatively: \`${CLI_NAME} login --paste\` to use an API key.`));
      return EXIT.AUTH;
    }
    if (e instanceof McpHttpError && (e.status === 401 || e.status === 403)) {
      err(`Signed in, but ${baseUrl} rejected the session (${e.status}). Not saved.`);
      return EXIT.AUTH;
    }
    throw e;
  }
}

async function saveApiKey(baseUrl: string, key: string): Promise<number> {
  if (!key) {
    err("No API key provided.");
    return EXIT.USAGE;
  }
  try {
    const count = await verify(baseUrl, key);
    const file = writeConfig({
      apiKey: key,
      oauth: undefined,
      ...(baseUrl !== DEFAULT_BASE_URL ? { baseUrl } : {}),
    });
    info(`${c.green("✓")} Key verified (${count} tools available) and saved to ${c.dim(file)}`);
    info(c.dim(`  Stored key: ${maskKey(key)}`));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof McpHttpError && (e.status === 401 || e.status === 403)) {
      err(`Key rejected by ${baseUrl} (${e.status}). Not saved.`);
      return EXIT.AUTH;
    }
    err(`Could not verify key: ${(e as Error).message}`);
    return EXIT.NETWORK;
  }
}

export function logoutCommand(): number {
  const removed = clearStoredCredentials();
  if (removed) info(`${c.green("✓")} Signed out — removed saved credentials from ${c.dim(configFile())}`);
  else info("Not signed in; nothing to remove.");
  return EXIT.OK;
}

export async function statusCommand(
  flags: Record<string, unknown>
): Promise<number> {
  const baseUrl = resolveBaseUrl(flags);
  info(`${c.bold("Server")}    ${baseUrl}`);

  let auth: ResolvedAuth;
  try {
    auth = await resolveToken(flags, baseUrl);
  } catch (e) {
    info(`${c.bold("Auth")}      ${c.red("expired")} ${c.dim(`(${(e as Error).message})`)}`);
    return EXIT.AUTH;
  }
  const { token, source } = auth;

  if (!token) {
    info(`${c.bold("Auth")}      ${c.yellow("not signed in")}`);
    info("");
    info(`Run \`${CLI_NAME} login\` to sign in with your browser.`);
    info(c.dim(`Or use an API key: \`${CLI_NAME} login --paste\`, RUNCHAT_API_KEY, or --api-key.`));
    return EXIT.AUTH;
  }

  if (source === "oauth") {
    const who = jwtClaim(token, "email");
    const exp = readConfig().oauth?.expiresAt;
    info(`${c.bold("Account")}   ${who ?? "(unknown)"} ${c.dim("(browser login)")}`);
    if (exp) info(c.dim(`          session refreshes automatically (token valid until ${new Date(exp).toLocaleTimeString()})`));
  } else {
    const srcLabel =
      source === "flag" ? "--api-key flag" : source === "env" ? "RUNCHAT_API_KEY env" : "config file";
    info(`${c.bold("API key")}   ${maskKey(token)} ${c.dim(`(from ${srcLabel})`)}`);
  }

  try {
    const count = await verify(baseUrl, token);
    info(`${c.bold("Auth")}      ${c.green("ok")} ${c.dim(`(${count} tools available)`)}`);
    return EXIT.OK;
  } catch (e) {
    if (e instanceof McpHttpError && (e.status === 401 || e.status === 403)) {
      info(`${c.bold("Auth")}      ${c.red("rejected")} ${c.dim(`(${e.status}) — run \`${CLI_NAME} login\``)}`);
      return EXIT.AUTH;
    }
    info(`${c.bold("Auth")}      ${c.yellow("unknown")} ${c.dim(`(${(e as Error).message})`)}`);
    return EXIT.NETWORK;
  }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  // Best-effort masking: blank out keystrokes echoed to the terminal.
  const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
  let masking = false;
  anyRl._writeToOutput = (s: string) => {
    if (masking && s !== "\r\n" && s !== "\n") process.stderr.write("*");
    else process.stderr.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      masking = false;
      process.stderr.write("\n");
      rl.close();
      resolve(answer);
    });
    masking = true;
  });
}

function readAll(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

/**
 * Read stdin to EOF if something arrives within `idleMs`; otherwise give up and
 * return "" (stdin left open by a harness, with nothing coming).
 */
function readStdinIfAny(idleMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = (v: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("end");
      process.stdin.pause();
      process.stdin.unref?.();
      resolve(v);
    };
    const timer = setTimeout(() => {
      if (!data) finish("");
    }, idleMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => finish(data));
    process.stdin.on("error", () => finish(""));
  });
}
