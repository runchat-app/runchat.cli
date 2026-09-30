---
name: runchat
description: Build, edit and run Runchat node-based AI workflows (runchat.com) from the terminal with the Runchat CLI. Use whenever the user mentions Runchat or asks to create, modify, run or publish a Runchat workflow, canvas, node, app or tool.
---

# Runchat

Runchat workflows are node graphs on a canvas (prompts, models, code, inputs,
outputs). The `@runchat/cli` command-line tool exposes every Runchat tool as a
command and describes itself at runtime, so nothing needs to be memorised.

If Runchat MCP tools are already available in this session (e.g.
`mcp__runchat__*`), use those instead of the CLI — they are the same tools,
already authenticated. Otherwise use the CLI as below.

Run it with `npx -y @runchat/cli <command>` (or `runchat <command>` if it is
installed globally). Output is JSON on stdout; messages go to stderr.

## 1. Make sure you're signed in

```sh
npx -y @runchat/cli status
```

Exit code `0` = signed in, carry on. Exit code `3` = not signed in:

```sh
npx -y @runchat/cli login
```

`login` opens the user's browser to sign in to Runchat and **waits** (up to 5
minutes) until they approve, then saves a session that refreshes itself.

- Run it in the background (or with a long timeout, e.g. 6 minutes) so it
  isn't killed while the user is signing in.
- Tell the user a Runchat sign-in page has opened in their browser. The
  command also prints the sign-in URL; if the browser didn't open, give the
  user that URL.
- Never ask the user to paste an API key into the chat. If browser sign-in
  isn't possible (remote/headless machine), ask them to run
  `npx @runchat/cli login --paste` in their own terminal, or to set
  `RUNCHAT_API_KEY` themselves.

## 2. Quick recipe: generate an image

For a one-off image you don't need `guide`, `list_models` or
`get_model_params`: use the default image model `runware:400@2` with a
`prompt` param.

```sh
npx -y @runchat/cli create_runchat --name "Gehry museum"                      # → id, editor_url
npx -y @runchat/cli create_image_node --runchat_id <id> --model_id runware:400@2 --params.prompt "Deconstructivist museum by Frank Gehry, titanium curves, golden hour"   # → node id
npx -y @runchat/cli run_nodes --runchat_id <id> --node_ids <node_id>          # → output image URL
```

If the `run_nodes` result has no URL, fetch it with
`read_nodes --runchat_id <id> --node_ids <node_id>`. Give the user the image
URL and the `editor_url`. Use `list_models --modality image` only when the
user wants a specific model or style of model.

## 3. Anything bigger: learn the tools

```sh
npx -y @runchat/cli guide                  # how to build workflows — read before multi-node work
npx -y @runchat/cli tools                  # every tool with its arguments (required first, [optional])
npx -y @runchat/cli <tool> <tool> --help   # full parameters for one or more tools
```

## 4. Calling tools

```sh
npx -y @runchat/cli <tool> --arg value --obj.field value --list a,b
```

- Canvas tools need `--runchat_id <id>` (from `list_runchats` or `create_runchat`).
- Lists: `--node_ids a,b`, or repeat the flag (`--node_ids a --node_ids b`).
- Objects: set fields with dotted flags (`--params.prompt "..." --params.seed 7`),
  or pass JSON. Large text or JSON can come from a file (`--arg @file`) or
  stdin (`--arg @-`).
- **Windows PowerShell strips the double quotes inside '...' arguments**, so
  prefer the list and dotted-flag forms above over inline JSON.
- Exit codes: `0` ok · `1` tool error · `2` usage · `3` auth · `4` network.

`run_nodes` and `execute_tool` spend the user's Runchat credits. A single
default-model image is cheap; confirm with the user before expensive models,
video, or many runs.

Share the `editor_url` from results so the user can open the workflow in
Runchat.
