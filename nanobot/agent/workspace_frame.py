from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

FramePriority = Literal["critical", "high", "medium", "low"]


@dataclass(frozen=True)
class WorkspaceFrameFocus:
    event_type: str
    current_input: str | None
    active_topic: str | None
    active_question: str | None
    dialogue_anchor: str | None


@dataclass(frozen=True)
class WorkspaceFrameActivation:
    trigger: str
    reason: str
    priority: FramePriority
    confidence: float


@dataclass(frozen=True)
class WorkspaceFrameLifecycle:
    ttl: str
    created_at: datetime
    expires_at: datetime | None


@dataclass(frozen=True)
class WorkspaceFrameProvenance:
    source: str
    observed_at: datetime
    trust_level: str


@dataclass(frozen=True)
class WorkspaceFrameVisibility:
    expose_to_llm: bool
    expose_to_user: bool
    can_write_memory: bool


@dataclass(frozen=True)
class WorkspaceFrameModule:
    module_id: str
    module_type: str
    activation: WorkspaceFrameActivation
    content: dict[str, Any]
    lifecycle: WorkspaceFrameLifecycle
    provenance: WorkspaceFrameProvenance
    visibility: WorkspaceFrameVisibility


@dataclass(frozen=True)
class WorkspaceFramePolicy:
    response_mode: str
    tone: str
    depth: str
    should_do: list[str]
    should_avoid: list[str]
    action_constraints: list[str]


@dataclass(frozen=True)
class WorkspaceFrameMeta:
    schema_version: str
    token_budget: dict[str, int]
    builder_trace: list[str]
    render_mode: str


@dataclass(frozen=True)
class WorkspaceFrame:
    frame_id: str
    frame_type: str
    created_at: datetime
    focus: WorkspaceFrameFocus
    modules: list[WorkspaceFrameModule]
    policy: WorkspaceFramePolicy
    meta: WorkspaceFrameMeta


class WorkspaceFrameRenderer:
    def render(self, frame: WorkspaceFrame) -> str:
        lines = [
            f'<workspace_frame schema_version="{frame.meta.schema_version}" '
            f'frame_id="{frame.frame_id}">',
            f"frame_type: {frame.frame_type}",
            f"created_at: {self._render_value(frame.created_at)}",
            "<focus>",
        ]
        lines.extend(self._render_fields(frame.focus))
        lines.append("</focus>")

        for module in frame.modules:
            if not module.visibility.expose_to_llm:
                continue
            lines.extend(self._render_module(module))

        lines.append("<policy>")
        lines.extend(self._render_fields(frame.policy))
        lines.append("</policy>")
        lines.append("</workspace_frame>")
        return "\n".join(lines)

    def _render_module(self, module: WorkspaceFrameModule) -> list[str]:
        lines = [
            f'<module id="{module.module_id}" type="{module.module_type}" '
            f'priority="{module.activation.priority}">',
            "<activation>",
        ]
        lines.extend(self._render_fields(module.activation))
        lines.append("</activation>")
        lines.append("<content>")
        lines.extend(self._render_mapping(module.content))
        lines.append("</content>")
        lines.append("<lifecycle>")
        lines.extend(self._render_fields(module.lifecycle))
        lines.append("</lifecycle>")
        lines.append("<provenance>")
        lines.extend(self._render_fields(module.provenance))
        lines.append("</provenance>")
        lines.append("</module>")
        return lines

    def _render_fields(self, value: Any) -> list[str]:
        return self._render_mapping(value.__dict__)

    def _render_mapping(self, values: dict[str, Any]) -> list[str]:
        return [f"{key}: {self._render_value(value)}" for key, value in values.items()]

    def _render_value(self, value: Any) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False, indent=2, default=str)
