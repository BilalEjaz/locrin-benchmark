"""Join findings with confirmed labels and compute precision and recall."""
from __future__ import annotations

import dataclasses
import math
from collections import Counter, defaultdict
from dataclasses import dataclass

from bench.corpus import Diff, language_of
from bench.labels import Entry, LabelFile
from bench.run import Finding, RuleMeta

NOT_BENCHMARKED = {
    "vulnerable-dependency": "advisory feed changes daily",
    "boundary-violation": "needs per-repository config",
    "express-route-without-auth": "needs per-repository config",
}
LOCKED = {"secret-exposed"}
SHIPS_OFF = {"dead-file", "swallowed-error", "injection-sink"}
# Pairs the engine ships off although their rule ships on. SARIF carries only the rule
# default, so these come from the engine README "Per-language defaults" table.
PAIRS_OFF = {"leftover-commented-code@python"}
# Languages locrin reads only when [languages] turns them on. The benchmark turns them on.
OPT_IN_LANGUAGES = {"php", "python"}
MIN_N = 5
LINE = 0.85


@dataclass
class Score:
    key: str
    true: int
    false_positive: int
    missed: int
    precision: float | None
    recall: float | None
    scored: bool
    reason: str
    # Findings on this rule or pair that no label entry covers; they count nowhere.
    unlabelled: int = 0
    # Findings and missed entries on this rule or pair whose label has no verdict that counts
    # (its passes disagree, or pass two never confirmed its file); they count nowhere.
    excluded: int = 0
    # Findings whose confirmed verdict is not-applicable; they count nowhere.
    not_applicable: int = 0
    # Findings the parent run also reports, so the change did not introduce them; never labelled.
    preexisting: int = 0
    # Introduced occurrences, reported or missed, an earlier diff (by id) from the same repository already introduced.
    duplicates: int = 0


# The counts beside true, false positive and missed, in table column order.
SIDE = ("unlabelled", "excluded", "not_applicable", "preexisting", "duplicates")


def _tally(counts: dict[str, list[int]], keys_in_order: list[str], side: dict[str, dict[str, int]]) -> list[Score]:
    out = []
    for key in keys_in_order:
        t, fp, m = counts.get(key, [0, 0, 0])
        extra = {name: side[name].get(key, 0) for name in SIDE}
        rule = key.split("@", 1)[0]
        precision = t / (t + fp) if t + fp else None
        recall = t / (t + m) if t + m else None
        if rule in NOT_BENCHMARKED:
            out.append(Score(key, t, fp, m, precision, recall, False, f"not benchmarked: {NOT_BENCHMARKED[rule]}", **extra))
        elif t + fp < MIN_N:
            # The gate counts confirmed labelled findings (true plus false positive), as the
            # engine's own gate counts findings; missed entries are not findings.
            out.append(Score(key, t, fp, m, precision, recall, False, "n<5, not scored", **extra))
        else:
            out.append(Score(key, t, fp, m, precision, recall, True, "", **extra))
    return out


def repository_of(diff: Diff) -> str:
    """The repository a diff comes from: its canonical name for a git source; a tree source is its own."""
    return diff.repo.lower() if diff.source == "git" and diff.repo else f"tree:{diff.id}"


def _key(f: Finding) -> tuple[str, str, str]:
    return (f.rule, f.file, f.id)


def repeated_files(findings: list[Finding]) -> list[str]:
    """The files where one rule reports one id more than once, sorted: only there does split_preexisting need added lines."""
    counts = Counter(_key(f) for f in findings)
    return sorted({f.file for f in findings if counts[_key(f)] > 1})


