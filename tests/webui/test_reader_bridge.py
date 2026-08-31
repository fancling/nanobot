from __future__ import annotations

import pytest

from nanobot.webui.reader_bridge import (
    DEFAULT_READER_BRIDGE_TEMPLATE,
    ReaderBridgeError,
    latest_persisted_reader_turn,
    normalize_reader_bridge,
    render_reader_bridge_prompt,
)


def test_normalize_reader_bridge_supplies_default_template() -> None:
    bridge = normalize_reader_bridge({"chat_id": "chat-1"})

    assert bridge == {
        "chat_id": "chat-1",
        "prompt_template": DEFAULT_READER_BRIDGE_TEMPLATE,
    }


@pytest.mark.parametrize(
    "template",
    [
        "only {{user_prompt}}",
        "only {{reader_reply}}",
        "no placeholders",
    ],
)
def test_normalize_reader_bridge_requires_both_placeholders(template: str) -> None:
    with pytest.raises(ReaderBridgeError):
        normalize_reader_bridge(
            {
                "chat_id": "chat-1",
                "prompt_template": template,
            }
        )


def test_latest_persisted_reader_turn_uses_final_textual_assistant_reply() -> None:
    turn = latest_persisted_reader_turn(
        [
            {"role": "user", "content": "old"},
            {"role": "assistant", "content": "old answer"},
            {"role": "user", "content": "raw question"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1"}]},
            {"role": "tool", "content": "internal tool result", "tool_call_id": "call-1"},
            {"role": "assistant", "content": "reader answer"},
        ]
    )

    assert turn == ("raw question", "reader answer")


def test_render_reader_bridge_prompt_does_not_expand_placeholders_in_user_text() -> None:
    rendered = render_reader_bridge_prompt(
        "Q={{user_prompt}}\nA={{reader_reply}}",
        user_prompt="literal {{reader_reply}}",
        reader_reply="answer",
    )

    assert rendered == "Q=literal {{reader_reply}}\nA=answer"
