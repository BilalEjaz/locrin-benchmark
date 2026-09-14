"""The task store: query and mutate a vault's tasks."""

from __future__ import annotations

import re
from datetime import date

from .config import Config
from .errors import AmbiguousTask, TaskNotFound, TaskStoreError
from .model import DATE_SIGNIFIERS, EMOJI_BY_PRIORITY, PRIORITY_RANK, Task
from .parse import parse_vault
from .serialise import insert_into_section, normalise, remove_line, replace_line

NO_DUE = "9999-99-99"


class TaskStore:
    """Query and mutate the tasks in one vault.

    Mutations are minimal edits to the line's original text wherever possible:
    completing a task appends a done date rather than re-rendering the line, so
    fields this package does not understand survive untouched.
    """

    def __init__(self, config):
        self.config = config

    @classmethod
    def open(cls, root=None):
        return cls(Config.load(root))

    # ---------------------------------------------------------------- reading

    def tasks(self, *, group=None, status="open", due_before=None, section=None):
        found = parse_vault(self.config)
        if group is not None:
            found = [t for t in found if t.group == group]
        if status == "open":
            found = [t for t in found if not t.done]
        elif status == "done":
            found = [t for t in found if t.done]
        elif status != "all":
            raise ValueError(f"unknown status filter: {status}")
        if due_before:
            found = [t for t in found if t.due and t.due < due_before]
        if section:
            found = [t for t in found if t.section == section]
        found.sort(key=lambda t: (t.due or NO_DUE, PRIORITY_RANK[t.priority], t.group, t.title))
        return found

    def get(self, ident):
        hits = [t for t in self.tasks(status="all") if t.id == ident]
        if not hits:
            raise TaskNotFound(ident)
        if len(hits) > 1:
            raise AmbiguousTask(f"{ident} matches {len(hits)} tasks")
        return hits[0]

    # ---------------------------------------------------------------- writing

    def add(self, description, *, group=None, section=None, due=None, priority=None,
            fields=None):
        """Create a task.

        Without a section it lands in the shared inbox, tagged with the group so
        the group survives in a file that is not inside a group folder.
        """
        section = section or self.config.inbox_section
        to_inbox = section == self.config.inbox_section

        body = description.strip()
        if to_inbox and group and f"#{group}" not in body:
            body = f"{body} #{group}"
        if priority and priority != "normal":
            body = f"{body} {EMOJI_BY_PRIORITY[priority]}"
        for name, value in (fields or {}).items():
            body = f"{body} {DATE_SIGNIFIERS[name]} {value}"
        if due:
            body = f"{body} {DATE_SIGNIFIERS['due']} {due}"

        path = self.config.todo_file(None if to_inbox else group)
        self._edit(path, lambda text: insert_into_section(text, section, f"- [ ] {body}"))
        return self.get(Task.parse(f"- [ ] {body}", group=group or "").id)

    def complete(self, ident, *, on=None):
        task = self.get(ident)
        if task.done:
            return task
        on = on or date.today().isoformat()
        body = task.raw
        if DATE_SIGNIFIERS["done"] not in body:
            body = f"{body} {DATE_SIGNIFIERS['done']} {on}"
        line = f"{task.indent}- [x] {body}"

        done_section = self.config.done_section
        text = task.path.read_text()
        try:
            text = remove_line(text, task.lineno, task.render())
            text = insert_into_section(text, done_section, line)
        except Exception:
            # No Done section in this file: complete it where it stands.
            text = replace_line(task.path.read_text(), task.lineno, task.render(), line)
        task.path.write_text(text)
        return self.get(ident)

    def move(self, ident, *, group, section):
        """Move a task into a group's list.

        The destination folder decides the group, so group tags are dropped on
        the way in — a task in ``pima/`` tagged ``#personal`` would be a lie.
        """
        task = self.get(ident)
        body = task.raw
        for name in self.config.groups:
            body = re.sub(rf"#{re.escape(name)}\b", "", body)
        body = re.sub(r"\s{2,}", " ", body).strip()
        line = f"{task.indent}- [{task.status}] {body}"

        dest = self.config.todo_file(group)
        if dest == task.path:
            self._edit(dest, lambda text: insert_into_section(
                remove_line(text, task.lineno, task.render()), section, line))
        else:
            self._edit(task.path, lambda text: remove_line(text, task.lineno, task.render()))
            self._edit(dest, lambda text: insert_into_section(text, section, line))
        return self.get(Task.parse(line, group=group).id)

    def tag(self, ident, *, add=(), remove=()):
        """Add and remove tags on a task in place.

        Tags are stripped before the id is derived, so tagging never changes
        what a task answers to. That is the point: an external system can mark
        a task without invalidating every reference to it.

        Tags live in the description, ahead of the date signifiers — appending
        to the end of the line would put the tag inside the due date's value.
        """
        task = self.get(ident)
        before = task.render()
        description = task.description

        for name in remove:
            name = name.lstrip("#")
            description = re.sub(
                rf"#{re.escape(name)}(?![A-Za-z0-9_\-/])", "", description
            )

        for name in add:
            name = name.lstrip("#")
            if not re.fullmatch(r"[A-Za-z0-9_\-/]+", name):
                raise TaskStoreError(
                    f"invalid tag {name!r}: letters, digits, _, - and / only"
                )
            if name in self.config.groups and name != task.group:
                raise TaskStoreError(
                    f"refusing to tag a {task.group or 'ungrouped'} task #{name}: "
                    "the folder decides the group, so the tag would be a lie"
                )
            if re.search(rf"#{re.escape(name)}(?![A-Za-z0-9_\-/])", description):
                continue
            description = f"{description} #{name}"

        task.set_description(re.sub(r"\s{2,}", " ", description).strip())
        after = task.render()
        self._edit(
            task.path, lambda text: replace_line(text, task.lineno, before, after)
        )
        return self.get(ident)

    def remove(self, ident):
        task = self.get(ident)
        self._edit(task.path, lambda text: remove_line(text, task.lineno, task.render()))
        return task

    def normalise_all(self):
        changed = []
        for path in sorted(self.config.root.rglob("*.md")):
            if ".git" in path.parts:
                continue
            before = path.read_text()
            after = normalise(before)
            if before != after:
                path.write_text(after)
                changed.append(path.relative_to(self.config.root))
        return changed

    @staticmethod
    def _edit(path, mutate):
        path.write_text(mutate(path.read_text()))
