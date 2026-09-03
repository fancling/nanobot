"""Board injection alongside recent history in ordinary conversation context."""

from pathlib import Path

import pytest
import tiktoken
from loguru import logger

from nanobot.agent.context import ContextBuilder


def test_board_and_history_are_injected_without_modifying_files(tmp_path: Path) -> None:
    builder = ContextBuilder(tmp_path)
    board = tmp_path / "memory" / "board.md"
    board.write_text("# 白板\n\n最近在做：学习语言学。\n", encoding="utf-8")
    builder.memory.append_history("Earlier conversation", session_key="cli:direct")
    original_board = board.read_bytes()
    original_history = builder.memory.history_file.read_bytes()

    messages = builder.build_messages(
        history=[], current_message="Continue", session_key="cli:direct",
    )
    prompt = messages[0]["content"]

    assert "Earlier conversation" in prompt
    assert "# 白板\n\n最近在做：学习语言学。" in prompt
    assert prompt.index("# Recent History") < prompt.index("# Board (memory/board.md)")
    assert board.read_bytes() == original_board
    assert builder.memory.history_file.read_bytes() == original_history

    board.write_text("Updated board", encoding="utf-8")
    updated_prompt = builder.build_system_prompt()
    assert "Updated board" in updated_prompt
    assert "最近在做：学习语言学。" not in updated_prompt


def test_board_is_independent_of_dream_cursor_and_history_session(tmp_path: Path) -> None:
    builder = ContextBuilder(tmp_path)
    (tmp_path / "memory" / "board.md").write_text("Active plans", encoding="utf-8")
    cursor = builder.memory.append_history("Processed history", session_key="cli:old")
    builder.memory.set_last_dream_cursor(cursor)
    builder.memory.append_history("Other session history", session_key="cli:other")

    prompt = builder.build_system_prompt(session_key="cli:new")

    assert "Active plans" in prompt
    assert "# Recent History" not in prompt
    assert "Processed history" not in prompt
    assert "Other session history" not in prompt


@pytest.mark.parametrize("content", [None, "", " \n\t"])
def test_missing_or_empty_board_is_omitted(tmp_path: Path, content: str | None) -> None:
    builder = ContextBuilder(tmp_path)
    if content is not None:
        (tmp_path / "memory" / "board.md").write_text(content, encoding="utf-8")
    builder.memory.append_history("Recent event")

    prompt = builder.build_system_prompt()

    assert "# Board (memory/board.md)" not in prompt
    assert "Recent event" in prompt


def test_board_respects_recent_memory_injection_switch(tmp_path: Path) -> None:
    builder = ContextBuilder(tmp_path)
    (tmp_path / "memory" / "board.md").write_text("Active plans", encoding="utf-8")
    builder.memory.append_history("Recent event")

    messages = builder.build_messages(
        history=[], current_message="Dream", include_memory_recent_history=False,
    )
    prompt = messages[0]["content"]

    assert "Active plans" not in prompt
    assert "Recent event" not in prompt
    assert "# Board (memory/board.md)" not in prompt


def test_board_uses_selected_memory_workspace(tmp_path: Path) -> None:
    project = tmp_path / "project"
    memory_root = tmp_path / "shared"
    (project / "memory").mkdir(parents=True)
    (project / "memory" / "board.md").write_text("Project board", encoding="utf-8")
    builder = ContextBuilder(project, memory_workspace=memory_root)
    (memory_root / "memory" / "board.md").write_text("Shared board", encoding="utf-8")

    prompt = builder.build_system_prompt(workspace=project)

    assert "Shared board" in prompt
    assert "Project board" not in prompt


@pytest.mark.parametrize("board", [
    "Short board",
    "word" + " word" * 7_999,
    "word" + " word" * 8_000,
    "白板记录 " * 8_000 + "末尾也要完整保留 <|endoftext|>",
], ids=["below-threshold", "at-threshold", "above-threshold", "large-cjk-board"])
def test_board_is_injected_in_full_with_warning_only_above_threshold(
    tmp_path: Path, board: str,
) -> None:
    builder = ContextBuilder(tmp_path)
    (tmp_path / "memory" / "board.md").write_text(board, encoding="utf-8")
    builder.memory.append_history("Recent event remains visible")

    records: list[str] = []
    handler_id = logger.add(records.append, level="WARNING", format="{message}")
    try:
        prompt = builder.build_system_prompt()
    finally:
        logger.remove(handler_id)
    board_section = prompt.split("# Board (memory/board.md)\n\n", 1)[1]

    assert board_section == board
    assert "Recent event remains visible" in prompt
    token_count = len(tiktoken.get_encoding("cl100k_base").encode_ordinary(board))
    warnings = [record for record in records if "Board" in record]
    if token_count > 8_000:
        assert len(warnings) == 1
        assert f"({token_count} > 8000 tokens)" in warnings[0]
        assert "injecting full content without truncation" in warnings[0]
    else:
        assert not warnings


def test_board_symlink_cannot_escape_memory_workspace(tmp_path: Path) -> None:
    builder = ContextBuilder(tmp_path / "workspace")
    outside = tmp_path / "outside.md"
    outside.write_text("Outside content", encoding="utf-8")
    (builder.memory.memory_dir / "board.md").symlink_to(outside)

    with pytest.raises(PermissionError):
        builder.build_system_prompt()
