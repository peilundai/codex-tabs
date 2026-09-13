import assert from "node:assert/strict";
import test from "node:test";
import { sessionArguments } from "../src/sessionLaunch";

test("sessions preserve global arguments without title overrides", () => {
  const global = ["--model", "gpt-5.6-terra"];
  assert.deepEqual(sessionArguments(global, "new"), global);
  assert.deepEqual(sessionArguments(global, "resume"), [
    ...global,
    "resume",
  ]);
  assert.deepEqual(sessionArguments(global, "fork"), [
    ...global,
    "fork",
  ]);
});
