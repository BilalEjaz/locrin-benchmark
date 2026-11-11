import { readFileSync } from "node:fs";
import { NotImplementedError } from "@poetics/core";
import type { Actor, Unit } from "@poetics/core";
import { changesBetween, openIndex, readConfig, rebuildIndex, resolveUnit, storePaths } from "@poetics/store";
import type { ChangeSet } from "@poetics/store";
import { checkChange } from "./change.ts";
import type { ChangeReport } from "./change.ts";
import { formatChanges } from "./changes.ts";
import { COMMANDS } from "./commands.ts";
import { coverageFor, formatCoverage } from "./coverage.ts";
import { formatLog, formatWhy } from "./history.ts";
import { applyIndex, formatIndexPlan, hasWrites, planIndex } from "./indexing.ts";
import type { IndexPlan } from "./indexing.ts";
import { applyRehash, planRehash, unitHashes } from "./rehash.ts";

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

// src/ and dist/ both sit one level below package.json.
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Exit codes: 0 ok, 1 findings (e.g. verify), 2 usage or not-implemented. `root` is the repository root. */
export async function run(argv: readonly string[], io: Io, root: string = process.cwd()): Promise<number> {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const [name] = args;

  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    io.out(json ? JSON.stringify({ version: VERSION, commands: COMMANDS }) : helpText());
    return 0;
  }
  if (name === "--version" || name === "-v") {
    io.out(json ? JSON.stringify({ version: VERSION }) : VERSION);
    return 0;
  }

  const command = COMMANDS.find((spec) => spec.name === name);
  if (!command) {
    report(io, json, { error: "unknown-command", message: `Unknown command: ${name}. Run poetics help.` });
    return 2;
  }

  try {
    if (command.name === "changes") return await changes(args.slice(1), io, json, root);
    if (command.name === "log" || command.name === "why") return await history(command.name, args.slice(1), io, json, root);
    if (command.name === "verify") return await verify(args.slice(1), io, json, root);
    if (command.name === "coverage") return await coverage(args.slice(1), io, json, root);
    if (command.name === "hash") return await hash(args.slice(1), io, json, root);
    if (command.name === "rehash") return await rehash(args.slice(1), io, json, root);
    if (command.name === "index") return await index(args.slice(1), io, json, root);
    throw new NotImplementedError(`poetics ${command.name}`);
  } catch (error) {
    if (error instanceof NotImplementedError) {
      report(io, json, { error: "not-implemented", command: command.name, message: error.message });
      return 2;
    }
    throw error;
  }
}

