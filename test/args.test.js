// Pure-function tests for the arg parser and value coercion. No network/fs.
// Run with: npm test  (builds first, then `node --test test/`)

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, normalizeFlag, coerceValue } from "../dist/args.js";
import { buildToolArgs } from "../dist/commands/call.js";

test("normalizeFlag strips dashes and maps kebab to snake", () => {
  assert.equal(normalizeFlag("--runchat-id"), "runchat_id");
  assert.equal(normalizeFlag("--runchat_id"), "runchat_id");
  assert.equal(normalizeFlag("-x"), "x");
});

test("parseArgs handles value, =, boolean and positionals", () => {
  const r = parseArgs(["create_node", "--type", "promptNode", "--locked", "--n=3"]);
  assert.deepEqual(r.positionals, ["create_node"]);
  assert.equal(r.flags.type, "promptNode");
  assert.equal(r.flags.locked, true);
  assert.equal(r.flags.n, "3");
});

test("parseArgs collects repeated flags into an array", () => {
  const r = parseArgs(["x", "--tag", "a", "--tag", "b"]);
  assert.deepEqual(r.flags.tag, ["a", "b"]);
});

test("parseArgs respects -- terminator", () => {
  const r = parseArgs(["run", "--", "--not-a-flag", "pos"]);
  assert.deepEqual(r.positionals, ["run", "--not-a-flag", "pos"]);
});

test("coerceValue parses JSON-ish values but keeps bare strings", () => {
  assert.equal(coerceValue("hello"), "hello");
  assert.equal(coerceValue("gpt-4"), "gpt-4");
  assert.equal(coerceValue("5"), 5);
  assert.equal(coerceValue("true"), true);
  assert.equal(coerceValue("null"), null);
  assert.deepEqual(coerceValue("[1,2]"), [1, 2]);
  assert.deepEqual(coerceValue('{"a":1}'), { a: 1 });
});

test("coerceValue keeps id-like numeric strings as strings", () => {
  // Leading zero would be lost by a naive Number() — must stay a string.
  assert.equal(coerceValue("007"), "007");
  assert.equal(coerceValue("123abc"), "123abc");
});

test("buildToolArgs coerces flags and merges --json", () => {
  const args = buildToolArgs({
    json: '{"a":1,"b":2}',
    b: "3",
    tags: ["x", "y"],
    locked: true,
  });
  assert.equal(args.a, 1);
  assert.equal(args.b, 3); // flag overrides --json
  assert.deepEqual(args.tags, ["x", "y"]);
  assert.equal(args.locked, true);
});

test("buildToolArgs ignores reserved CLI flags", () => {
  const args = buildToolArgs({ raw: true, base_url: "http://x", runchat_id: "abc" });
  assert.deepEqual(args, { runchat_id: "abc" });
});

test("@file stays a raw string unless the schema wants JSON", async () => {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "runchat-cli-"));
  const json = join(dir, "inputs.json"), code = join(dir, "app.js"), bad = join(dir, "bad.json");
  writeFileSync(json, '{"instruction":"hi"}');
  writeFileSync(code, "[1, 2]; // code, not data");
  writeFileSync(bad, "{nope");
  const schema = { inputs: { type: "object" }, outputs: { type: "array" }, new_text: { type: "string" }, either: { type: ["string", "object"] } };
  assert.deepEqual(buildToolArgs({ inputs: "@" + json }, schema).inputs, { instruction: "hi" });
  assert.equal(buildToolArgs({ new_text: "@" + code }, schema).new_text, "[1, 2]; // code, not data");
  assert.equal(buildToolArgs({ either: "@" + json }, schema).either, '{"instruction":"hi"}', "string-capable params stay raw");
  assert.equal(buildToolArgs({ inputs: "@" + json }).inputs, '{"instruction":"hi"}', "no schema: raw string as before");
  assert.throws(() => buildToolArgs({ inputs: "@" + bad }, schema), /expects JSON/);
  assert.equal(buildToolArgs({ new_text: "@@literal" }, schema).new_text, "@literal");
});

test("array params accept bare values, comma lists and PowerShell-mangled JSON", () => {
  const schema = {
    node_ids: { type: "array", items: { type: "string" } },
    sizes: { type: "array", items: { type: "number" } },
  };
  const ids = (v) => buildToolArgs({ node_ids: v }, schema).node_ids;
  assert.deepEqual(ids("nDWd"), ["nDWd"]);
  assert.deepEqual(ids("a,b"), ["a", "b"]);
  assert.deepEqual(ids("[nDWd]"), ["nDWd"], "PowerShell 5.1 turns '[\"nDWd\"]' into [nDWd]");
  assert.deepEqual(ids("[a, b]"), ["a", "b"]);
  assert.deepEqual(ids('["a","b"]'), ["a", "b"], "real JSON still works");
  assert.deepEqual(ids("007"), ["007"], "string items keep id-like text");
  assert.deepEqual(ids(["a", "b"]), ["a", "b"], "repeated flags");
  assert.deepEqual(buildToolArgs({ sizes: "1,2" }, schema).sizes, [1, 2]);
  assert.deepEqual(buildToolArgs({ sizes: "5" }, schema).sizes, [5]);
});

test("string params keep raw text; object params reject non-JSON with a hint", () => {
  const schema = { name: { type: "string" }, params: { type: "object" }, n: { type: "integer" } };
  assert.equal(buildToolArgs({ name: "2024" }, schema).name, "2024");
  assert.equal(buildToolArgs({ name: "true" }, schema).name, "true");
  assert.equal(buildToolArgs({ n: "3" }, schema).n, 3);
  assert.deepEqual(buildToolArgs({ params: '{"prompt":"x"}' }, schema).params, { prompt: "x" });
  assert.throws(() => buildToolArgs({ params: "{prompt: x}" }, schema), /expects a JSON object[\s\S]*PowerShell/);
  assert.equal(buildToolArgs({ name: ["a", "b"] }, schema).name, "b", "repeated string flag keeps the last");
});

test("dotted flags build nested objects and merge with whole-object flags", () => {
  assert.deepEqual(buildToolArgs({ "params.prompt": "a cat", "params.seed": "7" }).params, { prompt: "a cat", seed: 7 });
  assert.deepEqual(
    buildToolArgs({ "params.prompt": "x", params: '{"seed":1}' }, { params: { type: "object" } }).params,
    { seed: 1, prompt: "x" }
  );
  assert.deepEqual(buildToolArgs({ "a.b.c": "1" }).a, { b: { c: 1 } });
});
