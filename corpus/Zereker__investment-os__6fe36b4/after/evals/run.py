#!/usr/bin/env python3
"""Run a synthetic Investment OS behavior scenario against independent agents.

The actor command receives one JSON object on stdin containing the complete
single- or multi-turn scenario. It must return JSON with a stable actor session
identifier and a structured transcript. The verifier command receives the actor
result plus the scenario rubric and must return a schema-checked JSON verdict.

Without an independent verifier this program can only perform an actor smoke
run. Such a run is always reported as NOT VERIFIED and exits non-zero.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - optional eval dependency
    raise SystemExit("Install PyYAML to run behavioral evals: python -m pip install pyyaml") from exc

ROOT = Path(__file__).resolve().parent
NOT_VERIFIED_EXIT = 3


def run_command(command: str, stdin: str, timeout: int, label: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            shlex.split(command),
            input=stdin,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        # TimeoutExpired is not a RuntimeError: uncaught it used to escape as a
        # raw traceback, skipping the designed failure paths and discarding the
        # partial output. Preserve the evidence, then fail through the same
        # protocol-failure route as any other adapter error.
        def as_text(value: Any) -> str:
            if isinstance(value, bytes):
                return value.decode("utf-8", "replace")
            return value or ""

        evidence = subprocess.CompletedProcess(
            exc.cmd, -1, as_text(exc.stdout),
            as_text(exc.stderr) + f"\n[{label} timed out after {timeout}s]",
        )
        persist_process_evidence(label, evidence)
        raise RuntimeError(f"{label} command timed out after {timeout}s") from exc


def git_head() -> str | None:
    """Best-effort product commit for provenance; None outside a git checkout."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
            capture_output=True, timeout=10, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() or None if result.returncode == 0 else None


def persist_process_evidence(label: str, result: subprocess.CompletedProcess[str]) -> None:
    """Preserve exact adapter I/O when a trusted local run requests evidence."""
    root = os.environ.get("EVAL_EVIDENCE_DIR")
    if not root:
        return
    destination = Path(root)
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    (destination / f"{label}.stdout.json").write_text(result.stdout, encoding="utf-8")
    (destination / f"{label}.stderr.log").write_text(result.stderr, encoding="utf-8")
    (destination / f"{label}.process.json").write_text(
        json.dumps({"returncode": result.returncode}, indent=2), encoding="utf-8"
    )


def parse_json_output(label: str, result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    if result.returncode != 0:
        raise RuntimeError(f"{label} command failed with exit code {result.returncode}: {result.stderr}")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{label} command did not return JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} command must return a JSON object")
    return value


def normalize_turns(scenario: dict[str, Any]) -> list[dict[str, str]]:
    if "turns" in scenario:
        turns = scenario["turns"]
        if not isinstance(turns, list) or len(turns) < 2:
            raise ValueError("multi-turn scenarios must contain at least two turns")
        normalized: list[dict[str, str]] = []
        for index, turn in enumerate(turns):
            if not isinstance(turn, dict) or turn.get("role") != "user" or not isinstance(turn.get("prompt"), str):
                raise ValueError(f"invalid user turn at index {index}")
            normalized.append({"role": "user", "prompt": turn["prompt"]})
        return normalized
    prompt = scenario.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("scenario must contain prompt or turns")
    return [{"role": "user", "prompt": prompt}]


# Policy vocabulary that belongs to some OTHER wealth-policy skill. The actor
# runs a real CLI, and in a managed environment that CLI is handed the account's
# skills — no flag isolates them: an empty --mcp-config removes the broker,
# --disable-slash-commands removes the plugin under test while leaving the
# injected ones. So contamination cannot be prevented here, only detected. A
# transcript reasoning from another policy's constructs is not evidence about
# this one, and this suite already refuses to let a missing verifier produce a
# pass; a foreign policy in the reasoning is the same class of defect.
FOREIGN_POLICY_MARKERS = (
    "personal-wealth-policy",
    "USER-SNAPSHOT",
    "状态胶囊",
    "剩余迁移月数",
    "三袖套",
)


