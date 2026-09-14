#!/usr/bin/env node
/**
 * NFL ANYTIME TOUCHDOWN — HISTORICAL WALK-FORWARD REPLAY (P301)
 *
 * Executes data/internal/research/nfl/reports/anytime-td-historical-replay-preregistration.json. Every constant,
 * gate, grid and bar is read from its `frozen` block. The table is player-games-v2 (touchdown columns), built by
 * scripts/research/nfl/build-player-games-v2.mjs; both hashes are pinned.
 *
 *   --validate            DEV seasons only (2022–2025). A metric call on a non-dev row throws.
 *   --score --now <ISO>   the ONE look at held-out 2014–2021. Refuses unless the registration is committed and
 *                         unmodified, and refuses if the evaluation file already exists. Those checks run FIRST.
 *
 * League constants are computed from the 2013 warm-up season inside the run (walk-forward: 2013 is never scored).
 * Lives outside app/ on purpose: the Vercel ignore step builds only when app/ changes.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rel = (p) => path.join(ROOT, p);
const PREREG_PATH = "data/internal/research/nfl/reports/anytime-td-historical-replay-preregistration.json";
const OUT_PATH = "data/internal/research/nfl/reports/anytime-td-historical-replay-evaluation.json";
const TABLE_PATH = "data/internal/research/nfl/replay/player-games-v2.json.gz";

const argv = process.argv.slice(2);
const MODE = argv.includes("--score") ? "score" : argv.includes("--validate") ? "validate" : null;
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(1); };
if (!MODE) refuse("usage: --validate | --score --now <ISO>");

const NOW = argOf("--now");
let preregCommit = null;
if (MODE === "score") {
  if (!NOW || !Number.isFinite(Date.parse(NOW))) refuse("--now <ISO> required");
  if (fs.existsSync(rel(OUT_PATH))) refuse(`${OUT_PATH} already exists — the held-out set has been looked at once`);
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  preregCommit = git("log", "-1", "--format=%H %cI", "--", PREREG_PATH);
  if (!preregCommit) refuse("the preregistration is not committed");
  try { git("diff", "--quiet", "HEAD", "--", PREREG_PATH); } catch { refuse("the preregistration has uncommitted changes"); }
}

const prereg = JSON.parse(fs.readFileSync(rel(PREREG_PATH), "utf8"));
const F = prereg.frozen;
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(rel(p))).digest("hex");
if (sha(TABLE_PATH) !== F.inputs.playerGamesSha256) refuse("player-games-v2 table does not match the registered hash");
if (sha("scripts/research/nfl/build-player-games-v2.mjs") !== F.inputs.buildScriptSha256) refuse("table build script does not match the registered hash");

const table = JSON.parse(zlib.gunzipSync(fs.readFileSync(rel(TABLE_PATH))));
const C = Object.fromEntries(table.columns.map((c, i) => [c, i]));
const inSeasons = (s, [a, b]) => s >= a && s <= b;
const MODELS = [...F.candidates, ...F.baselines];

// ── league constants from the warm-up season only ─────────────────────────────────────────────────
const warm = table.rows.filter((r) => inSeasons(r[C.season], F.seasons.warmup) && r[C.participation] !== "UNKNOWN");
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const warmTeamGames = Object.entries(table.teamTotals).filter(([k]) => Number(k.slice(0, 4)) >= F.seasons.warmup[0] && Number(k.slice(0, 4)) <= F.seasons.warmup[1]).map(([, v]) => v);
const anyTd = (r) => (r[C.rushTd] + r[C.recTd] + r[C.otherTd] > 0 ? 1 : 0);
const touched = warm.filter((r) => r[C.carries] + r[C.targets] > 0);
const LEAGUE = {
  rushTdPerCarry: sum(warm, (r) => r[C.rushTd]) / sum(warm, (r) => r[C.carries]),
  recTdPerTarget: sum(warm, (r) => r[C.recTd]) / sum(warm, (r) => r[C.targets]),
  teamRushTd: sum(warmTeamGames, (v) => v[3]) / warmTeamGames.length,
  teamRecTd: sum(warmTeamGames, (v) => v[4]) / warmTeamGames.length,
  otherTdPerPlayerGame: sum(touched, (r) => r[C.otherTd]) / touched.length,
  anytimeRate: sum(touched, anyTd) / touched.length,
};

// ── walk-forward state ────────────────────────────────────────────────────────────────────────────
const players = new Map();
const byTeam = new Map();
const teamForm = new Map();
const ST = (id) => {
  if (!players.has(id)) players.set(id, { team: null, games: 0, obs: { rush: [], targets: [], td: [] }, rates: { rushTd: [], recTd: [] }, recentAny: [] });
  return players.get(id);
};
const weight = (idxNow, idx, seasonNow, season, hl, bd) => 0.5 ** ((idxNow - idx) / hl) * bd ** Math.max(0, seasonNow - season);
function share(st, fam, season, shrinkK) {
  let num = 0;
  let den = 0;
  for (const o of st.obs[fam]) { const w = weight(st.games, o.idx, season, o.season, F.share.halfLifeGames, F.share.boundaryDecay); num += w * o.share; den += w; }
  return den > 0 ? num / (den + shrinkK) : 0;
}
function shrunkRate(st, key, league, season, priorTrials) {
  let num = 0;
  let den = 0;
  for (const o of st.rates[key]) { const w = weight(st.games, o.idx, season, o.season, F.rate.halfLifeGames, F.rate.boundaryDecay); num += w * o.num; den += w * o.den; }
  return (num + priorTrials * league) / (den + priorTrials);
}
function teamTd(team, season) {
  const t = teamForm.get(team);
  if (!t) return { rush: LEAGUE.teamRushTd, rec: LEAGUE.teamRecTd };
  const bd = F.teamForm.boundaryDecay ** Math.max(0, season - t.season);
  return { rush: LEAGUE.teamRushTd + (t.rush - LEAGUE.teamRushTd) * bd, rec: LEAGUE.teamRecTd + (t.rec - LEAGUE.teamRecTd) * bd };
}
function foldTeam(team, season, totals) {
  const alpha = 1 - 0.5 ** (1 / F.teamForm.halfLifeGames);
  const cur = teamTd(team, season);
  teamForm.set(team, { rush: cur.rush + alpha * (totals[3] - cur.rush), rec: cur.rec + alpha * (totals[4] - cur.rec), season });
}
const clip = (p) => Math.min(1 - F.probabilityClip, Math.max(F.probabilityClip, p));
const poissonAny = (mu) => clip(1 - Math.exp(-mu));

/** Every registered model's P(anytime TD) for one candidate player-game. */
function predict(st, season, lam) {
  const carryShare = share(st, "rush", season, 0);
  const targetShare = share(st, "targets", season, 0);
  const effRush = shrunkRate(st, "rushTd", LEAGUE.rushTdPerCarry, season, F.opportunityTd.rushPriorCarries) / LEAGUE.rushTdPerCarry;
  const effRec = shrunkRate(st, "recTd", LEAGUE.recTdPerTarget, season, F.opportunityTd.recPriorTargets) / LEAGUE.recTdPerTarget;
  const lamTeam = lam.rush + lam.rec;
  const recent = st.recentAny.slice(-F.rolling.games);
  return {
    opportunityTd: poissonAny(carryShare * lam.rush * effRush + targetShare * lam.rec * effRec + LEAGUE.otherTdPerPlayerGame),
    tdShareLevel: poissonAny(lamTeam * share(st, "td", season, 0) + LEAGUE.otherTdPerPlayerGame),
    tdShareShrunk: poissonAny(lamTeam * share(st, "td", season, F.baselineTdShrinkK) + LEAGUE.otherTdPerPlayerGame),
    rollingRate: clip((recent.reduce((a, b) => a + b, 0) + F.rolling.pseudoGames * LEAGUE.anytimeRate) / (recent.length + F.rolling.pseudoGames)),
  };
}

