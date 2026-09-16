"""Step 50 - the step 30 evaluation format, run through TrueForge.

A suite is a directory of tasks; a task is `task.md` plus one checker
(`check.py` or `expect.txt`) and an optional `workspace/`. Each run copies
the workspace to a temp directory, serves it over MCP with the step's
`tools_server.py`, opens a session with that server attached and approvals
off, streams one turn, and checks the result in the workspace. The report
carries the pass rate and the turn metrics per task.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from trueforge_sdk import AgentSpec, DynamicSubAgentsConfig, McpServer, Model, RemoteMcpServerManifest, RuntimeConfig, SessionAgentSpecBody, UserMessage

from .common import MODEL, EventIndex, as_dict, text_of

TOOLS_NAME = "s50-tools"
CHECKERS = ("check.py", "expect.txt")
CHECK_TIMEOUT = 120
INSTRUCTIONS = (
    "You are a coding agent. The project lives behind the s50-tools MCP server: use list_dir and "
    "read_file to look at it, write_file and str_replace to change it, and bash to run commands in "
    "its root (bash; python and rg are on PATH). Paths are relative to the project root. When a task "
    "asks you to delegate a search, use create_sub_agent. Finish with the answer the task asks for."
)


@dataclass
class Task:
    name: str
    path: Path
    prompt: str
    checker: str


@dataclass
class Result:
    task: str
    passed: bool
    detail: str
    answer: str
    seconds: float
    metrics: dict = field(default_factory=dict)
    session_id: str = ""
    turn_id: str = ""


def find_checker(task_dir: Path) -> str | None:
    """The first checker file the task ships, in CHECKERS order."""
    return next((name for name in CHECKERS if (task_dir / name).exists()), None)


def load_suite(suite_dir) -> list[Task]:
    """Every task directory with a task.md and a checker, sorted by name."""
    suite_dir = Path(suite_dir)
    if not suite_dir.is_dir():
        raise FileNotFoundError(f"suite directory not found: {suite_dir}")
    tasks = []
    for task_dir in sorted(p for p in suite_dir.iterdir() if p.is_dir()):
        prompt_file, checker = task_dir / "task.md", find_checker(task_dir)
        if prompt_file.exists() and checker:
            tasks.append(Task(task_dir.name, task_dir, prompt_file.read_text(encoding="utf-8").strip(), checker))
    return tasks


def register_tools(client, url: str) -> str:
    """Create or replace the `s50-tools` MCP server entry so the TrueForge server can reach the workspace."""
    manifest = RemoteMcpServerManifest(name=TOOLS_NAME, url=url, description="Step 50 coding tools rooted at the eval workspace")
    return client.settings.mcp_servers.create_or_update(manifest=manifest).data.name


def build_spec(model: str = MODEL) -> SessionAgentSpecBody:
    """The eval agent: the tools server attached, every tool loaded, no approvals, subagents on."""
    tools = McpServer(name=TOOLS_NAME, preload=True, require_approval_for_tools=[])
    return SessionAgentSpecBody(spec=AgentSpec(
        model=Model(name=model),
        instructions=INSTRUCTIONS,
        mcp_servers=[tools],
        config=RuntimeConfig(dynamic_sub_agents=DynamicSubAgentsConfig(enabled=True), iteration_limit=40),
    ))


def run_turn(client, session_id: str, prompt: str, on_event=None):
    """Stream one turn. Returns (turn_id, answer, metrics); `answer` is the final message's text."""
    index, turn_id, answer, metrics = EventIndex(), "", "", {}
    stream = client.sessions.create_turn_stream(session_id=session_id, input=[UserMessage(content=prompt)])
    for event in stream:
        event = as_dict(event)
        if on_event:
            on_event(event)
        kind = event.get("type")
        if kind == "turn.created":
            turn_id = event.get("turn_id", "")
        elif kind in ("model.message", "model.message.delta"):
            merged = index.add(event)
            if merged is not None and merged.get("thread_id") == "main" and text_of(merged.get("content")):
                answer = text_of(merged["content"])  # the last main-thread text is the answer
        elif kind == "turn.done":
            state = event.get("state") or {}
            metrics = dict(state.get("metrics") or {})
            output = text_of((state.get("output") or {}).get("content"))
            answer = output or answer
            if state.get("status") != "done":
                answer = answer or f"turn ended {state.get('status')}: {state.get('reason') or state.get('message') or ''}"
    return turn_id, answer, metrics


