// Load test: connect N bot players that wander the campus and chat now and then.
//
//   node scripts/bots.js [jumlah=200] [detik=60] [url=ws://127.0.0.1:5185/ws]
//
// Bots walk in bursts with pauses, roughly like people do, so the load is realistic but busy:
// about two in three bots are moving at any moment. They read nothing but their own
// corrections, so the numbers measure the server, not the bot process.

import WebSocket from 'ws'
import { walkable, DX, DY, COLORS } from '../shared/map.js'

const count = Number(process.argv[2] || 200)
const seconds = Number(process.argv[3] || 60)
const url = process.argv[4] || 'ws://127.0.0.1:5185/ws'
const statsUrl = url.replace(/^ws/, 'http').replace(/\/ws$/, '/stats')

const LINES = ['halo semua!', 'kelasnya di mana ya?', 'aku di lobi', 'ayo ke aula', 'materi hari ini apa?', 'siap kak', 'wkwk', 'izin bertanya kak']
const totals = { open: 0, joined: 0, closed: 0, fixes: 0, received: 0, bytes: 0, refused: 0 }
const closeCodes = new Map() // close code -> count, for bots that dropped before the end
const startedAt = Date.now()
let firstDropS = null
let ending = false
const bots = []

function startBot(i) {
  const ws = new WebSocket(url)
  const bot = { ws, x: 0, y: 0, d: 0, ready: false, walkUntil: 0, restUntil: 0, timers: [] }
  bots.push(bot)
  ws.on('open', () => {
    totals.open++
    ws.send(JSON.stringify({ t: 'join', name: `Bot ${i + 1}`, color: i % COLORS.length }))
  })
  ws.on('message', (data) => {
    totals.received++
    totals.bytes += data.length
    const text = data.toString()
    if (!bot.ready && text.startsWith('{"t":"hi"')) {
      const hi = JSON.parse(text)
      const mine = hi.players.find((p) => p[0] === hi.id)
      bot.x = mine[3]
      bot.y = mine[4]
      bot.ready = true
      totals.joined++
    } else if (text.startsWith('{"t":"fix"')) {
      const fix = JSON.parse(text)
      bot.x = fix.x
      bot.y = fix.y
      totals.fixes++
    } else if (text.startsWith('{"t":"err","code":"full"')) {
      totals.refused++
    }
  })
  ws.on('close', (code) => {
    totals.closed++
    if (ending) return
    closeCodes.set(code, (closeCodes.get(code) ?? 0) + 1)
    firstDropS ??= Math.round((Date.now() - startedAt) / 1000)
  })
  ws.on('error', () => {})

  // walk: a step every 150-250 ms during a burst of 1-5 s, then rest 0.5-3 s
  const walk = () => {
    const now = Date.now()
    if (bot.ready && ws.readyState === WebSocket.OPEN) {
      if (now > bot.walkUntil && now > bot.restUntil) {
        bot.restUntil = now + 500 + Math.random() * 2500
        bot.walkUntil = bot.restUntil + 1000 + Math.random() * 4000
      }
      if (now > bot.restUntil && now < bot.walkUntil) {
        if (Math.random() < 0.25) bot.d = Math.floor(Math.random() * 4)
        for (let tries = 0; tries < 4 && !walkable(bot.x + DX[bot.d], bot.y + DY[bot.d]); tries++) bot.d = Math.floor(Math.random() * 4)
        const nx = bot.x + DX[bot.d]
        const ny = bot.y + DY[bot.d]
        if (walkable(nx, ny)) {
          bot.x = nx
          bot.y = ny
          ws.send(JSON.stringify({ t: 'mv', x: nx, y: ny, d: bot.d }))
        }
      }
    }
    bot.timers[0] = setTimeout(walk, 150 + Math.random() * 100)
  }
  // chat: roughly once every 30 s per bot, mostly to people nearby
  const talk = () => {
    if (bot.ready && ws.readyState === WebSocket.OPEN) {
      const s = Math.random() < 0.8 ? 'near' : Math.random() < 0.7 ? 'zone' : 'all'
      ws.send(JSON.stringify({ t: 'chat', s, m: LINES[Math.floor(Math.random() * LINES.length)] }))
    }
    bot.timers[1] = setTimeout(talk, 15000 + Math.random() * 30000)
  }
  bot.timers[0] = setTimeout(walk, 500)
  bot.timers[1] = setTimeout(talk, 5000 + Math.random() * 30000)
}

async function serverStats() {
  try {
    const res = await fetch(statsUrl)
    return await res.json()
  } catch {
    return null
  }
}

console.log(`Menyambungkan ${count} bot ke ${url} selama ${seconds} detik…`)
for (let i = 0; i < count; i++) setTimeout(() => startBot(i), i * 10)

let last = { received: 0, bytes: 0 }
const report = setInterval(async () => {
  const s = await serverStats()
  const got = totals.received - last.received
  const kb = (totals.bytes - last.bytes) / 1024
  last = { received: totals.received, bytes: totals.bytes }
  console.log(
    `bot tersambung ${totals.joined}/${count}` +
      (totals.refused ? ` (ditolak penuh: ${totals.refused})` : '') +
      ` · diterima semua bot ${Math.round(got / 5)} pesan/s, ${Math.round(kb / 5)} KB/s · koreksi ${totals.fixes}` +
      (s ? ` | server: ${s.online} online, tick ${s.avgTickMs} ms (maks ${s.maxTickMs}), RAM ${s.rssMB} MB` : ''),
  )
}, 5000)

setTimeout(async () => {
  clearInterval(report)
  const s = await serverStats()
  ending = true
  const drops = [...closeCodes].map(([code, n]) => `${n}× kode ${code}`).join(', ')
  console.log(drops ? `\nBot yang terputus sebelum selesai: ${drops} (pertama di detik ${firstDropS}). 1006 = putus tanpa salam penutup (jaringan/heartbeat), 1012 = server restart.` : '\nTidak ada bot yang terputus sebelum selesai.')
  for (const bot of bots) {
    bot.timers.forEach(clearTimeout)
    bot.ws.close()
  }
  console.log('\nSelesai.', s ? `Puncak di server: ${s.peak} orang. Tick rata-rata terakhir ${s.avgTickMs} ms dari jatah 100 ms.` : '')
  setTimeout(() => process.exit(0), 500)
}, seconds * 1000)