// ── the replay ────────────────────────────────────────────────────────────────────────────────────
const rows = [...table.rows].sort((a, b) => (a[C.date] !== b[C.date] ? (a[C.date] < b[C.date] ? -1 : 1) : a[C.gameId] < b[C.gameId] ? -1 : a[C.gameId] > b[C.gameId] ? 1 : 0));
const scored = [];
const counts = { void: {}, quarantined: {}, playedNoRowScored: {} };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

for (let i = 0; i < rows.length;) {
  let j = i;
  while (j < rows.length && rows[i][C.date] === rows[j][C.date]) j += 1;
  const day = rows.slice(i, j);
  const season = day[0][C.season];

  if (season > F.seasons.warmup[1]) {
    const teamGames = new Map();
    for (const r of day) {
      const k = `${r[C.gameId]}|${r[C.team]}`;
      if (!teamGames.has(k)) teamGames.set(k, { gameId: r[C.gameId], team: r[C.team], rows: new Map() });
      teamGames.get(k).rows.set(String(r[C.playerId]), r);
    }
    for (const tg of teamGames.values()) {
      const lam = teamTd(tg.team, season);
      for (const id of byTeam.get(tg.team) ?? []) {
        const st = players.get(id);
        if (share(st, "rush", season, 0) < F.gate.carryShare && share(st, "targets", season, 0) < F.gate.targetShare) continue;
        const row = tg.rows.get(id) ?? null;
        if (!row) { bump(counts.void, season); continue; }
        if (row[C.participation] === "UNKNOWN") { bump(counts.quarantined, season); continue; }
        if (row[C.participation] === "PLAYED_NO_ROW") bump(counts.playedNoRowScored, season);
        scored.push({ season, key: `${tg.gameId}|${tg.team}`, y: anyTd(row), p: predict(st, season, lam) });
      }
    }
  }

  const folded = new Set();
  for (const r of day) {
    if (r[C.participation] === "UNKNOWN") continue;
    const id = String(r[C.playerId]);
    const st = ST(id);
    const totals = table.teamTotals[`${r[C.gameId]}|${r[C.team]}`] ?? [0, 0, 0, 0, 0];
    if (st.team !== r[C.team]) {
      if (st.team) byTeam.get(st.team)?.delete(id);
      st.obs = { rush: [], targets: [], td: [] };
      st.team = r[C.team];
      if (!byTeam.has(st.team)) byTeam.set(st.team, new Set());
      byTeam.get(st.team).add(id);
    }
    const idx = st.games + 1;
    st.obs.rush.push({ share: totals[1] > 0 ? r[C.carries] / totals[1] : 0, idx, season: r[C.season] });
    st.obs.targets.push({ share: totals[2] > 0 ? r[C.targets] / totals[2] : 0, idx, season: r[C.season] });
    const teamScorerTd = totals[3] + totals[4];
    if (teamScorerTd > 0) st.obs.td.push({ share: (r[C.rushTd] + r[C.recTd]) / teamScorerTd, idx, season: r[C.season] });
    if (r[C.carries] > 0) st.rates.rushTd.push({ num: r[C.rushTd], den: r[C.carries], idx, season: r[C.season] });
    if (r[C.targets] > 0) st.rates.recTd.push({ num: r[C.recTd], den: r[C.targets], idx, season: r[C.season] });
    st.recentAny.push(anyTd(r));
    st.games = idx;
    const tk = `${r[C.gameId]}|${r[C.team]}`;
    if (!folded.has(tk)) { folded.add(tk); foldTeam(r[C.team], r[C.season], totals); }
  }
  i = j;
}

