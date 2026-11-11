/** Split an input such as "design/**\/*.figcraft, assets/*.figcraft" (commas or new lines) into patterns. */
export function parsePatterns(input: string): string[] {
  return input
    .split(/[\n,]/)
    .map((p) => p.trim().replace(/^\.\//, ""))
    .filter((p) => p.length > 0);
}

/**
 * Convert a glob to a regular expression. Supports `*` (within a folder), `**` (across folders)
 * and `?`. `**\/` also matches no folder at all, so `design/**\/*.figcraft` matches
 * `design/app.figcraft`.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when the path matches at least one pattern. */
export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}
