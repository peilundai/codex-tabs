import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_TITLE_ARGUMENTS,
  sessionArguments,
  TRACKED_TITLE_ARGUMENTS,
} from "../src/sessionLaunch";

test("tracked sessions request identity metadata before the thread title", () => {
  const global = ["--model", "gpt-5.6-terra"];
  const managed = [...global, ...TRACKED_TITLE_ARGUMENTS];
  assert.deepEqual(sessionArguments(global, "new", "tracked"), managed);
  assert.deepEqual(sessionArguments(global, "resume", "tracked"), [
    ...managed,
    "resume",
  ]);
  assert.deepEqual(sessionArguments(global, "fork", "tracked"), [
    ...managed,
    "fork",
  ]);
});

test("native fallback requests only the Codex app name", () => {
  const global = ["--no-alt-screen"];
  assert.deepEqual(sessionArguments(global, "new", "fallback"), [
    ...global,
    ...FALLBACK_TITLE_ARGUMENTS,
  ]);
});
