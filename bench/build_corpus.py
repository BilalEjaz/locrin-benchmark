"""Build corpus records from GitHub commits that carry an agent co-author trailer.

Two ways to find commits: the trailer search (search/commits for each trailer),
and the repository-first mode (--via-repos), which searches for permissively
licensed repositories pushed since a date and lists each one's recent commits
with the commits API. Both feed the same accept() and write_record().

Every GitHub call goes through the gh command line tool, which holds its own
credentials: this module never reads a token.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path

from bench.corpus import ALLOWED_LICENCES, CorpusError, _valid_file, _valid_id, _valid_repo, language_of, load_corpus

TRAILERS = ["Co-Authored-By: Claude", "Co-authored-by: Codex", "Co-authored-by: Copilot", "Co-authored-by: Cursor"]
MAX_FILES = 30
MAX_BYTES = 200_000
PER_REPO = 3
# At most this many records from one owner (the part of owner/name before the slash, any case), so one
# author cannot fill a language across many of their own repositories.
PER_OWNER = 6
LANG_ORDER = ["typescript", "javascript", "php", "python"]
# gh's error for a commit GitHub does not have: 404 for an unknown repository or commit, 422 for a sha it cannot resolve.
_NOT_FOUND = re.compile(r"\(HTTP 404\)|\(HTTP 422\)|No commit found for SHA")
_SHA = re.compile(r"[0-9a-fA-F]{7,40}")
SEARCH_PAGE_SLEEP = 2
# The agents the trailers name, in TRAILERS order.
AGENTS = [t.split(":", 1)[1].strip() for t in TRAILERS]
# Repository search keys for ALLOWED_LICENCES, and GitHub's names for the corpus languages.
LICENCE_KEYS = ["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc"]
GITHUB_LANGUAGES = {"typescript": "TypeScript", "javascript": "JavaScript", "php": "PHP", "python": "Python"}
# Pacing: GitHub answers back-to-back search calls with a secondary rate limit.
SEARCH_GAP = 3.0
CALL_GAP = 0.5
SECONDARY_WAIT = 120
RATE_RETRIES = 3
PRIMARY_MAX_WAIT = 65 * 60
RESET_SLACK = 1
_STATUS_LINE = re.compile(r"HTTP/[0-9.]+ (\d{3})")
_HTTP_STATUS = re.compile(r"\(HTTP (\d{3})\)")
_TRAILER_LINE = re.compile(r"^[ \t]*co-authored-by:[ \t]*(.*)$", re.IGNORECASE | re.MULTILINE)
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class BuildError(Exception):
    pass


class RateLimitError(BuildError):
    """GitHub still refused after the rate-limit waits, or a wait would run past the limit allowed."""


def _split_include(stdout: str) -> tuple[int | None, dict[str, str], str]:
    """(status, headers, body) from what gh api --include prints. Output with no status line is all body."""
    if not stdout.startswith("HTTP/"):
        return None, {}, stdout
    m = re.search(r"\r?\n\r?\n", stdout)
    head, body = (stdout[:m.start()], stdout[m.end():]) if m else (stdout, "")
    lines = head.splitlines()
    status = _STATUS_LINE.match(lines[0])
    headers = {}
    for line in lines[1:]:
        name, colon, value = line.partition(":")
        if colon:
            headers[name.strip().lower()] = value.strip()
    return (int(status.group(1)) if status else None), headers, body


class GitHub:
    """gh api, paced, with rate limits waited out.

    Search calls run at least SEARCH_GAP seconds apart and other calls at least
    CALL_GAP seconds apart, on a monotonic clock. Every wait goes through the
    one sleep function, which tests replace.
    """

    def __init__(self, program: str = "gh", sleep=None, clock=None, wall=None):
        self.program = program
        self._sleep_fn = sleep
        self._clock = clock or time.monotonic
        self._wall = wall or time.time
        self._last: dict[str, float] = {}

    def _sleep(self, seconds: float) -> None:
        # Looked up at call time, so a patched time.sleep still applies when none was injected.
        (self._sleep_fn or time.sleep)(seconds)

    def _command(self, path: str, params: dict | None, accept: str) -> list[str]:
        cmd = [self.program, "api", "--method", "GET", "--include", path, "-H", f"Accept: {accept}"]
        for key, value in (params or {}).items():
            cmd += ["-f", f"{key}={value}"]
        return cmd

    def _run(self, path: str, cmd: list[str]):
        try:
            return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                  stdin=subprocess.DEVNULL)
        except OSError as e:
            raise BuildError(f"GET {path}: cannot run gh: {e}") from e

    def _pace(self, kind: str) -> None:
        last = self._last.get(kind)
        if last is None:
            return
        wait = (SEARCH_GAP if kind == "search" else CALL_GAP) - (self._clock() - last)
        if wait > 0:
            self._sleep(wait)

    def _reset_wait(self, kind: str, path: str, message: str) -> float:
        """Seconds until the primary limit for kind resets, from gh api rate_limit. Raises RateLimitError past 65 minutes."""
        r = self._run("rate_limit", self._command("rate_limit", None, "application/vnd.github+json"))
        try:
            if r.returncode != 0:
                raise ValueError(r.stderr.strip() or f"gh exit {r.returncode}")
            reset = float(json.loads(_split_include(r.stdout)[2])["resources"][kind]["reset"])
        except (ValueError, KeyError, TypeError) as e:
            raise RateLimitError(f"GET {path}: {message} (cannot read the reset time: {e})") from e
        wait = max(reset - self._wall(), 0.0) + RESET_SLACK
        if wait > PRIMARY_MAX_WAIT:
            raise RateLimitError(f"GET {path}: {message} (resets in {int(wait)} seconds)")
        return wait

    def get(self, path: str, params: dict | None = None, accept: str = "application/vnd.github+json") -> dict:
        cmd = self._command(path, params, accept)
        kind = "search" if path.startswith("search/") else "core"
        retries = 0
        while True:
            self._pace(kind)
            try:
                r = self._run(path, cmd)
            finally:
                self._last[kind] = self._clock()
            status, headers, body = _split_include(r.stdout or "")
            if r.returncode == 0:
                try:
                    return json.loads(body)
                except json.JSONDecodeError as e:
                    raise BuildError(f"GET {path}: gh printed no JSON: {e}") from e
            message = r.stderr.strip() or f"gh exit {r.returncode}"
            if status is None:
                m = _HTTP_STATUS.search(message)
                status = int(m.group(1)) if m else None
            text = f"{message} {body}".lower()
            retry_after = headers.get("retry-after")
            secondary = retry_after is not None or (status in (403, 429) and "secondary rate limit" in text)
            primary = not secondary and "api rate limit exceeded" in text
            if not (secondary or primary or "rate limit" in text):
                raise BuildError(f"GET {path}: {message}")
            if retries >= RATE_RETRIES:
                raise RateLimitError(f"GET {path}: {message}")
            retries += 1
            if primary:
                wait = self._reset_wait(kind, path, message)
            else:
                try:
                    asked = float(retry_after) if retry_after is not None else 0.0
                except ValueError:
                    asked = 0.0
                wait = max(asked, SECONDARY_WAIT)
            print(f"build_corpus: rate limited on {path}, waiting {int(wait)} seconds", file=sys.stderr)
            self._sleep(wait)


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


def repo_query(language: str, licence: str, since: str) -> str:
    """The search/repositories query for one corpus language and one licence key."""
    return (f"language:{GITHUB_LANGUAGES[language]} license:{licence} pushed:>={since} "
            "fork:false archived:false is:public")


def repositories(gh, language: str, licence: str, since: str, per_page: int = 100, pages: int = 10):
    """Repositories for one language and licence, most recently updated first, one search page at a time."""
    q = repo_query(language, licence, since)
    for page in range(1, pages + 1):
        doc = gh.get("search/repositories", {"q": q, "sort": "updated", "order": "desc", "per_page": per_page,
                                             "page": page})
        got = doc.get("items", []) if isinstance(doc, dict) else []
        yield from got
        if len(got) < per_page:
            return


def repo_commits(gh, full_name: str, since: str, pages: int = 1, per_page: int = 100) -> list[dict]:
    """The repository's commits since the date, newest first, from the commits API (not search)."""
    commits: list[dict] = []
    for page in range(1, pages + 1):
        got = gh.get(f"repos/{full_name}/commits", {"since": f"{since}T00:00:00Z", "per_page": per_page, "page": page})
        if not isinstance(got, list):
            raise BuildError(f"GET repos/{full_name}/commits: not a list of commits")
        commits.extend(got)
        if len(got) < per_page:
            break
    return commits


