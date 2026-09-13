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


def test_accept_rejects_a_private_or_internal_repository_before_fetching_the_commit(capsys):
    repo = load("repo.json")
    for meta in (dict(repo, private=True, visibility="private"), dict(repo, private=False, visibility="internal"),
                 dict(repo, private=True), {k: v for k, v in repo.items() if k not in ("private", "visibility")}):
        seen = {}
        gh = FakeGitHub({f"repos/{REPO}": meta})
        assert accept(gh, first_item(), seen_repos=seen) is None
        assert seen == {}
        assert gh.calls == [f"repos/{REPO}"]
    assert "not public" in capsys.readouterr().err


def test_main_refuses_one_named_commit_from_a_private_repository(tmp_path, monkeypatch):
    out = tmp_path / "corpus"
    private = dict(load("repo.json"), private=True, visibility="private")
    monkeypatch.setattr(bc, "GitHub", lambda: FakeGitHub({f"repos/{REPO}": private}))
    assert bc.main(["--out", str(out), "--repo", REPO, "--sha", SHA]) == 1
    assert not out.exists() or not any(out.iterdir())


NOT_PORTABLE = [
    "src/a:b.ts",
    "src/aux.ts",
    "src/AUX",
    "lib/com1.js",
    "Lpt9.d/x.py",
    "src/nul.tar.ts",
    "src/con .ts",
    "src/x /a.ts",
    "src/x./a.ts",
    "src/a.ts ",
    "src/a?.ts",
    'src/a".ts',
    "src/a<b>.ts",
    "src/a|b.ts",
    "src/a*.ts",
    "src/a\tb.ts",
]


@pytest.mark.parametrize("name", NOT_PORTABLE)
def test_portable_path_rejects_names_windows_cannot_hold(name):
    assert bc._portable_problem([name]) is not None


def test_portable_path_accepts_ordinary_names_and_flags_case_collisions():
    assert bc._portable_problem(["src/auxiliary.ts", "src/console.ts", "src/com10.ts", "a/.eslintrc.js",
                                 "src/x.y/z.ts", "src/My File.ts"]) is None
    assert bc._portable_problem(["src/A.ts", "src/a.ts"]) is not None
    assert bc._portable_problem(["src/Lib.ts", "src/lib.ts/index.ts"]) is not None
    assert bc._portable_problem(["Src/a.ts", "src/b.ts"]) is None


@pytest.mark.parametrize("name", ["src/a:b.ts", "src/aux.ts", "src/x /a.ts"])
def test_accept_skips_a_path_windows_cannot_hold_before_fetching_anything(name, capsys):
    files = [{"filename": "src/ok.ts", "status": "modified"}, {"filename": name, "status": "modified"}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    seen = {}
    assert accept(gh, first_item(), seen_repos=seen) is None
    assert seen == {}
    assert not [c for c in gh.calls if "/contents/" in c]
    assert "not portable" in capsys.readouterr().err


def test_accept_skips_paths_that_collide_when_case_is_ignored_on_one_side():
    files = [{"filename": "src/Util.ts", "status": "added"}, {"filename": "src/util.ts", "status": "modified"}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    assert accept(gh, first_item(), seen_repos={}) is None
    assert not [c for c in gh.calls if "/contents/" in c]
    # A case-only rename puts one name on each side, which is fine.
    renamed = [{"filename": "src/util.ts", "status": "renamed", "previous_filename": "src/Util.ts"},
               {"filename": "src/main.ts", "status": "modified"}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(renamed)})
    rec, before, after = accept(gh, first_item(), seen_repos={})
    assert set(before) == {"src/Util.ts", "src/main.ts"} and set(after) == {"src/util.ts", "src/main.ts"}


@pytest.mark.parametrize("name", ["src/a:b.ts", "src/aux.ts", "src/x /a.ts"])
def test_write_record_rejects_a_path_windows_cannot_hold_before_touching_disk(tmp_path, name):
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    stale = tmp_path / rec["id"] / "after" / "stale.ts"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"left by an interrupted build")
    with pytest.raises(BuildError):
        write_record(tmp_path, rec, before, dict(after, **{name: b"x\n"}))
    assert stale.exists()
    assert not (tmp_path / f"{rec['id']}.json").exists()
    with pytest.raises(BuildError):
        write_record(tmp_path, rec, {"src/A.ts": b"1", "src/a.ts": b"2"}, after)
    assert stale.exists()


