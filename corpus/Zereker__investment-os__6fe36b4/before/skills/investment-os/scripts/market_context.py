#!/usr/bin/env python3
"""Fetch the market-context block for the daily and monthly reviews.

Why this exists: the sources are large — the CNN feed is ~177KB of which one
object is wanted — and reading them into an agent's context costs more than
every other file the task loads combined. This script does the fetching and the
reduction, so the session sees a handful of lines instead of the payloads.

What this block IS: disclosure printed alongside a decision.
What it is NOT: an input to any rule. No funding channel, gap, tier or sell
condition takes a value from here (00-constitution.md decision principle 7 —
the system holds no valuation judgement). The one exception is VIX, which
classifies a session as volatile for the limit-order preference in
02-monthly.md part 2 section 5 — that changes the order type, never whether or
how much to buy.

Hard boundaries, the same ones the rest of the runtime keeps:
  - It NEVER estimates. A source that fails prints 缺(reason), not a guess.
  - It NEVER carries a value forward from a previous run.
  - It NEVER writes to disk. Values live in stdout only.
  - It produces no buy/sell language and reaches no conclusion.

Values the broker owns are passed in rather than fetched, so each number comes
from its best source: --vix-close and --spym-series come from IBKR via the
session, the valuation and sentiment sources are fetched here.

Usage:
  python3 market_context.py --vix-close 14.43 --vix-as-of 2026-08-28
  python3 market_context.py --spym-series prices.json --no-pe      # skip valuation
  python3 market_context.py --pe-only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import date

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://edition.cnn.com/",
    "Origin": "https://edition.cnn.com",
}
CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
MULTPL_URL = "https://www.multpl.com/s-p-500-pe-ratio"
MULTPL_TABLE = "https://www.multpl.com/s-p-500-pe-ratio/table/by-month"
# multpl publishes GAAP as-reported earnings. Broker and app figures usually use
# operating earnings and run ~10% lower on the same day. Both are defensible;
# mixing them is not, so the caliber travels with the number everywhere.
PE_CALIBER = "GAAP as-reported (multpl)"
# VIX bands from the published scale; observation labels, not signals.
VIX_BANDS = ((15, "平静"), (20, "中性"), (30, "开始紧张"), (40, "剧烈波动"), (60, "罕见恐慌"))
VOLATILE_SESSION_VIX = 20.0   # at or above this, prefer limit orders

MONTHS = {m: i for i, m in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}


def _get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def fear_and_greed() -> dict:
    """Return CNN's index object, or a 缺 record. The response carries a year of
    daily series for eight sub-indicators; every one of them is discarded."""
    try:
        whole = json.loads(_get(CNN_URL))
    except Exception as exc:
        return {"missing": f"CNN 接口不可达（{type(exc).__name__}）"}
    obj = whole.get("fear_and_greed")
    if not isinstance(obj, dict) or obj.get("score") is None:
        return {"missing": "CNN 返回体中没有 fear_and_greed"}
    return {
        "score": round(float(obj["score"]), 1),
        "rating": obj.get("rating"),
        "as_of": (obj.get("timestamp") or "")[:10],
        "prev_close": _round(obj.get("previous_close")),
        "prev_1w": _round(obj.get("previous_1_week")),
        "prev_1m": _round(obj.get("previous_1_month")),
        "prev_1y": _round(obj.get("previous_1_year")),
    }


def _round(v, n=1):
    return None if v is None else round(float(v), n)


def pe_current() -> dict:
    try:
        html = _get(MULTPL_URL)
    except Exception as exc:
        return {"missing": f"multpl 不可达（{type(exc).__name__}）"}
    val = re.search(r'id="current".*?</b>\s*([\d.]+)', html, re.S)
    ts = re.search(r'id="timestamp">\s*(.*?)\s*</div>', html, re.S)
    if not val:
        return {"missing": "multpl 页面结构变化，未解析到当前 PE"}
    return {"value": float(val.group(1)),
            "as_of": re.sub(r"\s+", " ", ts.group(1)) if ts else None,
            "caliber": PE_CALIBER}


def pe_history() -> list[dict]:
    """Monthly GAAP PE series. multpl publishes no daily history — a 1-year
    window is 12 points, which is why sample size is reported with every rank."""
    try:
        html = _get(MULTPL_TABLE)
    except Exception:
        return []
    rows = re.findall(
        r"<td>([A-Z][a-z]{2}) (\d{1,2}), (\d{4})</td>\s*<td>.*?([\d.]+)\s*</td>",
        html, re.S)
    out = []
    for mon, day, year, value in rows:
        if mon not in MONTHS:
            continue
        out.append({"date": f"{year}-{MONTHS[mon]:02d}-{int(day):02d}",
                    "value": float(value)})
    return sorted(out, key=lambda r: r["date"])


def percentile(current: float | None, values: list[float]) -> dict | None:
    """Share of the sample at or below the current value. Lower = cheaper
    against its own history."""
    vals = [v for v in values if v is not None]
    if current is None or not vals:
        return None
    if len(vals) < 8:
        return {"percentile": None, "n": len(vals), "note": "样本不足 8 个，按缺处理"}
    below = sum(1 for v in vals if v <= current)
    return {"percentile": round(below / len(vals) * 100, 1), "n": len(vals),
            "min": round(min(vals), 2), "max": round(max(vals), 2)}


def pe_ranks(current: float | None, history: list[dict],
             windows=(1, 5, 10)) -> dict:
    if current is None or not history:
        return {}
    last = history[-1]["date"]
    y, m, d = (int(x) for x in last.split("-"))
    out = {}
    for w in windows:
        try:
            cutoff = date(y - w, m, d).isoformat()
        except ValueError:
            cutoff = date(y - w, m, 28).isoformat()
        out[f"{w}y"] = percentile(
            current, [r["value"] for r in history if r["date"] >= cutoff])
    return out


def band(value: float | None, bands) -> str | None:
    if value is None:
        return None
    for edge, label in bands:
        if value < edge:
            return label
    return bands[-1][1]


def series_stats(path: str | None) -> dict:
    """All-time-high close, drawdown and 52-week range from a daily close series.

    Uses the all-time high, matching the drawdown clause — deliberately not a
    zigzag pivot, which would measure from the most recent swing high and
    silently redefine DD and therefore the tier triggers.
    """
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except Exception as exc:
        return {"missing": f"价格序列不可读（{type(exc).__name__}）"}
    pts = sorted(({"date": r["date"], "close": float(r["close"])}
                  for r in raw if r.get("close") is not None),
                 key=lambda p: p["date"])
    if len(pts) < 2:
        return {"missing": "价格样本少于 2 条"}
    ath = max(pts, key=lambda p: p["close"])
    last = pts[-1]
    out = {"n_days": len(pts), "first": pts[0]["date"],
           "ath_close": ath["close"], "ath_date": ath["date"],
           "last_close": last["close"], "last_date": last["date"],
           "dd": round((ath["close"] - last["close"]) / ath["close"], 4)}
    if len(pts) >= 200:
        w = pts[-252:]
        hi, lo = max(w, key=lambda p: p["close"]), min(w, key=lambda p: p["close"])
        out["high_52w"] = {"close": hi["close"], "date": hi["date"]}
        out["low_52w"] = {"close": lo["close"], "date": lo["date"]}
    else:
        out["window_note"] = "样本少于约 200 日，52 周高低不计算"
    return out


def fmt(label: str, body: str) -> None:
    print(f"  {label:<14}{body}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vix-close", type=float, default=None,
                    help="VIX 最后一个已完成日线收盘（由会话从 IBKR 读取后传入）")
    ap.add_argument("--vix-as-of", default=None, help="该收盘的日期 YYYY-MM-DD")
    ap.add_argument("--spym-series", default=None,
                    help='SPYM 日收盘 JSON：[{"date": "...", "close": 90.57}, ...]')
    ap.add_argument("--no-pe", action="store_true", help="跳过估值取数")
    ap.add_argument("--no-sentiment", action="store_true", help="跳过恐慌贪婪取数")
    ap.add_argument("--pe-only", action="store_true", help="只取估值")
    ap.add_argument("--json", action="store_true", help="输出 JSON 而非文本块")
    args = ap.parse_args()

    want_pe = not args.no_pe
    want_sent = not args.no_sentiment and not args.pe_only
    if args.pe_only:
        want_pe = True

    data: dict = {}
    if args.spym_series:
        data["spym"] = series_stats(args.spym_series)
    if args.vix_close is not None:
        data["vix"] = {"close": args.vix_close, "as_of": args.vix_as_of,
                       "band": band(args.vix_close, VIX_BANDS),
                       "volatile_session": args.vix_close >= VOLATILE_SESSION_VIX}
    if want_pe:
        cur = pe_current()
        data["pe"] = cur
        if "value" in cur:
            hist = pe_history()
            data["pe"]["ranks"] = pe_ranks(cur["value"], hist)
            data["pe"]["history_n"] = len(hist)
            data["pe"]["frequency"] = "月度"
    if want_sent:
        data["fear_greed"] = fear_and_greed()

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    print("市场背景 — 只作披露，不进入任何闸门；本块不产出买卖结论")
    print("-" * 66)

    s = data.get("spym")
    if s:
        if "missing" in s:
            fmt("SPYM 回撤", f"缺（{s['missing']}）")
        else:
            fmt("SPYM 回撤", f"DD {s['dd']:.2%}  收盘 {s['last_close']} ({s['last_date']})  "
                             f"ATH {s['ath_close']} ({s['ath_date']})")
            if "high_52w" in s:
                fmt("52 周区间", f"{s['low_52w']['close']} ({s['low_52w']['date']}) – "
                                 f"{s['high_52w']['close']} ({s['high_52w']['date']})")
            else:
                fmt("52 周区间", f"缺（{s['window_note']}）")

    v = data.get("vix")
    if v:
        tail = "  → 波动日，优先限价单" if v["volatile_session"] else ""
        fmt("VIX", f"{v['close']} ({v['as_of'] or '日期未传'})  {v['band']}{tail}")
    elif not args.pe_only:
        fmt("VIX", "缺（未传 --vix-close）")

    p = data.get("pe")
    if p:
        if "missing" in p:
            fmt("SPX PE-TTM", f"缺（{p['missing']}）")
        else:
            fmt("SPX PE-TTM", f"{p['value']}  口径 {p['caliber']}  截至 {p['as_of']}")
            for w, r in (p.get("ranks") or {}).items():
                if r is None:
                    fmt(f"  {w} 分位", "缺")
                elif r["percentile"] is None:
                    fmt(f"  {w} 分位", f"缺（{r['note']}，n={r['n']}）")
                else:
                    fmt(f"  {w} 分位", f"{r['percentile']}%  （{r['n']} 个{p['frequency']}点，"
                                        f"区间 {r['min']}–{r['max']}）")

    f = data.get("fear_greed")
    if f:
        if "missing" in f:
            fmt("恐慌贪婪", f"缺（{f['missing']}）")
        else:
            fmt("恐慌贪婪", f"{f['score']} {f['rating']}  截至 {f['as_of']}  "
                             f"（前收 {f['prev_close']} / 周 {f['prev_1w']} / "
                             f"月 {f['prev_1m']} / 年 {f['prev_1y']}）")

    print("-" * 66)
    print("  以上不构成买卖理由。资金通道、缺口与档位只由 00-constitution.md 的公式决定。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
