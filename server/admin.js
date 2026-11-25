// The organisers' API behind the admin page (admin.html):
//
//   GET  /admin/api/state?since=<ms>   everything the page shows (see game.adminState)
//   POST /admin/api/action             one control, e.g. { a: 'mode', mode: 'locked', by: 'Rara' }
//
// Both need `Authorization: Bearer <KELAS_ADMIN_TOKEN>`. Without a token set on the server the API
// stays off. Wrong codes are counted per address and slowed down, so the code can't be guessed.
// No CORS headers on purpose: only the admin page served from this host (or the main site's
// /kelas proxy) can call it.

import { createHash, timingSafeEqual } from 'node:crypto'

const BODY_MAX = 4096
const FAIL_WINDOW_MS = 60_000
const FAIL_LIMIT = 8

const digest = (s) => createHash('sha256').update(String(s)).digest()

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_MAX) {
        reject(new Error('too big'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

export function createAdmin(game, { token = '', log = console.log } = {}) {
  const want = token ? digest(token) : null
  const failures = new Map() // address -> { n, since }
  if (token && token.length < 16) log('[kelas] peringatan: KELAS_ADMIN_TOKEN pendek, pakai minimal 16 karakter acak')

  const address = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'

  function authorized(req, res) {
    if (!want) {
      json(res, 503, { error: 'off', m: 'Panel admin belum aktif. Isi variable KELAS_ADMIN_TOKEN di server, lalu deploy ulang.' })
      return false
    }
    const who = address(req)
    const now = Date.now()
    let entry = failures.get(who)
    if (entry && now - entry.since > FAIL_WINDOW_MS) entry = null
    if (entry && entry.n >= FAIL_LIMIT) {
      res.setHeader('Retry-After', String(Math.ceil((entry.since + FAIL_WINDOW_MS - now) / 1000)))
      json(res, 429, { error: 'slow', m: 'Terlalu banyak kode salah. Tunggu satu menit lalu coba lagi.' })
      return false
    }
    const header = String(req.headers.authorization || '')
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (given && timingSafeEqual(digest(given), want)) {
      failures.delete(who)
      return true
    }
    entry ??= { n: 0, since: now }
    entry.n++
    if (failures.size > 10000) failures.clear()
    failures.set(who, entry)
    json(res, 401, { error: 'auth', m: 'Kode admin salah.' })
    return false
  }

  // returns true when the request was for the admin API (and has been answered)
  return function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/admin/api/state') {
      if (req.method !== 'GET') json(res, 405, { error: 'method' })
      else if (authorized(req, res)) json(res, 200, game.adminState(Number(url.searchParams.get('since')) || 0))
      return true
    }
    if (url.pathname === '/admin/api/action') {
      if (req.method !== 'POST') json(res, 405, { error: 'method' })
      else if (authorized(req, res)) {
        readJson(req).then(
          (action) => {
            const result = game.act(action)
            json(res, result.ok ? 200 : 400, result)
          },
          () => json(res, 400, { ok: false, m: 'Permintaan tidak bisa dibaca.' }),
        )
      }
      return true
    }
    return false
  }
}