async function changes(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  // --impact needs the composition graph, which arrives with the indexer.
  if (args.includes("--impact")) throw new NotImplementedError("poetics changes --impact");
  const [from, to, ...extra] = args;
  if (extra.length > 0 || args.some((arg) => arg.startsWith("-"))) {
    report(io, json, { error: "usage", command: "changes", message: "Usage: poetics changes [from] [to]" });
    return 2;
  }
  let set: ChangeSet;
  try {
    set = await changesBetween(storePaths(root), { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  } catch (error) {
    report(io, json, { error: "invalid-argument", command: "changes", message: (error as Error).message });
    return 2;
  }
  io.out(json ? JSON.stringify(set) : formatChanges(set));
  return 0;
}

async function history(name: "log" | "why", args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  const [ref, ...extra] = args;
  if (ref === undefined || ref.startsWith("-") || extra.length > 0) {
    report(io, json, { error: "usage", command: name, message: `Usage: poetics ${name} <unit>` });
    return 2;
  }
  const paths = storePaths(root);
  const db = openIndex(paths.indexDb);
  let unit: Unit;
  try {
    await rebuildIndex(paths, db);
    unit = await resolveUnit(paths, db, ref);
  } catch (error) {
    report(io, json, { error: "invalid-argument", command: name, message: (error as Error).message });
    return 2;
  } finally {
    db.close();
  }
  if (!json) {
    io.out(name === "log" ? formatLog(unit) : formatWhy(unit));
  } else if (name === "log") {
    const versions = unit.versions.map((version, seq) => ({ seq, ...version })).reverse();
    io.out(JSON.stringify({ uid: unit.uid, name: unit.name, location: unit.location, versions, lineage: unit.lineage ?? [] }));
  } else {
    const chain = unit.versions.map(({ change, rationale, links, commit }, seq) => ({ seq, change, rationale, links: links ?? [], ...(commit ? { commit } : {}) }));
    io.out(JSON.stringify({ uid: unit.uid, name: unit.name, location: unit.location, chain, lineage: unit.lineage ?? [] }));
  }
  return 0;
}

// The day-one change check (ADR 0007): code against the store since a ref. The
// indexer's unverified units, stale docs and unresolved edges join it later.
async function verify(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  const [flag, since = "HEAD", ...extra] = args;
  if ((flag !== undefined && flag !== "--since") || (flag === "--since" && args[1] === undefined) || extra.length > 0) {
    report(io, json, { error: "usage", command: "verify", message: "Usage: poetics verify [--since <ref>]" });
    return 2;
  }
  let result: ChangeReport;
  try {
    result = await checkChange(root, since, await readConfig(root));
  } catch (error) {
    report(io, json, { error: "invalid-argument", command: "verify", message: (error as Error).message });
    return 2;
  }
  const errors = result.findings.filter((finding) => finding.severity === "error").length;
  if (json) {
    io.out(JSON.stringify(result));
  } else {
    for (const finding of result.findings) io.err(`${finding.severity}: ${finding.kind}: ${finding.file}: ${finding.message}`);
    io.out(
      `Poetics verify since ${since} (${result.base.slice(0, 7)}): ${result.changedCodeFiles.length} code file(s), ` +
        `${result.changedUnits} unit file(s) changed; ${errors} error(s), ${result.findings.length - errors} warning(s).`,
    );
  }
  return errors > 0 ? 1 : 0;
}

async function coverage(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  if (args.length > 0) {
    report(io, json, { error: "usage", command: "coverage", message: "Usage: poetics coverage" });
    return 2;
  }
  const result = await coverageFor(root);
  io.out(json ? JSON.stringify(result) : formatCoverage(result));
  return result.failures.length > 0 ? 1 : 0;
}

async function hash(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  const [ref, ...extra] = args;
  if (ref === undefined || extra.length > 0 || ref.startsWith("-")) {
    report(io, json, { error: "usage", command: "hash", message: "Usage: poetics hash <file>[#name]" });
    return 2;
  }
  const hashAt = ref.lastIndexOf("#");
  const [file, name] = hashAt > 0 ? [ref.slice(0, hashAt), ref.slice(hashAt + 1)] : [ref, undefined];
  const units = (await unitHashes(root, await readConfig(root), file)).filter((unit) => name === undefined || unit.name === name);
  if (units.length === 0) {
    report(io, json, { error: "invalid-argument", command: "hash", message: `No unit ${name ? `${name} ` : ""}in ${file}` });
    return 2;
  }
  io.out(
    json
      ? JSON.stringify({ file, units })
      : units.map((u) => `${u.name} (${u.kind}, lines ${u.startLine}-${u.endLine})\n  contentHash   ${u.contentHash}\n  interfaceHash ${u.interfaceHash}`).join("\n"),
  );
  return 0;
}

async function rehash(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  const parsed = parseFlags(args, ["--write"], ["--agent", "--model"]);
  if (!parsed) {
    report(io, json, { error: "usage", command: "rehash", message: "Usage: poetics rehash [--write] [--agent <tool> [--model <id>]]" });
    return 2;
  }
  const plan = await planRehash(root, await readConfig(root));
  const written = parsed.flags.has("--write") ? await applyRehash(root, plan, actorOf(parsed.values)) : 0;
  if (json) {
    io.out(JSON.stringify({ ...plan, written }));
  } else {
    const lines = plan.skipped.map((s) => `skipped: ${s.file}#${s.name} (${s.uid}): ${s.reason}`);
    const verb = parsed.flags.has("--write") ? `Rehashed ${written}` : `Would rehash ${plan.rehash.length}`;
    lines.push(`${verb} unit(s); ${plan.skipped.length} skipped; ${plan.alreadyIndexed} already on b3: hashes.`);
    io.out(lines.join("\n"));
  }
  return plan.skipped.length > 0 ? 1 : 0;
}

async function index(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  const usage = "Usage: poetics index [--since <ref>] [--write] [--rationale <text>] [--agent <tool> [--model <id>]]";
  const parsed = parseFlags(args, ["--write"], ["--since", "--rationale", "--agent", "--model"]);
  if (!parsed) {
    report(io, json, { error: "usage", command: "index", message: usage });
    return 2;
  }
  const config = await readConfig(root);
  const since = parsed.values.get("--since");
  const rationale = parsed.values.get("--rationale");
  let plan: IndexPlan;
  try {
    plan = await planIndex(root, config, { ...(since ? { since } : {}), ...(rationale ? { rationale } : {}) });
  } catch (error) {
    report(io, json, { error: "invalid-argument", command: "index", message: (error as Error).message });
    return 2;
  }
  const write = parsed.flags.has("--write");
  if (write && plan.rationale === undefined && hasWrites(plan)) {
    report(io, json, { error: "usage", command: "index", message: "No rationale: pass --rationale, or commit with a message first" });
    return 2;
  }
  const written = write ? await applyIndex(root, plan, actorOf(parsed.values), config.store?.layout) : 0;
  io.out(json ? JSON.stringify({ ...plan, written }) : formatIndexPlan(plan, write ? written : undefined));
  return plan.queued.length > 0 ? 1 : 0;
}

/**
 * Boolean `flags` and `--name <value>` options, or undefined when an argument is
 * unknown, a value is missing, or `--model` comes without `--agent`.
 */
function parseFlags(args: readonly string[], flags: readonly string[], options: readonly string[]) {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (flags.includes(arg)) seen.add(arg);
    else if (options.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) return undefined;
      values.set(arg, value);
    } else return undefined;
  }
  if (values.has("--model") && !values.has("--agent")) return undefined;
  return { flags: seen, values };
}

function actorOf(values: ReadonlyMap<string, string>): Actor {
  const agent = values.get("--agent");
  const model = values.get("--model");
  return agent ? { kind: "agent", tool: agent, ...(model ? { model } : {}), reviewed: false } : { kind: "human" };
}

function report(io: Io, json: boolean, payload: { error: string; message: string; command?: string }): void {
  io.err(json ? JSON.stringify(payload) : payload.message);
}

function helpText(): string {
  const width = Math.max(...COMMANDS.map((command) => command.usage.length));
  const lines = COMMANDS.map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`);
  return [`poetics ${VERSION}`, "", "Usage:", ...lines, "", "Every command accepts --json for structured output."].join("\n");
}
