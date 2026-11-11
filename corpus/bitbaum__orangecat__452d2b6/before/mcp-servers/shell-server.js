#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS node
   script (mcp-servers/ has its own package.json without "type":"module");
   lint-staged applies the app's TS rules here, where require() is correct. */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { spawn } = require('child_process');
const path = require('path');

const ALLOWED = new Set([
  'npm',
  'npx',
  'node',
  'next',
  'vitest',
  'playwright',
  'eslint',
  'prettier',
  'rg',
  'echo',
]);

function resolveCwd(cwd) {
  const root = process.cwd();
  const full = path.resolve(root, cwd || '.');
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('cwd escapes workspace');
  }
  return full;
}

function runCommand(cmd, args, opt = {}) {
  return new Promise(resolve => {
    const start = Date.now();
    const child = spawn(cmd, args, { cwd: opt.cwd, env: process.env, shell: false });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const killTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill('SIGKILL');
        resolve({ code: -1, stdout, stderr: stderr + `\nTimed out after ${opt.timeout}ms` });
      }
    }, opt.timeout || 60000);
    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('close', code => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(killTimer);
      resolve({ code, stdout, stderr, ms: Date.now() - start });
    });
  });
}

class ShellServer {
  constructor() {
    this.server = new Server(
      { name: 'shell-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setup();
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'run',
          description: 'Run an allowed command with arguments',
          inputSchema: {
            type: 'object',
            required: ['cmd'],
            properties: {
              cmd: { type: 'string' },
              args: { type: 'array', items: { type: ['string', 'number', 'boolean'] } },
              cwd: { type: 'string' },
              timeout: { type: 'number', default: 60000 },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async req => {
      const name = req.params.name;
      const a = req.params.arguments || {};
      try {
        switch (name) {
          case 'run': {
            const program = String(a.cmd);
            if (!ALLOWED.has(program)) {
              throw new Error(`Command not allowed: ${program}`);
            }
            const cwd = resolveCwd(a.cwd || '.');
            const args = Array.isArray(a.args) ? a.args.map(String) : [];
            const res = await runCommand(program, args, { cwd, timeout: a.timeout || 60000 });
            return {
              content: [
                {
                  type: 'json',
                  json: { code: res.code, stdout: res.stdout, stderr: res.stderr, ms: res.ms },
                },
              ],
            };
          }
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `❌ ${name} error: ${err?.message || String(err)}` }],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Shell MCP Server running on stdio');
  }
}

new ShellServer().run();
