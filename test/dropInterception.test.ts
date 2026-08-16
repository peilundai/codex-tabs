import assert from "node:assert/strict";
import test from "node:test";
import { planDropInterception } from "../src/dropInterception";

test("moving an editor into a Codex column produces a reversible insertion plan", () => {
  const result = planDropInterception(
    [
      {
        viewColumn: 2,
        resourceKey: "file:///work/a.ts",
        fsPath: "/work/a.ts",
        editorKind: { kind: "text" },
      },
    ],
    [
      {
        viewColumn: 1,
        resourceKey: "file:///work/a.ts",
        fsPath: "/work/a.ts",
        editorKind: { kind: "text" },
      },
    ],
    new Set([2]),
  );

  assert.deepEqual(result, {
    destinationColumn: 2,
    paths: ["/work/a.ts"],
    closeResourceKeys: ["file:///work/a.ts"],
    restore: [
      {
        resourceKey: "file:///work/a.ts",
        viewColumn: 1,
        editorKind: { kind: "text" },
      },
    ],
  });
});

test("ordinary opens and moves into non-Codex groups are ignored", () => {
  const opened = [{ viewColumn: 2, resourceKey: "file:///a", fsPath: "/a" }];
  assert.equal(planDropInterception(opened, [], new Set([2])), undefined);
  assert.equal(
    planDropInterception(
      opened,
      [{ viewColumn: 1, resourceKey: "file:///a", fsPath: "/a" }],
      new Set([3]),
    ),
    undefined,
  );
});

