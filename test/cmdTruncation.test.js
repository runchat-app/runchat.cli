// Windows cmd.exe cuts a command line at its first newline; the CLI must
// refuse the cut-off value instead of sending it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inlineTextFlags, wasCutAtNewline } from "../dist/cmdTruncation.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("inlineTextFlags picks inline text flags, not @file/@- or ids", () => {
  assert.deepEqual(
    inlineTextFlags({
      code: "print(1)",
      runchat_id: "abc",
      new_text: "@f.py",
      content: "@-",
      label: "x",
    }),
    ["code"],
  );
  assert.deepEqual(
    inlineTextFlags({ "params.prompt": "a cat", old_text: "x" }),
    ["params.prompt", "old_text"],
  );
  assert.deepEqual(inlineTextFlags({ code: true }), []);
});

test("wasCutAtNewline compares the parent command line with argv", () => {
  const parent = 'cmd.exe /d /s /c "runchat x --code "a\nb" --label y"\r\n';
  assert.equal(wasCutAtNewline(parent, ["x", "--code", "a"]), true);
  assert.equal(
    wasCutAtNewline(parent, ["x", "--code", "a\nb", "--label", "y"]),
    false,
  );
  assert.equal(
    wasCutAtNewline('cmd.exe /c "runchat x --code a"\r\n', [
      "x",
      "--code",
      "a",
    ]),
    false,
  );
  assert.equal(wasCutAtNewline(undefined, ["x"]), false);
});

test(
  "a multi-line --code run through cmd.exe fails before any request",
  { skip: process.platform !== "win32" },
  () => {
    // shell: true launches through cmd.exe, exactly as npx does on Windows.
    const r = spawnSync(
      `"${process.execPath}" "${CLI}" create_code_node --runchat_id x --api-key x --base-url http://127.0.0.1:9 --code "line1\nline2" --label late`,
      { shell: true, encoding: "utf8", cwd: tmpdir() },
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--code was cut off/);
    assert.match(r.stderr, /@file/);
  },
);

test(
  "a single-line --code through cmd.exe is not flagged",
  { skip: process.platform !== "win32" },
  () => {
    const r = spawnSync(
      `"${process.execPath}" "${CLI}" create_code_node --runchat_id x --api-key x --base-url http://127.0.0.1:9 --code "print(1)"`,
      { shell: true, encoding: "utf8", cwd: tmpdir() },
    );
    assert.doesNotMatch(r.stderr, /cut off/);
  },
);
