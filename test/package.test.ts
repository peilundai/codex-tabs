import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function pngDimensions(file: string): { width: number; height: number } {
  const data = readFileSync(file);
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

interface Manifest {
  displayName: string;
  description: string;
  main: string;
  icon?: string;
  license: string;
  repository?: unknown;
  dependencies?: Record<string, string>;
  activationEvents?: string[];
  capabilities?: {
    untrustedWorkspaces?: { supported?: boolean };
    virtualWorkspaces?: { supported?: boolean };
  };
  contributes: {
    commands: Array<{ command: string; icon?: unknown }>;
  };
}

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Manifest;

test("the publication manifest declares source, license, and safe workspace limits", () => {
  assert.equal(manifest.main, "./out/extension.js");
  assert.equal(manifest.icon, "media/codex-icon-light.png");
  assert.match(manifest.displayName, /unofficial/i);
  assert.match(manifest.description, /not affiliated with or endorsed by OpenAI/i);
  const icon = pngDimensions("media/codex-icon-light.png");
  assert.ok(icon.width >= 128 && icon.height >= 128);
  assert.equal(icon.width, icon.height);
  assert.equal(manifest.license, "MIT");
  assert.ok(manifest.repository);
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);
  assert.equal(manifest.capabilities?.virtualWorkspaces?.supported, false);
  assert.deepEqual(manifest.dependencies ?? {}, {});
});

test("contributed commands rely on generated activation events", () => {
  assert.equal(manifest.activationEvents, undefined);
});

test("the New Chat command ships a theme-aware Codex icon", () => {
  const command = manifest.contributes.commands.find(
    (item) => item.command === "codexTabs.newChat",
  );
  assert.deepEqual(command?.icon, {
    light: "media/codex-tab-icon-light.png",
    dark: "media/codex-tab-icon.png",
  });
  const light = pngDimensions("media/codex-tab-icon-light.png");
  const dark = pngDimensions("media/codex-tab-icon.png");
  assert.ok(light.width >= 24 && light.height >= 24);
  assert.equal(light.width, light.height);
  assert.equal(dark.width, dark.height);
  assert.equal(
    readFileSync("media/codex-tab-icon-light.png").equals(
      readFileSync("media/codex-tab-icon.png"),
    ),
    false,
  );
});

test("internal planning notes stay out of the extension package", () => {
  const ignore = readFileSync(".vscodeignore", "utf8");
  assert.match(ignore, /^RESTORE_OPEN_CHATS_PLAN\.md$/m);
  assert.match(ignore, /^PUBLISH_AND_OPENSOURCE_REVIEW\.md$/m);
  assert.match(ignore, /^artifacts\/\*\*$/m);
});
