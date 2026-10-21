# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.5] - 2026-10-21

### Changed

- Identify the extension as unofficial and not affiliated with OpenAI in the
  Marketplace name and description.
- Replace the Marketplace and editor-tab icons with original terminal-tab
  artwork.

### Fixed

- Leave a tab open and explain the failure when Codex exits immediately,
  including when the CLI is missing from the shell or not signed in.
- Refuse to open a tab when the configured absolute path does not exist, or
  when Windows `loginShell` mode cannot resolve the command.
- Launch a recognized npm Windows `.cmd` shim as `node.exe` plus its `.js`
  entry, so arguments such as `%PATH%` are not expanded by `cmd.exe`.
  Unrecognized `.cmd` and `.bat` files still use `cmd.exe /d /s /c`, which
  can expand percent signs.
- Report an immediate Unix PTY exit before VS Code closes the terminal, so
  the tab stays open and the setup message is shown.
- Apply a folder-specific `codexTabs.cwdMode` from the active file.
- Discover Python 3 on `PATH` for the optional Unix PTY adapter.
- Ask for a file or folder when Insert into Chat has no selection.
- Do not start a chat when no workspace or home directory is available.

## [0.2.4] - 2026-08-16

### Fixed

- Use a tightly fitted transparent Codex cloud mark for editor tabs and the
  toolbar command while retaining the full light app tile for Marketplace.

## [0.2.3] - 2026-08-16

### Fixed

- Enlarge the light and dark Codex icon artwork within its canvas so it matches
  the visual size of neighboring VS Code and Marketplace icons.

## [0.2.2] - 2026-08-16

### Fixed

- Resolve Codex's truncated terminal-title session identifiers without exposing
  UUID prefixes in VS Code tab names.
- Require truncated identifiers to match one unique local metadata row and
  suppress UUID-shaped titles at both terminal-title boundaries.

## [0.2.1] - 2026-08-16

### Fixed

- Show `Codex CLI` instead of a thread UUID before a session has a title.
- Follow the generated or explicit title of new, resumed, forked, renamed, and
  in-TUI-switched sessions through bounded read-only Codex metadata lookup.

## [0.2.0] - 2026-08-16

### Added

- Automatic VS Code tab renaming when Codex generates or changes the current
  thread name.
- Distinct Codex app artwork for Marketplace and theme-aware tab icons.

## [0.1.0] - 2026-08-16

### Added

- Multiple independent Codex CLI sessions in reusable editor-area tabs.
- Native Codex `resume` and `fork` pickers in new tabs.
- File and folder insertion through context menus, editor moves, and verified
  path drops.
- Cross-platform launch planning with a dependency-free optional Unix PTY
  adapter and native-terminal fallback.
- Automated tests, package validation, architecture documentation, and explicit
  workspace trust restrictions.

[Unreleased]: https://github.com/peilundai/codex-tabs/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/peilundai/codex-tabs/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/peilundai/codex-tabs/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/peilundai/codex-tabs/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/peilundai/codex-tabs/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/peilundai/codex-tabs/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/peilundai/codex-tabs/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/peilundai/codex-tabs/releases/tag/v0.1.0