def split_preexisting(at_commit: list[Finding], at_parent: list[Finding],
                      added: dict[str, set[int]] | None = None) -> tuple[list[Finding], list[Finding]]:
    """(introduced, pre-existing), each in the order of at_commit.

    A finding id names a construct for most rules, but for some it names a value or a name within the
    file (secret-exposed: the provider and the secret; test-no-assert and test-newly-skipped: the test
    case name), so several findings at the commit can share one. For each rule, file and id, as many
    findings as the parent run reports are pre-existing and the rest are introduced. added maps a file
    to the line numbers the change added there (materialise.added_lines): the findings on added lines
    are introduced first, then those on the latest lines.
    """
    added = added or {}
    held = Counter(_key(f) for f in at_parent)
    groups: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for i, f in enumerate(at_commit):
        groups[_key(f)].append(i)
    old: set[int] = set()
    for key, idx in groups.items():
        ranked = sorted(idx, key=lambda i: (at_commit[i].line in added.get(at_commit[i].file, ()), at_commit[i].line))
        old.update(ranked[:held[key]])
    return ([f for i, f in enumerate(at_commit) if i not in old], [f for i, f in enumerate(at_commit) if i in old])


def split_duplicates(findings: list[Finding], repository: dict[str, str],
                     preexisting: list[Finding]) -> tuple[list[Finding], list[Finding]]:
    """(first, duplicates): the introduced occurrences of a (repository, rule, file, id) an earlier diff already counts.

    repository maps a diff id to repository_of(diff); preexisting holds each diff's pre-existing findings
    (split_preexisting). A diff whose parent run reports p of a key and which introduces n more introduces
    occurrences p+1 to p+n of it. Diffs are taken in id order: an occurrence an earlier diff from that
    repository already introduced is a duplicate, taken from the diff's earliest lines. So in linear history
    a later diff that adds another occurrence beside ones its parent held introduces it, whatever the id
    order, and a reland onto a parent with the same count is a duplicate.
    """
    held = Counter((f.diff, _key(f)) for f in preexisting)
    counted: dict[tuple[str, str, str, str], set[int]] = defaultdict(set)
    dup: set[int] = set()
    groups: dict[tuple[str, tuple[str, str, str]], list[int]] = defaultdict(list)
    for i, f in enumerate(findings):
        groups[(f.diff, _key(f))].append(i)
    for diff, key in sorted(groups):
        idx = sorted(groups[(diff, key)], key=lambda i: findings[i].line)
        ranks = set(range(held[(diff, key)] + 1, held[(diff, key)] + len(idx) + 1))
        repo_key = (repository[diff], *key)
        dup.update(idx[:len(ranks & counted[repo_key])])
        counted[repo_key] |= ranks
    ordered = sorted(range(len(findings)), key=lambda i: findings[i].diff)
    return [findings[i] for i in ordered if i not in dup], [findings[i] for i in ordered if i in dup]


def split_missed_duplicates(ranked: list[tuple[str, Entry, tuple[str, str, bytes], int]],
                            repository: dict[str, str]) -> list[tuple[str, Entry]]:
    """The missed entries that name a construct an earlier diff (by id) from the same repository already introduced.

    ranked holds (diff, entry, (rule, file, line text), occurrence) from labels.missed_ranks. As with
    split_duplicates, an occurrence counts once per repository, in the first diff by id order, so a reland's
    missed construct is a duplicate, while a later diff that adds another line with that text is not.
    """
    counted: dict[tuple, set[int]] = defaultdict(set)
    dup: list[tuple[str, Entry]] = []
    for diff in sorted({d for d, *_ in ranked}):
        mine = [(e, (repository[diff], *key), rank) for d, e, key, rank in ranked if d == diff]
        dup += [(diff, e) for e, key, rank in mine if rank in counted[key]]
        for _, key, rank in mine:
            counted[key].add(rank)
    return dup


def drop_missed(labels: dict[str, LabelFile], dropped: list[tuple[str, Entry]]) -> dict[str, LabelFile]:
    """labels without the missed entries in dropped (split_missed_duplicates), which count only as duplicates."""
    gone = {id(e) for _, e in dropped}
    return {d: dataclasses.replace(lf, entries=[e for e in lf.entries if id(e) not in gone]) for d, lf in labels.items()}


def _is_missed(e: Entry) -> bool:
    return e.id is None or "missed" in (e.pass1, e.pass2)


def _ran(labels: dict[str, LabelFile], ran: set[str] | None) -> dict[str, LabelFile]:
    return labels if ran is None else {d: lf for d, lf in labels.items() if d in ran}


def _verdict(lf: LabelFile, e: Entry) -> str | None:
    """The verdict that counts: the confirmed one, and only in a file pass two signed with label.py confirm."""
    return e.verdict if lf.pass2 is not None else None


