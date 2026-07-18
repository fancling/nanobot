from __future__ import annotations

from pathlib import Path

from nanobot.agent.context import ContextBuilder


def test_context_builder_uses_separate_memory_workspace(tmp_path: Path) -> None:
    project = tmp_path / "project"
    memory_root = tmp_path / "workframes"
    project.mkdir()
    memory_root.mkdir()
    (project / "AGENTS.md").write_text("Project bootstrap instruction.", encoding="utf-8")
    (project / "memory").mkdir()
    (project / "memory" / "MEMORY.md").write_text("ordinary memory", encoding="utf-8")
    (memory_root / "memory").mkdir()
    (memory_root / "memory" / "MEMORY.md").write_text("workframe memory", encoding="utf-8")

    builder = ContextBuilder(project, timezone="UTC", memory_workspace=memory_root)

    prompt = builder.build_system_prompt(channel="websocket", workspace=project)

    assert "Project bootstrap instruction." in prompt
    assert "workframe memory" in prompt
    assert "ordinary memory" not in prompt


def test_context_builder_recent_history_comes_from_memory_workspace(tmp_path: Path) -> None:
    project = tmp_path / "project"
    memory_root = tmp_path / "workframes"
    project.mkdir()
    memory_root.mkdir()
    ordinary = ContextBuilder(project, timezone="UTC")
    workframe = ContextBuilder(project, timezone="UTC", memory_workspace=memory_root)
    ordinary.memory.append_history("ordinary recent", session_key="websocket:chat-a")
    workframe.memory.append_history("workframe recent", session_key="workframe:frame-a")

    prompt = workframe.build_system_prompt(
        channel="websocket",
        workspace=project,
        session_key="workframe:frame-a",
    )

    assert "workframe recent" in prompt
    assert "ordinary recent" not in prompt
