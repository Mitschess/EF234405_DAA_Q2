import '@fontsource-variable/fredoka'
import '@fontsource-variable/caveat'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/600.css'
import './style.css'
import * as Phaser from 'phaser'
import { COLORS, NAME_MAX } from '../shared/map.js'
import { WorldScene } from './scene.js'

// a build-time URL wins; otherwise the server names itself in <meta name="kelas-ws"> (so the page
// still reaches it when served through the main site's /kelas proxy); otherwise same origin
const WS_URL =
  import.meta.env.VITE_KELAS_WS_URL ||
  document.querySelector('meta[name="kelas-ws"]')?.content ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const SCOPE_LABEL = { near: 'Sekitar', zone: 'Ruangan', all: 'Semua' }
const LOG_LIMIT = 150

const $ = (id) => document.getElementById(id)
const el = {
  hud: $('hud'),
  join: $('join'),
  joinForm: $('join-form'),
  joinName: $('join-name'),
  joinButton: $('join-button'),
  joinStatus: $('join-status'),
  colors: $('color-choices'),
  lost: $('lost'),
  lostTitle: $('lost-title'),
  lostReason: $('lost-reason'),
  announce: $('announce'),
  announceText: $('announce-text'),
  announceClose: $('announce-close'),
  reconnect: $('reconnect'),
  reconnecting: $('reconnecting'),
  zoneName: $('zone-name'),
  zoneCount: $('zone-count'),
  online: $('online-count'),
  toast: $('toast'),
  chat: $('chat'),
  chatToggle: $('chat-toggle'),
  unread: $('unread'),
  log: $('chat-log'),
  form: $('chat-form'),
  scope: $('chat-scope'),
  input: $('chat-input'),
  sendButton: $('chat-form').querySelector('button[type="submit"]'),
}

const store = {
  get(key) { try { return localStorage.getItem(key) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, value) } catch { /* private mode */ } },
}

// a random id this browser keeps, so the organisers count a returning person once and a muted
// or removed person stays that way after a reload
function newSid() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
let sid = store.get('kelas:sid')
if (!sid || !/^[A-Za-z0-9_-]{8,40}$/.test(sid)) {
  sid = newSid()
  store.set('kelas:sid', sid)
}

// ---- join card ---------------------------------------------------------------------------------

let color = Number(store.get('kelas:color'))
if (!Number.isInteger(color) || color < 0 || color >= COLORS.length) color = Math.floor(Math.random() * COLORS.length)
el.joinName.value = store.get('kelas:name') ?? ''
el.joinName.maxLength = NAME_MAX

COLORS.forEach((hex, i) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'swatch'
  b.style.setProperty('--swatch', hex)
  b.setAttribute('aria-label', `Warna ${i + 1}`)
  b.setAttribute('aria-pressed', String(i === color))
  b.addEventListener('click', () => {
    color = i
    for (const other of el.colors.children) other.setAttribute('aria-pressed', String(other === b))
  })
  el.colors.append(b)
})

// ---- connection --------------------------------------------------------------------------------

// A dropped connection (flaky Wi-Fi, a server redeploy) reconnects by itself with backoff and
// puts you back on the tile you were standing on. Only after a minute of failures does the
// "Koneksi terputus" card ask you to press a button.
const GIVE_UP_MS = 60000
// The server explains itself right before hanging up on purpose; those never reconnect by
// themselves. The value is the title of the card that shows the reason.
const REFUSALS = { full: 'Kelas penuh', closed: 'Kelas ditutup', kicked: 'Kamu dikeluarkan' }

let ws = null
let me = null // our id on the current connection
let wantIn = false // the person pressed Masuk and hasn't left or been refused
let joinedOnce = false
let retries = 0
let retryTimer = 0
let downSince = 0
let online = 0

const connected = () => ws?.readyState === WebSocket.OPEN && me !== null

function send(msg) {
  if (connected()) ws.send(JSON.stringify(msg))
}

