import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseWorkingDirectory,
  pathIsWithin,
} from "../src/workingDirectory";

const roots = [
  { name: "app", fsPath: "/work/app" },
  { name: "api", fsPath: "/work/app/packages/api" },
] as const;

test("auto mode chooses the most specific root containing the active file", () => {
  assert.deepEqual(
    chooseWorkingDirectory(
      roots,
      "/work/app/packages/api/src/server.ts",
      "auto",
    ),
    { kind: "path", fsPath: "/work/app/packages/api" },
  );
});

test("workspaceRoot and prompt modes are deterministic", () => {
  assert.deepEqual(
    chooseWorkingDirectory(roots, "/work/app/packages/api/a.ts", "workspaceRoot"),
    { kind: "path", fsPath: "/work/app" },
  );
  assert.deepEqual(chooseWorkingDirectory(roots, undefined, "prompt"), {
    kind: "prompt",
    folders: roots,
  });
});

test("no-workspace mode uses home and reports when no home exists", () => {
  assert.deepEqual(chooseWorkingDirectory([], undefined, "auto", "/home/me"), {
    kind: "path",
    fsPath: "/home/me",
  });
  assert.deepEqual(chooseWorkingDirectory([], undefined, "auto", ""), {
    kind: "unavailable",
  });
});

test("path containment does not confuse sibling prefixes", () => {
  assert.equal(pathIsWithin("/work/app/file.ts", "/work/app"), true);
  assert.equal(pathIsWithin("/work/application/file.ts", "/work/app"), false);
});

