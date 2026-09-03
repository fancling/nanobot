from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from nanobot.webui.board import BoardError, BoardStore


def test_missing_board_can_be_created_and_cleared(tmp_path: Path) -> None:
    store = BoardStore(tmp_path)
    assert store.read() == {"content": "", "revision": None, "exists": False}
    created = store.update("# 白板\n", None)
    assert created == store.read()
    assert (tmp_path / "memory" / "board.md").read_text() == "# 白板\n"
    empty = store.update("", created["revision"])
    assert empty["content"] == ""
    assert empty["exists"] is True
    assert empty["revision"] is not None


def test_board_preserves_large_markdown_and_history(tmp_path: Path) -> None:
    store = BoardStore(tmp_path)
    (tmp_path / "memory").mkdir()
    history = tmp_path / "memory" / "history.jsonl"
    history.write_text('{"content":"Keep history"}\n')
    content = "### 内容\n\n- 记录者：测试\n" * 10_000
    saved = store.update(content, None)
    assert store.read() == saved
    assert saved["content"] == content
    assert history.read_text() == '{"content":"Keep history"}\n'


def test_external_edits_and_deletion_are_not_overwritten(tmp_path: Path) -> None:
    store = BoardStore(tmp_path)
    original = store.update("Original", None)
    path = tmp_path / "memory" / "board.md"
    path.write_text("Agent update")
    with pytest.raises(BoardError) as error:
        store.update("Stale browser edit", original["revision"])
    assert error.value.status == 409
    assert path.read_text() == "Agent update"
    path.unlink()
    with pytest.raises(BoardError) as error:
        store.update("Stale browser edit", original["revision"])
    assert error.value.status == 409
    assert not path.exists()


def test_concurrent_saves_do_not_overwrite_each_other(tmp_path: Path) -> None:
    store = BoardStore(tmp_path)
    original = store.update("Original", None)

    def save(content: str):
        try:
            return store.update(content, original["revision"])["content"]
        except BoardError as exc:
            return exc.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["First", "Second"]))
    assert results.count(409) == 1
    assert store.read()["content"] in {"First", "Second"}


@pytest.mark.parametrize("content,revision", [(None, None), ({}, None), ("ok", 123)])
def test_invalid_board_updates_are_rejected(tmp_path: Path, content, revision) -> None:
    with pytest.raises(BoardError) as error:
        BoardStore(tmp_path).update(content, revision)
    assert error.value.status == 400
    assert not (tmp_path / "memory" / "board.md").exists()


def test_board_symlink_cannot_escape_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "memory").mkdir(parents=True)
    outside = tmp_path / "private.md"
    outside.write_text("Private")
    (workspace / "memory" / "board.md").symlink_to(outside)
    store = BoardStore(workspace)
    for operation in [store.read, lambda: store.update("Overwrite", None)]:
        with pytest.raises(BoardError) as error:
            operation()
        assert error.value.status == 403
    assert outside.read_text() == "Private"


def test_failed_atomic_save_preserves_board(tmp_path: Path, monkeypatch) -> None:
    store = BoardStore(tmp_path)
    original = store.update("Original", None)

    def fail_replace(*args):
        raise OSError("disk error")

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(BoardError) as error:
        store.update("New", original["revision"])
    assert error.value.status == 500
    assert store.read() == original
    assert list((tmp_path / "memory").iterdir()) == [tmp_path / "memory" / "board.md"]
