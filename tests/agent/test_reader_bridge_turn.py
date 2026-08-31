from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent.loop import AgentLoop
from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.providers.base import LLMResponse, ToolCallRequest
from nanobot.session.webui_turns import WebuiTurnCoordinator, publish_turn_run_status
from nanobot.webui.metadata import WEBUI_TURN_METADATA_KEY
from nanobot.webui.reader_bridge import (
    READER_BRIDGE_COMPANION_TURN_ID_KEY,
    READER_BRIDGE_DISPATCH_METADATA_KEY,
    READER_BRIDGE_METADATA_KEY,
    READER_BRIDGE_SILENCE_MESSAGE,
)

WORKFRAME_ID = "11111111-1111-4111-8111-111111111111"
COMPANION_KEY = "websocket:companion-chat"
COMPANION_TURN_ID = "reader-companion-turn-1"


def _loop(tmp_path) -> tuple[AgentLoop, MessageBus]:
    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    provider.generation = SimpleNamespace(max_tokens=4096)
    return AgentLoop(
        bus=bus,
        provider=provider,
        workspace=tmp_path,
        model="test-model",
    ), bus


def _message(content: str) -> InboundMessage:
    return InboundMessage(
        channel="websocket",
        sender_id="reader",
        chat_id=WORKFRAME_ID,
        content=content,
        metadata={
            READER_BRIDGE_DISPATCH_METADATA_KEY: {
                "workframe_id": WORKFRAME_ID,
                "chat_session_key": COMPANION_KEY,
                READER_BRIDGE_COMPANION_TURN_ID_KEY: COMPANION_TURN_ID,
            },
            "context_chat_id": "companion-chat",
        },
        session_key_override=COMPANION_KEY,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("first_bridge", "second_bridge"),
    [(False, True), (True, False), (True, True)],
    ids=["bridge-after-chat", "chat-after-bridge", "bridge-after-bridge"],
)
async def test_reader_bridge_turns_wait_for_the_session_without_mid_turn_injection(
    tmp_path, first_bridge: bool, second_bridge: bool,
) -> None:
    loop, bus = _loop(tmp_path)
    loop._connect_mcp = AsyncMock()
    WebuiTurnCoordinator(
        bus=bus,
        sessions=loop.sessions,
        schedule_background=loop._schedule_background,
    ).subscribe(loop.runtime_events)

    def message(content: str, bridge: bool) -> InboundMessage:
        if bridge:
            return _message(content)
        return InboundMessage(
            channel="websocket",
            sender_id="user",
            chat_id="companion-chat",
            content=content,
        )

    first = message("first question", first_bridge)
    second = message("second question", second_bridge)
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    second_dispatched = asyncio.Event()
    second_finished = asyncio.Event()
    requests: list[dict] = []

    async def chat_with_retry(**kwargs):
        requests.append(kwargs)
        number = len(requests)
        if number == 1:
            first_started.set()
            await release_first.wait()
        return LLMResponse(content=f"answer {number}")

    loop.provider.chat_with_retry = AsyncMock(side_effect=chat_with_retry)
    dispatch = loop._dispatch

    async def tracked_dispatch(msg):
        if msg is second:
            second_dispatched.set()
        await dispatch(msg)
        if msg is second:
            second_finished.set()

    loop._dispatch = tracked_dispatch
    run_task = asyncio.create_task(loop.run())
    try:
        await bus.publish_inbound(first)
        await asyncio.wait_for(first_started.wait(), timeout=3)
        active_pending = loop._pending_queues[COMPANION_KEY]
        await bus.publish_inbound(second)
        await asyncio.wait_for(second_dispatched.wait(), timeout=3)

        assert active_pending.empty()
        assert loop._pending_queues[COMPANION_KEY] is active_pending
        assert len(requests) == 1  # The second dispatch must wait at the session lock.
        release_first.set()
        await asyncio.wait_for(second_finished.wait(), timeout=5)

        assert len(requests) == 2
        for request, bridge in zip(requests, (first_bridge, second_bridge)):
            names = {item["function"]["name"] for item in request["tools"]}
            if bridge:
                assert names == {"reader_reply", "reader_skip"}
            else:
                assert "reader_reply" not in names
                assert "exec" in names

        companion = loop.sessions.get_or_create(COMPANION_KEY)
        assert [(item["role"], item["content"]) for item in companion.messages] == [
            ("user", "first question"),
            ("assistant", "answer 1"),
            ("user", "second question"),
            ("assistant", "answer 2"),
        ]
        expected_replies = [
            f"answer {number}"
            for number, bridge in enumerate((first_bridge, second_bridge), start=1)
            if bridge
        ]
        outbound = list(bus.outbound._queue)
        replies = [item for item in outbound if item.metadata.get("_reader_companion_reply")]
        assert [item.content for item in replies] == expected_replies
        assert all(item.chat_id == WORKFRAME_ID for item in replies)
        assert sum(
            item.metadata.get("_turn_end") is True and item.chat_id == WORKFRAME_ID
            for item in outbound
        ) == len(expected_replies)
        assert COMPANION_KEY not in loop._pending_queues
        assert COMPANION_KEY not in loop._reader_bridge_active_sessions
    finally:
        release_first.set()
        loop.stop()
        tasks = [run_task, *[t for items in loop._active_tasks.values() for t in items]]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await loop.close_mcp()


