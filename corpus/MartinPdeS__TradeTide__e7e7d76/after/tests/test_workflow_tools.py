"""Tests for repository workflow helpers."""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIRECTORY = REPOSITORY_ROOT / "tools"


def load_tool_module(name: str) -> ModuleType:
    """Load a repository-only workflow helper without packaging it."""
    path = TOOLS_DIRECTORY / f"{name}.py"
    specification = importlib.util.spec_from_file_location(f"tradetide_test_{name}", path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"could not load workflow helper: {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


check_release = load_tool_module("check_release")
release_tag = load_tool_module("release_tag")


def test_release_versions_are_aligned() -> None:
    """Package release artifacts declare one version."""
    declared = check_release.versions()
    assert len(set(declared.values())) == 1


@pytest.mark.parametrize(("version", "expected"), [("1.2.3", "1.2.3"), ("v1.2.3", "1.2.3")])
def test_normalized_version(version: str, expected: str) -> None:
    """Release checks accept plain and Git-style version strings."""
    assert check_release.normalized_version(version) == expected


@pytest.mark.parametrize("tag", ["1.2.3", "v1.2", "v1.2.3.4", "v01.2.3"])
def test_release_tag_validation_rejects_invalid_semantic_versions(tag: str) -> None:
    """Release tags must use the canonical semantic-version format."""
    with pytest.raises(ValueError, match="vMAJOR.MINOR.PATCH"):
        release_tag.validate_tag(tag)


def test_release_tag_validation_extracts_version() -> None:
    """A valid release tag maps to its PEP 440 package version."""
    assert release_tag.validate_tag("v1.2.3") == "1.2.3"