function connect() {
  clearTimeout(retryTimer)
  wantIn = true
  const name = el.joinName.value.trim()
  el.joinButton.disabled = true
  el.reconnect.disabled = true
  if (!joinedOnce) el.joinStatus.textContent = 'Menyambung…'
  const socket = new WebSocket(WS_URL)
  ws = socket
  let refused = null
  socket.addEventListener('open', () => {
    const spot = scene.me ? { x: scene.me.x, y: scene.me.y } : {}
    socket.send(JSON.stringify({ t: 'join', name, color, sid, ...spot }))
  })
  socket.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    if (msg.t === 'err' && REFUSALS[msg.code]) refused = msg
    else handle(msg)
  })
  socket.addEventListener('close', () => {
    if (ws !== socket) return
    ws = null
    me = null
    el.joinButton.disabled = false
    el.reconnect.disabled = false
    if (refused || !joinedOnce) {
      // turned away (full, closed, removed) or never got in: say why on the card in view
      wantIn = false
      el.reconnecting.hidden = true
      if (joinedOnce) showLost(refused?.m, REFUSALS[refused?.code])
      else el.joinStatus.textContent = refused?.m || 'Tidak bisa tersambung ke server kelas. Coba lagi sebentar lagi.'
      return
    }
    if (!wantIn) return
    downSince ||= Date.now()
    if (Date.now() - downSince > GIVE_UP_MS) {
      wantIn = false
      el.reconnecting.hidden = true
      showLost('Sudah dicoba menyambung ulang selama satu menit tapi belum berhasil. Cek internetmu, lalu coba lagi.')
      return
    }
    el.reconnecting.hidden = false
    const delay = Math.min(8000, 500 * 2 ** retries++) * (0.75 + Math.random() * 0.5)
    retryTimer = setTimeout(connect, delay)
  })
}

function showLost(reason, title) {
  el.lostTitle.textContent = title || 'Koneksi terputus'
  el.lostReason.textContent = reason || 'Sambungan ke kelas hilang.'
  el.reconnect.textContent = title ? 'Coba masuk lagi' : 'Sambung lagi'
  el.lost.hidden = false
}

function rejoin() {
  retries = 0
  downSince = 0
  connect()
}

function handle(msg) {
  switch (msg.t) {
    case 'hi': {
      me = msg.id
      retries = 0
      downSince = 0
      scene.enter(msg)
      el.join.hidden = true
      el.lost.hidden = true
      el.reconnecting.hidden = true
      el.hud.hidden = false
      el.joinStatus.textContent = ''
      setOnline(msg.players.length)
      const name = msg.players.find((p) => p[0] === me)?.[1] ?? 'tamu'
      system(joinedOnce ? 'Tersambung lagi.' : `Kamu masuk sebagai ${name}. Ketik Enter untuk chat.`)
      joinedOnce = true
      setAnnouncement(msg.ann)
      setChat(msg.chat)
      break
    }
    case 'ann':
      setAnnouncement(msg.m)
      break
    case 'cfg':
      setChat(msg.chat)
      break
    case 'tk':
      scene.tick(msg)
      setOnline(msg.n)
      break
    case 'snap':
      scene.resync(msg.players)
      setOnline(msg.n)
      break
    case 'fix':
      scene.fix(msg.x, msg.y)
      break
    case 'chat':
      addMessage(msg)
      scene.say(msg.id, msg.m)
      break
    case 'err':
      system(msg.m)
      break
  }
}

el.joinForm.addEventListener('submit', (event) => {
  event.preventDefault()
  store.set('kelas:name', el.joinName.value.trim())
  store.set('kelas:color', String(color))
  rejoin()
})
el.reconnect.addEventListener('click', rejoin)

// ---- hud ---------------------------------------------------------------------------------------

function setOnline(n) {
  online = n
  el.online.textContent = n.toLocaleString('id-ID')
}

let toastTimer = 0
function toast(text) {
  el.toast.textContent = text
  el.toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800)
}

// the organisers' pinned announcement: a banner until dismissed, and a line in the chat log
let announcement = ''
let dismissed = ''
function setAnnouncement(text = '') {
  if (text && text !== announcement) system(`Pengumuman panitia: ${text}`)
  if (!text) dismissed = ''
  announcement = text
  el.announceText.textContent = text
  el.announce.hidden = !text || text === dismissed
}
el.announceClose.addEventListener('click', () => {
  dismissed = announcement
  el.announce.hidden = true
})

function onZone(zone, here, _total, changed) {
  el.zoneName.textContent = zone?.name ?? 'Kampus'
  el.zoneCount.textContent = ` · ${here.toLocaleString('id-ID')} orang`
  if (changed && zone) toast(`Masuk ${zone.name}`)
}

// ---- chat --------------------------------------------------------------------------------------

let unread = 0
const isOpen = () => el.chat.dataset.open === 'true'

