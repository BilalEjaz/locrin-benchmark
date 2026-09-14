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
- 4: nothing publishes. Every diff that could run ran, but the labels do not cover the run: a finding has no label entry, a diff has no label file, a label file was written for another Locrin version, a label file was never confirmed by pass two or still has an entry marked `?`, a finding a label entry describes was not reported by this run, or a missed entry names no construct at its commit (it repeats another missed entry on the same rule, file and line, names a rule this Locrin version does not have, or names a file or line the commit does not hold). `run.json` lists why under `not_publishable`, names the files under `labels.missing`, `labels.other_version` and `labels.unconfirmed` and the entries under `labels.unreproduced` and `labels.invalid_missed`, and the table shows the unlabelled findings per rule and per pair. A labelled finding that is not reproduced means the run did not see what the labeller saw (another engine build, checkout or machine), so its numbers would not be the labelled truth. Relabel for this version (see LABELLING.md) and run again.

`run.json` also records what was measured: the Locrin versions the label files name, a sha256 digest of `corpus/`, of `labels/` and of the harness code (the Python files in `bench/`), and the harness commit. It counts the findings the numbers leave out under `unlabelled`, `excluded`, `not_applicable`, `preexisting` and `duplicates`. The scheduled job skips a version only when its `run.json` records a publishable run, with labels that cover it and no gone source, over the current corpus, labels and harness code, so a failed run, a run with gone sources, or a version whose corpus, labels or harness code changed since, is measured again.

The table always says how many diffs ran. Run the tests with `python -m pytest -q`; the end-to-end fixture test needs Locrin 0.5.0 on `PATH` and skips without it.

## Results

<!-- results:start -->
No results yet.
<!-- results:end -->

## How it scores

The unit of measurement is a finding the change introduced. For each diff the harness runs `locrin check --base <parent>` at the commit, then checks out the parent and runs `locrin check` again, with the same config and an empty cache, over the files that carry findings at the commit and still exist at the parent. A Locrin finding id is a hash of the rule, the file path and the construct, not of the line, so a finding whose rule, file and id the parent run also reports was already there before the change. That finding is pre-existing: it is left out of the numbers, never gets a label entry, and is counted in the Pre-existing column. This holds for graph findings too, such as `dead-file` on a file the commit never touched. A rename changes the file path and therefore the id, so the findings in a renamed file count as introduced. Across the corpus one construct (repository, rule, file and id) counts once, in the first diff by id that introduced it; a later diff from the same repository that introduces it again counts it in the Duplicate column instead.

A finding is matched to a label entry for the same diff, rule, file, Locrin finding id and start line. Label files are written from the output of the Locrin version they name, so nothing looser is needed: a finding that no entry matches exactly is unlabelled, and an entry that no finding matches is not reproduced. Every entry for a reported finding must be matched by a finding of the run, whatever its verdict, or the run does not publish. A finding with no entry is listed as unlabelled, counted in the Unlabelled column, and stops the run from publishing. A finding or missed entry whose two passes disagree is listed as excluded and counted in the Excluded column. A finding whose confirmed verdict is `not-applicable` is listed as not applicable and counted in the Not applicable column. The table heading gives the total of each of those columns and of Pre-existing and Duplicate, so a published table always says how much it left out and why. None of them count toward precision or recall. Precision is true over true plus false positive; recall is true over true plus missed, where a missed entry names a construct the change introduced that the rule should have reported. A label counts only when two independent passes agree and pass two has confirmed the file (see LABELLING.md). A rule or rule-language pair with fewer than five confirmed labelled findings is shown with its count and not scored. The line is 85 percent precision, the same gate the engine holds itself to on its private corpus.

The Ships column shows Locrin's shipped default: `off` for a rule or pair that ships off, `locked` for a rule that cannot be turned off, and `opt-in` for PHP and Python pairs, because Locrin reads those languages only when `[languages]` turns them on. The benchmark turns on every measurable rule and both languages.

Three things are deliberately not scored and say so in the table: `vulnerable-dependency`, because its findings depend on an advisory feed that changes daily; `boundary-violation` and `express-route-without-auth`, because they are silent until a repository configures them.

## What is in the corpus

Diffs from public repositories under MIT, Apache-2.0, BSD or ISC licences, chosen from commits that carry an agent co-author trailer. Each record in `corpus/` names the repository, commit, parent, licence and language, and stores the changed source files before and after. The harness scores each diff inside a checkout of the whole repository at that commit, because the graph rules need it. No private code is ever sampled.

## Licence

MIT. Corpus files keep the licence of the repository they came from, named in each record.
