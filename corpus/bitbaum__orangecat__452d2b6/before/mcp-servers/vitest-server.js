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
const fs = require('fs');

function resolveCwd(cwd) {
  const root = process.cwd();
  const full = path.resolve(root, cwd || '.');
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('cwd escapes workspace');
  }
  return full;
}

function binPath(bin) {
  const local = path.join(process.cwd(), 'node_modules', '.bin', bin);
  return fs.existsSync(local) ? local : bin;
}

function run(cmd, args, opt = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: opt.cwd, env: process.env, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

class JestServer {
  constructor() {
    this.server = new Server(
      { name: 'vitest-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.vitest = binPath('vitest');
    this.setup();
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'vitest_run',
          description: 'Run Vitest with an optional filename filter',
          inputSchema: {
            type: 'object',
            properties: {
              cwd: { type: 'string' },
              testPathPattern: { type: 'string' },
              coverage: { type: 'boolean', default: false },
              updateSnapshots: { type: 'boolean', default: false },
              silent: { type: 'boolean', default: false },
            },
          },
        },
        {
          name: 'vitest_file',
          description: 'Run a specific test file',
          inputSchema: {
            type: 'object',
            required: ['file'],
            properties: {
              cwd: { type: 'string' },
              file: { type: 'string' },
              updateSnapshots: { type: 'boolean', default: false },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async req => {
      const name = req.params.name;
      const a = req.params.arguments || {};
      try {
        const cwd = resolveCwd(a.cwd || '.');
        switch (name) {
          case 'vitest_run': {
            const args = ['run'];
            if (a.coverage) {
              args.push('--coverage');
            }
            if (a.silent) {
              args.push('--silent');
            }
            if (a.updateSnapshots) {
              args.push('--update');
            }
            if (a.testPathPattern) {
              args.push(a.testPathPattern);
            }
            const r = await run(this.vitest, args, { cwd });
            return {
              content: [
                { type: 'json', json: { code: r.code, stdout: r.stdout, stderr: r.stderr } },
              ],
            };
          }
          case 'vitest_file': {
            const args = ['run', a.file];
            if (a.updateSnapshots) {
              args.push('--update');
            }
            const r = await run(this.vitest, args, { cwd });
            return {
              content: [
                { type: 'json', json: { code: r.code, stdout: r.stdout, stderr: r.stderr } },
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
    console.error('Jest MCP Server running on stdio');
  }
}

new JestServer().run();
