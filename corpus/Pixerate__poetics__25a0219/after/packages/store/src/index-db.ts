import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Unit } from "@poetics/core";
import { parseUnit, readUnitFiles } from "./json-store.ts";
import type { StorePaths } from "./paths.ts";

/**
 * The local SQLite index at `.poetics/cache/index.db`. It is derived data:
 * gitignored, rebuilt from `.poetics/units/*.json`, and safe to delete.
 */
export const INDEX_SCHEMA_VERSION = 3;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS unit_files (
  path TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,
  uid TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  framework TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT NOT NULL,
  export_name TEXT,
  owner TEXT,
  docs TEXT,
  latest_content_hash TEXT NOT NULL,
  version_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  uid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  interface_hash TEXT,
  closure_hash TEXT,
  parent TEXT,
  change TEXT NOT NULL,
  commit_sha TEXT,
  actor_kind TEXT NOT NULL,
  actor_tool TEXT,
  actor_model TEXT,
  reviewed INTEGER,
  rationale TEXT NOT NULL,
  inferred_confidence TEXT,
  PRIMARY KEY (uid, seq)
);
CREATE TABLE IF NOT EXISTS deps (
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  to_hash TEXT NOT NULL,
  PRIMARY KEY (from_uid, to_uid)
);
CREATE INDEX IF NOT EXISTS deps_to ON deps (to_uid);
CREATE TABLE IF NOT EXISTS test_links (
  uid TEXT NOT NULL,
  file TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  via TEXT NOT NULL,
  PRIMARY KEY (uid, file, name)
);
CREATE TABLE IF NOT EXISTS lineage (
  uid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  from_path TEXT,
  PRIMARY KEY (uid, seq)
);
CREATE VIRTUAL TABLE IF NOT EXISTS units_fts USING fts5 (uid UNINDEXED, name, docs, rationale);
`;

/** Tables in dump order, each with the columns that make row order deterministic. */
const TABLES: ReadonlyArray<readonly [string, string]> = [
  ["unit_files", "path"],
  ["units", "uid"],
  ["versions", "uid, seq"],
  ["deps", "from_uid, to_uid"],
  ["test_links", "uid, file, name"],
  ["lineage", "uid, seq"],
  ["units_fts", "uid"],
];

export function openIndex(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  const version = currentSchemaVersion(db);
  if (version !== undefined && version !== INDEX_SCHEMA_VERSION) {
    // Derived data: never migrate, just rebuild.
    for (const [table] of TABLES) db.exec(`DROP TABLE IF EXISTS ${table};`);
    db.exec("DROP TABLE IF EXISTS meta;");
  }
  db.exec(DDL);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(INDEX_SCHEMA_VERSION));
  return db;
}

function currentSchemaVersion(db: DatabaseSync): number | undefined {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (!table) return undefined;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return row ? Number(row.value) : undefined;
}

export interface RebuildStats {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * Brings the index in line with the unit files. Files whose bytes are
 * unchanged since the last run are skipped; deleting the index and running
 * this again produces identical contents.
 */
export async function rebuildIndex(paths: StorePaths, db: DatabaseSync = openIndex(paths.indexDb)): Promise<RebuildStats> {
  const files = await readUnitFiles(paths);
  const known = new Map(
    (db.prepare("SELECT path, file_hash, uid FROM unit_files").all() as Array<{ path: string; file_hash: string; uid: string }>).map(
      (row) => [row.path, row],
    ),
  );
  const stats: RebuildStats = { added: 0, updated: 0, removed: 0, unchanged: 0 };

  db.exec("BEGIN");
  try {
    // Removals first, so a unit file that moved (e.g. to a shard folder) can be re-added under the same uid.
    const present = new Set(files.map((file) => file.relativePath));
    for (const gone of known.values()) {
      if (present.has(gone.path)) continue;
      deleteUnitRows(db, gone.uid);
      db.prepare("DELETE FROM unit_files WHERE path = ?").run(gone.path);
      known.delete(gone.path);
      stats.removed++;
    }
    for (const file of files) {
      const fileHash = createHash("sha256").update(file.raw).digest("hex");
      const previous = known.get(file.relativePath);
      if (previous?.file_hash === fileHash) {
        stats.unchanged++;
        continue;
      }
      const unit = parseUnit(file);
      if (previous) {
        deleteUnitRows(db, previous.uid);
        stats.updated++;
      } else {
        stats.added++;
      }
      insertUnit(db, unit);
      db.prepare("INSERT OR REPLACE INTO unit_files (path, file_hash, uid) VALUES (?, ?, ?)").run(
        file.relativePath,
        fileHash,
        unit.uid,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return stats;
}

function deleteUnitRows(db: DatabaseSync, uid: string): void {
  db.prepare("DELETE FROM units WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM versions WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM deps WHERE from_uid = ?").run(uid);
  db.prepare("DELETE FROM test_links WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM lineage WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM units_fts WHERE uid = ?").run(uid);
}

function insertUnit(db: DatabaseSync, unit: Unit): void {
  const latest = unit.versions.at(-1);
  if (!latest) throw new Error(`Unit ${unit.uid} has no versions`);

  db.prepare(
    `INSERT INTO units (uid, kind, framework, name, file, export_name, owner, docs, latest_content_hash, version_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    unit.uid,
    unit.kind,
    unit.framework,
    unit.name,
    unit.location.file,
    unit.location.export ?? null,
    unit.owner ?? null,
    unit.docs ?? null,
    latest.contentHash,
    unit.versions.length,
  );

  const insertVersion = db.prepare(
    `INSERT INTO versions (uid, seq, content_hash, interface_hash, closure_hash, parent, change, commit_sha,
                           actor_kind, actor_tool, actor_model, reviewed, rationale, inferred_confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  unit.versions.forEach((version, seq) => {
    const agent = version.actor.kind === "agent" ? version.actor : undefined;
    insertVersion.run(
      unit.uid,
      seq,
      version.contentHash,
      version.interfaceHash ?? null,
      version.closureHash ?? null,
      version.parent ?? null,
      version.change,
      version.commit ?? null,
      version.actor.kind,
      agent?.tool ?? null,
      agent?.model ?? null,
      agent ? Number(agent.reviewed) : null,
      version.rationale,
      version.inferred?.confidence ?? null,
    );
  });

  // The reverse-dependency index follows the newest version's deps.
  const insertDep = db.prepare("INSERT INTO deps (from_uid, to_uid, to_hash) VALUES (?, ?, ?)");
  for (const [to, hash] of Object.entries(latest.deps ?? {})) insertDep.run(unit.uid, to, hash);

  const insertTest = db.prepare("INSERT OR IGNORE INTO test_links (uid, file, name, via) VALUES (?, ?, ?, ?)");
  for (const test of unit.tests ?? []) insertTest.run(unit.uid, test.file, test.name ?? "", test.via);

  const insertLineage = db.prepare("INSERT INTO lineage (uid, seq, kind, from_path) VALUES (?, ?, ?, ?)");
  (unit.lineage ?? []).forEach((entry, seq) => insertLineage.run(unit.uid, seq, entry.kind, entry.from ?? null));

  db.prepare("INSERT INTO units_fts (uid, name, docs, rationale) VALUES (?, ?, ?, ?)").run(
    unit.uid,
    searchableName(unit.name),
    unit.docs ?? "",
    unit.versions.map((version) => version.rationale).join("\n"),
  );
}

/** `formatPrice` → `formatPrice format Price`, so a search for "price" finds it. */
function searchableName(name: string): string {
  const words = name.split(/(?<=[a-z0-9])(?=[A-Z])|[^A-Za-z0-9]+/).filter(Boolean);
  return words.length > 1 ? `${name} ${words.join(" ")}` : name;
}

export interface UnitRow {
  uid: string;
  kind: string;
  framework: string;
  name: string;
  file: string;
  docs: string | null;
  latest_content_hash: string;
  version_count: number;
}

export function getUnit(db: DatabaseSync, uid: string): UnitRow | undefined {
  return db
    .prepare("SELECT uid, kind, framework, name, file, docs, latest_content_hash, version_count FROM units WHERE uid = ?")
    .get(uid) as UnitRow | undefined;
}

export function findUnitsByName(db: DatabaseSync, name: string): UnitRow[] {
  return db
    .prepare(
      "SELECT uid, kind, framework, name, file, docs, latest_content_hash, version_count FROM units WHERE name = ? ORDER BY file, uid",
    )
    .all(name) as unknown as UnitRow[];
}

/** Units whose newest version depends directly on `uid`. */
export function dependentsOf(db: DatabaseSync, uid: string): string[] {
  return (db.prepare("SELECT from_uid FROM deps WHERE to_uid = ? ORDER BY from_uid").all(uid) as Array<{ from_uid: string }>).map(
    (row) => row.from_uid,
  );
}

export interface SearchOptions {
  /** `all` (the default) needs every word to match; `any` ranks units matching any of them, for free-text task descriptions. */
  match?: "all" | "any";
}

/**
 * Full-text search over names, docs and rationale, best match first. Words
 * match as prefixes; FTS5 operators in the query are treated as plain text.
 */
export function searchUnits(db: DatabaseSync, query: string, options: SearchOptions = {}): UnitRow[] {
  const words = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length === 0) return [];
  const match = words.map((word) => `"${word}"*`).join(options.match === "any" ? " OR " : " ");
  // bm25 weights favour a hit in the name over docs, and docs over rationale.
  return db
    .prepare(
      `SELECT u.uid, u.kind, u.framework, u.name, u.file, u.docs, u.latest_content_hash, u.version_count
       FROM units_fts JOIN units u ON u.uid = units_fts.uid
       WHERE units_fts MATCH ?
       ORDER BY bm25(units_fts, 0, 10, 4, 1), u.uid`,
    )
    .all(match) as unknown as UnitRow[];
}

/** Every row of every table in a stable order, for comparing two indexes. */
export function dumpIndex(db: DatabaseSync): Record<string, unknown[]> {
  const dump: Record<string, unknown[]> = {};
  for (const [table, order] of TABLES) {
    dump[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all().map((row) => ({ ...row }));
  }
  return dump;
}
