# Labelling protocol

## What gets labelled

The benchmark measures what a change introduced, and one definition of introduced holds for the findings you label and the missed entries you write. A construct counts as introduced unless the diff's parent held it at the same file path, inside a symbol of the same name, with the same line text. For a rule whose finding names a thing rather than a line (a secret's value for `secret-exposed`, a test case's name for `test-no-assert` and `test-newly-skipped`, an import binding for `unused-import`, an exported name for `dead-export`, a table name for `supabase-table-without-rls`, and the file itself for `dead-file`), the parent held it when the same file held the same thing, wherever it sat. Identical constructs are counted: when the parent held one `works` test case with no assertion in a file and the commit holds two, one of them is introduced. A change can also make a construct meet a definition without touching it (removing the last use of an import makes that import unused; a new `return` makes the code after it unreachable), and that construct is introduced too, in any file of the repository.

So a renamed file is new: every construct in it counts as introduced, and missed entries in a renamed file are written like those in any other new file. A function renamed, or moved to another file, is new in the same way for the rules that anchor on a line; moving it within its file changes nothing. A construct the parent held under this definition is never a missed entry. Nor is a construct an earlier diff (by id) from the same repository already introduced, such as the same change relanded after a revert or made on two branches: it counts once, in the first diff, just as its reported finding does. `label.py new` prints the ids of those earlier diffs, so check them before writing a missed entry.

`label.py new` applies the definition with Locrin's finding ids: it runs the engine at the commit and at the parent, for this diff and for every earlier diff from the same repository. For each rule, file and id, as many findings as the parent run reports are pre-existing and get no entry; the rest go in the template, those on lines the change added first. An introduced occurrence an earlier diff (by id) from the same repository already introduced is a duplicate and gets no entry either: a diff whose parent held p of a rule, file and id and which adds n more introduces occurrences p+1 to p+n, so a reland onto a parent with the same count repeats them, while a later diff that adds another occurrence beside ones its parent held does not. Occurrences the diff's own parent held are never duplicates. The run counts missed entries the same way, by rule, file and the text of the line: a diff whose commit holds p lines with that text the change did not add introduces occurrences p+1 onwards, and a missed entry on an occurrence an earlier diff from the same repository already introduced is not counted as missed but goes in the Duplicate column, whatever its verdicts. A missed entry on a rule, file and line where the run reported a finding and left it out as pre-existing or a duplicate stops the run from publishing, because the engine did report it there. When Locrin cannot read a file at the parent, its findings there all come out as introduced: then treat every construct in that file as introduced, for missed entries too. You can tell from the template: it lists findings on lines that, by the definition above, the parent already held.

## Two passes

Every label is written twice, by two independent passes, and counts only when both agree. Pass one runs `python label.py new <id> --locrin <version> --by <name>`, which writes `labels/<id>.json` with every finding the diff introduced as an entry marked `?`. `new` refuses to overwrite an existing label file, so filled verdicts are never lost; pass `--force` only to discard one on purpose. The labeller reads the diff and the code around each finding and sets `pass1` on every entry, then adds `missed` entries for anything a rule should have reported and did not. Pass two works from a copy of the unfilled template that `new` wrote, so it never sees `pass1`: it sets `pass2` on every entry and writes its own `missed` entries.

The two passes' verdicts are then merged into `labels/<id>.json`. A missed entry both passes wrote (same rule, file and line) becomes one entry with `missed` in both passes. A missed entry only one pass wrote goes in with that pass's `missed` and the other pass set to `?`, and the other pass then looks at that construct and records its own verdict: `missed` when the definition is met there and the diff introduced it, `false-positive` when it is not. Never copy one pass's `missed` into the other pass: that records an agreement that never happened. A `false-positive` against `missed` is a disagreement, settled as described under Disputes. After the merge pass two runs `python label.py confirm <id> --by <name>`. `confirm` refuses a file that still has an entry marked `?` in either pass. Until `confirm` has recorded pass two in the file, none of its entries count, and a run over that diff does not publish (exit code 4, the file listed under `labels.unconfirmed` in `run.json`).

