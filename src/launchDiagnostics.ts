import { EXTENSION_NAME, IMMEDIATE_EXIT_WINDOW_MS } from "./constants";
import { quoteWindowsArgument } from "./launch";
import type { LaunchMode, LaunchPlan } from "./types";

export type CodexCommandLookup =
  | { status: "deferred" }
  | { status: "missing" }
  | { status: "direct"; executable: string; args: readonly string[] }
  | { status: "cmdShim"; shell: string; shellArgs: readonly string[] };

/**
 * Decides whether a configured Codex command can be launched.
 *
 * Bare names on Unix, and profile mode on every platform, stay deferred:
 * a login shell or the user's terminal profile may resolve them. Absolute
 * paths are checked everywhere. Windows `loginShell` mode resolves PATH
 * itself because it does not go through a shell.
 */
export function lookupCodexCommand(
  command: string,
  args: readonly string[],
  launchMode: LaunchMode,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
  exists: (filePath: string) => boolean,
): CodexCommandLookup {
  const trimmed = command.trim() || "codex";
  if (isPathLike(trimmed)) {
    if (!exists(trimmed)) {
      return { status: "missing" };
    }
    if (platform === "win32" && launchMode === "loginShell") {
      return windowsInvocation(trimmed, args, environment);
    }
    return { status: "deferred" };
  }

  if (platform === "win32" && launchMode === "loginShell") {
    const resolved = findOnWindowsPath(trimmed, environment, exists);
    if (!resolved) {
      return { status: "missing" };
    }
    return windowsInvocation(resolved, args, environment);
  }

  return { status: "deferred" };
}

export function applyCommandLookup(
  plan: LaunchPlan,
  lookup: CodexCommandLookup,
): LaunchPlan {
  if (plan.kind !== "loginShell") {
    return plan;
  }
  if (lookup.status === "direct") {
    return { ...plan, executable: lookup.executable, args: lookup.args };
  }
  if (lookup.status === "cmdShim") {
    return { ...plan, executable: lookup.shell, args: lookup.shellArgs };
  }
  return plan;
}

export function missingCommandMessage(command: string): string {
  return (
    `${EXTENSION_NAME} could not find "${command}". Install Codex CLI, sign in, ` +
    "and set codexTabs.command to an executable name or absolute path. " +
    "This extension does not install or authenticate Codex."
  );
}

export function immediateExitMessage(command: string, exitCode: number): string {
  return (
    `${EXTENSION_NAME} exited immediately (status ${exitCode}). The tab was left ` +
    `open so you can read its output. Confirm that "${command}" runs in a terminal ` +
    "and that you are signed in. This extension does not install or authenticate Codex."
  );
}

export function isImmediateFailure(
  exitCode: number | undefined,
  ageMilliseconds: number,
  windowMilliseconds = IMMEDIATE_EXIT_WINDOW_MS,
): boolean {
  return (
    typeof exitCode === "number" &&
    exitCode !== 0 &&
    ageMilliseconds >= 0 &&
    ageMilliseconds < windowMilliseconds
  );
}

export function cmdWrappedCommandLine(
  executable: string,
  args: readonly string[],
): string {
  const inner = [executable, ...args]
    .map((value) => quoteWindowsArgument(value.replaceAll("%", "%%")))
    .join(" ");
  return `"${inner}"`;
}

function windowsInvocation(
  executable: string,
  args: readonly string[],
  environment: NodeJS.Dict<string>,
): CodexCommandLookup {
  if (/\.(cmd|bat)$/i.test(executable)) {
    return {
      status: "cmdShim",
      shell: environment.ComSpec || environment.COMSPEC || "cmd.exe",
      shellArgs: ["/d", "/s", "/c", cmdWrappedCommandLine(executable, args)],
    };
  }
  return { status: "direct", executable, args };
}

function findOnWindowsPath(
  command: string,
  environment: NodeJS.Dict<string>,
  exists: (filePath: string) => boolean,
): string | undefined {
  const pathValue = environment.PATH ?? environment.Path ?? "";
  const directories = pathValue.split(";").filter((entry) => entry.length > 0);
  const extensions = hasWindowsExtension(command)
    ? [""]
    : (environment.PATHEXT ?? environment.Pathext ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter((entry) => entry.length > 0);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = joinWindows(directory, `${command}${extension}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function hasWindowsExtension(command: string): boolean {
  return /\.[^\\/]+$/.test(command);
}

function isPathLike(command: string): boolean {
  return (
    command.includes("/") ||
    command.includes("\\") ||
    /^[A-Za-z]:/.test(command)
  );
}

function joinWindows(directory: string, name: string): string {
  const trimmed = directory.replace(/[\\/]+$/, "");
  const slash = trimmed.includes("/") && !trimmed.includes("\\") ? "/" : "\\";
  return `${trimmed}${slash}${name}`;
}
