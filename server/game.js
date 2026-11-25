// The realtime room: who is where, who said what. One process holds one shared map.
//
// Wire format (JSON text frames):
//   client -> server
//     { t: 'join', name, color, sid?, x?, y? } color is an index into COLORS; sid a random id the
//                                             browser keeps, so a returning person counts once;
//                                             x, y to resume a spot after a dropped connection
//     { t: 'mv', x, y, d }              one tile step (or a turn on the spot)
//     { t: 'chat', s, m }               s: 'near' | 'zone' | 'all'
//   server -> client
//     { t: 'hi', id, max, players, ann, chat }
//                                       players: [id, name, color, x, y, d][]; ann the pinned
//                                       announcement ('' for none); chat as in cfg
//     { t: 'tk', m, j, l, n }           every 100 ms when something changed:
//                                       m moves [id, x, y, d][], j joins (as in hi), l leaves [id], n online count
//     { t: 'snap', players, n }         full resync for a client that fell behind
//     { t: 'fix', x, y }                your last step was refused; stand here
//     { t: 'chat', id, n, c, s, m, z }  z is the sender's room name
//     { t: 'ann', m }                   the organisers pinned an announcement ('' takes it down)
//     { t: 'cfg', chat }                chat: 'open' | 'locked' (for everyone) | 'muted' (just you)
//     { t: 'err', code, m }             codes full, closed and kicked come right before the
//                                       server closes the socket (4001, 4002, 4003): don't retry
//
// Steps are batched into one message per tick, built once and sent to everyone, so the cost
// grows with (people moving) x (people online) bytes, not with a message per step per viewer.
//
// The organisers steer the room through act() (see server/admin.js): open it, lock the door
// (people inside stay and can reconnect, nobody new gets in), or close it (everyone out).

import { WebSocketServer, WebSocket } from 'ws'
import { walkable, zoneIndexAt, ZONES, SPAWN, COLORS, NEAR_RADIUS, NAME_MAX, CHAT_MAX, cleanText } from '../shared/map.js'

const TICK_MS = 100
const STEP_REFILL_MS = 110 // a little faster than STEP_MS so honest clients never hit the limit
const STEP_BURST = 4
const CHAT_REFILL_MS = 1500
const CHAT_BURST = 3
const SLOW_CLIENT_BYTES = 512 * 1024
const HEARTBEAT_MS = 15000
const STATS_MS = 5000

const SCOPES = new Set(['near', 'zone', 'all'])
const MODES = new Set(['open', 'locked', 'closed'])
const SID_RE = /^[A-Za-z0-9_-]{8,40}$/
const ANN_MAX = 300
const KICK_BAN_MS = 15 * 60 * 1000
const MAX_LIMIT = 5000
const HISTORY_MAX = (3 * 60 * 60 * 1000) / STATS_MS // three hours of samples
const EVENTS_MAX = 100
const VISITORS_MAX = 50000

const MODE_NOTE = {
  open: 'membuka kelas',
  locked: 'mengunci pintu kelas (peserta baru tidak bisa masuk)',
  closed: 'menutup kelas dan mengeluarkan semua peserta',
}

function takeToken(bucket, now, refillMs, burst) {
  bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) / refillMs)
  bucket.at = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

