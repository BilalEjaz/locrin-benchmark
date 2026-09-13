# locrin-benchmark

Precision and recall of every [Locrin](https://github.com/BilalEjaz/locrin) rule, measured on a public corpus of agent-written diffs from open-source projects, reproducible on any machine.

## Run it

    ./run.sh v0.5.0

That installs the named Locrin version, checks out every corpus diff, runs `locrin check --base` on each, and writes `results/v0.5.0/`. It needs bash, git and Python 3.12. On Linux and macOS it installs Locrin into `.cache/bin/` with that release's own `install.sh`, which needs curl. `install.sh` does not run on Windows: there, put that Locrin version on `PATH` or set `LOCRIN_BIN` to its binary (`LOCRIN_BIN` works on every platform).

The first run clones the source repositories into `.cache/repos/`; later runs only fetch a commit a clone lacks. Git runs isolated from your machine's git configuration: no system or global config, template, hooks or credential helper, with long paths on. Every checkout pins `.git/info/attributes` to turn off line-ending, ident and filter conversion, so each file holds exactly its committed bytes and git never lists a file the commit did not change; a checkout whose changed files still differ from the commit's fails that diff. A proxy or CA bundle still reaches it through the environment (`HTTPS_PROXY`, `GIT_SSL_CAINFO`). Locrin runs with an empty home directory and an empty cache of its own, so a global gitignore or a git template on your machine cannot change the numbers. The run refuses to start when a `.ignore` file sits in the cache directory or any directory above it.

Only exit codes 0 and 3 publish, and only then is the README table rewritten:

- 0: every diff ran.
- 3: at least one diff ran, and every diff that did not has a source that is confirmed gone: its repository answers HTTP 404, or GitHub reports the commit missing after an explicit fetch. `results/<version>/run.json` lists them under `gone` with that evidence.
- 1: nothing publishes. Locrin or the harness failed on a diff, a source could not be checked out for any other reason (a network, DNS, server, disk or path error), or no diff ran. The run still writes `results/<version>/`, with `"publishable": false`, so you can see why.
- 2: setup failed (no Locrin, a missing or empty corpus, a bad label file) and nothing ran.

The table always says how many diffs ran. Run the tests with `python -m pytest -q`; the end-to-end fixture test needs Locrin 0.5.0 on `PATH` and skips without it.

## Results

<!-- results:start -->
No results yet.
<!-- results:end -->

## How it scores

A finding is matched to a label entry for the same diff, rule and file by Locrin's own finding id and start line. When lines moved it matches by id alone if that is unambiguous, and by line alone only when exactly one finding and one entry are left on that line, so a finding never borrows another finding's verdict. A confirmed true entry the run no longer reports counts as missed. A finding with no entry is listed as unlabelled, and a finding whose entry is not confirmed is listed as excluded; neither counts. Precision is true over true plus false positive; recall is true over true plus missed. A label counts only when two independent passes agree and pass two has confirmed the file (see LABELLING.md). A rule or rule-language pair with fewer than five confirmed labelled findings is shown with its count and not scored. The line is 85 percent precision, the same gate the engine holds itself to on its private corpus.

The Ships column shows Locrin's shipped default: `off` for a rule or pair that ships off, `locked` for a rule that cannot be turned off, and `opt-in` for PHP and Python pairs, because Locrin reads those languages only when `[languages]` turns them on. The benchmark turns on every measurable rule and both languages.

Three things are deliberately not scored and say so in the table: `vulnerable-dependency`, because its findings depend on an advisory feed that changes daily; `boundary-violation` and `express-route-without-auth`, because they are silent until a repository configures them.

## What is in the corpus

Diffs from public repositories under MIT, Apache-2.0, BSD or ISC licences, chosen from commits that carry an agent co-author trailer. Each record in `corpus/` names the repository, commit, parent, licence and language, and stores the changed source files before and after. The harness scores each diff inside a checkout of the whole repository at that commit, because the graph rules need it. No private code is ever sampled.

## Licence

MIT. Corpus files keep the licence of the repository they came from, named in each record.
