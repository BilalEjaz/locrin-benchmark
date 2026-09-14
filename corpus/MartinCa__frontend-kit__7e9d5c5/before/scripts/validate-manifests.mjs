// Structural checks on the three manifests that GitHub serves directly.
//
// None of this needs a network round trip, but note the limits documented in
// SETUP.md Part 9: whether `shadcn add` actually resolves an item can only be
// confirmed against the default branch after merge. These checks catch the
// mistakes that are visible from the file alone.
import fs from "node:fs";
import path from "node:path";

const problems = [];
const fail = (message) => problems.push(message);

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// --- registry.json -------------------------------------------------------
const registry = read("registry.json");
const itemNames = new Set();

for (const item of registry.items) {
  if (itemNames.has(item.name)) fail(`registry: duplicate item name "${item.name}"`);
  itemNames.add(item.name);

  for (const file of item.files ?? []) {
    if (!fs.existsSync(file.path)) fail(`registry: ${item.name} -> missing file ${file.path}`);
    // Without a target, shadcn has to guess where a registry:file lands.
    if (file.type === "registry:file" && !file.target) {
      fail(`registry: ${item.name} -> ${file.path} is registry:file with no target`);
    }
  }

  // SETUP.md Part 9: a bare registryDependencies name always resolves against
  // ui.shadcn.com, never against this registry, so a self-reference is a
  // guaranteed "item not found" at install time.
  for (const dep of item.registryDependencies ?? []) {
    if (itemNames.has(dep) || registry.items.some((other) => other.name === dep)) {
      fail(
        `registry: ${item.name} -> registryDependencies "${dep}" points into this registry; ` +
          `bundle the files directly instead (SETUP.md Part 9)`,
      );
    }
  }
}

// Every local import in a shipped .ts/.tsx file has to be satisfied by an item
// that bundles the imported file — query.ts importing @/lib/api is exactly the
// breakage this catches.
const targetsByItem = new Map(
  registry.items.map((item) => [item.name, (item.files ?? []).map((file) => file.target)]),
);
for (const item of registry.items) {
  for (const file of item.files ?? []) {
    if (!/\.tsx?$/.test(file.path)) continue;
    const source = fs.readFileSync(file.path, "utf8");
    for (const [, specifier] of source.matchAll(/from\s+"(@\/[^"]+)"/g)) {
      const wanted = specifier.slice("@/".length);
      const shipped = targetsByItem
        .get(item.name)
        .some((target) => target === wanted || target.replace(/\.tsx?$/, "") === wanted);
      // ui/* comes from the shadcn default registry via registryDependencies.
      if (!shipped && !wanted.startsWith("components/ui/")) {
        fail(
          `registry: ${item.name} -> ${file.path} imports "${specifier}" but the item ships nothing at that target`,
        );
      }
    }
  }
}

// --- plugin manifests ----------------------------------------------------
const marketplace = read(".claude-plugin/marketplace.json");
for (const plugin of marketplace.plugins) {
  const source = path.normalize(plugin.source);
  if (!fs.existsSync(source)) fail(`marketplace: ${plugin.name} -> missing source ${source}`);

  const manifest = path.join(source, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(manifest)) {
    fail(`marketplace: ${plugin.name} -> missing ${manifest}`);
    continue;
  }
  const plugin_json = read(manifest);
  if (plugin_json.name !== plugin.name) {
    fail(`marketplace: ${plugin.name} -> plugin.json says name "${plugin_json.name}"`);
  }
}

// --- skill frontmatter ---------------------------------------------------
// The skill is also shipped as a registry item, so a broken header would reach
// every project that vendors it for cloud sessions.
const skill = "plugins/frontend-conventions/skills/frontend-conventions/SKILL.md";
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(skill, "utf8"));
if (!frontmatter) {
  fail(`skill: ${skill} has no YAML frontmatter block`);
} else {
  for (const key of ["name", "description"]) {
    if (!new RegExp(`^${key}:\\s*\\S`, "m").test(frontmatter[1])) {
      fail(`skill: ${skill} frontmatter is missing "${key}"`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`ok: ${registry.items.length} registry items, ${marketplace.plugins.length} plugin(s)`);