def agent_trailer(message: str) -> str | None:
    """The agent a Co-authored-by line of the message names, or None.

    Only a line that starts with Co-authored-by (any case) counts, and only its
    name part (before the email address), where the agent must be a whole word.
    """
    for m in _TRAILER_LINE.finditer(message or ""):
        name = m.group(1).split("<", 1)[0]
        for agent in AGENTS:
            if re.search(rf"(?<![A-Za-z0-9]){re.escape(agent)}(?![A-Za-z0-9])", name, re.IGNORECASE):
                return agent
    return None


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


def _symlink_problem(gh, repo: str, sha: str, names) -> str | None:
    """Why this commit's tree cannot be scored the same way on Windows and Linux, or None.

    A tree entry with mode 120000 is a symbolic link: git checks it out as a link where the platform
    has them and as a text file holding the target path where it does not, so the engine would read
    different bytes on each platform and materialise refuses such a commit. Read once, before any file
    is downloaded. A tree that is truncated or comes back without a listing cannot rule the links out,
    so those commits are skipped too: an unreadable tree is an answer we do not have, not a no.
    """
    doc = gh.get(f"repos/{repo}/git/trees/{sha}", {"recursive": "1"})
    tree = doc.get("tree") if isinstance(doc, dict) else None
    if not isinstance(tree, list):
        return f"the tree at {sha[:7]} cannot be read, so a symbolic link among the changed files cannot be ruled out"
    if doc.get("truncated"):
        return f"the tree at {sha[:7]} is truncated, so a symbolic link among the changed files cannot be ruled out"
    wanted = set(names)
    links = sorted(e["path"] for e in tree if isinstance(e, dict) and e.get("mode") == "120000" and e.get("path") in wanted)
    return f"{links[0]} is a symbolic link at {sha[:7]}" if links else None


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