def detect_foreign_policy(transcript: list[dict[str, str]]) -> list[str]:
    """Markers of another policy skill found in what the actor said."""
    said = "\n".join(
        str(item.get("content", ""))
        for item in transcript
        if isinstance(item, dict) and item.get("role") == "assistant"
    )
    return [m for m in FOREIGN_POLICY_MARKERS if m in said]


def validate_actor_result(result: dict[str, Any], expected_turns: int) -> None:
    if not isinstance(result.get("session_id"), str) or not result["session_id"].strip():
        raise ValueError("actor result must include a non-empty session_id")
    transcript = result.get("transcript")
    if not isinstance(transcript, list):
        raise ValueError("actor result transcript must be a list")
    user_turns = [item for item in transcript if isinstance(item, dict) and item.get("role") == "user"]
    assistant_turns = [item for item in transcript if isinstance(item, dict) and item.get("role") == "assistant"]
    if len(user_turns) != expected_turns or len(assistant_turns) != expected_turns:
        raise ValueError("actor transcript must contain one user and one assistant entry per scenario turn")
    for item in transcript:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"} or not isinstance(item.get("content"), str):
            raise ValueError("actor transcript entries must contain role and content")


def validate_verifier_result(result: dict[str, Any], scenario: dict[str, Any], actor_session_id: str) -> None:
    if result.get("verdict") not in {"pass", "fail"}:
        raise ValueError("verifier verdict must be pass or fail")
    independence = result.get("independence")
    if not isinstance(independence, dict):
        raise ValueError("verifier result must include independence metadata")
    if independence.get("separate_process") is not True or independence.get("separate_session") is not True:
        raise ValueError("verifier must run in a separate process and clean session")
    if independence.get("actor_session_id") != actor_session_id:
        raise ValueError("verifier independence metadata must identify the actor session")
    verifier_session_id = independence.get("verifier_session_id")
    if not isinstance(verifier_session_id, str) or not verifier_session_id.strip() or verifier_session_id == actor_session_id:
        raise ValueError("verifier_session_id must be non-empty and differ from actor_session_id")

    required = result.get("required_checks")
    forbidden = result.get("forbidden_checks")
    expected_required = scenario.get("required", [])
    expected_forbidden = scenario.get("forbidden", [])
    if not isinstance(required, list) or len(required) != len(expected_required):
        raise ValueError("verifier must judge every required behavior")
    if not isinstance(forbidden, list) or len(forbidden) != len(expected_forbidden):
        raise ValueError("verifier must judge every forbidden behavior")
    for index, item in enumerate(required):
        if not isinstance(item, dict) or item.get("behavior") != expected_required[index]:
            raise ValueError("required check order/content must match scenario rubric")
        if not isinstance(item.get("passed"), bool) or not isinstance(item.get("evidence"), str) or not item["evidence"].strip():
            raise ValueError("each required check needs boolean passed and evidence")
    for index, item in enumerate(forbidden):
        if not isinstance(item, dict) or item.get("behavior") != expected_forbidden[index]:
            raise ValueError("forbidden check order/content must match scenario rubric")
        if not isinstance(item.get("triggered"), bool) or not isinstance(item.get("evidence"), str) or not item["evidence"].strip():
            raise ValueError("each forbidden check needs boolean triggered and evidence")

    computed_pass = all(item["passed"] for item in required) and not any(item["triggered"] for item in forbidden)
    if (result["verdict"] == "pass") != computed_pass:
        raise ValueError("verifier verdict conflicts with its itemized checks")


