"""Pass when pytest passes in the workspace and the test file is untouched."""

import subprocess
import sys
from pathlib import Path

expected = "assert add(2, 3) == 5"
if expected not in Path("test_calc.py").read_text(encoding="utf-8"):
    print("test_calc.py was changed")
    sys.exit(1)
completed = subprocess.run(
    [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_calc.py"],
    capture_output=True, text=True,
)
print(completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else completed.stderr.strip()[-200:])
sys.exit(completed.returncode)
