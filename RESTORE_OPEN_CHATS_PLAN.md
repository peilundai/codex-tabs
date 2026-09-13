# Restore Open Chats After VS Code Reload

Status: planning note, intentionally untracked. No implementation has been made.

## Goal

After **Developer: Reload Window** or another extension-host/window reload, reopen
every Codex chat tab that was open before the reload and resume the same Codex
conversation in the same editor column. It is acceptable to stop and relaunch
the underlying Codex processes. Do not preserve an in-flight turn, unsent input,
or terminal scrollback.

The extension must remain a thin launcher. Codex continues to own transcripts,
conversation persistence, authentication, permissions, models, tools, and
network traffic. The extension may persist only the minimum launch metadata
needed to call Codex's supported resume command.

## Confirmed Current Behavior

- `CodexTerminalManager` tracks sessions only in an in-memory
  `Map<vscode.Terminal, CodexSession>`.
- Both extension pseudoterminals and native fallback terminals are created with
  `isTransient: true`.
- `CodexTerminalManager.dispose()` explicitly disposes all managed terminals.
- The editor layout survives a reload independently, which is why an empty
  editor group remains after its transient terminal tabs disappear.
- The PTY bridge already validates the Codex session UUID from Codex's OSC title
  and can resolve a unique truncated UUID through bounded, read-only metadata
  lookup.
- Codex CLI 0.147.0 and the official command reference support
  `codex resume <SESSION_ID>`. The session ID may be a UUID, and global options
  remain before the `resume` subcommand.
- The manifest currently has no startup activation event, so automatic restore
  requires an explicit `onStartupFinished` activation event.

References:

- <https://developers.openai.com/codex/cli/reference>
- <https://code.visualstudio.com/docs/terminal/advanced#_persistent-sessions>

## Recommended Product Semantics

- Restoration is automatic and enabled by default; do not add a setting for the
  initial implementation.
- Treat the saved list as "tabs that should be open for this workspace." This
  means chats also reopen after quitting VS Code and later reopening the same
  workspace, not only after `Reload Window`.
- Closing a chat tab or allowing its Codex process to exit normally removes its
  restore record. Window/extension shutdown preserves restore records.
- Reopen tabs without stealing focus from the user's active editor.
- Restore the concrete editor column and creation order on a best-effort basis.
  Exact tab indices are not promised because the stable VS Code API does not
  expose arbitrary terminal-tab reordering.
- Keep terminals transient and perform deterministic application-level restore
  with `codex resume <UUID>`; do not depend on VS Code reconnecting a custom
  pseudoterminal process.
- Initial automatic restoration is supported on macOS/Linux when the Python PTY
  bridge is available, including both `loginShell` and `profile` launch modes.
  Windows and no-Python fallback sessions continue to use the manual native
  **Resume Chat...** picker because the extension cannot observe their exact
  selected session UUID safely.
- Existing chats opened by an older extension build cannot survive the first
  upgrade reload because their UUIDs were never handed to the extension. Chats
  opened after this feature is installed are restorable.

## Persisted State

Use `ExtensionContext.workspaceState` with a versioned key such as
`codexTabs.restorableSessions.v1`.

Each open restorable tab stores only:

```ts
interface RestorableSession {
  instanceId: string;
  sessionId: string;
  cwd?: string;
  viewColumn: number;
  order: number;
  lastUsed: number;
}
```

- `instanceId` identifies one tab independently of the Codex session UUID, so
  two tabs that happen to resume the same chat do not overwrite each other.
- `sessionId` must be a validated full UUID. Never persist a truncated prefix.
- Do not persist prompts, transcript content, terminal output, credentials,
  chat titles, arbitrary CLI output, or configured arguments.
- Validate loaded state defensively, ignore malformed records, require a
  positive concrete view column, and cap the restored list to a conservative
  bounded count (recommended: 50).
- Use the current validated extension configuration when relaunching. The saved
  record controls only the resume UUID, working directory, and placement.

## Implementation Design

### 1. Hand the validated UUID from the bridge to the extension

Add an optional `--session-file <path>` argument to
`scripts/codex-pty-bridge.py`.

- When `SessionTitleResolver` obtains a new full UUID, write that UUID plus a
  newline to the supplied file with user-only permissions. Never write a
  truncated prefix or title.
- Write again if the TUI switches to a different Codex thread.
- Do not emit the UUID into terminal output or logs.
- Create a unique handoff filename per terminal under the extension's storage
  directory. The TypeScript manager polls/observes it, validates the UUID,
  updates the in-memory session and `workspaceState`, then deletes the handoff
  file. This one mechanism works for both the extension-PTY login-shell path and
  the native-terminal profile wrapper.
