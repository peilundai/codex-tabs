import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type { CodexPseudoterminal } from "../src/codexPseudoterminal";

type ModuleLoad = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

const loader = Module as unknown as { _load: ModuleLoad };
const originalLoad = loader._load;
loader._load = (request, parent, isMain) =>
  request === "vscode"
    ? { EventEmitter }
    : originalLoad.call(Module, request, parent, isMain);

function loadPty(): Promise<{
  CodexPseudoterminal: typeof CodexPseudoterminal;
}> {
  return import("../src/codexPseudoterminal");
}

test("PTY process exit is handled before onDidClose can drop the session", async () => {
  const { CodexPseudoterminal } = await loadPty();
  const order: string[] = [];
  const sessions = new Set(["tab"]);
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const timer = setTimeout(() => {
    rejectDone(new Error(`timed out: ${order.join(",")}`));
  }, 10_000);

  const pty = new CodexPseudoterminal({
    executable: process.execPath,
    bridgeArgs: ["-e", "process.exit(9)"],
    childCommand: [],
    environment: process.env,
    titleMaxLength: 28,
    onProcessExit: (code) => {
      // The old finish() fired onDidClose first. VS Code then removes the
      // terminal and the manager deletes the session before this guard.
      order.push(sessions.has("tab") ? `exit:${code}` : `exit-after-delete:${code}`);
      clearTimeout(timer);
      resolveDone();
      return "keep";
    },
  });
  pty.onDidClose((code) => {
    order.push(`close:${code ?? "none"}`);
    sessions.delete("tab");
    clearTimeout(timer);
    resolveDone();
  });
  pty.open(undefined);

  try {
    await done;
    assert.deepEqual(order, ["exit:9"]);
    assert.equal(sessions.has("tab"), true);
  } finally {
    clearTimeout(timer);
    pty.close();
  }
});

test("PTY exit that should close the tab still fires onDidClose afterward", async () => {
  const { CodexPseudoterminal } = await loadPty();
  const order: string[] = [];
  const sessions = new Set(["tab"]);
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const timer = setTimeout(() => {
    rejectDone(new Error(`timed out: ${order.join(",")}`));
  }, 10_000);

  const pty = new CodexPseudoterminal({
    executable: process.execPath,
    bridgeArgs: ["-e", "process.exit(9)"],
    childCommand: [],
    environment: process.env,
    titleMaxLength: 28,
    onProcessExit: (code) => {
      order.push(sessions.has("tab") ? `exit:${code}` : `exit-after-delete:${code}`);
      return "close";
    },
  });
  pty.onDidClose((code) => {
    order.push(`close:${code ?? "none"}`);
    sessions.delete("tab");
    clearTimeout(timer);
    resolveDone();
  });
  pty.open(undefined);

  try {
    await done;
    assert.deepEqual(order, ["exit:9", "close:9"]);
    assert.equal(sessions.has("tab"), false);
  } finally {
    clearTimeout(timer);
  }
});

test("host disposal is not reported as a process exit", async () => {
  const { CodexPseudoterminal } = await loadPty();
  const order: string[] = [];
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const timer = setTimeout(() => {
    rejectDone(new Error(`timed out: ${order.join(",")}`));
  }, 10_000);

  const pty = new CodexPseudoterminal({
    executable: process.execPath,
    bridgeArgs: ["-e", "setInterval(() => {}, 1000)"],
    childCommand: [],
    environment: process.env,
    titleMaxLength: 28,
    onProcessExit: (code) => {
      order.push(`exit:${code}`);
      return "keep";
    },
  });
  pty.onDidClose((code) => {
    order.push(`close:${code ?? "none"}`);
    clearTimeout(timer);
    resolveDone();
  });
  pty.open(undefined);
  pty.close();

  try {
    await done;
    assert.deepEqual(order, ["close:1"]);
  } finally {
    clearTimeout(timer);
    pty.close();
  }
});
