// Detect the Windows cmd.exe newline cut.
//
// On Windows, npx (and a global `runchat.cmd` shim run from PowerShell or cmd)
// launches the CLI through `cmd.exe /d /s /c "<command line>"`. cmd stops
// reading at the first newline, so an inline multi-line value such as
// `--code "$(cat f.py)"` arrives as its first line only and every later flag is
// gone. The CLI can't recover the text, but cmd.exe's own command line still
// holds it in full — so when a text-like flag was given inline we ask Windows
// for the parent's command line, and refuse to send a cut-off value.

import { execFileSync } from "node:child_process";

/** Flag names that usually carry multi-line text (code, prompts, documents). */
const TEXT_FLAG =
  /(^|_)(code|text|content|contents|prompt|markdown|html|script|body|note|source|message)$/;

/** Text-like flags whose value was typed inline (not @file / @- / a boolean). */
export function inlineTextFlags(
  flags: Record<string, string | boolean | string[]>,
): string[] {
  return Object.entries(flags)
    .filter(([key, value]) => {
      if (!TEXT_FLAG.test(key.split(".").pop() ?? key)) return false;
      const values = [value].flat();
      return values.some((v) => typeof v === "string" && !v.startsWith("@"));
    })
    .map(([key]) => key);
}

/** True when the launching command line held a newline the CLI never saw. */
export function wasCutAtNewline(
  parentCommandLine: string | undefined,
  argv: string[],
): boolean {
  if (!parentCommandLine || !/[\r\n]/.test(parentCommandLine.trimEnd()))
    return false;
  // If our own argv already carries the newline, nothing was lost.
  return !argv.some((a) => /[\r\n]/.test(a));
}

/** Command line of the parent process (Windows only), or undefined. */
function parentCommandLine(): string | undefined {
  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${process.ppid}").CommandLine`,
      ],
      {
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return undefined; // best-effort: never block a call because the probe failed
  }
}

/**
 * Error text when an inline text flag was cut by cmd.exe, else undefined.
 * Only probes (≈1 s, one PowerShell call) on Windows with an inline text flag.
 */
export function checkCmdTruncation(
  argv: string[],
  flags: Record<string, string | boolean | string[]>,
): string | undefined {
  if (process.platform !== "win32" || process.env.RUNCHAT_SKIP_CMDLINE_CHECK)
    return undefined;
  const keys = inlineTextFlags(flags);
  if (keys.length === 0) return undefined;
  if (!wasCutAtNewline(parentCommandLine(), argv)) return undefined;
  const key = keys[0];
  return (
    `--${key} was cut off at its first line: on Windows the command runs through cmd.exe, ` +
    `which stops at the first newline and drops every later flag. Nothing was sent.\n` +
    `Pass multi-line text from a file or stdin instead:\n` +
    `  --${key} @file.txt\n` +
    `  cat file.txt | runchat <tool> ... --${key} @-`
  );
}
