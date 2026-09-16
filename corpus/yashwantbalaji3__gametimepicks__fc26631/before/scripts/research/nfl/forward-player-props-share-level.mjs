#!/usr/bin/env node
/**
 * NFL PLAYER PROPS — SHARE-LEVEL BLIND FORWARD TEST, 2026 (P300)
 *
 * Executes the forward2026 section of data/internal/research/nfl/reports/player-props-share-level-preregistration.json
 * under data/internal/research/nfl/reports/player-props-share-level-forward-protocol.json. The model is exactly the
 * one the P300 second look scored (replay-player-props-v2.mjs): no pull toward zero on shares, team-form volume,
 * dev-fitted dispersion scales read from the second-look receipt. Nothing is refit on 2026.
 *
 *   --forecast --now <ISO>   forecast the next regular-season week whose first kickoff is after --now. Writes
 *                            <OUT_DIR>/2026-WW.json once (never overwritten). Waits (exit 0) while earlier games
 *                            still lack nflverse stat rows, unless the first kickoff is inside the protocol's fallback.
 *   --grade --now <ISO>      grades every forecast week whose games are all final and all have a snap sheet, then
 *                            rewrites the cumulative receipt from every graded week that was committed before kickoff.
 *   --offline                read the cached raw files instead of downloading
 *   --dry-run --out-dir <d>  write somewhere else (testing); grading then accepts weeks with missing sheets and
 *                            grades only the games that have one, and no week is judged late
 *
 * Raw nflverse files (CC BY 4.0) are cached git-ignored under RAW_DIR; only derived files are committed.
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
const PREREG_PATH = "data/internal/research/nfl/reports/player-props-share-level-preregistration.json";
const PROTOCOL_PATH = "data/internal/research/nfl/reports/player-props-share-level-forward-protocol.json";
const SECOND_LOOK_PATH = "data/internal/research/nfl/reports/player-props-share-level-second-look.json";
const TABLE_PATH = "data/internal/research/nfl/replay/player-games-v1.json.gz";
const RAW_DIR = "data/internal/research/nfl/raw/nflverse/forward-2026";
const SEASON = 2026;
const REL = "https://github.com/nflverse/nflverse-data/releases/download";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(1); };
const MODE = has("--forecast") ? "forecast" : has("--grade") ? "grade" : null;
const NOW = argOf("--now");
const OFFLINE = has("--offline");
const DRY = has("--dry-run");
if (!MODE || !Number.isFinite(Date.parse(NOW ?? ""))) refuse("usage: --forecast|--grade --now <ISO> [--offline] [--dry-run --out-dir <dir>]");
if (DRY && !argOf("--out-dir")) refuse("--dry-run needs --out-dir");
const OUT_DIR = DRY ? path.resolve(argOf("--out-dir")) : rel("data/internal/research/nfl/replay/player-props-share-level-forward");

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const prereg = JSON.parse(fs.readFileSync(rel(PREREG_PATH), "utf8"));
const protocol = JSON.parse(fs.readFileSync(rel(PROTOCOL_PATH), "utf8"));
const secondLook = JSON.parse(fs.readFileSync(rel(SECOND_LOOK_PATH), "utf8"));
const F = prereg.frozen;
const P = protocol.frozen;
if (sha(fs.readFileSync(rel(TABLE_PATH))) !== F.inputs.playerGamesSha256) refuse("player-games table does not match the registered hash");
const CAND = F.candidates[0];
const scaleOf = (mkt) => {
  const s = secondLook.devDispersionScales[`${mkt}|${CAND}`];
  if (!Number.isFinite(s)) refuse(`no dev dispersion scale for ${mkt}`);
  return s;
};

// ── csv + sources ─────────────────────────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false; } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function table(text, file, need) {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  const bad = rows.filter((r) => r.length !== header.length).length;
  if (bad) throw new Error(`${file}: ${bad} rows do not match the header width`);
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${file}: missing columns ${missing.join(", ")}`);
  return { col: Object.fromEntries(header.map((h, i) => [h, i])), rows };
}
const SOURCES = {
  stats: { file: `stats_player_week_${SEASON}.csv.gz`, url: `${REL}/stats_player/stats_player_week_${SEASON}.csv.gz`, gz: true, need: ["game_id", "team", "opponent_team", "position", "player_id", "player_display_name", "targets", "receptions", "receiving_yards", "carries", "rushing_yards", "attempts", "completions", "passing_yards"] },
  snaps: { file: `snap_counts_${SEASON}.csv.gz`, url: `${REL}/snap_counts/snap_counts_${SEASON}.csv.gz`, gz: true, need: ["game_id", "team", "opponent", "pfr_player_id", "player", "position", "offense_snaps"] },
  roster: { file: `roster_weekly_${SEASON}.csv`, url: `${REL}/weekly_rosters/roster_weekly_${SEASON}.csv`, gz: false, need: ["pfr_id", "gsis_id", "espn_id"] },
  players: { file: "players.csv", url: `${REL}/players/players.csv`, gz: false, need: ["gsis_id", "espn_id"] },
  games: { file: "games.csv", url: "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", gz: false, need: ["game_id", "season", "game_type", "week", "gameday", "gametime", "away_team", "home_team", "away_score", "home_score"] },
};
/** Download, validate by CONTENT (gzip, header, row widths, columns), and only then replace the cache. */
async function load(key) {
  const s = SOURCES[key];
  const p = rel(path.join(RAW_DIR, s.file));
  const decode = (buf) => {
    let text;
    try { text = (s.gz ? zlib.gunzipSync(buf) : buf).toString("utf8"); } catch { throw new Error(`${s.file} is not valid gzip`); }
    return table(text, s.file, s.need);
  };
  if (!OFFLINE) {
    /* GitHub release downloads return transient 5xx (a 504 failed the first CI run): retry those and network
       errors with backoff; a 4xx or a content failure still fails at once. */
    let buf = null;
    for (let attempt = 1; ; attempt += 1) {
      let status = null;
      try {
        const res = await fetch(s.url, { redirect: "follow" });
        status = res.status;
        if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
        if (status < 500) throw new Error(`${s.file}: HTTP ${status}`);
      } catch (e) {
        if (status != null && status < 500) throw e;
      }
      if (attempt >= 4) throw new Error(`${s.file}: ${status ? `HTTP ${status}` : "network error"} after ${attempt} attempts`);
      console.log(`${s.file}: ${status ? `HTTP ${status}` : "network error"} — retrying (attempt ${attempt + 1} of 4)`);
      await new Promise((r) => setTimeout(r, 10000 * attempt));
    }
    decode(buf);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(`${p}.tmp`, buf);
    fs.renameSync(`${p}.tmp`, p);
  }
  if (!fs.existsSync(p)) throw new Error(`${s.file} is not cached — run without --offline`);
  const buf = fs.readFileSync(p);
  return { ...decode(buf), source: { file: s.file, url: s.url, sha256: sha(buf), bytes: buf.length } };
}

