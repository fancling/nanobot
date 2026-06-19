"""Regression tests for frame-only requests through the tool loop."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.agent.runner import AgentRunner, AgentRunSpec
from nanobot.config.schema import AgentDefaults
from nanobot.providers.base import LLMProvider, LLMResponse, ToolCallRequest


@pytest.mark.asyncio
async def test_runner_replays_frame_request_with_tool_call_and_result() -> None:
    provider = MagicMock(spec=LLMProvider)
    provider_requests: list[list[dict]] = []

    async def chat_with_retry(*, messages, **_kwargs):
        provider_requests.append(messages)
        if len(provider_requests) == 1:
            return LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(
                        id="call_1",
                        name="read_file",
                        arguments={"path": "README.md"},
                    )
                ],
                usage={"prompt_tokens": 1, "completion_tokens": 1},
            )
        return LLMResponse(
            content="done",
            tool_calls=[],
            usage={"prompt_tokens": 1, "completion_tokens": 1},
        )

    provider.chat_with_retry = chat_with_retry
    tools = MagicMock()
    tools.get_definitions.return_value = []
    tools.execute = AsyncMock(return_value="tool result content")

    initial_messages = [
        {"role": "system", "content": "<workspace_frame>frame</workspace_frame>"},
        {"role": "user", "content": "current event"},
    ]

    result = await AgentRunner(provider).run(
        AgentRunSpec(
            initial_messages=initial_messages,
            tools=tools,
            model="test-model",
            max_iterations=3,
            max_tool_result_chars=AgentDefaults().max_tool_result_chars,
        )
    )

    assert result.final_content == "done"
    assert len(provider_requests) == 2

    second_request = provider_requests[1]
    assert {"role": "system", "content": "<workspace_frame>frame</workspace_frame>"} in second_request
    assert {"role": "user", "content": "current event"} in second_request
    assert any(
        message.get("role") == "assistant" and message.get("tool_calls")
        for message in second_request
    )
    assert any(
        message.get("role") == "tool" and message.get("content") == "tool result content"
        for message in second_request
    )
