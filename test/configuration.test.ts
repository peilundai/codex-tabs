import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

type ModuleLoad = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;

test("settings fall back to bounded defaults and drop blank arguments", async () => {
  const loader = Module as unknown as { _load: ModuleLoad };
  const originalLoad = loader._load;
  loader._load = (request, parent, isMain) =>
    request === "vscode"
      ? {}
      : originalLoad.call(Module, request, parent, isMain);

  try {
    const { normalizeConfiguration } = await import("../src/configuration");
    assert.deepEqual(
      normalizeConfiguration({
        command: "  ",
        args: ["--model", "", "  ", 1],
        cwdMode: "nope",
        launchMode: "nope",
        titleMaxLength: 3.5,
      }),
      {
        command: "codex",
        args: ["--model"],
        cwdMode: "auto",
        launchMode: "loginShell",
        titleMaxLength: 28,
      },
    );
    assert.deepEqual(
      normalizeConfiguration({
        command: " /usr/local/bin/codex ",
        args: ["--model", "gpt"],
        cwdMode: "prompt",
        launchMode: "profile",
        titleMaxLength: 100,
      }),
      {
        command: "/usr/local/bin/codex",
        args: ["--model", "gpt"],
        cwdMode: "prompt",
        launchMode: "profile",
        titleMaxLength: 80,
      },
    );
    assert.equal(normalizeConfiguration({ titleMaxLength: 3 }).titleMaxLength, 8);
  } finally {
    loader._load = originalLoad;
  }
});
