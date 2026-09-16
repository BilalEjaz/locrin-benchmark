Locrin v0.6.0, 217 of 217 diffs ran. Left out of the numbers: 0 unlabelled, 3 without an agreed and confirmed label, 0 not applicable, 1188 pre-existing and 0 duplicate. 5 of 21 rules and 4 of 32 pairs reached n=5 and are scored.

| Rule | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `leftover-debug` | on | 43% (below line) | 100% | 3 | 4 | 0 | 0 | 0 | 0 | 18 | 0 |  |
| `leftover-commented-code` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 12 | 0 | n<5, not scored |
| `leftover-agent-marker` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 39 | 0 | n<5, not scored |
| `unused-import` | on | 100% | 25% | 1 | 0 | 3 | 0 | 0 | 0 | 51 | 0 | n<5, not scored |
| `unreachable` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `dead-export` | on | 94% | 74% | 34 | 2 | 12 | 0 | 1 | 0 | 729 | 0 |  |
| `dead-file` | off | 0% (below line) |  | 0 | 16 | 0 | 0 | 0 | 0 | 62 | 0 |  |
| `boundary-violation` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |
| `swallowed-error` | on | 92% | 100% | 11 | 1 | 0 | 0 | 2 | 0 | 138 | 0 |  |
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
| `leftover-commented-code@php` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `leftover-commented-code@python` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | n<5, not scored |
| `leftover-commented-code@typescript` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | n<5, not scored |
| `leftover-debug@javascript` | on | 0% |  | 0 | 4 | 0 | 0 | 0 | 0 | 12 | 0 | n<5, not scored |
| `leftover-debug@php` | opt-in |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | n<5, not scored |
| `leftover-debug@tsx` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `leftover-debug@typescript` | on | 100% | 100% | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `supabase-service-role-in-client@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `swallowed-error@javascript` | on | 91% | 100% | 10 | 1 | 0 | 0 | 2 | 0 | 105 | 0 |  |
| `swallowed-error@tsx` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 24 | 0 | n<5, not scored |
| `swallowed-error@typescript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | n<5, not scored |
| `test-no-assert@javascript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | n<5, not scored |
| `test-no-assert@typescript` | on | 0% |  | 0 | 2 | 0 | 0 | 0 | 0 | 5 | 0 | n<5, not scored |
| `unused-import@javascript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 47 | 0 | n<5, not scored |
| `unused-import@php` | opt-in |  | 0% | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `unused-import@python` | opt-in |  | 0% | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |
| `unused-import@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | n<5, not scored |
| `weak-crypto@tsx` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | n<5, not scored |
| `weak-crypto@typescript` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | n<5, not scored |

Locrin reads PHP and Python only when `[languages]` turns them on, so their pairs ship opt-in; the benchmark turns both on.
