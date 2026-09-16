"""Step 50 - the TrueForge connection and the event helpers every module shares.

`connect()` builds the SDK client. `as_dict()` turns any streamed or stored
event into one plain dict so the printers and the tests handle one shape.
`EventIndex` merges `model.message.delta` fragments into their base message,
the id-keyed index from the SDK cookbook, and reports a message as complete
when a delta carries `finish_reason`.
"""

from __future__ import annotations

import json
import os

BASE_URL = os.environ.get("TRUEFORGE_BASE_URL", "http://localhost:8790")
MODEL = os.environ.get("TRUEFORGE_MODEL", "openai/gpt-4-1-mini")


def connect(base_url: str = BASE_URL, timeout: float = 600):
    """A TrueForge client. HTTPS on this machine needs the OS trust store, hence truststore."""
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    from trueforge_sdk import TrueForge

    return TrueForge(base_url=base_url, timeout=timeout)


def as_dict(event) -> dict:
    """One plain dict for a streamed event, a stored event or a dict passed through."""
    if isinstance(event, dict):
        return event
    return event.model_dump(exclude_none=True, mode="json")


def text_of(content) -> str:
    """The text of a `model.message` content field: a string or a list of parts."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content if isinstance(part, dict))


def tool_calls_of(message: dict) -> list[dict]:
    """The tool calls of a merged message as `{id, name, arguments}` dicts."""
    calls = []
    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        calls.append({"id": call.get("id"), "name": function.get("name", ""), "arguments": function.get("arguments", "")})
    return calls


def short(text: str, width: int = 88) -> str:
    """One line of at most `width` characters."""
    flat = " ".join(str(text).split())
    return flat if len(flat) <= width else flat[: width - 3] + "..."


def arguments_of(call: dict) -> dict:
    """The parsed JSON arguments of a tool call, or an empty dict."""
    try:
        return json.loads(call.get("arguments") or "{}")
    except json.JSONDecodeError:
        return {}


class EventIndex:
    """Merges streamed deltas into their `model.message` base, keyed by event id."""

    def __init__(self):
        self.messages: dict[str, dict] = {}

    def add(self, event: dict) -> dict | None:
        """Record one event. Returns the merged message when this event completes it."""
        kind = event.get("type")
        if kind == "model.message":
            base = dict(event)
            base.setdefault("content", "")
            base["tool_calls"] = list(base.get("tool_calls") or [])
            self.messages[event["id"]] = base
            # a stored event is already merged; a live base fills in through deltas
            return base if base.get("finish_reason") else None
        if kind != "model.message.delta":
            return None
        base = self.messages.setdefault(event["id"], {"type": "model.message", "id": event["id"], "thread_id": event.get("thread_id"), "content": "", "tool_calls": []})
        if event.get("content"):
            base["content"] = text_of(base.get("content")) + event["content"]
        for fragment in event.get("tool_calls") or []:
            index = fragment.get("index", len(base["tool_calls"]))
            while len(base["tool_calls"]) <= index:
                base["tool_calls"].append({"id": None, "type": "function", "function": {"name": "", "arguments": ""}})
            call = base["tool_calls"][index]
            call["id"] = fragment.get("id") or call["id"]
            function = fragment.get("function") or {}
            call["function"]["name"] = function.get("name") or call["function"]["name"]
            call["function"]["arguments"] += function.get("arguments") or ""
        if event.get("usage"):
            base["usage"] = event["usage"]
        if event.get("finish_reason"):
            base["finish_reason"] = event["finish_reason"]
            return base
        return None