A run also checks every missed entry against the checkout at the commit. A missed entry that repeats another missed entry on the same rule, file and line, names a rule this Locrin version does not have, or names a file the commit does not hold or a line past its end, or sits on a rule, file and line where the run reported a finding and left it out as pre-existing or a duplicate, stops the run from publishing (exit code 4, listed under `labels.invalid_missed`). A reported finding's entry and a missed entry may share a line: the engine can report one construct there and miss another.

Verdicts:

- `true`: the rule's definition below is met at that file and line.
- `false-positive`: the definition is not met at that file and line: the engine reported it wrongly, or, on a missed entry the other pass wrote, the claimed miss is not there.
- `missed`: the definition is met at that file and line, on a construct the diff introduced and no earlier diff from the same repository already introduced, and the engine did not report it. Use the first line of the offending construct. A missed entry has `"id": null`; every other entry carries the engine's 16 character id.
- `not-applicable`: the finding is on a file the diff did not really author: generated code or vendored code committed with the change. It is counted in the Not applicable column and excluded from both precision and recall.

## What counts as true, per rule

- `leftover-debug`: a debug print or breakpoint left in non-script code (console.log, debugger, var_dump, dd, breakpoint(), pdb). A log statement that is the module's real logging is not true; a print in a CLI script's main path is not true.
- `leftover-commented-code`: a comment whose content is code that was disabled, not prose describing code.
- `leftover-agent-marker`: TODO, FIXME, XXX, HACK or an explicit agent marker left in the change. A marker in a path or file name is not true.
- `unused-import`: an import whose every binding is unused in the file after the change.
- `unreachable`: a statement after return, throw, break or continue in the same block, or in a branch whose condition is a literal.
- `dead-export`: an exported symbol with no importer anywhere in the repository and not an entry point.
- `dead-file`: a source file no other file imports and no entry point names.
- `swallowed-error`: a catch or except block that neither rethrows, logs, returns an error value, nor is documented as intentional.
- `test-no-assert`: a test body with no assertion or expectation call.
- `test-newly-skipped`: a test the change marked skip, only, todo or xfail.
- `secret-exposed`: a real-looking credential literal (provider-shaped key, private key block, password in an assignment). Documented placeholder formats from a provider's docs are not true.
- `weak-crypto`: md5, sha1 for security purposes, DES, RC4, ECB, Math.random for tokens.
- `injection-sink`: user-controlled input reaching a query, shell, eval or HTML sink without a parameterisation or escape.
- `html-injection`: unescaped interpolation into innerHTML, dangerouslySetInnerHTML or a template rendered as HTML.
- `supabase-service-role-in-client`, `supabase-table-without-rls`, `express-cors-wildcard-on-authenticated`, `express-cookie-insecure`: the named construct in code that runs on the client (or the server, for the Express pair) exactly as the rule name says.

Not scored: `vulnerable-dependency` (advisory feed), `boundary-violation` and `express-route-without-auth` (need per-repository config). The table never gives them a number, but an entry for one still gets a truthful verdict under the definitions above: `true` when the finding is a real instance of what the rule name describes, `false-positive` when it is not. `not-applicable` keeps its one meaning, generated or vendored code the diff did not really author.

## Disputes

An entry where the two passes disagree is listed by `python label.py status --labels labels` (a `disagree:` line under its file's counts) and excluded from every number until a maintainer settles it by editing both passes with a note that says why. A missed entry settled as not a miss is deleted instead, since only a missed entry may have no id. A run still publishes with disagreements, lists each one as an `excluded:` line, and the table counts them in its heading and in the Excluded column of each rule and pair.

## A new Locrin version

Label files name the Locrin version they were written for, and a run publishes only with labels for its own version. For a new version, label every diff again with `python label.py new <id> --locrin <new version> --by <name> --force` and both passes as above; verdicts from the older file can guide the labeller, but each finding the new version reports gets an entry and a verdict of its own. Label on the same Locrin build the run uses: a run that does not report a finding a label entry describes does not publish.