export function createGame({ maxPlayers = 500, allowedOrigins = [], log = console.log } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false })
  const players = new Map()
  let nextId = 1
  let joined = []
  let left = []
  const moved = new Set()

  const counters = { out: 0, outBytes: 0, in: 0, ticks: 0, tickMs: 0, tickMax: 0, chats: 0 }
  let windowStart = Date.now()
  let rates = { msgsOutPerS: 0, kbOutPerS: 0, msgsInPerS: 0, avgTickMs: 0, maxTickMs: 0, chatsPerMin: 0 }
  let peak = 0
  let peakAt = 0
  let lastLoggedCount = 0
  const startedAt = Date.now()

  // what the organisers control
  let max = maxPlayers
  let mode = 'open'
  let chatLocked = false
  let announcement = ''
  const muted = new Set() // sids, so a muted person stays muted after reconnecting
  const banned = new Map() // sid -> time the kick wears off

  // what they see
  const visitors = new Map() // sid -> first time seen
  const totals = { visitors: 0, reconnects: 0, chats: 0, refused: 0 }
  const history = [] // { t, n, tick, kb } every STATS_MS
  const events = [] // { t, m } the latest EVENTS_MAX happenings worth showing an organiser

  function note(m) {
    events.push({ t: Date.now(), m })
    if (events.length > EVENTS_MAX) events.shift()
    log(`[kelas] ${m}`)
  }

  const row = (p) => [p.id, p.name, p.color, p.x, p.y, p.d]
  const snapshot = () => Array.from(players.values(), row)
  const chatState = (p) => (chatLocked ? 'locked' : p.muted ? 'muted' : 'open')

  function send(p, text) {
    if (p.ws.readyState !== WebSocket.OPEN) return false
    if (p.ws.bufferedAmount > SLOW_CLIENT_BYTES) {
      p.stale = true // skip it; it gets a full snapshot once its buffer drains
      return false
    }
    p.ws.send(text)
    counters.out++
    counters.outBytes += text.length
    return true
  }

  const reply = (p, msg) => send(p, JSON.stringify(msg))

  // say why, then hang up with a code that tells the page not to reconnect by itself
  function hangUp(ws, code, m, closeCode) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'err', code, m }))
    ws.close(closeCode, code)
  }

  function refuse(ws, code, m, closeCode) {
    totals.refused++
    hangUp(ws, code, m, closeCode)
    return null
  }

  function join(ws, msg) {
    const now = Date.now()
    const sid = typeof msg.sid === 'string' && SID_RE.test(msg.sid) ? msg.sid : null
    const known = sid !== null && visitors.has(sid)
    const bannedUntil = sid ? banned.get(sid) ?? 0 : 0
    if (bannedUntil > now) {
      const minutes = Math.ceil((bannedUntil - now) / 60000)
      return refuse(ws, 'kicked', `Kamu dikeluarkan dari kelas oleh panitia. Coba lagi dalam ${minutes} menit.`, 4003)
    }
    if (mode === 'closed') return refuse(ws, 'closed', 'Kelas sedang ditutup panitia. Tunggu info selanjutnya, ya.', 4002)
    if (mode === 'locked' && !known) return refuse(ws, 'closed', 'Pintu kelas sedang dikunci panitia, peserta baru belum bisa masuk.', 4002)
    if (players.size >= max) return refuse(ws, 'full', `Ruangan penuh (maksimal ${max} orang).`, 4001)

    const id = nextId++
    const color = Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS.length ? msg.color : id % COLORS.length
    // a reconnecting client asks to come back where it was; anywhere walkable is fine
    const resume = Number.isInteger(msg.x) && Number.isInteger(msg.y) && walkable(msg.x, msg.y)
    const [x, y] = resume ? [msg.x, msg.y] : SPAWN[Math.floor(Math.random() * SPAWN.length)]
    if (resume) totals.reconnects++
    if (sid) {
      if (!known) {
        totals.visitors++
        if (visitors.size < VISITORS_MAX) visitors.set(sid, now)
      }
    } else if (!resume) {
      totals.visitors++
    }
    const p = {
      id,
      ws,
      sid,
      name: cleanText(msg.name, NAME_MAX) || `Tamu ${id}`,
      color,
      x,
      y,
      d: 0,
      zone: zoneIndexAt(x, y),
      steps: { tokens: STEP_BURST, at: now },
      chats: { tokens: CHAT_BURST, at: now },
      stale: false,
      muted: sid !== null && muted.has(sid),
      since: (sid && visitors.get(sid)) || now,
      said: 0,
    }
    players.set(id, p)
    if (players.size > peak) {
      peak = players.size
      peakAt = now
    }
    joined.push(id)
    reply(p, { t: 'hi', id, max, players: snapshot(), ann: announcement, chat: chatState(p) })
    return p
  }

  function move(p, msg) {
    const { x, y, d } = msg
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(d) || d < 0 || d > 3) return
    const dist = Math.abs(x - p.x) + Math.abs(y - p.y)
    const ok = dist <= 1 && walkable(x, y) && takeToken(p.steps, Date.now(), STEP_REFILL_MS, STEP_BURST)
    if (!ok) {
      if (dist !== 0) reply(p, { t: 'fix', x: p.x, y: p.y })
      return
    }
    p.x = x
    p.y = y
    p.d = d
    p.zone = zoneIndexAt(x, y)
    moved.add(p.id)
  }

  function chat(p, msg) {
    const text = cleanText(msg.m, CHAT_MAX)
    if (!text) return
    if (chatLocked) {
      reply(p, { t: 'err', code: 'locked', m: 'Chat sedang dikunci panitia.' })
      return
    }
    if (p.muted) {
      reply(p, { t: 'err', code: 'muted', m: 'Panitia membisukan chat-mu untuk sementara.' })
      return
    }
    if (!takeToken(p.chats, Date.now(), CHAT_REFILL_MS, CHAT_BURST)) {
      reply(p, { t: 'err', code: 'slow', m: 'Pelan-pelan, tunggu sebentar sebelum kirim pesan lagi.' })
      return
    }
    let scope = SCOPES.has(msg.s) ? msg.s : 'near'
    if (scope === 'zone' && p.zone < 0) scope = 'near'
    const payload = JSON.stringify({ t: 'chat', id: p.id, n: p.name, c: p.color, s: scope, m: text, z: ZONES[p.zone]?.name ?? '' })
    const r2 = NEAR_RADIUS * NEAR_RADIUS
    for (const q of players.values()) {
      if (scope === 'near' && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 > r2) continue
      if (scope === 'zone' && q.zone !== p.zone) continue
      send(q, payload)
    }
    p.said++
    totals.chats++
    counters.chats++
  }

  wss.on('connection', (ws) => {
    let p = null
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('message', (data, isBinary) => {
      counters.in++
      if (isBinary) return
      let msg
      try { msg = JSON.parse(data.toString()) } catch { return }
      if (!msg || typeof msg !== 'object') return
      if (!p) {
        if (msg.t === 'join') p = join(ws, msg)
        return
      }
      if (msg.t === 'mv') move(p, msg)
      else if (msg.t === 'chat') chat(p, msg)
    })
    ws.on('close', () => {
      if (!p) return
      players.delete(p.id)
      moved.delete(p.id)
      left.push(p.id)
      p = null
    })
    ws.on('error', () => {})
  })

  function tick() {
    const t0 = performance.now()
    if (joined.length || left.length || moved.size) {
      const m = []
      for (const id of moved) {
        const p = players.get(id)
        if (p) m.push([id, p.x, p.y, p.d])
      }
      const j = []
      for (const id of joined) {
        const p = players.get(id)
        if (p) j.push(row(p))
      }
      const text = JSON.stringify({ t: 'tk', m, j, l: left, n: players.size })
      joined = []
      left = []
      moved.clear()
      for (const p of players.values()) if (!p.stale) send(p, text)
    }
    for (const p of players.values()) {
      if (p.stale && p.ws.bufferedAmount < SLOW_CLIENT_BYTES / 4) {
        p.stale = false
        reply(p, { t: 'snap', players: snapshot(), n: players.size })
      }
    }
    const ms = performance.now() - t0
    counters.ticks++
    counters.tickMs += ms
    counters.tickMax = Math.max(counters.tickMax, ms)
  }

  function rollStats() {
    const now = Date.now()
    const s = Math.max(0.001, (now - windowStart) / 1000)
    rates = {
      msgsOutPerS: Math.round(counters.out / s),
      kbOutPerS: Math.round(counters.outBytes / 1024 / s),
      msgsInPerS: Math.round(counters.in / s),
      avgTickMs: Number((counters.tickMs / Math.max(1, counters.ticks)).toFixed(2)),
      maxTickMs: Number(counters.tickMax.toFixed(2)),
      chatsPerMin: Math.round((counters.chats / s) * 60),
    }
    Object.assign(counters, { out: 0, outBytes: 0, in: 0, ticks: 0, tickMs: 0, tickMax: 0, chats: 0 })
    windowStart = now
    history.push({ t: now, n: players.size, tick: rates.avgTickMs, kb: rates.kbOutPerS })
    if (history.length > HISTORY_MAX) history.shift()
    for (const [sid, until] of banned) if (until <= now) banned.delete(sid)
    if (players.size || lastLoggedCount) {
      log(`[kelas] ${players.size} online · tick ${rates.avgTickMs} ms (maks ${rates.maxTickMs}) · keluar ${rates.msgsOutPerS} pesan/s, ${rates.kbOutPerS} KB/s · masuk ${rates.msgsInPerS} pesan/s`)
    }
    lastLoggedCount = players.size
  }

  function heartbeat() {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue }
      ws.isAlive = false
      ws.ping()
    }
  }

  const timers = [setInterval(tick, TICK_MS), setInterval(rollStats, STATS_MS), setInterval(heartbeat, HEARTBEAT_MS)]
  note('Server dinyalakan; semua hitungan mulai dari nol')

  function stats() {
    return {
      online: players.size,
      peak,
      max,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      ...rates,
    }
  }

  // ---- organiser controls ----------------------------------------------------------------------

  function setMode(next, by) {
    if (!MODES.has(next)) return { ok: false, m: 'Status kelas tidak dikenal.' }
    if (next === mode) return { ok: true }
    mode = next
    if (mode === 'closed') {
      for (const p of players.values()) hangUp(p.ws, 'closed', 'Kelas sudah ditutup panitia. Terima kasih sudah ikut!', 4002)
    }
    note(`${by} ${MODE_NOTE[mode]}`)
    return { ok: true }
  }

  function announce(text, by) {
    const m = cleanText(text, ANN_MAX)
    if (m === announcement) return { ok: true }
    announcement = m
    const payload = JSON.stringify({ t: 'ann', m })
    for (const p of players.values()) send(p, payload)
    note(m ? `${by} memasang pengumuman: “${m}”` : `${by} menurunkan pengumuman`)
    return { ok: true }
  }

  function setChatLocked(on, by) {
    if (on === chatLocked) return { ok: true }
    chatLocked = on
    for (const p of players.values()) reply(p, { t: 'cfg', chat: chatState(p) })
    note(on ? `${by} mengunci chat untuk semua` : `${by} membuka chat lagi`)
    return { ok: true }
  }

  function setMax(n, by) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return { ok: false, m: `Batas peserta harus 1 sampai ${MAX_LIMIT}.` }
    if (n === max) return { ok: true }
    max = n
    note(`${by} mengubah batas peserta jadi ${n} orang`)
    return { ok: true }
  }

  function kick(id, by) {
    const p = players.get(id)
    if (!p) return { ok: false, m: 'Peserta itu sudah tidak ada di kelas.' }
    if (p.sid) banned.set(p.sid, Date.now() + KICK_BAN_MS)
    hangUp(p.ws, 'kicked', 'Kamu dikeluarkan dari kelas oleh panitia.', 4003)
    note(`${by} mengeluarkan ${p.name} (tidak bisa masuk lagi selama 15 menit)`)
    return { ok: true }
  }

  function mute(id, on, by) {
    const p = players.get(id)
    if (!p) return { ok: false, m: 'Peserta itu sudah tidak ada di kelas.' }
    if (p.muted === on) return { ok: true }
    p.muted = on
    if (p.sid) on ? muted.add(p.sid) : muted.delete(p.sid)
    reply(p, { t: 'cfg', chat: chatState(p) })
    note(on ? `${by} membisukan chat ${p.name}` : `${by} membuka bisu chat ${p.name}`)
    return { ok: true }
  }

  return {
    handleUpgrade(req, socket, head) {
      const origin = req.headers.origin
      if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    },
    stats,
    // everything the admin page shows; history only after `since` so polling stays small
    adminState(since = 0) {
      const now = Date.now()
      const inZone = new Array(ZONES.length + 1).fill(0) // last slot: between rooms
      const people = []
      for (const p of players.values()) {
        inZone[p.zone >= 0 ? p.zone : ZONES.length]++
        people.push({
          id: p.id,
          name: p.name,
          color: COLORS[p.color],
          zone: ZONES[p.zone]?.name ?? 'Lorong',
          sinceS: Math.round((now - p.since) / 1000),
          chats: p.said,
          muted: p.muted,
        })
      }
      return {
        now,
        startedAt,
        mode,
        chatLocked,
        announcement,
        ...stats(),
        peakAt,
        visitors: totals.visitors,
        reconnects: totals.reconnects,
        chats: totals.chats,
        refused: totals.refused,
        rooms: [...ZONES.map((z, i) => ({ name: z.name, n: inZone[i] })), { name: 'Lorong', n: inZone[ZONES.length] }],
        people,
        events,
        history: since ? history.filter((h) => h.t > since) : history,
      }
    },
    // one organiser action; `by` is the name they gave the admin page, for the activity list
    act(action) {
      const by = cleanText(action?.by, NAME_MAX) || 'Panitia'
      switch (action?.a) {
        case 'mode': return setMode(action.mode, by)
        case 'announce': return announce(action.m, by)
        case 'chat': return setChatLocked(action.locked === true, by)
        case 'max': return setMax(action.n, by)
        case 'kick': return kick(action.id, by)
        case 'mute': return mute(action.id, action.on === true, by)
        default: return { ok: false, m: 'Perintah tidak dikenal.' }
      }
    },
    // 1012 "service restart" tells clients to reconnect, which lands them on the new deploy
    close() {
      timers.forEach(clearInterval)
      for (const ws of wss.clients) ws.close(1012, 'restart')
      wss.close()
    },
  }
}
