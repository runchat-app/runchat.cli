# runchat — Runchat CLI

[![npm](https://img.shields.io/npm/v/@runchat/cli.svg)](https://www.npmjs.com/package/@runchat/cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Build and run [Runchat](https://runchat.com) node-based AI workflows from the
terminal. Every Runchat tool is available as a command, with built-in help for
each.

```sh
npx @runchat/cli tools                  # list every tool
npx @runchat/cli list_runchats          # call a tool
npx @runchat/cli create_node --help     # read a tool's parameters
```

## Install

```sh
# one-off, always latest
npx @runchat/cli <command>

# or install globally
npm install -g @runchat/cli
runchat <command>
```

The npm package is `@runchat/cli`; the installed command is `runchat`. Requires
Node.js ≥ 18.

## Authenticate

The CLI authenticates with a **Runchat API key**.

1. Sign in at <https://runchat.com>
2. Account menu → **API keys** → create a key (shown once)
3. Provide it any of these ways (highest precedence first):

```sh
runchat <tool> --api-key rc_xxx          # per-command flag
export RUNCHAT_API_KEY=rc_xxx            # environment variable
runchat login                            # stores it in your user config
```

Check it anytime:

```sh
runchat status        # shows the server, your key (masked), and verifies it
```

OAuth access tokens also work — pass one as the Bearer token via `--api-key` /
`RUNCHAT_API_KEY`. See <https://runchat.com/auth.md> for details.

## Quickstart

```sh
export RUNCHAT_API_KEY=rc_xxx

# discover
runchat tools                                    # all tools, grouped
runchat guide                                     # the workflow-building guide
runchat create_node --help                        # one tool's parameters

# workspace
runchat list_runchats --query invoice --limit 5
runchat create_runchat --name "My flow" --tags '["demo"]'

# canvas tools take --runchat_id
ID=<runchat_id>
runchat get_canvas --runchat_id "$ID"
runchat create_node --runchat_id "$ID" --type promptNode --label "Summarize"
runchat run_nodes  --runchat_id "$ID"
```

## Discovering tools

You don't need to memorize anything — the CLI lists its tools and their
parameters at runtime:

| Command | What it shows |
| --- | --- |
| `runchat tools` | Every tool, grouped, with a one-line description |
| `runchat tools --json` | The raw tool definitions (name, description, schema) |
| `runchat <tool> --help` | A tool's full description and every parameter |
| `runchat guide` | The Runchat workflow-building guide |

Add `--refresh` to force an update of the cached tool list.

## Passing arguments

Arguments are plain `--flags`. Values are **smart-typed**:

```sh
--limit 5                 # number   → 5
--is_private true         # boolean  → true
--name "My flow"          # string   → "My flow"
--tags '["a","b"]'        # array    → ["a","b"]
--initial_data '{"code":["return 1"]}'   # object
```

Bare words stay strings (`--model gpt-4` → `"gpt-4"`), and id-like values are
preserved (`--x 007` → `"007"`). To pass the whole argument object at once:

```sh
runchat create_node --json '{"runchat_id":"abc","type":"promptNode"}'
# individual --flags override keys in --json
```

Read large values from a file or stdin (handy for code nodes):

```sh
runchat edit_file --runchat_id "$ID" --node_id n1 --new_text @app.js
cat app.js | runchat edit_file --runchat_id "$ID" --node_id n1 --new_text @-
```

File contents stay raw text, except for arguments the tool declares as an
object or array, which are parsed as JSON:

```sh
runchat update_node --runchat_id "$ID" --node_id n1 --inputs @inputs.json
```

Dashes and underscores in argument names are interchangeable
(`--runchat-id` == `--runchat_id`).

## Output & exit codes

Results print as pretty JSON. Use `--raw` for the server's exact text.

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | the tool reported an error |
| `2` | bad usage (unknown argument, missing tool name) |
| `3` | authentication problem (no/invalid key) |
| `4` | network failure |

## Configuration

| Variable | Purpose |
| --- | --- |
| `RUNCHAT_API_KEY` | API key (alias: `RUNCHAT_TOKEN`) |
| `RUNCHAT_BASE_URL` | Override the server (default `https://runchat.com`) |
| `RUNCHAT_CONFIG_DIR` | Override where config + cache are stored |

The config file lives at `%APPDATA%\runchat\config.json` (Windows) or
`~/.config/runchat/config.json` (macOS/Linux) and stores your API key.

## License

MIT
