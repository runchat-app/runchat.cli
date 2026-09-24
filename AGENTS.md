# Using the Runchat CLI (for agents)

This repo is a command-line port of the Runchat MCP server. Use it to build and
run Runchat node-based AI workflows from a shell. It is **self-describing** — at
runtime you can list every tool and read each tool's parameters, so you never
need hardcoded knowledge of the API.

## Setup (once)

```sh
export RUNCHAT_API_KEY=<the user's Runchat API key>   # required
# optional: export RUNCHAT_BASE_URL=https://runchat.com  (default)
```

Invoke with `npx @runchat/cli <...>` (no install) or `runchat <...>` if it's
installed globally. Verify auth before doing work:

```sh
npx @runchat/cli status     # exit 0 = authenticated
```

## The only three commands you need to discover everything

```sh
npx @runchat/cli tools                 # list all tools + one-line descriptions
npx @runchat/cli <tool> --help         # full parameters for one tool (types, required)
npx @runchat/cli guide                 # the canonical Runchat workflow-building guide
```

Always run `guide` first when building a workflow — it explains node types,
the create→connect→organize→run order, choosing models, code nodes, and
publishing.

## Calling tools

```sh
npx @runchat/cli <tool> --arg value --arg2 value2
```

- Values are smart-typed: numbers / booleans / JSON arrays & objects are
  parsed; everything else is a string. Example:
  `--limit 5 --is_private true --tags '["x"]'`.
- Canvas tools require `--runchat_id <id>`. Get an id from `list_runchats` or
  `create_runchat`.
- For complex/nested arguments, pass the whole object: `--json '{...}'`.
- For large text (code, prompts), read from a file or stdin:
  `--new_text @file.js` or `--new_text @-`.
  Object/array arguments read from a file are parsed as JSON:
  `--inputs @inputs.json`.
- Output is JSON on stdout. `--raw` gives the server's exact text.

## Exit codes (branch on these)

`0` ok · `1` tool error · `2` usage error · `3` auth problem · `4` network.

## Typical flow

```sh
npx @runchat/cli guide
ID=$(npx @runchat/cli create_runchat --name "Demo" --raw | jq -r .id)
npx @runchat/cli create_node --runchat_id "$ID" --type inputNode --label "Topic"
npx @runchat/cli create_node --runchat_id "$ID" --type promptNode --label "Write"
# ...connect_nodes, organize_nodes...
npx @runchat/cli run_nodes --runchat_id "$ID"     # spends credits — confirm with the user first
```

> `run_nodes` and `execute_tool` spend the user's credits. Confirm before
> running anything with real cost.