// ── metrics ───────────────────────────────────────────────────────────────────────────────────────
const isDev = (s) => inSeasons(s.season, F.seasons.dev);
const guard = (list) => { if (MODE === "validate" && list.some((s) => !isDev(s))) throw new Error("a held-out row reached a metric in --validate"); };
function metrics(list, model) {
  guard(list);
  const n = list.length;
  if (!n) return null;
  let ll = 0;
  let br = 0;
  let sp = 0;
  let sy = 0;
  const bins = Array.from({ length: F.bars.eceBins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const x of list) {
    const p = x.p[model];
    ll -= x.y ? Math.log(p) : Math.log(1 - p);
    br += (p - x.y) ** 2;
    sp += p;
    sy += x.y;
    const b = bins[Math.min(F.bars.eceBins - 1, Math.floor(p * F.bars.eceBins))];
    b.n += 1; b.p += p; b.y += x.y;
  }
  return {
    n,
    logLoss: ll / n,
    brier: br / n,
    meanPredicted: sp / n,
    actualRate: sy / n,
    level: sy > 0 ? sp / sy : null,
    ece: bins.reduce((a, b) => a + (b.n ? (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0),
    reliability: bins.filter((b) => b.n).map((b, k) => ({ n: b.n, meanPredicted: b.p / b.n, actualRate: b.y / b.n })),
  };
}
/** Diagnostic only: in each team-game, did the model's single likeliest scorer score? */
function likeliestHitRate(list, model) {
  const best = new Map();
  for (const x of list) { const cur = best.get(x.key); if (!cur || x.p[model] > cur.p[model]) best.set(x.key, x); }
  const picks = [...best.values()];
  return picks.length ? { teamGames: picks.length, scored: picks.reduce((a, x) => a + x.y, 0) / picks.length } : null;
}
const fmt = (m) => `n ${m.n} · LL ${m.logLoss.toFixed(4)} · Brier ${m.brier.toFixed(4)} · ECE ${m.ece.toFixed(3)} · level ${m.level?.toFixed(3)} (p ${m.meanPredicted.toFixed(3)} vs y ${m.actualRate.toFixed(3)})`;

if (MODE === "validate") {
  console.log("league (2013 warm-up):", JSON.stringify(Object.fromEntries(Object.entries(LEAGUE).map(([k, v]) => [k, Number(v.toFixed(5))]))));
  for (const season of [2022, 2023, 2024, 2025, "DEV"]) {
    const list = scored.filter((s) => (season === "DEV" ? isDev(s) : s.season === season));
    for (const m of MODELS) console.log(`${String(season).padEnd(5)} ${m.padEnd(15)} ${fmt(metrics(list, m))} · likeliest scored ${likeliestHitRate(list, m).scored.toFixed(3)}`);
    console.log("");
  }
  process.exit(0);
}

// ── --score: the one look ─────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lossOf = (x, m) => -(x.y ? Math.log(x.p[m]) : Math.log(1 - x.p[m]));
function bootstrap(list, model, versus) {
  const seasons = [...new Set(list.map((x) => x.season))].sort((a, b) => a - b);
  const agg = new Map(seasons.map((s) => [s, { sum: 0, n: 0 }]));
  for (const x of list) { const o = agg.get(x.season); o.sum += lossOf(x, model) - lossOf(x, versus); o.n += 1; }
  const rand = mulberry32(F.bootstrap.seed);
  const stats = [];
  for (let b = 0; b < F.bootstrap.resamples; b += 1) {
    let s = 0; let n = 0;
    for (let k = 0; k < seasons.length; k += 1) { const o = agg.get(seasons[Math.floor(rand() * seasons.length)]); s += o.sum; n += o.n; }
    stats.push(s / n);
  }
  stats.sort((x, y) => x - y);
  return { versus, point: [...agg.values()].reduce((a, o) => a + o.sum, 0) / list.length, lo95: stats[Math.floor(0.025 * stats.length)], hi95: stats[Math.ceil(0.975 * stats.length) - 1] };
}
const held = (s) => inSeasons(s.season, F.seasons.heldOut);
const heldList = scored.filter(held);
const eraLists = Object.fromEntries(F.eras.map(([a, b]) => [`${a}-${b}`, heldList.filter((s) => inSeasons(s.season, [a, b]))]));
const results = {};
for (const m of MODELS) {
  results[m] = {
    overall: metrics(heldList, m),
    eras: Object.fromEntries(Object.entries(eraLists).map(([k, l]) => [k, metrics(l, m)])),
    seasons: Object.fromEntries([...new Set(heldList.map((x) => x.season))].sort().map((s) => [s, metrics(heldList.filter((x) => x.season === s), m)])),
    likeliestScorer: likeliestHitRate(heldList, m),
  };
}
const bar = (pass, required, observed) => ({ pass: Boolean(pass), required, observed });
const bars = {};
const verdicts = {};
for (const cand of F.candidates) {
  const o = results[cand].overall;
  const better = [...F.baselines].sort((a, b) => results[a].overall.logLoss - results[b].overall.logLoss)[0];
  const boot = bootstrap(heldList, cand, better);
  const [lo, hi] = F.bars.levelBand;
  const eras = results[cand].eras;
  bars[cand] = {
    beatsEveryBaseline: bar(F.baselines.every((b) => o.logLoss < results[b].overall.logLoss && Object.keys(eras).every((k) => eras[k].logLoss < results[b].eras[k].logLoss)), "log loss below every baseline overall and in every era", Object.fromEntries(F.baselines.map((b) => [b, { overall: [o.logLoss, results[b].overall.logLoss], eras: Object.fromEntries(Object.keys(eras).map((k) => [k, [eras[k].logLoss, results[b].eras[k].logLoss]])) }]))),
    improvementIsNotNoise: bar(boot.hi95 < 0, "season-bootstrap 95% upper bound of the per-player-game log-loss difference versus the better baseline < 0", boot),
    calibration: bar(o.ece <= F.bars.eceMax && Object.values(eras).every((m) => m.ece <= F.bars.eceEraMax), `ECE <= ${F.bars.eceMax} overall and <= ${F.bars.eceEraMax} in every era`, { overall: o.ece, eras: Object.fromEntries(Object.entries(eras).map(([k, m]) => [k, m.ece])) }),
    level: bar(o.level >= lo && o.level <= hi && Object.values(eras).every((m) => m.level >= lo && m.level <= hi), `mean predicted / actual in [${lo}, ${hi}] overall and in every era`, { overall: o.level, eras: Object.fromEntries(Object.entries(eras).map(([k, m]) => [k, m.level])) }),
    minimumN: bar(o.n >= F.bars.minimumN, `n >= ${F.bars.minimumN}`, o.n),
  };
  verdicts[cand] = Object.values(bars[cand]).every((b) => b.pass) ? "ELIGIBLE" : "REJECTED";
}
const eligible = F.candidates.filter((c) => verdicts[c] === "ELIGIBLE").sort((a, b) => results[a].overall.logLoss - results[b].overall.logLoss);
const receipt = {
  schemaVersion: 1,
  artifact: "anytime-td-historical-replay-evaluation",
  dataClass: "PRIVATE_RESEARCH",
  program: "301",
  generatedAt: NOW,
  preregistration: { path: PREREG_PATH, commit: preregCommit },
  scriptSha256: sha("scripts/research/nfl/replay-anytime-td.mjs"),
  league2013: LEAGUE,
  population: { heldOutSeasons: F.seasons.heldOut, scored: heldList.length, positives: heldList.reduce((a, x) => a + x.y, 0), void: counts.void, quarantined: counts.quarantined, playedNoRowScored: counts.playedNoRowScored },
  results,
  bars,
  verdicts,
  recommendation: eligible[0] ?? null,
  consequence: "Nothing publishes from this receipt. The live anytime-TD engine keeps publishing; replacing it is its own reviewed, founder-approved app/ step.",
};
fs.writeFileSync(rel(OUT_PATH), JSON.stringify(receipt, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(5)) : v), 1), { flag: "wx" });
for (const m of MODELS) console.log(`${m.padEnd(15)} ${verdicts[m] ?? "baseline".padEnd(8)} ${fmt(results[m].overall)} · likeliest scored ${results[m].likeliestScorer.scored.toFixed(3)}${bars[m] ? ` · failed: ${Object.entries(bars[m]).filter(([, b]) => !b.pass).map(([k]) => k).join(", ") || "none"}` : ""}`);
console.log(`recommendation: ${receipt.recommendation}`);