/** An ET wall-clock kickoff (nfldata gameday + gametime) as a UTC ISO instant, DST-correct. */
function etToUtc(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "13:00").split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const guess = wall + 4 * 3600e3;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess + (wall - shown)).toISOString();
}

// ── 2026 player-games, built with build-player-games-v1.mjs's rules ───────────────────────────────
const FRANCHISE = Object.freeze({ STL: "LA", SD: "LAC", OAK: "LV", JAC: "JAX", LAR: "LA" });
const fr = (t) => FRANCHISE[t] ?? t;
const SKILL = new Set(["QB", "RB", "WR", "TE", "FB"]);
const posGroup = (p) => ({ FB: "RB", HB: "RB" }[p] ?? p);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const lastName = (s) => (String(s ?? "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").trim().split(/\s+/).at(-1) ?? "").replace(/[^a-z]/g, "");

function buildSeasonRows({ stats, snaps, roster, gameMeta }) {
  const pfrToGsis = new Map();
  for (const r of roster.rows) {
    const p = r[roster.col.pfr_id];
    const g = r[roster.col.gsis_id];
    if (p && g && p !== "NA" && g !== "NA") pfrToGsis.set(p, g);
  }
  const snapRows = snaps.rows.filter((r) => gameMeta.has(r[snaps.col.game_id])).map((r) => ({
    gameId: r[snaps.col.game_id], team: fr(r[snaps.col.team]), opponent: fr(r[snaps.col.opponent]),
    pfr: r[snaps.col.pfr_player_id], gsis: pfrToGsis.get(r[snaps.col.pfr_player_id]) ?? null,
    name: r[snaps.col.player], position: r[snaps.col.position], offenseSnaps: num(r[snaps.col.offense_snaps]), claimed: false,
  }));
  const sheetGames = new Set(snapRows.map((s) => s.gameId));
  const byGsis = new Map();
  const byName = new Map();
  const byLast = new Map();
  for (const s of snapRows) {
    if (s.gsis) byGsis.set(`${s.gameId}|${s.gsis}`, s);
    byName.set(`${s.gameId}|${s.team}|${norm(s.name)}`, s);
    const lk = `${s.gameId}|${s.team}|${lastName(s.name)}|${posGroup(s.position)}`;
    byLast.set(lk, byLast.has(lk) ? null : s);
  }
  const rows = [];
  const teamTotals = {};
  const statGames = new Set();
  const acc = { statRowsSkill: 0, matched: 0, unknown: 0, pendingSnaps: 0, playedNoRow: 0 };
  for (const r of stats.rows) {
    const gameId = r[stats.col.game_id];
    const meta = gameMeta.get(gameId);
    if (!meta) continue;
    statGames.add(gameId);
    const team = fr(r[stats.col.team]);
    const t = (teamTotals[`${gameId}|${team}`] ??= [0, 0, 0]);
    t[0] += num(r[stats.col.attempts]);
    t[1] += num(r[stats.col.carries]);
    t[2] += num(r[stats.col.targets]);
    const position = r[stats.col.position];
    if (!SKILL.has(position)) continue;
    acc.statRowsSkill += 1;
    const name = r[stats.col.player_display_name];
    const gsis = r[stats.col.player_id];
    const snap = byGsis.get(`${gameId}|${gsis}`) ?? byName.get(`${gameId}|${team}|${norm(name)}`) ?? byLast.get(`${gameId}|${team}|${lastName(name)}|${posGroup(position)}`) ?? null;
    let participation;
    if (snap) { snap.claimed = true; acc.matched += 1; participation = "PLAYED"; }
    else if (!sheetGames.has(gameId)) { acc.pendingSnaps += 1; participation = "PLAYED_PENDING_SNAPS"; }
    else { acc.unknown += 1; participation = "UNKNOWN"; }
    rows.push([gameId, meta.season, meta.week, meta.date, meta.type, team, fr(r[stats.col.opponent_team]), gsis, name, position, participation, snap ? snap.offenseSnaps : null,
      num(r[stats.col.targets]), num(r[stats.col.receptions]), num(r[stats.col.receiving_yards]), num(r[stats.col.carries]), num(r[stats.col.rushing_yards]),
      num(r[stats.col.attempts]), num(r[stats.col.completions]), num(r[stats.col.passing_yards])]);
  }
  for (const s of snapRows) {
    if (s.claimed || s.offenseSnaps <= 0 || !SKILL.has(s.position)) continue;
    const meta = gameMeta.get(s.gameId);
    acc.playedNoRow += 1;
    rows.push([s.gameId, meta.season, meta.week, meta.date, meta.type, s.team, s.opponent, s.gsis ?? `pfr:${s.pfr}`, s.name, s.position, "PLAYED_NO_ROW", s.offenseSnaps, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  return { rows, teamTotals, sheetGames, statGames, accounting: acc };
}

// ── the P300 engine (verbatim from replay-player-props-v2.mjs) ────────────────────────────────────
function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const c of g) { y += 1; s += c / y; }
  return -t + Math.log(2.5066282746310005 * s / x);
}
function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n += 1) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h);
}
function countDist(mean, variance) {
  if (!(mean > 0)) return { kind: "zero" };
  if (variance <= mean * (1 + 1e-9)) return { kind: "poisson", mean };
  return { kind: "nb", mean, size: (mean * mean) / (variance - mean) };
}
function countPmf(d, k) {
  if (d.kind === "zero") return k === 0 ? 1 : 0;
  if (d.kind === "poisson") return Math.exp(-d.mean + k * Math.log(d.mean) - logGamma(k + 1));
  const p = d.size / (d.size + d.mean);
  return Math.exp(logGamma(k + d.size) - logGamma(d.size) - logGamma(k + 1) + d.size * Math.log(p) + k * Math.log(1 - p));
}
function countCdf(d, k) { if (k < 0) return 0; let s = 0; for (let i = 0; i <= k; i += 1) s += countPmf(d, i); return Math.min(1, s); }
function countQuantile(d, q) { let s = 0; for (let k = 0; k < 2000; k += 1) { s += countPmf(d, k); if (s >= q) return k; } return 2000; }
function zeroGamma(mean, variance, p0) {
  if (!(mean > 0) || p0 >= 1) return { p0: 1, shape: 0, scale: 0 };
  const posMean = mean / (1 - p0);
  const posSecond = (variance + mean * mean) / (1 - p0);
  const posVar = Math.max(posSecond - posMean * posMean, 1e-9);
  return { p0, shape: (posMean * posMean) / posVar, scale: posVar / posMean };
}
const zgCdf = (d, y) => (y < 0 ? 0 : d.p0 + (1 - d.p0) * (d.scale > 0 ? gammaP(d.shape, y / d.scale) : 1));
function zgQuantile(d, q) {
  if (q <= d.p0 || d.scale <= 0) return 0;
  let lo = 0;
  let hi = Math.max(1, d.shape * d.scale * 20);
  while (zgCdf(d, hi) < q) hi *= 2;
  for (let i = 0; i < 80; i += 1) { const mid = (lo + hi) / 2; if (zgCdf(d, mid) < q) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

const FAMILY_OF = { player_receptions: "targets", player_reception_yds: "targets", player_rush_yds: "rushAttempts", player_pass_yds: "passAttempts" };
const MARKETS = Object.keys(FAMILY_OF);
const players = new Map();
const byTeam = new Map();
const teamForm = new Map();
const ST = (id) => {
  if (!players.has(id)) players.set(id, { team: null, games: 0, obs: { passAttempts: [], rushAttempts: [], targets: [] }, rates: {}, recent: {}, name: null, position: null });
  return players.get(id);
};
const weight = (idxNow, idx, seasonNow, season, hl, bd) => 0.5 ** ((idxNow - idx) / hl) * bd ** Math.max(0, seasonNow - season);
function decayedShare(st, family, season, shrinkK = F.share.shrinkK) {
  let num_ = 0;
  let den = 0;
  for (const o of st.obs[family]) { const w = weight(st.games, o.idx, season, o.season, F.share.halfLifeGames, F.share.boundaryDecay); num_ += w * o.share; den += w; }
  return den > 0 ? num_ / (den + shrinkK) : 0;
}
function shrunkRate(st, key, league, season) {
  let n = 0;
  let den = 0;
  for (const o of st.rates[key] ?? []) { const w = weight(st.games, o.idx, season, o.season, F.rate.halfLifeGames, F.rate.boundaryDecay); n += w * o.num; den += w * o.den; }
  return (n + F.rate.priorTrials * league) / (den + F.rate.priorTrials);
}
const INTERCEPT = { passAtt: F.intercepts.passAttempts, carries: F.intercepts.carries, targets: F.intercepts.passAttempts };
function teamVolume(team, season) {
  const t = teamForm.get(team);
  if (!t) return { ...INTERCEPT };
  const bd = F.teamForm.boundaryDecay ** Math.max(0, season - t.season);
  return { passAtt: INTERCEPT.passAtt + (t.passAtt - INTERCEPT.passAtt) * bd, carries: INTERCEPT.carries + (t.carries - INTERCEPT.carries) * bd, targets: INTERCEPT.targets + (t.targets - INTERCEPT.targets) * bd };
}
function foldTeam(team, season, totals) {
  const alpha = 1 - 0.5 ** (1 / F.teamForm.halfLifeGames);
  const cur = teamVolume(team, season);
  teamForm.set(team, { passAtt: cur.passAtt + alpha * (totals[0] - cur.passAtt), carries: cur.carries + alpha * (totals[1] - cur.carries), targets: cur.targets + alpha * (totals[2] - cur.targets), season });
}
const L = F.league;
const D = F.dispersion;
const perOpp = { player_reception_yds: L.catchRate * L.yardsPerReception, player_receptions: L.catchRate, player_rush_yds: L.yardsPerCarry, player_pass_yds: L.completionRate * L.yardsPerCompletion };
function moments(st, mkt, season, vol) {
  const share = decayedShare(st, FAMILY_OF[mkt], season);
  const opp = (mean, sigma) => ({ mean, variance: mean + share * share * sigma * sigma });
  const thin = (n, rate) => ({ mean: n.mean * rate, variance: n.mean * rate * (1 - rate) + rate * rate * n.variance });
  const yards = (k, perPlay, shape) => ({ mean: k.mean * perPlay, variance: (k.mean * perPlay * perPlay) / shape + k.variance * perPlay * perPlay });
  if (mkt === "player_receptions" || mkt === "player_reception_yds") {
    const rec = thin(opp(share * vol.targets, D.volumeSigmaPass), shrunkRate(st, "catch", L.catchRate, season));
    if (mkt === "player_receptions") return { ...rec, count: true };
    return { ...yards(rec, shrunkRate(st, "ypr", L.yardsPerReception, season), D.receivingShape), count: false, zeroCount: rec };
  }
  if (mkt === "player_rush_yds") {
    const car = opp(share * vol.carries, D.volumeSigmaRush);
    return { ...yards(car, shrunkRate(st, "ypc", L.yardsPerCarry, season), D.rushingShape), count: false, zeroCount: car };
  }
  const cmp = thin(opp(share * vol.passAtt, D.volumeSigmaPass), shrunkRate(st, "comp", L.completionRate, season));
  return { ...yards(cmp, shrunkRate(st, "ypcmp", L.yardsPerCompletion, season), D.passingShape), count: false, zeroCount: cmp };
}
function evaluateRow(m, s, line) {
  if (m.count) {
    const d = countDist(m.mean, m.mean + s * Math.max(m.variance - m.mean, 0));
    return { p10: countQuantile(d, 0.1), p25: countQuantile(d, 0.25), p50: countQuantile(d, 0.5), p75: countQuantile(d, 0.75), p90: countQuantile(d, 0.9), pOver: line > 0 ? 1 - countCdf(d, Math.floor(line)) : null };
  }
  const p0 = countPmf(countDist(m.zeroCount.mean, m.zeroCount.variance), 0);
  const d = zeroGamma(m.mean, s * m.variance, p0);
  return { p10: zgQuantile(d, 0.1), p25: zgQuantile(d, 0.25), p50: zgQuantile(d, 0.5), p75: zgQuantile(d, 0.75), p90: zgQuantile(d, 0.9), pOver: line > 0 ? 1 - zgCdf(d, line) : null };
}

// ── inputs ────────────────────────────────────────────────────────────────────────────────────────
const [stats, snaps, roster, gamesCsv, playersCsv] = await Promise.all(["stats", "snaps", "roster", "games", "players"].map((k) => load(k).catch((e) => refuse(e.message))));
const inputs = [stats.source, snaps.source, roster.source, gamesCsv.source, playersCsv.source];
const gameMeta = new Map();
for (const r of gamesCsv.rows) {
  if (Number(r[gamesCsv.col.season]) !== SEASON) continue;
  const type = r[gamesCsv.col.game_type];
  const score = (v) => v !== "" && v !== "NA";
  gameMeta.set(r[gamesCsv.col.game_id], {
    season: SEASON, week: Number(r[gamesCsv.col.week]), date: r[gamesCsv.col.gameday], type: type === "REG" ? "REG" : "POST", regular: type === "REG",
    kickoffUtc: etToUtc(r[gamesCsv.col.gameday], r[gamesCsv.col.gametime]),
    home: fr(r[gamesCsv.col.home_team]), away: fr(r[gamesCsv.col.away_team]),
    final: score(r[gamesCsv.col.home_score]) && score(r[gamesCsv.col.away_score]),
  });
}
const season = buildSeasonRows({ stats, snaps, roster, gameMeta });
const base = JSON.parse(zlib.gunzipSync(fs.readFileSync(rel(TABLE_PATH))));
const C = Object.fromEntries(base.columns.map((c, i) => [c, i]));
const weeks = [...new Set([...gameMeta.values()].filter((g) => g.regular).map((g) => g.week))].sort((a, b) => a - b).map((week) => {
  const games = [...gameMeta.entries()].filter(([, g]) => g.regular && g.week === week).map(([gameId, g]) => ({ gameId, ...g })).sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : a.kickoffUtc > b.kickoffUtc ? 1 : a.gameId < b.gameId ? -1 : 1));
  return { week, games, firstKickoffUtc: games[0].kickoffUtc, firstDate: games.map((g) => g.date).sort()[0] };
});
const weekFile = (w) => path.join(OUT_DIR, `${SEASON}-${String(w).padStart(2, "0")}.json`);
const r4 = (v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(4)) : v);

