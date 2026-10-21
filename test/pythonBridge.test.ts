import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildBridgeLaunch,
  locatePythonWithPty,
} from "../src/pythonBridge";

const bridge = path.resolve("scripts/codex-pty-bridge.py");
const runtimePython = locatePythonWithPty({
  platform: process.platform,
  environment: process.env,
  exists: existsSync,
  run: (executable, args, timeoutMilliseconds) =>
    spawnSync(executable, [...args], { timeout: timeoutMilliseconds }),
});

test("Python discovery checks PATH after well-known locations", () => {
  assert.equal(
    locatePythonWithPty({
      platform: "linux",
      environment: { PATH: "/custom/bin:/usr/bin" },
      exists: (candidate) => candidate === "/custom/bin/python3",
      run: () => ({ status: 0 }),
    }),
    "/custom/bin/python3",
  );
  assert.equal(
    locatePythonWithPty({
      platform: "linux",
      environment: { PATH: "/custom/bin" },
      exists: (candidate) =>
        candidate === "/usr/bin/python3" || candidate === "/custom/bin/python",
      run: (executable) => ({ status: executable.endsWith("/python3") ? 0 : 1 }),
    }),
    "/usr/bin/python3",
  );
});

test("Python discovery is disabled on Windows and bounded elsewhere", () => {
  assert.equal(
    locatePythonWithPty({
      platform: "win32",
      environment: {},
      exists: () => true,
      run: () => ({ status: 0 }),
    }),
    undefined,
  );
  assert.equal(
    locatePythonWithPty({
      platform: "darwin",
      environment: { PYTHON3: "/custom/python" },
      exists: (candidate) => candidate === "/custom/python",
      run: () => ({ status: 0 }),
    }),
    "/custom/python",
  );
});

test("bridge plans preserve the exact child executable and arguments", () => {
  assert.deepEqual(
    buildBridgeLaunch(
      {
        kind: "loginShell",
        commandLine: "codex",
        executable: "/bin/zsh",
        args: ["-l", "-c", "exec codex"],
      },
      {
        python: "/usr/bin/python3",
        bridgeScript: bridge,
        cwd: "/work",
        titleMaxLength: 24,
      },
    ),
    {
      executable: "/usr/bin/python3",
      bridgeArgs: [
        "-u",
        bridge,
        "--title-max-length",
        "24",
        "--cwd",
        "/work",
      ],
      childCommand: ["/bin/zsh", "-l", "-c", "exec codex"],
    },
  );
});

test(
  "bridge helper modes rewrite paths and Codex titles without dependencies",
  { skip: !runtimePython },
  () => {
    const input = spawnSync(
      runtimePython as string,
      [bridge, "--cwd", "/etc", "--rewrite-input-only"],
      { input: "/etc/hosts", encoding: "utf8" },
    );
    assert.equal(input.status, 0, input.stderr);
    assert.equal(input.stdout, "@hosts");

    const title = spawnSync(
      runtimePython as string,
      [bridge, "--title-max-length", "12", "--rewrite-output-only"],
      { input: "\u001b]0;Codex - a very long session - app\u0007", encoding: "utf8" },
    );
    assert.equal(title.status, 0, title.stderr);
    assert.equal(title.stdout, "\u001b]0;a very long…\u0007");

    const generatedTitle = spawnSync(
      runtimePython as string,
      [bridge, "--title-max-length", "18", "--rewrite-output-only"],
      {
        input: "\u001b]0;Codex | Generated session name\u0007",
        encoding: "utf8",
      },
    );
    assert.equal(generatedTitle.status, 0, generatedTitle.stderr);
    assert.equal(generatedTitle.stdout, "\u001b]0;Generated session…\u0007");

    const unnamedTitle = spawnSync(
      runtimePython as string,
      [bridge, "--rewrite-output-only"],
      {
        input:
          "\u001b]0;codex | 01901234-5678-7abc-8def-0123456789ab | " +
          "01901234-5678-7abc-8def-0123456789ab\u0007",
        encoding: "utf8",
      },
    );
    assert.equal(unnamedTitle.status, 0, unnamedTitle.stderr);
    assert.equal(unnamedTitle.stdout, "\u001b]0;Codex CLI\u0007");

    const codex147Id = "01a008d4-daff-7b61-8be9-9d87850e009d";
    const codex147TruncatedId = `${codex147Id.slice(0, 29)}...`;
    const codex147Title = spawnSync(
      runtimePython as string,
      [bridge, "--rewrite-output-only"],
      {
        input: `\u001b]0;codex | ${codex147TruncatedId} | ${codex147Id}\u0007`,
        encoding: "utf8",
      },
    );
    assert.equal(codex147Title.status, 0, codex147Title.stderr);
    assert.equal(codex147Title.stdout, "\u001b]0;Codex CLI\u0007");
    assert.equal(codex147Title.stdout.includes(codex147Id), false);
    assert.equal(codex147Title.stdout.includes(codex147TruncatedId), false);

    const unrelatedTitle = spawnSync(
      runtimePython as string,
      [bridge, "--rewrite-output-only"],
      { input: "\u001b]0;zsh\u0007", encoding: "utf8" },
    );
    assert.equal(unrelatedTitle.status, 0, unrelatedTitle.stderr);
    assert.equal(unrelatedTitle.stdout, "");

    const relay = spawnSync(
      runtimePython as string,
      [
        bridge,
        "--columns",
        "40",
        "--rows",
        "10",
        "--",
        runtimePython as string,
        "-c",
        "import os; os.write(1, b'\\x1b]0;Codex - a very long session title for test - app\\x07')",
      ],
      { input: "", encoding: "utf8" },
    );
    assert.equal(relay.status, 0, relay.stderr);
    assert.equal(relay.stdout.includes("a very long session title for test"), false);
    assert.equal(relay.stdout.includes("a very long session title for test".slice(0, 23)), true);
  },
);

