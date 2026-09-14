"""Step 50 - offline tests: a fake TrueForge server in a thread, the real SDK pointed at it."""

import asyncio
import io
import json
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import demo  # noqa: E402
from client import evaluate, sessions  # noqa: E402
from client.common import EventIndex, connect  # noqa: E402
from client.threads import ThreadPrinter, build_spec, run_threads  # noqa: E402
from tools_server import ToolsServer, free_port  # noqa: E402

HERE = Path(__file__).resolve().parent


# --- the event script of one parallel-subagent turn, in the wire shapes of the docs ---

T0 = "2026-01-01T00:00:00Z"


def ev(kind, **fields):
    """One event in the wire shape of the docs; every event carries `created_at`."""
    return {"type": kind, "created_at": T0, **fields}


def message(id_, thread_id, content):
    return ev("model.message", id=id_, thread_id=thread_id, content=content, finish_reason="stop")


def two_thread_turn():
    return [
        ev("turn.created", id="e1", turn_id="turn-1", state={"status": "running"}),
        ev("model.message", id="m1", thread_id="main"),
        ev("model.message.delta", id="m1", thread_id="main", tool_calls=[
            {"index": 0, "id": "c1", "type": "function", "function": {"name": "create_sub_agent", "arguments": ""}}]),
        ev("model.message.delta", id="m1", thread_id="main", tool_calls=[
            {"index": 0, "function": {"arguments": '{"name":"Alpha","input":"look at alpha"}'}}]),
        ev("model.message.delta", id="m1", thread_id="main", tool_calls=[
            {"index": 1, "id": "c2", "type": "function", "function": {"name": "create_sub_agent", "arguments": '{"name":"Beta","input":"look at beta"}'}}]),
        ev("model.message.delta", id="m1", thread_id="main", finish_reason="tool_calls",
           usage={"input_tokens": 10, "output_tokens": 4, "input_tokens_breakdown": {"harness": 10, "skills": 0, "instructions": 0, "tool_definitions": 0, "messages": 0}}),
        ev("thread.created", id="e2", thread_id="th-a", title="Alpha", parent={"thread_id": "main", "tool_call_id": "c1"},
           agent_info={"type": "dynamic", "name": "Alpha", "input": "look at alpha"}),
        ev("thread.created", id="e3", thread_id="th-b", title="Beta", parent={"thread_id": "main", "tool_call_id": "c2"},
           agent_info={"type": "dynamic", "name": "Beta", "input": "look at beta"}),
        ev("model.message", id="m2", thread_id="th-a"),
        ev("model.message", id="m3", thread_id="th-b"),
        ev("model.message.delta", id="m3", thread_id="th-b", content="beta "),
        ev("model.message.delta", id="m2", thread_id="th-a", content="alpha "),
        ev("model.message.delta", id="m3", thread_id="th-b", content="report", finish_reason="stop"),
        ev("tool.response", id="e4", thread_id="main", tool_call_id="c2", content=""),
        ev("thread.done", id="e5", thread_id="th-b", title="Beta", state={"status": "done", "output": message("m3", "th-b", "beta report")}),
        ev("model.message.delta", id="m2", thread_id="th-a", content="report", finish_reason="stop"),
        ev("tool.response", id="e6", thread_id="main", tool_call_id="c1", content=""),
        ev("thread.done", id="e7", thread_id="th-a", title="Alpha", state={"status": "done", "output": message("m2", "th-a", "alpha report")}),
        ev("model.message", id="m4", thread_id="main"),
        ev("model.message.delta", id="m4", thread_id="main", content="both done", finish_reason="stop"),
        ev("turn.done", id="e8", state={"status": "done", "completed_at": T0, "required_actions": [],
                                        "output": message("m4", "main", "both done"),
                                        "metrics": {"total_input_tokens": 30, "total_output_tokens": 12, "total_tokens": 42}}),
    ]


def stored_events(script):
    """What the server stores: the same turn with deltas merged, as the events endpoint returns it."""
    index, merged = EventIndex(), []
    for event in script:
        if event["type"] == "model.message":
            continue
        if event["type"] == "model.message.delta":
            done = index.add(event)
            if done:
                merged.append({k: v for k, v in done.items() if k != "usage"})
        else:
            merged.append(event)
    return merged


# --- the fake TrueForge server ---

