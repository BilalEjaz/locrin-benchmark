"""Step 50 - sessions, turns and stored events: the server keeps the log.

Stage 8 wrote the transcript to a JSONL file; step 44 replayed it. TrueForge
stores every session, turn and event on the server. `list_sessions`,
`list_turns` and `list_events` read that store. `replay` prints a finished
turn from its stored events through the same `ThreadPrinter` the live stream
used. `reconnect` is step 34's recovery: look the turn up, subscribe to it
if it is still running, or replay it if it has finished.
"""

from __future__ import annotations

import sys

from .common import as_dict
from .threads import ThreadPrinter


def list_sessions(client, limit: int = 10) -> list:
    """The newest sessions first, at most `limit`."""
    return list(client.sessions.list(limit=min(limit, 25)).data)[:limit]


def list_turns(client, session_id: str) -> list:
    """Every turn of a session in creation order, following the pagination tokens."""
    turns, token = [], None
    while True:
        page = client.sessions.list_turns(session_id=session_id, page_token=token)
        turns.extend(page.data)
        token = page.pagination.next_page_token
        if not token:
            break
    return sorted(turns, key=lambda turn: turn.created_at)


def list_events(client, session_id: str, turn_id: str) -> list[dict]:
    """The stored events of one turn as dicts, in insertion order, deltas already merged."""
    events, token = [], None
    while True:
        page = client.sessions.list_turn_events(session_id=session_id, turn_id=turn_id, page_token=token)
        events.extend(as_dict(event) for event in page.data)
        token = page.pagination.next_page_token
        if not token:
            break
    return events


def replay(events: list, out=None) -> ThreadPrinter:
    """Print a finished turn from its stored events. Returns the printer with the final text and metrics."""
    printer = ThreadPrinter(out or sys.stdout)
    for event in events:
        printer.handle(event)
    return printer


def reconnect(client, session_id: str, turn_id: str, after_sequence_number: int | None = None, out=None) -> ThreadPrinter:
    """Pick a turn up again: subscribe if it is still running, replay it if it has finished."""
    out = out or sys.stdout
    turn = client.sessions.get_turn(session_id=session_id, turn_id=turn_id).data
    if turn.state.status == "running":
        out.write(f"turn {turn_id} is still running; subscribing\n")
        printer = ThreadPrinter(out)
        stream = client.sessions.subscribe_to_turn(session_id=session_id, turn_id=turn_id, after_sequence_number=after_sequence_number)
        for event in stream:
            printer.handle(event)
        return printer
    out.write(f"turn {turn_id} is {turn.state.status}; replaying its stored events\n")
    return replay(list_events(client, session_id, turn_id), out)


def describe(session) -> str:
    """One line for a session listing: id, when, agent kind, title."""
    agent = getattr(session.agent, "name", None) or getattr(session.agent, "type", "inline")
    return f"{session.id}  {session.created_at[:19]}  {agent}  {session.title or ''}".rstrip()