test(
  "PTY relay follows generated, resumed, and switched Codex session titles",
  { skip: !runtimePython, timeout: 8_000 },
  () => {
    const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-tabs-title-"));
    const database = path.join(codexHome, "state_5.sqlite");
    const firstId = "01901234-5678-7abc-8def-0123456789ab";
    const secondId = "02901234-5678-7abc-8def-0123456789ac";
    const createDatabase = [
      "import sqlite3, sys",
      "db=sqlite3.connect(sys.argv[1])",
      "db.execute('create table threads (id text primary key, name text, title text, preview text)')",
      "db.execute('insert into threads values (?, ?, ?, ?)', (sys.argv[2], None, '', ''))",
      "db.execute('insert into threads values (?, ?, ?, ?)', (sys.argv[3], 'Manual name', 'Generated fallback', 'Preview'))",
      "db.commit()",
      "db.close()",
    ].join(";");
    const created = spawnSync(
      runtimePython as string,
      ["-c", createDatabase, database, firstId, secondId],
      { encoding: "utf8" },
    );
    assert.equal(created.status, 0, created.stderr);

    try {
      const childProgram = [
        "import os, sqlite3, sys, time",
        `first=${JSON.stringify(firstId)}`,
        `second=${JSON.stringify(secondId)}`,
        "def identity(value): return value[:29] + '...'",
        "def title(value):",
        " os.write(1, ('\\x1b]0;' + value + '\\x07').encode())",
        "title(f'codex | {identity(first)} | {first}')",
        "time.sleep(0.25)",
        "db=sqlite3.connect(os.path.join(os.environ['CODEX_HOME'], 'state_5.sqlite'))",
        "db.execute('update threads set title=? where id=?', ('Generated' + chr(7) + ' title for work', first))",
        "db.commit()",
        "db.close()",
        "time.sleep(1.1)",
        "title(f'codex | {identity(second)} | Manual name')",
        "time.sleep(0.2)",
      ].join("\n");
      const relay = spawnSync(
        runtimePython as string,
        [
          "-u",
          bridge,
          "--title-max-length",
          "28",
          "--",
          runtimePython as string,
          "-u",
          "-c",
          childProgram,
        ],
        {
          input: "",
          encoding: "utf8",
          timeout: 7_000,
          env: { ...process.env, CODEX_HOME: codexHome },
        },
      );
      assert.equal(relay.status, 0, relay.stderr);
      assert.equal(relay.stdout.includes(firstId), false);
      assert.equal(relay.stdout.includes(secondId), false);
      assert.equal(relay.stdout.includes("\u001b]0;Codex CLI\u0007"), true);
      assert.equal(
        relay.stdout.includes("\u001b]0;Generated title for work\u0007"),
        true,
      );
      assert.equal(relay.stdout.includes("\u001b]0;Manual name\u0007"), true);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  },
);

test(
  "truncated session prefixes require one unique metadata match",
  { skip: !runtimePython, timeout: 5_000 },
  () => {
    const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-tabs-prefix-"));
    const database = path.join(codexHome, "state_5.sqlite");
    const firstId = "01901234-5678-7abc-8def-0123456789ab";
    const secondId = "01901234-5678-7abc-8def-0123456789ac";
    const prefix = firstId.slice(0, 29);
    const createDatabase = [
      "import sqlite3, sys",
      "db=sqlite3.connect(sys.argv[1])",
      "db.execute('create table threads (id text primary key, name text, title text, preview text)')",
      "db.execute('insert into threads values (?, ?, ?, ?)', (sys.argv[2], None, '', ''))",
      "db.execute('insert into threads values (?, ?, ?, ?)', (sys.argv[3], None, 'Wrong second title', ''))",
      "db.commit()",
      "db.close()",
    ].join(";");
    const created = spawnSync(
      runtimePython as string,
      ["-c", createDatabase, database, firstId, secondId],
      { encoding: "utf8" },
    );
    assert.equal(created.status, 0, created.stderr);

    try {
      const relay = spawnSync(
        runtimePython as string,
        [
          "-u",
          bridge,
          "--",
          runtimePython as string,
          "-c",
          `import os,time; os.write(1, b'\\x1b]0;codex | ${prefix}... | ${firstId}\\x07'); time.sleep(0.2); os.write(1, b'\\x1b]0;codex | ${prefix}... | Explicit name\\x07'); time.sleep(1.2)`,
        ],
        {
          input: "",
          encoding: "utf8",
          timeout: 4_000,
          env: { ...process.env, CODEX_HOME: codexHome },
        },
      );
      assert.equal(relay.status, 0, relay.stderr);
      assert.equal(relay.stdout.includes("Explicit name"), true);
      assert.equal(relay.stdout.includes("Wrong second title"), false);
      assert.equal(relay.stdout.includes(prefix), false);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  },
);

test(
  "PTY title tracking degrades safely when Codex metadata is unavailable",
  { skip: !runtimePython, timeout: 5_000 },
  () => {
    const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-tabs-schema-"));
    const database = path.join(codexHome, "state_99.sqlite");
    const threadId = "01901234-5678-7abc-8def-0123456789ad";
    const created = spawnSync(
      runtimePython as string,
      [
        "-c",
        "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('create table unrelated (value text)'); db.commit(); db.close()",
        database,
      ],
      { encoding: "utf8" },
    );
    assert.equal(created.status, 0, created.stderr);

    try {
      const relay = spawnSync(
        runtimePython as string,
        [
          "-u",
          bridge,
          "--",
          runtimePython as string,
          "-c",
          `import os,time; os.write(1, b'\\x1b]0;codex | ${threadId} | ${threadId}\\x07'); time.sleep(0.15)`,
        ],
        {
          input: "",
          encoding: "utf8",
          timeout: 4_000,
          env: { ...process.env, CODEX_HOME: codexHome },
        },
      );
      assert.equal(relay.status, 0, relay.stderr);
      assert.equal(relay.stdout.includes(threadId), false);
      assert.equal(relay.stdout.includes("\u001b]0;Codex CLI\u0007"), true);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  },
);

test(
  "PTY relay applies per-terminal resize controls",
  { skip: !runtimePython, timeout: 5_000 },
  async () => {
    const sizeProbe = [
      "import fcntl, struct, termios, time",
      "def size(): return struct.unpack('HHHH', fcntl.ioctl(0, termios.TIOCGWINSZ, bytes(8)))[:2]",
      "print(*size(), flush=True)",
      "deadline=time.time()+2",
      "while time.time()<deadline and size() != (40,120): time.sleep(0.02)",
      "print(*size(), flush=True)",
    ].join("\n");
    const child = spawn(
      runtimePython as string,
      [
        "-u",
        bridge,
        "--columns",
        "80",
        "--rows",
        "24",
        "--control-fd",
        "3",
        "--",
        runtimePython as string,
        "-u",
        "-c",
        sizeProbe,
      ],
      { stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (output.includes("24 80")) {
        const resizeControl = child.stdio[3];
        if (resizeControl && "write" in resizeControl) {
          resizeControl.write("120 40\n");
        }
      }
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(exitCode, 0);
    assert.match(output, /24 80/);
    assert.match(output, /40 120/);
  },
);

test(
  "PTY relay forwards terminal termination to the Codex process",
  { skip: !runtimePython, timeout: 5_000 },
  async () => {
    const signalProbe = [
      "import signal, sys, time",
      "def stop(*_):",
      " print('stopped', flush=True)",
      " sys.exit(0)",
      "signal.signal(signal.SIGTERM, stop)",
      "print('ready', flush=True)",
      "while True: time.sleep(1)",
    ].join("\n");
    const child = spawn(
      runtimePython as string,
      ["-u", bridge, "--", runtimePython as string, "-u", "-c", signalProbe],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let terminationSent = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (!terminationSent && output.includes("ready")) {
        terminationSent = true;
        child.kill("SIGTERM");
      }
    });
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 0, signal: null });
    assert.match(output, /stopped/);
  },
);

test(
  "PTY relay rewrites an existing dropped path before the child reads it",
  { skip: !runtimePython, timeout: 5_000 },
  () => {
    const reader = [
      "import os, termios",
      "settings=termios.tcgetattr(0)",
      "settings[3]&=~(termios.ICANON|termios.ECHO)",
      "settings[6][termios.VMIN]=1",
      "settings[6][termios.VTIME]=0",
      "termios.tcsetattr(0, termios.TCSANOW, settings)",
      "os.write(1, os.read(0, 4096))",
    ].join(";");
    const result = spawnSync(
      runtimePython as string,
      [
        "-u",
        bridge,
        "--cwd",
        "/etc",
        "--",
        runtimePython as string,
        "-c",
        reader,
      ],
      { input: "/etc/hosts", encoding: "utf8", timeout: 5_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("/etc/hosts"), false);
    assert.equal(result.stdout.includes("@hosts"), true);
  },
);
