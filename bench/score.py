"""Join findings with confirmed labels and compute precision and recall."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from bench.corpus import language_of
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


def _tally(counts: dict[str, list[int]], keys_in_order: list[str], unlabelled: dict[str, int],
           left_out: dict[str, int]) -> list[Score]:
    out = []
    for key in keys_in_order:
        t, fp, m = counts.get(key, [0, 0, 0])
        u = unlabelled.get(key, 0)
        x = left_out.get(key, 0)
        rule = key.split("@", 1)[0]
        precision = t / (t + fp) if t + fp else None
        recall = t / (t + m) if t + m else None
        if rule in NOT_BENCHMARKED:
            out.append(Score(key, t, fp, m, precision, recall, False, f"not benchmarked: {NOT_BENCHMARKED[rule]}", u, x))
        elif t + fp < MIN_N:
            # The gate counts confirmed labelled findings (true plus false positive), as the
            # engine's own gate counts findings; missed entries are not findings.
            out.append(Score(key, t, fp, m, precision, recall, False, "n<5, not scored", u, x))
        else:
            out.append(Score(key, t, fp, m, precision, recall, True, "", u, x))
    return out


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

    Candidates are the entries on the same (diff, rule, file) that are not missed entries,
    in any pass state. Each entry decides at most one finding, in three steps:

    1. Findings and entries with the same engine id and line pair up in order. The engine
       can report one rule twice on a line with one id, and label.py new writes an entry
       for each of them.
    2. Findings left over match entries left over with their id on other lines. When as
       many entries as findings are left for that id they pair up in line order (an edit
       above moved them all); otherwise only when exactly one such entry is left and the
       findings left with that id share a line, and then it decides the first of them.
    3. A finding left over whose id no entry left over carries matches by line, only when
       exactly one such finding and exactly one entry are left on that line, and only
       entries whose id no finding in the group carries.

    Anything else is ambiguous: the finding stays unmatched rather than borrowing a verdict
    that belongs to another finding.
    """
    pool: dict[tuple[str, str, str], list[Entry]] = defaultdict(list)
    for diff, lf in labels.items():
        for e in lf.entries:
            if not _is_missed(e):
                pool[(diff, e.rule, e.file)].append(e)
    groups: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for i, f in enumerate(findings):
        groups[(f.diff, f.rule, f.file)].append(i)
    matched: dict[int, Entry] = {}
    for key, idxs in groups.items():
        entries = pool.get(key, [])
        used: set[int] = set()

        def take(i: int, j: int) -> None:
            matched[i] = entries[j]
            used.add(j)

        # 1. same id and line, zip-style.
        slots: dict[tuple[str | None, int], list[int]] = defaultdict(list)
        for j, e in enumerate(entries):
            slots[(e.id, e.line)].append(j)
        rest: list[int] = []
        for i in idxs:
            free = slots.get((findings[i].id, findings[i].line))
            if free:
                take(i, free.pop(0))
            else:
                rest.append(i)
        # 2. same id on another line, when unambiguous.
        by_id: dict[str, list[int]] = defaultdict(list)
        for i in rest:
            by_id[findings[i].id].append(i)
        left: list[int] = []
        for ident, its in by_id.items():
            cands = [j for j, e in enumerate(entries) if j not in used and e.id == ident]
            if len(cands) == len(its):
                for i, j in zip(sorted(its, key=lambda i: (findings[i].line, i)), sorted(cands, key=lambda j: (entries[j].line, j))):
                    take(i, j)
            elif len(cands) == 1 and len({findings[i].line for i in its}) == 1:
                take(its[0], cands[0])
                left.extend(its[1:])
            else:
                left.extend(its)
        # 3. line fallback over entries no finding claims by id.
        claimed = {findings[i].id for i in idxs}
        open_ids = {e.id for j, e in enumerate(entries) if j not in used}
        pending: dict[int, list[int]] = defaultdict(list)
        for i in sorted(left):
            if findings[i].id not in open_ids:
                pending[findings[i].line].append(i)
        for line, its in pending.items():
            cands = [j for j, e in enumerate(entries) if j not in used and e.line == line and e.id not in claimed]
            if len(its) == 1 and len(cands) == 1:
                take(its[0], cands[0])
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


def excluded(findings: list[Finding], labels: dict[str, LabelFile], ran: set[str] | None = None) -> list[Finding]:
    """Findings whose matching entry has no verdict that counts, so they count nowhere.

    That is an entry left unfilled, one whose passes disagree, or any entry in a label file
    pass two never confirmed. Findings on not-applicable entries are not listed: their
    verdict is settled. With ran given, only label files for those diff ids are read.
    """
    labels = _ran(labels, ran)
    pending = _pending(labels)
    matched = _match(findings, labels)
    return [f for i, f in enumerate(findings)
            if i in matched and (matched[i].verdict is None or id(matched[i]) in pending)]


