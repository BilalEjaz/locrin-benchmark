#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from runtime_paths import SCRIPT_DIRS

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SCRIPT_DIRS["monthly"] / "monthly_execution.py"
BASE = [
    sys.executable, str(SCRIPT),
    "--nav", "100000", "--cash", "34000",
    "--spym", "40000", "--qqqm", "20000", "--soxx", "6000",
    "--contribution", "0", "--tiers-executed", "none", "--open-orders-status", "clear",
    "--today", "2026-08-02",
]

def run(dd: str, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(BASE + ["--dd", dd, *extra], capture_output=True, text=True)

def main() -> None:
    percent_mistake = run("1.68")
    assert percent_mistake.returncode != 0
    assert "--dd 必须使用小数" in percent_mistake.stderr
    assert "0.0168" in percent_mistake.stderr

    valid_decimal = run("0.0168", "--dd-as-of", "2026-08-01")
    assert valid_decimal.returncode == 0, valid_decimal.stderr + valid_decimal.stdout
    assert "SPYM DD = 1.68%" in valid_decimal.stdout
    assert "T1" in valid_decimal.stdout and "未达档" in valid_decimal.stdout

    for invalid in ("-0.01", "1", "nan", "inf"):
        result = run(invalid)
        assert result.returncode != 0, invalid
        assert "范围为 [0, 1)" in result.stderr, invalid

    # a drawdown with no as-of date cannot be checked for freshness, so it must
    # not evaluate tiers — the close could be from any date
    undated = run("0.0168")
    assert "没有 --dd-as-of" in undated.stderr, undated.stderr
    assert "回撤序列不可得" in undated.stdout, undated.stdout

    # and a close older than the freshness window is refused the same way
    stale = run("0.0168", "--dd-as-of", "2026-07-01")
    assert "本月不评估分档" in stale.stderr, stale.stderr

    print("Monthly drawdown CLI unit-guard tests passed.")

if __name__ == "__main__":
    main()
