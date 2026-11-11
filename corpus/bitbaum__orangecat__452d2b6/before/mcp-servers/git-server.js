#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const { spawn } = require('child_process')
const path = require('path')

function resolveCwd(cwd) {
  const root = process.cwd()
  const full = path.resolve(root, cwd || '.')
  const rel = path.relative(root, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('cwd escapes workspace')
  return full
}

function runGit(args, opt = {}) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: opt.cwd, env: process.env, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

class GitServer {
  constructor() {
    this.server = new Server({ name: 'git-server', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.setup()
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'git_status', description: 'Git status (porcelain)', inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } } },
        { name: 'git_diff', description: 'Git diff (optional path)', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, pathspec: { type: 'string' }, staged: { type: 'boolean', default: false } } } },
        { name: 'git_branch_list', description: 'List branches', inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } } },
        { name: 'git_checkout', description: 'Checkout a branch or ref', inputSchema: { type: 'object', required: ['ref'], properties: { cwd: { type: 'string' }, ref: { type: 'string' } } } },
        { name: 'git_create_branch', description: 'Create and switch to a new branch', inputSchema: { type: 'object', required: ['name'], properties: { cwd: { type: 'string' }, name: { type: 'string' }, startPoint: { type: 'string' } } } },
        { name: 'git_add', description: 'Stage files', inputSchema: { type: 'object', required: ['paths'], properties: { cwd: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } } } },
        { name: 'git_commit', description: 'Commit staged changes', inputSchema: { type: 'object', required: ['message'], properties: { cwd: { type: 'string' }, message: { type: 'string' } } } },
        { name: 'git_push', description: 'Push to remote', inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, remote: { type: 'string', default: 'origin' }, branch: { type: 'string' }, setUpstream: { type: 'boolean', default: false } } } }
      ]
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name
      const a = req.params.arguments || {}
      try {
        const cwd = resolveCwd(a.cwd || '.')
        switch (name) {
          case 'git_status': {
            const r = await runGit(['status','--porcelain','-b'], { cwd })
            return { content: [{ type: 'json', json: { code: r.code, stdout: r.stdout, stderr: r.stderr } }] }
          }
          case 'git_diff': {
            const args = a.staged ? ['diff','--staged'] : ['diff']
            if (a.pathspec) args.push(a.pathspec)
            const r = await runGit(args, { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr }] }
          }
          case 'git_branch_list': {
            const r = await runGit(['branch','--all','--verbose','--no-abbrev'], { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr }] }
          }
          case 'git_checkout': {
            const r = await runGit(['checkout', a.ref], { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr }] }
          }
          case 'git_create_branch': {
            const args = ['checkout','-b', a.name]
            if (a.startPoint) args.push(a.startPoint)
            const r = await runGit(args, { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr }] }
          }
          case 'git_add': {
            const paths = Array.isArray(a.paths) && a.paths.length ? a.paths : ['.']
            const r = await runGit(['add', ...paths], { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr || 'ok' }] }
          }
          case 'git_commit': {
            const r = await runGit(['commit','-m', a.message], { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr }] }
          }
          case 'git_push': {
            const args = ['push']
            if (a.setUpstream && a.branch) args.push('-u', a.remote || 'origin', a.branch)
            const r = await runGit(args, { cwd })
            return { content: [{ type: 'text', text: r.stdout || r.stderr }] }
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
    console.error('Git MCP Server running on stdio')
  }
}

new GitServer().run()