def score(findings: list[Finding], labels: dict[str, LabelFile], rules: dict[str, RuleMeta], *, ran: set[str] | None = None) -> tuple[list[Score], list[Score], list[Finding]]:
    """Per-rule scores, per-pair scores and the findings no label entry covers.

    With ran given, label files for diffs not in it are ignored entirely, so a diff that
    failed to materialise or run neither adds its missed entries nor loses its true ones.
    Without it every label file counts, as if every labelled diff ran.

    Each finding is matched to at most one entry and each entry to at most one finding (see
    _match). Only confirmed entries count; a finding whose entry is unfilled or disagrees
    counts nowhere but is not unlabelled, because the label file already lists it: it is
    counted in its rule's and pair's excluded count, as is a missed entry without a verdict
    that counts. bench.main refuses to publish unless the only such entries disagree. A finding
    with no matching entry is unlabelled and counts nowhere. A missed entry never matches a
    finding: it is counted straight from the label file, so a miss on the same line as a
    reported finding still counts toward recall, and a finding that lands on a missed
    entry's line is unlabelled so it gets relabelled. A confirmed true entry that no finding
    matches meets the missed definition for this run, so it counts as missed; stale() lists
    those entries. Within one locrin version that cannot happen in a published run:
    unreproduced() lists every such entry, and bench.main refuses to publish while any exist.
    """
    labels = _ran(labels, ran)
    rule_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    pair_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    label_rules: set[str] = set()
    pairs: set[str] = set()
    rule_excluded: dict[str, int] = defaultdict(int)
    pair_excluded: dict[str, int] = defaultdict(int)

    def leave_out(rule: str, lang: str | None) -> None:
        rule_excluded[rule] += 1
        if lang:
            pair_excluded[f"{rule}@{lang}"] += 1
            pairs.add(f"{rule}@{lang}")

    def miss(e: Entry) -> None:
        rule_counts[e.rule][2] += 1
        lang = language_of(e.file)
        if lang:
            pair_counts[f"{e.rule}@{lang}"][2] += 1

    for diff, lf in labels.items():
        for e in lf.entries:
            if _verdict(lf, e) is None:
                continue
            label_rules.add(e.rule)
            lang = language_of(e.file)
            if lang:
                pairs.add(f"{e.rule}@{lang}")
            if e.verdict == "missed":
                miss(e)
    for _, e in _excluded_missed(labels):
        leave_out(e.rule, language_of(e.file))
    matched = _match(findings, labels)
    pending = _pending(labels)
    for _, e in _stale(labels, matched):
        miss(e)
    unlabelled: list[Finding] = []
    rule_unlabelled: dict[str, int] = defaultdict(int)
    pair_unlabelled: dict[str, int] = defaultdict(int)
    for i, f in enumerate(findings):
        if f.language:
            pairs.add(f"{f.rule}@{f.language}")
        entry = matched.get(i)
        if entry is None:
            unlabelled.append(f)
            rule_unlabelled[f.rule] += 1
            if f.language:
                pair_unlabelled[f"{f.rule}@{f.language}"] += 1
            continue
        v = None if id(entry) in pending else entry.verdict
        if v is None:
            leave_out(f.rule, f.language)
            continue
        if v not in ("true", "false-positive"):
            continue
        idx = 0 if v == "true" else 1
        rule_counts[f.rule][idx] += 1
        if f.language:
            pair_counts[f"{f.rule}@{f.language}"][idx] += 1
    extra = (label_rules | set(rule_counts) | set(rule_unlabelled) | set(rule_excluded)) - set(rules)
    rule_order = list(rules.keys()) + sorted(extra)
    pair_order = sorted(pairs)
    return (_tally(rule_counts, rule_order, rule_unlabelled, rule_excluded),
            _tally(pair_counts, pair_order, pair_unlabelled, pair_excluded), unlabelled)


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


def render_markdown(per_rule: list[Score], per_pair: list[Score], version: str, corpus_size: int, unlabelled: int, rules: dict[str, RuleMeta] | None = None, ran: int | None = None, excluded: int = 0) -> str:
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
        out = [f"| {head} | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Note |",
               "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for s in scores:
            out.append(f"| `{s.key}` | {ships(s.key)} | {_cell(s.precision, True, s.scored)} | {_cell(s.recall, False, s.scored)} "
                       f"| {s.true} | {s.false_positive} | {s.missed} | {s.unlabelled} | {s.excluded} | {s.reason} |")
        return out

    # With ran, the heading says how many diffs were actually scored, so a table with failures never looks complete.
    diffs = f"{corpus_size} diffs" if ran is None else f"{ran} of {corpus_size} diffs ran"
    # The heading always says how many findings and missed entries the numbers leave out.
    lines = [f"Locrin {version}, {diffs}, {unlabelled} unlabelled findings, {excluded} excluded until their label passes agree.", ""]
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