def run_check_py(task: Task, workspace: Path):
    """Run the task's check.py with the workspace as cwd. Exit 0 is a pass."""
    try:
        completed = subprocess.run(
            [sys.executable, str(task.path / "check.py")],
            cwd=workspace, capture_output=True, text=True, timeout=CHECK_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return False, f"check.py took more than {CHECK_TIMEOUT}s"
    output = (completed.stdout + completed.stderr).strip()
    tail = "\n".join(output.splitlines()[-5:])
    return completed.returncode == 0, f"check.py exited {completed.returncode}" + (f": {tail}" if tail else "")


def run_expect(task: Task, answer: str):
    """Pass when the expected text appears in the final answer."""
    expected = (task.path / "expect.txt").read_text(encoding="utf-8").strip()
    found = expected in answer
    return found, f"expected {expected!r} {'found' if found else 'missing'} in the answer"


def check(task: Task, workspace: Path, answer: str):
    return run_check_py(task, workspace) if task.checker == "check.py" else run_expect(task, answer)


def run_task(client, task: Task, port: int, keep: bool = False, on_event=None, spec=None) -> Result:
    """One run of one task: fresh workspace, its own tools server, one session, one turn, one check."""
    from tools_server import ToolsServer

    root = Path(tempfile.mkdtemp(prefix=f"eval-{task.name}-"))
    workspace = root / "workspace"
    if (task.path / "workspace").is_dir():
        shutil.copytree(task.path / "workspace", workspace)
    else:
        workspace.mkdir()

    started = time.perf_counter()
    try:
        with ToolsServer(workspace, port=port) as tools:
            register_tools(client, tools.url)
            session_id = client.sessions.create(agent=spec or build_spec()).data.id
            turn_id, answer, metrics = run_turn(client, session_id, task.prompt, on_event)
        passed, detail = check(task, workspace, answer)
    except Exception as failed:  # noqa: BLE001 - one broken run must not end the suite
        session_id, turn_id, answer, metrics = "", "", "", {}
        passed, detail = False, f"run failed: {type(failed).__name__}: {failed}"
    seconds = round(time.perf_counter() - started, 3)
    if not keep:
        shutil.rmtree(root, ignore_errors=True)
    return Result(task.name, passed, detail, answer, seconds, metrics, session_id, turn_id)


def summarise(results: list[Result]) -> dict:
    """Pass rate and summed metrics over a list of results."""
    passed = sum(1 for r in results if r.passed)
    totals: dict = {}
    for result in results:
        for key, value in result.metrics.items():
            if isinstance(value, (int, float)):
                totals[key] = totals.get(key, 0) + value
    return {
        "runs": len(results),
        "passed": passed,
        "pass_rate": round(passed / len(results), 3) if results else 0.0,
        "seconds": round(sum(r.seconds for r in results), 3),
        "metrics": totals,
    }


def run_suite(client, suite_dir, port: int, report_path=None, keep: bool = False, on_event=None, out=None) -> dict:
    """Run every task once, print a table and write the report. Returns the report dict."""
    out = out or sys.stdout
    suite_dir = Path(suite_dir)
    tasks = load_suite(suite_dir)
    results = []
    for task in tasks:
        out.write(f"running {task.name} ...\n")
        result = run_task(client, task, port, keep, on_event)
        results.append(result)
        out.write(f"  {'PASS' if result.passed else 'FAIL'}  {result.detail.splitlines()[0]}\n")
    report = {
        "suite": suite_dir.name,
        "model": MODEL,
        "started": datetime.now().isoformat(timespec="seconds"),
        "tasks": [asdict(r) for r in results],
        **summarise(results),
    }
    report_path = Path(report_path or suite_dir / "eval_report.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    out.write(table(report) + f"\nreport: {report_path.name}\n")
    return report


def table(report: dict) -> str:
    """The report as a text table: one row per task and a totals row."""
    header = f"{'task':<16}{'pass':<6}{'sec':>7}{'in':>8}{'out':>7}  answer"
    rows = [header, "-" * len(header)]
    for task in report["tasks"]:
        m = task["metrics"]
        first = (task["answer"] or task["detail"]).strip().splitlines()[0] if (task["answer"] or task["detail"]).strip() else ""
        rows.append(f"{task['task']:<16}{'yes' if task['passed'] else 'no':<6}{task['seconds']:>7.1f}{m.get('total_input_tokens', 0):>8}{m.get('total_output_tokens', 0):>7}  {first[:40]}")
    m = report["metrics"]
    rows.append(f"{'total':<16}{report['passed']}/{report['runs']:<4}{report['seconds']:>7.1f}{m.get('total_input_tokens', 0):>8}{m.get('total_output_tokens', 0):>7}  pass rate {report['pass_rate']:.0%}")
    return "\n".join(rows)
