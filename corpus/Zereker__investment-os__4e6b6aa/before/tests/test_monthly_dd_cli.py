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

def run(dd: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(BASE + ["--dd", dd], capture_output=True, text=True)

def main() -> None:
    percent_mistake = run("1.68")
    assert percent_mistake.returncode != 0
    assert "--dd 必须使用小数" in percent_mistake.stderr
    assert "0.0168" in percent_mistake.stderr

    valid_decimal = run("0.0168")
    assert valid_decimal.returncode == 0, valid_decimal.stderr + valid_decimal.stdout
    assert "SPYM DD = 1.68%" in valid_decimal.stdout
    assert "T1" in valid_decimal.stdout and "未达档" in valid_decimal.stdout

    for invalid in ("-0.01", "1", "nan", "inf"):
        result = run(invalid)
        assert result.returncode != 0, invalid
        assert "范围为 [0, 1)" in result.stderr, invalid

    print("Monthly drawdown CLI unit-guard tests passed.")

if __name__ == "__main__":
    main()
