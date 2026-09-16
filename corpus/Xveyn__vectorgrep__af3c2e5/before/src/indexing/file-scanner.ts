import { glob } from "glob";
import { stat } from "fs/promises";
import { join, relative } from "path";
import { isGitRepo, getTrackedFiles } from "../utils/git.js";
import { isSupportedFile } from "../chunking/languages.js";
import type { FilesConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export async function scanFiles(projectPath: string, config: FilesConfig): Promise<string[]> {
  let files: string[];

  if (config.gitOnly && (await isGitRepo(projectPath))) {
    logger.info("Using git ls-files for file discovery");
    files = await getTrackedFiles(projectPath);
  } else {
    logger.info("Using glob for file discovery");
    files = await glob(config.include, {
      cwd: projectPath,
      ignore: config.exclude,
      nodir: true,
      dot: false,
    });
  }

  // Filter by supported extensions and exclude patterns
  const results: string[] = [];
  for (const file of files) {
    const relPath = file.replace(/\\/g, "/");

    // Check if supported language
    if (!isSupportedFile(relPath)) continue;

    // Check exclude patterns
    if (isExcluded(relPath, config.exclude)) continue;

    // Check file size
    try {
      const fullPath = join(projectPath, relPath);
      const stats = await stat(fullPath);
      if (stats.size > config.maxFileSize) {
        logger.debug(`Skipping large file: ${relPath} (${stats.size} bytes)`);
        continue;
      }
      if (stats.size === 0) continue;
    } catch {
      continue;
    }

    results.push(relPath);
  }

  logger.info(`Found ${results.length} files to index`);
  return results;
}

function isExcluded(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching for common patterns
    const regex = globToRegex(pattern);
    if (regex.test(filePath)) return true;
  }
  return false;
}

function globToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "(.+/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${regex}$`);
}
