import assert from "node:assert/strict";
import test from "node:test";
import {
  compactTitle,
  consumeOscTitles,
  safeTitleFromOsc,
  titleFromCodexOsc,
} from "../src/titleParser";

test("Codex titles normalize and compact the session portion", () => {
  assert.equal(
    titleFromCodexOsc("Codex - Refactor the authentication middleware - app", 24),
    "Refactor the authentica…",
  );
  assert.equal(titleFromCodexOsc("Codex - app"), "Codex CLI");
  assert.equal(
    titleFromCodexOsc("Codex | Refactor the authentication middleware", 24),
    "Refactor the authentica…",
  );
  assert.equal(titleFromCodexOsc("Codex CLI | Generated name"), "Generated name");
  assert.equal(titleFromCodexOsc("zsh"), undefined);
  assert.equal(compactTitle("  one   two  "), "one two");
});

test("UUID identity payloads never become visible titles", () => {
  const threadId = "01a008d4-daff-7b61-8be9-9d87850e009d";
  const truncatedId = `${threadId.slice(0, 29)}...`;
  assert.equal(safeTitleFromOsc(threadId), "Codex CLI");
  assert.equal(safeTitleFromOsc(truncatedId), "Codex CLI");
  assert.equal(
    safeTitleFromOsc(`codex | ${truncatedId} | ${threadId}`),
    "Codex CLI",
  );
  assert.equal(safeTitleFromOsc("Generated title"), "Generated title");
});

test("OSC extraction handles BEL, ST, and split chunks", () => {
  const first = consumeOscTitles("text\u001b]0;Codex - hello - app");
  assert.deepEqual(first.payloads, []);
  const second = consumeOscTitles("\u0007more\u001b]2;zsh\u001b\\", first.carry);
  assert.deepEqual(second.payloads, ["Codex - hello - app", "zsh"]);
  assert.equal(second.carry, "");
});
