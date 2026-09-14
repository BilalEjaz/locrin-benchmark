"""Command line frontend.

Output is deliberately compact: one line per task, no file paths unless asked.
The common caller is an agent paying for every token it reads.
"""

from __future__ import annotations

import argparse
import json
import sys

from .errors import TaskStoreError
from .model import PRIORITY_RANK
from .store import TaskStore


def _print_tasks(tasks, verbose=False):
    if not tasks:
        print("no matching tasks")
        return
    width = max((len(t.group) for t in tasks), default=0)
    for task in tasks:
        mark = "x" if task.done else " "
        due = task.due or "—"
        group = f"{task.group:<{width}}  " if width else ""
        line = f"{task.id}  [{mark}]  {group}{due:>10}  {task.title}"
        if verbose:
            line += f"   ({task.path}:{task.lineno})"
        print(line)
    print(f"\n{len(tasks)} task{'s' if len(tasks) != 1 else ''}")


def cmd_list(args, store):
    tasks = store.tasks(group=args.group, status=args.status, due_before=args.due_before)
    if args.json:
        print(json.dumps([t.as_dict() for t in tasks], ensure_ascii=False, indent=2))
    else:
        _print_tasks(tasks, args.verbose)


def cmd_add(args, store):
    task = store.add(
        args.description,
        group=args.group,
        section=args.section,
        due=args.due,
        priority=args.priority,
    )
    print(f"{task.id}  added  {task.title}")


def cmd_done(args, store):
    for ident in args.ids:
        task = store.complete(ident)
        print(f"{task.id}  done  {task.title}")


def cmd_move(args, store):
    task = store.move(args.id, group=args.group, section=args.section)
    print(f"{task.id}  moved to {args.group}/{args.section}  {task.title}")


def cmd_rm(args, store):
    for ident in args.ids:
        task = store.remove(ident)
        print(f"{task.id}  removed  {task.title}  ({task.path})")


def cmd_show(args, store):
    print(json.dumps(store.get(args.id).as_dict(), ensure_ascii=False, indent=2))


def cmd_fmt(args, store):
    changed = store.normalise_all()
    print("\n".join(str(p) for p in changed) if changed else "already tidy")


def build_parser():
    parser = argparse.ArgumentParser(prog="ots", description="Tasks in an Obsidian vault")
    parser.add_argument("--vault", help="vault root (default: discovered from .tasks.toml)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="list tasks")
    p.add_argument("--group")
    p.add_argument("--status", choices=("open", "done", "all"), default="open")
    p.add_argument("--due-before", metavar="YYYY-MM-DD")
    p.add_argument("--json", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("add", help="add a task")
    p.add_argument("description")
    p.add_argument("--group")
    p.add_argument("--section")
    p.add_argument("--due", metavar="YYYY-MM-DD")
    p.add_argument("--priority", choices=sorted(PRIORITY_RANK))
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("done", help="complete tasks")
    p.add_argument("ids", nargs="+")
    p.set_defaults(fn=cmd_done)

    p = sub.add_parser("move", help="move a task into a group")
    p.add_argument("id")
    p.add_argument("--group", required=True)
    p.add_argument("--section", default="Now")
    p.set_defaults(fn=cmd_move)

    p = sub.add_parser("rm", help="delete tasks")
    p.add_argument("ids", nargs="+")
    p.set_defaults(fn=cmd_rm)

    p = sub.add_parser("show", help="one task as json")
    p.add_argument("id")
    p.set_defaults(fn=cmd_show)

    p = sub.add_parser("fmt", help="normalise whitespace across the vault")
    p.set_defaults(fn=cmd_fmt)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.fn(args, TaskStore.open(args.vault))
    except TaskStoreError as exc:
        print(f"ots: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
