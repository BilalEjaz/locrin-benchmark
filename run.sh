#!/usr/bin/env bash
# Usage: ./run.sh v0.5.0 [extra bench options]
set -euo pipefail
cd "$(dirname "$0")"
[[ $# -ge 1 ]] || { echo "usage: ./run.sh <locrin version tag> [options]" >&2; exit 2; }
py=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 \
    && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
    py="$candidate"
    break
  fi
done
[[ -n "$py" ]] || { echo "run.sh: Python 3.12 or newer is required (python3 or python)" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "run.sh: git is required" >&2; exit 2; }
exec "$py" -m bench.main --version "$1" "${@:2}"
