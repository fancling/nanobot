"""Workspace-backed session memory extraction for the embedded WebUI."""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

from loguru import logger

from nanobot.session.manager import SessionManager


class SessionMemoryExtractor:
    """Run a workspace-provided session-to-Mem0 maintenance action."""

    _SCRIPT_NAME = "extract-session-for-mem0.py"

    def __init__(
        self,
        workspace: Path,
        sessions: SessionManager | None,
        *,
        log: Any = logger,
    ) -> None:
        self.workspace = workspace
        self.sessions = sessions
        self._locks: dict[str, asyncio.Lock] = {}
        self._log = log

    @property
    def script_path(self) -> Path:
        return self.workspace / "scripts" / self._SCRIPT_NAME

    def available(self) -> bool:
        return self.sessions is not None and self.script_path.is_file()

    async def extract(self, session_key: str) -> dict[str, Any]:
        lock = self._locks.setdefault(session_key, asyncio.Lock())
        if lock.locked():
            self._log.warning("Mem0 extraction already running: session={}", session_key)
            return {
                "success": False,
                "busy": True,
                "memory_count": 0,
                "event_count": 0,
            }
        if self.sessions is None or not self.script_path.is_file():
            raise RuntimeError("Mem0 session extractor is not installed in this workspace")

        async with lock:
            session = self.sessions.get_or_create(session_key)
            if not session.messages:
                raise RuntimeError("Session has no messages to extract")
            self.sessions.save(session, fsync=True)
            session_path = self.sessions.session_path(session_key)
            started_at = time.monotonic()
            self._log.info(
                "Mem0 extraction subprocess starting: session={} messages={} script={}",
                session_key,
                len(session.messages),
                self.script_path,
            )
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(self.script_path),
                str(session_path),
                "--send",
                cwd=str(self.workspace),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self._log.info(
                "Mem0 extraction subprocess started: session={} pid={}",
                session_key,
                process.pid,
            )
            try:
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(),
                    timeout=15 * 60,
                )
            except TimeoutError:
                process.kill()
                await process.wait()
                self._log.error(
                    "Mem0 extraction subprocess timed out: session={} pid={} elapsed_s={:.1f}",
                    session_key,
                    process.pid,
                    time.monotonic() - started_at,
                )
                raise RuntimeError("Mem0 session extraction timed out") from None
            except asyncio.CancelledError:
                process.kill()
                await process.wait()
                self._log.warning(
                    "Mem0 extraction subprocess cancelled: session={} pid={} elapsed_s={:.1f}",
                    session_key,
                    process.pid,
                    time.monotonic() - started_at,
                )
                raise

        self._log.info(
            "Mem0 extraction subprocess exited: session={} pid={} returncode={} elapsed_s={:.1f}",
            session_key,
            process.pid,
            process.returncode,
            time.monotonic() - started_at,
        )

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")
        if process.returncode != 0:
            detail = next(
                (line.strip() for line in reversed(stderr.splitlines()) if line.strip()),
                "extractor process failed",
            )
            self._log.error("Mem0 extraction failed for {}: {}", session_key, detail)
            raise RuntimeError(f"Mem0 session extraction failed: {detail}")

        result_path: Path | None = None
        prefix = "Mem0 dual result:"
        for line in reversed(stdout.splitlines()):
            if line.startswith(prefix):
                result_path = Path(line[len(prefix):].strip())
                break
        if result_path is None or not result_path.is_file():
            raise RuntimeError("Mem0 extractor did not produce a result file")

        try:
            result_data = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Mem0 extractor produced an unreadable result") from exc
        if result_data.get("status") != "success":
            raise RuntimeError("Mem0 extractor reported an unsuccessful result")

        new_ids = result_data.get("new_ids")
        events = result_data.get("extracted_event_memories")
        memory_count = len(new_ids) if isinstance(new_ids, list) else 0
        event_count = len(events) if isinstance(events, list) else 0
        self._log.info(
            "Mem0 extraction result validated: session={} memories={} events={} "
            "elapsed_s={:.1f} result_path={}",
            session_key,
            memory_count,
            event_count,
            time.monotonic() - started_at,
            result_path,
        )
        return {
            "success": True,
            "busy": False,
            "memory_count": memory_count,
            "event_count": event_count,
            "result_path": str(result_path),
        }
