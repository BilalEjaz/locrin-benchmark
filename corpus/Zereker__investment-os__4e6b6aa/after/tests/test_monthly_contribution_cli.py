#!/usr/bin/env python3
"""Regression tests for the monthly contribution F data gate."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from runtime_paths import SCRIPT_DIRS

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SCRIPT_DIRS["monthly"] / "monthly_execution.py"
BASE_ARGS = [
    sys.executable,
    str(SCRIPT),
    "--nav", "100000",
    "--cash", "15000",
    "--spym", "51000",
    "--qqqm", "28000",
    "--soxx", "6000",
    "--dd", "0", "--dd-as-of", "2026-08-28",
    "--tiers-executed", "none", "--open-orders-status", "clear",
]


def run(*extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [*BASE_ARGS, *extra],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def main() -> None:
    missing = run()
    if missing.returncode == 0:
        raise AssertionError("omitted --contribution must fail closed")
    if "D = DATA INCOMPLETE" not in missing.stdout:
        raise AssertionError("missing contribution must mark Routine DCA DATA INCOMPLETE")
    if "本月实际入金 F 未知" not in missing.stdout:
        raise AssertionError("missing contribution must identify F as the blocking input")
    if "DATA INCOMPLETE / HOLD" not in missing.stdout:
        raise AssertionError("missing contribution must block the monthly conclusion")
    if "Routine DCA   D = min(F=" in missing.stdout:
        raise AssertionError("unknown F must not display a computed Routine DCA amount")

    explicit_zero = run("--contribution", "0")
    if explicit_zero.returncode != 0:
        raise AssertionError(
            "explicit --contribution 0 must represent a confirmed no-deposit month: "
            + explicit_zero.stderr
        )
    if "本月实际入金 F 未知" in explicit_zero.stdout or "D = DATA INCOMPLETE" in explicit_zero.stdout:
        raise AssertionError("explicit zero must not be treated as missing contribution data")
    if "Routine DCA   D = min(F=0" not in explicit_zero.stdout:
        raise AssertionError("explicit zero must be shown as the authoritative F input")

    negative = run("--contribution", "-1")
    if negative.returncode == 0 or "contribution 不能为负" not in negative.stderr:
        raise AssertionError("negative contribution must remain invalid")

    print("Monthly contribution CLI regression tests passed.")


if __name__ == "__main__":
    main()
