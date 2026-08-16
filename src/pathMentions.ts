import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { pathIsWithin } from "./workingDirectory";

const SUPPORTED_RESOURCE_SCHEMES = new Set(["file", "vscode-remote"]);
// Terminal bracketed-paste delimiters are control sequences by definition.
// eslint-disable-next-line no-control-regex
const BRACKETED_PASTE = /^\u001b\[200~([\s\S]*)\u001b\[201~\r?\n?$/;

export function resourceFsPath(resource: {
  scheme: string;
  fsPath: string;
}): string | undefined {
  if (!SUPPORTED_RESOURCE_SCHEMES.has(resource.scheme)) {
    return undefined;
  }
  const value = resource.fsPath.trim();
  return value || undefined;
}

export function mentionTarget(fsPath: string, cwd?: string): string {
  const absoluteOrProvided = fsPath.trim();
  if (!absoluteOrProvided) {
    return "";
  }

  if (!cwd || !pathIsWithin(absoluteOrProvided, cwd)) {
    return toForwardSlashes(absoluteOrProvided);
  }

  const relative = path.relative(path.resolve(cwd), path.resolve(absoluteOrProvided));
  return relative ? toForwardSlashes(relative) : toForwardSlashes(absoluteOrProvided);
}

export function formatMention(fsPath: string, cwd?: string): string {
  const target = mentionTarget(fsPath, cwd);
  if (!target) {
    return "";
  }
  return /[\s"'`]/.test(target)
    ? `@"${target.replaceAll('"', '\\"')}"`
    : `@${target}`;
}

export function formatMentions(
  fsPaths: readonly string[],
  cwd?: string,
): string {
  const unique = new Set(
    fsPaths.map((item) => formatMention(item, cwd)).filter(Boolean),
  );
  return unique.size ? [...unique].join(" ") : "";
}

/**
 * Converts a terminal file-drop payload to Codex mentions. Ordinary typed or
 * pasted text is returned as `undefined` and must pass through unchanged.
 */
export function rewriteDroppedPathPayload(
  chunk: string,
  cwd?: string,
  pathExists: (candidate: string) => boolean = existsSync,
): string | undefined {
  const match = BRACKETED_PASTE.exec(chunk);
  const payload = match?.[1] ?? chunk;
  const parsed = parseAbsolutePathList(payload);
  if (!parsed || !parsed.every(pathExists)) {
    return undefined;
  }
  const mentions = formatMentions(parsed, cwd);
  return mentions || undefined;
}

export function parseAbsolutePathList(input: string): readonly string[] | undefined {
  if (input.length < 2) {
    return undefined;
  }

  const paths: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    cursor = skipWhitespace(input, cursor);
    if (cursor >= input.length) {
      break;
    }
    const token = parsePathToken(input, cursor);
    if (!token || !isAbsolutePath(token.value)) {
      return undefined;
    }
    paths.push(token.value);
    cursor = token.next;
  }
  return paths.length ? paths : undefined;
}

function parsePathToken(
  input: string,
  start: number,
): { value: string; next: number } | undefined {
  if (input.startsWith("$'", start)) {
    return parseQuoted(input, start + 2, "'");
  }
  const first = input[start];
  if (first === "'" || first === '"') {
    return parseQuoted(input, start + 1, first);
  }
  if (!startsAbsolutePath(input, start)) {
    return undefined;
  }

  let cursor = start + 1;
  while (cursor < input.length) {
    if (/\s/.test(input[cursor] ?? "")) {
      const next = skipWhitespace(input, cursor);
      if (next >= input.length || startsAbsolutePath(input, next)) {
        break;
      }
    }
    cursor += 1;
  }
  return { value: normalizeFileUri(input.slice(start, cursor)), next: cursor };
}

function parseQuoted(
  input: string,
  start: number,
  quote: string,
): { value: string; next: number } | undefined {
  let value = "";
  let cursor = start;
  while (cursor < input.length) {
    const character = input[cursor];
    if (character === "\\" && cursor + 1 < input.length) {
      value += input[cursor + 1];
      cursor += 2;
    } else if (character === quote) {
      return { value: normalizeFileUri(value), next: cursor + 1 };
    } else {
      value += character;
      cursor += 1;
    }
  }
  return undefined;
}

function startsAbsolutePath(input: string, index: number): boolean {
  return (
    input[index] === "/" ||
    /^file:\/\//i.test(input.slice(index)) ||
    /^[A-Za-z]:[\\/]/.test(input.slice(index, index + 3))
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeFileUri(value: string): string {
  if (!/^file:/i.test(value)) {
    return value;
  }
  try {
    return fileURLToPath(value);
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

function skipWhitespace(input: string, start: number): number {
  let cursor = start;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function toForwardSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}
