# Privacy policy

Codex CLI Tabs is an unofficial VS Code extension. It is not affiliated with
or endorsed by OpenAI.

## What this extension collects

Nothing. The extension has no telemetry, analytics, accounts, or network
client of its own.

It does not store prompts, credentials, chat transcripts, session titles, or
terminal output. It does not write Codex's authentication or session files.

## What stays on your machine

The extension launches the Codex CLI you install separately. On macOS and
Linux, an optional local adapter may open Codex's `state_*.sqlite` files in
read-only mode and read at most 256 characters of the current session's
identifier and name or title. That text is used only to label the open editor
tab, is kept in memory, and is discarded when the tab closes.

A missing command or an immediate process failure is shown in VS Code and
written to the Codex CLI output channel. Those messages do not include
prompts or credentials.

## Codex CLI

Conversation content, authentication, model requests, and any other network
traffic are handled by Codex CLI under its own terms and privacy policy.
This extension does not see or proxy that traffic.

## Contact

Report a privacy concern through the private vulnerability reporting path
described in [SECURITY.md](SECURITY.md).