def persist(path: Path | None, payload: dict[str, Any]) -> None:
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", help="scenario name or YAML path")
    parser.add_argument("--actor-command", required=True, help="independent actor adapter reading JSON from stdin")
    parser.add_argument("--verifier-command", help="independent verifier adapter reading JSON from stdin")
    parser.add_argument("--actor-only", action="store_true", help="debug actor without claiming verification")
    parser.add_argument("--timeout", type=int, default=3600,
                        help="per-phase timeout in seconds, applied to the actor and the verifier separately")
    parser.add_argument("--output", type=Path, help="optional synthetic result JSON path")
    args = parser.parse_args()

    if args.actor_only and args.verifier_command:
        raise SystemExit("--actor-only and --verifier-command are mutually exclusive")
    if not args.actor_only and not args.verifier_command:
        print("NOT VERIFIED: no verifier configured", file=sys.stderr)
        raise SystemExit(NOT_VERIFIED_EXIT)

    path = Path(args.scenario)
    if not path.is_file():
        path = ROOT / "scenarios" / f"{args.scenario}.yaml"
    scenario = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(scenario, dict) or scenario.get("synthetic") is not True:
        raise SystemExit("Refusing to run or persist a non-synthetic scenario")
    turns = normalize_turns(scenario)

    actor_input = {
        "protocol_version": 1,
        "scenario_name": scenario["name"],
        "skills": scenario["skills"],
        "turns": turns,
        "require_single_persistent_session": len(turns) > 1,
    }
    try:
        actor_process = run_command(args.actor_command, json.dumps(actor_input), args.timeout, "actor-adapter")
        persist_process_evidence("actor-adapter", actor_process)
        actor_result = parse_json_output("actor", actor_process)
        validate_actor_result(actor_result, len(turns))
    except (RuntimeError, ValueError) as exc:
        raise SystemExit(f"Actor protocol failure: {exc}") from exc

    # A transcript that reasoned from another wealth policy is not evidence
    # about this one. Detected after the run because the environment offers no
    # way to keep the account's skills out of the actor.
    foreign = detect_foreign_policy(actor_result.get("transcript", []))

    payload: dict[str, Any] = {
        "status": ("CONTAMINATED" if foreign
                   else "NOT VERIFIED" if args.actor_only
                   else "PENDING VERIFICATION"),
        "scenario": scenario,
        "actor": actor_result,
        "foreign_policy_markers": foreign,
        # Provenance: stored results used to carry no timestamp or product
        # commit, so a stale file left by a failed run read as fresh evidence.
        "generated": {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "product_head": git_head(),
            "phase_timeout_seconds": args.timeout,
        },
    }
    if foreign:
        persist(args.output, payload)
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print(
            f"CONTAMINATED: another wealth policy's vocabulary appears in what "
            f"the actor said — markers {foreign}. Usually that means it reasoned "
            "from the wrong policy, in which case the result says nothing about "
            "this skill; it can also be the actor correctly naming a foreign "
            "concept while refusing it, so read the transcript before drawing "
            "either conclusion. Either way this is not a pass. Remove the "
            "competing policy from the actor's account, or make it defer, and "
            "re-run.",
            file=sys.stderr,
        )
        raise SystemExit(NOT_VERIFIED_EXIT)

    if args.actor_only:
        persist(args.output, payload)
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        print("NOT VERIFIED: actor-only smoke run", file=sys.stderr)
        raise SystemExit(NOT_VERIFIED_EXIT)

    verifier_input = {
        "protocol_version": 1,
        "scenario": scenario,
        "actor": actor_result,
        "verification_requirements": {
            "independent_process": True,
            "independent_clean_session": True,
            "different_harness_preferred": True,
        },
    }
    try:
        verifier_process = run_command(args.verifier_command, json.dumps(verifier_input), args.timeout, "verifier-adapter")
        persist_process_evidence("verifier-adapter", verifier_process)
        verifier_result = parse_json_output("verifier", verifier_process)
        validate_verifier_result(verifier_result, scenario, actor_result["session_id"])
    except (RuntimeError, ValueError) as exc:
        payload["status"] = "NOT VERIFIED"
        payload["verification_error"] = str(exc)
        persist(args.output, payload)
        print(json.dumps(payload, indent=2, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(f"Verifier protocol failure: {exc}") from exc

    payload["verifier"] = verifier_result
    payload["status"] = "VERIFIED PASS" if verifier_result["verdict"] == "pass" else "VERIFIED FAIL"
    persist(args.output, payload)
    stream = sys.stdout if verifier_result["verdict"] == "pass" else sys.stderr
    print(json.dumps(payload, indent=2, ensure_ascii=False), file=stream)
    if verifier_result["verdict"] != "pass":
        raise SystemExit("Behavior verifier rejected the transcript")


if __name__ == "__main__":
    main()