class FakeTrueForge:
    """A TrueForge look-alike: sessions, turns as SSE, stored events, one settings endpoint."""

    def __init__(self):
        self.script = two_thread_turn()
        self.turn_status = "done"
        self.requests = []
        self.manifests = []
        self.on_turn = None  # optional callable(body) -> script, for the eval test
        self.page_size = 5

    def start(self):
        fake = self
        events_page_size = self.page_size

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def send_json(self, payload, status=200):
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def send_sse(self, script):
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.send_header("cache-control", "no-cache")
                self.end_headers()
                for number, event in enumerate(script, 1):
                    self.wfile.write(f"id: {number}\nevent: message\ndata: {json.dumps(event)}\n\n".encode())
                    self.wfile.flush()

            def body(self):
                length = int(self.headers.get("content-length") or 0)
                return json.loads(self.rfile.read(length) or b"{}")

            def do_POST(self):
                url = urlparse(self.path)
                body = self.body()
                fake.requests.append(("POST", url.path, body))
                if url.path == "/api/v1/sessions":
                    return self.send_json({"data": {"id": f"sess-{len(fake.requests)}", "agent": body.get("agent", {})}})
                if url.path.endswith("/turns"):
                    script = fake.on_turn(body) if fake.on_turn else fake.script
                    return self.send_sse(script)
                self.send_json({"error": "no route"}, 404)

            def do_PUT(self):
                url = urlparse(self.path)
                body = self.body()
                fake.requests.append(("PUT", url.path, body))
                if url.path == "/api/v1/settings/mcp-servers":
                    fake.manifests.append(body["manifest"])
                    return self.send_json({"data": {"name": body["manifest"]["name"], "manifest": body["manifest"]}})
                self.send_json({"error": "no route"}, 404)

            def do_GET(self):
                url = urlparse(self.path)
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                fake.requests.append(("GET", url.path, query))
                parts = url.path.strip("/").split("/")
                if url.path == "/api/v1/sessions":
                    return self.send_json({"data": [{"id": "sess-1", "created_at": "2026-01-01T00:00:00Z", "agent": {"type": "inline"}, "title": "one"}],
                                           "pagination": {"limit": 25}})
                if parts[-1] == "turns":
                    return self.send_json({"data": [{"id": "turn-1", "session_id": parts[3], "created_at": T0, "state": {"status": fake.turn_status}}],
                                           "pagination": {"limit": 25}})
                if parts[-1] == "events":
                    events = stored_events(fake.script)
                    start = int(query.get("page_token") or 0)
                    page = events[start:start + events_page_size]
                    next_token = str(start + events_page_size) if start + events_page_size < len(events) else None
                    return self.send_json({"data": page, "pagination": {"limit": events_page_size, "next_page_token": next_token}})
                if parts[-1] == "subscribe":
                    return self.send_sse(fake.script[int(query.get("after_sequence_number") or 0):])
                if len(parts) == 6 and parts[4] == "turns":
                    return self.send_json({"data": {"id": parts[5], "session_id": parts[3], "created_at": T0, "state": {"status": fake.turn_status}}})
                self.send_json({"error": "no route"}, 404)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fake():
    server = FakeTrueForge().start()
    yield server
    server.stop()


# --- tests ---

def test_event_index_merges_content_and_tool_call_fragments():
    index = EventIndex()
    completed = [index.add(e) for e in two_thread_turn() if e["type"].startswith("model.message")]
    merged = [m for m in completed if m]
    first = merged[0]
    assert [c["function"]["name"] for c in first["tool_calls"]] == ["create_sub_agent", "create_sub_agent"]
    assert json.loads(first["tool_calls"][0]["function"]["arguments"]) == {"name": "Alpha", "input": "look at alpha"}
    assert first["usage"]["input_tokens"] == 10
    texts = {m["thread_id"]: m["content"] for m in merged[1:]}
    assert texts == {"th-b": "beta report", "th-a": "alpha report", "main": "both done"}


def test_thread_printer_indents_subagent_threads_and_labels_them_in_order():
    out = io.StringIO()
    printer = ThreadPrinter(out)
    for event in two_thread_turn():
        printer.handle(event)
    lines = out.getvalue().splitlines()
    assert lines[0] == "turn turn-1 started"
    assert lines[1] == "main called create_sub_agent(Alpha)" and lines[2] == "main called create_sub_agent(Beta)"
    assert lines[3] == "main spawned t1 Alpha: look at alpha" and lines[4] == "main spawned t2 Beta: look at beta"
    assert "    t2   said: beta report" in lines and "    t1   said: alpha report" in lines
    assert "main tool -> t2 returned" in lines and "main tool -> t1 returned" in lines
    assert "    t2   done (done): beta report" in lines
    assert lines[-2] == "main said: both done"
    assert lines[-1] == "turn done: done (input_tokens=30, output_tokens=12, tokens=42)"
    assert all(line.startswith("    t") for line in lines if line.strip()[:2] in ("t1", "t2"))  # every subagent line is indented
    assert printer.final_text == "both done" and printer.metrics["total_tokens"] == 42


