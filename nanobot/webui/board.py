"""Read and edit the shared memory board without overwriting stale revisions."""

from __future__ import annotations

import hashlib
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from nanobot.security.workspace_policy import WorkspaceBoundaryError, resolve_allowed_path


class BoardError(ValueError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class BoardStore:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self._lock = threading.Lock()

    def _path(self) -> Path:
        try:
            return resolve_allowed_path(
                "memory/board.md", workspace=self.workspace, allowed_root=self.workspace,
            )
        except WorkspaceBoundaryError as exc:
            raise BoardError(403, "board is outside the memory workspace") from exc

    @staticmethod
    def _payload(raw: bytes | None) -> dict[str, Any]:
        return {
            "content": raw.decode("utf-8") if raw is not None else "",
            "revision": hashlib.sha256(raw).hexdigest() if raw is not None else None,
            "exists": raw is not None,
        }

    def read(self) -> dict[str, Any]:
        try:
            return self._payload(self._path().read_bytes())
        except FileNotFoundError:
            return self._payload(None)
        except (OSError, UnicodeError) as exc:
            raise BoardError(500, "failed to read board") from exc

    def update(self, content: Any, revision: Any) -> dict[str, Any]:
        if not isinstance(content, str) or (revision is not None and not isinstance(revision, str)):
            raise BoardError(400, "invalid board content or revision")
        try:
            raw = content.encode("utf-8")
        except UnicodeError as exc:
            raise BoardError(400, "board must be valid UTF-8") from exc
        with self._lock:
            if self.read()["revision"] != revision:
                raise BoardError(409, "board changed since it was loaded; reload before saving")
            path = self._path()
            temporary: Path | None = None
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                    handle.write(raw)
                    handle.flush()
                    os.fsync(handle.fileno())
                temporary.replace(path)
            except OSError as exc:
                raise BoardError(500, "failed to save board") from exc
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            return self._payload(raw)