@pytest.mark.asyncio
async def test_reader_bridge_dispatch_does_not_wait_for_chat_subagents(tmp_path) -> None:
    loop, bus = _loop(tmp_path)
    loop.provider.chat_with_retry = AsyncMock(return_value=LLMResponse(content="companion answer"))
    # Background tasks from the ordinary chat do not belong to this observation.
    loop.subagents.get_running_count_by_session = MagicMock(return_value=1)

    try:
        await asyncio.wait_for(loop._dispatch(_message("reader exchange")), timeout=3)
        replies = [
            item for item in list(bus.outbound._queue)
            if item.metadata.get("_reader_companion_reply")
        ]
        assert [item.content for item in replies] == ["companion answer"]
        assert COMPANION_KEY not in loop._reader_bridge_active_sessions
    finally:
        await loop.close_mcp()


@pytest.mark.asyncio
async def test_reader_bridge_cancellation_clears_injection_guard(tmp_path) -> None:
    loop, _ = _loop(tmp_path)
    started = asyncio.Event()

    async def chat_with_retry(**_kwargs):
        started.set()
        await asyncio.Event().wait()

    loop.provider.chat_with_retry = AsyncMock(side_effect=chat_with_retry)
    task = asyncio.create_task(loop._dispatch(_message("reader exchange")))
    try:
        await asyncio.wait_for(started.wait(), timeout=3)
        assert COMPANION_KEY in loop._reader_bridge_active_sessions
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert COMPANION_KEY not in loop._pending_queues
        assert COMPANION_KEY not in loop._reader_bridge_active_sessions
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await loop.close_mcp()


@pytest.mark.asyncio
async def test_reader_bridge_delivers_natural_reply_with_only_reader_tools(tmp_path) -> None:
    loop, bus = _loop(tmp_path)
    loop.provider.chat_with_retry = AsyncMock(
        return_value=LLMResponse(content="natural companion answer", tool_calls=[])
    )

    result = await loop._process_message(_message("wrapped reader exchange"))

    assert result is None
    loop.provider.chat_with_retry.assert_awaited_once()
    request = loop.provider.chat_with_retry.await_args.kwargs
    assert "tool_choice" not in request
    assert "reasoning_effort" not in request
    assert {
        definition["function"]["name"] for definition in request["tools"]
    } == {"reader_reply", "reader_skip"}

    delivered = next(
        message
        for message in list(bus.outbound._queue)
        if message.metadata.get("_reader_companion_reply") is True
    )
    assert delivered.chat_id == WORKFRAME_ID
    assert delivered.content == "natural companion answer"

    companion = loop.sessions.get_or_create(COMPANION_KEY)
    assert [(item["role"], item["content"]) for item in companion.messages] == [
        ("user", "wrapped reader exchange"),
        ("assistant", "natural companion answer"),
    ]
    assert all("tool_calls" not in item for item in companion.messages)

    workframe = loop.workframe.sessions.get_or_create(f"workframe:{WORKFRAME_ID}")
    assert workframe.messages[-1]["content"] == "natural companion answer"
    assert workframe.messages[-1]["reader_companion_reply"] is True


