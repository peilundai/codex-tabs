import assert from "node:assert/strict";
import test from "node:test";
import { buildLaunchPlan } from "../src/launch";
import {
  applyCommandLookup,
  isImmediateFailure,
  lookupCodexCommand,
  missingCommandMessage,
} from "../src/launchDiagnostics";

test("Unix bare names stay deferred and missing absolute paths do not", () => {
  assert.deepEqual(
    lookupCodexCommand("codex", [], "loginShell", "linux", { PATH: "" }, () => false),
    { status: "deferred" },
  );
  assert.deepEqual(
    lookupCodexCommand("/opt/codex", [], "loginShell", "darwin", {}, () => false),
    { status: "missing" },
  );
  assert.deepEqual(
    lookupCodexCommand(
      "/opt/codex",
      [],
      "loginShell",
      "darwin",
      {},
      (candidate) => candidate === "/opt/codex",
    ),
    { status: "deferred" },
  );
});

test("Windows loginShell prefers an exe and wraps a cmd shim without expansion", () => {
  assert.deepEqual(
    lookupCodexCommand(
      "codex",
      ["--model", "%literal%"],
      "loginShell",
      "win32",
      { PATH: "C:\\Tools", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      (candidate) =>
        candidate === "C:\\Tools\\codex.EXE" || candidate === "C:\\Tools\\codex.CMD",
    ),
    {
      status: "direct",
      executable: "C:\\Tools\\codex.EXE",
      args: ["--model", "%literal%"],
    },
  );

  assert.deepEqual(
    lookupCodexCommand(
      "codex",
      ["--model", "%literal%"],
      "loginShell",
      "win32",
      {
        PATH: "C:\\Tools",
        PATHEXT: ".CMD",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      (candidate) => candidate === "C:\\Tools\\codex.CMD",
    ),
    {
      status: "cmdShim",
      shell: "C:\\Windows\\System32\\cmd.exe",
      shellArgs: [
        "/d",
        "/s",
        "/c",
        '"C:\\Tools\\codex.CMD --model "%%literal%%""',
      ],
    },
  );

  assert.deepEqual(
    lookupCodexCommand(
      "C:\\Program Files\\codex.cmd",
      [],
      "loginShell",
      "win32",
      {},
      (candidate) => candidate === "C:\\Program Files\\codex.cmd",
    ),
    {
      status: "cmdShim",
      shell: "cmd.exe",
      shellArgs: ["/d", "/s", "/c", '""C:\\Program Files\\codex.cmd""'],
    },
  );
});

test("Windows profile mode lets the terminal shell resolve a bare name", () => {
  assert.deepEqual(
    lookupCodexCommand("codex", [], "profile", "win32", { PATH: "C:\\Tools" }, () => false),
    { status: "deferred" },
  );
  assert.equal(
    lookupCodexCommand(
      "C:\\missing\\codex.exe",
      [],
      "profile",
      "win32",
      {},
      () => false,
    ).status,
    "missing",
  );
});

test("Windows resolution replaces only the direct login-shell invocation", () => {
  const plan = buildLaunchPlan(
    { command: "codex", args: ["resume"], launchMode: "loginShell" },
    "win32",
  );
  const resolved = applyCommandLookup(plan, {
    status: "direct",
    executable: "C:\\codex.exe",
    args: ["resume"],
  });
  assert.equal(resolved.kind, "loginShell");
  if (resolved.kind === "loginShell") {
    assert.equal(resolved.executable, "C:\\codex.exe");
    assert.deepEqual(resolved.args, ["resume"]);
  }

  const profile = buildLaunchPlan(
    { command: "codex", args: [], launchMode: "profile" },
    "win32",
  );
  assert.equal(
    applyCommandLookup(profile, {
      status: "direct",
      executable: "C:\\codex.exe",
      args: [],
    }),
    profile,
  );
});

test("immediate failures are non-zero exits inside the startup window", () => {
  assert.equal(isImmediateFailure(127, 500), true);
  assert.equal(isImmediateFailure(0, 10), false);
  assert.equal(isImmediateFailure(undefined, 10), false);
  assert.equal(isImmediateFailure(1, 4_000), false);
  assert.match(missingCommandMessage("codex"), /does not install or authenticate/);
});