// ── --forecast ────────────────────────────────────────────────────────────────────────────────────
if (MODE === "forecast") {
  /* --dry-run --week N forces a week, for testing the full forecast -> grade path on games already played. */
  const forced = DRY && argOf("--week") ? weeks.find((w) => w.week === Number(argOf("--week"))) : null;
  const next = forced ?? weeks.find((w) => Date.parse(w.firstKickoffUtc) > Date.parse(NOW));
  if (!next) { console.log("no upcoming regular-season week"); process.exit(0); }
  if (!forced && next.week < P.firstWeek) { console.log(`week ${next.week} is before the protocol's first week ${P.firstWeek}`); process.exit(0); }
  const file = weekFile(next.week);
  if (fs.existsSync(file)) { console.log(`week ${next.week} already forecast (${path.relative(ROOT, file)}) — one forecast per week`); process.exit(0); }
  const prior = weeks.filter((w) => w.week < next.week).flatMap((w) => w.games);
  const missingStats = prior.filter((g) => !season.statGames.has(g.gameId)).map((g) => g.gameId);
  const hoursToKickoff = (Date.parse(next.firstKickoffUtc) - Date.parse(NOW)) / 3600e3;
  if (!forced && missingStats.length && hoursToKickoff > P.fallbackHoursBeforeFirstKickoff) {
    console.log(`waiting: ${missingStats.length} earlier game(s) have no nflverse stat rows yet (${missingStats.join(" ")}); first kickoff in ${hoursToKickoff.toFixed(1)}h`);
    process.exit(0);
  }

  /* Fold every player-game dated strictly before the week's first game date. */
  const rows = [...base.rows, ...season.rows].filter((r) => r[C.date] < next.firstDate)
    .sort((a, b) => (a[C.date] !== b[C.date] ? (a[C.date] < b[C.date] ? -1 : 1) : a[C.gameId] < b[C.gameId] ? -1 : a[C.gameId] > b[C.gameId] ? 1 : 0));
  const totalsOf = (k) => base.teamTotals[k] ?? season.teamTotals[k] ?? [0, 0, 0];
  const folded = new Set();
  for (const r of rows) {
    if (r[C.participation] === "UNKNOWN") continue;
    const id = String(r[C.playerId]);
    const st = ST(id);
    const totals = totalsOf(`${r[C.gameId]}|${r[C.team]}`);
    if (st.team !== r[C.team]) {
      if (st.team) byTeam.get(st.team)?.delete(id);
      st.obs = { passAttempts: [], rushAttempts: [], targets: [] };
      st.team = r[C.team];
      if (!byTeam.has(st.team)) byTeam.set(st.team, new Set());
      byTeam.get(st.team).add(id);
    }
    const idx = st.games + 1;
    st.obs.passAttempts.push({ share: totals[0] > 0 ? r[C.passAtt] / totals[0] : 0, idx, season: r[C.season] });
    st.obs.rushAttempts.push({ share: totals[1] > 0 ? r[C.carries] / totals[1] : 0, idx, season: r[C.season] });
    st.obs.targets.push({ share: totals[2] > 0 ? r[C.targets] / totals[2] : 0, idx, season: r[C.season] });
    const addRate = (key, n, den) => { if (den > 0) (st.rates[key] ??= []).push({ num: n, den, idx, season: r[C.season] }); };
    addRate("catch", r[C.receptions], r[C.targets]);
    addRate("ypr", r[C.recYds], r[C.receptions]);
    addRate("ypc", r[C.rushYds], r[C.carries]);
    addRate("comp", r[C.passCmp], r[C.passAtt]);
    addRate("ypcmp", r[C.passYds], r[C.passCmp]);
    const actual = { player_receptions: r[C.receptions], player_reception_yds: r[C.recYds], player_rush_yds: r[C.rushYds], player_pass_yds: r[C.passYds] };
    for (const mkt of MARKETS) (st.recent[mkt] ??= []).push(actual[mkt]);
    st.games = idx;
    st.name = r[C.name];
    st.position = r[C.position];
    st.lastSeason = r[C.season];
    const tk = `${r[C.gameId]}|${r[C.team]}`;
    if (!folded.has(tk)) { folded.add(tk); foldTeam(r[C.team], r[C.season], totals); }
  }

  /* p25/p75/espnId are publication columns (the public board shows quartiles and keys players by ESPN id);
     they enter no metric. espnId comes from nflverse's all-time players crosswalk, overridden by the 2026 weekly
     roster where both name one (the roster is the newer statement). */
  const COLUMNS = ["gameId", "kickoffUtc", "team", "opponent", "playerId", "name", "position", "market", "share", "mean", "p10", "p50", "p90", "line", "pOverLine", "shareVol", "lastSeason", "p25", "p75", "espnId"];
  const espnOf = new Map();
  for (const r of playersCsv.rows) {
    const g = r[playersCsv.col.gsis_id];
    const e = r[playersCsv.col.espn_id];
    if (g && e && g !== "NA" && e !== "NA") espnOf.set(g, e);
  }
  for (const r of roster.rows) {
    const g = r[roster.col.gsis_id];
    const e = r[roster.col.espn_id];
    if (g && e && g !== "NA" && e !== "NA") espnOf.set(g, e);
  }
  const out = [];
  for (const g of next.games) {
    for (const [team, opponent] of [[g.home, g.away], [g.away, g.home]]) {
      const vol = teamVolume(team, SEASON);
      for (const id of [...(byTeam.get(team) ?? [])].sort()) {
        const st = players.get(id);
        for (const mkt of MARKETS) {
          const fam = FAMILY_OF[mkt];
          const share = decayedShare(st, fam, SEASON);
          if (share < F.thresholds[fam]) continue;
          const recent = (st.recent[mkt] ?? []).slice(-4);
          const line = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
          const m = moments(st, mkt, SEASON, vol);
          const e = evaluateRow(m, scaleOf(mkt), line);
          const volKey = mkt === "player_rush_yds" ? "carries" : mkt === "player_pass_yds" ? "passAtt" : "targets";
          const shareVol = decayedShare(st, fam, SEASON, F.share.baselineShrinkK) * INTERCEPT[volKey] * perOpp[mkt];
          out.push([g.gameId, g.kickoffUtc, team, opponent, id, st.name, st.position, mkt, share, m.mean, e.p10, e.p50, e.p90, line, e.pOver, shareVol, st.lastSeason, e.p25, e.p75, espnOf.get(id) ?? null].map(r4));
        }
      }
    }
  }
  const body = {
    schemaVersion: 1,
    artifact: "player-props-share-level-forward-forecast",
    dataClass: "PRIVATE_RESEARCH",
    program: "300",
    attribution: "Data: nflverse (https://github.com/nflverse), licensed CC BY 4.0. Derived forecasts; raw files are not redistributed here.",
    season: SEASON,
    week: next.week,
    firstKickoffUtc: next.firstKickoffUtc,
    generatedAt: NOW,
    preregistration: PREREG_PATH,
    protocol: PROTOCOL_PATH,
    model: { candidate: CAND, shrinkK: F.share.shrinkK, dispersionScales: Object.fromEntries(MARKETS.map((m) => [m, scaleOf(m)])), scalesFrom: SECOND_LOOK_PATH },
    inputs,
    state: {
      foldedThroughDateBefore: next.firstDate,
      seasonGamesFolded: [...new Set(rows.filter((r) => r[C.season] === SEASON).map((r) => r[C.gameId]))].length,
      earlierGamesWithoutStatRows: missingStats,
      accounting2026: season.accounting,
    },
    counts: Object.fromEntries(MARKETS.map((m) => [m, out.filter((r) => r[7] === m).length])),
    /* With no pull toward zero a departed player's share never fades, so he stays a candidate and grades VOID. */
    staleCandidates: Object.fromEntries(MARKETS.map((m) => [m, out.filter((r) => r[7] === m && r[16] < SEASON - 1).length])),
    columns: COLUMNS,
    rows: out,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body), { flag: "wx" });
  console.log(`week ${next.week}: ${out.length} forecasts (${Object.entries(body.counts).map(([k, v]) => `${k} ${v}`).join(", ")}) · first kickoff ${next.firstKickoffUtc} · ${missingStats.length} earlier game(s) without stats -> ${path.relative(ROOT, file) || file}`);
  process.exit(0);
}

