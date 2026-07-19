"""Disk-backed Reader document state for the WebUI."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from nanobot.config.paths import get_runtime_subdir
from nanobot.session.manager import SessionManager

_READER_VERSION = 1
_INDEX_VERSION = 1
_READER_DIR = "reader"
_INDEX_FILENAME = ".reader_index.json"
_RAW_TEXT_MAX_CHARS = 5_000_000
_TEXT_MAX = 20_000
_SMALL_TEXT_MAX = 1_000
_NOTE_MAX = 4_000


class ReaderStoreError(ValueError):
    """Validation error for Reader persistence payloads."""


def reader_storage_dir() -> Path:
    return get_runtime_subdir(_READER_DIR)


def reader_record_path(chat_id: str) -> Path:
    return reader_storage_dir() / f"{SessionManager.safe_key(chat_id)}.json"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _text(value: Any, max_chars: int = _TEXT_MAX) -> str:
    if not isinstance(value, str):
        return ""
    return value[:max_chars]


def _int_or_none(value: Any, *, default: int | None = None) -> int | None:
    if value is None:
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return default


def _int(value: Any, *, default: int = 0) -> int:
    parsed = _int_or_none(value, default=default)
    return default if parsed is None else parsed


def _kind(value: Any) -> str:
    return value if value in {"text", "markdown", "epub"} else "markdown"


def _sections(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list):
        return None
    sections: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            continue
        raw_text = _text(raw.get("rawText"), _RAW_TEXT_MAX_CHARS).strip()
        if not raw_text:
            continue
        section_id = _text(raw.get("id"), 200).strip() or f"section-{index}"
        title = _text(raw.get("title"), 400).strip() or f"Section {index + 1}"
        paragraph_count = max(0, _int(raw.get("paragraphCount"), default=0))
        sections.append(
            {
                "id": section_id,
                "title": title,
                "rawText": raw_text,
                "paragraphCount": paragraph_count,
            }
        )
    return sections or None


def _state(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ReaderStoreError("reader state must be an object")
    raw_text = _text(payload.get("rawText"), _RAW_TEXT_MAX_CHARS)
    sections = _sections(payload.get("sections"))
    if not raw_text and not sections:
        raise ReaderStoreError("reader state has no readable content")
    document_id = _text(payload.get("documentId"), 300).strip()
    if not document_id:
        raise ReaderStoreError("reader document id is required")
    result: dict[str, Any] = {
        "version": _READER_VERSION,
        "documentId": document_id,
        "title": _text(payload.get("title"), 500).strip(),
        "rawText": raw_text,
        "focusedParagraphIndex": _int_or_none(payload.get("focusedParagraphIndex"), default=0),
        "selectedText": _text(payload.get("selectedText"), _SMALL_TEXT_MAX).strip(),
        "note": _text(payload.get("note"), _NOTE_MAX).strip(),
        "question": _text(payload.get("question"), _SMALL_TEXT_MAX).strip(),
        "mode": "slow_reading",
        "collapsed": payload.get("collapsed") is True,
        "documentKind": _kind(payload.get("documentKind")),
        "readerModeOpen": payload.get("readerModeOpen") is True,
        "readerSession": True,
        "sourceFileName": _text(payload.get("sourceFileName"), 500).strip() or None,
        "activeSectionIndex": max(0, _int(payload.get("activeSectionIndex"), default=0)),
    }
    workframe_id = _text(payload.get("workframeId"), 200).strip()
    if workframe_id:
        result["workframeId"] = workframe_id
    if sections:
        result["sections"] = sections
    return {key: value for key, value in result.items() if value is not None}


def _record(chat_id: str, state: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    now = _now_iso()
    return {
        "schema_version": _READER_VERSION,
        "chat_id": chat_id,
        "created_at": existing.get("created_at") if existing else now,
        "updated_at": now,
        "state": state,
    }


def read_reader_state(chat_id: str) -> dict[str, Any] | None:
    path = reader_record_path(chat_id)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("schema_version") != _READER_VERSION:
        return None
    state = data.get("state")
    if not isinstance(state, dict):
        return None
    return state


def write_reader_state(chat_id: str, payload: Any) -> dict[str, Any]:
    state = _state(payload)
    path = reader_record_path(chat_id)
    existing: dict[str, Any] | None = None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            existing = loaded
    except (OSError, json.JSONDecodeError):
        existing = None
    record = _record(chat_id, state, existing)
    tmp_path = path.with_suffix(".json.tmp")
    try:
        tmp_path.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp_path, path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise
    _write_index()
    return state


def delete_reader_state(chat_id: str) -> bool:
    path = reader_record_path(chat_id)
    deleted = False
    try:
        path.unlink()
        deleted = True
    except FileNotFoundError:
        pass
    _write_index()
    return deleted


def reader_chat_id_from_key(raw_key: str) -> str | None:
    key = unquote(raw_key)
    if not key.startswith("websocket:"):
        return None
    chat_id = key.split(":", 1)[1].strip()
    return chat_id or None


def reader_summary_for_chat_id(chat_id: str) -> dict[str, Any] | None:
    state = read_reader_state(chat_id)
    if not state:
        return None
    return {
        "reader_session": state.get("readerSession") is True,
        "document_id": state.get("documentId") or "",
        "title": state.get("title") or "",
        "document_kind": state.get("documentKind") or "markdown",
        "source_file_name": state.get("sourceFileName") or "",
        "workframe_id": state.get("workframeId") or "",
        "active_section_index": state.get("activeSectionIndex") or 0,
        "focused_paragraph_index": state.get("focusedParagraphIndex"),
    }


def list_reader_summaries() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in reader_storage_dir().glob("*.json"):
        if path.name == _INDEX_FILENAME:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        chat_id = data.get("chat_id")
        state = data.get("state")
        if not isinstance(chat_id, str) or not isinstance(state, dict):
            continue
        summary = reader_summary_for_chat_id(chat_id)
        if summary:
            result[chat_id] = summary
    return result


def _write_index() -> None:
    path = reader_storage_dir() / _INDEX_FILENAME
    payload = {"version": _INDEX_VERSION, "readers": list_reader_summaries()}
    tmp_path = path.with_suffix(".json.tmp")
    try:
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp_path, path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise
