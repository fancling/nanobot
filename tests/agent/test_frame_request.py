from __future__ import annotations

from pathlib import Path

from nanobot.agent.context import ContextBuilder
from nanobot.agent.frame_request import FrameRequestAdapter
from nanobot.bus.events import InboundMessage
from nanobot.session.manager import Session


def test_adapter_builds_frame_only_messages(tmp_path: Path) -> None:
    context = ContextBuilder(workspace=tmp_path, timezone="UTC")
    session = Session(key="cli:direct")
    session.add_message("user", "previous user message")
    session.add_message("assistant", "previous assistant message")
    history = session.get_history(include_timestamps=True)
    msg = InboundMessage(
        channel="cli",
        sender_id="direct",
        chat_id="direct",
        content="current request",
    )

    messages = FrameRequestAdapter(context).build_frame_only_messages(
        session=session,
        history=history,
        msg=msg,
        pending_summary="old compact summary",
        runtime_lines=["Runtime flag: active"],
        workspace=tmp_path,
        tool_names=["read_file"],
    )

    assert [message["role"] for message in messages] == ["system", "user"]
    system_content = messages[0]["content"]
    assert "<workspace_frame" in system_content
    assert "conversation.recent_raw" in system_content
    assert "previous user message" in system_content
    assert "old compact summary" in system_content
    assert "Runtime flag: active" in system_content
    assert messages[1]["content"] == "current request"


def test_adapter_preserves_image_current_event_blocks(tmp_path: Path) -> None:
    context = ContextBuilder(workspace=tmp_path, timezone="UTC")
    session = Session(key="cli:direct")
    png = tmp_path / "image.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    msg = InboundMessage(
        channel="cli",
        sender_id="direct",
        chat_id="direct",
        content="describe image",
        media=[str(png)],
    )

    messages = FrameRequestAdapter(context).build_frame_only_messages(
        session=session,
        history=[],
        msg=msg,
        pending_summary=None,
        runtime_lines=[],
        workspace=tmp_path,
        tool_names=[],
    )

    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert isinstance(messages[1]["content"], list)
    assert any(block.get("type") == "image_url" for block in messages[1]["content"])
    assert any(
        block.get("type") == "text" and block.get("text") == "describe image"
        for block in messages[1]["content"]
    )
