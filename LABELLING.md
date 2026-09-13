# Labelling protocol

Every label is written twice, by two independent passes, and counts only when both agree. Pass one runs `python label.py new <id> --locrin <version> --by <name>`, which runs the engine on the diff and writes `labels/<id>.json` with every reported finding as an entry marked `?`. The labeller reads the diff and the code around each finding and sets `pass1` on every entry, then adds `missed` entries for anything a rule should have reported and did not. Pass two works from a copy of the unfilled template that `new` wrote, so it never sees `pass1`: it sets `pass2` on every entry and adds its own `missed` entries, its verdicts are merged into `labels/<id>.json`, and then it runs `python label.py confirm <id> --by <name>`. `confirm` refuses a file that still has an entry marked `?` in either pass.

Verdicts:

- `true`: the rule's definition below is met at that file and line.
- `false-positive`: the engine reported it and the definition is not met.
- `missed`: the definition is met at that file and line and the engine did not report it. Use the first line of the offending construct. A missed entry has `"id": null`; every other entry carries the engine's 16 character id.
- `not-applicable`: the finding is on a file the diff did not really change (a rename, a generated file, vendored code). Excluded from both precision and recall.

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

Not labelled: `vulnerable-dependency` (advisory feed), `boundary-violation` and `express-route-without-auth` (need per-repository config). Entries for these rules are set to `not-applicable`.

## Disputes

An entry where the two passes disagree is listed by `python label.py status` and excluded from every number until a maintainer settles it by editing both passes with a note that says why.
