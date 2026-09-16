"""Step 48 offline tests. A fake TrueForge server runs in a thread on a free
port and answers the four requests the client makes: create a session,
stream a turn as hand-written SSE lines, list the stored events, and serve
a sandbox file. The real SDK talks to it. Nothing contacts localhost:8790.
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

STEP = Path(__file__).resolve().parent
sys.path.insert(0, str(STEP))

from client import sandbox, skills  # noqa: E402

SANDBOX_ID = "v1:local:/tmp/sandboxes/sess-1/box-1"
FILE_BYTES = b'print("hello")\n'


def sse(payload, seq):
    """One SSE frame: an id line, a data line, a blank line."""
    return f"id: {seq}\ndata: {json.dumps(payload)}\n\n".encode()


def turn_events():
    """The events of one sandboxed turn, in the shapes of the turn events reference."""
    when = "2026-01-01T00:00:00Z"
    return [
        {"type": "turn.created", "id": "e1", "thread_id": None, "created_at": when, "turn_id": "turn-1",
         "previous_turn_id": None, "input": [{"type": "user.message", "content": "hi"}], "state": {"status": "running"}},
        {"type": "model.message", "id": "m1", "thread_id": "main", "created_at": when},
        {"type": "model.message.delta", "id": "m1", "thread_id": "main",
         "tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {"name": "exec", "arguments": ""}}]},
        {"type": "model.message.delta", "id": "m1", "thread_id": "main",
         "tool_calls": [{"index": 0, "function": {"arguments": "{\"intent\":\"write\",\"command\":\"echo hi > hello.py\"}"}}]},
        {"type": "model.message.delta", "id": "m1", "thread_id": "main", "finish_reason": "tool_calls",
         "usage": {"input_tokens": 100, "output_tokens": 5,
                   "input_tokens_breakdown": {"harness": 90, "skills": 42, "instructions": 8, "tool_definitions": 0, "messages": 2}}},
        {"type": "sandbox.created", "id": "s1", "thread_id": None, "created_at": when, "sandbox_id": SANDBOX_ID},
        {"type": "tool.response", "id": "r1", "thread_id": "main", "created_at": when, "tool_call_id": "call-1",
         "content": json.dumps({"success": True, "response": {"exitCode": 0, "result": "hi\n"}})},
        {"type": "model.message", "id": "m2", "thread_id": "main", "created_at": when},
        {"type": "model.message.delta", "id": "m2", "thread_id": "main", "content": "Done. "},
        {"type": "model.message.delta", "id": "m2", "thread_id": "main", "content": "hello.py runs.", "finish_reason": "stop",
         "usage": {"input_tokens": 120, "output_tokens": 6,
                   "input_tokens_breakdown": {"harness": 90, "skills": 42, "instructions": 8, "tool_definitions": 0, "messages": 22}}},
        {"type": "turn.done", "id": "d1", "thread_id": None, "created_at": when,
         "state": {"status": "done", "completed_at": when, "required_actions": [],
                   "output": {"type": "model.message", "id": "m2", "thread_id": "main", "created_at": when,
                              "content": "Done. hello.py runs.", "finish_reason": "stop"},
                   "metrics": {"total_input_tokens": 220, "total_output_tokens": 11, "total_tokens": 231}}},
    ]


def stored_events():
    """The same turn as the server keeps it: no deltas, each model.message already merged."""
    merged = {
        "m1": {"finish_reason": "tool_calls", "tool_calls": [
            {"id": "call-1", "type": "function", "function": {"name": "exec", "arguments": "{\"intent\":\"write\",\"command\":\"echo hi > hello.py\"}"}}]},
        "m2": {"finish_reason": "stop", "content": "Done. hello.py runs."},
    }
    events = []
    for event in turn_events():
        if event["type"] == "model.message.delta":
            continue
        events.append({**event, **merged.get(event["id"], {})})
    return events


class FakeTrueForge(BaseHTTPRequestHandler):
    """The four routes the step uses, plus the skills settings routes."""

    requests: list = []
    skills_store: dict = {}

    def log_message(self, *args):  # keep pytest output clean
        pass

    def body(self):
        length = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        payload = self.body()
        self.requests.append((self.command, self.path, payload))
        if self.path == "/api/v1/sessions":
            self.reply(201, {"data": {"id": "sess-1", "agent": {"type": "inline", "spec": payload["agent"]["spec"]},
                                      "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}})
        elif self.path == "/api/v1/sessions/sess-1/turns":
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            for seq, event in enumerate(turn_events(), 1):
                self.wfile.write(sse(event, seq))
            self.wfile.flush()
        else:
            self.reply(404, {"error": {"message": "no route"}})

    def do_PUT(self):
        payload = self.body()
        self.requests.append((self.command, self.path, payload))
        if self.path == "/api/v1/settings/skills":
            manifest = payload["manifest"]
            self.skills_store[manifest["name"]] = manifest
            self.reply(200, {"data": {"name": manifest["name"], "manifest": manifest}})
        else:
            self.reply(404, {"error": {"message": "no route"}})

    def do_GET(self):
        self.requests.append((self.command, self.path, None))
        if self.path == "/api/v1/settings/skills":
            self.reply(200, {"data": [{"name": n, "manifest": m} for n, m in self.skills_store.items()]})
        elif self.path.startswith("/api/v1/sessions/sess-1/turns/turn-1/events"):
            self.reply(200, {"data": stored_events(), "next_page_token": None})
        elif self.path.startswith("/api/v1/sessions/sess-1/turns/turn-1/download-sandbox-file"):
            if "path=%2Ftmp%2Fsandboxes%2Fsess-1%2Fbox-1%2Fhello.py" not in self.path:
                self.reply(400, {"error": {"message": f"Path must be absolute: {self.path}"}})
                return
            self.send_response(200)
            self.send_header("content-type", "application/octet-stream")
            self.send_header("content-length", str(len(FILE_BYTES)))
            self.end_headers()
            self.wfile.write(FILE_BYTES)
        else:
            self.reply(404, {"error": {"message": "no route"}})


@pytest.fixture(scope="module")
def server():
    httpd = HTTPServer(("127.0.0.1", 0), FakeTrueForge)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}"
    httpd.shutdown()


@pytest.fixture(scope="module")
def connection(server):
    return sandbox.connect(server)


@pytest.fixture
def client(connection):
    """The shared client with the fake server's memory wiped for this test."""
    FakeTrueForge.requests.clear()
    FakeTrueForge.skills_store.clear()
    return connection


