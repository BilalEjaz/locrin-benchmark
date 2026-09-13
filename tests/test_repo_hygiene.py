import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> bytes:
    if shutil.which("git") is None or not (ROOT / ".git").exists():
        pytest.skip("not a git checkout")
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def test_gitattributes_normalises_text_to_lf():
    lines = (ROOT / ".gitattributes").read_bytes().splitlines()
    assert b"* text=auto eol=lf" in lines


def test_tracked_files_have_no_crlf_in_working_tree():
    names = [n for n in git("ls-files", "-z").decode("utf-8").split(chr(0)) if n]
    crlf = bytes([13, 10])
    bad = [n for n in names if (ROOT / n).is_file() and crlf in (ROOT / n).read_bytes()]
    assert bad == []


def test_index_stores_no_crlf():
    lines = git("ls-files", "--eol").decode("utf-8").splitlines()
    bad = [line for line in lines if line.startswith(("i/crlf", "i/mixed"))]
    assert bad == []
