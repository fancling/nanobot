from __future__ import annotations

import pytest

from nanobot.reading_snapshot import (
    ReadingSnapshotError,
    normalize_reading_snapshot,
)


def test_normalize_reading_snapshot_accepts_valid_payload() -> None:
    payload = {
        "version": 1,
        "scene": "reading",
        "document": {"id": "doc-1", "title": "My Essay", "kind": "markdown"},
        "location": {"paragraph_index": 2, "paragraph_count": 8, "progress_label": "early"},
        "focus": {
            "focused_text": "The focused paragraph.",
            "selected_text": None,
            "before": "Previous paragraph.",
            "after": "Next paragraph.",
            "user_note": "This feels important.",
            "current_question": "Why does this matter?",
        },
        "reading_state": {"mode": "slow_reading", "engagement": "actively_reflecting"},
        "prediction": {
            "likely_need": "respond to the reflection",
            "bad_response_risk": "avoid generic summary",
        },
    }

    normalized = normalize_reading_snapshot(payload)

    assert normalized["version"] == 1
    assert normalized["scene"] == "reading"
    assert normalized["document"]["title"] == "My Essay"
    assert normalized["location"]["paragraph_index"] == 2
    assert normalized["focus"]["focused_text"] == "The focused paragraph."
    assert normalized["focus"]["selected_text"] is None


def test_normalize_reading_snapshot_accepts_book_level_payload_without_focus() -> None:
    payload = {
        "version": 1,
        "scene": "reading",
        "document": {"id": "doc-1", "title": "My Essay", "kind": "markdown"},
        "location": {"paragraph_index": None, "paragraph_count": 8, "progress_label": None},
        "focus": {
            "focused_text": "",
            "selected_text": None,
            "before": "",
            "after": "",
            "user_note": "",
            "current_question": "Summarize the chapter so far.",
        },
        "reading_state": {"mode": "slow_reading", "engagement": "actively_reflecting"},
        "prediction": {
            "likely_need": "respond to the current book-level question",
            "bad_response_risk": "avoid assuming a paragraph focus",
        },
    }

    normalized = normalize_reading_snapshot(payload)

    assert normalized["location"]["paragraph_index"] is None
    assert normalized["location"]["paragraph_count"] == 8
    assert normalized["focus"]["focused_text"] == ""
    assert normalized["focus"]["current_question"] == "Summarize the chapter so far."


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {"version": 2, "scene": "reading"},
        {"version": 1, "scene": "chat"},
        {"version": 1, "scene": "reading", "focus": "bad"},
    ],
)
def test_normalize_reading_snapshot_rejects_malformed_payload(payload: object) -> None:
    with pytest.raises(ReadingSnapshotError):
        normalize_reading_snapshot(payload)


def test_normalize_reading_snapshot_truncates_large_text_fields() -> None:
    payload = {
        "version": 1,
        "scene": "reading",
        "document": {"id": "doc-1", "title": "T" * 500, "kind": "markdown"},
        "location": {"paragraph_index": 0, "paragraph_count": 1, "progress_label": "P" * 500},
        "focus": {
            "focused_text": "F" * 5000,
            "selected_text": "S" * 5000,
            "before": "B" * 5000,
            "after": "A" * 5000,
            "user_note": "N" * 5000,
            "current_question": "Q" * 5000,
        },
        "reading_state": {"mode": "slow_reading", "engagement": "actively_reflecting"},
        "prediction": {"likely_need": "L" * 5000, "bad_response_risk": "R" * 5000},
    }

    normalized = normalize_reading_snapshot(payload)

    assert normalized["document"]["title"].endswith("...")
    assert len(normalized["focus"]["focused_text"]) <= 1203
    assert normalized["focus"]["focused_text"].endswith("...")
    assert len(normalized["focus"]["before"]) <= 603
    assert len(normalized["prediction"]["bad_response_risk"]) <= 403


def test_normalize_reading_snapshot_optional_blocks_default_to_empty_dicts() -> None:
    payload = {
        "version": 1,
        "scene": "reading",
        "document": {"id": "doc-1", "title": "My Essay", "kind": "markdown"},
        "location": {"paragraph_index": 2, "paragraph_count": 8},
        "focus": {"focused_text": "The focused paragraph."},
    }

    normalized = normalize_reading_snapshot(payload)

    assert normalized["reading_state"] == {}
    assert normalized["prediction"] == {}


def test_normalize_reading_snapshot_clamps_location_numbers() -> None:
    payload = {
        "version": 1,
        "scene": "reading",
        "document": {"id": "doc-1", "title": "Title", "kind": "text"},
        "location": {"paragraph_index": -5, "paragraph_count": -1},
        "focus": {"focused_text": "Text"},
    }

    normalized = normalize_reading_snapshot(payload)

    assert normalized["location"]["paragraph_index"] == 0
    assert normalized["location"]["paragraph_count"] == 1
