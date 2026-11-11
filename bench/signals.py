"""The text filters that pick wave two's diffs.

Wave one sampled agent-written commits at random, and most rules never met their subject: 2.8 percent
of its diffs touch cryptography at all, 0.5 percent set a cookie. A signal is a cheap pattern over the
lines a commit adds, read from the patch GitHub already returns, so a candidate can be kept or dropped
before any file is fetched.

A signal is a superset of what its rule can flag. It says the rule's subject appears in the diff, never
that the rule fires there, so a diff chosen by one measures the rule on the population it can speak
about and can be pooled with a diff chosen at random.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

# The files the JavaScript family rules read. PHP and Python are left out: 16 of the 21 rules do not run on them.
JS_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")

# Copied by value from the engine's crates/rules/src/leftover_debug.rs (TEST_DIRS and TEST_SUFFIXES), so a
# file counts as a test here exactly when leftover-debug exempts it there.
TEST_DIRS = ("test", "tests", "__tests__", "spec")
TEST_SUFFIXES = (".test", ".spec", "-test", "_test")


def is_test_file(path: str) -> bool:
    """Whether a repository-relative path names a test file, by a directory on it or by its own name."""
    dirs, _, name = path.rpartition("/")
    if any(d in TEST_DIRS for d in dirs.split("/")):
        return True
    stem = name.rpartition(".")[0] or name
    return stem.endswith(TEST_SUFFIXES)


def _debug_allowed(path: str) -> bool:
    """The engine's default debug_allowed globs: **/scripts/**, **/bin/** and **/*.config.*."""
    dirs, _, name = path.rpartition("/")
    return any(d in ("scripts", "bin") for d in dirs.split("/")) or ".config." in name


def _anywhere(path: str) -> bool:
    return True


@dataclass(frozen=True)
class Signal:
    name: str
    pattern: re.Pattern[str]
    wants: Callable[[str], bool] = _anywhere


def _signal(name: str, pattern: str, wants: Callable[[str], bool] = _anywhere, flags: int = 0) -> Signal:
    return Signal(name, re.compile(pattern, flags), wants)


# Rarest first, measured on wave one. A diff matching several signals is assigned in this order, so the
# scarce subjects fill before the common ones take the diff.
SIGNALS: dict[str, Signal] = {s.name: s for s in (
    _signal("weak-crypto", r"createHash\(|createHmac\(|create(De)?cipher(iv)?\(|Math\.random\(|\bmd5\b|\bsha1\b",
            flags=re.IGNORECASE),
    _signal("express-cookie", r"\.cookie\("),
    # The name of the key, never a pasted key: a diff chosen for holding one would put a live credential in
    # a public corpus.
    _signal("supabase-service-role", r"service_role|serviceRole", flags=re.IGNORECASE),
    _signal("test-skip", r"\.(skip|todo)\b|\bx(it|test|describe)\("),
    _signal("html-sink", r"dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML"
                         r"|document\.write\(|\.html\("),
    _signal("test-case", r"\b(it|test)\(", wants=is_test_file),
    _signal("marker", r"\b(TODO|FIXME|HACK|XXX)\b"),
    _signal("console", r"\bconsole\.(log|debug|trace|dir|table)\(|\bdebugger\b",
            wants=lambda path: not is_test_file(path) and not _debug_allowed(path)),
)}

# How many wave-two diffs each signal may take: 110 in all. express-cors-wildcard-on-authenticated has no
# signal: it fires only where a repository's locrin.toml names its auth middleware, and the harness writes
# one config for every repository, so no diff could move its number.
WAVE_TWO_TARGETS: dict[str, int] = {
    "weak-crypto": 20, "express-cookie": 10, "supabase-service-role": 9, "test-skip": 12,
    "html-sink": 12, "test-case": 20, "marker": 12, "console": 15,
}


def added_lines(patch: str | None) -> list[str]:
    """The lines a patch adds, without their `+`. GitHub sends no patch for a large or binary file: no lines.

    A per-file patch from the commits API starts at its first hunk and carries no `+++` file header, so a
    line starting `+++` is an added line whose own text starts `++`.
    """
    if not patch:
        return []
    return [line[1:] for line in patch.split("\n") if line.startswith("+")]


def matched(files: list[dict]) -> list[str]:
    """The signals a commit's files match, in SIGNALS order. `files` is the commits API's `files` list."""
    hit: set[str] = set()
    for f in files:
        path = f.get("filename")
        if not isinstance(path, str) or not path.endswith(JS_EXTENSIONS):
            continue
        lines = added_lines(f.get("patch"))
        for s in SIGNALS.values():
            if s.name not in hit and s.wants(path) and any(s.pattern.search(line) for line in lines):
                hit.add(s.name)
    return [name for name in SIGNALS if name in hit]


def pick(matched: list[str], held: dict[str, int], targets: dict[str, int]) -> str | None:
    """The first matched signal that still has room under its target, or None when none has."""
    for name in matched:
        if held.get(name, 0) < targets.get(name, 0):
            return name
    return None
