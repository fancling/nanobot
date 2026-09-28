import asyncio
import json

import pytest

from nanobot.session.manager import SessionManager
from nanobot.webui.session_memory import SessionMemoryExtractor


@pytest.mark.asyncio
async def test_extract_runs_workspace_action_and_reports_result(tmp_path) -> None:
    sessions = SessionManager(tmp_path)
    session = sessions.get_or_create("websocket:test")
    session.add_message("user", "remember this")
    sessions.save(session)

    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "extract-session-for-mem0.py"
    script.write_text(
        """from pathlib import Path
import json
import sys

result_path = Path(sys.argv[1]).with_suffix('.mem0-dual-result.json')
result_path.write_text(json.dumps({
    'status': 'success',
    'new_ids': ['capsule', 'event-1', 'event-2'],
    'extracted_event_memories': [{'memory': 'one'}, {'memory': 'two'}],
}), encoding='utf-8')
print(f'Mem0 dual result: {result_path}')
""",
        encoding="utf-8",
    )
    extractor = SessionMemoryExtractor(tmp_path, sessions)

    result = await extractor.extract("websocket:test")

    result_path = sessions.session_path("websocket:test").with_suffix(
        ".mem0-dual-result.json"
    )
    assert result == {
        "success": True,
        "busy": False,
        "memory_count": 3,
        "event_count": 2,
        "result_path": str(result_path),
    }
    assert json.loads(result_path.read_text(encoding="utf-8"))["status"] == "success"


@pytest.mark.asyncio
async def test_extract_refuses_duplicate_active_run(tmp_path) -> None:
    extractor = SessionMemoryExtractor(tmp_path, SessionManager(tmp_path))
    lock = extractor._locks.setdefault("websocket:test", asyncio.Lock())

    async with lock:
        result = await extractor.extract("websocket:test")

    assert result == {
        "success": False,
        "busy": True,
        "memory_count": 0,
        "event_count": 0,
    }


def test_availability_requires_session_store_and_workspace_script(tmp_path) -> None:
    sessions = SessionManager(tmp_path)
    extractor = SessionMemoryExtractor(tmp_path, sessions)
    assert extractor.available() is False

    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "extract-session-for-mem0.py").write_text("", encoding="utf-8")
    assert extractor.available() is True
    assert SessionMemoryExtractor(tmp_path, None).available() is False
