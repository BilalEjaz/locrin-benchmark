Locrin v1.0.0, 302 of 302 diffs ran. Left out of the numbers: 0 unlabelled, 0 without an agreed and confirmed label, 10 not applicable, 3106 pre-existing and 0 duplicate. 8 of 21 rules and 10 of 39 pairs reached n=5 and are scored.

| Rule | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `leftover-debug` | off | 0% (below line) |  | 0 | 47 | 0 | 0 | 0 | 0 | 64 | 0 |  |
| `leftover-commented-code` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 13 | 0 | n<5, not scored |
| `leftover-agent-marker` | on | 100% | 100% | 3 | 0 | 0 | 0 | 0 | 0 | 39 | 0 | n<5, not scored |
| `unused-import` | on | 100% | 62% | 5 | 0 | 3 | 0 | 0 | 0 | 63 | 0 |  |
| `unreachable` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored: not targeted, no signal selects for it |
| `dead-export` | on | 89% | 84% | 235 | 30 | 46 | 0 | 0 | 0 | 2411 | 0 |  |
| `dead-file` | off | 9% (below line) | 80% | 4 | 40 | 1 | 0 | 0 | 2 | 161 | 0 |  |
| `boundary-violation` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |
| `swallowed-error` | on | 93% | 59% | 13 | 1 | 9 | 0 | 0 | 5 | 159 | 0 |  |
| `test-no-assert` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | n<5, not scored |
| `test-newly-skipped` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `secret-exposed` | locked | 0% |  | 0 | 1 | 0 | 0 | 0 | 0 | 17 | 0 | n<5, not scored: not targeted, a public corpus must not hold live credentials |
| `weak-crypto` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | n<5, not scored |
| `injection-sink` | off | 0% (below line) |  | 0 | 21 | 0 | 0 | 0 | 2 | 82 | 0 |  |
| `html-injection` | off | 12% (below line) | 100% | 1 | 7 | 0 | 0 | 0 | 1 | 68 | 0 |  |
| `vulnerable-dependency` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: advisory feed changes daily |
| `supabase-service-role-in-client` | off | 0% (below line) |  | 0 | 21 | 0 | 0 | 0 | 0 | 11 | 0 |  |
| `supabase-table-without-rls` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored: not targeted, reads SQL migrations and the corpus records source files only |
| `express-route-without-auth` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |
| `express-cors-wildcard-on-authenticated` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |
| `express-cookie-insecure` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |

| Pair | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dead-export@javascript` | on | 25% | 20% | 1 | 3 | 4 | 0 | 0 | 0 | 140 | 0 | n<5, not scored |
| `dead-export@tsx` | on | 53% (below line) | 90% | 9 | 8 | 1 | 0 | 0 | 0 | 128 | 0 |  |
| `dead-export@typescript` | on | 92% | 85% | 225 | 19 | 41 | 0 | 0 | 0 | 2143 | 0 |  |
| `dead-file@javascript` | off | 6% (below line) | 100% | 1 | 17 | 0 | 0 | 0 | 2 | 51 | 0 |  |
| `dead-file@tsx` | off | 11% (below line) | 50% | 1 | 8 | 1 | 0 | 0 | 0 | 12 | 0 |  |
| `dead-file@typescript` | off | 12% (below line) | 100% | 2 | 15 | 0 | 0 | 0 | 0 | 98 | 0 |  |
| `html-injection@javascript` | off | 0% |  | 0 | 4 | 0 | 0 | 0 | 1 | 57 | 0 | n<5, not scored |
| `html-injection@tsx` | off | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `html-injection@typescript` | off | 0% |  | 0 | 3 | 0 | 0 | 0 | 0 | 11 | 0 | n<5, not scored |
| `injection-sink@javascript` | off | 0% |  | 0 | 2 | 0 | 0 | 0 | 2 | 6 | 0 | n<5, not scored |
| `injection-sink@typescript` | off | 0% (below line) |  | 0 | 19 | 0 | 0 | 0 | 0 | 76 | 0 |  |
| `leftover-agent-marker@javascript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | n<5, not scored |
| `leftover-agent-marker@php` | opt-in |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `leftover-agent-marker@python` | opt-in | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 30 | 0 | n<5, not scored |
| `leftover-agent-marker@tsx` | on | 100% | 100% | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `leftover-agent-marker@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | n<5, not scored |
| `leftover-commented-code@php` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `leftover-commented-code@python` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | n<5, not scored |
| `leftover-commented-code@typescript` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `leftover-debug@javascript` | off | 0% (below line) |  | 0 | 11 | 0 | 0 | 0 | 0 | 11 | 0 |  |
| `leftover-debug@php` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | n<5, not scored |
| `leftover-debug@tsx` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `leftover-debug@typescript` | off | 0% (below line) |  | 0 | 36 | 0 | 0 | 0 | 0 | 50 | 0 |  |
| `secret-exposed@javascript` | locked |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | n<5, not scored |
| `secret-exposed@typescript` | locked | 0% |  | 0 | 1 | 0 | 0 | 0 | 0 | 16 | 0 | n<5, not scored |
| `supabase-service-role-in-client@javascript` | off | 0% |  | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `supabase-service-role-in-client@typescript` | off | 0% (below line) |  | 0 | 18 | 0 | 0 | 0 | 0 | 11 | 0 |  |
| `swallowed-error@javascript` | on | 91% | 62% | 10 | 1 | 6 | 0 | 0 | 5 | 103 | 0 |  |
| `swallowed-error@tsx` | on |  | 0% | 0 | 0 | 3 | 0 | 0 | 0 | 28 | 0 | n<5, not scored |
| `swallowed-error@typescript` | on | 100% | 100% | 3 | 0 | 0 | 0 | 0 | 0 | 28 | 0 | n<5, not scored |
| `test-no-assert@javascript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | n<5, not scored |
| `test-no-assert@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 | n<5, not scored |
| `unused-import@javascript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 47 | 0 | n<5, not scored |
| `unused-import@php` | opt-in |  | 0% | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `unused-import@python` | opt-in |  | 0% | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `unused-import@tsx` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | n<5, not scored |
| `unused-import@typescript` | on | 100% | 100% | 4 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | n<5, not scored |
| `weak-crypto@tsx` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `weak-crypto@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | n<5, not scored |

Locrin reads PHP and Python only when `[languages]` turns them on, so their pairs ship opt-in; the benchmark turns both on.