// ── --grade ───────────────────────────────────────────────────────────────────────────────────────
const index = new Map(season.rows.map((r) => [`${r[C.gameId]}|${r[C.team]}|${r[C.playerId]}`, r]));
const ACTUAL_COL = { player_receptions: C.receptions, player_reception_yds: C.recYds, player_rush_yds: C.rushYds, player_pass_yds: C.passYds };
const forecastFiles = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort() : [];
for (const f of forecastFiles) {
  const gradedPath = path.join(OUT_DIR, f.replace(".json", ".graded.json"));
  if (fs.existsSync(gradedPath)) continue;
  const fc = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
  const week = weeks.find((w) => w.week === fc.week);
  const notFinal = week.games.filter((g) => !g.final).map((g) => g.gameId);
  const noSheet = week.games.filter((g) => !season.sheetGames.has(g.gameId)).map((g) => g.gameId);
  if (!DRY && (notFinal.length || noSheet.length)) { console.log(`week ${fc.week}: waiting (${notFinal.length} not final, ${noSheet.length} without a snap sheet)`); continue; }
  let committedAt = null;
  if (!DRY) {
    const log = git("log", "--diff-filter=A", "--format=%cI", "--", path.relative(ROOT, path.join(OUT_DIR, f))).split("\n").filter(Boolean);
    committedAt = log.at(-1) ?? null;
  }
  const late = !DRY && (!committedAt || Date.parse(committedAt) >= Date.parse(fc.firstKickoffUtc));
  const fcCol = Object.fromEntries(fc.columns.map((c, i) => [c, i]));
  const graded = [];
  const tally = { SCORED: 0, VOID: 0, QUARANTINED: 0, NO_SHEET: 0 };
  for (const row of fc.rows) {
    const gameId = row[fcCol.gameId];
    const mkt = row[fcCol.market];
    let state;
    let actual = null;
    if (!season.sheetGames.has(gameId)) state = "NO_SHEET";
    else {
      const r = index.get(`${gameId}|${row[fcCol.team]}|${row[fcCol.playerId]}`);
      if (!r) state = "VOID";
      else if (r[C.participation] === "UNKNOWN") state = "QUARANTINED";
      else { state = "SCORED"; actual = r[ACTUAL_COL[mkt]]; }
    }
    tally[state] += 1;
    graded.push([...row, state, actual]);
  }
  const body = { schemaVersion: 1, artifact: "player-props-share-level-forward-graded", dataClass: "PRIVATE_RESEARCH", program: "300", season: SEASON, week: fc.week, firstKickoffUtc: fc.firstKickoffUtc, forecastCommittedAt: committedAt, late, gradedAt: NOW, partial: DRY && (notFinal.length > 0 || noSheet.length > 0), inputs, tally, columns: [...fc.columns, "state", "actual"], rows: graded };
  fs.writeFileSync(gradedPath, JSON.stringify(body), { flag: "wx" });
  console.log(`week ${fc.week}: graded ${tally.SCORED} · void ${tally.VOID} · quarantined ${tally.QUARANTINED} · no sheet ${tally.NO_SHEET}${late ? " · LATE (excluded)" : ""}`);
}

