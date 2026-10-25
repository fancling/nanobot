"""History replay uses token budgets and ignores the legacy message-count setting."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.config.schema import Config
from nanobot.providers.base import GenerationSettings, LLMResponse
from nanobot.session.manager import Session


def _make_loop(tmp_path: Path, *, context_window_tokens: int = 128_000) -> AgentLoop:
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    provider.generation = GenerationSettings(max_tokens=512)
    provider.chat_with_retry = AsyncMock(return_value=LLMResponse(content="ok", tool_calls=[]))
    return AgentLoop(
        bus=MessageBus(),
        provider=provider,
        workspace=tmp_path,
        model="test-model",
        context_window_tokens=context_window_tokens,
        auto_consolidation_enabled=False,
    )


def _populate(session: Session, n: int, *, padding: str = "") -> None:
    for i in range(n):
        session.add_message("user", f"msg-{i}{padding}")
        session.add_message("assistant", f"reply-{i}{padding}")


@pytest.mark.parametrize("limit", [0, -1])
def test_history_has_no_implicit_message_limit(limit: int) -> None:
    session = Session(key="test:populated")
    _populate(session, 100)

    assert len(session.get_history()) == 200
    assert len(session.get_history(max_messages=limit)) == 200
    session.last_consolidated = 20
    history = session.get_history()
    assert len(history) == 180
    assert history[0]["content"] == "msg-10"


def test_history_allows_explicit_slice_for_other_callers() -> None:
    session = Session(key="test:populated")
    _populate(session, 100)

    history = session.get_history(max_messages=25)

    assert len(history) <= 25
    assert history[0]["role"] == "user"


@pytest.mark.asyncio
@pytest.mark.parametrize("context_window_tokens", [8192, 128_000])
async def test_process_message_replays_history_by_token_budget(
    tmp_path: Path, context_window_tokens: int,
) -> None:
    loop = _make_loop(tmp_path, context_window_tokens=context_window_tokens)
    loop.tools.get_definitions = MagicMock(return_value=[])
    session = loop.sessions.get_or_create("cli:test")
    _populate(session, 80, padding=" history" * 100)

    with patch.object(session, "get_history", wraps=session.get_history) as mock_history:
        result = await loop._process_message(
            InboundMessage(channel="cli", sender_id="user", chat_id="test", content="hello")
        )

    assert result is not None
    assert "max_messages" not in mock_history.call_args.kwargs
    assert mock_history.call_args.kwargs["max_tokens"] == loop._replay_token_budget()
    sent_messages = loop.provider.chat_with_retry.await_args.kwargs["messages"]
    sent_text = "\n".join(str(message.get("content")) for message in sent_messages)
    assert "msg-79 " in sent_text
    assert "hello" in sent_text
    if context_window_tokens == 128_000:
        # More than 120 messages fit: the earliest turn must still reach the model.
        assert "msg-0 " in sent_text
        assert len(sent_messages) > 120
    else:
        assert "msg-0 " not in sent_text
        assert len(sent_messages) < 120


@pytest.mark.parametrize("legacy_key", ["maxMessages", "max_messages"])
def test_legacy_message_limit_is_ignored(tmp_path: Path, legacy_key: str) -> None:
    config = Config.model_validate({"agents": {"defaults": {
        "workspace": str(tmp_path), legacy_key: 25,
    }}})
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    loop = AgentLoop.from_config(config, provider=provider)

    assert not hasattr(loop, "_max_messages")
    assert "maxMessages" not in config.agents.defaults.model_dump(by_alias=True)
