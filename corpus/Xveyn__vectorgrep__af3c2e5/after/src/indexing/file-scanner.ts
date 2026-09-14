import { glob } from "glob";
import { minimatch } from "minimatch";
import { stat } from "fs/promises";
import { join } from "path";
import { isGitRepo, getTrackedFiles } from "../utils/git.js";
import { isSupportedFile } from "../chunking/languages.js";
import type { FilesConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export async function scanFiles(projectPath: string, config: FilesConfig): Promise<string[]> {
  const files = await discoverFiles(projectPath, config);

  const results: string[] = [];
  for (const file of files) {
    const relPath = file.replace(/\\/g, "/");

    // Check if supported language
    if (!isSupportedFile(relPath)) continue;

    // git ls-files knows nothing about include/exclude, so apply them here for both modes
    if (!matchesPatterns(relPath, config)) continue;

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

async function discoverFiles(projectPath: string, config: FilesConfig): Promise<string[]> {
  if (config.gitOnly && (await isGitRepo(projectPath))) {
    const tracked = await getTrackedFiles(projectPath);
    if (tracked) {
      logger.info("Using git ls-files for file discovery");
      return tracked;
    }
  }

  logger.info("Using glob for file discovery");
  return glob(config.include, {
    cwd: projectPath,
    ignore: config.exclude,
    nodir: true,
    dot: false,
  });
}

/** Same matching semantics as glob: include without dotfiles, exclude also matching them */
function matchesPatterns(filePath: string, config: FilesConfig): boolean {
  return (
    config.include.some((pattern) => minimatch(filePath, pattern)) &&
    !config.exclude.some((pattern) => minimatch(filePath, pattern, { dot: true }))
  );
}