def _pending(labels: dict[str, LabelFile]) -> set[int]:
    """Object ids of entries in label files that pass two never confirmed."""
    return {id(e) for lf in labels.values() if lf.pass2 is None for e in lf.entries}


def _match(findings: list[Finding], labels: dict[str, LabelFile]) -> dict[int, Entry]:
    """Pair findings (by index) one to one with the entries that describe them.

    A finding matches an entry that is not a missed entry, in any pass state, on the same diff,
    rule, file, engine id and line. The engine can report one rule twice on a line with one id,
    and label.py new writes an entry for each, so equal keys pair up in order. A label file is
    written from the output of the locrin version it names, so anything else is not the finding
    that was labelled: the finding stays unlabelled and the entry unreproduced.
    """
    slots: dict[tuple[str, str, str, str | None, int], list[Entry]] = defaultdict(list)
    for diff, lf in labels.items():
        for e in lf.entries:
            if not _is_missed(e):
                slots[(diff, e.rule, e.file, e.id, e.line)].append(e)
    matched: dict[int, Entry] = {}
    for i, f in enumerate(findings):
        free = slots.get((f.diff, f.rule, f.file, f.id, f.line))
        if free:
            matched[i] = free.pop(0)
    return matched


def _stale(labels: dict[str, LabelFile], matched: dict[int, Entry]) -> list[tuple[str, Entry]]:
    used = {id(e) for e in matched.values()}
    out = [(d, e) for d, lf in labels.items() for e in lf.entries
           if _verdict(lf, e) == "true" and not _is_missed(e) and id(e) not in used]
    return sorted(out, key=lambda de: (de[0], de[1].rule, de[1].file, de[1].line))


def _unreproduced(labels: dict[str, LabelFile], matched: dict[int, Entry]) -> list[tuple[str, Entry]]:
    used = {id(e) for e in matched.values()}
    out = [(d, e) for d, lf in labels.items() for e in lf.entries if not _is_missed(e) and id(e) not in used]
    return sorted(out, key=lambda de: (de[0], de[1].rule, de[1].file, de[1].line))


def unreproduced(findings: list[Finding], labels: dict[str, LabelFile], ran: set[str] | None = None) -> list[tuple[str, Entry]]:
    """Every entry for a reported finding that no finding of the run matches, as (diff, entry).

    Whatever its verdict (true, false-positive, not-applicable, disagreeing or unfilled): a
    label file names the locrin version it was written from, so for a run of that version an
    entry no finding matches means the run did not reproduce the engine output that was
    labelled. Missed entries are never listed. With ran given, only label files for those diff
    ids are read. Sorted by diff, rule, file and line.
    """
    labels = _ran(labels, ran)
    return _unreproduced(labels, _match(findings, labels))


def _excluded_missed(labels: dict[str, LabelFile]) -> list[tuple[str, Entry]]:
    return [(d, e) for d, lf in labels.items() for e in lf.entries if _is_missed(e) and _verdict(lf, e) is None]


def excluded_missed(labels: dict[str, LabelFile], ran: set[str] | None = None) -> list[tuple[str, Entry]]:
    """Missed entries whose label has no verdict that counts, as (diff, entry); they count nowhere."""
    return _excluded_missed(_ran(labels, ran))


def excluded_count(findings: list[Finding], labels: dict[str, LabelFile], ran: set[str] | None = None) -> int:
    """How many findings and missed entries count nowhere because their label has no verdict that counts."""
    labels = _ran(labels, ran)
    return len(excluded(findings, labels)) + len(_excluded_missed(labels))


def stale(findings: list[Finding], labels: dict[str, LabelFile], ran: set[str] | None = None) -> list[tuple[str, Entry]]:
    """Confirmed true entries that no finding of the scored run matches, as (diff, entry).

    The engine no longer reports them, so score() counts each as missed. With ran given,
    only label files for those diff ids are read. Sorted by diff, rule, file and line.
    """
    labels = _ran(labels, ran)
    return _stale(labels, _match(findings, labels))


