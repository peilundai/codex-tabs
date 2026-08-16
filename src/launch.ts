import type { ExtensionConfiguration, LaunchPlan } from "./types";

const POSIX_SAFE = /^[A-Za-z0-9_./:=+,-]+$/;
const WINDOWS_SAFE = /^[A-Za-z0-9_./:\\=+,-]+$/;

export function buildLaunchPlan(
  configuration: Pick<
    ExtensionConfiguration,
    "command" | "args" | "launchMode"
  >,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string> = process.env,
): LaunchPlan {
  const command = configuration.command.trim() || "codex";
  const commandLine = buildCommandLine(command, configuration.args, platform);

  if (configuration.launchMode === "profile") {
    return { kind: "profile", commandLine };
  }

  if (platform === "win32") {
    return {
      kind: "loginShell",
      commandLine,
      executable: command,
      args: [...configuration.args],
    };
  }

  const fallbackShell = platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  return {
    kind: "loginShell",
    commandLine,
    executable: environment.SHELL || fallbackShell,
    args: ["-l", "-c", `exec ${commandLine}`],
  };
}

export function buildCommandLine(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): string {
  const quote = platform === "win32" ? quoteWindowsArgument : quotePosix;
  return [executable, ...args].map(quote).join(" ");
}

export function quotePosix(value: string): string {
  if (!value) {
    return "''";
  }
  return POSIX_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Formats one Windows argv value for the optional profile-mode command. */
export function quoteWindowsArgument(value: string): string {
  if (!value) {
    return '""';
  }
  if (WINDOWS_SAFE.test(value)) {
    return value;
  }

  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + "\\".repeat(backslashes * 2) + '"';
}

export function terminalEnvironment(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...base, COLORTERM: "truecolor" };
}

export function profileExitCommand(
  commandLine: string,
  platform: NodeJS.Platform,
): string {
  return platform === "win32"
    ? `${commandLine}\r\nexit`
    : `exec ${commandLine}`;
}
