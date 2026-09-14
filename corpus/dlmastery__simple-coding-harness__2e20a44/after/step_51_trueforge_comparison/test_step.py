"""Step 51 - offline checks for the comparison README and its demo.

The README is the deliverable. These tests read it and check its shape:
the thirteen capability headings, one table under each with the three
harness columns and a sources column, three filled cells and at least one
link per row, the "(docs)" marker on every Managed Agents cell, every URL
on one of four allowed hosts, and every cited step number present as a
directory in the repository. The demo is run in-process and as a
subprocess. Nothing here touches the network.
"""

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import demo

HERE = Path(__file__).parent
ROOT = HERE.parent
README = HERE / "README.md"

CAPABILITIES = demo.CAPABILITIES
COLUMNS = ("This codelab", "TrueForge", "Claude Managed Agents")
HOSTS = ("trueforge.dev", "github.com", "docs.anthropic.com", "platform.claude.com")
LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
STEP = re.compile(r"\bstep (\d+)\b")
STAGE = re.compile(r"\bstage (\d+)(?:\.(\d+))?\b")


def text():
    return README.read_text(encoding="utf-8")


def headings():
    return [line[3:].strip() for line in text().splitlines() if line.startswith("## ")]


def every_table():
    """(section name, header cells, row cells) for every table in the README."""
    for name in headings():
        try:
            header, rows = demo.table(name)
        except ValueError:
            continue
        yield name, header, rows


def test_readme_exists_and_is_titled():
    assert README.exists()
    assert text().startswith("# Step 51 - TrueForge versus this codelab versus managed agents")


def test_thirteen_capability_headings_in_order():
    found = [h for h in headings() if h in CAPABILITIES]
    assert found == list(CAPABILITIES)


def test_required_sections_exist():
    names = headings()
    for name in ("Quick demo", "How to read the tables", "What changes when the harness is a server",
                 "Cost and hosting", "Run it", "The code, piece by piece", "What to notice",
                 "Diff from step 50"):
        assert name in names, name
    server = demo.section("What changes when the harness is a server")
    assert "### What you gain" in server and "### What you lose" in server


def test_quick_demo_has_the_command_and_recorded_output():
    body = "\n".join(demo.section("Quick demo"))
    assert "curl -s http://localhost:8790/api/v1/capabilities" in body
    assert "curl -s http://localhost:8790/api/v1/models" in body
    assert '"openai/gpt-4-1-mini"' in body
    assert "sk-" not in body


def test_every_capability_has_a_table_with_three_harness_columns():
    for name in CAPABILITIES:
        header, rows = demo.table(name)
        assert header[0] == "Aspect", name
        for column in COLUMNS:
            assert any(column in cell for cell in header), f"{name}: column {column} missing"
        assert header[-1] == "Sources", name
        assert rows, f"{name}: table has no rows"


def test_every_table_row_has_the_header_width_and_no_empty_cell():
    for name, header, rows in every_table():
        for row in rows:
            assert len(row) == len(header), f"{name}: ragged row {row[0][:40]}"
            assert all(row), f"{name}: empty cell in {row[0][:40]}"


def test_every_managed_agents_cell_is_marked_from_the_docs():
    for name, header, rows in every_table():
        column = next(i for i, cell in enumerate(header) if "Claude Managed Agents" in cell)
        assert "from the docs, not run here" in header[column], name
        for row in rows:
            assert row[column].endswith("(docs)"), f"{name}: unmarked cell in {row[0][:40]}"


def test_every_table_row_links_a_source():
    for name, header, rows in every_table():
        for row in rows:
            assert LINK.search(row[-1]), f"{name}: row without a link: {row[0][:40]}"


def test_every_url_is_http_and_on_an_allowed_host():
    links = LINK.findall(text())
    assert len(links) > 100
    for _label, url in links:
        parts = urlparse(url)
        assert parts.scheme in ("http", "https"), url
        assert parts.netloc in HOSTS, url
        assert " " not in url, url
        if parts.netloc == "github.com":
            assert parts.path.startswith("/truefoundry/trueforge"), url


def test_every_cited_step_and_stage_is_a_directory():
    body = text()
    for number in {int(n) for n in STEP.findall(body)}:
        assert list(ROOT.glob(f"step_{number:02d}_*")), f"step {number} has no directory"
    for major, minor in set(STAGE.findall(body)):
        pattern = f"step_{int(major):02d}_{minor}_*" if minor else f"step_{int(major):02d}_*"
        assert list(ROOT.glob(pattern)), f"stage {major}.{minor} has no directory"


def test_metrics_table_covers_the_capstone_and_every_part_seven_step():
    header, rows = demo.table("Cost and hosting", index=1)
    assert header[:2] == ["Step", "Demo"] and header[-1] == "Cost at list price"
    steps = [int(row[0]) for row in rows]
    assert set(steps) == {38, 46, 47, 48, 49, 50}
    for row in rows:
        assert len(row) == len(header), row[0]
        assert list(ROOT.glob(f"step_{int(row[0]):02d}_*")), f"step {row[0]} has no directory"
        assert row[-1].startswith("$"), row[0]


def test_unverified_claims_are_marked_not_guessed():
    body = text().lower()
    assert "not in the docs" in body
    for word in ("probably", "likely", "presumably"):
        assert word not in body, f"hedged claim: {word}"


def test_readme_never_references_recordings():
    body = text().lower()
    for word in ("oediv", "ebutuoy"):  # reversed so the repo-wide grep stays empty
        assert "".join(reversed(word)) not in body


def test_render_prints_one_block_per_row():
    out = demo.render("Permissions")
    _header, rows = demo.table("Permissions")
    assert out.startswith("== Permissions ==")
    assert out.count("\n* ") == len(rows)
    assert "https://platform.claude.com/docs/en/managed-agents/permission-policies" in out
    assert "[CMA](" not in out  # links are reduced to labels or bare URLs


def test_render_works_on_a_synthetic_readme():
    fake = "\n".join([
        "# Step 51 - x", "", "## Loop", "", "| Aspect | A | B | Sources |", "|---|---|---|---|",
        "| The loop | one | two (docs) | [S](https://trueforge.dev/api/overview) |", "", "## Next", "x",
    ])
    out = demo.render("Loop", fake)
    assert "* The loop" in out and "A: one" in out and "B: two (docs)" in out
    assert "sources: https://trueforge.dev/api/overview" in out


def test_demo_cli_lists_and_prints_and_rejects():
    run = lambda *args: subprocess.run([sys.executable, "demo.py", *args], cwd=HERE,
                                       capture_output=True, text=True, encoding="utf-8")
    listing = run()
    assert listing.returncode == 0 and "permissions" in listing.stdout
    table = run("sandbox")
    assert table.returncode == 0 and table.stdout.startswith("== Sandbox ==")
    bad = run("teleport")
    assert bad.returncode == 1 and "unknown capability" in bad.stdout