def _verdicts(findings: list[Finding], labels: dict[str, LabelFile]) -> dict[int, str | None]:
    """For each finding (by index) a label entry covers, the verdict that counts (None when there is none)."""
    pending = _pending(labels)
    return {i: None if id(e) in pending else e.verdict for i, e in _match(findings, labels).items()}


def excluded(findings: list[Finding], labels: dict[str, LabelFile], ran: set[str] | None = None) -> list[Finding]:
    """Findings whose matching entry has no verdict that counts, so they count nowhere.

    That is an entry left unfilled, one whose passes disagree, or any entry in a label file
    pass two never confirmed. With ran given, only label files for those diff ids are read.
    """
    verdicts = _verdicts(findings, _ran(labels, ran))
    return [f for i, f in enumerate(findings) if i in verdicts and verdicts[i] is None]


def not_applicable(findings: list[Finding], labels: dict[str, LabelFile], ran: set[str] | None = None) -> list[Finding]:
    """Findings whose confirmed verdict is not-applicable, so they count nowhere."""
    verdicts = _verdicts(findings, _ran(labels, ran))
    return [f for i, f in enumerate(findings) if i in verdicts and verdicts[i] == "not-applicable"]


def score(findings: list[Finding], labels: dict[str, LabelFile], rules: dict[str, RuleMeta], *, ran: set[str] | None = None,
          preexisting: list[Finding] = (), duplicates: list[Finding] = (),
          missed_duplicates: list[tuple[str, Entry]] = ()) -> tuple[list[Score], list[Score], list[Finding]]:
    """Per-rule scores, per-pair scores and the findings no label entry covers.

    findings are the findings each diff introduced, first in their repository (see
    split_preexisting and split_duplicates). preexisting and duplicates are the findings
    left out for those reasons, and missed_duplicates the missed entries an earlier diff from the
    repository already counts (split_missed_duplicates): they are only counted, per rule and per pair.

    With ran given, label files for diffs not in it are ignored entirely, so a diff that
    failed to materialise or run neither adds its missed entries nor loses its true ones.
    Without it every label file counts, as if every labelled diff ran.

    Each finding is matched to at most one entry and each entry to at most one finding (see
    _match). Only confirmed entries count; a finding whose entry is unfilled or disagrees
    counts nowhere but is not unlabelled, because the label file already lists it: it is
    counted in its rule's and pair's excluded count, as is a missed entry without a verdict
    that counts. A finding confirmed not-applicable counts nowhere and is counted as such. A
    finding with no matching entry is unlabelled and counts nowhere. A missed entry never
    matches a finding: it is counted straight from the label file, so a miss on the same line
    as a reported finding still counts toward recall, and a finding that lands on a missed
    entry's line is unlabelled so it gets relabelled. A confirmed true entry that no finding
    matches meets the missed definition for this run, so it counts as missed; stale() lists
    those entries. Within one locrin version that cannot happen in a published run:
    unreproduced() lists every such entry, and bench.main refuses to publish while any exist.
    """
    labels = drop_missed(_ran(labels, ran), list(missed_duplicates))
    rule_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    pair_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    rule_side: dict[str, dict[str, int]] = {name: defaultdict(int) for name in SIDE}
    pair_side: dict[str, dict[str, int]] = {name: defaultdict(int) for name in SIDE}
    rule_keys: set[str] = set()
    pairs: set[str] = set()

    def note(name: str, rule: str, lang: str | None) -> None:
        rule_keys.add(rule)
        if name:
            rule_side[name][rule] += 1
        if lang:
            pairs.add(f"{rule}@{lang}")
            if name:
                pair_side[name][f"{rule}@{lang}"] += 1

    def count(idx: int, rule: str, lang: str | None) -> None:
        note("", rule, lang)
        rule_counts[rule][idx] += 1
        if lang:
            pair_counts[f"{rule}@{lang}"][idx] += 1

    for diff, lf in labels.items():
        for e in lf.entries:
            if _verdict(lf, e) is not None:
                note("", e.rule, language_of(e.file))
            if _verdict(lf, e) == "missed":
                count(2, e.rule, language_of(e.file))
    for _, e in _excluded_missed(labels):
        note("excluded", e.rule, language_of(e.file))
    for _, e in _stale(labels, _match(findings, labels)):
        count(2, e.rule, language_of(e.file))
    verdicts = _verdicts(findings, labels)
    unlabelled: list[Finding] = []
    for i, f in enumerate(findings):
        note("", f.rule, f.language)
        if i not in verdicts:
            unlabelled.append(f)
            note("unlabelled", f.rule, f.language)
            continue
        v = verdicts[i]
        if v is None:
            note("excluded", f.rule, f.language)
        elif v in ("true", "false-positive"):
            count(0 if v == "true" else 1, f.rule, f.language)
        else:
            note("not_applicable", f.rule, f.language)
    for name, dropped in (("preexisting", preexisting), ("duplicates", duplicates)):
        for f in dropped:
            note(name, f.rule, f.language)
    for _, e in missed_duplicates:
        note("duplicates", e.rule, language_of(e.file))
    rule_order = list(rules.keys()) + sorted(rule_keys - set(rules))
    return (_tally(rule_counts, rule_order, rule_side), _tally(pair_counts, sorted(pairs), pair_side), unlabelled)


