# Security policy

Report vulnerabilities with GitHub private security advisories rather than a
public issue. Include the extension and editor versions, platform, remote/local
extension-host details, a minimal reproduction, and expected impact. Do not
include credentials or private source code.

The extension launches the separately installed Codex executable with validated
arguments and a selected working directory. On Windows, a `.cmd` or `.bat`
shim is started through `cmd.exe /d /s /c`. Arguments are quoted and `%` is
escaped so the shim does not expand environment variables. Codex code execution,
authentication, provider communication, and workspace modifications are outside
this extension's security boundary.

Extension-controlled surfaces are command construction, terminal lifecycle,
path insertion, editor-tab movement, the Unix PTY adapter, and package contents.
Untrusted and virtual workspaces are intentionally unsupported.

On macOS and Linux, the optional PTY adapter may open Codex's local
`state_*.sqlite` database in read-only/query-only mode. It issues a parameterized
lookup for the UUID or validated UUID prefix emitted by the active Codex
process. Prefixes must resolve to one unique row. The adapter reads only bounded
session identifier and name/title metadata. It does not read turns or
transcripts, write to Codex state, persist the result, or log the database path
or title.
