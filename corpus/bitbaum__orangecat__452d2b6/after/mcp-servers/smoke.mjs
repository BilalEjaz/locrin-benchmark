#!/usr/bin/env node
/**
 * Starts every *-server.js in this directory and holds an MCP conversation
 * with it over stdio: initialize, notifications/initialized, tools/list.
 *
 * It exists because six of the seven servers once called require() inside this
 * "type": "module" package and died on their first line, and nothing noticed:
 * `node x-server.js` printing nothing and exiting looks like nothing at all.
 *
 *   node mcp-servers/smoke.mjs        # or: npm run smoke (in mcp-servers/)
 *
 * Where a server has a read-only tool, it is also called once (PROBES), and the
 * result must be a valid MCP text block whose text is JSON. The servers used
 * to answer with { type: 'json' }, which is not an MCP content type, so the SDK
 * rejected every one of those results.
 *
 * Servers that need credentials get placeholders. Nothing here makes a network
 * call, so no real token is needed or read.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const servers = readdirSync(here)
  .filter(name => name.endsWith('-server.js'))
  .sort();

const placeholderEnv = {
  GITHUB_TOKEN: 'smoke-placeholder',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'smoke-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'smoke-placeholder',
};

/** One harmless call per server; omitted where every tool runs tests or needs the network. */
const PROBES = {
  'fs-server.js': { name: 'list_files', arguments: { pattern: 'mcp-servers/*-server.js' } },
  'git-server.js': { name: 'git_status', arguments: {} },
  'lint-server.js': { name: 'prettier_check', arguments: { targets: ['mcp-servers/smoke.mjs'] } },
  'shell-server.js': { name: 'run', arguments: { cmd: 'node', args: ['--version'] } },
};

function probeProblem(message) {
  if (message.error) return `tools/call failed: ${message.error.message.split('\n')[0]}`;
  const block = message.result?.content?.[0];
  if (block?.type !== 'text') return `tools/call returned a ${block?.type ?? 'missing'} block`;
  try {
    JSON.parse(block.text);
  } catch {
    return 'tools/call text is not JSON';
  }
  return null;
}

function converse(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(here, file)], {
      cwd: join(here, '..'),
      env: { ...process.env, ...placeholderEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map();
    let stdout = '';
    let stderr = '';
    const finish = result => {
      clearTimeout(timer);
      child.kill();
      resolve({ file, ...result, stderr: stderr.trim() });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'no reply within 30s' }), 30_000);
    const send = message =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

    child.on('exit', code => finish({ ok: false, reason: `exited with code ${code}` }));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.stdout.on('data', chunk => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) {
          continue;
        }
        const message = JSON.parse(line);
        responses.set(message.id, message);
        if (message.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list', params: {} });
        }
        if (message.id === 2) {
          const init = responses.get(1);
          const tools = message.result?.tools ?? [];
          if (!init?.result?.serverInfo || tools.length === 0) {
            finish({
              ok: false,
              reason: `unexpected reply: ${JSON.stringify(message.error ?? message.result)}`,
            });
          } else if (PROBES[file]) {
            send({ id: 3, method: 'tools/call', params: PROBES[file] });
          } else {
            finish({ ok: true, name: init.result.serverInfo.name, tools: tools.length });
          }
        }
        if (message.id === 3) {
          const problem = probeProblem(message);
          finish(
            problem
              ? { ok: false, reason: `${PROBES[file].name}: ${problem}` }
              : {
                  ok: true,
                  name: responses.get(1).result.serverInfo.name,
                  tools: responses.get(2).result.tools.length,
                  probe: PROBES[file].name,
                }
          );
        }
      }
    });

    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'mcp-servers-smoke', version: '1.0.0' },
      },
    });
  });
}

const results = await Promise.all(servers.map(converse));
for (const r of results) {
  console.log(
    r.ok
      ? `ok    ${r.file.padEnd(20)} ${r.name}, ${r.tools} tools${r.probe ? `, ${r.probe} ok` : ''}`
      : `FAIL  ${r.file.padEnd(20)} ${r.reason}\n      ${r.stderr.split('\n').slice(0, 3).join('\n      ')}`
  );
}
const failed = results.filter(r => !r.ok).length;
console.log(
  `\n${results.length - failed}/${results.length} servers answered initialize, tools/list and their probe`
);
process.exit(failed ? 1 : 0);