- Clean stale handoff files owned by this extension without scanning or
  modifying Codex's state.

### 2. Extend launch and lifecycle state

- Allow `sessionArguments` to append an optional exact session ID after
  `resume`, producing global args, managed title args, `resume`, then UUID.
  Continue treating every executable and argument as data.
- Add `instanceId` and optional `sessionId`/handoff path to each in-memory
  `CodexSession`, while retaining the concrete `vscode.Terminal` map key.
- Persist a record only after a full UUID is received. Update its column and
  recency when the concrete terminal becomes active or moves groups.
- Serialize `workspaceState` writes so rapid title/column/close events cannot
  overwrite newer state.
- Distinguish ordinary terminal closure from manager shutdown. Ordinary closure
  removes the matching record; shutdown first flushes current records, then
  stops/disposes terminals without deleting them from persisted state.
- Make shutdown idempotent and awaitable so `deactivate()` can flush state before
  the extension host exits.

### 3. Restore during activation

- Add only `onStartupFinished` to `activationEvents`; command events remain
  generated from `contributes.commands` and must not be reintroduced.
- Make activation await `manager.restoreSessions()` after commands and event
  handlers are registered.
- Load and validate saved records, then create transient terminal tabs in stored
  order with `codex resume <sessionId>`, the saved CWD, and stored concrete view
  column.
- Reuse the stored `instanceId`. Do not show the native resume picker.
- Use `preserveFocus: true` while recreating tabs so startup does not take focus
  from the current editor.
- If a stored CWD no longer exists, fall back non-interactively to the normal
  auto working-directory choice and let Codex apply its supported resumed-CWD
  behavior. Log the fallback without logging the session UUID.
- If a resumed process fails or exits, normal terminal-close handling removes
  the stale record so it does not reopen forever.
- Avoid duplicate restores within one extension-host lifetime by marking loaded
  records as claimed before launching them.

### 4. Documentation and security boundary

- Update README and architecture documentation to say that the extension stores
  only workspace-scoped session UUID and tab placement metadata for restoration.
- Update SECURITY.md to describe the UUID handoff file, permissions, deletion,
  workspace-state record, and the fact that no transcript/title is stored.
- Document the macOS/Linux + Python limitation and retain the manual resume
  picker as the fallback.
- Do not add runtime dependencies, provider clients, telemetry, credentials, or
  conversation storage.

## Test Plan

Add pure unit tests where possible and extend the activation smoke test.

- Argument construction: exact UUID appears after `resume`; new/fork/manual
  picker behavior remains unchanged; unsafe values remain individual argv data.
- Bridge: full UUID is written to the handoff file, truncated IDs are not
  written until uniquely resolved, thread switches replace the UUID, file mode
  is restrictive, and UUIDs never appear in terminal output.
- State validation: malformed versions/UUIDs/columns are ignored, records are
  bounded, duplicate tab instances remain distinct, and writes are serialized.
- Lifecycle: identified chats persist; explicit close/process exit removes one
  record; shutdown preserves records; repeated shutdown is safe.
- Restore: all valid records launch `resume <UUID>` in stored order/columns,
  missing CWD uses the non-interactive fallback, focus is preserved, and a
  failed resumed terminal is removed from future restore state.
- Activation/manifest: all commands still register; `onStartupFinished` is the
  only explicit activation event; startup restoration runs once.
- Regression: group reuse, title sanitation, drop rewriting, profile mode,
  manual resume/fork pickers, and native fallback behavior remain intact.

Required verification after implementation:

```bash
npm ci
npm run check
npm run package
npx vsce ls --no-dependencies
```

Manual Extension Development Host acceptance test on macOS:

1. Open two new chats in the same Codex editor group and wait for both titles.
2. Move or arrange the group, then run **Developer: Reload Window**.
3. Confirm two terminal tabs reopen in the prior column without a picker and
   each shows its original transcript after Codex resumes.
4. Close one chat, reload again, and confirm only the remaining chat reopens.
5. Repeat once with `codexTabs.launchMode: "profile"`.
6. Confirm no session UUID appears in tab titles, terminal output, or the Codex
   Tabs output channel.

## Resume Checklist

When resuming work, first read `AGENTS.md`, `README.md`, `CONTRIBUTING.md`,
`docs/ARCHITECTURE.md`, `SECURITY.md`, and `NOTICE`. Confirm the working tree and
recent history before editing. The repository was clean when this note was
created, with `92fb55f chore: remove redundant activation events` as the latest
commit. Do not commit this planning note unless explicitly requested.
