export const EXTENSION_NAME = "Codex CLI";
export const CONFIGURATION_SECTION = "codexTabs";
export const DEFAULT_TITLE_LENGTH = 28;
export const CODEX_SETUP_DOCS_URL =
  "https://developers.openai.com/codex/cli/features";
export const OPEN_SETUP_DOCS_ACTION = "Open Setup Docs";
export const IMMEDIATE_EXIT_WINDOW_MS = 4_000;

export const COMMANDS = {
  open: "codexTabs.open",
  newChat: "codexTabs.newChat",
  resumeChat: "codexTabs.resumeChat",
  forkChat: "codexTabs.forkChat",
  insertPaths: "codexTabs.insertPath",
} as const;
