// `runchat setup claude` — install the Runchat skill for Claude Code, so an
// agent asked to "use Runchat" knows to reach for this CLI and how to sign in.
//
// The skill ships in this package (plugins/runchat/skills/runchat/SKILL.md —
// the same file the Claude Code plugin marketplace serves), and is copied to
// ~/.claude/skills/runchat/ (or ./.claude/skills/runchat/ with --project).

import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_NAME, EXIT } from "../constants.js";
import { c, err, info } from "../format.js";

const SKILL_SOURCE = fileURLToPath(
  new URL("../../plugins/runchat/skills/runchat/SKILL.md", import.meta.url)
);

export function setupCommand(
  target: string | undefined,
  flags: Record<string, unknown>
): number {
  if (target !== "claude") {
    err(`Usage: ${CLI_NAME} setup claude [--project]`);
    return EXIT.USAGE;
  }

  const root = flags["project"] === true ? process.cwd() : homedir();
  const dest = join(root, ".claude", "skills", "runchat", "SKILL.md");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(SKILL_SOURCE, dest);

  info(`${c.green("✓")} Installed the Runchat skill for Claude Code at ${c.dim(dest)}`);
  info(`  Next: \`${CLI_NAME} login\`, then ask Claude to "use Runchat to …".`);
  return EXIT.OK;
}