def test_write_record_removes_its_partial_tree_when_the_disk_refuses(tmp_path, monkeypatch):
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    real = Path.write_bytes

    def refuse(self, data):
        if self.parent.name == "commands" and "after" in self.parts:
            raise OSError("disk says no")
        return real(self, data)

    monkeypatch.setattr(Path, "write_bytes", refuse)
    with pytest.raises(OSError):
        write_record(tmp_path, rec, before, after)
    assert not (tmp_path / rec["id"]).exists()
    assert not (tmp_path / f"{rec['id']}.json").exists()


def test_main_logs_an_os_error_from_one_record_and_carries_on(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    rec, _, _ = accept(FakeGitHub(), first_item(), seen_repos={})
    items = [item_for("a/bad", "1" * 40), item_for("a/good", "2" * 40)]
    tried = []
    real_write = bc.write_record

    def fake_accept(gh, item, seen_repos):
        repo, sha = item["repository"]["full_name"], item["sha"]
        tried.append(repo)
        return dict(rec, id=f"{repo.replace('/', '__')}__{sha[:7]}", repo=repo, sha=sha), {}, {FILE: b"x"}

    def flaky_write(out_root, r, before, after):
        if r["repo"] == "a/bad":
            raise FileNotFoundError(2, "The system cannot find the path specified")
        return real_write(out_root, r, before, after)

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates", lambda gh, trailer, per_page=100, pages=3: items)
    monkeypatch.setattr(bc, "accept", fake_accept)
    monkeypatch.setattr(bc, "write_record", flaky_write)
    assert bc.main(["--out", str(out), "--target", "5", "--trailer", "A"]) == 0
    assert tried == ["a/bad", "a/good"]
    assert [p.name for p in out.glob("*.json")] == ["a__good__2222222.json"]
    err = capsys.readouterr().err
    assert "skip a/bad@1111111" in err and "cannot find the path" in err
    assert "wrote 1 records" in err

    monkeypatch.setattr(bc, "accept", lambda gh, item, seen_repos: fake_accept(gh, items[0], seen_repos))
    assert bc.main(["--out", str(tmp_path / "one"), "--repo", "a/bad", "--sha", "1" * 40]) == 1


def test_accept_stores_the_before_side_of_a_file_renamed_to_an_unsupported_name():
    # A .d.ts name is not a supported source file, but the old .ts name was, so its before copy is kept.
    files = [{"filename": "src/main.ts", "status": "modified"},
             {"filename": "src/types.d.ts", "status": "renamed", "previous_filename": "src/types.ts"}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    rec, before, after = accept(gh, first_item(), seen_repos={})
    assert rec["files"] == ["src/main.ts", "src/types.ts"]
    assert set(before) == {"src/main.ts", "src/types.ts"}
    assert set(after) == {"src/main.ts"}
    assert set(rec["files"]) == set(before) | set(after)


@pytest.mark.parametrize("old", ["src" + chr(92) + "x.ts", "src/a:b.ts", "src/../x.ts"])
def test_accept_checks_the_old_name_of_a_file_renamed_to_an_unsupported_name(old, capsys):
    files = [{"filename": "src/main.ts", "status": "modified"},
             {"filename": "src/x.txt", "status": "renamed", "previous_filename": old}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    seen = {}
    assert accept(gh, first_item(), seen_repos=seen) is None
    assert seen == {}
    assert not [c for c in gh.calls if "/contents/" in c]
    assert "skip" in capsys.readouterr().err


def test_accept_lists_a_renamed_then_re_added_name_once(tmp_path):
    files = [{"filename": "src/b.ts", "status": "renamed", "previous_filename": "src/a.ts"},
             {"filename": "src/a.ts", "status": "added"}]
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with(files)})
    rec, before, after = accept(gh, first_item(), seen_repos={})
    assert rec["files"] == ["src/a.ts", "src/b.ts"]
    assert set(before) == {"src/a.ts"}
    assert set(after) == {"src/b.ts", "src/a.ts"}
    write_record(tmp_path, rec, before, after)
    [loaded] = load_corpus(tmp_path)
    assert list(loaded.files) == ["src/a.ts", "src/b.ts"]


def test_check_gone_lists_records_whose_commit_github_no_longer_serves(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    other_sha = "1" * 40
    gone = dict(rec, id=f"acme__gone__{other_sha[:7]}", repo="acme/gone", sha=other_sha,
                url=f"https://github.com/acme/gone/commit/{other_sha}")
    write_record(out, gone, before, after)
    missing = BuildError("gh: Not Found (HTTP 404)")
    monkeypatch.setattr(bc, "GitHub", lambda: FakeGitHub({f"repos/acme/gone/commits/{other_sha}": missing}))
    assert bc.main(["--out", str(out), "--check-gone"]) == 1
    captured = capsys.readouterr()
    assert captured.out == "gone: acme__gone__1111111: gh: Not Found (HTTP 404)\n"
    assert "cline__cline" not in captured.out
    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    assert bc.main(["--out", str(out), "--check-gone"]) == 0


def test_accept_names_the_record_after_the_canonical_repository():
    # --repo as typed, or a search hit from before a rename: the record uses GitHub's own full_name.
    seen = {}
    rec, _, _ = accept(FakeGitHub(), item_for("Cline/Cline", SHA), seen_repos=seen)
    assert rec["repo"] == REPO and rec["id"] == "cline__cline__5ff11f2"
    assert rec["url"] == f"https://github.com/{REPO}/commit/{SHA}"
    assert seen == {REPO: 1}
    gh = FakeGitHub()
    accept(gh, item_for("Cline/Cline", SHA), seen_repos={})
    assert f"repos/{REPO}/commits/{SHA}" in gh.calls


def test_accept_caps_a_repository_whatever_case_or_old_name_the_item_carries():
    assert accept(FakeGitHub(), item_for("CLINE/cline", SHA), seen_repos={REPO: 3}) is None
    renamed = dict(load("repo.json"), full_name="cline/cline")
    gh = FakeGitHub({"repos/old-owner/old-name": renamed})
    assert accept(gh, item_for("old-owner/old-name", SHA), seen_repos={REPO: 3}) is None


def test_main_skips_a_commit_already_recorded_under_another_name(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    accepted = []

    def fake_accept(gh, item, seen_repos):
        accepted.append(item["repository"]["full_name"])
        return None

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates",
                        lambda gh, trailer, per_page=100, pages=3: [item_for("old-owner/old-name", SHA), item_for("Cline/Cline", SHA)])
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--out", str(out), "--target", "5", "--trailer", "A"]) == 0
    assert accepted == []


def test_main_named_commit_already_recorded_writes_nothing_new(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    assert bc.main(["--out", str(out), "--repo", REPO, "--sha", SHA]) == 0
    assert bc.main(["--out", str(out), "--repo", "Cline/Cline", "--sha", SHA]) == 0
    assert sorted(p.name for p in out.glob("*.json")) == ["cline__cline__5ff11f2.json"]
    assert [d.id for d in load_corpus(out)] == ["cline__cline__5ff11f2"]


def test_main_seeds_the_repository_cap_case_insensitively(tmp_path, monkeypatch):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, dict(rec, repo="Cline/Cline", id="Cline__Cline__5ff11f2"), before, after)
    caps = []

    def fake_accept(gh, item, seen_repos):
        caps.append(dict(seen_repos))
        return None

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates", lambda gh, trailer, per_page=100, pages=3: [item_for(REPO, "3" * 40)])
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--out", str(out), "--target", "5", "--trailer", "A"]) == 0
    assert caps == [{REPO: 1}]


def _two_records(tmp_path):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    other_sha = "1" * 40
    other = dict(rec, id=f"acme__gone__{other_sha[:7]}", repo="acme/gone", sha=other_sha,
                 url=f"https://github.com/acme/gone/commit/{other_sha}")
    write_record(out, other, before, after)
    return out, f"repos/acme/gone/commits/{other_sha}"


def test_check_gone_calls_a_422_no_commit_found_gone(tmp_path, monkeypatch, capsys):
    out, path = _two_records(tmp_path)
    missing = BuildError(f"GET {path}: gh: No commit found for SHA: 1111111111111111111111111111111111111111 (HTTP 422)")
    monkeypatch.setattr(bc, "GitHub", lambda: FakeGitHub({path: missing}))
    assert bc.main(["--out", str(out), "--check-gone"]) == 1
    assert capsys.readouterr().out.startswith("gone: acme__gone__1111111: ")


@pytest.mark.parametrize("message", [
    "GET repos/acme/gone/commits/1111: cannot run gh: [WinError 2] The system cannot find the file specified",
    "GET repos/acme/gone/commits/1111: gh: error connecting to api.github.com",
    "GET repos/acme/gone/commits/1111: gh: Server Error (HTTP 502)",
    "GET repos/acme/gone/commits/1111: gh: Bad credentials (HTTP 401)",
    "GET repos/acme/gone/commits/1111: gh printed no JSON: Expecting value",
])
def test_check_gone_stops_without_calling_anything_gone_on_any_other_error(tmp_path, monkeypatch, capsys, message):
    out, path = _two_records(tmp_path)
    monkeypatch.setattr(bc, "GitHub", lambda: FakeGitHub({path: BuildError(message)}))
    assert bc.main(["--out", str(out), "--check-gone"]) == 1
    captured = capsys.readouterr()
    assert "gone:" not in captured.out
    assert f"build_corpus: stopped: {message}" in captured.err


def test_lf_turns_every_run_of_carriage_returns_before_a_newline_into_one_newline():
    assert bc._lf(b"x" + bytes([13, 13, 10]) + b"y" + bytes([13, 10]) + b"z" + bytes([10])) == b"x" + bytes([10]) + b"y" + bytes([10]) + b"z" + bytes([10])
    assert bc._lf(b"a" + bytes([13]) + b"b") == b"a" + bytes([13]) + b"b"


def test_main_logs_a_failed_search_moves_to_the_next_trailer_and_exits_one(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    searched = []

    def fake_candidates(gh, trailer, per_page=100, pages=3):
        searched.append(trailer)
        if trailer == "A":
            raise BuildError("GET search/commits: gh: error connecting to api.github.com")
        return []

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "candidates", fake_candidates)
    assert bc.main(["--out", str(out), "--trailer", "A", "--trailer", "B"]) == 1
    assert searched == ["A", "B"]
    err = capsys.readouterr().err
    assert "error connecting to api.github.com" in err
    assert "wrote 0 records" in err


def test_write_record_refuses_an_id_that_is_not_a_valid_diff_id(tmp_path):
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    out = tmp_path / "a" / "inner"
    for bad in ("../../escaped__x__abcdef1", "..\\..\\escaped__x__abcdef1", "acme/w__1234567", "not-an-id"):
        with pytest.raises(BuildError, match="not a valid diff id"):
            write_record(out, dict(rec, id=bad), before, after)
    assert not any(tmp_path.rglob("escaped*"))
    assert not out.exists()


@pytest.mark.parametrize("repo, sha", [
    ("../etc", SHA), ("acme", SHA), ("acme/w/x", SHA), ("acme/w?x=1", SHA),
    (REPO, "zzz"), (REPO, "12345"), (REPO, SHA + "0"), (REPO, "../" + SHA),
])
def test_main_validates_repo_and_sha_before_calling_gh(tmp_path, monkeypatch, capsys, repo, sha):
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--out", str(tmp_path / "corpus"), "--repo", repo, "--sha", sha]) == 1
    assert gh.calls == []
    assert "build_corpus:" in capsys.readouterr().err


@pytest.mark.parametrize("response", [{}, {"sha": SHA}, {"sha": SHA, "parents": None}, [], "text"])
def test_main_named_commit_with_a_malformed_response_exits_one(tmp_path, monkeypatch, capsys, response):
    monkeypatch.setattr(bc, "GitHub", lambda: FakeGitHub({f"repos/{REPO}/commits/{SHA}": response}))
    assert bc.main(["--out", str(tmp_path / "corpus"), "--repo", REPO, "--sha", SHA]) == 1
    assert "build_corpus:" in capsys.readouterr().err
