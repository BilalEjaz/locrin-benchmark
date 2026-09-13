import base64
import json
import subprocess
from pathlib import Path

import pytest

import bench.build_corpus as bc
from bench.build_corpus import BuildError, GitHub, RateLimitError, accept, candidates, write_record
from bench.corpus import load_corpus

FX = Path(__file__).resolve().parent.parent / "fixtures" / "github"

# The captured commit: cline/cline, Apache-2.0, one modified TypeScript file.
REPO = "cline/cline"
SHA = "5ff11f2f86b8eb4e3083c5163fc23561e964190e"
PARENT = "4ddb43c56b16e1cc446a86ac6edcd0d9ff935b4a"
FILE = "sdk/apps/cli/src/commands/program.ts"


def load(name):
    return json.loads((FX / name).read_text(encoding="utf-8"))


class FakeGitHub:
    def __init__(self, overrides=None):
        self.calls = []
        self.overrides = overrides or {}

    def get(self, path, params=None, accept=None):
        self.calls.append(path)
        if path in self.overrides:
            value = self.overrides[path]
            if isinstance(value, Exception):
                raise value
            return value
        if path.startswith("search/commits"):
            return load("search.json")
        if "/contents/" in path:
            ref = (params or {}).get("ref", "")
            commit = load("commit.json")
            name = "contents_before.json" if ref == commit["parents"][0]["sha"] else "contents_after.json"
            return load(name)
        if "/commits/" in path:
            return load("commit.json")
        if path.startswith("repos/"):
            return load("repo.json")
        raise AssertionError(path)


def first_item():
    return load("search.json")["items"][0]


def commit_with(files):
    return dict(load("commit.json"), files=files)


def test_candidates_queries_the_trailer(tmp_path):
    gh = FakeGitHub()
    items = candidates(gh, "Co-Authored-By: Claude", pages=1)
    assert items and gh.calls[0].startswith("search/commits")


def test_accept_builds_a_record_with_before_and_after(tmp_path):
    gh = FakeGitHub()
    rec, before, after = accept(gh, first_item(), seen_repos={})
    assert rec["source"] == "git" and rec["licence"] in {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
    assert rec["id"] == f"{rec['repo'].replace('/', '__')}__{rec['sha'][:7]}"
    assert rec["files"] and all("\\" not in f for f in rec["files"])
    assert set(after) <= set(rec["files"]) and set(before) <= set(rec["files"])
    path = write_record(tmp_path, rec, before, after)
    assert path.name == f"{rec['id']}.json"
    assert load_corpus(tmp_path)[0].id == rec["id"]


def test_accept_reads_the_captured_commit():
    seen = {}
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos=seen)
    assert rec == {
        "id": "cline__cline__5ff11f2",
        "source": "git",
        "repo": REPO,
        "sha": SHA,
        "parent": PARENT,
        "licence": "Apache-2.0",
        "language": "typescript",
        "url": f"https://github.com/{REPO}/commit/{SHA}",
        "files": [FILE],
    }
    assert set(before) == {FILE} and set(after) == {FILE}
    assert len(before[FILE]) == 8551 and len(after[FILE]) == 8672
    assert b"apiKey" in after[FILE] and before[FILE] != after[FILE]
    assert seen == {REPO: 1}


def test_accept_rejects_bad_licence_merge_commits_and_repo_cap():
    repo = json.loads((FX / "repo.json").read_text(encoding="utf-8"))
    bad = dict(repo, license={"spdx_id": "GPL-3.0"})
    gh = FakeGitHub({f"repos/{repo['full_name']}": bad})
    assert accept(gh, first_item(), seen_repos={}) is None
    item = first_item()
    item["parents"] = item["parents"] + item["parents"]
    assert accept(FakeGitHub(), item, seen_repos={}) is None
    assert accept(FakeGitHub(), first_item(), seen_repos={repo["full_name"]: 3}) is None


