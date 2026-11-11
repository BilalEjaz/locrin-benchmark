import { matchesAny } from "./glob.js";

export interface ChangedFile {
  status: "added" | "modified" | "deleted" | "renamed";
  /** Path in the new version (or the old one, for a deleted file). */
  path: string;
  /** Path in the base version, for a renamed file. */
  oldPath?: string;
}

/**
 * Parse the output of `git diff --name-status -z`. Entries are separated by NUL characters;
 * renames and copies carry two paths.
 */
export function parseNameStatus(output: string): ChangedFile[] {
  const tokens = output.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i] as string;
    if (code === "") continue;
    const kind = code[0];
    if (kind === "R") {
      const oldPath = tokens[++i] as string;
      const path = tokens[++i] as string;
      files.push({ status: "renamed", path, oldPath });
    } else if (kind === "C") {
      i++; // the copy source is not interesting
      files.push({ status: "added", path: tokens[++i] as string });
    } else {
      const path = tokens[++i] as string;
      const status = kind === "A" ? "added" : kind === "D" ? "deleted" : "modified";
      files.push({ status, path });
    }
  }
  return files;
}

/** Keep the files that match one of the patterns (a rename matches on either of its two paths). */
export function filterByPatterns(files: ChangedFile[], patterns: string[]): ChangedFile[] {
  return files.filter((f) => matchesAny(f.path, patterns) || (f.oldPath !== undefined && matchesAny(f.oldPath, patterns)));
}
