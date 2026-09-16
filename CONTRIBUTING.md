# Contributing

## Disputing a label

Open an issue titled `label: <diff id> <rule> <file>:<line>` saying which verdict you think is wrong and why, quoting the code. A maintainer re-runs both passes; if they now disagree the label is excluded until resolved.

## Adding a diff

Run `python -m bench.build_corpus --repo owner/name --sha <commit>`; it refuses licences outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause and ISC. Then label it with `python label.py new <id> --locrin <version> --by <name>`, fold the blind second pass in with `python label.py merge <id> --pass2 <file>`, and record it with `python label.py confirm <id> --by <name>` (see LABELLING.md). For a new Locrin version, do not label the corpus again: `python label.py carry <id> --locrin <new version>` writes the existing verdicts forward and leaves only what that version newly reports to judge.

## Building many diffs at once

`python -m bench.build_corpus --out corpus --target 300` searches GitHub's commit search for each agent co-author trailer. That search returns at most a few pages per trailer and most of what it finds sits in repositories without a permissive licence, so it runs dry quickly.

The repository-first mode finds far more. It asks GitHub's repository search for public repositories that are not forks or archived, carry one of the five allowed licences and were pushed on or after a date, one query per language and licence, most recently updated first, up to 1000 repositories each. For every repository it lists the commits made since that date (one page of 100 by default) with the commits API, keeps those with a `Co-authored-by` line naming Claude, Codex, Copilot or Cursor, and runs each one through the same checks as every other diff: the licence read again from the repository, one parent, the file count and size limits, paths that check out on Windows and Linux, at most three diffs per repository, at most six diffs per owner, and no commit recorded twice.

    python -m bench.build_corpus --via-repos --since 2026-08-01 --out corpus --target 300 --language php --language python --language-target 40

- `--since YYYY-MM-DD` is required: repositories pushed and commits made on or after that day.
- `--language` picks a language, and can be given more than once: `typescript`, `javascript`, `php` or `python`. Without it all four are searched. A record counts as the language most of its changed files are in, which is not always the repository's main language; a record in a language you did not pick is skipped. That check runs as soon as the commit's changed files are listed, before any file is downloaded, so such a commit costs at most two GitHub calls and does not use up the repository's three diffs.
- `--language-target K` stops taking records in a language once the output directory holds K of them; a commit in a full language is skipped the same early way. `--target` still caps the total.
- `--commit-pages N` lists N pages of 100 commits per repository instead of one.

It prints one line per repository (commits listed, commits with an agent trailer, records accepted) and ends with the records written per language and how many commits were skipped for each reason. GitHub calls are paced, three seconds apart for searches and half a second apart otherwise. When GitHub answers with a secondary rate limit the build waits at least two minutes (longer if GitHub says so) and tries again, up to three times. When the hourly limit runs out it waits for the reset if that is under 65 minutes away. Otherwise it stops with exit code 1 and keeps every record it already wrote, so running the same command again carries on where it stopped.

## Limits per repository and per owner

The corpus holds at most 3 records from any one repository and at most 6 from any one owner, so no single project or author can fill a language. The owner is the part of `owner/name` before the slash, and upper and lower case count as the same owner. The trailer search and `--via-repos` count the records already in `--out` toward both limits, and `--repo`/`--sha` counts them toward the owner limit only, so check a named commit's repository by hand. A commit over a limit is skipped with the reason `repository cap` or `owner cap` before any of its files is downloaded. `--via-repos` does not list the commits of a repository whose owner already has 6 records.

A corpus built before the owner limit may hold more than 6 records from one owner. To bring it under the limit, run

    python -m bench.build_corpus --out corpus --prune-owner-excess

For each owner over the limit it keeps the 6 records with the smallest ids (plain string order, so upper case sorts before lower case) and deletes the rest, both `<id>.json` and the `<id>/` directory, printing a `pruned: <id>` line for each and a count at the end. The same corpus always keeps the same records, and running it again removes nothing. It takes no other option, and it reads every record first: if one cannot be read or its id is not a plain name matching its file name, it deletes nothing and exits 1. Remove the labels of any pruned record and re-check the later diffs from its repository as described under pruning a gone diff below.

## Pruning a diff whose commit is gone

A repository that is deleted, made private or rewritten takes its commits with it. When every diff that did not run has a source that is confirmed gone (the repository answers HTTP 404, or GitHub reports the commit missing after an explicit fetch), the results job publishes the rest, says how many ran, and fails with the list. A clone or fetch that fails for any other reason publishes nothing, and the next scheduled run tries again.

Run `python -m bench.build_corpus --check-gone` to list, as `gone:` lines, every record whose commit GitHub answers 404 or 422 for. If gh fails any other way (not installed, not signed in, a network or server error) the check stops with `build_corpus: stopped:` and lists nothing more. Remove only the records listed as `gone:`, together with their labels, in one pull request. In the same pull request, re-check the label files of later diffs (by id) from the same repository as each removed record: a construct the removed diff introduced now counts in the first later diff that introduces it, so run `label.py new <id> --locrin <version> --by <name> --labels <a scratch directory>` for each of those diffs (without `--labels` it refuses to overwrite the confirmed file, and `--force` would replace its verdicts with `?`), copy the findings that now come out as introduced into the existing confirmed file, label them and the missed entries their labellers left out because the removed diff held them with both passes, and confirm the file again.

## Rules for this repository

No em dashes in any text. Commits carry no AI attribution trailer. Stage by explicit path.
