# AGENTS.md

This repository contains an unofficial VS Code extension that launches a
separately installed Codex CLI in editor-area terminal tabs.

Keep the boundary narrow: VS Code owns tab placement, terminal lifecycle, path
insertion, and the optional PTY adapter. Codex owns chats, persistence,
authentication, permissions, models, tools, and network traffic. Do not add
provider clients, telemetry, credential storage, or conversation storage.

## Development guidelines

Before making substantial changes, read `README.md`, `CONTRIBUTING.md`,
`docs/ARCHITECTURE.md`, `SECURITY.md`, and `NOTICE`.

- Use strict TypeScript with two-space indentation, double quotes, and semicolons.
- Do not add runtime dependencies unless clearly necessary.
- Treat configured commands and arguments as data, never as shell fragments.
- Track managed sessions by concrete `vscode.Terminal` objects, never by titles
  or process names.

## Validation

After changing code or the extension manifest, run:

```bash
npm ci
npm run check
npm run package
npx vsce ls --no-dependencies
```

Do not edit generated `out/` or `.test-out/` files. Do not commit dependencies,
VSIX files, caches, logs, or local editor state. Create commits only when the
user explicitly requests one.
