export type SessionAction = "new" | "resume" | "fork";

/** Places Codex global options before the optional session subcommand. */
export function sessionArguments(
  globalArguments: readonly string[],
  action: SessionAction,
): readonly string[] {
  return action === "new"
    ? [...globalArguments]
    : [...globalArguments, action];
}
