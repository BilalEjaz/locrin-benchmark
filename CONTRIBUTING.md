# Contributing

## Disputing a label

Open an issue titled `label: <diff id> <rule> <file>:<line>` saying which verdict you think is wrong and why, quoting the code. A maintainer re-runs both passes; if they now disagree the label is excluded until resolved.

## Adding a diff

Run `python -m bench.build_corpus --repo owner/name --sha <commit>`; it refuses licences outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause and ISC. Then label it with `python label.py new <id>` and get a second pass with `python label.py confirm <id>`.

## Pruning a diff whose commit is gone

A repository that is deleted, made private or rewritten takes its commits with it. The results job then publishes the diffs that still check out, says how many ran, and fails with the list of the ones that did not. Run `python -m bench.build_corpus --check-gone` to list every record whose commit GitHub no longer serves, and remove those records and their labels in one pull request.

## Rules for this repository

No em dashes in any text. Commits carry no AI attribution trailer. Stage by explicit path.
