"""Step 50 - parallel subagents as threads in one turn stream.

TrueForge runs subagents inside the server (`config.dynamic_sub_agents`) and
streams their events in the same turn, each stamped with a `thread_id`.
`ThreadPrinter` prints one line per event, indented by thread and labelled
`t1`, `t2`, ... in order of creation, so a parallel run reads like the job
list of step 29. `run_threads` opens a session with subagents on, streams one
turn through the printer and returns the final text and the turn metrics.
"""

from __future__ import annotations

import sys

from trueforge_sdk import AgentSpec, DynamicSubAgentsConfig, Model, RuntimeConfig, SessionAgentSpecBody, UserMessage

from .common import MODEL, EventIndex, arguments_of, as_dict, short, text_of, tool_calls_of

INSTRUCTIONS = (
    "You are a concise assistant. When the user asks for work in parallel, delegate each part "
    "to its own subagent with the create_sub_agent tool, then combine the results in a short summary."
)


def build_spec(instructions: str = INSTRUCTIONS, model: str = MODEL, mcp_servers=None) -> SessionAgentSpecBody:
    """An inline agent with dynamic subagents switched on (they are on by default; this says so)."""
    spec = AgentSpec(
        model=Model(name=model),
        instructions=instructions,
        config=RuntimeConfig(dynamic_sub_agents=DynamicSubAgentsConfig(enabled=True)),
    )
    if mcp_servers:
        spec.mcp_servers = list(mcp_servers)
    return SessionAgentSpecBody(spec=spec)


class ThreadPrinter:
    """Prints a turn stream one line per event, indented and labelled by thread."""

    def __init__(self, out=None):
        self.out = out or sys.stdout
        self.index = EventIndex()
        self.labels = {"main": "main"}
        self.spawned: dict[str, str] = {}  # tool_call_id -> the thread it spawned
        self.final_text = ""
        self.metrics: dict = {}

    def label(self, thread_id) -> str:
        if thread_id not in self.labels:
            self.labels[thread_id] = f"t{len(self.labels)}"
        return self.labels[thread_id]

    def line(self, thread_id, text: str) -> None:
        """One output line; subagent threads are indented under the main thread."""
        if thread_id is None:
            self.out.write(f"{text}\n")
            return
        indent = "" if thread_id == "main" else "    "
        self.out.write(f"{indent}{self.label(thread_id):<4} {text}\n")

    def handle(self, event) -> None:
        event = as_dict(event)
        kind, thread_id = event.get("type"), event.get("thread_id")
        if kind == "turn.created":
            self.line(None, f"turn {event.get('turn_id')} started")
        elif kind == "thread.created":
            info = event.get("agent_info") or {}
            self.spawned[(event.get("parent") or {}).get("tool_call_id")] = thread_id
            self.line(event.get("parent", {}).get("thread_id", "main"), f"spawned {self.label(thread_id)} {event.get('title')}: {short(info.get('input', ''), 60)}")
        elif kind in ("model.message", "model.message.delta"):
            merged = self.index.add(event)
            if merged is not None:
                self.message(merged)
        elif kind == "tool.response":
            child = self.spawned.get(event.get("tool_call_id"))
            result = f"{self.label(child)} returned" if child else short(event.get("content", ""), 70)
            self.line(thread_id, f"tool -> {result}")
        elif kind == "thread.done":
            state = event.get("state") or {}
            output = text_of((state.get("output") or {}).get("content"))
            self.line(thread_id, f"done ({state.get('status')}): {short(output, 60)}")
        elif kind == "turn.done":
            state = event.get("state") or {}
            self.metrics = dict(state.get("metrics") or {})
            self.final_text = text_of((state.get("output") or {}).get("content"))
            tokens = ", ".join(f"{k.removeprefix('total_')}={v}" for k, v in self.metrics.items() if k.endswith("tokens") and v)
            self.line(None, f"turn done: {state.get('status')} ({tokens})")
        else:
            self.line(thread_id, kind)

    def message(self, merged: dict) -> None:
        """A merged model message: its text, then one line per tool call."""
        thread_id = merged.get("thread_id")
        text = text_of(merged.get("content"))
        if text:
            self.line(thread_id, f"said: {short(text)}")
        for call in tool_calls_of(merged):
            args = arguments_of(call)
            summary = args.get("name") or ", ".join(f"{k}={short(str(v), 30)!r}" for k, v in list(args.items())[:2])
            self.line(thread_id, f"called {call['name']}({summary})")


def run_threads(client, prompt: str, session_id: str | None = None, out=None, spec=None):
    """One turn with subagents on. Returns (session_id, final_text, metrics)."""
    if session_id is None:
        session_id = client.sessions.create(agent=spec or build_spec()).data.id
    printer = ThreadPrinter(out)
    stream = client.sessions.create_turn_stream(session_id=session_id, input=[UserMessage(content=prompt)])
    for event in stream:
        printer.handle(event)
    return session_id, printer.final_text, printer.metrics
