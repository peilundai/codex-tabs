import { DEFAULT_TITLE_LENGTH, EXTENSION_NAME } from "./constants";

// OSC title messages are delimited by terminal control characters.
// eslint-disable-next-line no-control-regex
const OSC_TITLE = /\u001b\][012];([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const THREAD_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TRUNCATED_THREAD_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,11}(?:\.\.\.|…)/i;

export function compactTitle(
  value: string,
  maximumLength = DEFAULT_TITLE_LENGTH,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximumLength - 1))}…`;
}

export function titleFromCodexOsc(
  payload: string,
  maximumLength = DEFAULT_TITLE_LENGTH,
): string | undefined {
  const normalized = compactTitle(payload, Number.MAX_SAFE_INTEGER);
  const pipeSeparator = normalized.indexOf(" | ");
  if (pipeSeparator >= 0) {
    const heading = normalized.slice(0, pipeSeparator);
    if (!isCodexHeading(heading)) {
      return undefined;
    }
    const sessionTitle = normalized.slice(pipeSeparator + 3).trim();
    return sessionTitle
      ? safeDisplayTitle(sessionTitle, maximumLength)
      : EXTENSION_NAME;
  }

  const parts = normalized.split(" - ");
  if (!isCodexHeading(parts[0] ?? "")) {
    return undefined;
  }
  if (parts.length < 3) {
    return EXTENSION_NAME;
  }
  const sessionTitle = parts.slice(1, -1).join(" - ").trim();
  return sessionTitle
    ? safeDisplayTitle(sessionTitle, maximumLength)
    : EXTENSION_NAME;
}

export function safeTitleFromOsc(
  payload: string,
  maximumLength = DEFAULT_TITLE_LENGTH,
): string {
  return (
    titleFromCodexOsc(payload, maximumLength) ??
    safeDisplayTitle(payload, maximumLength)
  );
}

/**
 * Extracts OSC 0/1/2 titles from a stream and retains only a trailing partial
 * escape sequence. Non-title terminal output never accumulates in memory.
 */
export function consumeOscTitles(
  chunk: string,
  carry = "",
): { payloads: readonly string[]; carry: string } {
  const buffer = carry + chunk;
  const payloads: string[] = [];
  let match: RegExpExecArray | null;
  let consumedThrough = 0;
  OSC_TITLE.lastIndex = 0;
  while ((match = OSC_TITLE.exec(buffer))) {
    payloads.push(match[1]);
    consumedThrough = match.index + match[0].length;
  }

  const remainder = buffer.slice(consumedThrough);
  const possibleStart = remainder.lastIndexOf("\u001b]");
  const nextCarry =
    possibleStart >= 0
      ? remainder.slice(possibleStart, possibleStart + 8192)
      : remainder.endsWith("\u001b")
        ? "\u001b"
        : "";
  return { payloads, carry: nextCarry };
}

function isCodexHeading(value: string): boolean {
  return /^(?:codex|codex cli)$/i.test(value);
}

function safeDisplayTitle(value: string, maximumLength: number): string {
  const normalized = compactTitle(value, Number.MAX_SAFE_INTEGER);
  if (THREAD_ID.test(normalized) || TRUNCATED_THREAD_ID.test(normalized)) {
    return EXTENSION_NAME;
  }
  return compactTitle(normalized, maximumLength);
}
