# locrin-benchmark

Precision and recall of every [Locrin](https://github.com/BilalEjaz/locrin) rule, measured on a public corpus of agent-written diffs from open-source projects, reproducible on any machine.

## Run it

    ./run.sh v0.5.0

That installs the named Locrin version, checks out every corpus diff, runs `locrin check --base` on each and `locrin check` on its parent (see How it scores), and writes `results/v0.5.0/`. It needs bash, git and Python 3.12. On Linux and macOS it installs Locrin into `.cache/bin/` with that release's own `install.sh`, which needs curl. `install.sh` does not run on Windows: there, put that Locrin version on `PATH` or set `LOCRIN_BIN` to its binary (`LOCRIN_BIN` works on every platform).

The first run clones the source repositories into `.cache/repos/`; later runs only fetch a commit a clone lacks. Git runs isolated from your machine's git configuration: no system or global config, template, hooks or credential helper, with long paths on. A proxy or CA bundle still reaches it through the environment (`HTTPS_PROXY`, `GIT_SSL_CAINFO`). Every checkout pins `.git/info/attributes` to turn off line-ending, ident and filter conversion, so each file holds exactly its committed bytes and git never lists a file the commit did not change; a checkout whose changed files still differ from the commit's fails that diff. Locrin runs with an empty home directory and an empty cache of its own, so a global gitignore or a git template on your machine cannot change the numbers. The run refuses to start when a `.ignore` file sits in the cache directory or any directory above it.

Only exit codes 0 and 3 publish, and only then is the README table rewritten. Both also need labels that cover the run: every diff that ran has a label file written for this Locrin version and confirmed by pass two with no entry left `?`, every finding has a label entry, every labelled finding is reported again by the run, and every missed entry names a construct at its commit. A new Locrin version is measured with its own labels, never with an older version's.

- 0: every diff ran.
- 3: at least one diff ran, and every diff that did not has a source that is confirmed gone: its repository answers HTTP 404, or GitHub reports the commit missing after an explicit fetch. `results/<version>/run.json` lists them under `gone` with that evidence.
- 1: nothing publishes. Locrin or the harness failed on a diff, a source could not be checked out for any other reason (a network, DNS, server, disk or path error), or no diff ran. The run still writes `results/<version>/`, with `"publishable": false`, so you can see why.
- 2: setup failed (no Locrin, a missing or empty corpus, a bad label file) and nothing ran.
- 4: nothing publishes. Every diff that could run ran, but the labels do not cover the run: a finding has no label entry, a diff has no label file, a label file was written for another Locrin version, a label file was never confirmed by pass two, still has an entry marked `?` or holds an entry whose note says an adjudication is pending, a finding a label entry describes was not reported by this run, or a missed entry names no construct at its commit (it repeats another missed entry on the same rule, file and line, names a rule this Locrin version does not have, names a file or line the commit does not hold, or sits on a rule, file and line where the run reported a finding and left it out as pre-existing or a duplicate). `run.json` lists why under `not_publishable`, names the files under `labels.missing`, `labels.other_version` and `labels.unconfirmed` and the entries under `labels.unreproduced` and `labels.invalid_missed`, and the table shows the unlabelled findings per rule and per pair. A labelled finding that is not reproduced means the run did not see what the labeller saw (another engine build, checkout or machine), so its numbers would not be the labelled truth. Relabel for this version (see LABELLING.md) and run again.

`run.json` also records what was measured: the Locrin versions the label files name, a sha256 digest of `corpus/`, of `labels/` and of the harness code (the Python files in `bench/`), and the harness commit. It counts the findings the numbers leave out under `unlabelled`, `excluded`, `not_applicable`, `preexisting` and `duplicates`, and lists the pre-existing and duplicate findings (diff, rule, file, line, id) under `preexisting_findings` and `duplicate_findings`, as stderr does. The scheduled job skips a version only when its `run.json` records a publishable run, with labels that cover it and no gone source, over the current corpus, labels and harness code, so a failed run, a run with gone sources, or a version whose corpus, labels or harness code changed since, is measured again.

The table always says how many diffs ran. Run the tests with `python -m pytest -q`; the end-to-end fixture test needs Locrin 0.5.0 on `PATH` and skips without it.

## Results

A rule or a language pair is scored only once five confirmed labelled findings back it, so read the table against how many reached that n: the table heading says how many of the rules and how many of the pairs did, and every row that did not reads `n<5, not scored` in its Note. In a wave of this size that is most rows, and the headline rests on the handful of rules that did reach n, so the corpus target for wave two is set by the rules still under it rather than by a number of diffs.

<!-- results:start -->
Locrin v0.5.0, 217 of 217 diffs ran. Left out of the numbers: 0 unlabelled, 10 without an agreed and confirmed label, 0 not applicable, 1324 pre-existing and 0 duplicate. 6 of 21 rules and 5 of 34 pairs reached n=5 and are scored.

| Rule | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `leftover-debug` | on | 24% (below line) | 100% | 5 | 16 | 0 | 0 | 7 | 0 | 127 | 0 |  |
| `leftover-commented-code` | on | 0% (below line) |  | 0 | 5 | 0 | 0 | 0 | 0 | 39 | 0 |  |
| `leftover-agent-marker` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 39 | 0 | n<5, not scored |
| `unused-import` | on | 100% | 25% | 1 | 0 | 3 | 0 | 0 | 0 | 51 | 0 | n<5, not scored |
| `unreachable` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `dead-export` | on | 94% | 74% | 34 | 2 | 12 | 0 | 1 | 0 | 729 | 0 |  |
| `dead-file` | off | 0% (below line) |  | 0 | 16 | 0 | 0 | 0 | 0 | 62 | 0 |  |
| `boundary-violation` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |
| `swallowed-error` | off | 92% | 100% | 11 | 1 | 0 | 0 | 2 | 0 | 138 | 0 |  |
| `test-no-assert` | on | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 12 | 0 | n<5, not scored |
| `test-newly-skipped` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `secret-exposed` | locked |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `weak-crypto` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `injection-sink` | off | 0% (below line) |  | 0 | 17 | 0 | 0 | 0 | 0 | 63 | 0 |  |
| `html-injection` | on | 25% | 100% | 1 | 3 | 0 | 0 | 0 | 0 | 57 | 0 | n<5, not scored |
| `vulnerable-dependency` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: advisory feed changes daily |
| `supabase-service-role-in-client` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `supabase-table-without-rls` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `express-route-without-auth` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |
| `express-cors-wildcard-on-authenticated` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `express-cookie-insecure` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |

| Pair | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dead-export@javascript` | on | 33% | 20% | 1 | 2 | 4 | 0 | 1 | 0 | 133 | 0 | n<5, not scored |
| `dead-export@tsx` | on | 100% | 100% | 3 | 0 | 0 | 0 | 0 | 0 | 75 | 0 | n<5, not scored |
| `dead-export@typescript` | on | 100% | 79% | 30 | 0 | 8 | 0 | 0 | 0 | 521 | 0 |  |
| `dead-file@javascript` | off | 0% (below line) |  | 0 | 11 | 0 | 0 | 0 | 0 | 42 | 0 |  |
| `dead-file@tsx` | off | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `dead-file@typescript` | off | 0% |  | 0 | 3 | 0 | 0 | 0 | 0 | 15 | 0 | n<5, not scored |
| `html-injection@javascript` | on | 0% |  | 0 | 3 | 0 | 0 | 0 | 0 | 57 | 0 | n<5, not scored |
| `html-injection@tsx` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `injection-sink@javascript` | off | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 6 | 0 | n<5, not scored |
| `injection-sink@typescript` | off | 0% (below line) |  | 0 | 15 | 0 | 0 | 0 | 0 | 57 | 0 |  |
| `leftover-agent-marker@php` | opt-in |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | n<5, not scored |
| `leftover-agent-marker@python` | opt-in | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | n<5, not scored |
| `leftover-agent-marker@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | n<5, not scored |
| `leftover-commented-code@javascript` | on | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 14 | 0 | n<5, not scored |
| `leftover-commented-code@php` | opt-in | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 3 | 0 | n<5, not scored |
| `leftover-commented-code@python` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | n<5, not scored |
| `leftover-commented-code@tsx` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `leftover-commented-code@typescript` | on | 0% |  | 0 | 1 | 0 | 0 | 0 | 0 | 11 | 0 | n<5, not scored |
| `leftover-debug@javascript` | on | 0% (below line) |  | 0 | 16 | 0 | 0 | 0 | 0 | 15 | 0 |  |
| `leftover-debug@php` | opt-in |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | n<5, not scored |
| `leftover-debug@tsx` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `leftover-debug@typescript` | on | 100% | 100% | 4 | 0 | 0 | 0 | 7 | 0 | 106 | 0 | n<5, not scored |
| `supabase-service-role-in-client@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `swallowed-error@javascript` | off | 91% | 100% | 10 | 1 | 0 | 0 | 2 | 0 | 105 | 0 |  |
| `swallowed-error@tsx` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 24 | 0 | n<5, not scored |
| `swallowed-error@typescript` | off | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | n<5, not scored |
| `test-no-assert@javascript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | n<5, not scored |
| `test-no-assert@typescript` | on | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `unused-import@javascript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 47 | 0 | n<5, not scored |
| `unused-import@php` | opt-in |  | 0% | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `unused-import@python` | opt-in |  | 0% | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `unused-import@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | n<5, not scored |
| `weak-crypto@tsx` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `weak-crypto@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | n<5, not scored |

Locrin reads PHP and Python only when `[languages]` turns them on, so their pairs ship opt-in; the benchmark turns both on.
<!-- results:end -->

## How it scores

The unit of measurement is a construct the change introduced, and one definition decides it for reported findings and missed entries alike. A construct counts as introduced unless the diff's parent held it at the same file path, inside a symbol of the same name, with the same line text. For a rule whose finding names a thing rather than a line (a secret's value for `secret-exposed`, a test case's name for `test-no-assert` and `test-newly-skipped`, an import binding for `unused-import`, an exported name for `dead-export`, a table name for `supabase-table-without-rls`, and the file itself for `dead-file`), the parent held it when the same file held the same thing, wherever it sat. Identical constructs are counted: when the parent held two and the commit holds three, one of them is introduced. So every construct in a renamed file counts as introduced, and so does every construct a rule anchors on a line inside a function renamed or moved to another file.

The harness applies that definition with Locrin's finding ids. For each diff it runs `locrin check --base <parent>` at the commit, then checks out the parent and runs `locrin check` again, with the same config and an empty cache, over the files that carry findings at the commit and still exist at the parent. A Locrin finding id is a hash of the rule, the file path and an anchor. For most rules the anchor is the enclosing symbol's name, the line's text and how many identical lines come before it in that symbol, so the id follows a construct when lines above it move. For the rules listed above it is the thing the finding names, so for secrets and test cases the id names a value or a case name within the file, not one construct, and several findings can share it. So the harness counts: for each rule, file and id, as many findings at the commit as the parent run reports are pre-existing, and the rest are introduced. The introduced ones are those on lines the change added (`git diff -U0`), then those on the latest lines. A pre-existing finding is left out of the numbers, never gets a label entry, and is listed as pre-existing and counted in the Pre-existing column. This holds for graph findings too, such as `dead-file` on a file the commit never touched. When Locrin cannot read a file at the parent, the parent run reports nothing there and every finding in that file counts as introduced; the labeller then treats every construct in that file as introduced too (see LABELLING.md). Across the corpus an occurrence counts once per repository: a diff whose parent run reports a rule, file and id p times and which introduces n more of it introduces occurrences p+1 to p+n. Diffs are taken in id order, and an introduced occurrence an earlier diff from the same repository already introduced (say a revert and a reland, or the same change on two branches) is listed as a duplicate and goes in the Duplicate column instead, taken from the diff's earliest lines. Occurrences the diff's own parent held are never duplicates, so when one diff adds a test case named `renders` and a later diff adds a second case with that name, each introduces one, whatever their id order. The same rule holds for missed entries: a construct an earlier diff from the same repository already introduced is not a missed entry in a later diff. The labeller decides that under the definition above (`label.py new` prints the ids of the earlier diffs from the repository), and missed entries are counted as the confirmed labels state them.

A finding is matched to a label entry for the same diff, rule, file, Locrin finding id and start line. Label files are written from the output of the Locrin version they name, so nothing looser is needed: a finding that no entry matches exactly is unlabelled, and an entry that no finding matches is not reproduced. Every entry for a reported finding must be matched by a finding of the run, whatever its verdict, or the run does not publish. A finding with no entry is listed as unlabelled, counted in the Unlabelled column, and stops the run from publishing. A finding or missed entry whose two passes disagree is listed as excluded and counted in the Excluded column. A finding whose confirmed verdict is `not-applicable` is listed as not applicable and counted in the Not applicable column. The table heading gives the total of each of those columns and of Pre-existing and Duplicate, so a published table always says how much it left out and why. None of them count toward precision or recall. Precision is true over true plus false positive; recall is true over true plus missed, where a missed entry names a construct the change introduced, under the definition above and first in its repository, that the rule should have reported. A label counts only when two independent passes agree and pass two has confirmed the file (see LABELLING.md); wave one's two passes were two blind runs of the same model family, recorded as `opus` and `opus-blind`, and a pass by a second model is owed, so read "independent" as blind rather than as two models. A rule or rule-language pair with fewer than five confirmed labelled findings is shown with its count and not scored. The line is 85 percent precision, the same gate the engine holds itself to on its private corpus.

The Ships column shows Locrin's shipped default: `off` for a rule or pair that ships off, `locked` for a rule that cannot be turned off, and `opt-in` for PHP and Python pairs, because Locrin reads those languages only when `[languages]` turns them on. The benchmark turns on every measurable rule and both languages.

Three things are deliberately not scored and say so in the table: `vulnerable-dependency`, because its findings depend on an advisory feed that changes daily; `boundary-violation` and `express-route-without-auth`, because they are silent until a repository configures them.

## What is in the corpus

Diffs from public repositories under MIT, Apache-2.0, BSD or ISC licences, chosen from commits that carry an agent co-author trailer. Each record in `corpus/` names the repository, commit, parent, licence and language, and stores the changed source files before and after. The harness scores each diff inside a checkout of the whole repository at that commit, because the graph rules need it. No private code is ever sampled.

`bench/build_corpus.py` finds the commits in one of two ways. The trailer search asks GitHub's commit search for each agent trailer. The repository-first mode asks GitHub's repository search for public, permissively licensed repositories pushed since a date, one language and licence at a time, then lists each repository's recent commits and keeps those with a `Co-authored-by` line naming an agent, for example:

    python -m bench.build_corpus --via-repos --since 2026-08-01 --out corpus --target 300 --language-target 75

Both apply the same checks to every commit. The corpus holds at most 3 records from any one repository and at most 6 from any one owner (upper and lower case count as the same owner); a commit over either limit is skipped before any of its files is downloaded. `python -m bench.build_corpus --out corpus --prune-owner-excess` brings an older corpus under the owner limit by keeping each owner's 6 records with the smallest ids and deleting the rest. CONTRIBUTING.md describes the options.

## Licence

MIT. Corpus files keep the licence of the repository they came from, named in each record.