# --- the spec ------------------------------------------------------------------


def test_agent_spec_turns_the_sandbox_on():
    spec = sandbox.agent_spec()
    assert spec.config.sandbox.enabled is True
    assert spec.config.sandbox.file_downloads is True
    assert spec.model.name == sandbox.MODEL
    assert spec.skills is None


def test_agent_spec_attaches_skills_by_name_without_preload(client):
    sandbox.open_session(client, skills=["s48-explain-code"])
    _, path, payload = FakeTrueForge.requests[-1]
    assert path == "/api/v1/sessions"
    spec = payload["agent"]["spec"]
    assert spec["config"]["sandbox"] == {"enabled": True, "file_downloads": True}
    assert spec["skills"] == [{"name": "s48-explain-code"}]
    assert "preload" not in spec["skills"][0]


# --- the events ----------------------------------------------------------------


def test_run_turn_prints_every_event_and_names_the_sandbox(client):
    lines = []
    result = sandbox.run_turn(client, "sess-1", "hi", out=lines.append)
    assert result["turn_id"] == "turn-1"
    assert result["sandbox_id"] == SANDBOX_ID
    assert result["status"] == "done"
    assert result["text"] == "Done. hello.py runs."
    assert result["metrics"].total_input_tokens == 220
    assert result["skills_tokens"] == 42
    assert lines == [
        "turn.created     turn-1",
        "model.message    exec  echo hi > hello.py",
        f"sandbox.created  {SANDBOX_ID}",
        "tool.response    exit 0  hi",
        "model.message    Done. hello.py runs.",
        "turn.done        done  in=220 out=11",
    ]


