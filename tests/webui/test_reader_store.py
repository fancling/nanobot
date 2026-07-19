from __future__ import annotations

from pathlib import Path

import pytest

from nanobot.webui import reader_store


def _payload() -> dict[str, object]:
    return {
        "version": 1,
        "documentId": "doc-1",
        "title": "Book",
        "rawText": "First paragraph.\n\nSecond paragraph.",
        "focusedParagraphIndex": 1,
        "selectedText": "Second",
        "note": "note",
        "question": "question",
        "mode": "slow_reading",
        "collapsed": False,
        "documentKind": "epub",
        "readerSession": True,
        "workframeId": "frame-1",
        "sourceFileName": "book.epub",
        "activeSectionIndex": 2,
        "sections": [
            {
                "id": "chapter-1",
                "title": "Chapter 1",
                "rawText": "Chapter text.",
                "paragraphCount": 1,
            }
        ],
    }


@pytest.fixture(autouse=True)
def reader_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "reader"
    root.mkdir()
    monkeypatch.setattr(reader_store, "reader_storage_dir", lambda: root)


def test_write_read_and_summarize_reader_state() -> None:
    saved = reader_store.write_reader_state("chat-a", _payload())

    assert saved["readerSession"] is True
    assert saved["focusedParagraphIndex"] == 1
    assert saved["workframeId"] == "frame-1"
    assert reader_store.read_reader_state("chat-a") == saved
    assert reader_store.reader_summary_for_chat_id("chat-a") == {
        "reader_session": True,
        "document_id": "doc-1",
        "title": "Book",
        "document_kind": "epub",
        "source_file_name": "book.epub",
        "workframe_id": "frame-1",
        "active_section_index": 2,
        "focused_paragraph_index": 1,
    }


def test_reader_state_requires_content() -> None:
    payload = _payload()
    payload["rawText"] = ""
    payload["sections"] = []

    with pytest.raises(reader_store.ReaderStoreError):
        reader_store.write_reader_state("chat-a", payload)


def test_delete_reader_state_removes_record() -> None:
    reader_store.write_reader_state("chat-a", _payload())

    assert reader_store.delete_reader_state("chat-a") is True
    assert reader_store.read_reader_state("chat-a") is None
    assert reader_store.delete_reader_state("chat-a") is False
