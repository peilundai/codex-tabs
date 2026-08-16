# Contributing

Keep changes focused and preserve the thin-launcher architecture. Add or update
tests for behavior that can be expressed without a live VS Code host.

```bash
npm ci
npm run check
npm run package
```

Press `F5` in VS Code to launch an Extension Development Host. Verify new,
resume, and fork tabs; editor-group reuse; file insertion; terminal disposal;
and native-terminal fallback. Package changes should also be checked with:

```bash
npx vsce ls --no-dependencies
```

Never log prompts, credentials, private file contents, or unnecessary absolute
paths. Preserve the unofficial-project disclaimer and third-party attribution.
