#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import path from 'path';

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
                  type: 'text',
                  text: JSON.stringify(
                    { code: res.code, stdout: res.stdout, stderr: res.stderr, ms: res.ms },
                    null,
                    2
                  ),
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
