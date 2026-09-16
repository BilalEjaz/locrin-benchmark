#!/usr/bin/env python3
"""Validate the broker-side drawdown alert pointer against current cycle state.

This script is a deterministic reliability check, not a broker connector and not
an order/alert mutation tool. It reads normalized runtime JSON from stdin and
prints the expected pointer, actual pointer and a fail-closed status. It never
writes account state to disk.

Required JSON fields:
  ath_close: positive number
  tiers_executed: ordered or unordered list containing current-cycle tier names
  alert_inventory_status: available / unavailable / stale / conflicting

When alert_inventory_status is available, `alerts` must be a list of normalized
active drawdown alerts. An empty list then means an authoritative successful read,
not an unavailable capability.

Each alert object must contain:
  symbol, field, operator, price, enabled

The tier schedule is imported from monthly_execution.py so this validator cannot
silently become a second policy source.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any

from monthly_execution import TIERS  # noqa: E402


class InputError(ValueError):
    pass


def number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{name} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise InputError(f"{name} must be finite")
    return result


def expected_pointer(ath_close: float, tiers_executed: set[str]) -> dict[str, Any] | None:
    """Return the next available tier and price, or None when ladder is exhausted."""
    for trigger, name, _ in TIERS:
        if name not in tiers_executed:
            return {
                "tier": name,
                "trigger": trigger,
                "price": round((1.0 - trigger) * ath_close, 2),
            }
    return None


def validate(payload: dict[str, Any]) -> dict[str, Any]:
    missing = sorted({"ath_close", "tiers_executed", "alert_inventory_status"} - payload.keys())
    if missing:
        raise InputError("missing fields: " + ", ".join(missing))

    ath = number(payload["ath_close"], "ath_close")
    if ath <= 0:
        raise InputError("ath_close must be positive")

    valid_tiers = {name for _, name, _ in TIERS}
    tiers_raw = payload["tiers_executed"]
    if not isinstance(tiers_raw, list) or any(t not in valid_tiers for t in tiers_raw):
        raise InputError("tiers_executed contains an unknown tier")
    tiers = set(tiers_raw)

    inventory_status = str(payload["alert_inventory_status"]).lower()
    if inventory_status not in {"available", "unavailable", "stale", "conflicting"}:
        raise InputError("alert_inventory_status is invalid")
    if inventory_status != "available":
        if payload.get("alerts") in ([], {}):
            raise InputError(
                "unavailable alert inventory must not be represented as an empty collection"
            )
        return {
            "ath_close": ath,
            "tiers_executed": tiers,
            "alert_inventory_status": inventory_status,
            "alerts": None,
        }

    if "alerts" not in payload:
        raise InputError("available alert inventory requires alerts")
    alerts_raw = payload["alerts"]
    if not isinstance(alerts_raw, list):
        raise InputError("alerts must be a list")

    alerts = []
    for index, raw in enumerate(alerts_raw):
        if not isinstance(raw, dict):
            raise InputError(f"alerts[{index}] must be an object")
        required = {"symbol", "field", "operator", "price", "enabled"}
        absent = sorted(required - raw.keys())
        if absent:
            raise InputError(f"alerts[{index}] missing fields: " + ", ".join(absent))
        alerts.append({
            "symbol": str(raw["symbol"]).upper(),
            "field": str(raw["field"]).upper(),
            "operator": str(raw["operator"]).upper(),
            "price": number(raw["price"], f"alerts[{index}].price"),
            "enabled": bool(raw["enabled"]),
            "id": str(raw.get("id", "N/A")),
        })

    return {
        "ath_close": ath,
        "tiers_executed": tiers,
        "alert_inventory_status": inventory_status,
        "alerts": alerts,
    }


def check(payload: dict[str, Any], tolerance: float = 0.011) -> dict[str, Any]:
    state = validate(payload)
    expected = expected_pointer(state["ath_close"], state["tiers_executed"])
    if state["alert_inventory_status"] != "available":
        return {
            "status": "DATA INCOMPLETE",
            "expected": expected,
            "actual": None,
            "inventory_status": state["alert_inventory_status"],
            "issues": [
                f"alert inventory is {state['alert_inventory_status']}; pointer not verified"
            ],
        }
    active = [a for a in state["alerts"] if a["enabled"]]
    issues: list[str] = []

    if expected is None:
        if active:
            issues.append("drawdown ladder is exhausted but an active alert still exists")
        return {
            "status": "PASS" if not issues else "WARN",
            "expected": None,
            "actual": active,
            "inventory_status": "available",
            "issues": issues,
        }

    if len(active) != 1:
        issues.append(f"expected exactly one active drawdown alert, found {len(active)}")
    if len(active) == 1:
        alert = active[0]
        if alert["symbol"] != "SPYM":
            issues.append("active drawdown alert symbol is not SPYM")
        if alert["field"] != "LAST":
            issues.append("active drawdown alert field is not LAST")
        if alert["operator"] not in {"LTE", "<=", "LESS_THAN_OR_EQUAL"}:
            issues.append("active drawdown alert operator is not less-than-or-equal")
        if abs(alert["price"] - expected["price"]) > tolerance:
            issues.append(
                f"alert pointer mismatch: expected {expected['tier']} at {expected['price']:.2f}, "
                f"actual price {alert['price']:.2f}"
            )

    return {
        "status": "PASS" if not issues else "WARN",
        "expected": expected,
        "actual": active,
        "inventory_status": "available",
        "issues": issues,
    }


def render(result: dict[str, Any]) -> str:
    lines = ["# Drawdown Alert Pointer Check", f"Status: **{result['status']}**"]
    expected = result["expected"]
    if expected is None:
        lines.append("Expected: no active alert; drawdown ladder exhausted.")
    else:
        lines.append(f"Expected: {expected['tier']} at {expected['price']:.2f}.")
    if result["actual"] is None:
        lines.append(f"Actual: alert inventory {result['inventory_status']}.")
    elif result["actual"]:
        for alert in result["actual"]:
            lines.append(
                f"Actual: id={alert['id']} {alert['symbol']} {alert['field']} "
                f"{alert['operator']} {alert['price']:.2f}."
            )
    else:
        lines.append("Actual: no active alert.")
    if result["issues"]:
        lines.append("Decision: drawdown deployment state is DATA INCOMPLETE; stop new drawdown candidates.")
        lines.extend(f"- {issue}" for issue in result["issues"])
    else:
        lines.append("Decision: alert pointer invariant satisfied.")
    return "\n".join(lines)


def self_test() -> None:
    base = {
        "ath_close": 100.0,
        "tiers_executed": [],
        "alert_inventory_status": "available",
        "alerts": [{
            "id": "synthetic",
            "symbol": "SPYM",
            "field": "LAST",
            "operator": "LTE",
            "price": 90.0,
            "enabled": True,
        }],
    }
    if check(base)["status"] != "PASS":
        raise AssertionError("first-tier pointer should pass")

    stale_tier = {**base, "alerts": [{**base["alerts"][0], "price": 85.0}]}
    result = check(stale_tier)
    if result["status"] != "WARN" or "expected T1" not in " ".join(result["issues"]):
        raise AssertionError("stale tier pointer was not detected")

    after_first = {**base, "tiers_executed": ["T1"], "alerts": [{**base["alerts"][0], "price": 85.0}]}
    if check(after_first)["status"] != "PASS":
        raise AssertionError("second-tier pointer should pass after first tier executes")

    duplicate = {**base, "alerts": base["alerts"] * 2}
    if check(duplicate)["status"] != "WARN":
        raise AssertionError("duplicate alerts were not detected")

    exhausted = {**base, "tiers_executed": [name for _, name, _ in TIERS], "alerts": []}
    if check(exhausted)["status"] != "PASS":
        raise AssertionError("exhausted ladder should require no alert")

    unavailable = {
        "ath_close": 100.0,
        "tiers_executed": [],
        "alert_inventory_status": "unavailable",
        "alerts": None,
    }
    if check(unavailable)["status"] != "DATA INCOMPLETE":
        raise AssertionError("unavailable alert inventory must fail closed")

    disguised = {**unavailable, "alerts": []}
    try:
        check(disguised)
    except InputError:
        pass
    else:
        raise AssertionError("unavailable alert inventory was allowed to masquerade as empty")

    print("alert pointer self-test: PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    try:
        payload = json.load(sys.stdin)
        print(render(check(payload)))
    except (InputError, json.JSONDecodeError, KeyError, ValueError) as exc:
        print("# Drawdown Alert Pointer Check")
        print("Status: **DATA INCOMPLETE**")
        print(f"Input error: {exc}")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
