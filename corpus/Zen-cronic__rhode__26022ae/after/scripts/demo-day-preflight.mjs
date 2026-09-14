import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const productRoot = process.cwd();
const submissionRoot = path.resolve(productRoot, "../submission/roadstar");
const kitRoot = path.join(submissionRoot, "offline-demo-kit");
const skipAndroid = process.argv.includes("--skip-android");
const results = [];

function command(file, args) {
  return execFileSync(file, args, { cwd: productRoot, encoding: "utf8" }).trim();
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, operation) {
  try {
    const detail = await operation();
    results.push({ name, status: "PASS", detail });
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
  }
}

async function request(url) {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
  requireCheck(response.status === 200, `${url} returned HTTP ${response.status}`);
  return `HTTP ${response.status}`;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await check("Private release branch is clean and pushed", async () => {
  requireCheck(command("git", ["rev-parse", "--abbrev-ref", "HEAD"]) === "main", "current branch is not main");
  requireCheck(command("git", ["status", "--porcelain"]) === "", "product working tree is dirty");
  requireCheck(command("git", ["rev-parse", "HEAD"]) === command("git", ["rev-parse", "@{upstream}"]), "HEAD differs from upstream");
  return command("git", ["rev-parse", "--short", "HEAD"]);
});

const hosted = [
  "https://roadstar-api-739889188415.us-central1.run.app/api/health",
  "https://roadstar-web-739889188415.us-central1.run.app/?view=dock-evidence",
  "https://roadstar-web-739889188415.us-central1.run.app/?view=matched-401",
  "https://roadstar-web-739889188415.us-central1.run.app/demo/roadstar-demo.mp4",
  "https://roadstar-web-739889188415.us-central1.run.app/demo/roadstar-pitch.pdf",
];
for (const url of hosted) await check(`Hosted ${new URL(url).pathname}${new URL(url).search}`, () => request(url));

await check("Prepared local web fallback", async () => {
  const candidates = ["http://127.0.0.1:5175/?view=dock-evidence", "http://127.0.0.1:5174/?view=dock-evidence"];
  const settled = await Promise.allSettled(candidates.map(request));
  const ready = settled.flatMap((result, index) => (result.status === "fulfilled" ? [candidates[index]] : []));
  requireCheck(ready.length > 0, "neither local web port 5175 nor 5174 responded");
  return ready.join(", ");
});

await check("Prepared local PostgreSQL API", async () => {
  const response = await fetch("http://127.0.0.1:4010/api/health", { signal: AbortSignal.timeout(8_000) });
  requireCheck(response.status === 200, `local API returned HTTP ${response.status}`);
  const body = await response.json();
  requireCheck(body.database === "postgresql", `local API reported ${body.database ?? "unknown database"}`);
  return "HTTP 200 / PostgreSQL";
});

await check("Submission media match the verified receipt", async () => {
  const receipt = JSON.parse(await readFile(path.join(submissionRoot, "current-artifact-verification.json"), "utf8"));
  for (const artifact of receipt.artifacts) {
    const bytes = await readFile(path.join(productRoot, "apps/web/public/demo", artifact.name));
    requireCheck(bytes.length === artifact.bytes, `${artifact.name} byte count changed`);
    requireCheck(sha256(bytes) === artifact.sha256, `${artifact.name} hash changed`);
  }
  return `${receipt.artifacts.length} artifacts / ${receipt.webRevision}`;
});

await check("Offline kit checksums", async () => {
  const sums = (await readFile(path.join(kitRoot, "SHA256SUMS.txt"), "utf8")).trim().split("\n");
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    requireCheck(match, `invalid checksum line: ${line}`);
    const [, expected, relative] = match;
    requireCheck(!relative.includes("..") && !path.isAbsolute(relative), `unsafe checksum path: ${relative}`);
    requireCheck(sha256(await readFile(path.join(kitRoot, relative))) === expected, `${relative} checksum failed`);
  }
  return `${sums.length} files`;
});

if (!skipAndroid) {
  await check("Android D-02 is staged before approval", async () => {
    const device = "emulator-5556";
    requireCheck(command("adb", ["devices"]).split("\n").some((line) => line.startsWith(`${device}\tdevice`)), `${device} is unavailable`);
    const focus = command("adb", ["-s", device, "shell", "dumpsys", "window"]);
    requireCheck(focus.includes("com.roadstar.carrier/.MainActivity"), "RoadStar is not foregrounded");
    command("adb", ["-s", device, "shell", "uiautomator", "dump", "/sdcard/roadstar-preflight.xml"]);
    const hierarchy = command("adb", ["-s", device, "shell", "cat", "/sdcard/roadstar-preflight.xml"]);
    requireCheck(hierarchy.includes('text="Synced"'), "Android is not synchronized");
    requireCheck(hierarchy.includes('text="No active trip"'), "D-02 already has an active trip");
    return `${device} / Synced / No active trip`;
  });
}

const failed = results.filter((result) => result.status === "FAIL");
for (const result of results) {
  console.log(`${result.status.padEnd(4)}  ${result.name} — ${result.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed${skipAndroid ? " (Android skipped)" : ""}.`);
if (failed.length) process.exitCode = 1;