# Skipped commits by kind of reason, for the summary a build prints at the end.
SKIPS: Counter[str] = Counter()


def _skip(repo: str, sha: str, reason: str, kind: str | None = None) -> None:
    SKIPS[kind or reason] += 1
    print(f"skip {repo}@{sha[:7]}: {reason}", file=sys.stderr)


def _owner(repo: str) -> str:
    """The lower-cased owner of owner/name: GitHub owner names are case-insensitive."""
    return repo.split("/", 1)[0].lower()


def _owner_count(seen_repos: dict[str, int], owner: str) -> int:
    """How many records seen_repos (repository name to record count) holds for the owner."""
    return sum(n for name, n in seen_repos.items() if _owner(name) == owner)


def accept(gh, item: dict, seen_repos: dict[str, int], language_skip=None, meta_cache: dict | None = None,
           owners: dict[str, int] | None = None):
    """A (record, before, after) triple for an acceptable commit, or None with the reason on stderr.

    language_skip, when given, takes the commit's corpus language and returns a skip reason
    or None. It runs before any file is fetched and before the repository cap counts the
    commit, so a commit in an unwanted language costs two calls at most. meta_cache, when
    given, holds repository metadata by lower-cased name so each repository is read once.

    The owner cap (PER_OWNER) is checked next to the repository cap, before any file is
    fetched. Owner counts come from seen_repos, or from owners (lower-cased owner to record
    count) when given, which an accepted record then counts in too.

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

    def owner_held(owner: str) -> int:
        return owners.get(owner, 0) if owners is not None else _owner_count(seen_repos, owner)

    if owner_held(_owner(named)) >= PER_OWNER:
        _skip(named, sha, "owner cap")
        return None
    if meta_cache is not None and named.lower() in meta_cache:
        meta = meta_cache[named.lower()]
    else:
        meta = gh.get(f"repos/{named}")
        if meta_cache is not None:
            meta_cache[named.lower()] = meta
    # The name as typed with --repo, or from a search hit made before a rename, is not the record's
    # name: GitHub's canonical full_name is, so one commit always gets one id.
    repo = meta.get("full_name") or named
    if repo.lower() != named.lower() and seen_repos.get(repo.lower(), 0) >= PER_REPO:
        _skip(repo, sha, "repository cap")
        return None
    if _owner(repo) != _owner(named) and owner_held(_owner(repo)) >= PER_OWNER:
        _skip(repo, sha, "owner cap")
        return None
    if meta.get("private") is not False or meta.get("visibility") != "public":
        # The build search asks for is:public, but a named commit (--repo/--sha) reads with the caller's own access.
        _skip(repo, sha, f"repository is not public (private={meta.get('private')}, visibility={meta.get('visibility')})",
              "not public")
        return None
    licence = (meta.get("license") or {}).get("spdx_id")
    if licence not in ALLOWED_LICENCES or meta.get("fork") or meta.get("archived"):
        _skip(repo, sha, f"licence {licence}, fork={meta.get('fork')}, archived={meta.get('archived')}",
              "licence, fork or archived")
        return None
    commit = gh.get(f"repos/{repo}/commits/{sha}")
    files = commit.get("files", [])
    if not 1 <= len(files) <= MAX_FILES:
        _skip(repo, sha, f"{len(files)} files", "file count")
        return None
    language = _corpus_language(files)
    if language is None:
        _skip(repo, sha, "no added or modified supported source file", "no supported source file")
        return None
    reason = language_skip(language) if language_skip is not None else None
    if reason:
        _skip(repo, sha, f"{reason}: {language}", reason)
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
        _skip(repo, sha, problem, "path not portable or not stored")
        return None
    problem = _symlink_problem(gh, repo, sha, want_after)
    if problem:
        _skip(repo, sha, problem, "symbolic link among the changed files")
        return None
    try:
        before = {n: _contents(gh, repo, n, parent) for n in want_before}
        after = {n: _contents(gh, repo, n, sha) for n in want_after}
    except _Skip as e:
        _skip(repo, sha, str(e), "file unreadable or too large")
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
    if owners is not None:
        owners[_owner(repo)] = owners.get(_owner(repo), 0) + 1
    return rec, before, after


def _lf(data: bytes) -> bytes:
    # The repository stores text with LF endings (.gitattributes), so the stored copy does too.
    # Every run of carriage returns before a newline goes, or CR CR LF would leave a CRLF behind.
    return re.sub(rb"\r+\n", b"\n", data)


def write_record(out_root: Path, rec: dict, before: dict[str, bytes], after: dict[str, bytes]) -> Path:
    out_root = Path(out_root)
    if not isinstance(rec.get("id"), str) or not _valid_id(rec["id"]):
        # The id names a file and a directory under out_root, so it must never carry a path.
        raise BuildError(f"{rec.get('id')!r} is not a valid diff id")
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


def _existing_languages(out_root: Path) -> Counter[str]:
    """How many records of each language out_root already holds."""
    counts: Counter[str] = Counter()
    if Path(out_root).is_dir():
        for p in Path(out_root).glob("*.json"):
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            if isinstance(raw, dict) and isinstance(raw.get("language"), str):
                counts[raw["language"]] += 1
    return counts


def _via_repos(gh, out: Path, a) -> int:
    """The repository-first build: search repositories per language and licence, list their commits, accept matches."""
    existing = _existing(out)
    done = {sha for _, sha in existing.values() if sha}
    seen: dict[str, int] = dict(Counter(repo.lower() for repo, _ in existing.values() if repo))
    held = _existing_languages(out)
    languages = list(dict.fromkeys(a.language or LANG_ORDER))
    total = len(existing)
    written: Counter[str] = Counter()
    examined: set[str] = set()
    matched_total = 0
    failed_searches = 0
    SKIPS.clear()

    meta_cache: dict[str, dict] = {}

    def full(language: str) -> bool:
        return a.language_target is not None and held[language] >= a.language_target

    def language_skip(language: str) -> str | None:
        # Checked inside accept() before any file is fetched, so an unwanted language costs no contents calls.
        return ("language not selected" if language not in languages
                else "language target" if full(language) else None)

    def summary() -> None:
        print(f"examined {len(examined)} repositories, {matched_total} commits with an agent trailer", file=sys.stderr)
        print(f"wrote {sum(written.values())} records: "
              + ", ".join(f"{lang} {written[lang]}" for lang in languages), file=sys.stderr)
        if SKIPS:
            print("skipped: " + "; ".join(f"{kind} {n}" for kind, n in SKIPS.most_common()), file=sys.stderr)

    try:
        for language in languages:
            if full(language):
                print(f"{language} already holds {held[language]} records, the language target", file=sys.stderr)
                continue
            for licence in LICENCE_KEYS:
                if total >= a.target or full(language):
                    break
                try:
                    for repo in repositories(gh, language, licence, a.since):
                        if total >= a.target or full(language):
                            break
                        name = repo.get("full_name") if isinstance(repo, dict) else None
                        if not isinstance(name, str) or not _valid_repo(name) or name.lower() in examined:
                            continue
                        examined.add(name.lower())
                        if seen.get(name.lower(), 0) >= PER_REPO:
                            SKIPS["repository cap"] += 1
                            print(f"repo {name}: at the repository cap, commits not listed", file=sys.stderr)
                            continue
                        if _owner_count(seen, _owner(name)) >= PER_OWNER:
                            SKIPS["owner cap"] += 1
                            print(f"repo {name}: at the owner cap, commits not listed", file=sys.stderr)
                            continue
                        try:
                            commits = repo_commits(gh, name, a.since, pages=a.commit_pages)
                        except RateLimitError:
                            raise
                        except BuildError as e:
                            # An empty repository answers 409; one unreadable repository must not end the build.
                            SKIPS["commits unreadable"] += 1
                            print(f"repo {name}: cannot list commits: {e}", file=sys.stderr)
                            continue
                        matched = [c for c in commits if isinstance(c, dict) and isinstance(c.get("sha"), str)
                                   and agent_trailer((c.get("commit") or {}).get("message", ""))]
                        matched_total += len(matched)
                        accepted = 0
                        for c in matched:
                            if (total >= a.target or full(language) or seen.get(name.lower(), 0) >= PER_REPO
                                    or _owner_count(seen, _owner(name)) >= PER_OWNER):
                                break
                            if c["sha"] in done:
                                SKIPS["already recorded"] += 1
                                continue
                            done.add(c["sha"])
                            item = {"sha": c["sha"], "repository": {"full_name": name}, "parents": c.get("parents") or []}
                            try:
                                got = accept(gh, item, seen, language_skip=language_skip, meta_cache=meta_cache)
                                if got is None:
                                    continue
                                lang = got[0]["language"]
                                print(write_record(out, *got))
                            except RateLimitError:
                                raise
                            except (BuildError, OSError) as e:
                                _skip(name, c["sha"], str(e), "error")
                                continue
                            total += 1
                            held[lang] += 1
                            written[lang] += 1
                            accepted += 1
                        print(f"repo {name}: {len(commits)} commits, {len(matched)} matched, {accepted} accepted",
                              file=sys.stderr)
                except RateLimitError:
                    raise
                except BuildError as e:
                    print(f"build_corpus: search for {language} {licence} repositories failed: {e}", file=sys.stderr)
                    failed_searches += 1
                    continue
    except RateLimitError as e:
        print(f"build_corpus: stopped: {e}", file=sys.stderr)
        summary()
        return 1
    summary()
    return 1 if failed_searches else 0


def _check_gone(gh, out_root: Path) -> int:
    """Print `gone: <id>: <reason>` for every git record whose commit GitHub says it does not have.

    Only a 404 or 422 from GitHub marks a record gone. Any other error (gh missing, auth,
    network, a server error, output that is not JSON) stops the check without calling any
    record gone, so a failed check never leads anyone to prune a valid record.
    """
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
                if not _NOT_FOUND.search(str(e)):
                    raise
                print(f"gone: {d.id}: {e}")
                gone += 1
    except BuildError as e:
        print(f"build_corpus: stopped: {e}", file=sys.stderr)
        return 1
    return 1 if gone else 0


def _prune_owner_excess(out_root: Path) -> int:
    """Delete the records past PER_OWNER for each owner in out_root, keeping the smallest ids in plain string order.

    Removes <id>.json and the <id>/ directory of each record past the cap, printing
    `pruned: <id>` for each and a count at the end. Every record is read and every id
    checked before anything is deleted: a record that cannot be read, or whose id is not a
    plain name equal to its file name, stops the prune with nothing removed. A delete that
    fails stops the prune with exit 1, leaving that record's json so a second run retries it.
    """
    out_root = Path(out_root)

    def refuse(reason: str) -> int:
        print(f"build_corpus: refusing to prune: {reason}", file=sys.stderr)
        return 1

    groups: dict[str, list[str]] = {}
    if out_root.is_dir():
        for p in sorted(out_root.glob("*.json")):
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
                return refuse(f"cannot read {p.name}: {e}")
            if not isinstance(raw, dict):
                return refuse(f"{p.name} is not a record")
            ident = raw.get("id")
            if not isinstance(ident, str) or not _valid_id(ident) or ident != p.stem:
                return refuse(f"{p.name}: id {ident!r} is not a plain name equal to the file name")
            repo = raw.get("repo")
            if isinstance(repo, str) and _valid_repo(repo):
                groups.setdefault(_owner(repo), []).append(ident)
    doomed = sorted(ident for ids in groups.values() for ident in sorted(ids)[PER_OWNER:])
    root = out_root.resolve()
    isjunction = getattr(os.path, "isjunction", lambda path: False)
    for ident in doomed:
        for path in (out_root / f"{ident}.json", out_root / ident):
            if path.is_symlink() or isjunction(path) or path.resolve().parent != root:
                return refuse(f"{path.name} is a link or lies outside {out_root}")
    for ident in doomed:
        # The directory goes first and the json last, the reverse of write_record: a delete
        # that fails leaves the json in place, so running the prune again retries the record.
        try:
            tree = out_root / ident
            if tree.is_dir():
                shutil.rmtree(tree)
            (out_root / f"{ident}.json").unlink()
        except OSError as e:
            print(f"build_corpus: stopped pruning {ident}: {e}", file=sys.stderr)
            return 1
        print(f"pruned: {ident}")
    print(f"pruned {len(doomed)} records")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="build_corpus")
    p.add_argument("--out", default="corpus")
    p.add_argument("--target", type=int, help="stop once the corpus holds this many records (default 300)")
    p.add_argument("--trailer", action="append")
    p.add_argument("--repo")
    p.add_argument("--sha")
    p.add_argument("--check-gone", action="store_true",
                   help="list the git records in --out whose commit GitHub no longer serves, and exit 1 if any")
    p.add_argument("--via-repos", action="store_true",
                   help="find commits repository first: search licensed repositories, then list their commits")
    p.add_argument("--since", help="with --via-repos: repositories pushed and commits made on or after YYYY-MM-DD")
    p.add_argument("--language", action="append", choices=LANG_ORDER,
                   help="with --via-repos: a language to search for, repeatable (default all four)")
    p.add_argument("--language-target", type=int,
                   help="with --via-repos: stop accepting a language once the corpus holds this many records of it")
    p.add_argument("--commit-pages", type=int,
                   help="with --via-repos: pages of 100 commits to list per repository (default 1)")
    p.add_argument("--prune-owner-excess", action="store_true",
                   help=f"delete the records in --out past {PER_OWNER} per owner, keeping the smallest ids")
    a = p.parse_args(argv)
    if a.prune_owner_excess:
        if (a.target is not None or a.trailer or a.repo or a.sha or a.check_gone or a.via_repos or a.since
                or a.language or a.language_target is not None or a.commit_pages is not None):
            p.error("--prune-owner-excess goes with --out only")
        return _prune_owner_excess(Path(a.out))
    if a.target is None:
        a.target = 300
    if a.via_repos:
        if a.repo or a.sha or a.check_gone or a.trailer:
            p.error("--via-repos does not go with --repo, --sha, --check-gone or --trailer")
        if not a.since:
            p.error("--via-repos needs --since YYYY-MM-DD")
        try:
            if not _DATE.fullmatch(a.since):
                raise ValueError(a.since)
            datetime.date.fromisoformat(a.since)
        except ValueError:
            p.error(f"--since must be a date YYYY-MM-DD, got {a.since!r}")
        if a.language_target is not None and a.language_target < 0:
            p.error("--language-target must be 0 or more")
        if a.commit_pages is None:
            a.commit_pages = 1
        elif a.commit_pages < 1:
            p.error("--commit-pages must be 1 or more")
        return _via_repos(GitHub(), Path(a.out), a)
    if a.since or a.language or a.language_target is not None or a.commit_pages is not None:
        p.error("--since, --language, --language-target and --commit-pages go with --via-repos")
    if a.check_gone:
        return _check_gone(GitHub(), Path(a.out))
    if bool(a.repo) != bool(a.sha):
        p.error("--repo and --sha go together")
    out = Path(a.out)
    gh = GitHub()
    if a.repo:
        if not _valid_repo(a.repo) or not _SHA.fullmatch(a.sha):
            print(f"build_corpus: --repo must be owner/name and --sha 7 to 40 hex characters, got {a.repo!r} {a.sha!r}",
                  file=sys.stderr)
            return 1
        try:
            commit = gh.get(f"repos/{a.repo}/commits/{a.sha}")
            if not isinstance(commit, dict) or not isinstance(commit.get("sha"), str) or not isinstance(commit.get("parents"), list):
                raise BuildError(f"GET repos/{a.repo}/commits/{a.sha}: not a commit object")
            existing = _existing(out)
            recorded = [ident for ident, (_, sha) in existing.items() if sha == commit["sha"]]
            if recorded:
                # Deduped on the full sha: the same commit under another spelling of its repository name.
                print(out / f"{recorded[0]}.json")
                return 0
            item = {"sha": commit["sha"], "repository": {"full_name": a.repo}, "parents": commit["parents"]}
            owners = dict(Counter(_owner(repo) for repo, _ in existing.values() if repo))
            got = accept(gh, item, {}, owners=owners)
            if got is None:
                return 1
            print(write_record(out, *got))
        except (BuildError, OSError) as e:
            print(f"build_corpus: {e}", file=sys.stderr)
            return 1
        except (KeyError, TypeError, IndexError) as e:
            print(f"build_corpus: unexpected GitHub response for {a.repo}@{a.sha}: {e!r}", file=sys.stderr)
            return 1
        return 0
    existing = _existing(out)
    # Deduped on the full commit sha, never on the id: a renamed repository gives one commit a second name.
    done = {sha for _, sha in existing.values() if sha}
    seen: dict[str, int] = dict(Counter(repo.lower() for repo, _ in existing.values() if repo))
    total = len(existing)
    written = 0
    failed_searches = 0
    try:
        for trailer in a.trailer or TRAILERS:
            if total >= a.target:
                break
            try:
                items = candidates(gh, trailer)
            except RateLimitError:
                raise
            except BuildError as e:
                # One failed search (a network error, a 422) must not end a long build: log it, try the next trailer.
                print(f"build_corpus: search for {trailer!r} failed: {e}", file=sys.stderr)
                failed_searches += 1
                continue
            for item in items:
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
    return 1 if failed_searches else 0


if __name__ == "__main__":
    sys.exit(main())
