// Production server: the built page (dist/) and the realtime room (/ws) on one port, so a single
// host such as Railway serves everything from one URL and the page needs no extra config.
//
//   npm run build && PORT=2567 MAX_PLAYERS=500 node server/index.js
//
// The page can also be reached through another site that proxies it, such as the main site's
// Vercel rewrite of /kelas/* to this host. Proxies like that don't carry WebSockets, so the page
// is told this server's own address in a <meta name="kelas-ws"> tag and connects here directly.
// The address comes from KELAS_PUBLIC_WS_URL (set it on Azure Container Apps), or from the
// RAILWAY_PUBLIC_DOMAIN Railway sets.

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createGame } from './game.js'
import { createAdmin } from './admin.js'

const port = Number(process.env.PORT || 2567)
const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const game = createGame({
  maxPlayers: Number(process.env.MAX_PLAYERS || 500),
  allowedOrigins: (process.env.KELAS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
})
const adminApi = createAdmin(game, { token: process.env.KELAS_ADMIN_TOKEN || '' })

// pages served at clean paths; /admin is the organisers' panel
const PAGES = { '/': 'index.html', '/admin': 'admin.html' }

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg'])

const publicWsUrl =
  process.env.KELAS_PUBLIC_WS_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}/ws` : '')

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function withWsMeta(raw) {
  if (!publicWsUrl) return raw
  const tag = `<meta name="kelas-ws" content="${escapeAttr(publicWsUrl)}" />`
  return Buffer.from(raw.toString('utf8').replace('</head>', `    ${tag}\n  </head>`))
}

// dist/ never changes while the process runs, so each file is read (and gzipped) once
const cache = new Map()
async function load(file) {
  if (!cache.has(file)) {
    const promise = readFile(file).then((buf) => {
      const raw = path.basename(file) === 'index.html' ? withWsMeta(buf) : buf
      return { raw, gz: COMPRESSIBLE.has(path.extname(file)) ? gzipSync(raw, { level: 9 }) : null }
    })
    promise.catch(() => cache.delete(file))
    cache.set(file, promise)
  }
  return cache.get(file)
}

async function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '')
  const file = path.resolve(distDir, rel)
  if (!file.startsWith(distDir)) {
    res.statusCode = 403
    res.end()
    return
  }
  let body
  try {
    body = await load(file)
  } catch {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(pathname === '/' ? 'Halaman belum dibuat. Jalankan `npm run build` dulu.' : 'Tidak ditemukan.')
    return
  }
  const ext = path.extname(file)
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream')
  // hashed files under assets/ never change; index.html must be fetched fresh after a deploy
  res.setHeader('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('Vary', 'Accept-Encoding')
  const gzip = body.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')
  if (gzip) res.setHeader('Content-Encoding', 'gzip')
  const data = gzip ? body.gz : body.raw
  res.setHeader('Content-Length', data.length)
  res.end(req.method === 'HEAD' ? undefined : data)
}

const server = http.createServer((req, res) => {
  let pathname
  try {
    pathname = new URL(req.url, 'http://localhost').pathname
  } catch {
    res.statusCode = 400
    res.end()
    return
  }
  if (pathname.startsWith('/admin/api/')) {
    if (!adminApi(req, res)) {
      res.statusCode = 404
      res.end()
    }
  } else if (pathname === '/admin/') {
    // the page's asset and API paths are relative to /admin, so drop the slash (relative
    // Location keeps this working under the main site's /kelas/ prefix too)
    res.statusCode = 308
    res.setHeader('Location', '../admin')
    res.end()
  } else if (pathname === '/health') {
    res.end('ok')
  } else if (pathname === '/stats') {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(game.stats()))
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname).catch(() => {
      res.statusCode = 500
      res.end()
    })
  } else {
    res.statusCode = 405
    res.end()
  }
})

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws') {
    socket.destroy()
    return
  }
  game.handleUpgrade(req, socket, head)
})

server.listen(port, () => {
  console.log(`[kelas] siap di http://localhost:${port} (realtime di /ws)`)
  if (publicWsUrl) console.log(`[kelas] halaman disuruh tersambung ke ${publicWsUrl}`)
  console.log(process.env.KELAS_ADMIN_TOKEN ? '[kelas] panel admin aktif di /admin' : '[kelas] panel admin mati (KELAS_ADMIN_TOKEN belum diisi)')
})

// Railway sends SIGTERM before replacing a deploy: tell everyone to reconnect, then exit
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    game.close()
    server.close()
    setTimeout(() => process.exit(0), 1000).unref()
  })
}