def _pct(v: float | None) -> str:
    return "" if v is None else f"{round(v * 100)}%"


def _cell(v: float | None, is_precision: bool, scored: bool) -> str:
    s = _pct(v)
    if s and is_precision and scored and v is not None and v < LINE:
        if round(v * 100) >= round(LINE * 100):
            # Rounded, it would read as the line itself: show one decimal, rounded down.
            s = f"{math.floor(v * 1000) / 10:.1f}%"
        s += " (below line)"
    return s


def render_markdown(per_rule: list[Score], per_pair: list[Score], version: str, corpus_size: int, unlabelled: int,
                    rules: dict[str, RuleMeta] | None = None, ran: int | None = None, excluded: int = 0,
                    not_applicable: int = 0, preexisting: int = 0, duplicates: int = 0) -> str:
    rules = rules or {}

    def ships(key: str) -> str:
        rule, _, language = key.partition("@")
        meta = rules.get(rule)
        rule_on = rule in LOCKED or ((rule not in SHIPS_OFF) if meta is None else meta.enabled_by_default)
        if not rule_on or key in PAIRS_OFF:
            return "off"
        if language in OPT_IN_LANGUAGES:
            return "opt-in"
        return "locked" if rule in LOCKED else "on"

    def rows(scores: list[Score], head: str) -> list[str]:
        out = [f"| {head} | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded "
               "| Not applicable | Pre-existing | Duplicate | Note |",
               "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for s in scores:
            out.append(f"| `{s.key}` | {ships(s.key)} | {_cell(s.precision, True, s.scored)} | {_cell(s.recall, False, s.scored)} "
                       f"| {s.true} | {s.false_positive} | {s.missed} | {s.unlabelled} | {s.excluded} "
                       f"| {s.not_applicable} | {s.preexisting} | {s.duplicates} | {s.reason} |")
        return out

    # With ran, the heading says how many diffs were actually scored, so a table with failures never looks complete.
    diffs = f"{corpus_size} diffs" if ran is None else f"{ran} of {corpus_size} diffs ran"
    # The heading always says how many findings and missed entries the numbers leave out, and why.
    lines = [f"Locrin {version}, {diffs}. Left out of the numbers: {unlabelled} unlabelled, {excluded} without an agreed "
             f"and confirmed label, {not_applicable} not applicable, {preexisting} pre-existing and {duplicates} duplicate.", ""]
    # The rules the benchmark never scores are always listed, with the reason, even when no diff ran.
    listed = {s.key for s in per_rule}
    per_rule = per_rule + [Score(rule, 0, 0, 0, None, None, False, f"not benchmarked: {reason}")
                           for rule, reason in NOT_BENCHMARKED.items() if rule not in listed]
    lines += rows(per_rule, "Rule")
    if per_pair:
        lines += ["", *rows(per_pair, "Pair")]
        if any(s.key.partition("@")[2] in OPT_IN_LANGUAGES for s in per_pair):
            lines += ["", "Locrin reads PHP and Python only when `[languages]` turns them on, so their pairs ship "
                          "opt-in; the benchmark turns both on."]
    return "\n".join(lines) + "\n"

