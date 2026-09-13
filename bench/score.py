"""Join findings with confirmed labels and compute precision and recall."""
from __future__ import annotations

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


def _tally(counts: dict[str, list[int]], keys_in_order: list[str]) -> list[Score]:
    out = []
    for key in keys_in_order:
        t, fp, m = counts.get(key, [0, 0, 0])
        rule = key.split("@", 1)[0]
        precision = t / (t + fp) if t + fp else None
        recall = t / (t + m) if t + m else None
        if rule in NOT_BENCHMARKED:
            out.append(Score(key, t, fp, m, precision, recall, False, f"not benchmarked: {NOT_BENCHMARKED[rule]}"))
        elif t + fp < MIN_N:
            # The gate counts confirmed labelled findings (true plus false positive), as the
            # engine's own gate counts findings; missed entries are not findings.
            out.append(Score(key, t, fp, m, precision, recall, False, "n<5, not scored"))
        else:
            out.append(Score(key, t, fp, m, precision, recall, True, ""))
    return out


def _is_missed(e: Entry) -> bool:
    return e.id is None or "missed" in (e.pass1, e.pass2)


def _match(findings: list[Finding], labels: dict[str, LabelFile]) -> dict[int, Entry]:
    """Pair each finding (by index) with the one entry that describes it, if any.

    Candidates are the entries on the same (diff, rule, file) that are not missed entries,
    in any pass state. An entry whose engine id equals the finding's id decides it; if
    several share that id, the one on the finding's line decides it. With no id match the
    line decides, but only when exactly one finding and exactly one entry remain on that
    line, and only entries whose id no finding in the run carries. Anything else is
    ambiguous and the finding stays unmatched rather than borrowing a sibling's verdict.
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
        claimed = {findings[i].id for i in idxs}
        pending: dict[int, list[int]] = defaultdict(list)
        for i in idxs:
            f = findings[i]
            same_id = [e for e in entries if e.id == f.id]
            if not same_id:
                pending[f.line].append(i)
                continue
            if len(same_id) > 1:
                same_id = [e for e in same_id if e.line == f.line]
            if len(same_id) == 1:
                matched[i] = same_id[0]
        for line, waiting in pending.items():
            free = [e for e in entries if e.line == line and e.id not in claimed]
            if len(waiting) == 1 and len(free) == 1:
                matched[waiting[0]] = free[0]
    return matched


def score(findings: list[Finding], labels: dict[str, LabelFile], rules: dict[str, RuleMeta]) -> tuple[list[Score], list[Score], list[Finding]]:
    """Per-rule scores, per-pair scores and the findings no label entry covers.

    Each finding is matched to at most one entry (see _match): by engine id first, then by
    line when that is unambiguous. Only confirmed entries count; a finding whose entry is
    unfilled or disagrees counts nowhere but is not unlabelled, because the label file
    already lists it. A finding with no matching entry is unlabelled and counts nowhere.
    A missed entry never matches a finding: it is counted straight from the label file,
    so a miss on the same line as a reported finding still counts toward recall, and a
    finding that lands on a missed entry's line is unlabelled so it gets relabelled.
    """
    rule_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    pair_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    label_rules: set[str] = set()
    pairs: set[str] = set()
    for diff, lf in labels.items():
        for e in lf.entries:
            if not e.confirmed:
                continue
            label_rules.add(e.rule)
            lang = language_of(e.file)
            if lang:
                pairs.add(f"{e.rule}@{lang}")
            if e.verdict == "missed":
                rule_counts[e.rule][2] += 1
                if lang:
                    pair_counts[f"{e.rule}@{lang}"][2] += 1
    matched = _match(findings, labels)
    unlabelled: list[Finding] = []
    for i, f in enumerate(findings):
        if f.language:
            pairs.add(f"{f.rule}@{f.language}")
        entry = matched.get(i)
        if entry is None:
            unlabelled.append(f)
            continue
        v = entry.verdict
        if v not in ("true", "false-positive"):
            continue
        idx = 0 if v == "true" else 1
        rule_counts[f.rule][idx] += 1
        if f.language:
            pair_counts[f"{f.rule}@{f.language}"][idx] += 1
    extra = (label_rules | set(rule_counts)) - set(rules)
    rule_order = list(rules.keys()) + sorted(extra)
    pair_order = sorted(pairs)
    return _tally(rule_counts, rule_order), _tally(pair_counts, pair_order), unlabelled


def _pct(v: float | None) -> str:
    return "" if v is None else f"{round(v * 100)}%"


def _cell(v: float | None, is_precision: bool, scored: bool) -> str:
    s = _pct(v)
    if s and is_precision and scored and v is not None and v < LINE:
        s += " (below line)"
    return s


def render_markdown(per_rule: list[Score], per_pair: list[Score], version: str, corpus_size: int, unlabelled: int, rules: dict[str, RuleMeta] | None = None) -> str:
    rules = rules or {}

    def ships(key: str) -> str:
        rule = key.split("@", 1)[0]
        if rule in LOCKED:
            return "locked"
        if key in PAIRS_OFF:
            return "off"
        meta = rules.get(rule)
        if meta is None:
            return "off" if rule in SHIPS_OFF else "on"
        return "on" if meta.enabled_by_default else "off"

    def rows(scores: list[Score], head: str) -> list[str]:
        out = [f"| {head} | Ships | Precision | Recall | True | False positive | Missed | Note |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for s in scores:
            out.append(f"| `{s.key}` | {ships(s.key)} | {_cell(s.precision, True, s.scored)} | {_cell(s.recall, False, s.scored)} | {s.true} | {s.false_positive} | {s.missed} | {s.reason} |")
        return out

    lines = [f"Locrin {version}, {corpus_size} diffs, {unlabelled} unlabelled findings.", ""]
    lines += rows(per_rule, "Rule")
    if per_pair:
        lines += ["", *rows(per_pair, "Pair")]
    return "\n".join(lines) + "\n"
