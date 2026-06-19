from __future__ import annotations

from datetime import datetime, timezone

from nanobot.agent.workspace_frame import (
    WorkspaceFrame,
    WorkspaceFrameActivation,
    WorkspaceFrameFocus,
    WorkspaceFrameLifecycle,
    WorkspaceFrameMeta,
    WorkspaceFrameModule,
    WorkspaceFramePolicy,
    WorkspaceFrameProvenance,
    WorkspaceFrameRenderer,
    WorkspaceFrameVisibility,
)


def _module(module_id: str, content: str, *, expose: bool = True) -> WorkspaceFrameModule:
    now = datetime(2026, 6, 19, tzinfo=timezone.utc)
    return WorkspaceFrameModule(
        module_id=module_id,
        module_type="memory",
        activation=WorkspaceFrameActivation(
            trigger="explicit_load",
            reason="test",
            priority="high",
            confidence=1.0,
        ),
        content={"text": content},
        lifecycle=WorkspaceFrameLifecycle(
            ttl="current_turn",
            created_at=now,
            expires_at=None,
        ),
        provenance=WorkspaceFrameProvenance(
            source="runtime",
            observed_at=now,
            trust_level="high",
        ),
        visibility=WorkspaceFrameVisibility(
            expose_to_llm=expose,
            expose_to_user=False,
            can_write_memory=False,
        ),
    )


def test_renderer_outputs_xmlish_frame() -> None:
    now = datetime(2026, 6, 19, tzinfo=timezone.utc)
    frame = WorkspaceFrame(
        frame_id="frame-1",
        frame_type="agent_os_workspace_frame",
        created_at=now,
        focus=WorkspaceFrameFocus(
            event_type="user_message",
            current_input="hello",
            active_topic=None,
            active_question=None,
            dialogue_anchor="cli:direct",
        ),
        modules=[_module("memory.long_term", "Remember the user prefers concise replies.")],
        policy=WorkspaceFramePolicy(
            response_mode="task_execution",
            tone="concise",
            depth="medium",
            should_do=["answer the current event"],
            should_avoid=["inventing unavailable state"],
            action_constraints=["respect workspace boundaries"],
        ),
        meta=WorkspaceFrameMeta(
            schema_version="0.1",
            token_budget={"conversation.recent_raw": 8000},
            builder_trace=["test trace"],
            render_mode="xmlish",
        ),
    )

    rendered = WorkspaceFrameRenderer().render(frame)

    assert '<workspace_frame schema_version="0.1" frame_id="frame-1">' in rendered
    assert "<focus>" in rendered
    assert "event_type: user_message" in rendered
    assert '<module id="memory.long_term" type="memory" priority="high">' in rendered
    assert "Remember the user prefers concise replies." in rendered
    assert "<policy>" in rendered
    assert "response_mode: task_execution" in rendered


def test_renderer_skips_modules_hidden_from_llm() -> None:
    now = datetime(2026, 6, 19, tzinfo=timezone.utc)
    frame = WorkspaceFrame(
        frame_id="frame-2",
        frame_type="agent_os_workspace_frame",
        created_at=now,
        focus=WorkspaceFrameFocus(
            event_type="user_message",
            current_input="hello",
            active_topic=None,
            active_question=None,
            dialogue_anchor="cli:direct",
        ),
        modules=[
            _module("visible", "shown"),
            _module("hidden", "secret debug trace", expose=False),
        ],
        policy=WorkspaceFramePolicy(
            response_mode="task_execution",
            tone="concise",
            depth="medium",
            should_do=[],
            should_avoid=[],
            action_constraints=[],
        ),
        meta=WorkspaceFrameMeta(
            schema_version="0.1",
            token_budget={},
            builder_trace=[],
            render_mode="xmlish",
        ),
    )

    rendered = WorkspaceFrameRenderer().render(frame)

    assert "shown" in rendered
    assert "secret debug trace" not in rendered
    assert 'module id="hidden"' not in rendered
