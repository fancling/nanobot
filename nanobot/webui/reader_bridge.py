"""Helpers for relaying persisted Reader turns into an ordinary chat session."""

from __future__ import annotations

import re
from typing import Any

READER_BRIDGE_METADATA_KEY = "_reader_chat_bridge"
READER_BRIDGE_DISPATCH_METADATA_KEY = "_reader_chat_bridge_dispatch"
READER_BRIDGE_COMPANION_TURN_ID_KEY = "companion_turn_id"
READER_BRIDGE_SILENCE_MESSAGE = "[Reader companion remained silent for this exchange.]"

DEFAULT_READER_BRIDGE_TEMPLATE = """\
The following exchange just happened between this user and a Reader sub-persona.

<reader_user>
{{user_prompt}}
</reader_user>

<reader_assistant>
{{reader_reply}}
</reader_assistant>"""

_TEMPLATE_MAX_CHARS = 20_000
_PLACEHOLDER_RE = re.compile(r"\{\{(user_prompt|reader_reply)\}\}")
_CHAT_ID_RE = re.compile(r"^[A-Za-z0-9_:-]{1,64}$")


class ReaderBridgeError(ValueError):
    """Invalid Reader-to-chat bridge request."""


def normalize_reader_bridge(value: Any) -> dict[str, str] | None:
    """Validate a bridge request carried by a ``workframe_message`` envelope."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ReaderBridgeError("reader chat bridge must be an object")

    chat_id = value.get("chat_id")
    if not isinstance(chat_id, str) or _CHAT_ID_RE.fullmatch(chat_id) is None:
        raise ReaderBridgeError("reader chat bridge has an invalid chat_id")

    raw_template = value.get("prompt_template")
    if raw_template is None or raw_template == "":
        prompt_template = DEFAULT_READER_BRIDGE_TEMPLATE
    elif not isinstance(raw_template, str):
        raise ReaderBridgeError("reader chat bridge prompt_template must be a string")
    else:
        prompt_template = raw_template

    if len(prompt_template) > _TEMPLATE_MAX_CHARS:
        raise ReaderBridgeError("reader chat bridge prompt_template is too large")
    placeholders = set(_PLACEHOLDER_RE.findall(prompt_template))
    if placeholders != {"user_prompt", "reader_reply"}:
        raise ReaderBridgeError(
            "reader chat bridge prompt_template must contain "
            "{{user_prompt}} and {{reader_reply}}"
        )
    return {"chat_id": chat_id, "prompt_template": prompt_template}


def _message_text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None
    parts = [
        block.get("text")
        for block in content
        if isinstance(block, dict)
        and block.get("type") == "text"
        and isinstance(block.get("text"), str)
    ]
    return "\n".join(parts) if parts else None


def latest_persisted_reader_turn(
    messages: list[dict[str, Any]],
) -> tuple[str, str] | None:
    """Return the latest persisted user prompt and final textual LLM reply."""
    user_index = next(
        (
            index
            for index in range(len(messages) - 1, -1, -1)
            if messages[index].get("role") == "user"
        ),
        None,
    )
    if user_index is None:
        return None

    user_prompt = _message_text(messages[user_index].get("content"))
    if user_prompt is None:
        return None

    reader_reply: str | None = None
    for message in messages[user_index + 1 :]:
        if message.get("role") != "assistant":
            continue
        text = _message_text(message.get("content"))
        if text is not None and text.strip():
            reader_reply = text
    if reader_reply is None:
        return None
    return user_prompt, reader_reply


def render_reader_bridge_prompt(
    prompt_template: str,
    *,
    user_prompt: str,
    reader_reply: str,
) -> str:
    """Render only the two explicit placeholders without interpreting user text."""
    values = {
        "user_prompt": user_prompt,
        "reader_reply": reader_reply,
    }
    return _PLACEHOLDER_RE.sub(lambda match: values[match.group(1)], prompt_template)
