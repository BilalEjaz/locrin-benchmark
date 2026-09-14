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
        self.requests = []
        self.overrides = overrides or {}

    def get(self, path, params=None, accept=None):
        self.calls.append(path)
        self.requests.append((path, dict(params or {})))
        if path in self.overrides:
            value = self.overrides[path]
            if isinstance(value, Exception):
                raise value
            return value
        if path.startswith("search/commits"):
            return load("search.json")
        if path.startswith("search/repositories"):
            return {"total_count": 1, "incomplete_results": False, "items": [load("repo.json")]}
        if path.endswith("/commits"):
            return load("commits_list.json")
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
    assert cmd == ["gh", "api", "--method", "GET", "--include", "search/commits", "-H", "Accept: application/x",
                   "-f", 'q="Co-Authored-By: Claude" is:public', "-f", "per_page=100"]
    assert "token-value-must-not-appear" not in " ".join(cmd)
    assert "env" not in kw and kw["stdin"] is subprocess.DEVNULL
    assert GitHub().get("repos/a/b") == {"items": []}
    assert seen[1][0] == ["gh", "api", "--method", "GET", "--include", "repos/a/b", "-H", "Accept: application/vnd.github+json"]


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


# Repository-first mode (--via-repos).

CRLF = "\r\n"


def response(status, body, headers=None):
    """What gh api --include prints: the status line, the headers, a blank line, then the body."""
    reason = {200: "OK", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests"}[status]
    lines = [f"HTTP/2.0 {status} {reason}"] + [f"{k}: {v}" for k, v in (headers or {}).items()]
    return CRLF.join(lines) + CRLF + CRLF + body


class Clock:
    """A monotonic clock that only moves when the code under test sleeps or the test moves it."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def paced_github(monkeypatch, outcomes, wall=2_000_000_000.0, rate_limit=None):
    clock = Clock()
    runs = []

    def fake_run(cmd, **kw):
        runs.append(cmd)
        if "rate_limit" in cmd:
            if isinstance(rate_limit, Completed):
                return rate_limit
            return Completed(0, response(200, json.dumps(rate_limit)))
        return outcomes.pop(0)

    def real_sleep(seconds):
        pytest.fail("slept through time.sleep, not the injected sleep")

    monkeypatch.setattr(bc.subprocess, "run", fake_run)
    monkeypatch.setattr(bc.time, "sleep", real_sleep)
    gh = GitHub(sleep=clock.sleep, clock=clock, wall=lambda: wall)
    return gh, clock, runs


OK = Completed(0, response(200, '{"ok": true}'))


@pytest.mark.parametrize("language, licence, expected", [
    ("typescript", "mit", "language:TypeScript license:mit pushed:>=2026-09-01 fork:false archived:false is:public"),
    ("javascript", "apache-2.0", "language:JavaScript license:apache-2.0 pushed:>=2026-09-01 fork:false archived:false is:public"),
    ("php", "bsd-3-clause", "language:PHP license:bsd-3-clause pushed:>=2026-09-01 fork:false archived:false is:public"),
    ("python", "isc", "language:Python license:isc pushed:>=2026-09-01 fork:false archived:false is:public"),
    ("python", "bsd-2-clause", "language:Python license:bsd-2-clause pushed:>=2026-09-01 fork:false archived:false is:public"),
])
def test_repo_query_names_the_github_language_licence_and_filters(language, licence, expected):
    assert bc.repo_query(language, licence, "2026-09-01") == expected


def test_licence_keys_and_github_language_names():
    assert bc.LICENCE_KEYS == ["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc"]
    assert bc.GITHUB_LANGUAGES == {"typescript": "TypeScript", "javascript": "JavaScript", "php": "PHP", "python": "Python"}
    assert bc.AGENTS == ["Claude", "Codex", "Copilot", "Cursor"]


def test_repositories_sorts_by_updated_and_pages_until_a_short_page_or_the_page_limit():
    captured = load("search_repositories.json")
    gh = FakeGitHub({"search/repositories": captured})
    got = list(bc.repositories(gh, "typescript", "apache-2.0", "2026-09-01", per_page=3, pages=2))
    assert [r["full_name"] for r in got[:3]] == ["cdk8s-team/cdk8s-aws-cdk", "verbara/Verbara.Platform.Web",
                                                 "full-stack-skills/stitch-skills"]
    assert len(got) == 6
    q = "language:TypeScript license:apache-2.0 pushed:>=2026-09-01 fork:false archived:false is:public"
    assert gh.requests == [
        ("search/repositories", {"q": q, "sort": "updated", "order": "desc", "per_page": 3, "page": 1}),
        ("search/repositories", {"q": q, "sort": "updated", "order": "desc", "per_page": 3, "page": 2}),
    ]
    gh = FakeGitHub({"search/repositories": captured})
    assert len(list(bc.repositories(gh, "typescript", "apache-2.0", "2026-09-01"))) == 3
    assert gh.requests == [("search/repositories", {"q": q, "sort": "updated", "order": "desc", "per_page": 100, "page": 1})]


def test_repositories_asks_for_at_most_ten_pages_of_one_hundred():
    full = {"items": [{"full_name": f"a/r{i}"} for i in range(100)]}
    gh = FakeGitHub({"search/repositories": full})
    assert len(list(bc.repositories(gh, "php", "mit", "2026-09-01"))) == 1000
    assert [params["page"] for _, params in gh.requests] == list(range(1, 11))


def test_repo_commits_lists_one_page_since_the_date_without_the_search_api():
    gh = FakeGitHub()
    got = bc.repo_commits(gh, REPO, "2026-03-01", per_page=4)
    assert [c["sha"][:7] for c in got] == ["5ff11f2", "4ddb43c", "979ef6b", "121aa93"]
    assert gh.requests == [(f"repos/{REPO}/commits", {"since": "2026-03-01T00:00:00Z", "per_page": 4, "page": 1})]
    gh = FakeGitHub()
    assert len(bc.repo_commits(gh, REPO, "2026-03-01", pages=2, per_page=4)) == 8
    assert [params["page"] for _, params in gh.requests] == [1, 2]
    gh = FakeGitHub()
    assert len(bc.repo_commits(gh, REPO, "2026-03-01", pages=3)) == 4
    assert [params for _, params in gh.requests] == [{"since": "2026-03-01T00:00:00Z", "per_page": 100, "page": 1}]


@pytest.mark.parametrize("message, agent", [
    ("Fix\n\nCo-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>", "Copilot"),
    ("Fix\n\nco-authored-by: Cursor Agent <cursoragent@cursor.com>", "Cursor"),
    ("Fix\n\nCO-AUTHORED-BY: codex <codex@openai.com>", "Codex"),
    ("Fix\r\n\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n", "Claude"),
    ("Fix\n\nSigned-off-by: A Person <a@example.com>\nCo-authored-by: GitHub Copilot <copilot@github.com>", "Copilot"),
    ("Fix\n\nCo-authored-by: Jane Doe <jane@example.com>\nCo-authored-by: claude[bot] <bot@example.com>", "Claude"),
])
def test_agent_trailer_finds_an_agent_named_in_a_co_authored_by_line(message, agent):
    assert bc.agent_trailer(message) == agent


@pytest.mark.parametrize("message", [
    "Add browser exports for the shared package",
    "Fix\n\nCo-authored-by: Jane Doe <jane@example.com>",
    "Ask Claude to review the parser\n\nCo-authored-by: Jane Doe <jane@example.com>",
    "Fix\n\nSigned-off-by: Claude <noreply@anthropic.com>",
    "Fix, see the note: Co-authored-by: Claude <noreply@anthropic.com>",
    "Fix\n\nCo-authored-by: Claudette Roy <claudette@example.com>",
    "Fix\n\nCo-authored-by: Jane Doe <claude@example.com>",
    "",
])
def test_agent_trailer_ignores_humans_and_agents_outside_a_trailer_line(message):
    assert bc.agent_trailer(message) is None


def test_agent_trailer_matches_the_captured_commit_list():
    got = [bc.agent_trailer(c["commit"]["message"]) for c in load("commits_list.json")]
    assert got == ["Claude", "Claude", "Claude", None]


def test_github_get_paces_search_calls_three_seconds_apart_and_other_calls_half_a_second(monkeypatch):
    gh, clock, runs = paced_github(monkeypatch, [OK] * 7)
    gh.get("search/repositories")
    gh.get("search/repositories")
    clock.now += 1.0
    gh.get("search/repositories")
    gh.get("repos/a/b")
    gh.get("repos/a/b/commits")
    clock.now += 2.0
    gh.get("repos/a/b")
    gh.get("search/repositories")
    # Search and other calls are paced apart from each other: the last search call ran 2.5 seconds earlier.
    assert clock.sleeps == [pytest.approx(3.0), pytest.approx(2.0), pytest.approx(0.5), pytest.approx(0.5)]


def test_github_get_parses_the_body_after_the_included_headers(monkeypatch):
    gh, _, _ = paced_github(monkeypatch, [Completed(0, response(200, '{"items": [1]}', {"X-RateLimit-Remaining": "9"}))])
    assert gh.get("search/repositories") == {"items": [1]}


SECONDARY = "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)"


def test_secondary_rate_limit_waits_at_least_120_seconds_or_the_retry_after_then_retries(monkeypatch):
    body = '{"message": "You have exceeded a secondary rate limit."}'
    outcomes = [
        Completed(1, response(403, body), SECONDARY),
        Completed(1, response(403, body, {"Retry-After": "300"}), SECONDARY),
        Completed(1, response(429, body), "gh: You have exceeded a secondary rate limit (HTTP 429)"),
        OK,
    ]
    gh, clock, runs = paced_github(monkeypatch, outcomes)
    assert gh.get("search/repositories") == {"ok": True}
    assert clock.sleeps == [120, 300, 120]
    assert len(runs) == 4


def test_any_retry_after_counts_as_a_secondary_limit(monkeypatch):
    outcomes = [Completed(1, response(403, '{"message": "Forbidden"}', {"retry-after": "7"}), "gh: Forbidden (HTTP 403)"), OK]
    gh, clock, _ = paced_github(monkeypatch, outcomes)
    assert gh.get("repos/a/b") == {"ok": True}
    assert clock.sleeps == [120]


def test_secondary_rate_limit_raises_after_three_retries(monkeypatch):
    outcomes = [Completed(1, response(403, "{}"), SECONDARY)] * 4
    gh, clock, runs = paced_github(monkeypatch, outcomes)
    with pytest.raises(RateLimitError, match="repos/a/b"):
        gh.get("repos/a/b")
    assert clock.sleeps == [120, 120, 120]
    assert len(runs) == 4


def test_a_header_that_only_lists_retry_after_is_not_a_rate_limit(monkeypatch):
    headers = {"Access-Control-Expose-Headers": "ETag, Link, Location, Retry-After, X-RateLimit-Reset"}
    outcomes = [Completed(1, response(404, '{"message": "Not Found"}', headers), "gh: Not Found (HTTP 404)")]
    gh, clock, _ = paced_github(monkeypatch, outcomes)
    with pytest.raises(BuildError, match="Not Found") as err:
        gh.get("repos/a/b")
    assert not isinstance(err.value, RateLimitError) and clock.sleeps == []


PRIMARY = "gh: API rate limit exceeded for user ID 1. (HTTP 403)"


def limits(core_reset, search_reset):
    return {"resources": {"core": {"limit": 5000, "remaining": 0, "reset": core_reset},
                          "search": {"limit": 30, "remaining": 0, "reset": search_reset}}}


def test_primary_rate_limit_sleeps_until_the_reset_gh_reports_then_retries(monkeypatch):
    wall = 2_000_000_000.0
    outcomes = [Completed(1, response(403, "{}"), PRIMARY), OK, Completed(1, response(403, "{}"), PRIMARY), OK]
    gh, clock, runs = paced_github(monkeypatch, outcomes, wall=wall, rate_limit=limits(int(wall) + 600, int(wall) + 40))
    assert gh.get("repos/a/b") == {"ok": True}
    assert clock.sleeps == [600 + bc.RESET_SLACK]
    assert gh.get("search/repositories") == {"ok": True}
    assert clock.sleeps == [600 + bc.RESET_SLACK, 40 + bc.RESET_SLACK]
    assert sum("rate_limit" in cmd for cmd in runs) == 2


def test_primary_rate_limit_raises_when_the_reset_is_more_than_65_minutes_away(monkeypatch):
    wall = 2_000_000_000.0
    gh, clock, _ = paced_github(monkeypatch, [Completed(1, response(403, "{}"), PRIMARY)], wall=wall,
                                rate_limit=limits(int(wall) + 66 * 60, int(wall)))
    with pytest.raises(RateLimitError, match="repos/a/b"):
        gh.get("repos/a/b")
    assert clock.sleeps == []


def test_primary_rate_limit_raises_after_three_retries_or_when_gh_cannot_read_the_reset(monkeypatch):
    wall = 2_000_000_000.0
    gh, clock, runs = paced_github(monkeypatch, [Completed(1, response(403, "{}"), PRIMARY)] * 4, wall=wall,
                                   rate_limit=limits(int(wall) + 60, int(wall)))
    with pytest.raises(RateLimitError):
        gh.get("repos/a/b")
    assert clock.sleeps == [60 + bc.RESET_SLACK] * 3
    gh, clock, _ = paced_github(monkeypatch, [Completed(1, response(403, "{}"), PRIMARY)], wall=wall,
                                rate_limit=Completed(1, "", "gh: error connecting to api.github.com"))
    with pytest.raises(RateLimitError):
        gh.get("repos/a/b")
    assert clock.sleeps == []


def test_main_via_repos_writes_records_that_load_corpus_accepts(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    commits = load("commits_list.json")
    gh = FakeGitHub({
        f"repos/{REPO}/commits/{commits[1]['sha']}": commit_with([{"filename": "README.md", "status": "modified"}]),
        f"repos/{REPO}/commits/{commits[2]['sha']}": commit_with([]),
    })
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out)]) == 0
    assert [d.id for d in load_corpus(out)] == ["cline__cline__5ff11f2"]
    searches = [params for path, params in gh.requests if path == "search/repositories"]
    assert [params["q"].split(" ")[:2] for params in searches[:6]] == [
        ["language:TypeScript", "license:mit"], ["language:TypeScript", "license:apache-2.0"],
        ["language:TypeScript", "license:bsd-2-clause"], ["language:TypeScript", "license:bsd-3-clause"],
        ["language:TypeScript", "license:isc"], ["language:JavaScript", "license:mit"]]
    assert len(searches) == 20
    # The repository turns up in every query but is examined once, through the commits API, never search/commits.
    assert gh.calls.count(f"repos/{REPO}/commits") == 1
    assert not any(p.startswith("search/commits") for p in gh.calls)
    # The fourth commit carries no agent trailer and is never fetched.
    assert f"repos/{REPO}/commits/{commits[3]['sha']}" not in gh.calls
    err = capsys.readouterr().err
    assert f"repo {REPO}: 4 commits, 3 matched, 1 accepted" in err
    assert "wrote 1 records" in err
    assert "typescript 1, javascript 0, php 0, python 0" in err
    assert "no supported source file 1" in err and "file count 1" in err


def test_main_via_repos_skips_commits_already_recorded_and_repositories_at_the_cap(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    tried = []

    def fake_accept(gh, item, seen_repos, **kwargs):
        tried.append(item["sha"][:7])
        return None

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript"]) == 0
    assert tried == ["4ddb43c", "979ef6b"]
    for sha in ("a" * 40, "b" * 40):
        write_record(out, dict(rec, id=f"cline__cline__{sha[:7]}", sha=sha), before, after)
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    tried.clear()
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript"]) == 0
    assert tried == [] and f"repos/{REPO}/commits" not in gh.calls
    assert "repository cap" in capsys.readouterr().err


def fake_records(language_of_sha=None):
    accepted = []

    def fake_accept(gh, item, seen_repos, language_skip=None, meta_cache=None):
        repo, sha = item["repository"]["full_name"], item["sha"]
        accepted.append(sha[:7])
        language = (language_of_sha or {}).get(sha[:7], "typescript")
        # As accept() does: the language check comes before the repository cap counts the commit.
        reason = language_skip(language) if language_skip else None
        if reason:
            bc._skip(repo, sha, f"{reason}: {language}", reason)
            return None
        seen_repos[repo.lower()] = seen_repos.get(repo.lower(), 0) + 1
        rec = {"id": f"{repo.replace('/', '__')}__{sha[:7]}", "source": "git", "repo": repo, "sha": sha,
               "parent": PARENT, "licence": "Apache-2.0", "language": language,
               "url": f"https://github.com/{repo}/commit/{sha}", "files": [FILE]}
        return rec, {FILE: b"a\n"}, {FILE: b"b\n"}

    return accepted, fake_accept


def test_language_target_stops_accepting_a_language_once_the_corpus_holds_k_of_it(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    accepted, fake_accept = fake_records()
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript",
                    "--language-target", "2"]) == 0
    assert accepted == ["5ff11f2", "4ddb43c"]
    assert len(load_corpus(out)) == 2
    # Once typescript is full no further typescript query runs.
    assert [p for p in gh.calls if p.startswith("search/")] == ["search/repositories"]

    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    accepted.clear()
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript",
                    "--language", "python", "--language-target", "2"]) == 0
    assert gh.calls and all("language:TypeScript" not in params.get("q", "") for _, params in gh.requests)
    assert "language:Python" in gh.requests[0][1]["q"]
    # The python repository's commits came out as typescript records, and typescript is full.
    assert accepted == ["979ef6b"] and len(load_corpus(out)) == 2
    err = capsys.readouterr().err
    assert "typescript already holds 2 records" in err
    assert "language target 1" in err


def test_language_target_also_skips_a_record_whose_own_language_is_full_or_not_asked_for(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    accepted, fake_accept = fake_records({"5ff11f2": "python", "4ddb43c": "javascript", "979ef6b": "typescript"})
    written = []
    real_write = bc.write_record

    def spy_write(out_root, rec, before, after):
        written.append(rec["language"])
        return real_write(out_root, rec, before, after)

    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "accept", fake_accept)
    monkeypatch.setattr(bc, "write_record", spy_write)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript",
                    "--language", "javascript", "--language-target", "0"]) == 0
    assert written == [] and accepted == []
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript",
                    "--target", "5"]) == 0
    assert written == ["typescript"]
    err = capsys.readouterr().err
    assert "language not selected 2" in err


def test_main_via_repos_honours_the_total_target(tmp_path, monkeypatch):
    out = tmp_path / "corpus"
    accepted, fake_accept = fake_records()
    monkeypatch.setattr(bc, "GitHub", FakeGitHub)
    monkeypatch.setattr(bc, "accept", fake_accept)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--target", "1"]) == 0
    assert accepted == ["5ff11f2"]


def test_main_via_repos_stops_on_a_rate_limit_and_carries_on_after_other_errors(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    gh = FakeGitHub({"search/repositories": BuildError("GET search/repositories: gh: Server Error (HTTP 502)")})
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "php"]) == 1
    assert len([p for p in gh.calls if p.startswith("search/")]) == 5
    assert "Server Error" in capsys.readouterr().err

    gh = FakeGitHub({f"repos/{REPO}/commits": BuildError("GET: gh: Git Repository is empty. (HTTP 409)")})
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "php"]) == 0
    assert "commits unreadable 1" in capsys.readouterr().err

    gh = FakeGitHub({f"repos/{REPO}/commits": RateLimitError("GET repos/cline/cline/commits: rate limit")})
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out)]) == 1
    err = capsys.readouterr().err
    assert "build_corpus: stopped:" in err and "wrote 0 records" in err
    assert len([p for p in gh.calls if p.startswith("search/")]) == 1


@pytest.mark.parametrize("argv", [
    ["--via-repos"],
    ["--via-repos", "--since", "2026-13-01"],
    ["--via-repos", "--since", "01/09/2026"],
    ["--since", "2026-09-01"],
    ["--language", "php"],
    ["--via-repos", "--since", "2026-09-01", "--language", "ruby"],
    ["--via-repos", "--since", "2026-09-01", "--language-target", "-1"],
    ["--via-repos", "--since", "2026-09-01", "--commit-pages", "0"],
    ["--via-repos", "--since", "2026-09-01", "--repo", REPO, "--sha", SHA],
    ["--via-repos", "--since", "2026-09-01", "--trailer", "Co-authored-by: Codex"],
])
def test_main_via_repos_validates_its_options_before_calling_gh(tmp_path, monkeypatch, argv):
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    with pytest.raises(SystemExit) as err:
        bc.main(["--out", str(tmp_path / "corpus"), *argv])
    assert err.value.code == 2 and gh.calls == []


def test_main_via_repos_passes_commit_pages(tmp_path, monkeypatch):
    full = [dict(c, sha=f"{i:040x}") for i, c in enumerate(load("commits_list.json") * 25)]
    gh = FakeGitHub({f"repos/{REPO}/commits": full})
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    monkeypatch.setattr(bc, "accept", lambda gh, item, seen_repos, **kwargs: None)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(tmp_path / "c"), "--language", "php",
                    "--commit-pages", "2"]) == 0
    assert [params["page"] for path, params in gh.requests if path == f"repos/{REPO}/commits"] == [1, 2]


def mixed_commit():
    # Five JavaScript files and one PHP file: a JavaScript record, whatever repository search found it.
    return commit_with([{"filename": f"resources/js/c{i}.js", "status": "modified"} for i in range(5)]
                       + [{"filename": "app/Http/X.php", "status": "modified"}])


def test_accept_checks_the_language_before_fetching_any_file_or_counting_the_repository(capsys):
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": mixed_commit()})
    seen = {}
    asked = []

    def check(language):
        asked.append(language)
        return "language not selected"

    assert accept(gh, first_item(), seen, language_skip=check) is None
    assert asked == ["javascript"]
    assert seen == {} and not any("/contents/" in p for p in gh.calls)
    assert f"skip {REPO}@5ff11f2: language not selected: javascript" in capsys.readouterr().err
    assert bc.SKIPS["language not selected"] >= 1
    # A check that lets the language through changes nothing.
    rec, before, after = accept(FakeGitHub(), first_item(), seen, language_skip=lambda language: None)
    assert rec["language"] == "typescript" and seen == {REPO: 1}


def test_accept_reads_repository_metadata_once_per_repository_with_a_cache():
    gh = FakeGitHub({f"repos/{REPO}/commits/{SHA}": commit_with([])})
    cache = {}
    for _ in range(3):
        assert accept(gh, first_item(), {}, meta_cache=cache) is None
    assert gh.calls.count(f"repos/{REPO}") == 1


def test_main_via_repos_fetches_no_file_for_a_commit_in_a_language_not_selected(tmp_path, monkeypatch, capsys):
    commits = load("commits_list.json")
    gh = FakeGitHub({f"repos/{REPO}/commits/{c['sha']}": mixed_commit() for c in commits})
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(tmp_path / "c"), "--language", "php"]) == 0
    assert not any("/contents/" in p for p in gh.calls)
    # One metadata call for the repository, one detail call per matched commit, all three matched commits tried.
    assert gh.calls.count(f"repos/{REPO}") == 1
    assert sum(p.startswith(f"repos/{REPO}/commits/") for p in gh.calls) == 3
    err = capsys.readouterr().err
    assert "language not selected 3" in err and f"repo {REPO}: 4 commits, 3 matched, 0 accepted" in err


def test_main_via_repos_fetches_no_file_for_a_commit_whose_language_is_full(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    rec, before, after = accept(FakeGitHub(), first_item(), seen_repos={})
    write_record(out, rec, before, after)
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript",
                    "--language", "javascript", "--language-target", "1"]) == 0
    assert not any("/contents/" in p for p in gh.calls)
    assert sum(p.startswith(f"repos/{REPO}/commits/") for p in gh.calls) == 2
    assert gh.calls.count(f"repos/{REPO}") == 1
    assert len(load_corpus(out)) == 1
    assert "language target 2" in capsys.readouterr().err


# The owner cap: at most PER_OWNER records whose repository owner is the same, compared case-insensitively.

class OwnersGitHub(FakeGitHub):
    """FakeGitHub whose repository metadata names the repository asked for, so one owner can hold many."""

    def get(self, path, params=None, accept=None):
        parts = path.split("/")
        if len(parts) == 3 and parts[0] == "repos" and path not in self.overrides:
            self.calls.append(path)
            self.requests.append((path, dict(params or {})))
            return dict(load("repo.json"), full_name=f"{parts[1]}/{parts[2]}")
        return super().get(path, params, accept)


def put_record(out, repo, sha, language="typescript"):
    rec = {"id": f"{repo.replace('/', '__')}__{sha[:7]}", "source": "git", "repo": repo, "sha": sha,
           "parent": PARENT, "licence": "MIT", "language": language,
           "url": f"https://github.com/{repo}/commit/{sha}", "files": [FILE]}
    write_record(out, rec, {FILE: b"a\n"}, {FILE: b"b\n"})
    return rec["id"]


def hex_sha(n, i=0):
    return f"{n:x}{i:x}" * 20


def test_accept_caps_an_owner_at_six_records_case_insensitively_before_any_github_call(capsys):
    assert bc.PER_OWNER == 6
    gh = FakeGitHub()
    seen = {"cline/a": 3, "cline/b": 3}
    item = dict(first_item(), repository={"full_name": "CLINE/Cline"})
    assert accept(gh, item, seen) is None
    assert gh.calls == [] and seen == {"cline/a": 3, "cline/b": 3}
    assert "skip CLINE/Cline@5ff11f2: owner cap" in capsys.readouterr().err
    assert bc.SKIPS["owner cap"] >= 1
    # Five records from the owner leave room for one more, and the accepted record counts.
    seen = {"Cline/a": 3, "cline/b": 2}
    rec, _, _ = accept(FakeGitHub(), first_item(), seen)
    assert rec["repo"] == REPO and seen == {"Cline/a": 3, "cline/b": 2, REPO: 1}
    gh = FakeGitHub()
    assert accept(gh, dict(first_item(), sha="9" * 40), seen) is None
    assert gh.calls == []


def test_accept_caps_the_canonical_owner_of_a_renamed_repository_before_fetching_the_commit(capsys):
    gh = FakeGitHub()
    item = dict(first_item(), repository={"full_name": "old-owner/cline"})
    seen = {"cline/a": 3, "cline/b": 3}
    assert accept(gh, item, seen) is None
    assert gh.calls == ["repos/old-owner/cline"] and seen == {"cline/a": 3, "cline/b": 3}
    assert f"skip {REPO}@5ff11f2: owner cap" in capsys.readouterr().err


def test_accept_takes_owner_counts_when_given_and_counts_the_accepted_record():
    gh = FakeGitHub()
    assert accept(gh, first_item(), {}, owners={"cline": 6}) is None
    assert gh.calls == []
    owners = {"cline": 5}
    rec, _, _ = accept(FakeGitHub(), first_item(), {}, owners=owners)
    assert rec["repo"] == REPO and owners == {"cline": 6}


def test_main_trailer_search_counts_existing_records_toward_the_owner_cap(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    for n in range(6):
        put_record(out, f"Cline/r{n}", hex_sha(n))
    gh = OwnersGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    monkeypatch.setattr(bc, "candidates", lambda gh, trailer, per_page=100, pages=3: [item_for(REPO, SHA)])
    assert bc.main(["--out", str(out), "--target", "20", "--trailer", "A"]) == 0
    assert gh.calls == []
    err = capsys.readouterr().err
    assert "owner cap" in err and "wrote 0 records" in err
    assert len(list(out.glob("*.json"))) == 6


def test_main_trailer_search_stops_taking_an_owner_at_six_records(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    items = [item_for(f"cline/r{n}", hex_sha(n)) for n in range(8)]
    gh = OwnersGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    monkeypatch.setattr(bc, "candidates", lambda gh, trailer, per_page=100, pages=3: items)
    assert bc.main(["--out", str(out), "--target", "20", "--trailer", "A"]) == 0
    assert sorted(d.repo for d in load_corpus(out)) == [f"cline/r{n}" for n in range(6)]
    assert not any(p.startswith(("repos/cline/r6", "repos/cline/r7")) for p in gh.calls)
    err = capsys.readouterr().err
    assert "skip cline/r6@6060606: owner cap" in err and "wrote 6 records" in err


def owner_repos_github(names):
    commits = load("commits_list.json")
    overrides = {"search/repositories": {"total_count": len(names), "incomplete_results": False,
                                         "items": [dict(load("repo.json"), full_name=name) for name in names]}}
    for n, name in enumerate(names):
        overrides[f"repos/{name}/commits"] = [dict(c, sha=hex_sha(n, i)) for i, c in enumerate(commits)]
    return OwnersGitHub(overrides)


def test_main_via_repos_lists_no_further_repository_of_an_owner_at_the_cap(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    gh = owner_repos_github(["cline/r0", "Cline/r1", "CLINE/r2", "cline/r3"])
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript"]) == 0
    assert len(load_corpus(out)) == 6
    assert not any(p.startswith(("repos/CLINE/r2", "repos/cline/r3")) for p in gh.calls)
    err = capsys.readouterr().err
    assert "repo CLINE/r2: at the owner cap, commits not listed" in err
    assert "owner cap 2" in err


def test_main_via_repos_counts_existing_records_and_skips_before_any_contents_call(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    for n in range(5):
        put_record(out, f"CLINE/old{n}", hex_sha(n + 8))
    gh = owner_repos_github(["cline/r0"])
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript"]) == 0
    assert len(load_corpus(out)) == 6
    # One record fills the owner, so the next matched commit is never fetched.
    assert sum(p.startswith("repos/cline/r0/commits/") for p in gh.calls) == 1
    assert sum(p.startswith("repos/cline/r0/contents/") for p in gh.calls) == 2
    assert "repo cline/r0: 4 commits, 3 matched, 1 accepted" in capsys.readouterr().err

    gh = owner_repos_github(["cline/r1"])
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--via-repos", "--since", "2026-03-01", "--out", str(out), "--language", "typescript"]) == 0
    assert not any(p.startswith("repos/cline/r1") for p in gh.calls) and len(load_corpus(out)) == 6


def test_main_named_commit_counts_existing_records_toward_the_owner_cap(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    for n in range(6):
        put_record(out, f"Cline/r{n}", hex_sha(n))
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--out", str(out), "--repo", REPO, "--sha", SHA]) == 1
    assert gh.calls == [f"repos/{REPO}/commits/{SHA}"]
    assert "owner cap" in capsys.readouterr().err
    assert len(list(out.glob("*.json"))) == 6

    (out / "Cline__r5__5050505.json").unlink()
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    assert bc.main(["--out", str(out), "--repo", REPO, "--sha", SHA]) == 0
    assert (out / "cline__cline__5ff11f2.json").exists()


# --prune-owner-excess

OWNER_RECORDS = [("acme/one", 1), ("acme/one", 2), ("acme/one", 3), ("Acme/two", 4), ("Acme/two", 5),
                 ("Acme/two", 6), ("ACME/three", 7), ("ACME/three", 8), ("solo/x", 9), ("solo/y", 10)]


def owner_corpus(out, order=OWNER_RECORDS):
    return [put_record(out, repo, f"{n:x}" * 40) for repo, n in order]


def test_prune_owner_excess_keeps_the_smallest_ids_and_removes_json_and_directory(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    owner_corpus(out)
    monkeypatch.setattr(bc, "GitHub", lambda: pytest.fail("prune calls no GitHub"))
    assert bc.main(["--out", str(out), "--prune-owner-excess"]) == 0
    # Plain string order: upper case sorts before lower case.
    removed = ["acme__one__2222222", "acme__one__3333333"]
    assert capsys.readouterr().out.splitlines() == [f"pruned: {i}" for i in removed] + ["pruned 2 records"]
    for ident in removed:
        assert not (out / f"{ident}.json").exists() and not (out / ident).exists()
    kept = sorted(d.id for d in load_corpus(out))
    assert kept == ["ACME__three__7777777", "ACME__three__8888888", "Acme__two__4444444", "Acme__two__5555555",
                    "Acme__two__6666666", "acme__one__1111111", "solo__x__9999999", "solo__y__aaaaaaa"]
    assert all((out / ident / "after" / FILE).exists() for ident in kept)


def test_prune_owner_excess_is_idempotent_and_deterministic(tmp_path, capsys):
    first, second = tmp_path / "a", tmp_path / "b"
    owner_corpus(first)
    owner_corpus(second, list(reversed(OWNER_RECORDS)))
    assert bc.main(["--out", str(first), "--prune-owner-excess"]) == 0
    assert bc.main(["--out", str(second), "--prune-owner-excess"]) == 0
    capsys.readouterr()
    assert sorted(p.name for p in first.iterdir()) == sorted(p.name for p in second.iterdir())
    before = sorted(p.name for p in first.iterdir())
    assert bc.main(["--out", str(first), "--prune-owner-excess"]) == 0
    assert capsys.readouterr().out.splitlines() == ["pruned 0 records"]
    assert sorted(p.name for p in first.iterdir()) == before


@pytest.mark.parametrize("content", [
    {"id": "../escape", "repo": "acme/zzz"},
    {"id": "acme/zzz__9999999", "repo": "acme/zzz"},
    {"id": "acme__one__1111111", "repo": "acme/zzz"},
    {"id": 7, "repo": "acme/zzz"},
    "not json",
])
def test_prune_owner_excess_refuses_ids_that_are_not_plain_names_and_deletes_nothing(tmp_path, capsys, content):
    out = tmp_path / "corpus"
    owner_corpus(out)
    outside = tmp_path / "escape"
    outside.mkdir()
    (outside / "keep.txt").write_text("x")
    raw = content if isinstance(content, str) else json.dumps(dict(content, source="git"))
    (out / "acme__zzz__9999999.json").write_text(raw, encoding="utf-8")
    listing = sorted(p.name for p in out.iterdir())
    assert bc.main(["--out", str(out), "--prune-owner-excess"]) == 1
    assert "refusing to prune" in capsys.readouterr().err
    assert sorted(p.name for p in out.iterdir()) == listing
    assert (outside / "keep.txt").exists()


@pytest.mark.parametrize("argv", [
    ["--target", "5"],
    ["--trailer", "Co-authored-by: Codex"],
    ["--repo", REPO, "--sha", SHA],
    ["--check-gone"],
    ["--via-repos", "--since", "2026-09-01"],
    ["--since", "2026-09-01"],
    ["--language", "php"],
    ["--language-target", "3"],
    ["--commit-pages", "2"],
])
def test_prune_owner_excess_refuses_every_other_mode_flag(tmp_path, monkeypatch, argv):
    out = tmp_path / "corpus"
    owner_corpus(out)
    listing = sorted(p.name for p in out.iterdir())
    gh = FakeGitHub()
    monkeypatch.setattr(bc, "GitHub", lambda: gh)
    with pytest.raises(SystemExit) as err:
        bc.main(["--out", str(out), "--prune-owner-excess", *argv])
    assert err.value.code == 2 and gh.calls == []
    assert sorted(p.name for p in out.iterdir()) == listing


def test_prune_owner_excess_stops_on_a_failed_delete_keeping_the_json_so_a_rerun_finishes(tmp_path, monkeypatch, capsys):
    out = tmp_path / "corpus"
    owner_corpus(out)
    real_rmtree = bc.shutil.rmtree
    stuck = "acme__one__3333333"
    seen = []

    def failing_rmtree(path, *args, **kwargs):
        # The record's json is still there while its directory goes.
        seen.append((Path(path).name, (Path(path).parent / f"{Path(path).name}.json").exists()))
        if Path(path).name == stuck:
            raise PermissionError(13, "file is in use", str(path))
        return real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(bc.shutil, "rmtree", failing_rmtree)
    assert bc.main(["--out", str(out), "--prune-owner-excess"]) == 1
    captured = capsys.readouterr()
    assert seen == [("acme__one__2222222", True), (stuck, True)]
    assert captured.out.splitlines() == ["pruned: acme__one__2222222"]
    assert captured.err.startswith(f"build_corpus: stopped pruning {stuck}: ")
    assert "Traceback" not in captured.err
    assert not (out / "acme__one__2222222.json").exists() and not (out / "acme__one__2222222").exists()
    assert (out / f"{stuck}.json").exists() and (out / stuck).is_dir()

    monkeypatch.setattr(bc.shutil, "rmtree", real_rmtree)
    assert bc.main(["--out", str(out), "--prune-owner-excess"]) == 0
    assert capsys.readouterr().out.splitlines() == [f"pruned: {stuck}", "pruned 1 records"]
    assert not (out / f"{stuck}.json").exists() and not (out / stuck).exists()
