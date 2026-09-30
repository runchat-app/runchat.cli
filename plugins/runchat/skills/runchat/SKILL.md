---
name: runchat
description: Build, edit and run Runchat node-based AI workflows (runchat.com) from the terminal with the Runchat CLI. Use whenever the user mentions Runchat or asks to create, modify, run or publish a Runchat workflow, canvas, node, app or tool.
---

# Runchat

Runchat workflows are node graphs on a canvas (prompts, models, code, inputs,
outputs). The `@runchat/cli` command-line tool exposes every Runchat tool as a
command and describes itself at runtime, so nothing needs to be memorised.

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

## 2. Learn the tools

```sh
npx -y @runchat/cli guide            # how to build workflows — read this first
npx -y @runchat/cli tools            # every tool, one line each
npx -y @runchat/cli <tool> --help    # one tool's parameters
```

## 3. Call tools

```sh
npx -y @runchat/cli <tool> --arg value --other '{"json":true}'
```

- Canvas tools need `--runchat_id <id>` (from `list_runchats` or `create_runchat`).
- Values are smart-typed (numbers, booleans, JSON). Pass large text or JSON
  from a file with `--arg @file` or stdin with `--arg @-`.
- Exit codes: `0` ok · `1` tool error · `2` usage · `3` auth · `4` network.

`run_nodes` and `execute_tool` spend the user's Runchat credits — confirm with
the user before running anything with real cost.

Share the `editor_url` from results so the user can open the workflow in
Runchat.
