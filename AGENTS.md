# Using the Runchat CLI (for agents)

This repo is a command-line port of the Runchat MCP server. Use it to build and
run Runchat node-based AI workflows from a shell. It is **self-describing** — at
runtime you can list every tool and read each tool's parameters, so you never
need hardcoded knowledge of the API.

If the Runchat MCP server's tools are already available in your session, use
those instead — they're the same tools. The CLI and MCP authenticate
independently (separate sessions for the same account), so having both
configured is fine.

## Setup (once)

Invoke with `npx -y @runchat/cli <...>` (no install) or `runchat <...>` if it's
installed globally. Check auth before doing work:

```sh
npx -y @runchat/cli status     # exit 0 = signed in, exit 3 = not signed in
```

If not signed in:

```sh
npx -y @runchat/cli login      # opens the user's browser; waits up to 5 min
```

`login` blocks until the user approves in the browser, so run it in the
background or with a long timeout, and tell the user a sign-in page has opened
(the command also prints the URL — relay it if the browser didn't open).
Never ask the user to paste an API key into chat; if browser sign-in isn't
possible, ask them to run `npx @runchat/cli login --paste` themselves or set
`RUNCHAT_API_KEY`.

## Quick recipe: generate an image

No `guide`/`list_models`/`get_model_params` needed — use the default image
model `runware:400@2`:

```sh
npx -y @runchat/cli create_runchat --name "Gehry museum"             # → id, editor_url
npx -y @runchat/cli create_image_node --runchat_id <id> --model_id runware:400@2 --params.prompt "..."   # → node id
npx -y @runchat/cli run_nodes --runchat_id <id> --node_ids <node_id> # → image URL
```

(If `run_nodes` shows no URL, use `read_nodes --runchat_id <id> --node_ids <node_id>`.)

## The only three commands you need to discover everything

```sh
npx @runchat/cli tools                 # all tools + their arguments (required first, [optional])
npx @runchat/cli <tool> <tool> --help  # full parameters for one or more tools
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
- Lists: `--node_ids a,b` or repeat the flag. Object fields: dotted flags,
  `--params.prompt "..." --params.seed 7`. Or pass JSON, or the whole
  argument object with `--json '{...}'`.
- Windows PowerShell strips double quotes inside '...' arguments — prefer the
  list and dotted-flag forms over inline JSON there.
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
