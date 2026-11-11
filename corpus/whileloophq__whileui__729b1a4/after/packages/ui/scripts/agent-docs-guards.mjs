// What the agent-docs build refuses to ship. Pure functions over text, so each one is
// tested directly (agent-docs-guards.test.mjs) instead of trusted.

const word = (name) => new RegExp(`\\b${name}\\b`);

/** README components the package (or the copy-paste templates) does not export. */
export function findPhantomComponents(components, { packageExports, templateExports }) {
  return components
    .filter(
      ({ name, kind }) => !word(name).test(kind === 'package' ? packageExports : templateExports)
    )
    .map(({ name }) => name);
}

/** Names the skill puts in backticks that no longer exist: APIs, MCP tools, subpaths, files. */
export function findStaleSkillNames(skill, { publicApi, mcpServer, subpaths, agentFiles }) {
  return [...skill.matchAll(/`([^`\n]+)`/g)]
    .map(([, token]) => token)
    .filter((token) => {
      if (/^[a-z]+(?:_[a-z]+)+$/.test(token)) return !mcpServer.includes(`'${token}'`);
      if (/^[A-Za-z]+$/.test(token) && /[A-Z]/.test(token)) return !word(token).test(publicApi);
      if (token.startsWith('@thewhileloop/whileui/')) {
        return !subpaths.includes(`./${token.slice('@thewhileloop/whileui/'.length)}`);
      }
      const file = /dist\/agent\/([\w.-]+)$/.exec(token)?.[1];
      return file !== undefined && !agentFiles.includes(file);
    });
}

/**
 * Icon-size buttons in the docs with no name: no accessibilityLabel or aria-label on the
 * tag and no ButtonText inside. The docs ship to agents, who copy them exactly.
 */
export function findUnnamedIconButtons(markdown) {
  return [...markdown.matchAll(/<Button\b[^>]*\bsize="icon"[^>]*>([\s\S]*?)<\/Button>/g)]
    .filter(([whole, body]) => {
      const tag = whole.slice(0, whole.length - body.length - '</Button>'.length);
      return !/accessibilityLabel=|aria-label=/.test(tag) && !/<ButtonText\b/.test(body);
    })
    .map(([whole]) => whole.split('\n')[0].trim());
}

const REPO = 'https://github.com/whileloophq/whileui';

/**
 * The README as an agent outside this repo should read it: the generator's table markers
 * removed, and repo-relative links made absolute, since they are dead in node_modules.
 */
export function prepareForAgents(markdown) {
  return markdown
    .replace(/^<!-- \/?api:\w+ -->\n/gm, '')
    .replace(/\]\((?:\.\/)?(?!https?:|#|mailto:)([^)\s]+)\)/g, `](${REPO}/blob/main/$1)`)
    .replace(/src="\.\/([^"]+)"/g, `src="${REPO}/raw/main/$1"`);
}
