import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const vaultArgument = process.argv[2];
if (!vaultArgument) {
  throw new Error("Usage: npm run deploy:local -- <vault-path>");
}

const vaultPath = path.resolve(vaultArgument);
const obsidianPath = path.join(vaultPath, ".obsidian");
const pluginPath = path.join(obsidianPath, "plugins", "follow-up-calendar");

const obsidianStats = await stat(obsidianPath).catch(() => null);
if (!obsidianStats?.isDirectory()) {
  throw new Error(`Not an Obsidian vault: ${vaultPath}`);
}

if (!pluginPath.startsWith(path.join(obsidianPath, "plugins") + path.sep)) {
  throw new Error(`Unexpected deployment target: ${pluginPath}`);
}

await mkdir(pluginPath, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(path.resolve(file), path.join(pluginPath, file));
}

process.stdout.write(`Deployed to ${pluginPath}\n`);
