"""Step 48 - Demo: one sandboxed turn against the local TrueForge server.

    python demo.py                              # write and run hello.py, download it
    python demo.py "prompt" --download out.txt  # another prompt, another file
    python demo.py --skill                      # attach s48-explain-code (run register_skill.py first)
    python demo.py --keep                       # keep the session and its sandbox
"""

import argparse
from pathlib import Path

from trueforge_sdk.core.api_error import ApiError

from client.sandbox import connect, download_file, list_events, open_session, run_turn, sandbox_root
from client.skills import SKILL_NAME

PROMPT = "create hello.py that prints hello, run it, and report the python version"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("prompt", nargs="?", default=PROMPT)
    parser.add_argument("--download", default="hello.py", help="file to fetch from the sandbox afterwards")
    parser.add_argument("--skill", action="store_true", help=f"attach the {SKILL_NAME} skill")
    parser.add_argument("--keep", action="store_true", help="do not delete the session at the end")
    args = parser.parse_args()

    client = connect()
    session_id = open_session(client, skills=[SKILL_NAME] if args.skill else ())
    print(f"session {session_id}" + (f"  skills=[{SKILL_NAME}]" if args.skill else ""))
    print(f"> {args.prompt}")

    result = run_turn(client, session_id, args.prompt)
    print()
    print(result["text"] or "(no final message)")

    events = list_events(client, session_id, result["turn_id"])
    print(f"\nstored events: {' '.join(e.type for e in events)}")
    if args.skill:
        print(f"skill index in the prompt: {result['skills_tokens']} tokens")

    root = sandbox_root(result["sandbox_id"])
    if root and args.download:
        dest = Path("downloads") / Path(args.download).name
        try:
            download_file(client, session_id, result["turn_id"], f"{root}/{args.download}", dest)
            print(f"downloaded {args.download} -> {dest} ({dest.stat().st_size} bytes)")
            print(dest.read_text(encoding="utf-8").rstrip())
        except ApiError as error:  # the file was never written, or the sandbox is gone
            message = getattr(getattr(error.body, "error", None), "message", error.body)
            print(f"download failed ({error.status_code}): {message}")

    if not args.keep:
        client.sessions.delete(session_id=session_id)
        print("session deleted")


if __name__ == "__main__":
    main()
