#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const fs = require('fs/promises')
const fsSync = require('fs')
const path = require('path')
const { glob } = require('glob')

function workspaceRoot() {
  return process.cwd()
}

function resolveSafe(p) {
  const root = workspaceRoot()
  const full = path.resolve(root, p)
  const rel = path.relative(root, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes workspace')
  }
  return full
}

class FSServer {
  constructor() {
    this.server = new Server({ name: 'fs-server', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.setup()
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'read_file', description: 'Read a text or binary file from the workspace', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' }, maxBytes: { type: 'number', default: 500000 } } } },
        { name: 'write_file', description: 'Write a file to the workspace (creates directories)', inputSchema: { type: 'object', required: ['path','content'], properties: { path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' } } } },
        { name: 'list_files', description: 'List files by glob pattern', inputSchema: { type: 'object', properties: { pattern: { type: 'string', default: '**/*' }, dot: { type: 'boolean', default: false }, cwd: { type: 'string', default: '.' }, maxResults: { type: 'number', default: 2000 } } } },
        { name: 'move_file', description: 'Move or rename a file within the workspace', inputSchema: { type: 'object', required: ['from','to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } },
        { name: 'delete_file', description: 'Delete a file in the workspace', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } },
      ]
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name
      const args = req.params.arguments || {}
      try {
        switch (name) {
          case 'read_file': {
            const file = resolveSafe(args.path)
            const maxBytes = args.maxBytes ?? 500000
            const stat = await fs.stat(file)
            if (stat.size > maxBytes) throw new Error(`File too large: ${stat.size} bytes > ${maxBytes}`)
            const buf = await fs.readFile(file)
            if ((args.encoding || 'utf-8') === 'base64') {
              return { content: [{ type: 'text', text: buf.toString('base64') }] }
            }
            return { content: [{ type: 'text', text: buf.toString('utf-8') }] }
          }
          case 'write_file': {
            const file = resolveSafe(args.path)
            await fs.mkdir(path.dirname(file), { recursive: true })
            const encoding = args.encoding || 'utf-8'
            const data = encoding === 'base64' ? Buffer.from(args.content, 'base64') : args.content
            await fs.writeFile(file, data)
            return { content: [{ type: 'text', text: 'ok' }] }
          }
          case 'list_files': {
            const cwd = resolveSafe(args.cwd || '.')
            const matches = await glob(args.pattern || '**/*', { cwd, dot: !!args.dot, nodir: true, absolute: false })
            const limited = matches.slice(0, args.maxResults ?? 2000)
            return { content: [{ type: 'json', json: limited }] }
          }
          case 'move_file': {
            const from = resolveSafe(args.from)
            const to = resolveSafe(args.to)
            await fs.mkdir(path.dirname(to), { recursive: true })
            await fs.rename(from, to)
            return { content: [{ type: 'text', text: 'ok' }] }
          }
          case 'delete_file': {
            const file = resolveSafe(args.path)
            const st = await fs.stat(file).catch(() => null)
            if (!st) return { content: [{ type: 'text', text: 'not_found' }] }
            if (st.isDirectory()) throw new Error('Refusing to delete directories')
            await fs.unlink(file)
            return { content: [{ type: 'text', text: 'ok' }] }
          }
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
        }
      } catch (err) {
        const msg = err?.message || String(err)
        return { content: [{ type: 'text', text: `❌ ${name} error: ${msg}` }], isError: true }
      }
    })
  }

  async run() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('FS MCP Server running on stdio')
  }
}

new FSServer().run()

