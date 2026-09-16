#!/usr/bin/env node
/**
 * NFL player-game table 2013–2025 WITH TOUCHDOWNS, for the P301 anytime-touchdown historical replay.
 *
 * Identical population, identity joins and participation truth to build-player-games-v1.mjs (which stays
 * untouched — its sha is pinned by the P299/P300 receipts). Adds, per player-game:
 *   rushTd   rushing touchdowns
 *   recTd    receiving touchdowns
 *   otherTd  special-teams and own-fumble-recovery touchdowns (return scores settle an anytime-TD market too)
 * and per team-game totals [passAtt, carries, targets, rushTd, recTd] over every stat row of that team-game.
 * A passing touchdown is not a scorer's touchdown and is not carried.
 *
 * PARTICIPATION TRUTH (as v1): PLAYED (snap match), PLAYED_NO_ROW (offensive snaps, no stat row — real zeros),
 * UNKNOWN (stat row, no snap match — quarantined). Snap counts are real 2013–2025 only.
 *
 * This script computes no accuracy figure. Touchdown outcomes for 2014–2021 are scored only by the registered
 * P301 replay, once.
 *
 * Usage: node scripts/research/nfl/build-player-games-v2.mjs
 * Reads:  data/internal/research/nfl/raw/nflverse/player-stats/{stats_player_week,snap_counts}_YYYY.csv.gz,
 *         roster_weekly_YYYY.csv, and data/internal/research/nfl/raw/nflverse/games.csv
 * Writes: data/internal/research/nfl/replay/player-games-v2.json.gz
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RAW = path.join(ROOT, "data/internal/research/nfl/raw/nflverse/player-stats");
const GAMES_CSV = path.join(ROOT, "data/internal/research/nfl/raw/nflverse/games.csv");
const OUT = path.join(ROOT, "data/internal/research/nfl/replay/player-games-v2.json.gz");
const SEASONS = Array.from({ length: 13 }, (_, i) => 2013 + i);
const FRANCHISE = Object.freeze({ STL: "LA", SD: "LAC", OAK: "LV", JAC: "JAX", LAR: "LA" });
const fr = (t) => FRANCHISE[t] ?? t;
const SKILL = new Set(["QB", "RB", "WR", "TE", "FB"]);
const posGroup = (p) => ({ FB: "RB", HB: "RB" }[p] ?? p);

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
const table = (buf, file, need = []) => {
  const lines = buf.toString("utf8").replace(/\r/g, "").trim().split("\n");
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  const bad = rows.filter((r) => r.length !== header.length).length;
  if (bad) throw new Error(`${file}: ${bad} rows do not match the header width`);
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${file}: missing columns ${missing.join(", ")}`);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  return { col, rows };
};
const readGz = (file) => {
  const buf = fs.readFileSync(path.join(RAW, file));
  try { return zlib.gunzipSync(buf); } catch { throw new Error(`${file} is not a valid gzip — re-download it and validate before building`); }
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const norm = (s) => String(s ?? "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const lastName = (s) => (String(s ?? "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").trim().split(/\s+/).at(-1) ?? "").replace(/[^a-z]/g, "");
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const games = table(fs.readFileSync(GAMES_CSV), "games.csv");
const gameMeta = new Map();
for (const r of games.rows) {
  const season = Number(r[games.col.season]);
  if (season < SEASONS[0] || season > SEASONS.at(-1)) continue;
  gameMeta.set(r[games.col.game_id], { season, week: Number(r[games.col.week]), date: r[games.col.gameday], type: r[games.col.game_type] === "REG" ? "REG" : "POST" });
}

const STAT_NEED = ["game_id", "team", "opponent_team", "position", "player_id", "player_display_name", "targets", "receptions", "receiving_yards", "carries", "rushing_yards", "attempts", "completions", "passing_yards", "rushing_tds", "receiving_tds", "special_teams_tds", "fumble_recovery_tds"];
const COLUMNS = ["gameId", "season", "week", "date", "seasonType", "team", "opponent", "playerId", "name", "position", "participation", "offenseSnaps", "targets", "receptions", "recYds", "carries", "rushYds", "passAtt", "passCmp", "passYds", "rushTd", "recTd", "otherTd"];
const out = [];
const teamTotals = {};
const accounting = {};
const sources = [];

for (const season of SEASONS) {
  const statsFile = `stats_player_week_${season}.csv.gz`;
  const snapsFile = `snap_counts_${season}.csv.gz`;
  const rosterFile = `roster_weekly_${season}.csv`;
  for (const f of [statsFile, snapsFile, rosterFile]) sources.push({ file: f, sha256: sha256(path.join(RAW, f)) });
  const stats = table(readGz(statsFile), statsFile, STAT_NEED);
  const snaps = table(readGz(snapsFile), snapsFile);
  const roster = table(fs.readFileSync(path.join(RAW, rosterFile)), rosterFile);

  const pfrToGsis = new Map();
  for (const r of roster.rows) {
    const p = r[roster.col.pfr_id];
    const g = r[roster.col.gsis_id];
    if (p && g && p !== "NA" && g !== "NA") pfrToGsis.set(p, g);
  }

  const snapRows = snaps.rows
    .filter((r) => gameMeta.has(r[snaps.col.game_id]))
    .map((r) => ({
      gameId: r[snaps.col.game_id], team: fr(r[snaps.col.team]), opponent: fr(r[snaps.col.opponent]),
      pfr: r[snaps.col.pfr_player_id], gsis: pfrToGsis.get(r[snaps.col.pfr_player_id]) ?? null,
      name: r[snaps.col.player], position: r[snaps.col.position], offenseSnaps: num(r[snaps.col.offense_snaps]), claimed: false,
    }));
  const byGsis = new Map();
  const byName = new Map();
  const byLast = new Map();
  for (const s of snapRows) {
    if (s.gsis) byGsis.set(`${s.gameId}|${s.gsis}`, s);
    byName.set(`${s.gameId}|${s.team}|${norm(s.name)}`, s);
    const lk = `${s.gameId}|${s.team}|${lastName(s.name)}|${posGroup(s.position)}`;
    byLast.set(lk, byLast.has(lk) ? null : s);
  }

  const acc = { statRowsSkill: 0, matched: 0, unknown: 0, playedNoRow: 0 };
  for (const r of stats.rows) {
    const gameId = r[stats.col.game_id];
    const meta = gameMeta.get(gameId);
    if (!meta) continue;
    const team = fr(r[stats.col.team]);
    const t = (teamTotals[`${gameId}|${team}`] ??= [0, 0, 0, 0, 0]);
    t[0] += num(r[stats.col.attempts]);
    t[1] += num(r[stats.col.carries]);
    t[2] += num(r[stats.col.targets]);
    t[3] += num(r[stats.col.rushing_tds]);
    t[4] += num(r[stats.col.receiving_tds]);
    const position = r[stats.col.position];
    if (!SKILL.has(position)) continue;
    acc.statRowsSkill += 1;
    const name = r[stats.col.player_display_name];
    const gsis = r[stats.col.player_id];
    const snap = byGsis.get(`${gameId}|${gsis}`) ?? byName.get(`${gameId}|${team}|${norm(name)}`) ?? byLast.get(`${gameId}|${team}|${lastName(name)}|${posGroup(position)}`) ?? null;
    if (snap) { snap.claimed = true; acc.matched += 1; } else acc.unknown += 1;
    out.push([
      gameId, meta.season, meta.week, meta.date, meta.type, team, fr(r[stats.col.opponent_team]), gsis, name, position,
      snap ? "PLAYED" : "UNKNOWN", snap ? snap.offenseSnaps : null,
      num(r[stats.col.targets]), num(r[stats.col.receptions]), num(r[stats.col.receiving_yards]),
      num(r[stats.col.carries]), num(r[stats.col.rushing_yards]),
      num(r[stats.col.attempts]), num(r[stats.col.completions]), num(r[stats.col.passing_yards]),
      num(r[stats.col.rushing_tds]), num(r[stats.col.receiving_tds]), num(r[stats.col.special_teams_tds]) + num(r[stats.col.fumble_recovery_tds]),
    ]);
  }
  for (const s of snapRows) {
    if (s.claimed || s.offenseSnaps <= 0 || !SKILL.has(s.position)) continue;
    const meta = gameMeta.get(s.gameId);
    acc.playedNoRow += 1;
    out.push([s.gameId, meta.season, meta.week, meta.date, meta.type, s.team, s.opponent, s.gsis ?? `pfr:${s.pfr}`, s.name, s.position, "PLAYED_NO_ROW", s.offenseSnaps, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  accounting[season] = acc;
  console.log(`${season}: skill stat rows ${acc.statRowsSkill} · matched ${acc.matched} · unknown ${acc.unknown} · played with no stat row ${acc.playedNoRow}`);
}

out.sort((a, b) => (a[3] !== b[3] ? (a[3] < b[3] ? -1 : 1) : a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[5] !== b[5] ? (a[5] < b[5] ? -1 : 1) : String(a[7]) < String(b[7]) ? -1 : 1));
const body = {
  schemaVersion: 1,
  artifact: "nfl-player-games",
  version: 2,
  dataClass: "PRIVATE_RESEARCH",
  attribution: "Data: nflverse (https://github.com/nflverse), licensed CC BY 4.0. Derived per-player-game table; raw files are not redistributed here.",
  seasons: [SEASONS[0], SEASONS.at(-1)],
  population: "REG+POST skill positions (QB, RB, WR, TE, FB). PLAYED = snap-count match; PLAYED_NO_ROW = offensive snaps with no stat row (zeros); UNKNOWN = stat row with no snap match (quarantine).",
  touchdowns: "rushTd = rushing_tds; recTd = receiving_tds; otherTd = special_teams_tds + fumble_recovery_tds. Passing touchdowns are not scorer touchdowns and are not carried.",
  franchiseMap: FRANCHISE,
  sources: [...sources, { file: "games.csv", sha256: sha256(GAMES_CSV) }],
  accounting,
  columns: COLUMNS,
  rows: out,
  teamTotalsColumns: ["passAtt", "carries", "targets", "rushTd", "recTd"],
  teamTotals: Object.fromEntries(Object.entries(teamTotals).sort(([a], [b]) => (a < b ? -1 : 1))),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(body), { level: 9 }));
console.log(`\nwrote ${out.length} player-games -> ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
