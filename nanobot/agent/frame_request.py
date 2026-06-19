from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from nanobot.agent.workspace_frame import WorkspaceFrameBuilder, WorkspaceFrameRenderer
from nanobot.utils.image_generation_intent import image_generation_prompt


class FrameRequestAdapter:
    def __init__(
        self,
        context: Any,
        builder: WorkspaceFrameBuilder | None = None,
        renderer: WorkspaceFrameRenderer | None = None,
    ) -> None:
        self.context = context
        self.builder = builder or WorkspaceFrameBuilder(context)
        self.renderer = renderer or WorkspaceFrameRenderer()

    def build_frame_only_messages(
        self,
        *,
        session: Any,
        history: list[dict[str, Any]],
        msg: Any,
        pending_summary: str | None,
        runtime_lines: list[str],
        workspace: Path,
        tool_names: list[str],
        token_budget: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        current_text = image_generation_prompt(
            getattr(msg, "content", ""),
            getattr(msg, "metadata", {}),
        )
        user_content = self.context._build_user_content(
            current_text,
            getattr(msg, "media", None) or None,
        )
        frame = self.builder.build(
            session=session,
            history=history,
            msg=msg,
            current_input=current_text,
            current_event_content=user_content,
            pending_summary=pending_summary,
            runtime_lines=runtime_lines,
            workspace=workspace,
            tool_names=tool_names,
            token_budget=token_budget,
        )
        return [
            {"role": "system", "content": self.renderer.render(frame)},
            {"role": "user", "content": user_content},
        ]
