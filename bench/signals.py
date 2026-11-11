"""The text filters that pick wave two's diffs.

Wave one sampled agent-written commits as they came, and most rules never met their subject: of its 214
diffs, none sets a cookie, names a weak digest or adds a marker comment in a JavaScript or TypeScript
file, and 0.9 percent call Math.random. A signal is a cheap pattern over the lines a commit adds, read
from the patch GitHub already returns, so a candidate can be kept or dropped before any file is fetched.

A signal says a rule's subject appears in the diff, never that the rule fires there. Each pattern covers
every line its rule can flag, and each file filter is the rule's own, so a diff chosen by one measures the
rule on the population it can speak about and can be pooled with a diff chosen at random. The one
exception is deliberate and is noted on its signal.
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
    """Whether leftover-debug treats a repository-relative path as a test file and stays quiet in it."""
    dirs, _, name = path.rpartition("/")
    if any(d in TEST_DIRS for d in dirs.split("/")):
        return True
    stem = name.rpartition(".")[0] or name
    return stem.endswith(TEST_SUFFIXES)


def is_test_rule_file(path: str) -> bool:
    """Whether the test rules open a path: the engine's locrin_core::testcases::is_test_file, by value.

    Narrower than is_test_file on purpose. test-no-assert and test-newly-skipped read `*.test.*`, `*.spec.*`
    and anything under `__tests__`, and nothing else: `test/a.js` is a test to leftover-debug and unread by them.
    """
    name = path.rpartition("/")[2]
    return ".test." in name or ".spec." in name or "__tests__" in path.split("/")


def is_server_path(path: str) -> bool:
    """Whether a path matches the engine's default framework.server_paths, where the service-role rule is silent.

    The defaults by value from crates/core/src/config.rs: supabase/functions/**, server/**, api/** and scripts/**
    from the repository root, and **/*.server.*, **/*.test.*, **/*.spec.* anywhere. The harness never overrides them.
    """
    name = path.rpartition("/")[2]
    return (path.startswith(("supabase/functions/", "server/", "api/", "scripts/"))
            or any(part in name for part in (".server.", ".test.", ".spec.")))


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


# A test callee is a bare name: `pattern.test(` and `submit(` are not one.
_CALLEE = r"(?<![\w.$])"

# Rarest first, as measured on wave one's 214 diffs with these patterns: the first six appear in none of
# them, then 0.9, 2.3, 2.3 and 15.0 percent. A diff matching several signals is assigned in this order, so
# the scarce subjects fill before the common ones take the diff.
SIGNALS: dict[str, Signal] = {s.name: s for s in (
    # The name of the key, as the rule spells it, and never a pasted key: a diff chosen for holding one would
    # put a live credential in a public corpus. This is the one signal that is knowingly not a superset.
    _signal("supabase-service-role", r"service_role", wants=lambda path: not is_server_path(path),
            flags=re.IGNORECASE),
    # weak-crypto reads three shapes, and each has its own signal so the common one cannot crowd out the rest.
    _signal("cipher-iv", r"createCipheriv\(|createDecipheriv\("),
    _signal("express-cookie", r"\.cookie\("),
    # The rule flags createHash over md5 or sha1 and no other digest, so the digest's name is the signal.
    _signal("weak-hash", r"\bmd5\b|\bsha1\b", flags=re.IGNORECASE),
    _signal("test-skip", _CALLEE + r"(it|test|fit|ftest|describe|context)(\.\w+)*\.(skip|todo)\b"
                         r"|" + _CALLEE + r"x(it|test|describe)\(", wants=is_test_rule_file),
    _signal("marker", r"\b(TODO|FIXME|HACK|XXX)\b"),
    _signal("weak-random", r"Math\.random\("),
    _signal("html-sink", r"dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML"
                         r"|document\.write\(|\.html\("),
    _signal("console", r"\bconsole\??\.(log|debug|trace|dir|table)\(|\bdebugger\b",
            wants=lambda path: not is_test_file(path) and not _debug_allowed(path)),
    _signal("test-case", _CALLEE + r"(it|test|fit|ftest|xit|xtest)(\.\w+)*\s*[(`]", wants=is_test_rule_file),
)}

# How many wave-two diffs each signal may take: 110 in all, 20 of them across weak-crypto's three shapes.
# express-cors-wildcard-on-authenticated has no signal: it fires only where a repository's locrin.toml names
# its auth middleware, and the harness writes one config for every repository, so no diff could move its number.
WAVE_TWO_TARGETS: dict[str, int] = {
    "supabase-service-role": 9, "cipher-iv": 6, "express-cookie": 10, "weak-hash": 8, "test-skip": 12,
    "marker": 12, "weak-random": 6, "html-sink": 12, "console": 15, "test-case": 20,
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