def test_run_turn_sends_the_user_message(client):
    sandbox.run_turn(client, "sess-1", "make a file", out=lambda _: None)
    _, path, payload = next(r for r in FakeTrueForge.requests if r[1] == "/api/v1/sessions/sess-1/turns")
    assert payload["input"] == [{"type": "user.message", "content": "make a file"}]
    assert payload["stream"] is True


def test_tool_output_reads_results_and_errors():
    assert sandbox.tool_output('{"success":true,"response":{"exitCode":0,"result":"Python 3.12.3\\n"}}') == "exit 0  Python 3.12.3"
    assert sandbox.tool_output('{"success":true,"response":{"exitCode":1,"result":""}}') == "exit 1  (no output)"
    assert sandbox.tool_output('{"error":[{"type":"text","text":"Sandbox initialization failed:\\n  git failed"}]}') == "error  Sandbox initialization failed: git failed"
    assert sandbox.tool_output("plain text") == "plain text"


def test_list_events_returns_the_stored_merged_events(client):
    events = sandbox.list_events(client, "sess-1", "turn-1")
    types = [e.type for e in events]
    assert "model.message.delta" not in types
    assert types == ["turn.created", "model.message", "sandbox.created", "tool.response", "model.message", "turn.done"]
    assert events[1].tool_calls[0].function.name == "exec"


# --- the file ------------------------------------------------------------------


def test_sandbox_root_reads_the_local_path():
    assert sandbox.sandbox_root(SANDBOX_ID) == "/tmp/sandboxes/sess-1/box-1"
    assert sandbox.sandbox_root("daytona-abc") is None
    assert sandbox.sandbox_root(None) is None


def test_download_file_writes_the_bytes_the_server_returns(client, tmp_path):
    dest = tmp_path / "out" / "hello.py"
    root = sandbox.sandbox_root(SANDBOX_ID)
    written = sandbox.download_file(client, "sess-1", "turn-1", f"{root}/hello.py", dest)
    assert written == dest
    assert dest.read_bytes() == FILE_BYTES
    _, path, _ = FakeTrueForge.requests[-1]
    assert path.startswith("/api/v1/sessions/sess-1/turns/turn-1/download-sandbox-file?path=")


# --- the skill -----------------------------------------------------------------


def test_skill_front_matter_parses():
    meta = skills.front_matter(skills.LOCAL_COPY.read_text(encoding="utf-8"))
    assert meta["name"] == "explain-code"
    assert meta["description"].startswith("How to explain a piece of code to a beginner.")
    assert "\n" not in meta["description"]
    assert skills.front_matter("# no front matter") == {}


def test_skill_manifest_points_at_the_public_repo():
    manifest = skills.skill_manifest()
    assert manifest.type == "git"
    assert manifest.name == "s48-explain-code"
    assert manifest.url == "https://github.com/dlmastery/simple-coding-harness"
    assert manifest.ref == "main"
    assert manifest.path == "step_04_skills/.agents/skills/explain-code"
    assert manifest.description == skills.front_matter(skills.LOCAL_COPY.read_text(encoding="utf-8"))["description"]


def test_register_puts_the_manifest_and_lists_it(client):
    names = skills.register(client, skills.skill_manifest())
    assert names == ["s48-explain-code"]
    method, path, payload = FakeTrueForge.requests[0]
    assert (method, path) == ("PUT", "/api/v1/settings/skills")
    assert payload["manifest"]["type"] == "git"
    assert payload["manifest"]["path"] == "step_04_skills/.agents/skills/explain-code"
