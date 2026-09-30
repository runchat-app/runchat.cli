// Browser-login flow against a fake local authorization server: discovery,
// client registration, loopback callback, PKCE code exchange and refresh.
// No real network or browser.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "runchat-test-"));
process.env.RUNCHAT_CONFIG_DIR = dir;

const { browserLogin, getFreshOAuthToken, jwtClaim } = await import("../dist/oauth.js");
const { readConfig, writeConfig } = await import("../dist/config.js");

let server;
let baseUrl;
const state = { registrations: 0, refreshes: 0, challenge: undefined };

function jwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: `${baseUrl}/auth`,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
      });
    }
    if (url.pathname === "/register") {
      state.registrations++;
      assert.equal(JSON.parse(body).token_endpoint_auth_method, "none");
      return json(201, { client_id: "client-1" });
    }
    if (url.pathname === "/token") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        const hash = createHash("sha256").update(p.get("code_verifier")).digest("base64url");
        if (p.get("code") !== "the-code" || hash !== state.challenge) return json(400, { error: "invalid_grant" });
        return json(200, { access_token: jwt({ email: "a@b.c", n: 0 }), refresh_token: "r0", expires_in: 3600 });
      }
      if (p.get("grant_type") === "refresh_token") {
        state.refreshes++;
        if (p.get("refresh_token") !== `r${state.refreshes - 1}`) return json(400, { error: "invalid_grant" });
        return json(200, {
          access_token: jwt({ email: "a@b.c", n: state.refreshes }),
          refresh_token: `r${state.refreshes}`,
          expires_in: 3600,
        });
      }
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test("browserLogin completes the PKCE loopback flow", async () => {
  const session = await browserLogin({
    baseUrl,
    openBrowser: false,
    timeoutMs: 5000,
    onUrl: (authUrl) => {
      // Play the browser: the auth server redirects back to our loopback.
      const u = new URL(authUrl);
      state.challenge = u.searchParams.get("code_challenge");
      assert.equal(u.searchParams.get("code_challenge_method"), "S256");
      const cb = new URL(u.searchParams.get("redirect_uri"));
      cb.searchParams.set("code", "the-code");
      cb.searchParams.set("state", u.searchParams.get("state"));
      fetch(cb).then((r) => assert.equal(r.status, 200));
    },
  });
  assert.equal(jwtClaim(session.accessToken, "email"), "a@b.c");
  assert.equal(session.refreshToken, "r0");
  assert.equal(session.clientId, "client-1");
  assert.equal(readConfig().oauthClient.clientId, "client-1");
  writeConfig({ oauth: session });
});

test("callback with the wrong state is rejected", async () => {
  await assert.rejects(
    browserLogin({
      baseUrl,
      openBrowser: false,
      timeoutMs: 5000,
      onUrl: (authUrl) => {
        const cb = new URL(new URL(authUrl).searchParams.get("redirect_uri"));
        cb.searchParams.set("code", "x");
        cb.searchParams.set("state", "forged");
        fetch(cb).catch(() => {});
      },
    }),
    /State mismatch/
  );
  assert.equal(state.registrations, 1, "client registration is reused");
});

test("getFreshOAuthToken refreshes once across concurrent callers", async () => {
  writeConfig({ oauth: { ...readConfig().oauth, expiresAt: Date.now() - 1000 } });
  const tokens = await Promise.all([1, 2, 3, 4].map(() => getFreshOAuthToken(baseUrl)));
  assert.equal(state.refreshes, 1);
  assert.ok(tokens.every((t) => t === tokens[0]));
  assert.equal(readConfig().oauth.refreshToken, "r1");
  // Still fresh: no further refresh.
  await getFreshOAuthToken(baseUrl);
  assert.equal(state.refreshes, 1);
});

test("getFreshOAuthToken ignores a session for another server", async () => {
  assert.equal(await getFreshOAuthToken("https://elsewhere.example"), undefined);
});
