import pytest

from obsidian_task_store import TaskStore
from obsidian_task_store.errors import TaskNotFound


def test_zero_config_vault_works(vault):
    """A bare todo.md with no .tasks.toml is a valid vault."""
    root = vault({"todo.md": "# Todo\n\n## Inbox\n"})
    store = TaskStore.open(root)
    task = store.add("Buy milk")
    assert [t.title for t in store.tasks()] == ["Buy milk"]
    assert task.group == ""


def test_config_declares_groups(grouped_vault):
    store = TaskStore.open(grouped_vault)
    store.add("Ship the thing", group="work")
    task = store.tasks()[0]
    assert task.group == "work"
    assert "#work" in task.description


def test_group_comes_from_the_folder_not_the_tag(grouped_vault):
    (grouped_vault / "work" / "todo.md").write_text(
        "# Work\n\n## Now\n\n- [ ] Mislabelled #home\n\n## Done\n"
    )
    store = TaskStore.open(grouped_vault)
    assert store.tasks()[0].group == "work"


def test_add_to_a_group_section_skips_the_inbox(grouped_vault):
    store = TaskStore.open(grouped_vault)
    store.add("Urgent thing", group="work", section="Now")
    assert "Urgent thing" in (grouped_vault / "work" / "todo.md").read_text()
    assert "Urgent thing" not in (grouped_vault / "todo.md").read_text()


def test_id_survives_a_move(grouped_vault):
    store = TaskStore.open(grouped_vault)
    before = store.add("Chase the invoice", group="work")
    after = store.move(before.id, group="work", section="Now")
    assert after.id == before.id
    assert after.section == "Now"


def test_id_survives_completion(grouped_vault):
    store = TaskStore.open(grouped_vault)
    task = store.add("Chase the invoice", group="work", section="Now")
    done = store.complete(task.id)
    assert done.id == task.id
    assert done.done is True
    assert done.section == "Done"


def test_completion_stamps_a_date_without_rewriting_the_line(grouped_vault):
    store = TaskStore.open(grouped_vault)
    task = store.add("Thing \U0001f501 every week", group="work", section="Now")
    done = store.complete(task.id, on="2026-09-14")
    assert "✅ 2026-09-14" in done.raw
    assert "\U0001f501 every week" in done.raw


def test_completing_twice_does_not_double_stamp(grouped_vault):
    store = TaskStore.open(grouped_vault)
    task = store.add("Thing", group="work", section="Now")
    first = store.complete(task.id, on="2026-09-14")
    again = store.complete(first.id, on="2026-09-15")
    assert again.raw.count("✅") == 1


def test_move_drops_a_now_wrong_group_tag(grouped_vault):
    store = TaskStore.open(grouped_vault)
    task = store.add("Cross domain", group="work")
    moved = store.move(task.id, group="home", section="Now")
    assert "#work" not in moved.raw
    assert moved.group == "home"


def test_remove_deletes_the_line(grouped_vault):
    store = TaskStore.open(grouped_vault)
    task = store.add("Mistake", group="work")
    store.remove(task.id)
    assert store.tasks() == []
    with pytest.raises(TaskNotFound):
        store.get(task.id)


def test_listing_sorts_by_due_then_priority(grouped_vault):
    store = TaskStore.open(grouped_vault)
    store.add("No due date", group="work")
    store.add("Later", group="work", due="2026-10-01")
    store.add("Sooner", group="work", due="2026-09-01")
    assert [t.title for t in store.tasks()] == ["Sooner", "Later", "No due date"]


def test_status_filters(grouped_vault):
    store = TaskStore.open(grouped_vault)
    a = store.add("Open one", group="work", section="Now")
    store.add("Another", group="work", section="Now")
    store.complete(a.id)
    assert len(store.tasks(status="open")) == 1
    assert len(store.tasks(status="done")) == 1
    assert len(store.tasks(status="all")) == 2


def test_due_before_filter(grouped_vault):
    store = TaskStore.open(grouped_vault)
    store.add("Soon", group="work", due="2026-09-01")
    store.add("Far", group="work", due="2027-01-01")
    assert [t.title for t in store.tasks(due_before="2026-10-01")] == ["Soon"]


def test_group_filter(grouped_vault):
    store = TaskStore.open(grouped_vault)
    store.add("Work thing", group="work", section="Now")
    store.add("Home thing", group="home", section="Now")
    assert [t.title for t in store.tasks(group="home")] == ["Home thing"]


def test_fmt_reports_what_it_changed(grouped_vault):
    (grouped_vault / "messy.md").write_text("# A\n\n\n\n## B\n- [ ] t\n")
    store = TaskStore.open(grouped_vault)
    changed = store.normalise_all()
    assert [str(p) for p in changed] == ["messy.md"]
    assert store.normalise_all() == []
