from __future__ import annotations

from typing import Any, Mapping


class ReadingSnapshotError(ValueError):
    """Raised when a WebUI reading snapshot cannot be trusted."""


_TEXT_CAPS = {
    ("document", "id"): 160,
    ("document", "title"): 240,
    ("document", "kind"): 40,
    ("location", "progress_label"): 120,
    ("focus", "focused_text"): 1200,
    ("focus", "selected_text"): 800,
    ("focus", "before"): 600,
    ("focus", "after"): 600,
    ("focus", "user_note"): 800,
    ("focus", "current_question"): 400,
    ("reading_state", "mode"): 80,
    ("reading_state", "engagement"): 120,
    ("prediction", "likely_need"): 400,
    ("prediction", "bad_response_risk"): 400,
}


def normalize_reading_snapshot(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ReadingSnapshotError("reading_snapshot must be an object")
    if value.get("version") != 1:
        raise ReadingSnapshotError("unsupported reading_snapshot version")
    if value.get("scene") != "reading":
        raise ReadingSnapshotError("reading_snapshot scene must be reading")

    document = _mapping(value.get("document"), "document")
    location = _mapping(value.get("location"), "location")
    focus = _mapping(value.get("focus"), "focus")
    reading_state = _optional_mapping(value.get("reading_state"), "reading_state")
    prediction = _optional_mapping(value.get("prediction"), "prediction")

    focused_text = _text(focus, "focused_text", group="focus", required=True)
    if not focused_text:
        raise ReadingSnapshotError("reading_snapshot focus.focused_text is required")

    paragraph_count = max(1, _int(location.get("paragraph_count"), default=1))
    paragraph_index = min(
        paragraph_count - 1,
        max(0, _int(location.get("paragraph_index"), default=0)),
    )

    return {
        "version": 1,
        "scene": "reading",
        "document": {
            "id": _text(document, "id", group="document", fallback="local-document"),
            "title": _text(document, "title", group="document", fallback="Untitled"),
            "kind": _text(document, "kind", group="document", fallback="text"),
        },
        "location": {
            "paragraph_index": paragraph_index,
            "paragraph_count": paragraph_count,
            "progress_label": _text(location, "progress_label", group="location", fallback=None),
        },
        "focus": {
            "focused_text": focused_text,
            "selected_text": _text(focus, "selected_text", group="focus", fallback=None),
            "before": _text(focus, "before", group="focus", fallback=""),
            "after": _text(focus, "after", group="focus", fallback=""),
            "user_note": _text(focus, "user_note", group="focus", fallback=""),
            "current_question": _text(focus, "current_question", group="focus", fallback=""),
        },
        "reading_state": {
            "mode": _text(reading_state, "mode", group="reading_state", fallback="slow_reading"),
            "engagement": _text(
                reading_state,
                "engagement",
                group="reading_state",
                fallback="actively_reflecting",
            ),
        },
        "prediction": {
            "likely_need": _text(
                prediction,
                "likely_need",
                group="prediction",
                fallback="respond to the current reading focus",
            ),
            "bad_response_risk": _text(
                prediction,
                "bad_response_risk",
                group="prediction",
                fallback="avoid generic summary",
            ),
        },
    }


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ReadingSnapshotError(f"reading_snapshot.{field} must be an object")
    return value


def _optional_mapping(value: Any, field: str) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ReadingSnapshotError(f"reading_snapshot.{field} must be an object")
    return value


def _text(
    mapping: Mapping[str, Any],
    key: str,
    *,
    group: str,
    required: bool = False,
    fallback: str | None = "",
) -> str | None:
    value = mapping.get(key, fallback)
    if value is None:
        if required:
            raise ReadingSnapshotError(f"reading_snapshot field {key} is required")
        return None
    if not isinstance(value, str):
        raise ReadingSnapshotError(f"reading_snapshot field {key} must be a string or null")
    return _truncate(value.strip(), _TEXT_CAPS[(group, key)])


def _truncate(value: str, cap: int) -> str:
    if len(value) <= cap:
        return value
    return value[:cap].rstrip() + "..."


def _int(value: Any, *, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    return default
