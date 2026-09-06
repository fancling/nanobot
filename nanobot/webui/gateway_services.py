"""Composition helpers for the embedded WebUI gateway."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from loguru import logger as default_logger

from nanobot.webui.board import BoardStore
from nanobot.webui.gateway_tokens import GatewayTokenStore
from nanobot.webui.media_gateway import WebUIMediaGateway
from nanobot.webui.transcript import WebUITranscriptRecorder
from nanobot.webui.workspaces import WebUIWorkspaceController
from nanobot.webui.ws_http import GatewayHTTPHandler


@dataclass(frozen=True)
class GatewayServices:
    """Explicit dependencies shared by WebSocket transport and HTTP routes."""

    http: GatewayHTTPHandler
    board: BoardStore
    tokens: GatewayTokenStore
    media: WebUIMediaGateway
    transcripts: WebUITranscriptRecorder
    workspaces: WebUIWorkspaceController
    workframe_workspaces: WebUIWorkspaceController
    session_manager: Any | None
    workframe_session_manager: Any | None
    cron_service: Any | None
    cron_pending_job_ids: Callable[[str], set[str]] | None
    affective_state: Any | None


def build_gateway_services(
    *,
    config: Any,
    bus: Any,
    session_manager: Any | None,
    static_dist_path: Path | None,
    workspace_path: Path,
    default_restrict_to_workspace: bool,
    runtime_model_name: Any | None,
    runtime_surface: str,
    runtime_capabilities_overrides: dict[str, Any] | None,
    workframe_session_manager: Any | None = None,
    disabled_skills: set[str] | None = None,
    cron_service: Any | None = None,
    cron_pending_job_ids: Callable[[str], set[str]] | None = None,
    logger: Any = default_logger,
    affective_state: Any | None = None,
) -> GatewayServices:
    tokens = GatewayTokenStore()
    board = BoardStore(workspace_path)
    media = WebUIMediaGateway(
        workspace_path=workspace_path,
        logger=logger,
    )
    transcripts = WebUITranscriptRecorder(log=logger)
    workspaces = WebUIWorkspaceController(
        session_manager=session_manager,
        default_workspace=workspace_path,
        default_restrict_to_workspace=default_restrict_to_workspace,
    )
    workframe_workspaces = WebUIWorkspaceController(
        session_manager=workframe_session_manager,
        default_workspace=workspace_path,
        default_restrict_to_workspace=default_restrict_to_workspace,
    )
    http = GatewayHTTPHandler(
        board=board,
        config=config,
        session_manager=session_manager,
        static_dist_path=static_dist_path,
        runtime_model_name=runtime_model_name,
        runtime_surface=runtime_surface,
        runtime_capabilities_overrides=runtime_capabilities_overrides,
        bus=bus,
        tokens=tokens,
        media=media,
        workspaces=workspaces,
        skills_workspace_path=workspace_path,
        workframe_session_manager=workframe_session_manager,
        workframe_workspaces=workframe_workspaces,
        disabled_skills=disabled_skills,
        cron_service=cron_service,
        cron_pending_job_ids=cron_pending_job_ids,
        log=logger,
        affective_state=affective_state,
    )
    return GatewayServices(
        http=http,
        board=board,
        tokens=tokens,
        media=media,
        transcripts=transcripts,
        workspaces=workspaces,
        workframe_workspaces=workframe_workspaces,
        session_manager=session_manager,
        workframe_session_manager=workframe_session_manager,
        cron_service=cron_service,
        cron_pending_job_ids=cron_pending_job_ids,
        affective_state=affective_state,
    )