function setOpen(open) {
  el.chat.dataset.open = String(open)
  el.chatToggle.setAttribute('aria-expanded', String(open))
  if (open) {
    unread = 0
    el.unread.hidden = true
    el.log.scrollTop = el.log.scrollHeight
  }
}
el.chatToggle.addEventListener('click', () => setOpen(!isOpen()))
if (window.matchMedia('(max-width: 640px)').matches) setOpen(false)

function append(li) {
  const stick = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 40
  el.log.append(li)
  while (el.log.children.length > LOG_LIMIT) el.log.firstElementChild.remove()
  if (stick) el.log.scrollTop = el.log.scrollHeight
}

function addMessage(msg) {
  const li = document.createElement('li')
  li.className = `msg scope-${msg.s}${msg.id === me ? ' mine' : ''}`
  const who = document.createElement('span')
  who.className = 'who'
  who.style.setProperty('--who', COLORS[msg.c] ?? '#fff')
  who.textContent = msg.n
  const tag = document.createElement('span')
  tag.className = 'tag'
  tag.textContent = msg.s === 'zone' && msg.z ? msg.z : SCOPE_LABEL[msg.s]
  const text = document.createElement('span')
  text.className = 'text'
  text.textContent = msg.m
  li.append(who, tag, text)
  append(li)
  if (!isOpen() && msg.id !== me) {
    unread++
    el.unread.textContent = unread > 99 ? '99+' : String(unread)
    el.unread.hidden = false
  }
}

function system(text) {
  const li = document.createElement('li')
  li.className = 'msg system'
  li.textContent = text
  append(li)
}

// 'locked' is for everyone, 'muted' just for this person; both come from the organisers
const CHAT_PLACEHOLDER = { open: 'Tulis pesan…', locked: 'Chat dikunci panitia', muted: 'Chat-mu dibisukan panitia' }
const CHAT_NOTE = {
  open: 'Chat dibuka lagi oleh panitia.',
  locked: 'Panitia mengunci chat untuk sementara.',
  muted: 'Panitia membisukan chat-mu untuk sementara.',
}
let chatState = 'open'
function setChat(next = 'open') {
  if (!CHAT_PLACEHOLDER[next]) next = 'open'
  if (next === chatState) return
  chatState = next
  const off = next !== 'open'
  el.input.disabled = off
  el.scope.disabled = off
  el.sendButton.disabled = off
  el.input.placeholder = CHAT_PLACEHOLDER[next]
  system(CHAT_NOTE[next])
}

el.form.addEventListener('submit', (event) => {
  event.preventDefault()
  const m = el.input.value.trim()
  if (!m) { el.input.blur(); return }
  if (!connected()) {
    system('Belum tersambung, pesan belum terkirim. Tunggu sebentar lalu kirim lagi.')
    return
  }
  send({ t: 'chat', s: el.scope.value, m })
  el.input.value = ''
  el.input.blur()
})

const typing = () => {
  const a = document.activeElement
  return a === el.input || a === el.scope || a === el.joinName
}

window.addEventListener('keydown', (event) => {
  if (!joinedOnce) return
  if (event.key === 'Enter' && !typing()) {
    event.preventDefault()
    setOpen(true)
    el.input.focus()
  } else if (event.key === 'Escape' && typing()) {
    el.input.blur()
    el.scope.blur()
  }
})

// ---- game --------------------------------------------------------------------------------------

const scene = new WorldScene({
  send,
  typing,
  blurChat: () => { el.input.blur(); el.scope.blur() },
  zone: onZone,
  ready: () => {
    el.joinButton.disabled = false
    el.joinButton.textContent = 'Masuk'
  },
})

if (import.meta.env.DEV) window.__kelas = scene

el.joinButton.disabled = true
el.joinButton.textContent = 'Memuat…'
el.joinName.focus()

// draw the map only once the fonts it labels with are ready
Promise.allSettled([
  document.fonts.load('600 16px "Fredoka Variable"'),
  document.fonts.load('700 26px "Caveat Variable"'),
  document.fonts.load('600 11px Poppins'),
  document.fonts.load('400 12px Poppins'),
]).then(async () => {
  // WebGL can't make a 0×0 canvas; a page opened in a collapsed frame waits until it has a size
  while (!window.innerWidth || !window.innerHeight) await new Promise((r) => window.addEventListener('resize', r, { once: true }))
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#160a45',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    render: { antialias: true, roundPixels: true },
    scene: [scene],
  })
})
