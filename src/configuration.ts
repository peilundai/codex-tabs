import * as vscode from "vscode";
import {
  CONFIGURATION_SECTION,
  DEFAULT_TITLE_LENGTH,
} from "./constants";
import type {
  CwdMode,
  ExtensionConfiguration,
  LaunchMode,
} from "./types";

const MINIMUM_TITLE_LENGTH = 8;
const MAXIMUM_TITLE_LENGTH = 80;

export function readConfiguration(resource?: vscode.Uri): ExtensionConfiguration {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION, resource);
  return normalizeConfiguration({
    command: config.get("command"),
    args: config.get("args"),
    cwdMode: config.get("cwdMode"),
    launchMode: config.get("launchMode"),
    titleMaxLength: config.get("titleMaxLength"),
  });
}

export function normalizeConfiguration(values: {
  command?: unknown;
  args?: unknown;
  cwdMode?: unknown;
  launchMode?: unknown;
  titleMaxLength?: unknown;
}): ExtensionConfiguration {
  return {
    command: nonEmptyString(values.command, "codex"),
    args: stringArray(values.args),
    cwdMode: cwdMode(values.cwdMode),
    launchMode: launchMode(values.launchMode),
    titleMaxLength: boundedInteger(
      values.titleMaxLength,
      DEFAULT_TITLE_LENGTH,
      MINIMUM_TITLE_LENGTH,
      MAXIMUM_TITLE_LENGTH,
    ),
  };
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function cwdMode(value: unknown): CwdMode {
  return value === "workspaceRoot" || value === "prompt" ? value : "auto";
}

function launchMode(value: unknown): LaunchMode {
  return value === "profile" ? value : "loginShell";
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}