def test_run_threads_streams_from_the_fake_server(fake):
    client = connect(fake.url, timeout=10)
    out = io.StringIO()
    session_id, text, metrics = run_threads(client, "compare in parallel", out=out)
    assert session_id == "sess-1" and text == "both done" and metrics["total_tokens"] == 42
    created = next(body for method, path, body in fake.requests if path == "/api/v1/sessions")
    assert created["agent"]["spec"]["config"]["dynamic_sub_agents"]["enabled"] is True
    assert created["agent"]["spec"]["model"]["name"].startswith("openai/")
    turn = next(body for method, path, body in fake.requests if path.endswith("/turns") and method == "POST")
    assert turn["input"] == [{"type": "user.message", "content": "compare in parallel"}] and turn["stream"] is True
    assert "    t1   said: alpha report" in out.getvalue().splitlines()


def test_replay_prints_a_finished_turn_from_its_stored_events(fake):
    client = connect(fake.url, timeout=10)
    events = sessions.list_events(client, "sess-1", "turn-1")
    assert len(events) == len(stored_events(fake.script)) > fake.page_size  # followed next_page_token
    assert [e["type"] for e in events][:3] == ["turn.created", "model.message", "thread.created"]
    out = io.StringIO()
    printer = sessions.replay(events, out)
    live = io.StringIO()
    live_printer = ThreadPrinter(live)
    for event in fake.script:
        live_printer.handle(event)
    assert out.getvalue() == live.getvalue()  # the stored log replays exactly what the stream showed
    assert printer.metrics["total_tokens"] == 42


def test_reconnect_subscribes_while_running_and_replays_when_done(fake):
    client = connect(fake.url, timeout=10)
    fake.turn_status = "running"
    out = io.StringIO()
    printer = sessions.reconnect(client, "sess-1", "turn-1", after_sequence_number=3, out=out)
    subscribe = next(q for method, path, q in fake.requests if path.endswith("/subscribe"))
    assert subscribe["after_sequence_number"] == "3"
    assert out.getvalue().startswith("turn turn-1 is still running; subscribing\n") and printer.final_text == "both done"
    fake.turn_status = "done"
    out = io.StringIO()
    sessions.reconnect(client, "sess-1", "turn-1", out=out)
    assert "replaying its stored events" in out.getvalue().splitlines()[0]
    assert any(path.endswith("/events") for _, path, _ in fake.requests)
    turns = sessions.list_turns(client, "sess-1")
    assert [t.id for t in turns] == ["turn-1"] and sessions.list_sessions(client)[0].id == "sess-1"


def test_tools_server_annotations_and_project_root():
    pytest.importorskip("mcp")
    workspace = Path(__import__("tempfile").mkdtemp())
    with ToolsServer(workspace, port=free_port()) as tools:
        async def probe():
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            async with streamablehttp_client(tools.url) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = {t.name: t.annotations for t in (await session.list_tools()).tools}
                    outside = await session.call_tool("write_file", {"path": "../escape.txt", "content": "x"})
                    inside = await session.call_tool("write_file", {"path": "a/b.txt", "content": "ok"})
                    return listed, outside.content[0].text, inside.content[0].text

        listed, outside, inside = asyncio.run(probe())
    assert {n for n, a in listed.items() if a.readOnlyHint} == {"read_file", "list_dir"}
    assert {n for n, a in listed.items() if a.destructiveHint} == {"write_file", "str_replace", "bash"}
    assert outside.startswith("Error:") and "outside the project root" in outside
    assert inside == "Wrote a/b.txt" and (workspace / "a" / "b.txt").read_text() == "ok"
    shutil.rmtree(workspace, ignore_errors=True)


def test_load_suite_and_the_two_checkers(tmp_path):
    tasks = evaluate.load_suite(HERE / "evals")
    assert [(t.name, t.checker) for t in tasks] == [("find_function", "expect.txt"), ("fix_test", "check.py"), ("write_hello", "check.py")]
    found = next(t for t in tasks if t.name == "find_function")
    assert evaluate.run_expect(found, "it is in app/settings.py") == (True, "expected 'settings.py' found in the answer")
    assert evaluate.run_expect(found, "no idea")[0] is False
    hello = next(t for t in tasks if t.name == "write_hello")
    (tmp_path / "hello.txt").write_text("hello\n" * 5)
    passed, detail = evaluate.run_check_py(hello, tmp_path)
    assert passed and detail.startswith("check.py exited 0")


