// Built-in commands' help: printed without side effects or signing in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (args, cwd) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, RUNCHAT_API_KEY: "" },
  });

test("init --help prints help and creates nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "runchat-init-"));
  const r = run(["init", "--help"], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: runchat init/);
  assert.deepEqual(readdirSync(dir), []);
});

test("deploy --help and help deploy explain the flags", () => {
  for (const args of [["deploy", "--help"], ["help", "deploy"]]) {
    const r = run(args, tmpdir());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--node_id/);
    assert.match(r.stdout, /--no-prune/);
  }
});

test("deploy without --runchat_id says so and shows the help", () => {
  const r = run(["deploy", ".", "--api-key", "x"], tmpdir());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs --runchat_id/);
  assert.match(r.stderr, /create_runchat/);
});
