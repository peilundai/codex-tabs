import type { LaunchPlan } from "./types";

const COMMON_PYTHON_LOCATIONS = [
  "/usr/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
] as const;

export interface PythonProbe {
  platform: NodeJS.Platform;
  environment: NodeJS.Dict<string>;
  exists(filePath: string): boolean;
  run(
    executable: string,
    args: readonly string[],
    timeoutMilliseconds: number,
  ): { status: number | null };
}

export interface BridgeLaunch {
  executable: string;
  bridgeArgs: readonly string[];
  childCommand: readonly string[];
}

export function locatePythonWithPty(probe: PythonProbe): string | undefined {
  if (probe.platform === "win32") {
    return undefined;
  }

  const configured = [probe.environment.PYTHON3, probe.environment.PYTHON].filter(
    (value): value is string => Boolean(value),
  );
  const candidates = [
    ...new Set([
      ...configured,
      ...COMMON_PYTHON_LOCATIONS,
      ...pythonCandidatesOnPath(probe.environment),
    ]),
  ];
  for (const candidate of candidates) {
    if (!probe.exists(candidate)) {
      continue;
    }
    try {
      const result = probe.run(
        candidate,
        ["-c", "import fcntl, pty, select, termios, tty"],
        2_500,
      );
      if (result.status === 0) {
        return candidate;
      }
    } catch {
      // Continue through the bounded candidate list.
    }
  }
  return undefined;
}

function pythonCandidatesOnPath(environment: NodeJS.Dict<string>): readonly string[] {
  const directories = (environment.PATH ?? "")
    .split(":")
    .filter((entry) => entry.length > 0);
  const candidates: string[] = [];
  for (const name of ["python3", "python"]) {
    for (const directory of directories) {
      const trimmed = directory.endsWith("/") ? directory.slice(0, -1) : directory;
      candidates.push(`${trimmed}/${name}`);
    }
  }
  return candidates;
}

export function buildBridgeLaunch(
  launch: LaunchPlan,
  options: {
    python: string;
    bridgeScript: string;
    cwd?: string;
    titleMaxLength: number;
  },
): BridgeLaunch | undefined {
  if (launch.kind !== "loginShell") {
    return undefined;
  }
  const bridgeArgs = [
    "-u",
    options.bridgeScript,
    "--title-max-length",
    String(options.titleMaxLength),
  ];
  if (options.cwd) {
    bridgeArgs.push("--cwd", options.cwd);
  }
  return {
    executable: options.python,
    bridgeArgs,
    childCommand: [launch.executable, ...launch.args],
  };
}

export function wrapProfileWithBridge(
  commandLine: string,
  options: {
    python: string;
    bridgeScript: string;
    shell: string;
    cwd?: string;
    titleMaxLength: number;
  },
): string {
  const parts = [
    quoteShell(options.python),
    "-u",
    quoteShell(options.bridgeScript),
    "--title-max-length",
    String(options.titleMaxLength),
  ];
  if (options.cwd) {
    parts.push("--cwd", quoteShell(options.cwd));
  }
  parts.push(
    "--",
    quoteShell(options.shell),
    "-c",
    quoteShell(`exec ${commandLine}`),
  );
  return `exec ${parts.join(" ")}`;
}

function quoteShell(value: string): string {
  return value ? `'${value.replaceAll("'", `'\\''`)}'` : "''";
}

