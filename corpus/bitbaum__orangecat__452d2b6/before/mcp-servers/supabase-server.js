#!/usr/bin/env node

/**
 * Supabase MCP Server
 * Provides safe read/write utilities to interact with Supabase from AI agents.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const { createClient } = require('@supabase/supabase-js')

function makeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !(anon || service)) {
    throw new Error('Missing Supabase environment variables: set NEXT_PUBLIC_SUPABASE_URL and one of NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY')
  }
  const key = service || anon
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

class SupabaseMCPServer {
  constructor() {
    this.server = new Server({ name: 'supabase-server', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.supabase = null
    this.setup()
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'ping_supabase', description: 'Verify Supabase connectivity (minimal query)', inputSchema: { type: 'object', properties: {} } },
        { name: 'select_rows', description: 'Select rows from a table', inputSchema: { type: 'object', required: ['table','columns'], properties: { table: { type: 'string' }, columns: { type: 'string', description: 'comma-separated columns or *' }, limit: { type: 'number' }, eq: { type: 'object', additionalProperties: { type: ['string','number','boolean'] } } } } },
        { name: 'insert_row', description: 'Insert a row into a table', inputSchema: { type: 'object', required: ['table','values'], properties: { table: { type: 'string' }, values: { type: 'object' } } } },
        { name: 'update_rows', description: 'Update rows matching equality filters', inputSchema: { type: 'object', required: ['table','values','eq'], properties: { table: { type: 'string' }, values: { type: 'object' }, eq: { type: 'object', additionalProperties: { type: ['string','number','boolean'] } } } } },
        { name: 'count_rows', description: 'Count rows in a table (with optional equality filters)', inputSchema: { type: 'object', required: ['table'], properties: { table: { type: 'string' }, eq: { type: 'object', additionalProperties: { type: ['string','number','boolean'] } } } } },
      ]
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name
      const args = req.params.arguments || {}
      if (!this.supabase) this.supabase = makeClient()

      try {
        switch (name) {
          case 'ping_supabase': {
            const { error } = await this.supabase.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
            if (error) throw error
            return { content: [{ type: 'text', text: 'ok' }] }
          }
          case 'select_rows': {
            const { table, columns, limit = 10, eq = {} } = args
            let q = this.supabase.from(table).select(columns).limit(limit)
            for (const [k, v] of Object.entries(eq)) q = q.eq(k, v)
            const { data, error } = await q
            if (error) throw error
            return { content: [{ type: 'json', json: data }] }
          }
          case 'insert_row': {
            const { table, values } = args
            const { data, error } = await this.supabase.from(table).insert(values).select('*')
            if (error) throw error
            return { content: [{ type: 'json', json: data }] }
          }
          case 'update_rows': {
            const { table, values, eq = {} } = args
            let q = this.supabase.from(table).update(values)
            for (const [k, v] of Object.entries(eq)) q = q.eq(k, v)
            const { data, error } = await q.select('*')
            if (error) throw error
            return { content: [{ type: 'json', json: data }] }
          }
          case 'count_rows': {
            const { table, eq = {} } = args
            let q = this.supabase.from(table).select('id', { count: 'exact', head: true })
            for (const [k, v] of Object.entries(eq)) q = q.eq(k, v)
            const { count, error } = await q
            if (error) throw error
            return { content: [{ type: 'json', json: { count } }] }
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
    console.error('Supabase MCP Server running on stdio')
  }
}

new SupabaseMCPServer().run()

