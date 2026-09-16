"""Pass when hello.txt holds exactly five lines that each say hello."""

import sys
from pathlib import Path

target = Path("hello.txt")
if not target.exists():
    print("hello.txt was not created")
    sys.exit(1)
lines = target.read_text(encoding="utf-8").splitlines()
if len(lines) != 5:
    print(f"expected 5 lines, found {len(lines)}")
    sys.exit(1)
if any(line.strip() != "hello" for line in lines):
    print(f"every line must be 'hello', got {lines}")
    sys.exit(1)
print("hello.txt has five lines of hello")