def test_accept_rejects_forks_archives_file_counts_and_unsupported_commits():
    repo = load("repo.json")
    for meta in (dict(repo, fork=True), dict(repo, archived=True), dict(repo, license=None)):
        assert accept(FakeGitHub({f"repos/{REPO}": meta}), first_item(), seen_repos={}) is None
    too_many = [{"filename": f"src/f{i}.ts", "status": "modified"} for i in range(31)]
    docs_only = [{"filename": "README.md", "status": "modified"}, {"filename": "types.d.ts", "status": "modified"}]
    removed_only = [{"filename": "src/gone.ts", "status": "removed"}]
    for files in ([], too_many, docs_only, removed_only):
        seen = {}
        gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
        assert accept(gh, first_item(), seen_repos=seen) is None
        assert seen == {}


def test_accept_rejects_a_supported_file_over_200_kb_or_unreadable():
    big = dict(load("contents_after.json"), size=200_001, content=base64.b64encode(b"x" * 200_001).decode())
    too_big_for_api = dict(load("contents_after.json"), encoding="none", content="")
    path = f"repos/{REPO}/contents/{FILE}"
    for doc in (big, too_big_for_api, BuildError("GET: gh: Not Found (HTTP 404)")):
        assert accept(FakeGitHub({path: doc}), first_item(), seen_repos={}) is None


def test_accept_rate_limit_propagates():
    gh = FakeGitHub({f"repos/{REPO}/contents/{FILE}": RateLimitError("rate limit")})
    with pytest.raises(RateLimitError):
        accept(gh, first_item(), seen_repos={})


def test_accept_fetches_by_status_and_picks_the_majority_language():
    files = [
        {"filename": "src/new.py", "status": "added"},
        {"filename": "src/old.py", "status": "removed"},
        {"filename": "src/b.py", "status": "modified"},
        {"filename": "src/view.tsx", "status": "modified"},
        {"filename": "src/c.ts", "status": "renamed", "previous_filename": "src/was.ts"},
        {"filename": "README.md", "status": "modified"},
    ]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    rec, before, after = accept(gh, first_item(), seen_repos={})
    # python has two added or modified files; tsx counts as typescript and has one.
    assert rec["language"] == "python"
    assert rec["files"] == ["src/new.py", "src/old.py", "src/b.py", "src/view.tsx", "src/was.ts", "src/c.ts"]
    assert set(before) == {"src/old.py", "src/b.py", "src/view.tsx", "src/was.ts"}
    assert set(after) == {"src/new.py", "src/b.py", "src/view.tsx", "src/c.ts"}
    fetched = [c for c in gh.calls if "/contents/" in c]
    assert f"repos/{REPO}/contents/README.md" not in fetched
    assert f"repos/{REPO}/contents/src/was.ts" in fetched


def test_language_ties_follow_typescript_javascript_php_python():
    files = [
        {"filename": "a.py", "status": "modified"},
        {"filename": "b.php", "status": "modified"},
        {"filename": "c.jsx", "status": "added"},
        {"filename": "d.tsx", "status": "modified"},
    ]
    assert bc._corpus_language(files) == "typescript"
    assert bc._corpus_language(files[:3]) == "javascript"
    assert bc._corpus_language(files[:2]) == "php"


def test_write_record_is_idempotent(tmp_path):
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(tmp_path, rec, before, after)
    stamp = (tmp_path / f"{rec['id']}.json").stat().st_mtime_ns
    write_record(tmp_path, rec, before, after)
    assert (tmp_path / f"{rec['id']}.json").stat().st_mtime_ns == stamp


