"""Join findings with confirmed labels and compute precision and recall."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from bench.corpus import language_of
from bench.labels import LabelFile
from bench.run import Finding, RuleMeta

NOT_BENCHMARKED = {
    "vulnerable-dependency": "advisory feed changes daily",
    "boundary-violation": "needs per-repository config",
    "express-route-without-auth": "needs per-repository config",
}
LOCKED = {"secret-exposed"}
SHIPS_OFF = {"dead-file", "swallowed-error", "injection-sink"}
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
        elif t + fp + m < MIN_N:
            out.append(Score(key, t, fp, m, precision, recall, False, "n<5, not scored"))
        else:
            out.append(Score(key, t, fp, m, precision, recall, True, ""))
    return out


def score(findings: list[Finding], labels: dict[str, LabelFile], rules: dict[str, RuleMeta]) -> tuple[list[Score], list[Score], list[Finding]]:
    """Per-rule scores, per-pair scores and the findings no label entry covers.

    A finding matches an entry on (diff, rule, file, line). Only confirmed entries count;
    a finding whose entries are unfilled or disagree counts nowhere but is not unlabelled,
    because the label file already lists it. A finding with no entry at all is unlabelled.
    A missed entry never matches a finding: it is counted straight from the label file,
    so a miss on the same line as a reported finding still counts toward recall.
    """
    rule_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    pair_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    label_rules: set[str] = set()
    pairs: set[str] = set()
    by_key: dict[tuple[str, str, str, int], str] = {}
    entry_keys: set[tuple[str, str, str, int]] = set()
    for diff, lf in labels.items():
        for e in lf.entries:
            entry_keys.add((diff, e.rule, e.file, e.line))
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
            else:
                by_key[(diff, e.rule, e.file, e.line)] = e.verdict
    unlabelled: list[Finding] = []
    for f in findings:
        if f.language:
            pairs.add(f"{f.rule}@{f.language}")
        k = (f.diff, f.rule, f.file, f.line)
        if k not in entry_keys:
            unlabelled.append(f)
            continue
        v = by_key.get(k)
        if v is None or v == "not-applicable":
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
