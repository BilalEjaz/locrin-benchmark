#!/usr/bin/env python3
"""Run a validated browser-QA YAML flow through one pinned cdp.py JSONL session.

Examples:
  py scripts/flow-runner.py --meta --flow examples/saucedemo.yaml
  $env:TGT_ID='<page-target-id>'
  '{"password":"..."}' | py scripts/flow-runner.py --flow examples/saucedemo.yaml `
      --out runs/manual --vars-json -

Complete JSON events are written to runs/<id>/run-log.jsonl. Stdout defaults to the
same event stream; use --stdout summary for token-safe agent runs. Secrets are never
placed in argv or artifacts. Exit 0=PASS, 1=FAIL/UNVERIFIED, 2=setup/input error.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import urlsplit

import yaml
from jsonschema import Draft202012Validator

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass


ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "flow.schema.json"
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
# fill is immediately verified by reading its value back. The actions below can
# change application state but have no trustworthy implicit success signal.
MUTATING_ACTIONS = {"click", "select", "press", "eval"}
MAX_EVENT_TEXT = 2_000
SESSION_PROTOCOL = "teibto-cdp-jsonl"
MIN_SESSION_VERSION = 3
INPUT_SETTLE_POLICY = "none"
DIALOG_POLICIES = ("safe", "accept", "dismiss")
STDOUT_MODES = ("events", "summary")
SUMMARY_EVENT_TYPES = {"fatal", "run_done"}
ALLOWED_SCHEMES = ("http", "https")
RISK_LEVELS = ("read", "write", "destructive")
DEFAULT_RISK = "read"


class RunnerError(RuntimeError):
    def __init__(self, code: str, message: str, *, detail: Any = None):
        super().__init__(message)
        self.code = code
        self.detail = detail


def load_flow(path: Path) -> dict[str, Any]:
    try:
        flow = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise RunnerError("INVALID_FLOW", f"อ่าน flow ไม่ได้: {exc}") from exc
    if not isinstance(flow, dict):
        raise RunnerError("INVALID_FLOW", "flow ต้องเป็น YAML object")
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema).iter_errors(flow), key=lambda e: list(e.path))
    if errors:
        lines = []
        for error in errors[:20]:
            location = ".".join(str(part) for part in error.absolute_path) or "<root>"
            lines.append(f"{location}: {error.message}")
        raise RunnerError("INVALID_FLOW", "flow ไม่ผ่าน schema: " + "; ".join(lines))
    names = [item["name"] for item in flow.get("vars", [])]
    if len(names) != len(set(names)):
        raise RunnerError("INVALID_FLOW", "ชื่อตัวแปรใน vars ต้องไม่ซ้ำกัน")
    scenario_ids = [item["id"] for item in flow["scenarios"]]
    if len(scenario_ids) != len(set(scenario_ids)):
        raise RunnerError("INVALID_FLOW", "scenario id ต้องไม่ซ้ำกัน")
    return flow


def secret_names(flow: dict[str, Any]) -> set[str]:
    return {item["name"] for item in flow.get("vars", []) if item.get("secret")}


def resolve_vars(flow: dict[str, Any], supplied: dict[str, Any]) -> dict[str, Any]:
    declared = {item["name"]: item for item in flow.get("vars", [])}
    unknown = sorted(set(supplied) - set(declared))
    if unknown:
        raise RunnerError("UNKNOWN_VAR", "ตัวแปรไม่ได้ประกาศใน flow: " + ", ".join(unknown))
    complex_values = sorted(name for name, value in supplied.items()
                            if not isinstance(value, (str, int, float, bool, type(None))))
    if complex_values:
        raise RunnerError("INVALID_VARS", "ค่าตัวแปรต้องเป็น scalar: " + ", ".join(complex_values))
    values = {name: item.get("default", "") for name, item in declared.items()}
    values.update(supplied)
    return values


def substitute(value: Any, variables: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in variables:
            raise RunnerError("MISSING_VAR", f"ไม่มีค่าตัวแปร {name}")
        return str(variables[name])

    rendered = PLACEHOLDER.sub(replace, value)
    unresolved = PLACEHOLDER.findall(rendered)
    if unresolved:
        raise RunnerError("MISSING_VAR", "ยังมีตัวแปรที่แทนค่าไม่ได้: " + ", ".join(unresolved))
    return rendered


def redact(value: Any, secrets: set[str], variables: dict[str, Any], *, truncate: bool = True) -> Any:
    secret_values = [str(variables[name]) for name in secrets if variables.get(name) not in (None, "")]
    if isinstance(value, dict):
        return {key: ("***" if key in secrets else redact(item, secrets, variables, truncate=truncate))
                for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, secrets, variables, truncate=truncate) for item in value]
    if isinstance(value, str):
        for secret in secret_values:
            value = value.replace(secret, "***")
        return value[:MAX_EVENT_TEXT] if truncate else value
    return value


def origin_of(url: str) -> str | None:
    """Return `scheme://host[:port]` lowercased, or None when the URL is not http(s)."""
    parts = urlsplit(str(url).strip())
    if parts.scheme.lower() not in ALLOWED_SCHEMES or not parts.netloc:
        return None
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def origin_violation(url: str, allowed: list[str]) -> str | None:
    """Describe why `url` is outside `allowed`, or None when it is inside.

    Parsed, never prefix-matched: `https://sb1.example.com.attacker.test` starts with an
    allowed origin as a string and is a different origin as a URL. That difference is the
    whole point of the gate, so a redirect is checked the same way a declared target is.
    """
    origin = origin_of(url)
    if origin is None:
        return f"scheme is not http/https: {str(url)[:200]}"
    if origin not in allowed:
        return f"origin {origin} is not in allowed_origins ({', '.join(allowed)})"
    return None


def flow_policy(flow: dict[str, Any]) -> dict[str, Any]:
    """Summarise the declared run policy without deciding anything."""
    counts = {level: 0 for level in RISK_LEVELS}
    destructive: list[str] = []
    for scenario in flow["scenarios"]:
        for index, step in enumerate(scenario["steps"], 1):
            level = step.get("risk", DEFAULT_RISK)
            counts[level] = counts.get(level, 0) + 1
            if level == "destructive":
                destructive.append(f"{scenario['id']}#{index}")
    return {
        "allowed_origins": list(flow.get("allowed_origins") or []),
        "risk_counts": counts,
        "destructive_steps": destructive,
    }


def enforce_policy(policy: dict[str, Any], flow: dict[str, Any], variables: dict[str, Any],
                   *, allow_destructive: bool) -> list[str]:
    """Fail closed before the browser is touched; return the normalised allowed origins.

    A flow that declares nothing keeps its old behaviour, so the gate is opt-in per flow
    rather than a breaking change to every existing flow.
    """
    if policy["destructive_steps"] and not allow_destructive:
        raise RunnerError(
            "DESTRUCTIVE_NOT_ALLOWED",
            "step ที่ risk: destructive ต้องสั่ง --allow-destructive: "
            + ", ".join(policy["destructive_steps"]),
            detail={"steps": policy["destructive_steps"]},
        )
    allowed: list[str] = []
    for raw in policy["allowed_origins"]:
        origin = origin_of(raw)
        if origin is None:
            raise RunnerError("INVALID_ALLOWED_ORIGIN",
                              f"allowed_origins ต้องเป็น http(s) origin: {raw}")
        allowed.append(origin)
    if not allowed:
        return allowed
    for scenario in flow["scenarios"]:
        for index, step in enumerate(scenario["steps"], 1):
            if step["action"] != "open":
                continue
            target = str(substitute(step.get("target", ""), variables))
            problem = origin_violation(target, allowed)
            if problem:
                raise RunnerError("ORIGIN_NOT_ALLOWED", f"{scenario['id']}#{index}: {problem}",
                                  detail={"scenario": scenario["id"], "index": index,
                                          "url": target})
    return allowed


def resolve_cdp_script(explicit: str | None) -> Path:
    candidates = [
        explicit,
        os.environ.get("TEIBTO_CDP_SCRIPT"),
        ROOT.parent / "teibto-dev-standards" / "scripts" / "cdp.py",
        Path.home() / ".claude" / "skills" / "netsuite-qa-browser" / "references" / "cdp.py",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate).resolve()
    raise RunnerError(
        "CDP_SCRIPT_MISSING",
        "ไม่พบ cdp.py: ระบุ --cdp-script หรือ TEIBTO_CDP_SCRIPT",
    )


class EventSink:
    def __init__(self, output: TextIO, path: Path | None, secrets: set[str], variables: dict[str, Any],
                 *, stdout_mode: str = "events"):
        self.output = output
        self.file = path.open("w", encoding="utf-8") if path else None
        self.secrets = secrets
        self.variables = variables
        self.stdout_mode = stdout_mode

    def emit(self, payload: dict[str, Any]) -> None:
        safe = redact(payload, self.secrets, self.variables)
        line = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
        if self.stdout_mode == "events" or safe.get("type") in SUMMARY_EVENT_TYPES:
            self.output.write(line + "\n")
            self.output.flush()
        if self.file:
            self.file.write(line + "\n")
            self.file.flush()

    def close(self) -> None:
        if self.file:
            self.file.close()


class CDPSession:
    def __init__(self, script: Path, target_id: str, *, port: str | None = None,
                 request_timeout: float = 45.0, dialog: str = "safe"):
        if not target_id:
            raise RunnerError("UNPINNED_TARGET", "ต้องระบุ --target-id หรือ TGT_ID")
        self.script = script
        command = [
            sys.executable,
            str(script),
            "session",
            "--jsonl",
            f"--target-id={target_id}",
            "--idle-timeout=120",
            "--max-lifetime=1800",
            f"--input-settle={INPUT_SETTLE_POLICY}",
        ]
        env = os.environ.copy()
        if port:
            env["CDP_PORT"] = str(port)
        # Never inherit a shell DIALOG override silently: the runner owns the dialog policy.
        env["DIALOG"] = dialog
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
        self.request_timeout = request_timeout
        self.lines: queue.Queue[str | None] = queue.Queue()
        self.stderr: list[str] = []
        self.dialogs: queue.Queue[dict[str, str]] = queue.Queue()
        self.sequence = 0
        threading.Thread(target=self._read_stdout, daemon=True).start()
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()
        ready = self._next(request_timeout)
        if ready.get("type") != "ready" or not ready.get("ok"):
            error = ready.get("error") or {}
            self.close(force=True)
            message = error.get("message", "CDP session ไม่พร้อม")
            if error.get("code") == "INVALID_ARGS" and "input-settle" in message:
                raise RunnerError(
                    "DRIVER_INCOMPATIBLE",
                    f"cdp.py เก่าเกินไป: runner ต้องใช้ {SESSION_PROTOCOL} v{MIN_SESSION_VERSION}+ "
                    f"ที่รองรับ --input-settle={INPUT_SETTLE_POLICY} (driver: {script})",
                    detail=ready,
                )
            raise RunnerError(error.get("code", "CDP_NOT_READY"),
                              f"{message} (driver: {script})", detail=ready)
        version = ready.get("version")
        if (ready.get("protocol") != SESSION_PROTOCOL or not isinstance(version, int)
                or version < MIN_SESSION_VERSION
                or ready.get("input_settle") != INPUT_SETTLE_POLICY):
            self.close(force=True)
            raise RunnerError(
                "DRIVER_INCOMPATIBLE",
                f"runner ต้องใช้ {SESSION_PROTOCOL} v{MIN_SESSION_VERSION}+ "
                f"และ input_settle={INPUT_SETTLE_POLICY} (driver: {script})",
                detail=ready,
            )
        if ready.get("target_id") != target_id:
            self.close(force=True)
            raise RunnerError("TARGET_MISMATCH", f"CDP ต่อผิด target (driver: {script})", detail=ready)
        self.ready = ready

    def _read_stdout(self) -> None:
        assert self.process.stdout
        for line in self.process.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def _read_stderr(self) -> None:
        assert self.process.stderr
        for line in self.process.stderr:
            text = line.rstrip()
            if len(self.stderr) < 200:
                self.stderr.append(text)

    def _record_dialogs(self, payload: dict[str, Any]) -> None:
        """Validate protocol-v3 per-command dialogs and queue them for step attribution."""
        items = payload.get("dialogs")
        if items is None:
            return
        if not isinstance(items, list):
            raise RunnerError("INVALID_SESSION_OUTPUT", "CDP session dialogs ต้องเป็น array")
        validated: list[dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                raise RunnerError("INVALID_SESSION_OUTPUT", "CDP session dialog ต้องเป็น object")
            kind, message, answer = item.get("type"), item.get("message"), item.get("answer")
            if (not isinstance(kind, str) or not isinstance(message, str)
                    or answer not in ("accept", "dismiss")):
                raise RunnerError("INVALID_SESSION_OUTPUT", "CDP session dialog shape ไม่ถูกต้อง")
            validated.append({"kind": kind, "message": message, "answer": answer,
                              "line": f"[dialog] {kind}: {message} -> {answer}"})
        for item in validated:
            self.dialogs.put(item)

    def drain_dialogs(self) -> list[dict[str, str]]:
        """Protocol-v3 dialogs answered by commands since the previous drain."""
        items: list[dict[str, str]] = []
        while True:
            try:
                items.append(self.dialogs.get_nowait())
            except queue.Empty:
                return items

    def _next(self, timeout: float) -> dict[str, Any]:
        try:
            raw = self.lines.get(timeout=timeout)
        except queue.Empty as exc:
            raise RunnerError("SESSION_TIMEOUT", "CDP session ไม่ตอบภายในเวลาที่กำหนด") from exc
        if raw is None:
            message = "CDP session ปิดก่อนส่งผลลัพธ์"
            if self.stderr:
                message += ": " + self.stderr[-1]
            raise RunnerError("SESSION_CLOSED", message)
        try:
            payload = json.loads(raw)
        except ValueError as exc:
            raise RunnerError("INVALID_SESSION_OUTPUT", "CDP session คืนค่าที่ไม่ใช่ JSON") from exc
        if not isinstance(payload, dict):
            raise RunnerError("INVALID_SESSION_OUTPUT", "CDP session response ต้องเป็น object")
        return payload

    def command(self, command: str, args: list[Any] | None = None) -> dict[str, Any]:
        if self.process.poll() is not None:
            raise RunnerError("SESSION_CLOSED", "CDP session ปิดไปแล้ว")
        self.sequence += 1
        request_id = f"flow-{self.sequence}"
        request = {"id": request_id, "type": "command", "command": command, "args": args or []}
        assert self.process.stdin
        try:
            self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise RunnerError("SESSION_CLOSED", "ส่งคำสั่งเข้า CDP session ไม่ได้") from exc
        while True:
            payload = self._next(self.request_timeout)
            if payload.get("type") == "closed":
                raise RunnerError("SESSION_CLOSED", f"CDP session ปิด: {payload.get('reason')}", detail=payload)
            if payload.get("id") != request_id:
                raise RunnerError("CORRELATION_MISMATCH", "CDP response id ไม่ตรงกับ request", detail=payload)
            self._record_dialogs(payload)
            if not payload.get("ok"):
                error = payload.get("error") or {}
                raise RunnerError(error.get("code", "CDP_COMMAND_FAILED"),
                                  error.get("message", f"คำสั่ง {command} ล้มเหลว"), detail=payload)
            return payload

    def close(self, *, force: bool = False) -> None:
        try:
            if self.process.poll() is not None:
                return
            if not force:
                try:
                    assert self.process.stdin
                    self.process.stdin.write('{"id":"runner-close","type":"close"}\n')
                    self.process.stdin.flush()
                    self.process.wait(timeout=3)
                    return
                except Exception:
                    pass
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        finally:
            # Keep stderr complete for diagnostics. Dialog evidence itself comes from the
            # protocol-v3 result payload, so stderr timing cannot create duplicates or races.
            self._stderr_thread.join(timeout=3)


class StepTimings:
    """Runner wall time + authoritative driver timings, split by observable phase."""

    def __init__(self) -> None:
        self.started = time.perf_counter()
        self.phases: dict[str, dict[str, float | int]] = {}
        self.failing_phase: str | None = None

    def _phase(self, name: str) -> dict[str, float | int]:
        return self.phases.setdefault(name, {
            "wall_ms": 0.0, "driver_ms": 0.0, "commands": 0, "attempts": 0,
        })

    def command(self, session: CDPSession, phase: str, command: str,
                args: list[Any] | None = None) -> dict[str, Any]:
        bucket = self._phase(phase)
        started = time.perf_counter()
        try:
            result = session.command(command, args)
            self._record_driver(bucket, result)
            return result
        except RunnerError as exc:
            if isinstance(exc.detail, dict):
                self._record_driver(bucket, exc.detail)
            if self.failing_phase is None:
                self.failing_phase = phase
            raise
        finally:
            bucket["wall_ms"] = float(bucket["wall_ms"]) + (
                time.perf_counter() - started
            ) * 1000

    def sleep(self, phase: str, seconds: float) -> None:
        bucket = self._phase(phase)
        started = time.perf_counter()
        try:
            time.sleep(seconds)
        except BaseException:
            if self.failing_phase is None:
                self.failing_phase = phase
            raise
        finally:
            bucket["wall_ms"] = float(bucket["wall_ms"]) + (
                time.perf_counter() - started
            ) * 1000

    def fail(self, phase: str) -> None:
        if self.failing_phase is None:
            self.failing_phase = phase

    @staticmethod
    def _record_driver(bucket: dict[str, float | int], result: dict[str, Any]) -> None:
        if isinstance(result.get("duration_ms"), (int, float)):
            bucket["driver_ms"] = float(bucket["driver_ms"]) + float(result["duration_ms"])
            bucket["commands"] = int(bucket["commands"]) + 1
            bucket["attempts"] = int(bucket["attempts"]) + int(result.get("attempts") or 0)

    def payload(self) -> dict[str, Any]:
        phases = {
            name: {
                "wall_ms": round(float(values["wall_ms"]), 3),
                "driver_ms": round(float(values["driver_ms"]), 3),
                "commands": int(values["commands"]),
                "attempts": int(values["attempts"]),
            }
            for name, values in self.phases.items()
        }
        payload: dict[str, Any] = {
            "total_ms": round((time.perf_counter() - self.started) * 1000, 3),
            "phases": phases,
        }
        if self.failing_phase:
            payload["failing_phase"] = self.failing_phase
        return payload

    def elapsed_ms(self) -> float:
        return round((time.perf_counter() - self.started) * 1000, 3)


def js_selector(selector: str) -> str:
    return json.dumps(selector, ensure_ascii=False)


def selector_wait(selector: str) -> str:
    return ("(function(){var e=document.querySelector(%s);if(!e)return false;"
            "var r=e.getBoundingClientRect(),s=getComputedStyle(e);"
            "return r.width>0&&r.height>0&&s.visibility!=='hidden';})()") % js_selector(selector)


def perform_action(session: CDPSession, step: dict[str, Any], variables: dict[str, Any],
                   timings: StepTimings) -> dict[str, Any]:
    action = step["action"]
    target = substitute(step.get("target", ""), variables)
    value = substitute(step.get("value", ""), variables)
    context: dict[str, Any] = {}
    if step.get("wait") == "networkidle" and action != "open":
        context["document_before"] = timings.command(
            session,
            "action",
            "eval",
            ["JSON.stringify({href:location.href,timeOrigin:performance.timeOrigin})"],
        ).get("data")
    if action == "open":
        timings.command(session, "action", "nav", [target, "--until=load", "--timeout=30"])
    elif action == "fill":
        timings.command(session, "action", "fill", [target, value])
        deadline = time.monotonic() + 5
        while True:
            actual = timings.command(session, "wait", "get", ["value", target]).get("data")
            if str(actual) == str(value):
                break
            if time.monotonic() >= deadline:
                timings.fail("wait")
                raise RunnerError("FILL_NOT_APPLIED", f"ค่าใน {target} ไม่ตรงหลัง fill")
            timings.sleep("wait", min(0.05, max(0, deadline - time.monotonic())))
    elif action == "click":
        timings.command(session, "action", "click", [target])
    elif action == "select":
        timings.command(session, "action", "pick", [target, value])
    elif action == "press":
        timings.command(session, "action", "key", [target])
    elif action == "scrollintoview":
        expression = ("(function(){var e=document.querySelector(%s);if(!e)return false;"
                      "e.scrollIntoView({block:'center'});return true;})()") % js_selector(target)
        if timings.command(session, "action", "eval", [expression]).get("data") is not True:
            timings.fail("action")
            raise RunnerError("ELEMENT_MISSING", f"ไม่พบ element: {target}")
    elif action == "eval":
        timings.command(session, "action", "eval", [target])
    elif action == "wait":
        if target:
            expression = target[3:] if target.startswith("fn:") else selector_wait(target)
            timings.command(session, "wait", "wait", [expression, "20", "0.05"])
    else:  # schema should make this unreachable
        timings.fail("action")
        raise RunnerError("INVALID_ACTION", f"action ไม่รองรับ: {action}")
    return context


def perform_wait(session: CDPSession, wait: Any, variables: dict[str, Any],
                 context: dict[str, Any], timings: StepTimings) -> None:
    if wait is None:
        return
    if wait == "networkidle":
        # ชื่อนี้คงไว้เพื่อ compatibility แต่ contract คือ document navigation-ready ไม่ใช่ network idle.
        before = context.get("document_before")
        if isinstance(before, dict):
            expression = (
                "document.readyState==='complete'&&"
                "(location.href!==%s||performance.timeOrigin!==%s)"
            ) % (json.dumps(str(before.get("href", "")), ensure_ascii=False),
                 json.dumps(before.get("timeOrigin")))
        else:
            expression = "document.readyState === 'complete'"
        timings.command(session, "wait", "wait", [expression, "30", "0.05"])
    elif isinstance(wait, int):
        timings.sleep("wait", wait / 1000)
    elif isinstance(wait, str):
        rendered = substitute(wait, variables)
        expression = rendered[3:] if rendered.startswith("fn:") else selector_wait(rendered)
        timings.command(session, "wait", "wait", [expression, "20", "0.05"])


def perform_assert(session: CDPSession, assertion: dict[str, Any],
                   variables: dict[str, Any], timings: StepTimings) -> tuple[bool, str]:
    if "url_contains" in assertion:
        wanted = substitute(assertion["url_contains"], variables)
        actual = str(timings.command(session, "assert", "url").get("data") or "")
        return wanted in actual, f'URL contains "{wanted}" (actual: {actual[:300]})'
    target = substitute(assertion["target"], variables)
    wanted = substitute(assertion["contains"], variables)
    actual = str(timings.command(session, "assert", "get", ["text", target]).get("data") or "")
    return wanted in actual, f'{target} contains "{wanted}" (actual: {actual[:300]})'


def flow_meta(flow: dict[str, Any], path: Path, *, full: bool = False) -> dict[str, Any]:
    defaults = {item["name"]: item.get("default", "") for item in flow.get("vars", [])}
    first_open = next((step for scenario in flow["scenarios"] for step in scenario["steps"]
                       if step["action"] == "open"), None)
    url = substitute(first_open.get("target", ""), defaults) if first_open else ""
    meta = {
        "id": flow["story"], "title": flow["title"], "file": path.name,
        "target": flow.get("target", "web"), "url": url, "vars": flow.get("vars", []),
        "scenarios": [{"id": item["id"], "steps": len(item["steps"]),
                       "doc": item.get("doc", False)} for item in flow["scenarios"]],
        "step_count": sum(len(item["steps"]) for item in flow["scenarios"]),
    }
    if full:
        flat = []
        for scenario in flow["scenarios"]:
            for step in scenario["steps"]:
                action = step["action"]
                flat.append({"i": len(flat), "a": action.upper(),
                             "t": "assert" if step.get("assert") else action,
                             "d": step.get("intent", action), "sel": step.get("target")})
        meta["steps"] = flat
        meta["yaml"] = path.read_text(encoding="utf-8")
    return meta


def run_flow(flow: dict[str, Any], path: Path, output_dir: Path, variables: dict[str, Any],
             cdp_script: Path, target_id: str, port: str | None, sink: EventSink,
             dialog: str = "safe", allow_destructive: bool = False) -> int:
    run_started = time.perf_counter()
    output_dir.mkdir(parents=True, exist_ok=True)
    shots = output_dir / "shots"
    shots.mkdir()
    report_path = output_dir / "qa-report.md"
    report = [f"# QA Report — {flow['story']}", "", f"**Title:** {flow['title']}",
              f"**Target ID:** `{target_id}`", ""]
    assertions = sum(1 for scenario in flow["scenarios"] for step in scenario["steps"]
                     if step.get("assert"))
    passed = failures = unverified = dialogs = 0
    perf_total = sum(1 for scenario in flow["scenarios"] for step in scenario["steps"]
                     if step.get("perf_budget_ms") is not None)
    perf_evaluated = perf_passed = 0
    policy = flow_policy(flow)
    allowed_origins: list[str] = []
    origin_checks = 0
    session: CDPSession | None = None

    def flush_dialogs(scenario_id: str, index: int | None, global_index: int | None) -> None:
        # Every auto-answered dialog is a (possible) mutation: it goes into run-log and report,
        # attributed to the step during which the driver reported it.
        nonlocal dialogs
        for item in (session.drain_dialogs() if session else []):
            dialogs += 1
            sink.emit({"type": "dialog", "scenario": scenario_id, "index": index,
                       "global_index": global_index, **item})
            report.append(f"- ⚠️ dialog {item['kind']}: \"{item['message']}\" -> {item['answer']}")
    sink.emit({"type": "run_start", "story": flow["story"], "title": flow["title"],
               "driver_policy": {"protocol": SESSION_PROTOCOL,
                                 "min_version": MIN_SESSION_VERSION,
                                 "input_settle": INPUT_SETTLE_POLICY,
                                 "dialog": dialog,
                                 "dialog_evidence": "structured-per-command",
                                 "navigation": "event-bound-load"},
               "run_policy": {"allowed_origins": policy["allowed_origins"],
                              "origin_gate": "enforced" if policy["allowed_origins"] else "not-declared",
                              "risk_counts": policy["risk_counts"],
                              "destructive_allowed": allow_destructive},
               "scenarios": [{"id": item["id"], "steps": len(item["steps"])}
                             for item in flow["scenarios"]]})
    startup_started = time.perf_counter()
    startup_ms: float | None = None
    try:
        allowed_origins = enforce_policy(policy, flow, variables,
                                         allow_destructive=allow_destructive)
        session = CDPSession(cdp_script, target_id, port=port, dialog=dialog)
        startup_ms = round((time.perf_counter() - startup_started) * 1000, 3)
        sink.emit({"type": "session_ready", "target_id": target_id,
                   "cdp_script": str(session.script),
                   "protocol": session.ready.get("protocol"),
                   "version": session.ready.get("version"),
                   "input_settle": session.ready.get("input_settle"),
                   "port": session.ready.get("port"), "duration_ms": startup_ms})
        global_index = 0
        for scenario in flow["scenarios"]:
            scenario_failed = False
            sink.emit({"type": "scenario_start", "id": scenario["id"]})
            report.extend([f"## Scenario: {scenario['id']}", ""])
            for index, raw_step in enumerate(scenario["steps"], 1):
                global_index += 1
                intent = raw_step.get("intent", raw_step["action"])
                sink.emit({"type": "step", "scenario": scenario["id"], "index": index,
                           "global_index": global_index, "intent": intent, "status": "running"})
                timings = StepTimings()
                performance: dict[str, Any] | None = None
                try:
                    context = perform_action(session, raw_step, variables, timings)
                    perform_wait(session, raw_step.get("wait"), variables, context, timings)
                    # The gate runs before the assertion so an escape is reported as an escape.
                    # Asserting first on a foreign page would surface ASSERTION_FAILED and hide
                    # the fact that the run had already left its declared origins.
                    guard_ms = 0.0
                    if allowed_origins:
                        guard_started = time.perf_counter()
                        current_url = str(
                            timings.command(session, "origin", "url").get("data") or "")
                        guard_ms = (time.perf_counter() - guard_started) * 1000
                        problem = origin_violation(current_url, allowed_origins)
                        if problem:
                            timings.fail("origin")
                            raise RunnerError("ORIGIN_NOT_ALLOWED", problem,
                                              detail={"url": current_url})
                        origin_checks += 1
                    assertion = raw_step.get("assert")
                    status, detail = "done", ""
                    if assertion:
                        ok, detail = perform_assert(session, assertion, variables, timings)
                        if not ok:
                            timings.fail("assert")
                            raise RunnerError("ASSERTION_FAILED", detail)
                        passed += 1
                        status = "pass"
                    elif raw_step["action"] in MUTATING_ACTIONS:
                        unverified += 1
                        status, detail = "unverified", "state-changing step has no explicit assertion"
                    budget_ms = raw_step.get("perf_budget_ms")
                    if budget_ms is not None:
                        # The origin gate is policy, not the application's observable outcome,
                        # so a flow does not get a stricter budget for declaring its origins.
                        outcome_ms = round(timings.elapsed_ms() - guard_ms, 3)
                        perf_evaluated += 1
                        within_budget = outcome_ms <= budget_ms
                        performance = {
                            "outcome_ms": outcome_ms,
                            "budget_ms": budget_ms,
                            "verdict": "PASS" if within_budget else "FAIL",
                        }
                        if not within_budget:
                            timings.fail("perf_budget")
                            raise RunnerError(
                                "PERF_BUDGET_EXCEEDED",
                                f"observable outcome {outcome_ms:.3f}ms exceeds budget {budget_ms}ms",
                                detail=performance,
                            )
                        perf_passed += 1
                    shot = None
                    capture_success = (raw_step["capture"] if "capture" in raw_step
                                       else bool(scenario.get("doc", False)))
                    if capture_success:
                        shot_path = (shots / f"{scenario['id']}-{index:02d}.png").resolve()
                        timings.command(session, "capture", "shot", [str(shot_path)])
                        shot = str(shot_path)
                    marker = "✅" if status == "pass" else ("⚠️" if status == "unverified" else "▸")
                    report.append(f"- {marker} {intent}" + (f" — {detail}" if detail else ""))
                    if performance:
                        report.append(
                            f"  - ⏱ outcome: {performance['outcome_ms']:.3f}ms / "
                            f"budget {performance['budget_ms']}ms → {performance['verdict']}"
                        )
                    flush_dialogs(scenario["id"], index, global_index)
                    timing_payload = timings.payload()
                    sink.emit({"type": "step_done", "scenario": scenario["id"], "index": index,
                               "global_index": global_index, "intent": intent, "status": status,
                               "detail": detail, "shot": shot,
                               **({"performance": performance} if performance else {}),
                               "duration_ms": timing_payload["total_ms"],
                               "timings": timing_payload})
                except RunnerError as exc:
                    failures += 1
                    scenario_failed = True
                    shot = None
                    evidence_error = None
                    if raw_step.get("capture", True):
                        try:
                            shot_path = (shots / f"{scenario['id']}-{index:02d}-failure.png").resolve()
                            timings.command(session, "capture", "shot", [str(shot_path)])
                            shot = str(shot_path)
                        except RunnerError as capture_exc:
                            evidence_error = {"code": capture_exc.code, "message": str(capture_exc)}
                    report.append(f"- ❌ {intent} — {exc.code}: {exc}")
                    if performance:
                        report.append(
                            f"  - ⏱ outcome: {performance['outcome_ms']:.3f}ms / "
                            f"budget {performance['budget_ms']}ms → {performance['verdict']}"
                        )
                    flush_dialogs(scenario["id"], index, global_index)
                    timing_payload = timings.payload()
                    sink.emit({"type": "step_done", "scenario": scenario["id"], "index": index,
                               "global_index": global_index, "intent": intent, "status": "fail",
                               "error": {"code": exc.code, "message": str(exc)},
                               "shot": shot,
                               **({"performance": performance} if performance else {}),
                               **({"evidence_error": evidence_error} if evidence_error else {}),
                               "duration_ms": timing_payload["total_ms"],
                               "timings": timing_payload})
                    break
            if not scenario_failed:
                console_started = time.perf_counter()
                console_result: dict[str, Any] | None = None
                try:
                    console_result = session.command("console")
                    console = console_result.get("data")
                    messages = console if isinstance(console, list) else ([] if console in (None, [], "[]") else console)
                    empty = not messages
                    console_timing = {
                        "wall_ms": round((time.perf_counter() - console_started) * 1000, 3),
                        "driver_ms": console_result.get("duration_ms"),
                        "attempts": console_result.get("attempts"),
                    }
                    sink.emit({"type": "errors", "scenario": scenario["id"], "empty": empty,
                               "timing": console_timing,
                               **({"msgs": messages} if not empty else {})})
                    if not empty:
                        failures += 1
                        scenario_failed = True
                        report.append(f"- ❌ Browser console: {messages}")
                    else:
                        report.append("- ✅ Browser console collector is empty")
                except RunnerError as exc:
                    failures += 1
                    scenario_failed = True
                    report.append(f"- ❌ Console verification unavailable — {exc.code}: {exc}")
                    detail = exc.detail if isinstance(exc.detail, dict) else {}
                    sink.emit({"type": "errors", "scenario": scenario["id"], "empty": False,
                               "timing": {
                                   "wall_ms": round((time.perf_counter() - console_started) * 1000, 3),
                                   "driver_ms": detail.get("duration_ms"),
                                   "attempts": detail.get("attempts"),
                               },
                               "error": {"code": exc.code, "message": str(exc)}})
            flush_dialogs(scenario["id"], None, None)
            sink.emit({"type": "scenario_done", "id": scenario["id"],
                       "status": "fail" if scenario_failed else "done"})
            report.append("")
            if scenario_failed:
                break
    except RunnerError as exc:
        failures += 1
        sink.emit({"type": "fatal", "error": {"code": exc.code, "message": str(exc)}})
        report.append(f"## Fatal\n\n- ❌ {exc.code}: {exc}\n")
    finally:
        if session:
            session.close()

    verdict = "FAIL" if failures else ("UNVERIFIED" if unverified else "PASS")
    summary = [f"**Verdict:** {verdict}", f"**Assertions:** {passed}/{assertions} passed",
               f"**Unverified state changes:** {unverified}",
               f"**Auto-answered dialogs:** {dialogs} (policy: {dialog})", ""]
    if perf_total:
        summary.insert(3, f"**Performance budgets:** {perf_passed}/{perf_total} passed "
                          f"({perf_evaluated} evaluated)")
    if policy["allowed_origins"]:
        summary.insert(0, f"**Allowed origins:** {', '.join(policy['allowed_origins'])} "
                          f"({origin_checks} step checks passed)")
    else:
        summary.insert(0, "**Allowed origins:** none declared — origin gate not enforced")
    risky = ", ".join(f"{level}={policy['risk_counts'][level]}" for level in RISK_LEVELS)
    summary.insert(1, f"**Step risk:** {risky} "
                      f"(destructive {'allowed' if allow_destructive else 'blocked'})")
    report[4:4] = summary
    safe_report = redact("\n".join(report), sink.secrets, variables, truncate=False)
    report_path.write_text(str(safe_report), encoding="utf-8")
    sink.emit({"type": "run_done", "passed": passed, "total": assertions,
               "failures": failures, "unverified": unverified, "dialogs": dialogs,
               "performance_budgets": {"passed": perf_passed, "evaluated": perf_evaluated,
                                       "total": perf_total},
               "origin_gate": {"allowed": policy["allowed_origins"], "checks": origin_checks,
                               "enforced": bool(policy["allowed_origins"])},
               "risk_counts": policy["risk_counts"],
               "verdict": verdict,
               "duration_ms": round((time.perf_counter() - run_started) * 1000, 3),
               "startup_ms": startup_ms,
               "report": str(report_path.resolve())})
    return 0 if verdict == "PASS" else 1


def read_vars(argument: str) -> dict[str, Any]:
    raw = sys.stdin.read() if argument == "-" else argument
    if len(raw) > 1_000_000:
        raise RunnerError("VARS_TOO_LARGE", "--vars-json ต้องไม่เกิน 1,000,000 characters")
    try:
        value = json.loads(raw or "{}")
    except ValueError as exc:
        raise RunnerError("INVALID_VARS", "--vars-json ต้องเป็น JSON object") from exc
    if not isinstance(value, dict):
        raise RunnerError("INVALID_VARS", "--vars-json ต้องเป็น JSON object")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--flow", required=True)
    parser.add_argument("--out")
    parser.add_argument("--vars-json", default="{}")
    parser.add_argument("--target-id", default=os.environ.get("TGT_ID"))
    parser.add_argument("--cdp-port", default=os.environ.get("CDP_PORT"))
    parser.add_argument("--cdp-script")
    parser.add_argument("--dialog", choices=DIALOG_POLICIES, default="safe",
                        help="dialog policy handed to cdp.py (default: safe; never inherited from env)")
    parser.add_argument("--stdout", choices=STDOUT_MODES, default="events",
                        help="events (default) or terminal summary only; run-log.jsonl is always complete")
    parser.add_argument("--allow-destructive", action="store_true",
                        help="allow steps declared risk: destructive; blocked by default")
    parser.add_argument("--meta", action="store_true")
    parser.add_argument("--full", action="store_true")
    args = parser.parse_args(argv)
    sink: EventSink | None = None
    try:
        path = Path(args.flow).resolve()
        flow = load_flow(path)
        if args.meta:
            print(json.dumps(flow_meta(flow, path, full=args.full), ensure_ascii=False))
            return 0
        if not args.out:
            raise RunnerError("INVALID_ARGS", "ต้องระบุ --out เมื่อสั่ง run")
        if not args.target_id:
            raise RunnerError("UNPINNED_TARGET", "ต้องระบุ --target-id หรือ TGT_ID")
        cdp_script = resolve_cdp_script(args.cdp_script)
        supplied = read_vars(args.vars_json)
        exposed = secret_names(flow).intersection(supplied)
        if exposed and args.vars_json != "-":
            raise RunnerError("SECRET_IN_ARGV", "secret vars ต้องส่งด้วย --vars-json - ผ่าน stdin")
        variables = resolve_vars(flow, supplied)
        output_dir = Path(args.out).resolve()
        output_dir.parent.mkdir(parents=True, exist_ok=True)
        if output_dir.exists():
            raise RunnerError("OUTPUT_EXISTS", f"output directory มีอยู่แล้ว: {output_dir}")
        output_dir.mkdir(parents=True)
        log_path = output_dir / "run-log.jsonl"
        sink = EventSink(sys.stdout, log_path, secret_names(flow), variables,
                         stdout_mode=args.stdout)
        return run_flow(flow, path, output_dir, variables, cdp_script,
                        args.target_id or "", args.cdp_port, sink, dialog=args.dialog,
                        allow_destructive=args.allow_destructive)
    except RunnerError as exc:
        payload = {"type": "fatal", "error": {"code": exc.code, "message": str(exc)}}
        if sink:
            sink.emit(payload)
        else:
            print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return 2
    finally:
        if sink:
            sink.close()


if __name__ == "__main__":
    raise SystemExit(main())
