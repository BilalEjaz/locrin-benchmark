"""Step 48 - A sandboxed turn on TrueForge.

The agent spec turns the sandbox on. The server provisions it the first
time the model calls `exec`, announces it with a `sandbox.created` event,
and keeps it for the rest of the session. After `turn.done` the stored
events are listed and a file the agent produced is downloaded through
`GET .../download-sandbox-file`.
"""

from __future__ import annotations

import json
import typing
from pathlib import Path

from trueforge_sdk import (
    AgentSpec,
    Model,
    RuntimeConfig,
    SandboxConfig,
    SessionAgentSpecBody,
    Skill,
    TrueForge,
    UserMessage,
)

BASE_URL = "http://localhost:8790"
MODEL = "openai/gpt-4-1-mini"
INSTRUCTIONS = (
    "You are a coding agent with a sandbox. Write files and run commands there. "
    "Report command output verbatim."
)


def connect(base_url: str = BASE_URL) -> TrueForge:
    """A client for the server. truststore is injected first where it is installed."""
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    return TrueForge(base_url=base_url, timeout=600)


class SkillRef(Skill):
    """A skill attached by name only. Server 0.1.4 rejects the SDK's default `preload` key."""

    preload: typing.Optional[bool] = None


def agent_spec(skills: typing.Sequence[str] = ()) -> AgentSpec:
    """An inline agent with the sandbox on, file downloads allowed and the named skills attached."""
    spec = AgentSpec(
        model=Model(name=MODEL),
        instructions=INSTRUCTIONS,
        config=RuntimeConfig(sandbox=SandboxConfig(enabled=True, file_downloads=True)),
    )
    if skills:  # an explicit `skills: null` is rejected, so the key is set only when needed
        spec.skills = [SkillRef(name=name) for name in skills]
    return spec


def open_session(client: TrueForge, skills: typing.Sequence[str] = ()) -> str:
    """Create a session on the inline spec and return its id."""
    return client.sessions.create(agent=SessionAgentSpecBody(spec=agent_spec(skills))).data.id


# --- reading events -----------------------------------------------------------


def tool_output(content: str) -> str:
    """The `exec` tool's JSON result as one line: the exit code and the output, or the error text."""
    try:
        body = json.loads(content)
    except ValueError:
        return content.strip()
    if "error" in body:
        parts = body["error"] if isinstance(body["error"], list) else [body["error"]]
        text = " ".join(p.get("text", str(p)) if isinstance(p, dict) else str(p) for p in parts)
        return "error  " + " ".join(text.split())
    response = body.get("response", {})
    result = (response.get("result") or "").strip() or "(no output)"
    return f"exit {response.get('exitCode', '?')}  {result}"


def merge_delta(index: dict, delta) -> None:
    """Fold a `model.message.delta` into the base message with the same id, as the docs recommend."""
    base = index.setdefault(delta.id, {"content": "", "tool_calls": {}, "finish_reason": None})
    if delta.content:
        base["content"] += delta.content
    for call in delta.tool_calls or []:
        slot = base["tool_calls"].setdefault(call.index, {"name": "", "arguments": ""})
        if call.function and call.function.name:
            slot["name"] = call.function.name
        if call.function and call.function.arguments:
            slot["arguments"] += call.function.arguments
    if delta.finish_reason:
        base["finish_reason"] = delta.finish_reason
    breakdown = getattr(delta.usage, "input_tokens_breakdown", None)
    if breakdown is not None:  # the last delta carries the usage; `skills` is the skill index's share
        base["skills_tokens"] = getattr(breakdown, "skills", 0) or 0


def describe_message(message: dict) -> list[str]:
    """One line per tool call, then the first line of text, of a merged model message."""
    lines = []
    for call in message["tool_calls"].values():
        try:
            args = json.loads(call["arguments"])
            detail = args.get("command") or json.dumps(args)
        except ValueError:
            detail = call["arguments"]
        lines.append(f"model.message    {call['name']}  {detail}")
    if message["content"].strip():
        lines.append(f"model.message    {message['content'].strip().splitlines()[0]}")
    return lines


def describe(event, index: dict) -> list[str]:
    """The lines to print for one streamed event. Deltas print only when they complete a message."""
    kind = event.type
    if kind == "turn.created":
        return [f"turn.created     {event.turn_id}"]
    if kind == "sandbox.created":
        return [f"sandbox.created  {event.sandbox_id}"]
    if kind == "tool.response":
        return [f"tool.response    {tool_output(event.content)}"]
    if kind == "model.message.delta":
        merge_delta(index, event)
        return describe_message(index[event.id]) if event.finish_reason else []
    if kind == "turn.done":
        state = event.state
        metrics = getattr(state, "metrics", None)
        tokens = f"  in={metrics.total_input_tokens} out={metrics.total_output_tokens}" if metrics else ""
        return [f"turn.done        {state.status}{tokens}"]
    return []


# --- one turn ------------------------------------------------------------------


def run_turn(client: TrueForge, session_id: str, prompt: str, out=print) -> dict:
    """Stream one turn, print every event, and return the ids, the final text and the metrics."""
    result = {"turn_id": None, "sandbox_id": None, "text": "", "metrics": None, "status": None, "skills_tokens": 0}
    index: dict = {}
    stream = client.sessions.create_turn_stream(session_id=session_id, input=[UserMessage(content=prompt)])
    for event in stream:
        if event.type == "turn.created":
            result["turn_id"] = event.turn_id
        elif event.type == "sandbox.created":
            result["sandbox_id"] = event.sandbox_id
        elif event.type == "turn.done":
            result["status"] = event.state.status
            result["metrics"] = getattr(event.state, "metrics", None)
            output = getattr(event.state, "output", None)
            result["text"] = (output.content if output and isinstance(output.content, str) else "") or ""
        for line in describe(event, index):
            out(line)
    result["skills_tokens"] = max((m.get("skills_tokens", 0) for m in index.values()), default=0)
    return result


def list_events(client: TrueForge, session_id: str, turn_id: str) -> list:
    """Every stored event of a finished turn, deltas already merged, across all pages."""
    events, token = [], None
    while True:
        page = client.sessions.list_turn_events(session_id=session_id, turn_id=turn_id, page_token=token)
        events.extend(page.data)
        token = getattr(page, "next_page_token", None)
        if not token:
            return events


def sandbox_root(sandbox_id: str | None) -> str | None:
    """The working directory of a local sandbox, read from its id `v1:local:<path>`."""
    if sandbox_id and sandbox_id.startswith("v1:local:"):
        return sandbox_id.split(":", 2)[2]
    return None


def download_file(client: TrueForge, session_id: str, turn_id: str, path: str, dest: Path) -> Path:
    """Fetch one file from the turn's sandbox and write it to `dest`. `path` must be absolute."""
    chunks = client.sessions.download_sandbox_file(session_id=session_id, turn_id=turn_id, path=path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        for chunk in chunks:
            f.write(chunk)
    return dest
