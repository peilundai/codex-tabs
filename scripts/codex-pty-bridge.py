#!/usr/bin/env python3
"""Dependency-free Unix PTY adapter for the Codex CLI editor terminal.

The adapter preserves terminal semantics while stdin/stdout are pipes, turns
file-drop payloads into Codex mentions, and compacts Codex OSC terminal titles.
The TypeScript launcher detects support and falls back cleanly elsewhere.
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time
import tty
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast
from urllib.parse import unquote, urlparse

try:
    import sqlite3
except ImportError:  # pragma: no cover - exercised only by minimal Python builds
    sqlite3 = None  # type: ignore[assignment]

DEFAULT_TITLE = "Codex CLI"
DEFAULT_TITLE_MAX_LENGTH = 28
MAX_PENDING_OSC_BYTES = 8_192
MAX_METADATA_CHARS = 256
READ_SIZE = 65_536
TITLE_POLL_INTERVAL_SECONDS = 1.0

BRACKETED_PASTE = re.compile(r"^\x1b\[200~(.*?)\x1b\[201~\r?\n?$", re.DOTALL)
MENTION_REQUIRES_QUOTES = re.compile(r'''[\s"'`]''')
WINDOWS_ABSOLUTE_PATH = re.compile(r"^[A-Za-z]:[\\/]")
OSC_START = b"\x1b]"
OSC_BEL = b"\x07"
OSC_ST = b"\x1b\\"
THREAD_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
TRUNCATED_THREAD_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,11}(?:\.\.\.|…)$",
    re.IGNORECASE,
)
THREAD_ID_SEARCH = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)
TRUNCATED_THREAD_ID_SEARCH = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{1,11}(?:\.\.\.|…)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Options:
    cwd: str | None
    columns: int
    rows: int
    control_fd: int | None
    title_max_length: int
    rewrite_input_only: bool
    rewrite_output_only: bool
    command: list[str]


class _ParsedNamespace(Protocol):
    cwd: str | None
    columns: int
    rows: int
    control_fd: int | None
    title_max_length: int
    rewrite_input_only: bool
    rewrite_output_only: bool
    command: list[str]


def main(argv: list[str]) -> int:
    options = parse_options(argv[1:])
    if options.rewrite_input_only:
        _ = sys.stdout.buffer.write(rewrite_input(sys.stdin.buffer.read(), options.cwd))
        return 0
    if options.rewrite_output_only:
        transformer = OscTitleTransformer(options.title_max_length)
        _ = sys.stdout.buffer.write(transformer.feed(sys.stdin.buffer.read()))
        _ = sys.stdout.buffer.write(transformer.flush())
        return 0
    if not options.command:
        print("codex-pty-bridge: missing command after --", file=sys.stderr)
        return 2
    return PtyRelay(options).run()


def parse_options(argv: list[str]) -> Options:
    parser = argparse.ArgumentParser(prog="codex-pty-bridge")
    _ = (
        parser.add_argument("--cwd"),
        parser.add_argument("--columns", type=positive_integer, default=80),
        parser.add_argument("--rows", type=positive_integer, default=24),
        parser.add_argument("--control-fd", type=int),
        parser.add_argument(
            "--title-max-length",
            type=clamp_title_max_length,
            default=DEFAULT_TITLE_MAX_LENGTH,
        ),
        parser.add_argument("--rewrite-input-only", action="store_true"),
        parser.add_argument("--rewrite-output-only", action="store_true"),
        parser.add_argument("command", nargs=argparse.REMAINDER),
    )
    parsed = cast(_ParsedNamespace, cast(object, parser.parse_args(argv)))
    command = parsed.command
    if command[:1] == ["--"]:
        command = command[1:]
    return Options(
        cwd=parsed.cwd,
        columns=parsed.columns,
        rows=parsed.rows,
        control_fd=parsed.control_fd,
        title_max_length=parsed.title_max_length,
        rewrite_input_only=parsed.rewrite_input_only,
        rewrite_output_only=parsed.rewrite_output_only,
        command=command,
    )


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def clamp_title_max_length(value: str) -> int:
    return max(8, min(80, int(value)))


def rewrite_input(data: bytes, cwd: str | None) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    rewritten = rewrite_dropped_paths(text, cwd)
    return rewritten.encode("utf-8") if rewritten is not None else data


def rewrite_dropped_paths(payload: str, cwd: str | None) -> str | None:
    bracketed = BRACKETED_PASTE.fullmatch(payload)
    raw = bracketed.group(1) if bracketed else payload
    paths = parse_absolute_path_list(raw)
    if not paths or not all(os.path.exists(path) for path in paths):
        return None
    mentions = format_mentions(paths, cwd)
    return mentions or None


def parse_absolute_path_list(payload: str) -> list[str] | None:
    if len(payload) < 2:
        return None
    result: list[str] = []
    cursor = 0
    while cursor < len(payload):
        cursor = skip_whitespace(payload, cursor)
        if cursor >= len(payload):
            break
        parsed = parse_path_token(payload, cursor)
        if parsed is None:
            return None
        value, cursor = parsed
        if not is_absolute_path(value):
            return None
        result.append(value)
    return result or None


def parse_path_token(payload: str, start: int) -> tuple[str, int] | None:
    if payload.startswith("$'", start):
        return parse_quoted_path(payload, start + 2, "'")
    if payload[start] in "'\"":
        return parse_quoted_path(payload, start + 1, payload[start])
    if not starts_absolute_path(payload, start):
        return None

    cursor = start + 1
    while cursor < len(payload):
        if payload[cursor].isspace():
            next_token = skip_whitespace(payload, cursor)
            if next_token >= len(payload) or starts_absolute_path(payload, next_token):
                break
        cursor += 1
    return normalize_file_uri(payload[start:cursor]), cursor


def parse_quoted_path(
    payload: str, start: int, quote: str
) -> tuple[str, int] | None:
    value: list[str] = []
    cursor = start
    while cursor < len(payload):
        character = payload[cursor]
        if character == "\\" and cursor + 1 < len(payload):
            value.append(payload[cursor + 1])
            cursor += 2
        elif character == quote:
            return normalize_file_uri("".join(value)), cursor + 1
        else:
            value.append(character)
            cursor += 1
    return None


def starts_absolute_path(payload: str, start: int) -> bool:
    candidate = payload[start:]
    return (
        candidate.startswith("/")
        or candidate.lower().startswith("file://")
        or bool(WINDOWS_ABSOLUTE_PATH.match(candidate))
    )


def is_absolute_path(value: str) -> bool:
    return value.startswith("/") or bool(WINDOWS_ABSOLUTE_PATH.match(value))


def normalize_file_uri(value: str) -> str:
    if not value.lower().startswith("file:"):
        return value
    parsed = urlparse(value)
    return unquote(parsed.path) or value.removeprefix("file://")


def skip_whitespace(payload: str, start: int) -> int:
    cursor = start
    while cursor < len(payload) and payload[cursor].isspace():
        cursor += 1
    return cursor


def format_mentions(paths: list[str], cwd: str | None) -> str:
    mentions = list(dict.fromkeys(format_mention(path, cwd) for path in paths))
    filtered = [mention for mention in mentions if mention]
    return " ".join(filtered) if filtered else ""


def format_mention(fs_path: str, cwd: str | None) -> str:
    target = mention_target(fs_path, cwd)
    if not target:
        return ""
    if MENTION_REQUIRES_QUOTES.search(target):
        return '@"' + target.replace('"', '\\"') + '"'
    return "@" + target


def mention_target(fs_path: str, cwd: str | None) -> str:
    value = fs_path.strip()
    if not value:
        return ""
    forward_slashes = value.replace("\\", "/")
    if not cwd:
        return forward_slashes
    absolute = os.path.abspath(value)
    root = os.path.abspath(cwd)
    try:
        shared = os.path.commonpath((absolute, root))
    except ValueError:
        return forward_slashes
    if shared != root:
        return forward_slashes
    relative = os.path.relpath(absolute, root)
    return relative.replace("\\", "/") if relative != "." else forward_slashes


def compact_title(raw: str, maximum_length: int) -> str:
    safe = "".join(
        " " if character.isspace() else character
        for character in raw
        if character.isspace()
        or not unicodedata.category(character).startswith("C")
    )
    normalized = " ".join(safe.split())
    if len(normalized) <= maximum_length:
        return normalized
    return normalized[: maximum_length - 1] + "…"


@dataclass(frozen=True)
class CodexTitle:
    display: str
    thread_id: str | None = None
    thread_id_prefix: str | None = None
    explicit_name: str | None = None


def truncated_thread_id_prefix(value: str) -> str | None:
    if not TRUNCATED_THREAD_ID.fullmatch(value):
        return None
    return value[:-1] if value.endswith("…") else value[:-3]


def contains_thread_identity(value: str) -> bool:
    return bool(
        THREAD_ID_SEARCH.search(value) or TRUNCATED_THREAD_ID_SEARCH.search(value)
    )


def safe_display_title(value: str, maximum_length: int) -> str:
    normalized = compact_title(value, MAX_METADATA_CHARS)
    if not normalized or contains_thread_identity(normalized):
        return DEFAULT_TITLE
    return compact_title(normalized, maximum_length)


def parse_codex_title(raw: str, maximum_length: int) -> CodexTitle | None:
    normalized = compact_title(raw, MAX_METADATA_CHARS)
    if " | " in normalized:
        parts = normalized.split(" | ")
        heading = parts[0]
        if heading.lower() not in ("codex", "codex cli"):
            return None
        if len(parts) >= 3:
            session_identity = parts[1].strip()
            thread_title = " | ".join(parts[2:]).strip()
            thread_id = (
                session_identity.lower()
                if THREAD_ID.fullmatch(session_identity)
                else None
            )
            thread_id_prefix = truncated_thread_id_prefix(session_identity)
            if thread_id_prefix:
                thread_id_prefix = thread_id_prefix.lower()
            title_thread_id = (
                thread_title.lower() if THREAD_ID.fullmatch(thread_title) else None
            )
            if thread_id_prefix and title_thread_id:
                if title_thread_id.startswith(thread_id_prefix.lower()):
                    thread_id = title_thread_id
                else:
                    title_thread_id = None
            if thread_id is None and thread_id_prefix is None:
                return CodexTitle(DEFAULT_TITLE)
            explicit_name = (
                thread_title
                if thread_title
                and title_thread_id is None
                and not contains_thread_identity(thread_title)
                else None
            )
            display = (
                safe_display_title(explicit_name, maximum_length)
                if explicit_name
                else DEFAULT_TITLE
            )
            return CodexTitle(
                display=display,
                thread_id=thread_id,
                thread_id_prefix=thread_id_prefix,
                explicit_name=explicit_name,
            )
        session = " | ".join(parts[1:]).strip()
        if not session or contains_thread_identity(session):
            return CodexTitle(DEFAULT_TITLE)
        return CodexTitle(safe_display_title(session, maximum_length))

    parts = normalized.split(" - ")
    if not parts or (
        parts[0].lower() not in ("codex", "codex cli")
    ):
        return None
    if len(parts) < 3:
        return CodexTitle(DEFAULT_TITLE)
    session = " - ".join(parts[1:-1]).strip()
    if not session or contains_thread_identity(session):
        return CodexTitle(DEFAULT_TITLE)
    return CodexTitle(safe_display_title(session, maximum_length))


def codex_title(raw: str, maximum_length: int) -> str | None:
    parsed = parse_codex_title(raw, maximum_length)
    return parsed.display if parsed else None


class SessionTitleResolver:
    def __init__(self, maximum_length: int) -> None:
        self.maximum_length: int = maximum_length
        self.codex_home: Path = Path(
            os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))
        )
        self.thread_id: str | None = None
        self.thread_id_prefix: str | None = None
        self.explicit_name: str | None = None
        self.display_title: str = DEFAULT_TITLE
        self.next_poll_at: float = float("inf")
        self.database_path: Path | None = None

    def observe(self, parsed: CodexTitle) -> str:
        identity_prefix = parsed.thread_id_prefix or parsed.thread_id
        if not identity_prefix:
            return parsed.display
        thread_changed = identity_prefix != self.thread_id_prefix
        previous_explicit_name = self.explicit_name
        self.thread_id = parsed.thread_id
        self.thread_id_prefix = identity_prefix
        self.explicit_name = parsed.explicit_name
        if thread_changed:
            self.database_path = None
            self.display_title = self._fallback_title()
        elif parsed.explicit_name:
            self.display_title = compact_title(
                parsed.explicit_name, self.maximum_length
            )
        elif previous_explicit_name:
            self.display_title = DEFAULT_TITLE
        self.next_poll_at = 0.0
        return self.display_title

    def poll(self, now: float | None = None) -> bytes:
        current_time = time.monotonic() if now is None else now
        if not self.thread_id_prefix or current_time < self.next_poll_at:
            return b""
        self.next_poll_at = current_time + TITLE_POLL_INTERVAL_SECONDS
        metadata = self._read_metadata()
        if metadata is not None:
            self.thread_id = metadata.thread_id
        resolved = (
            metadata.title if metadata and metadata.title else self._fallback_title()
        )
        resolved = safe_display_title(resolved, self.maximum_length)
        if not resolved or resolved == self.display_title:
            return b""
        self.display_title = resolved
        return osc_title(resolved)

    def _fallback_title(self) -> str:
        return (
            compact_title(self.explicit_name, self.maximum_length)
            if self.explicit_name
            else DEFAULT_TITLE
        )

    def _read_metadata(self) -> ThreadTitleMetadata | None:
        if sqlite3 is None:
            return None
        matches: dict[str, tuple[Path, ThreadTitleMetadata]] = {}
        for database in self._database_candidates():
            try:
                records = read_thread_titles(
                    database,
                    self.thread_id,
                    self.thread_id_prefix,
                )
            except (OSError, sqlite3.DatabaseError):
                if database == self.database_path:
                    self.database_path = None
                continue
            for record in records:
                if record.thread_id not in matches:
                    matches[record.thread_id] = (database, record)
                if len(matches) > 1:
                    return None
        if len(matches) != 1:
            return None
        database, record = next(iter(matches.values()))
        self.database_path = database
        return record

    def _database_candidates(self) -> list[Path]:
        candidates: list[Path] = []
        if self.database_path is not None:
            candidates.append(self.database_path)
        discovered = list(self.codex_home.glob("state_*.sqlite"))
        discovered.extend((self.codex_home / "sqlite").glob("state_*.sqlite"))
        discovered.sort(key=database_sort_key, reverse=True)
        candidates.extend(discovered)
        return list(dict.fromkeys(candidates))


def database_sort_key(path: Path) -> tuple[int, int]:
    match = re.search(r"state_(\d+)\.sqlite$", path.name)
    version = int(match.group(1)) if match else -1
    try:
        modified = path.stat().st_mtime_ns
    except OSError:
        modified = -1
    return version, modified


@dataclass(frozen=True)
class ThreadTitleMetadata:
    thread_id: str
    title: str | None


def read_thread_titles(
    database: Path,
    thread_id: str | None,
    thread_id_prefix: str | None,
) -> list[ThreadTitleMetadata]:
    if sqlite3 is None:
        return []
    database_uri = database.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(database_uri, uri=True, timeout=0.05)
    try:
        _ = connection.execute("PRAGMA query_only = ON")
        column_rows = _sqlite_tuples(
            connection.execute("PRAGMA table_info(threads)")
        )
        columns = {
            row[1]
            for row in column_rows
            if len(row) > 1 and isinstance(row[1], str)
        }
        selected = [
            column
            for column in ("name", "title", "preview")
            if column in columns
        ]
        if not selected or "id" not in columns:
            return []
        projections = ", ".join(
            f"substr({column}, 1, {MAX_METADATA_CHARS})" for column in selected
        )
        if thread_id:
            rows = _sqlite_tuples(
                connection.execute(
                    f"SELECT substr(id, 1, {MAX_METADATA_CHARS}), {projections}"
                    + " FROM threads WHERE id = ? LIMIT 1",
                    (thread_id,),
                )
            )
        elif thread_id_prefix:
            rows = _sqlite_tuples(
                connection.execute(
                    f"SELECT substr(id, 1, {MAX_METADATA_CHARS}), {projections}"
                    + " FROM threads WHERE substr(id, 1, ?) = ? LIMIT 2",
                    (len(thread_id_prefix), thread_id_prefix),
                )
            )
        else:
            return []
        records: list[ThreadTitleMetadata] = []
        for row in rows:
            row_thread_id = row[0]
            if not isinstance(row_thread_id, str) or not THREAD_ID.fullmatch(
                row_thread_id
            ):
                continue
            title = next(
                (
                    value
                    for value in row[1:]
                    if isinstance(value, str)
                    and compact_title(value, MAX_METADATA_CHARS)
                ),
                None,
            )
            records.append(ThreadTitleMetadata(row_thread_id.lower(), title))
        return records
    finally:
        connection.close()


class _HasFetchall(Protocol):
    def fetchall(self) -> list[tuple[object, ...]]: ...


def _sqlite_tuples(cursor: object) -> list[tuple[object, ...]]:
    return cast(_HasFetchall, cursor).fetchall()


def osc_title(title: str) -> bytes:
    return OSC_START + b"0;" + title.encode("utf-8") + OSC_BEL


class OscTitleTransformer:
    def __init__(
        self,
        maximum_length: int,
        resolver: SessionTitleResolver | None = None,
    ) -> None:
        self.maximum_length: int = maximum_length
        self.resolver: SessionTitleResolver | None = resolver
        self.pending: bytes = b""

    def feed(self, data: bytes) -> bytes:
        buffer = self.pending + data
        self.pending = b""
        output = bytearray()
        cursor = 0

        while cursor < len(buffer):
            start = buffer.find(OSC_START, cursor)
            if start < 0:
                if buffer.endswith(b"\x1b"):
                    output.extend(buffer[cursor:-1])
                    self.pending = b"\x1b"
                else:
                    output.extend(buffer[cursor:])
                break
            output.extend(buffer[cursor:start])
            end, terminator_length = find_osc_end(buffer, start + len(OSC_START))
            if end < 0:
                pending = buffer[start:]
                if len(pending) <= MAX_PENDING_OSC_BYTES:
                    self.pending = pending
                else:
                    output.extend(pending)
                break
            payload = buffer[start + len(OSC_START) : end]
            output.extend(
                rewrite_osc_title(payload, self.maximum_length, self.resolver)
            )
            cursor = end + terminator_length
        return bytes(output)

    def flush(self) -> bytes:
        pending, self.pending = self.pending, b""
        return pending


def find_osc_end(buffer: bytes, start: int) -> tuple[int, int]:
    bel = buffer.find(OSC_BEL, start)
    st = buffer.find(OSC_ST, start)
    if bel >= 0 and (st < 0 or bel <= st):
        return bel, len(OSC_BEL)
    if st >= 0:
        return st, len(OSC_ST)
    return -1, 0


def rewrite_osc_title(
    payload: bytes,
    maximum_length: int,
    resolver: SessionTitleResolver | None = None,
) -> bytes:
    if (
        len(payload) < 2
        or payload[:1] not in (b"0", b"1", b"2")
        or payload[1:2] != b";"
    ):
        return OSC_START + payload + OSC_BEL
    try:
        title = payload[2:].decode("utf-8")
    except UnicodeDecodeError:
        return OSC_START + payload + OSC_BEL
    parsed = parse_codex_title(title, maximum_length)
    if parsed is None:
        # The bridge is dedicated to one Codex process. Suppressing unrelated
        # shell title messages keeps a login shell from renaming a fresh tab.
        return b""
    rewritten = resolver.observe(parsed) if resolver else parsed.display
    return osc_title(rewritten)


class PtyRelay:
    def __init__(self, options: Options) -> None:
        self.options: Options = options
        self.child_pid: int = -1
        self.master_fd: int = -1
        self.original_stdin_mode: list[int | list[bytes | int]] | None = None
        self.title_resolver: SessionTitleResolver = SessionTitleResolver(
            options.title_max_length
        )
        self.transformer: OscTitleTransformer = OscTitleTransformer(
            options.title_max_length, self.title_resolver
        )

    def run(self) -> int:
        self.child_pid, self.master_fd = pty.fork()
        if self.child_pid == 0:
            if self.options.cwd:
                os.chdir(self.options.cwd)
            os.execvp(self.options.command[0], self.options.command)

        self._enter_raw_mode()
        self._install_signal_handlers()
        self._resize(self.options.columns, self.options.rows)
        try:
            return self._relay_until_exit()
        finally:
            self._restore_stdin_mode()
            try:
                os.close(self.master_fd)
            except OSError:
                pass

    def _relay_until_exit(self) -> int:
        stdin_fd = sys.stdin.fileno()
        stdout_fd = sys.stdout.fileno()
        control_fd = self.options.control_fd
        readable_fds = {stdin_fd, self.master_fd}
        if control_fd is not None:
            readable_fds.add(control_fd)
        resize_buffer = b""

        while True:
            try:
                ready, _, _ = select.select(list(readable_fds), [], [], 0.1)
            except OSError as error:
                if error.errno != errno.EINTR:
                    raise
                ready = []

            if stdin_fd in ready:
                data = read_fd(stdin_fd)
                if data:
                    write_all(self.master_fd, rewrite_input(data, self.options.cwd))
                else:
                    readable_fds.discard(stdin_fd)

            if self.master_fd in ready:
                data = read_fd(self.master_fd)
                if data:
                    write_all(stdout_fd, self.transformer.feed(data))
                else:
                    readable_fds.discard(self.master_fd)

            if control_fd is not None and control_fd in ready:
                data = read_fd(control_fd)
                if not data:
                    readable_fds.discard(control_fd)
                    control_fd = None
                else:
                    resize_buffer += data
                    while b"\n" in resize_buffer:
                        line, resize_buffer = resize_buffer.split(b"\n", 1)
                        self._apply_resize_line(line)

            title_update = self.title_resolver.poll()
            if title_update:
                write_all(stdout_fd, title_update)

            waited, status = os.waitpid(self.child_pid, os.WNOHANG)
            if waited == self.child_pid:
                self._drain_output(stdout_fd)
                return child_exit_code(status)

    def _drain_output(self, stdout_fd: int) -> None:
        while True:
            try:
                ready, _, _ = select.select([self.master_fd], [], [], 0)
            except OSError:
                ready = []
            if not ready:
                write_all(stdout_fd, self.transformer.flush())
                return
            data = read_fd(self.master_fd)
            if not data:
                write_all(stdout_fd, self.transformer.flush())
                return
            write_all(stdout_fd, self.transformer.feed(data))

    def _apply_resize_line(self, line: bytes) -> None:
        try:
            columns, rows = (max(1, int(value)) for value in line.split())
            self._resize(columns, rows)
        except (OSError, ValueError):
            pass

    def _resize(self, columns: int, rows: int) -> None:
        packed = struct.pack("HHHH", rows, columns, 0, 0)
        _ = fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, packed)
        os.kill(self.child_pid, signal.SIGWINCH)

    def _install_signal_handlers(self) -> None:
        def forward(signum: int, _frame: object) -> None:
            try:
                os.killpg(self.child_pid, signum)
            except OSError:
                pass

        _ = signal.signal(signal.SIGTERM, forward)
        _ = signal.signal(signal.SIGHUP, forward)

    def _enter_raw_mode(self) -> None:
        try:
            self.original_stdin_mode = termios.tcgetattr(sys.stdin.fileno())
            _ = tty.setraw(sys.stdin.fileno())
        except termios.error:
            self.original_stdin_mode = None

    def _restore_stdin_mode(self) -> None:
        if self.original_stdin_mode is None:
            return
        try:
            termios.tcsetattr(
                sys.stdin.fileno(), termios.TCSADRAIN, self.original_stdin_mode
            )
        except termios.error:
            pass


def read_fd(fd: int) -> bytes:
    try:
        return os.read(fd, READ_SIZE)
    except OSError as error:
        if error.errno == errno.EIO:
            return b""
        raise


def write_all(fd: int, data: bytes) -> None:
    cursor = 0
    while cursor < len(data):
        cursor += os.write(fd, data[cursor:])


def child_exit_code(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
