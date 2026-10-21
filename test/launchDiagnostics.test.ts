import assert from "node:assert/strict";
import path from "node:path";
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

test("Windows loginShell prefers an exe and quotes an unrecognized cmd shim", () => {
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
        '"C:\\Tools\\codex.CMD --model "%literal%""',
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

test("Windows loginShell runs an npm cmd shim through node without percent expansion", () => {
  const shim = [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  ].join("\r\n");
  const shimPath = "C:\\Tools\\codex.CMD";
  const script = npmScript(shimPath);
  const localNode = "C:\\Tools\\node.exe";
  assert.deepEqual(
    lookupCodexCommand(
      "codex",
      ["--model", "%PATH%"],
      "loginShell",
      "win32",
      { PATH: "C:\\Tools;C:\\nodejs", PATHEXT: ".CMD;.EXE" },
      (candidate) =>
        candidate === shimPath ||
        candidate === script ||
        candidate === localNode ||
        candidate === "C:\\nodejs\\node.EXE",
      (filePath) => {
        assert.equal(filePath, shimPath);
        return shim;
      },
    ),
    {
      status: "direct",
      executable: localNode,
      args: [script, "--model", "%PATH%"],
    },
  );

  const legacyShim = [
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ") ELSE (",
    "  @SETLOCAL",
    "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
    '  node  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ")",
  ].join("\r\n");
  const legacyPath = "C:\\Npm\\codex.cmd";
  const legacyScript = npmScript(legacyPath);
  assert.deepEqual(
    lookupCodexCommand(
      legacyPath,
      ["--model", "%PATH%"],
      "loginShell",
      "win32",
      { PATH: "C:\\nodejs", PATHEXT: ".EXE" },
      (candidate) =>
        candidate === legacyPath ||
        candidate === legacyScript ||
        candidate === "C:\\nodejs\\node.EXE",
      () => legacyShim,
    ),
    {
      status: "direct",
      executable: "C:\\nodejs\\node.EXE",
      args: [legacyScript, "--model", "%PATH%"],
    },
  );

  const missingScript = lookupCodexCommand(
    shimPath,
    ["--model", "%PATH%"],
    "loginShell",
    "win32",
    { PATH: "C:\\Tools", PATHEXT: ".CMD", ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    (candidate) => candidate === shimPath,
    () => shim,
  );
  assert.equal(missingScript.status, "cmdShim");
  if (missingScript.status === "cmdShim") {
    assert.equal(
      missingScript.shellArgs[3],
      '"C:\\Tools\\codex.CMD --model "%PATH%""',
    );
    assert.equal(missingScript.shellArgs[3]?.includes("%%"), false);
  }

  const unreadable = lookupCodexCommand(
    shimPath,
    ["%PATH%"],
    "loginShell",
    "win32",
    { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    (candidate) => candidate === shimPath,
    () => {
      throw new Error("denied");
    },
  );
  assert.equal(unreadable.status, "cmdShim");
  if (unreadable.status === "cmdShim") {
    assert.equal(unreadable.shellArgs[3]?.includes("%%"), false);
  }
});

function npmScript(shimPath: string): string {
  return path.win32.normalize(
    path.win32.join(
      path.win32.dirname(shimPath),
      "node_modules\\@openai\\codex\\bin\\codex.js",
    ),
  );
}

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
