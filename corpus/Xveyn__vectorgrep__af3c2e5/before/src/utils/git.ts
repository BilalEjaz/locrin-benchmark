import { simpleGit, type SimpleGit } from "simple-git";
import { logger } from "./logger.js";

export function getGit(projectPath: string): SimpleGit {
  return simpleGit(projectPath);
}

export async function isGitRepo(projectPath: string): Promise<boolean> {
  try {
    const git = getGit(projectPath);
    await git.revparse(["--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export async function getTrackedFiles(projectPath: string): Promise<string[]> {
  try {
    const git = getGit(projectPath);
    const result = await git.raw(["ls-files", "--cached", "--others", "--exclude-standard"]);
    return result
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  } catch (error) {
    logger.warn("Failed to get git tracked files, falling back to glob", {
      error: String(error),
    });
    return [];
  }
}

export async function getChangedFiles(
  projectPath: string,
  since?: string
): Promise<{ modified: string[]; deleted: string[] }> {
  try {
    const git = getGit(projectPath);
    const args = since
      ? ["diff", "--name-status", since, "HEAD"]
      : ["diff", "--name-status", "HEAD"];
    const result = await git.raw(args);
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const line of result.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const status = trimmed[0];
      const filePath = trimmed.slice(1).trim();
      if (status === "D") {
        deleted.push(filePath);
      } else {
        modified.push(filePath);
      }
    }
    return { modified, deleted };
  } catch {
    return { modified: [], deleted: [] };
  }
}
