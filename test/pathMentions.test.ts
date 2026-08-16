import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMention,
  formatMentions,
  parseAbsolutePathList,
  resourceFsPath,
  rewriteDroppedPathPayload,
} from "../src/pathMentions";

test("mentions are relative inside the session and absolute outside it", () => {
  assert.equal(
    formatMention("/workspace/app/src/main.ts", "/workspace/app"),
    "@src/main.ts",
  );
  assert.equal(
    formatMention("/tmp/screenshot.png", "/workspace/app"),
    "@/tmp/screenshot.png",
  );
});

test("mentions quote unsafe names and de-duplicate selections", () => {
  assert.equal(
    formatMentions(
      ["/workspace/a file.ts", "/workspace/a file.ts"],
      "/workspace",
    ),
    '@"a file.ts"',
  );
});

test("dropped absolute paths support shell quoting and bracketed paste", () => {
  assert.deepEqual(
    parseAbsolutePathList("'/workspace/a file.ts' /tmp/image.png"),
    ["/workspace/a file.ts", "/tmp/image.png"],
  );
  assert.equal(
    rewriteDroppedPathPayload(
      "\u001b[200~/workspace/a file.ts\u001b[201~",
      "/workspace",
      () => true,
    ),
    '@"a file.ts"',
  );
});

test("ordinary terminal input is never rewritten", () => {
  assert.equal(rewriteDroppedPathPayload("explain /tmp/file.ts"), undefined);
  assert.equal(rewriteDroppedPathPayload("/new"), undefined);
});

test("only local and remote filesystem resources are accepted", () => {
  assert.equal(resourceFsPath({ scheme: "file", fsPath: "/tmp/a" }), "/tmp/a");
  assert.equal(
    resourceFsPath({ scheme: "vscode-remote", fsPath: "/work/a" }),
    "/work/a",
  );
  assert.equal(resourceFsPath({ scheme: "untitled", fsPath: "/tmp/a" }), undefined);
});