/* The cumulative receipt, rebuilt from every graded week that was on time. */
const gradedFiles = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => /^\d{4}-\d{2}\.graded\.json$/.test(f)).sort() : [];
const scored = [];
const weeksIncluded = [];
const weeksExcludedLate = [];
for (const f of gradedFiles) {
  const g = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
  if (g.late) { weeksExcludedLate.push(g.week); continue; }
  weeksIncluded.push(g.week);
  const col = Object.fromEntries(g.columns.map((c, i) => [c, i]));
  for (const r of g.rows) if (r[col.state] === "SCORED") scored.push({ mkt: r[col.market], actual: r[col.actual], mean: r[col.mean], p10: r[col.p10], p50: r[col.p50], p90: r[col.p90], line: r[col.line], pOverLine: r[col.pOverLine], shareVol: r[col.shareVol] });
}
const B = F.bars;
function metrics(list, isCount) {
  const n = list.length;
  if (!n) return null;
  const avg = (fn) => list.reduce((s, x) => s + fn(x), 0) / n;
  const cover = (x) => (isCount && (x.actual === x.p10 || x.actual === x.p90) ? 0.5 : x.actual >= x.p10 && x.actual <= x.p90 ? 1 : 0);
  const withLine = list.filter((x) => x.pOverLine != null);
  const bins = Array.from({ length: B.eceBins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const x of withLine) { const b = bins[Math.min(B.eceBins - 1, Math.floor(x.pOverLine * B.eceBins))]; b.n += 1; b.p += x.pOverLine; b.y += x.actual > x.line ? 1 : 0; }
  const meanActual = avg((x) => x.actual);
  return {
    n,
    mae: avg((x) => Math.abs(x.p50 - x.actual)),
    rolling4Mae: avg((x) => Math.abs(x.line - x.actual)),
    shareVolMae: avg((x) => Math.abs(x.shareVol - x.actual)),
    coverage80: avg(cover),
    ece: withLine.length ? bins.reduce((s, b) => s + (b.n ? (b.n / withLine.length) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0) : null,
    level: meanActual > 0 ? avg((x) => x.mean) / meanActual : null,
  };
}
const families = {};
for (const mkt of MARKETS) {
  const m = metrics(scored.filter((x) => x.mkt === mkt), mkt === "player_receptions");
  if (!m || m.n < B.minimumN) { families[mkt] = { state: "ACCUMULATING", n: m?.n ?? 0, needed: B.minimumN, metrics: m }; continue; }
  const bars = {
    beatsRolling4: m.mae < m.rolling4Mae,
    beatsShareVolume: m.mae < m.shareVolMae,
    coverage80: m.coverage80 >= B.coverageBand[0] && m.coverage80 <= B.coverageBand[1],
    thresholdCalibration: m.ece != null && m.ece <= B.eceMax,
    level: m.level != null && m.level >= B.levelBand[0] && m.level <= B.levelBand[1],
  };
  families[mkt] = { state: Object.values(bars).every(Boolean) ? "FORWARD_HOLDING" : "FORWARD_BREACHED", n: m.n, metrics: m, bars };
}
const receipt = {
  schemaVersion: 1,
  artifact: "player-props-share-level-forward-receipt",
  dataClass: "PRIVATE_RESEARCH",
  program: "300",
  evidenceTier: "BLIND_FORWARD — every included week was committed before its first kickoff",
  season: SEASON,
  updatedAt: NOW,
  weeksIncluded,
  weeksExcludedLate,
  families,
  consequence: "A family in FORWARD_BREACHED after a live adoption is proposed for reversal that week (preregistration decisionRule). ACCUMULATING carries no verdict.",
};
fs.mkdirSync(OUT_DIR, { recursive: true });
const receiptPath = path.join(OUT_DIR, "receipt.json");
const next = JSON.stringify(receipt, (_k, v) => r4(v), 1);
const prev = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, "utf8")) : null;
if (prev && JSON.stringify({ ...prev, updatedAt: null }) === JSON.stringify({ ...JSON.parse(next), updatedAt: null })) console.log("receipt unchanged");
else { fs.writeFileSync(receiptPath, next); console.log(`receipt: ${Object.entries(families).map(([k, v]) => `${k} ${v.state} (n ${v.n})`).join(" · ")}`); }
