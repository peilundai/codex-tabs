export type SessionAction = "new" | "resume" | "fork";

export type TitleMode = "tracked" | "fallback";

export const TRACKED_TITLE_ARGUMENTS = [
  "-c",
  'tui.terminal_title=["app-name","session-id","thread"]',
] as const;

export const FALLBACK_TITLE_ARGUMENTS = [
  "-c",
  'tui.terminal_title=["app-name"]',
] as const;

/** Places Codex global options before the optional session subcommand. */
export function sessionArguments(
  globalArguments: readonly string[],
  action: SessionAction,
  titleMode: TitleMode,
): readonly string[] {
  const titleArguments =
    titleMode === "tracked"
      ? TRACKED_TITLE_ARGUMENTS
      : FALLBACK_TITLE_ARGUMENTS;
  const managedArguments = [...globalArguments, ...titleArguments];
  return action === "new"
    ? managedArguments
    : [...managedArguments, action];
}
