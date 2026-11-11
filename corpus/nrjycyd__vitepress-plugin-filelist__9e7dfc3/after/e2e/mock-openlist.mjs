// Minimal OpenList for the browser tests: /api/fs/list, /api/fs/get,
// /api/public/settings and /p/ downloads (always attachments, like OpenList).
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT || 5299)
const ORIGIN = `http://localhost:${PORT}`
const KB = 1024
const MB = 1024 * KB
const DAY = '2026-10-01T00:00:00Z'

const dir = (name) => ({ name, size: 0, is_dir: true, modified: DAY })
const file = (name, size) => ({ name, size, is_dir: false, modified: DAY })

export const tree = {
  '/': [
    dir('Locked'),
    dir('photos'),
    dir('videos'),
    file('big-a.bin', 2 * MB),
    file('big-b.bin', 2 * MB),
    file('broken.bin', 4 * KB),
    file('notes.txt', 2 * KB),
  ],
  '/Locked': [file('secret-1.txt', 3 * KB), file('secret-2.txt', 3 * KB)],
  '/photos': Array.from({ length: 450 }, (_, i) => file(`IMG_${String(i + 1).padStart(4, '0')}.jpg`, 2 * KB + i)),
  '/videos': [],
}
const passwords = { '/Locked': '1234' }

const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/'
const find = (path) => (tree[parentOf(path)] || []).find((item) => item.name === path.split('/').pop())
const guard = (path, password) => {
  const lock = Object.entries(passwords).find(([folder]) => path === folder || path.startsWith(`${folder}/`))
  return !lock || lock[1] === password
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') return res.end()
  const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname)
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const json = (data, code = 200, message = 'success') => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ code, message, data }))
    }
    const body = raw ? JSON.parse(raw) : {}
    if (path === '/api/public/settings') return json({ site_title: 'Mock OpenList' })
    if (path === '/api/fs/list' || path === '/api/fs/get') {
      if (!guard(body.path, body.password)) return json(null, 403, 'password is incorrect or you have no permission')
      if (path === '/api/fs/list') return json({ content: tree[body.path] || [] })
      const item = find(body.path)
      if (!item) return json(null, 404, 'object not found')
      return json({ ...item, raw_url: `${ORIGIN}/p${body.path}` })
    }
    if (path.startsWith('/p/')) {
      const item = find(path.slice(2))
      if (!item || item.is_dir) return res.writeHead(404).end()
      if (item.name === 'broken.bin') return res.writeHead(500).end('broken')
      res.writeHead(200, {
        'Content-Length': item.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      })
      return res.end(Buffer.alloc(item.size, 7))
    }
    res.writeHead(404).end()
  })
})

server.listen(PORT, () => console.log(`mock OpenList on ${ORIGIN}`))
