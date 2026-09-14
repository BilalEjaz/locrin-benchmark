# Contributing

## Disputing a label

Open an issue titled `label: <diff id> <rule> <file>:<line>` saying which verdict you think is wrong and why, quoting the code. A maintainer re-runs both passes; if they now disagree the label is excluded until resolved.

## Adding a diff

Run `python -m bench.build_corpus --repo owner/name --sha <commit>`; it refuses licences outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause and ISC. Then label it with `python label.py new <id> --locrin <version> --by <name>` and, once a second pass has filled `pass2`, record it with `python label.py confirm <id> --by <name>` (see LABELLING.md).

## Pruning a diff whose commit is gone

A repository that is deleted, made private or rewritten takes its commits with it. When every diff that did not run has a source that is confirmed gone (the repository answers HTTP 404, or GitHub reports the commit missing after an explicit fetch), the results job publishes the rest, says how many ran, and fails with the list. A clone or fetch that fails for any other reason publishes nothing, and the next scheduled run tries again.

Run `python -m bench.build_corpus --check-gone` to list, as `gone:` lines, every record whose commit GitHub answers 404 or 422 for. If gh fails any other way (not installed, not signed in, a network or server error) the check stops with `build_corpus: stopped:` and lists nothing more. Remove only the records listed as `gone:`, together with their labels, in one pull request. In the same pull request, re-check the label files of later diffs (by id) from the same repository as each removed record: a construct the removed diff introduced now counts in the first later diff that introduces it, so run `label.py new` for those diffs again, label the findings that now come out as introduced, and write the missed entries their labellers left out because the removed diff held them.

## Rules for this repository

No em dashes in any text. Commits carry no AI attribution trailer. Stage by explicit path.
