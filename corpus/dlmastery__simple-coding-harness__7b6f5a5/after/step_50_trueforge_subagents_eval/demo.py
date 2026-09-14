"""Step 50 - demo: parallel subagent threads, the session store, and the eval suite on TrueForge.

    python demo.py --threads "compare three sorting algorithms in parallel and summarise"
    python demo.py --eval [SUITE_DIR]
    python demo.py --sessions
    python demo.py --replay SESSION_ID [TURN_ID]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from client import evaluate, sessions  # noqa: E402
from client.common import BASE_URL, connect  # noqa: E402
from client.threads import run_threads  # noqa: E402

HERE = Path(__file__).resolve().parent


def parser():
    top = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    top.add_argument("--base-url", default=BASE_URL)
    mode = top.add_mutually_exclusive_group(required=True)
    mode.add_argument("--threads", metavar="PROMPT", help="one turn with dynamic subagents, printed per thread")
    mode.add_argument("--eval", nargs="?", const=str(HERE / "evals"), metavar="SUITE", help="run the eval suite through TrueForge")
    mode.add_argument("--sessions", action="store_true", help="list the newest sessions and their turns")
    mode.add_argument("--replay", nargs="+", metavar="ID", help="SESSION_ID [TURN_ID]: print a finished turn from its stored events")
    top.add_argument("--port", type=int, default=8932, help="port for the workspace tools server")
    top.add_argument("--keep", action="store_true", help="keep the eval workspaces")
    return top


def main(argv=None):
    cli = parser().parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # model text is not always cp1252
    client = connect(cli.base_url)
    if cli.threads:
        session_id, text, metrics = run_threads(client, cli.threads)
        print(f"\nsession {session_id}")
        print(f"final answer ({len(text)} chars): {text[:200]}{'...' if len(text) > 200 else ''}")
        return 0
    if cli.eval:
        report = evaluate.run_suite(client, cli.eval, cli.port, keep=cli.keep)
        return 0 if report["passed"] == report["runs"] else 1
    if cli.sessions:
        for session in sessions.list_sessions(client, 5):
            print(sessions.describe(session))
            for turn in sessions.list_turns(client, session.id):
                print(f"    turn {turn.id}  {turn.state.status}")
        return 0
    if cli.replay:
        session_id = cli.replay[0]
        turn_id = cli.replay[1] if len(cli.replay) > 1 else sessions.list_turns(client, session_id)[-1].id
        sessions.reconnect(client, session_id, turn_id)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
