#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

function resolveCwd(cwd) {
  const root = process.cwd()
  const full = path.resolve(root, cwd || '.')
  const rel = path.relative(root, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('cwd escapes workspace')
  return full
}

function binPath(bin) {
  const local = path.join(process.cwd(), 'node_modules', '.bin', bin)
  return fs.existsSync(local) ? local : bin
}

function run(cmd, args, opt = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opt.cwd, env: process.env, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

class LintServer {
  constructor() {
    this.server = new Server({ name: 'lint-server', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.eslint = binPath('eslint')
    this.prettier = binPath('prettier')
    this.setup()
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'eslint_check', description: 'Run eslint without fixing', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, targets: { type: 'array', items: { type: 'string' }, default: ['.'] } } } },
        { name: 'eslint_fix', description: 'Run eslint --fix', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, targets: { type: 'array', items: { type: 'string' }, default: ['.'] } } } },
        { name: 'prettier_check', description: 'Run prettier --check', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, targets: { type: 'array', items: { type: 'string' }, default: ['.'] } } } },
        { name: 'prettier_write', description: 'Run prettier --write', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, targets: { type: 'array', items: { type: 'string' }, default: ['.'] } } } }
      ]
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name
      const a = req.params.arguments || {}
      try {
        const cwd = resolveCwd(a.cwd || '.')
        const targets = Array.isArray(a.targets) && a.targets.length ? a.targets : ['.']
        switch (name) {
          case 'eslint_check': {
            const r = await run(this.eslint, ['-f','json', ...targets], { cwd })
            let json
            try { json = JSON.parse(r.stdout || '[]') } catch { json = [] }
            return { content: [{ type: 'json', json: { code: r.code, results: json } }] }
          }
          case 'eslint_fix': {
            const r = await run(this.eslint, ['--fix', ...targets], { cwd })
            return { content: [{ type: 'json', json: { code: r.code, stdout: r.stdout, stderr: r.stderr } }] }
          }
          case 'prettier_check': {
            const r = await run(this.prettier, ['--check', ...targets], { cwd })
            return { content: [{ type: 'json', json: { code: r.code, stdout: r.stdout, stderr: r.stderr } }] }
          }
          case 'prettier_write': {
            const r = await run(this.prettier, ['--write', ...targets], { cwd })
            return { content: [{ type: 'json', json: { code: r.code, stdout: r.stdout, stderr: r.stderr } }] }
          }
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `❌ ${name} error: ${err?.message || String(err)}` }], isError: true }
      }
    })
  }

  async run() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('Lint MCP Server running on stdio')
  }
}

new LintServer().run()

