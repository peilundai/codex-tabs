import path from "node:path";
import { EXTENSION_NAME, IMMEDIATE_EXIT_WINDOW_MS } from "./constants";
import { quoteWindowsArgument } from "./launch";
import type { LaunchMode, LaunchPlan } from "./types";

const MAX_CMD_SHIM_CHARS = 65_536;
const DP0_JS = /%(?:~dp0\\|dp0%\\)([^"%\r\n]+?\.js)(?=["\s]|$)/gi;
const DP0_NODE = /%(?:~dp0\\|dp0%\\)([^"%\r\n]*?node\.exe)/gi;

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
 * itself because it does not go through a shell. A recognized npm `.cmd`
 * shim is launched as `node.exe` plus its `.js` entry so arguments are not
 * expanded by `cmd.exe`.
 */
export function lookupCodexCommand(
  command: string,
  args: readonly string[],
  launchMode: LaunchMode,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
  exists: (filePath: string) => boolean,
  readFile?: (filePath: string) => string,
): CodexCommandLookup {
  const trimmed = command.trim() || "codex";
  if (isPathLike(trimmed)) {
    if (!exists(trimmed)) {
      return { status: "missing" };
    }
    if (platform === "win32" && launchMode === "loginShell") {
      return windowsInvocation(trimmed, args, environment, exists, readFile);
    }
    return { status: "deferred" };
  }

  if (platform === "win32" && launchMode === "loginShell") {
    const resolved = findOnWindowsPath(trimmed, environment, exists);
    if (!resolved) {
      return { status: "missing" };
    }
    return windowsInvocation(resolved, args, environment, exists, readFile);
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

/**
 * Builds one `cmd.exe /d /s /c` command line.
 *
 * Percent signs are left as written. Doubling them is a batch-file escape,
 * and `cmd /c` parses a command line, so `%%PATH%%` is still expanded.
 * Recognized npm shims do not use this path.
 */
export function cmdWrappedCommandLine(
  executable: string,
  args: readonly string[],
): string {
  const inner = [executable, ...args].map(quoteWindowsArgument).join(" ");
  return `"${inner}"`;
}

function windowsInvocation(
  executable: string,
  args: readonly string[],
  environment: NodeJS.Dict<string>,
  exists: (filePath: string) => boolean,
  readFile: ((filePath: string) => string) | undefined,
): CodexCommandLookup {
  if (/\.(cmd|bat)$/i.test(executable)) {
    const direct = nodeLaunchFromCmdShim(
      executable,
      args,
      environment,
      exists,
      readFile,
    );
    if (direct) {
      return { status: "direct", ...direct };
    }
    // CreateProcess cannot execute `.cmd` directly. An unrecognized shim
    // still goes through cmd.exe, which percent-expands `%NAME%` even inside
    // quotes. Set codexTabs.command to the underlying `.exe` or `.js` file
    // when those arguments must stay literal.
    return {
      status: "cmdShim",
      shell: environment.ComSpec || environment.COMSPEC || "cmd.exe",
      shellArgs: ["/d", "/s", "/c", cmdWrappedCommandLine(executable, args)],
    };
  }
  return { status: "direct", executable, args };
}

/**
 * npm's `.cmd` shim forwards `%*` to a `.js` entry beside `node.exe`.
 * Spawning that pair keeps the caller's arguments off the cmd command line.
 * The batch preamble is not executed: a standard shim only uses it to find
 * `node` and forward arguments. A shim that sets other variables, or whose
 * script cannot be identified, returns undefined so the caller can fall back.
 */
function nodeLaunchFromCmdShim(
  shimPath: string,
  args: readonly string[],
  environment: NodeJS.Dict<string>,
  exists: (filePath: string) => boolean,
  readFile: ((filePath: string) => string) | undefined,
): { executable: string; args: readonly string[] } | undefined {
  if (!readFile) {
    return undefined;
  }
  let source: string;
  try {
    source = readFile(shimPath);
  } catch {
    return undefined;
  }
  if (source.length === 0 || source.length > MAX_CMD_SHIM_CHARS) {
    return undefined;
  }

  const directory = path.win32.dirname(shimPath);
  const scripts = new Set<string>();
  for (const match of source.matchAll(DP0_JS)) {
    const relative = match[1];
    const index = match.index ?? 0;
    if (!relative || !forwardsArguments(source, index)) {
      continue;
    }
    scripts.add(path.win32.normalize(path.win32.join(directory, relative)));
  }
  if (scripts.size !== 1) {
    return undefined;
  }
  const script = [...scripts][0];
  if (!script || !exists(script)) {
    return undefined;
  }

  const nodeExecutable =
    referencedNodeExecutable(source, directory, exists) ??
    findOnWindowsPath("node", environment, exists);
  if (!nodeExecutable) {
    return undefined;
  }
  return { executable: nodeExecutable, args: [script, ...args] };
}

function referencedNodeExecutable(
  source: string,
  directory: string,
  exists: (filePath: string) => boolean,
): string | undefined {
  let fallback: string | undefined;
  for (const match of source.matchAll(DP0_NODE)) {
    const relative = match[1];
    if (relative === undefined) {
      continue;
    }
    const candidate = path.win32.normalize(path.win32.join(directory, relative));
    if (!exists(candidate)) {
      continue;
    }
    if (forwardsArguments(source, match.index ?? 0)) {
      return candidate;
    }
    fallback ??= candidate;
  }
  return fallback;
}

function forwardsArguments(source: string, index: number): boolean {
  const line = lineAt(source, index);
  return line.includes("%*") && !/^\s*(?:@?rem\b|::)/i.test(line);
}

function lineAt(source: string, index: number): string {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end === -1 ? source.length : end);
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
