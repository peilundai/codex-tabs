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

export function readConfiguration(): ExtensionConfiguration {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  return {
    command: nonEmptyString(config.get("command"), "codex"),
    args: stringArray(config.get("args")),
    cwdMode: cwdMode(config.get("cwdMode")),
    launchMode: launchMode(config.get("launchMode")),
    titleMaxLength: boundedInteger(
      config.get("titleMaxLength"),
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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