def test_eval_runner_uses_the_real_tools_server_through_the_fake_agent(fake, tmp_path):
    pytest.importorskip("mcp")
    suite = tmp_path / "suite"
    shutil.copytree(HERE / "evals" / "write_hello", suite / "write_hello")
    shutil.copytree(HERE / "evals" / "find_function", suite / "find_function")

    def fake_agent(body):
        """What the model would do: call write_file on the registered MCP server, then answer."""
        prompt = body["input"][0]["content"]
        url = fake.manifests[-1]["url"]
        if "hello.txt" in prompt:
            async def act():
                from mcp import ClientSession
                from mcp.client.streamable_http import streamablehttp_client

                async with streamablehttp_client(url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        return (await session.call_tool("write_file", {"path": "hello.txt", "content": "hello\n" * 5})).content[0].text
            result, answer = asyncio.run(act()), "done"
        else:
            result, answer = "app/settings.py", "app/settings.py"
        return [
            ev("turn.created", id="e1", turn_id="turn-x", state={"status": "running"}),
            ev("model.message", id="m1", thread_id="main", finish_reason="tool_calls",
               tool_calls=[{"id": "c1", "type": "function", "function": {"name": "write_file", "arguments": "{}"}}]),
            ev("tool.response", id="e2", thread_id="main", tool_call_id="c1", content=result),
            message("m2", "main", answer),
            ev("turn.done", id="e3", state={"status": "done", "completed_at": T0, "required_actions": [],
                                            "output": message("m2", "main", answer),
                                            "metrics": {"total_input_tokens": 100, "total_output_tokens": 7, "total_tokens": 107}}),
        ]

    fake.on_turn = fake_agent
    client = connect(fake.url, timeout=30)
    out = io.StringIO()
    report = evaluate.run_suite(client, suite, free_port(), out=out)
    assert report["passed"] == 2 and report["runs"] == 2 and report["pass_rate"] == 1.0
    assert report["metrics"] == {"total_input_tokens": 200, "total_output_tokens": 14, "total_tokens": 214}
    by_name = {t["task"]: t for t in report["tasks"]}
    assert by_name["write_hello"]["detail"].endswith("hello.txt has five lines of hello") and by_name["write_hello"]["answer"] == "done"
    assert by_name["find_function"]["passed"] and by_name["find_function"]["metrics"]["total_tokens"] == 107
    assert fake.manifests[0]["name"] == "s50-tools" and fake.manifests[0]["type"] == "remote" and fake.manifests[0]["url"].endswith("/mcp")
    spec = next(b for m, p, b in fake.requests if p == "/api/v1/sessions")["agent"]["spec"]
    assert spec["mcp_servers"] == [{"name": "s50-tools", "preload": True, "require_approval_for_tools": []}]
    assert json.loads((suite / "eval_report.json").read_text())["pass_rate"] == 1.0
    assert "pass rate 100%" in out.getvalue() and "report: eval_report.json" in out.getvalue()


def test_eval_spec_and_summary_shapes():
    spec = build_spec().spec
    assert spec.config.dynamic_sub_agents.enabled is True and spec.mcp_servers is None
    eval_spec = evaluate.build_spec().spec
    assert eval_spec.mcp_servers[0].require_approval_for_tools == [] and eval_spec.config.iteration_limit == 40
    results = [evaluate.Result("a", True, "", "x", 1.5, {"total_tokens": 3}), evaluate.Result("b", False, "run failed", "", 0.5, {})]
    assert evaluate.summarise(results) == {"runs": 2, "passed": 1, "pass_rate": 0.5, "seconds": 2.0, "metrics": {"total_tokens": 3}}
    assert evaluate.summarise([])["pass_rate"] == 0.0


def test_demo_threads_mode_prints_the_session(fake, capsys):
    assert demo.main(["--threads", "compare", "--base-url", fake.url]) == 0
    captured = capsys.readouterr().out
    assert "session sess-1" in captured and "final answer (9 chars): both done" in captured
    assert demo.main(["--replay", "sess-1", "--base-url", fake.url]) == 0
    assert "replaying its stored events" in capsys.readouterr().out