@pytest.mark.asyncio
async def test_reader_bridge_persists_clean_turn_and_delivers_tool_reply(tmp_path) -> None:
    loop, bus = _loop(tmp_path)
    loop.provider.chat_with_retry = AsyncMock(
        return_value=LLMResponse(
            content="",
            tool_calls=[
                ToolCallRequest(
                    id="call-1",
                    name="reader_reply",
                    arguments={"content": "companion answer"},
                )
            ],
        )
    )

    result = await loop._process_message(_message("wrapped reader exchange"))

    assert result is None
    loop.provider.chat_with_retry.assert_awaited_once()
    request = loop.provider.chat_with_retry.await_args.kwargs
    assert "tool_choice" not in request
    assert "reasoning_effort" not in request
    assert {
        definition["function"]["name"] for definition in request["tools"]
    } == {"reader_reply", "reader_skip"}
    delivered = next(
        message
        for message in list(bus.outbound._queue)
        if message.metadata.get("_reader_companion_reply") is True
    )
    assert delivered.chat_id == WORKFRAME_ID
    assert delivered.content == "companion answer"

    companion = loop.sessions.get_or_create(COMPANION_KEY)
    assert [(item["role"], item["content"]) for item in companion.messages] == [
        ("user", "wrapped reader exchange"),
        ("assistant", "companion answer"),
    ]
    assert all("tool_calls" not in item for item in companion.messages)

    workframe = loop.workframe.sessions.get_or_create(f"workframe:{WORKFRAME_ID}")
    assert workframe.messages[-1]["content"] == "companion answer"
    assert workframe.messages[-1]["reader_companion_reply"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("skip_arguments", "reflection"),
    [
        ({}, None),
        (
            {"content": "The Reader answer was complete, so I chose not to interrupt."},
            "The Reader answer was complete, so I chose not to interrupt.",
        ),
    ],
)
async def test_reader_bridge_explicit_skip_records_silence_only_in_companion(
    tmp_path,
    skip_arguments: dict[str, str],
    reflection: str | None,
) -> None:
    loop, bus = _loop(tmp_path)
    loop.provider.chat_with_retry = AsyncMock(
        return_value=LLMResponse(
            content="",
            tool_calls=[
                ToolCallRequest(
                    id="call-1",
                    name="reader_skip",
                    arguments=skip_arguments,
                )
            ],
        )
    )
    expected_silence = (
        f"{READER_BRIDGE_SILENCE_MESSAGE}\n\n{reflection}"
        if reflection
        else READER_BRIDGE_SILENCE_MESSAGE
    )

    result = await loop._process_message(_message("wrapped reader exchange"))

    assert result is None
    loop.provider.chat_with_retry.assert_awaited_once()
    request = loop.provider.chat_with_retry.await_args.kwargs
    assert "tool_choice" not in request
    assert "reasoning_effort" not in request
    assert {
        definition["function"]["name"] for definition in request["tools"]
    } == {"reader_reply", "reader_skip"}
    skip_definition = next(
        definition
        for definition in request["tools"]
        if definition["function"]["name"] == "reader_skip"
    )
    skip_parameters = skip_definition["function"]["parameters"]
    assert skip_parameters["properties"]["content"]["maxLength"] == 4_000
    assert "content" not in skip_parameters.get("required", [])
    silence = bus.outbound.get_nowait()
    assert silence.chat_id == "companion-chat"
    assert silence.content == expected_silence
    assert silence.metadata["_reader_companion_silence"] is True
    assert silence.metadata[WEBUI_TURN_METADATA_KEY] == COMPANION_TURN_ID
    assert bus.outbound.empty()

    companion = loop.sessions.get_or_create(COMPANION_KEY)
    assert [(item["role"], item["content"]) for item in companion.messages] == [
        ("user", "wrapped reader exchange"),
        ("assistant", expected_silence),
    ]
    assert companion.messages[-1]["reader_companion_silence"] is True

    workframe = loop.workframe.sessions.get_or_create(f"workframe:{WORKFRAME_ID}")
    assert all(
        item.get("content") != expected_silence
        for item in workframe.messages
    )

    loop.provider.chat_with_retry.return_value = LLMResponse(
        content="follow-up companion answer",
        tool_calls=[],
    )
    await loop._process_message(_message("next wrapped reader exchange"))

    next_request = loop.provider.chat_with_retry.await_args_list[1].kwargs
    assert any(
        item.get("role") == "assistant"
        and item.get("content") == expected_silence
        for item in next_request["messages"]
    )


@pytest.mark.asyncio
async def test_reader_bridge_keeps_visible_run_open_between_both_phases() -> None:
    bus = MessageBus()
    first_phase = InboundMessage(
        channel="websocket",
        sender_id="reader",
        chat_id=WORKFRAME_ID,
        content="question",
        metadata={READER_BRIDGE_METADATA_KEY: {"chat_id": "companion-chat"}},
    )

    await publish_turn_run_status(bus, first_phase, "idle")

    assert bus.outbound.empty()