def test_write_record_stores_lf_and_rejects_unsafe_paths(tmp_path):
    rec, _, _ = accept(FakeGitHub(), first_item(), seen_repos={})
    crlf = bytes([13, 10])
    write_record(tmp_path, rec, {FILE: b"a" + crlf + b"b" + crlf}, {FILE: b"a\nb\n"})
    assert (tmp_path / rec["id"] / "before" / FILE).read_bytes() == b"a\nb\n"
    assert (tmp_path / rec["id"] / "after" / FILE).read_bytes() == b"a\nb\n"
    assert crlf not in (tmp_path / f"{rec['id']}.json").read_bytes()
    bad = dict(rec, id="cline__cline__0000000", files=["../escape.ts"])
    with pytest.raises(BuildError):
        write_record(tmp_path, bad, {}, {"../escape.ts": b"x"})
    assert not (tmp_path / "escape.ts").exists() and not (tmp_path / "cline__cline__0000000.json").exists()


def test_write_record_clears_a_half_written_record(tmp_path):
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    stale = tmp_path / rec["id"] / "after" / "stale.ts"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"left by an interrupted build")
    write_record(tmp_path, rec, before, after)
    assert not stale.exists()


class Completed:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def test_github_get_shells_out_to_gh_api_and_never_reads_a_token(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "token-value-must-not-appear")
    seen = []

    def fake_run(cmd, **kw):
        seen.append((cmd, kw))
        return Completed(stdout='{"items": []}')

    monkeypatch.setattr(bc.subprocess, "run", fake_run)
    doc = GitHub().get("search/commits", {"q": '"Co-Authored-By: Claude" is:public', "per_page": 100}, accept="application/x")
    assert doc == {"items": []}
    cmd, kw = seen[0]
    assert cmd == ["gh", "api", "--method", "GET", "search/commits", "-H", "Accept: application/x",
                   "-f", 'q="Co-Authored-By: Claude" is:public', "-f", "per_page=100"]
    assert "token-value-must-not-appear" not in " ".join(cmd)
    assert "env" not in kw and kw["stdin"] is subprocess.DEVNULL
    assert GitHub().get("repos/a/b") == {"items": []}
    assert seen[1][0] == ["gh", "api", "--method", "GET", "repos/a/b", "-H", "Accept: application/vnd.github+json"]


def test_github_get_sleeps_once_on_a_rate_limit_then_raises(monkeypatch):
    limited = "gh: You have exceeded a secondary rate limit. Please wait a few minutes. (HTTP 403)"
    outcomes = [Completed(1, "{}", limited), Completed(0, '{"ok": true}')]
    sleeps = []
    monkeypatch.setattr(bc.subprocess, "run", lambda cmd, **kw: outcomes.pop(0))
    monkeypatch.setattr(bc.time, "sleep", sleeps.append)
    assert GitHub().get("repos/a/b") == {"ok": True}
    assert sleeps == [60]

    outcomes[:] = [Completed(1, "{}", "gh: API rate limit exceeded (HTTP 403)")] * 2
    with pytest.raises(RateLimitError, match="repos/a/b"):
        GitHub().get("repos/a/b")
    assert sleeps == [60, 60]


def test_github_get_raises_build_error_on_failure_bad_json_or_missing_gh(monkeypatch):
    sleeps = []
    monkeypatch.setattr(bc.time, "sleep", sleeps.append)
    monkeypatch.setattr(bc.subprocess, "run", lambda cmd, **kw: Completed(1, "{}", "gh: Not Found (HTTP 404)"))
    with pytest.raises(BuildError, match="Not Found") as err:
        GitHub().get("repos/a/b")
    assert not isinstance(err.value, RateLimitError) and sleeps == []
    monkeypatch.setattr(bc.subprocess, "run", lambda cmd, **kw: Completed(0, "not json"))
    with pytest.raises(BuildError, match="repos/a/b"):
        GitHub().get("repos/a/b")

    def missing(cmd, **kw):
        raise FileNotFoundError("gh")

    monkeypatch.setattr(bc.subprocess, "run", missing)
    with pytest.raises(BuildError, match="gh"):
        GitHub().get("repos/a/b")


