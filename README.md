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

```sh
runchat login
```

This opens your browser to sign in to Runchat and approve the CLI, then saves
a session that refreshes itself. It works from coding agents too (no terminal
input needed). Use `--no-browser` to just print the sign-in URL, and
`--timeout <seconds>` to change how long it waits (default 300).

Prefer an API key (CI, headless machines)?

```sh
runchat login --paste                    # opens runchat.com to create a key, then paste it
runchat login --api-key <key>            # or save a key you already have
echo "$KEY" | runchat login              # or pipe it in
export RUNCHAT_API_KEY=<key>             # or don't store anything
runchat <tool> --api-key <key>           # per command
```

Precedence: `--api-key` flag > `RUNCHAT_API_KEY` env > saved key > saved
browser session.

```sh
runchat status        # who you're signed in as; exit 3 = not signed in
runchat logout        # remove saved credentials
```

## Use with Claude Code

Install the Runchat skill so Claude knows to use this CLI whenever you mention
Runchat:

```sh
npx @runchat/cli setup claude            # installs ~/.claude/skills/runchat
```

or add it as a plugin from inside Claude Code:

```
/plugin marketplace add runchat-app/runchat.cli
/plugin install runchat@runchat
```

Then just ask: *"use Runchat to build a workflow that …"*. Claude will sign
you in through the browser the first time.

## Quickstart

```sh
runchat login

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
| `3` | authentication problem (not signed in / invalid key) |
| `4` | network failure |

## Configuration

| Variable | Purpose |
| --- | --- |
| `RUNCHAT_API_KEY` | API key (alias: `RUNCHAT_TOKEN`) |
| `RUNCHAT_BASE_URL` | Override the server (default `https://runchat.com`) |
| `RUNCHAT_CONFIG_DIR` | Override where config + cache are stored |
| `RUNCHAT_NO_BROWSER` | Print sign-in URLs instead of opening a browser |

The config file lives at `%APPDATA%\runchat\config.json` (Windows) or
`~/.config/runchat/config.json` (macOS/Linux) and stores your API key or
browser session. Set `RUNCHAT_NO_BROWSER=1` to never open a browser.

## License

MIT
