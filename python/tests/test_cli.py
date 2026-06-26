from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def run_cli(tmp_path: Path, *args: str) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "openskillkit_evolution.cli", "--project-root", str(tmp_path), *args],
        cwd=Path(__file__).parents[1],
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(proc.stdout)


def test_plan_task_and_artifact_paths(tmp_path: Path) -> None:
    result = run_cli(
        tmp_path,
        "plan-task",
        "--title",
        "Local task",
        "--prompt",
        "Build local anchors only.",
        "--forbidden-identifier",
        "hidden-case",
    )
    assert result["task"]["schemaVersion"] == "openskill-kit.openworld-task.v1"
    assert result["audit"]["status"] == "pass"
    assert ".openskill-kit" in result["paths"]["task"]
    assert Path(result["paths"]["task"]).exists()


def test_research_sanitizes_forbidden_query(tmp_path: Path) -> None:
    result = run_cli(
        tmp_path,
        "research",
        "--task-id",
        "owtask_test",
        "--query",
        "Find docs for hidden-case oracle",
        "--forbidden-identifier",
        "hidden-case",
    )
    assert "hidden-case" not in result["query"]
    assert "oracle" not in result["query"].lower()
    assert result["source"]["leakageAuditId"] == result["audit"]["id"]