def test_contents_path_is_quoted_for_gh():
    gh = FakeGitHub({"repos/a/b/contents/src/%7Bid%7D%20x.ts": {"encoding": "base64", "content": base64.b64encode(b"x").decode()}})
    assert bc._contents(gh, "a/b", "src/{id} x.ts", "main") == b"x"


def item_for(repo, sha):
    return {"sha": sha, "repository": {"full_name": repo}, "parents": [{"sha": PARENT}]}


def test_main_builds_to_the_target_skipping_duplicates_and_existing_records(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    other = "1" * 40
    third = "2" * 40
    fourth = "4" * 40
    accepted = []

    def fake_candidates(gh, trailer, per_page=100, pages=3):
        return [item_for(REPO, SHA), item_for("a/x", other), item_for("a/x", other), item_for("a/x", third), item_for("a/x", fourth)]

    def fake_accept(gh, item, seen_repos):
        accepted.append(item["sha"])
        repo, sha = item["repository"]["full_name"], item["sha"]
        seen_repos[repo] = seen_repos.get(repo, 0) + 1
        r = dict(rec, id=f"{repo.replace('/', '__')}__{sha[:7]}", repo=repo, sha=sha, url="u")
        return r, {}, {FILE: b"x"}

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates", fake_candidates)
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--out", str(out), "--target", "3", "--trailer", "A", "--trailer", "B"]) == 0
    # The existing record counts toward the target and is not fetched again, the duplicate is
    # skipped, and the build stops once the corpus holds three records.
    assert accepted == [other, third]
    assert sorted(p.name for p in out.glob("*.json")) == [
        "a__x__1111111.json", "a__x__2222222.json", "cline__cline__5ff11f2.json"]
    assert "wrote 2 records" in capsys.readouterr().err


def test_main_seeds_the_repository_cap_from_existing_records(tmp_path, monkeypatch):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    caps = []

    def fake_accept(gh, item, seen_repos):
        caps.append(dict(seen_repos))
        return None

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates", lambda gh, trailer, per_page=100, pages=3: [item_for(REPO, "3" * 40)])
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--out", str(out), "--target", "5", "--trailer", "A"]) == 0
    assert caps == [{REPO: 1}]


def test_main_stops_on_a_rate_limit_and_skips_other_errors(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    items = [item_for("a/x", "1" * 40), item_for("a/y", "2" * 40), item_for("a/z", "3" * 40)]
    tried = []

    def fake_accept(gh, item, seen_repos):
        tried.append(item["repository"]["full_name"])
        if item["repository"]["full_name"] == "a/x":
            raise BuildError("GET repos/a/x: gh: Not Found (HTTP 404)")
        raise RateLimitError("GET repos/a/y: rate limit")

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates", lambda gh, trailer, per_page=100, pages=3: items)
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--out", str(out), "--target", "5", "--trailer", "A"]) == 1
    assert tried == ["a/x", "a/y"]
    err = capsys.readouterr().err
    assert "Not Found" in err and "rate limit" in err


def test_main_accepts_one_named_commit(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    assert bc.main(["--out", str(out), "--repo", REPO, "--sha", SHA[:12]]) == 0
    assert [d.id for d in load_corpus(out)] == ["cline__cline__5ff11f2"]
    assert "cline__cline__5ff11f2.json" in capsys.readouterr().out

    bad = dict(load("repo.json"), license={"spdx_id": "GPL-3.0"})
    monkeypatch.setattr(bc, "GitHub", lambda: FakeGitHub({f"repos/{REPO}": bad}))
    assert bc.main(["--out", str(tmp_path / "other"), "--repo", REPO, "--sha", SHA]) == 1
    with pytest.raises(SystemExit):
        bc.main(["--out", str(out), "--repo", REPO])


def test_accept_skips_an_unsafe_path_before_fetching_anything():
    files = [{"filename": "src/../../escape.ts", "status": "modified"}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    assert accept(gh, first_item(), seen_repos={}) is None
    assert not [c for c in gh.calls if "/contents/" in c]
