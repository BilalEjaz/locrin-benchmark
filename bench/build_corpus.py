"""Build corpus records from GitHub commits that carry an agent co-author trailer.

Every GitHub call goes through the gh command line tool, which holds its own
credentials: this module never reads a token.
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path

from bench.corpus import ALLOWED_LICENCES, CorpusError, _valid_file, language_of, load_corpus

TRAILERS = ["Co-Authored-By: Claude", "Co-authored-by: Codex", "Co-authored-by: Copilot", "Co-authored-by: Cursor"]
MAX_FILES = 30
MAX_BYTES = 200_000
PER_REPO = 3
LANG_ORDER = ["typescript", "javascript", "php", "python"]
RATE_LIMIT_SLEEP = 60
SEARCH_PAGE_SLEEP = 2


class BuildError(Exception):
    pass


class RateLimitError(BuildError):
    """GitHub still refused after the one rate-limit wait."""


class GitHub:
    def __init__(self, program: str = "gh"):
        self.program = program

    def get(self, path: str, params: dict | None = None, accept: str = "application/vnd.github+json") -> dict:
        cmd = [self.program, "api", "--method", "GET", path, "-H", f"Accept: {accept}"]
        for key, value in (params or {}).items():
            cmd += ["-f", f"{key}={value}"]
        for attempt in (1, 2):
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                   stdin=subprocess.DEVNULL)
            except OSError as e:
                raise BuildError(f"GET {path}: cannot run gh: {e}") from e
            if r.returncode == 0:
                try:
                    return json.loads(r.stdout)
                except json.JSONDecodeError as e:
                    raise BuildError(f"GET {path}: gh printed no JSON: {e}") from e
            message = r.stderr.strip() or f"gh exit {r.returncode}"
            if "rate limit" not in message.lower():
                raise BuildError(f"GET {path}: {message}")
            if attempt == 2:
                raise RateLimitError(f"GET {path}: {message}")
            time.sleep(RATE_LIMIT_SLEEP)
        raise AssertionError("unreachable")


def candidates(gh, trailer: str, per_page: int = 100, pages: int = 3) -> list[dict]:
    items = []
    for page in range(1, pages + 1):
        if page > 1:
            time.sleep(SEARCH_PAGE_SLEEP)
        doc = gh.get("search/commits", {"q": f'"{trailer}" is:public', "sort": "committer-date", "order": "desc",
                                        "per_page": per_page, "page": page})
        got = doc.get("items", [])
        items.extend(got)
        if len(got) < per_page:
            break
    return items


def _corpus_language(files: list[dict]) -> str | None:
    langs: Counter[str] = Counter()
    for f in files:
        lang = language_of(f["filename"])
        if lang and f.get("status") in ("added", "modified"):
            langs["typescript" if lang == "tsx" else lang] += 1
    if not langs:
        return None
    best = max(langs.values())
    return next(lang for lang in LANG_ORDER if langs.get(lang) == best)


class _Skip(Exception):
    pass


# Names Windows reserves for devices, with or without an extension.
_RESERVED = {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} | {
    f"{dev}{n}" for dev in ("COM", "LPT") for n in (*"0123456789", chr(0xB9), chr(0xB2), chr(0xB3))}
_FORBIDDEN = set('<>:"|?*')


def _segment_problem(segment: str) -> str | None:
    if any(ch in _FORBIDDEN or ord(ch) < 32 for ch in segment):
        return "holds a character Windows forbids"
    if segment.endswith((".", " ")):
        return "ends in a dot or space"
    if segment.split(".", 1)[0].rstrip(" ").upper() in _RESERVED:
        return "is a Windows device name"
    return None


def _portable_problem(names) -> str | None:
    """Why this set of paths, all stored side by side, cannot be checked out on Windows and Linux alike.

    None when every path is safe and portable. Paths are POSIX, relative, and
    belong to one side (before or after) of a record.
    """
    files: dict[str, str] = {}
    dirs: dict[str, str] = {}
    for name in names:
        if not _valid_file(name):
            return f"unsafe path {name!r}"
        segments = name.split("/")
        for segment in segments:
            problem = _segment_problem(segment)
            if problem:
                return f"not portable: {name!r} {problem}"
        key = name.casefold()
        other = files.get(key) or dirs.get(key)
        if other is not None and other != name:
            return f"not portable: {name!r} and {other!r} differ only by case"
        files[key] = name
        for i in range(1, len(segments)):
            prefix = "/".join(segments[:i])
            clash = files.get(prefix.casefold())
            if clash is not None:
                return f"not portable: {name!r} and {clash!r} differ only by case"
            dirs.setdefault(prefix.casefold(), name)
    return None


def _contents(gh, repo: str, path: str, ref: str) -> bytes:
    """The file at ref. Raises _Skip when it cannot be read or is over MAX_BYTES."""
    try:
        doc = gh.get(f"repos/{repo}/contents/{urllib.parse.quote(path)}", {"ref": ref})
    except RateLimitError:
        raise
    except BuildError as e:
        raise _Skip(f"cannot read {path} at {ref[:7]}: {e}") from e
    if not isinstance(doc, dict) or doc.get("encoding") != "base64":
        raise _Skip(f"{path} at {ref[:7]} is not a file under {MAX_BYTES} bytes")
    if doc.get("size", 0) > MAX_BYTES:
        raise _Skip(f"{path} at {ref[:7]} is over {MAX_BYTES} bytes")
    data = base64.b64decode(doc.get("content", ""))
    if len(data) > MAX_BYTES:
        raise _Skip(f"{path} at {ref[:7]} is over {MAX_BYTES} bytes")
    return data


def _skip(repo: str, sha: str, reason: str) -> None:
    print(f"skip {repo}@{sha[:7]}: {reason}", file=sys.stderr)


def accept(gh, item: dict, seen_repos: dict[str, int]):
    """A (record, before, after) triple for an acceptable commit, or None with the reason on stderr.

    Before and after hold the supported source files only. A renamed file's
    before side is stored under its previous name, which the record lists too,
    even when the new name is not a supported file. Every listed file has a
    stored copy on at least one side, each name is listed once, and every
    stored path is checked before anything is fetched.
    """
    named = item["repository"]["full_name"]
    sha = item["sha"]
    if len(item.get("parents", [])) != 1:
        _skip(named, sha, "merge or root commit")
        return None
    # The cap counts repositories by lower-cased canonical name: GitHub names are case-insensitive.
    if seen_repos.get(named.lower(), 0) >= PER_REPO:
        _skip(named, sha, "repository cap")
        return None
    meta = gh.get(f"repos/{named}")
    # The name as typed with --repo, or from a search hit made before a rename, is not the record's
    # name: GitHub's canonical full_name is, so one commit always gets one id.
    repo = meta.get("full_name") or named
    if repo.lower() != named.lower() and seen_repos.get(repo.lower(), 0) >= PER_REPO:
        _skip(repo, sha, "repository cap")
        return None
    if meta.get("private") is not False or meta.get("visibility") != "public":
        # The build search asks for is:public, but a named commit (--repo/--sha) reads with the caller's own access.
        _skip(repo, sha, f"repository is not public (private={meta.get('private')}, visibility={meta.get('visibility')})")
        return None
    licence = (meta.get("license") or {}).get("spdx_id")
    if licence not in ALLOWED_LICENCES or meta.get("fork") or meta.get("archived"):
        _skip(repo, sha, f"licence {licence}, fork={meta.get('fork')}, archived={meta.get('archived')}")
        return None
    commit = gh.get(f"repos/{repo}/commits/{sha}")
    files = commit.get("files", [])
    if not 1 <= len(files) <= MAX_FILES:
        _skip(repo, sha, f"{len(files)} files")
        return None
    language = _corpus_language(files)
    if language is None:
        _skip(repo, sha, "no added or modified supported source file")
        return None
    parent = commit["parents"][0]["sha"]
    names: list[str] = []
    want_before: list[str] = []
    want_after: list[str] = []
    for f in files:
        name, status = f["filename"], f.get("status")
        # The old name of a rename is its own before-side file, whatever the new name is.
        old = f.get("previous_filename") if status == "renamed" else None
        if old and language_of(old):
            names.append(old)
            want_before.append(old)
        if not language_of(name):
            continue
        names.append(name)
        if status not in ("added", "copied", "renamed"):
            want_before.append(name)
        if status != "removed":
            want_after.append(name)
    names = list(dict.fromkeys(names))
    want_before = list(dict.fromkeys(want_before))
    want_after = list(dict.fromkeys(want_after))
    # Check every path before fetching anything: the corpus must check out on Windows and Linux.
    problem = _portable_problem(want_before) or _portable_problem(want_after)
    if not problem and set(names) != set(want_before) | set(want_after):
        problem = f"files {sorted(set(names) - set(want_before) - set(want_after))} have no stored copy"
    if problem:
        _skip(repo, sha, problem)
        return None
    try:
        before = {n: _contents(gh, repo, n, parent) for n in want_before}
        after = {n: _contents(gh, repo, n, sha) for n in want_after}
    except _Skip as e:
        _skip(repo, sha, str(e))
        return None
    rec = {
        "id": f"{repo.replace('/', '__')}__{sha[:7]}",
        "source": "git",
        "repo": repo,
        "sha": sha,
        "parent": parent,
        "licence": licence,
        "language": language,
        "url": f"https://github.com/{repo}/commit/{sha}",
        "files": names,
    }
    seen_repos[repo.lower()] = seen_repos.get(repo.lower(), 0) + 1
    return rec, before, after


def _lf(data: bytes) -> bytes:
    # The repository stores text with LF endings (.gitattributes), so the stored copy does too.
    return data.replace(b"\r\n", b"\n")


def write_record(out_root: Path, rec: dict, before: dict[str, bytes], after: dict[str, bytes]) -> Path:
    out_root = Path(out_root)
    path = out_root / f"{rec['id']}.json"
    if path.exists():
        return path
    problem = _portable_problem(before) or _portable_problem(after)
    if problem:
        raise BuildError(f"{rec['id']}: {problem}")
    out_root.mkdir(parents=True, exist_ok=True)
    tree = out_root / rec["id"]
    if tree.exists():
        # Left by an interrupted build: the record file is written last, so start clean.
        shutil.rmtree(tree)
    try:
        for sub, files in (("before", before), ("after", after)):
            for name, data in files.items():
                target = tree / sub / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(_lf(data))
    except OSError:
        # Leave nothing half written behind a skipped record.
        shutil.rmtree(tree, ignore_errors=True)
        raise
    path.write_bytes((json.dumps(rec, indent=2) + "\n").encode("utf-8"))
    return path


def _existing(out_root: Path) -> dict[str, tuple[str, str]]:
    """Record id to (repository, commit sha) for the records already in out_root."""
    found = {}
    if Path(out_root).is_dir():
        for p in Path(out_root).glob("*.json"):
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            if isinstance(raw, dict):
                found[p.stem] = (str(raw.get("repo") or ""), str(raw.get("sha") or ""))
    return found


def _check_gone(gh, out_root: Path) -> int:
    """Print `gone: <id>: <reason>` for every git record whose commit cannot be read, so it can be pruned."""
    try:
        diffs = load_corpus(out_root)
    except CorpusError as e:
        print(f"build_corpus: {e}", file=sys.stderr)
        return 1
    gone = 0
    try:
        for d in diffs:
            if d.source != "git":
                continue
            try:
                gh.get(f"repos/{d.repo}/commits/{d.sha}")
            except RateLimitError:
                raise
            except BuildError as e:
                print(f"gone: {d.id}: {e}")
                gone += 1
    except RateLimitError as e:
        print(f"build_corpus: stopped: {e}", file=sys.stderr)
        return 1
    return 1 if gone else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="build_corpus")
    p.add_argument("--out", default="corpus")
    p.add_argument("--target", type=int, default=300, help="stop once the corpus holds this many records")
    p.add_argument("--trailer", action="append")
    p.add_argument("--repo")
    p.add_argument("--sha")
    p.add_argument("--check-gone", action="store_true",
                   help="list the git records in --out whose commit GitHub no longer serves, and exit 1 if any")
    a = p.parse_args(argv)
    if a.check_gone:
        return _check_gone(GitHub(), Path(a.out))
    if bool(a.repo) != bool(a.sha):
        p.error("--repo and --sha go together")
    out = Path(a.out)
    gh = GitHub()
    if a.repo:
        try:
            commit = gh.get(f"repos/{a.repo}/commits/{a.sha}")
            recorded = [ident for ident, (_, sha) in _existing(out).items() if sha == commit["sha"]]
            if recorded:
                # Deduped on the full sha: the same commit under another spelling of its repository name.
                print(out / f"{recorded[0]}.json")
                return 0
            item = {"sha": commit["sha"], "repository": {"full_name": a.repo}, "parents": commit["parents"]}
            got = accept(gh, item, {})
            if got is None:
                return 1
            print(write_record(out, *got))
        except (BuildError, OSError) as e:
            print(f"build_corpus: {e}", file=sys.stderr)
            return 1
        return 0
    existing = _existing(out)
    # Deduped on the full commit sha, never on the id: a renamed repository gives one commit a second name.
    done = {sha for _, sha in existing.values() if sha}
    seen: dict[str, int] = dict(Counter(repo.lower() for repo, _ in existing.values() if repo))
    total = len(existing)
    written = 0
    try:
        for trailer in a.trailer or TRAILERS:
            if total >= a.target:
                break
            for item in candidates(gh, trailer):
                if total >= a.target:
                    break
                if item["sha"] in done:
                    continue
                done.add(item["sha"])
                try:
                    got = accept(gh, item, seen)
                    if got is None:
                        continue
                    print(write_record(out, *got))
                except RateLimitError:
                    raise
                except (BuildError, OSError) as e:
                    # OSError: the disk refused a file; skip this commit rather than stall every re-run on it.
                    _skip(item["repository"]["full_name"], item["sha"], str(e))
                    continue
                total += 1
                written += 1
    except RateLimitError as e:
        print(f"build_corpus: stopped: {e}", file=sys.stderr)
        print(f"wrote {written} records", file=sys.stderr)
        return 1
    print(f"wrote {written} records", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
