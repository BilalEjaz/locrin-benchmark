import pytest

from bench.readme_table import replace_table


def test_replaces_between_markers_only():
    readme = "# t\n\n<!-- results:start -->\nold\n<!-- results:end -->\n\n## after\n"
    out = replace_table(readme, "| a |\n")
    assert out == "# t\n\n<!-- results:start -->\n| a |\n<!-- results:end -->\n\n## after\n"


def test_missing_marker_raises():
    with pytest.raises(ValueError, match="results:start"):
        replace_table("no markers", "x")


def test_missing_end_marker_raises():
    with pytest.raises(ValueError, match="results:end"):
        replace_table("<!-- results:start -->\nold\n", "x")


def test_table_without_trailing_newline_gets_one_and_is_idempotent():
    readme = "<!-- results:start -->\nold\n<!-- results:end -->\n"
    once = replace_table(readme, "| a |")
    assert once == "<!-- results:start -->\n| a |\n<!-- results:end -->\n"
    assert replace_table(once, "| a |") == once
