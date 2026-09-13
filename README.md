# locrin-benchmark

Precision and recall of every [Locrin](https://github.com/BilalEjaz/locrin) rule, measured on a public corpus of agent-written diffs from open-source projects, reproducible on any machine.

## Run it

    ./run.sh v0.5.0

That installs the named Locrin version into `.cache/bin/`, checks out every corpus diff, runs `locrin check --base` on each, and writes `results/v0.5.0/`. It needs bash, git, curl and Python 3.12. The first run clones the source repositories into `.cache/repos/`; later runs are offline. Locrin runs with an empty home directory of its own, so a global gitignore on your machine cannot change the numbers, and the run refuses to start when a `.ignore` file sits in the cache directory or any directory above it.

It exits 0 when every diff ran, 1 when Locrin or the harness failed on a diff, 2 when setup failed and nothing ran, and 3 when the only failures were diffs whose source commit could not be checked out. The table always says how many diffs ran.

## Results

<!-- results:start -->
No results yet.
<!-- results:end -->

## How it scores

A finding is matched to a label by rule id, file and start line. Precision is true over true plus false positive; recall is true over true plus missed. A label counts only when two independent passes agree (see LABELLING.md). A rule or rule-language pair with fewer than five confirmed labelled findings is shown with its count and not scored. The line is 85 percent precision, the same gate the engine holds itself to on its private corpus.

Three things are deliberately not scored and say so in the table: `vulnerable-dependency`, because its findings depend on an advisory feed that changes daily; `boundary-violation` and `express-route-without-auth`, because they are silent until a repository configures them.

## What is in the corpus

Diffs from public repositories under MIT, Apache-2.0, BSD or ISC licences, chosen from commits that carry an agent co-author trailer. Each record in `corpus/` names the repository, commit, parent, licence and language, and stores the changed source files before and after. The harness scores each diff inside a checkout of the whole repository at that commit, because the graph rules need it. No private code is ever sampled.

## Licence

MIT. Corpus files keep the licence of the repository they came from, named in each record.
