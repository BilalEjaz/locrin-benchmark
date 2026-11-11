export interface CommandSpec {
  name: string;
  usage: string;
  summary: string;
}

/** The CLI surface from docs/plan.md, "Developer workflow and tooling". */
export const COMMANDS: readonly CommandSpec[] = [
  { name: "init", usage: "poetics init [--agents]", summary: "Detect React and Svelte, write config, index the repo and backfill history from git" },
  { name: "index", usage: "poetics index [--since <ref>] [--write] [--rationale <text>] [--agent <tool> [--model <id>]]", summary: "Record what changed in the code since a ref: versions, moves and renames with lineage, new and removed units, test links to renamed test files; a dry run without --write" },
  { name: "log", usage: "poetics log <unit>", summary: "Version history of one unit, with rationale and commits" },
  { name: "why", usage: "poetics why <unit>", summary: "The rationale chain that led to the current version" },
  { name: "changes", usage: "poetics changes [from] [to] [--impact]", summary: "Every recorded change between two refs and why, grouped by commit, removals included" },
  { name: "impact", usage: "poetics impact [ref]", summary: "Components whose closure changed since a branch or commit" },
  { name: "diff", usage: "poetics diff <unit> <a> <b>", summary: "Semantic diff between two versions of a unit" },
  { name: "verify", usage: "poetics verify [--since <ref>]", summary: "List unverified units, stale docs and unresolved edges, and unrecorded changes since a ref; non-zero exit for CI" },
  { name: "coverage", usage: "poetics coverage", summary: "How much of the codebase .poetics/ covers, against policy thresholds" },
  { name: "hash", usage: "poetics hash <file>[#name]", summary: "The indexer's content and interface hashes for the units in a file, for recording a version" },
  { name: "rehash", usage: "poetics rehash [--write] [--agent <tool> [--model <id>]]", summary: "Replace provisional git: hashes with b3: ones by appending rehash versions (ADR 0014); a dry run without --write" },
  { name: "docs", usage: "poetics docs sync", summary: "Write stored docs into TSDoc and @component comments" },
];
