import '@fontsource-variable/fredoka'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/600.css'
import './admin.css'

// The organisers' panel. It polls the server every 2 s and sends controls as single actions.
// Every URL is relative, so the page works at <railway>/admin and at <main site>/kelas/admin.

const POLL_MS = 2000
const HIDDEN_POLL_MS = 10000
const KEEP_MS = 3 * 60 * 60 * 1000
const GAP_MS = 20000 // samples come every 5 s; a longer hole breaks the line instead of bridging it
const PEOPLE_SHOWN = 200
const TOKEN_KEY = 'kelas-admin:token'
const NAME_KEY = 'kelas-admin:name'

const MODE_LABEL = { open: 'Terbuka', locked: 'Pintu dikunci', closed: 'Ditutup' }
const MODE_DONE = { open: 'Kelas dibuka.', locked: 'Pintu kelas dikunci.', closed: 'Kelas ditutup.' }

const $ = (id) => document.getElementById(id)
const api = (path) => new URL(`admin/api/${path}`, location.href)

const store = {
  get(area, key) { try { return window[area].getItem(key) } catch { return null } },
  set(area, key, value) {
    try { value == null ? window[area].removeItem(key) : window[area].setItem(key, value) } catch { /* private mode */ }
  },
}

const nf = new Intl.NumberFormat('id-ID')
const fmt = (n) => nf.format(n)
const dec = (n) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 })
const clock = (t, seconds = false) =>
  new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', ...(seconds && { second: '2-digit' }) })

function duration(s) {
  if (s < 60) return `${s} dtk`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} mnt`
  return `${Math.floor(m / 60)} j ${m % 60} mnt`
}

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text != null) e.textContent = text
  return e
}

let token = store.get('sessionStorage', TOKEN_KEY) || ''
let adminName = store.get('localStorage', NAME_KEY) || ''
let state = null
let history = []
let since = 0
let startedAt = 0
let lastOk = 0
let pollTimer = 0
let busy = false
let rangeMin = 15

// ---- sign in -----------------------------------------------------------------------------------

function showApp() {
  $('login').hidden = true
  $('app').hidden = false
}

function signOut(message = '') {
  token = ''
  store.set('sessionStorage', TOKEN_KEY, null)
  clearTimeout(pollTimer)
  state = null
  history = []
  since = 0
  startedAt = 0
  $('app').hidden = true
  $('login').hidden = false
  $('login-status').textContent = message
  $('login-token').value = ''
  $('login-token').focus()
}

$('login-name').value = adminName
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  token = $('login-token').value.trim()
  adminName = $('login-name').value.trim()
  store.set('localStorage', NAME_KEY, adminName)
  $('login-button').disabled = true
  $('login-status').textContent = 'Memeriksa kode…'
  const outcome = await poll()
  $('login-button').disabled = false
  if (outcome === 'ok') {
    store.set('sessionStorage', TOKEN_KEY, token)
    $('login-status').textContent = ''
    showApp()
  } else if (outcome === 'offline') {
    clearTimeout(pollTimer)
    token = ''
    $('login-status').textContent = 'Server kelas tidak terjangkau. Coba lagi sebentar lagi.'
  }
})
$('logout').addEventListener('click', () => signOut())

// ---- polling -----------------------------------------------------------------------------------

async function poll() {
  clearTimeout(pollTimer)
  if (!token) return 'auth'
  let outcome = 'ok'
  try {
    const res = await fetch(api(`state?since=${since}`), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 || res.status === 429 || res.status === 503) {
      signOut(body.m || 'Kode admin salah.')
      return 'auth'
    }
    if (!res.ok) throw new Error(String(res.status))
    take(body)
    setOffline(false)
  } catch {
    outcome = 'offline'
    setOffline(true)
  }
  if (token) pollTimer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS)
  return outcome
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && token) poll()
})

function take(s) {
  if (s.startedAt !== startedAt) {
    history = [] // the server restarted: its counters and samples began again
    startedAt = s.startedAt
  }
  for (const h of s.history) if (!history.length || h.t > history.at(-1).t) history.push(h)
  while (history.length && history[0].t < s.now - KEEP_MS) history.shift()
  since = history.at(-1)?.t ?? 0
  state = s
  lastOk = Date.now()
  render()
}

function setOffline(off) {
  $('offline').hidden = !off
  $('board').classList.toggle('stale', off && !!state) // keep the last numbers, dimmed
  if (off) $('updated').textContent = state ? `Terakhir diperbarui ${clock(lastOk, true)}` : 'Belum tersambung'
}

// ---- render ------------------------------------------------------------------------------------

function loadLevel(s) {
  if (s.avgTickMs >= 50 || s.maxTickMs >= 150) return ['crit', 'Berat']
  if (s.avgTickMs >= 20 || s.maxTickMs >= 80) return ['warn', 'Mulai berat']
  return ['good', 'Lancar']
}

function render() {
  const s = state
  const chip = $('mode-chip')
  chip.dataset.mode = s.mode
  chip.textContent = MODE_LABEL[s.mode] ?? s.mode
  $('updated').textContent = `Diperbarui ${clock(lastOk, true)}`

  $('k-online').textContent = fmt(s.online)
  $('k-online-sub').textContent = `dari batas ${fmt(s.max)} · puncak ${fmt(s.peak)}${s.peakAt ? ` pukul ${clock(s.peakAt)}` : ''}`
  $('k-visitors').textContent = fmt(s.visitors)
  $('k-visitors-sub').textContent =
    `orang berbeda sejak server nyala · ${fmt(s.reconnects)}× tersambung ulang` + (s.refused ? ` · ${fmt(s.refused)}× ditolak masuk` : '')
  $('k-chats').textContent = fmt(s.chats)
  $('k-chats-sub').textContent = `±${fmt(s.chatsPerMin)} pesan per menit saat ini`

  const [level, label] = loadLevel(s)
  $('k-load').dataset.level = level
  $('k-load-label').textContent = label
  const meter = $('k-load-meter')
  meter.dataset.level = level
  meter.setAttribute('aria-valuenow', String(Math.min(100, s.avgTickMs)))
  $('k-load-fill').style.width = `${Math.min(100, s.avgTickMs)}%`
  $('k-load-sub').textContent = `${dec(s.avgTickMs)} ms kerja per tick (maks ${dec(s.maxTickMs)}) dari jatah 100 ms`
  $('k-kb').textContent = `${fmt(s.kbOutPerS)} KB/s`
  $('k-ram').textContent = `${fmt(s.rssMB)} MB`
  $('k-uptime').textContent = duration(s.uptimeS)

  renderControls(s)
  renderRooms(s)
  renderCharts()
  renderMinutes()
  renderPeople()
  renderEvents(s)
}

// ---- controls ----------------------------------------------------------------------------------

const modeRadios = [...document.querySelectorAll('input[name="mode"]')]

function renderControls(s) {
  if (!busy) {
    for (const r of modeRadios) r.checked = r.value === s.mode
    $('chat-lock').checked = s.chatLocked
  }
  if (document.activeElement !== $('max-input')) $('max-input').value = String(s.max)
  $('ann-current').textContent = s.announcement ? `Sedang tampil: “${s.announcement}”` : 'Belum ada pengumuman yang tampil.'
  $('ann-clear').disabled = !s.announcement
}

let flashTimer = 0
function flash(text, bad = false) {
  const f = $('flash')
  f.textContent = text
  f.classList.toggle('bad', bad)
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { f.textContent = '' }, 5000)
}

async function act(body, done) {
  busy = true
  flash('Menyimpan…')
  try {
    const res = await fetch(api('action'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, by: adminName }),
    })
    const out = await res.json().catch(() => ({}))
    if (res.status === 401 || res.status === 503) {
      signOut(out.m)
      return false
    }
    if (!res.ok || !out.ok) {
      flash(out.m || 'Gagal menyimpan, coba lagi.', true)
      return false
    }
    flash(done)
    return true
  } catch {
    flash('Server tidak terjangkau, perubahan belum tersimpan.', true)
    return false
  } finally {
    busy = false
    if (token) poll()
  }
}

function confirmDialog(title, text, okLabel) {
  const dialog = $('confirm')
  $('confirm-title').textContent = title
  $('confirm-text').textContent = text
  $('confirm-ok').textContent = okLabel
  dialog.returnValue = ''
  dialog.showModal()
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }))
}

for (const radio of modeRadios) {
  radio.addEventListener('change', async () => {
    if (!radio.checked || !state) return
    const next = radio.value
    if (next === 'closed') {
      busy = true
      const ok = await confirmDialog(
        'Tutup kelas?',
        `${fmt(state.online)} orang di dalam akan langsung dikeluarkan, dan tidak ada yang bisa masuk sampai kelas dibuka lagi.`,
        'Tutup kelas',
      )
      busy = false
      if (!ok) {
        renderControls(state)
        return
      }
    }
    act({ a: 'mode', mode: next }, MODE_DONE[next])
  })
}

$('chat-lock').addEventListener('change', (event) => {
  const locked = event.target.checked
  act({ a: 'chat', locked }, locked ? 'Chat dikunci untuk semua peserta.' : 'Chat dibuka lagi.')
})

$('max-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const n = Number($('max-input').value)
  $('max-input').blur()
  act({ a: 'max', n }, `Batas peserta sekarang ${fmt(n)} orang.`)
})

$('ann-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const m = $('ann-input').value.trim()
  if (!m) {
    flash('Tulis pengumumannya dulu.', true)
    return
  }
  if (await act({ a: 'announce', m }, 'Pengumuman dipasang di layar semua peserta.')) $('ann-input').value = ''
})
$('ann-clear').addEventListener('click', () => act({ a: 'announce', m: '' }, 'Pengumuman diturunkan.'))

// ---- tooltip -----------------------------------------------------------------------------------

const tip = $('tooltip')
function showTip(lines, x, y) {
  tip.replaceChildren(...lines.map((line, i) => el(i ? 'span' : 'strong', '', line)))
  tip.hidden = false
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 14))}px`
  tip.style.top = `${y - h - 12 < 8 ? y + 16 : y - h - 12}px`
}
const hideTip = () => { tip.hidden = true }

// ---- rooms: one series of horizontal bars, value at the tip --------------------------------------

const roomRows = new Map()

function renderRooms(s) {
  const host = $('rooms')
  const top = Math.max(1, ...s.rooms.map((r) => r.n))
  for (const room of s.rooms) {
    let row = roomRows.get(room.name)
    if (!row) {
      const root = el('div', 'bar-row')
      root.tabIndex = 0
      const bar = el('div', 'bar')
      const value = el('span', 'bar-value')
      const track = el('div', 'bar-track')
      track.append(bar, value)
      root.append(el('span', 'bar-name', room.name), track)
      host.append(root)
      row = { root, bar, value, data: room }
      const tipFor = () => {
        const { name, n } = row.data
        const share = state?.online ? Math.round((n / state.online) * 100) : 0
        return [`${fmt(n)} orang`, `${name} · ${share}% dari yang online`]
      }
      root.addEventListener('pointermove', (e) => showTip(tipFor(), e.clientX, e.clientY))
      root.addEventListener('pointerleave', hideTip)
      root.addEventListener('focus', () => {
        const r = bar.getBoundingClientRect()
        showTip(tipFor(), r.right, r.top)
      })
      root.addEventListener('blur', hideTip)
      roomRows.set(room.name, row)
    }
    row.data = room
    row.bar.hidden = room.n === 0
    row.bar.style.width = `calc((100% - 44px) * ${room.n / top})`
    row.value.textContent = fmt(room.n)
    row.root.setAttribute('aria-label', `${room.name}: ${room.n} orang`)
  }
}

// ---- line charts (one series each, one axis each) ------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg'
function svg(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  parent?.append(e)
  return e
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}

function lineChart(host, { name, value, minTop, short, long }) {
  const H = 186
  const M = { top: 12, right: 52, bottom: 24, left: 34 }
  const root = svg('svg', { role: 'img', tabindex: 0, height: H }, host)
  const grid = svg('g', { class: 'grid' }, root)
  const labels = svg('g', {}, root)
  const area = svg('path', { class: 'series-area' }, root)
  const line = svg('path', { class: 'series-line' }, root)
  const base = svg('line', { class: 'baseline' }, root)
  const cross = svg('line', { class: 'crosshair', visibility: 'hidden' }, root)
  const endDot = svg('circle', { class: 'series-dot', r: 4 }, root)
  const endLabel = svg('text', { class: 'end-label', 'dominant-baseline': 'middle' }, root)
  const hoverDot = svg('circle', { class: 'series-dot', r: 4, visibility: 'hidden' }, root)
  const hit = svg('rect', { class: 'hit' }, root)
  const empty = el('p', 'empty', 'Menunggu data (satu titik tiap 5 detik)…')
  host.append(empty)

  let pts = []
  let hover = -1
  let hoverT = 0
  let pointerX = null
  let inner = { top: 0, bottom: 0 }

  function nearest(px) {
    let lo = 0
    let hi = pts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].x < px) lo = mid
      else hi = mid
    }
    return Math.abs(pts[lo].x - px) <= Math.abs(pts[hi].x - px) ? lo : hi
  }

  function showHover(i) {
    hover = i
    const p = pts[i]
    hoverT = p.t
    for (const [k, v] of Object.entries({ x1: p.x, x2: p.x, y1: inner.top, y2: inner.bottom })) cross.setAttribute(k, v)
    cross.setAttribute('visibility', 'visible')
    hoverDot.setAttribute('cx', p.x)
    hoverDot.setAttribute('cy', p.y)
    hoverDot.setAttribute('visibility', 'visible')
    const r = root.getBoundingClientRect()
    showTip([long(p.v), `pukul ${clock(p.t, true)}`], r.left + p.x, r.top + p.y)
  }

  function clearHover() {
    hover = -1
    cross.setAttribute('visibility', 'hidden')
    hoverDot.setAttribute('visibility', 'hidden')
    hideTip()
  }

  hit.addEventListener('pointermove', (e) => {
    pointerX = e.clientX - root.getBoundingClientRect().left
    if (pts.length) showHover(nearest(pointerX))
  })
  hit.addEventListener('pointerleave', () => {
    pointerX = null
    clearHover()
  })
  root.addEventListener('focus', () => { if (pts.length) showHover(pts.length - 1) })
  root.addEventListener('blur', clearHover)
  root.addEventListener('keydown', (e) => {
    if (!pts.length || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const from = hover < 0 ? pts.length - 1 : hover
    showHover(Math.max(0, Math.min(pts.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1))))
  })

  function draw(series, from, to, rangeText) {
    const W = host.clientWidth
    if (!W) return
    root.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const iw = Math.max(10, W - M.left - M.right)
    const ih = H - M.top - M.bottom
    inner = { top: M.top, bottom: M.top + ih }
    const values = series.map(value)
    const peak = Math.max(minTop, ...values)
    const step = niceStep(peak / 4)
    const top = Math.ceil(peak / step) * step
    const x = (t) => M.left + ((t - from) / (to - from)) * iw
    const y = (v) => M.top + ih - (v / top) * ih

    grid.replaceChildren()
    labels.replaceChildren()
    for (let v = 0; v <= top + step / 1000; v += step) {
      if (v > 0) svg('line', { x1: M.left, x2: M.left + iw, y1: y(v), y2: y(v) }, grid)
      svg('text', { class: 'tick-label', x: M.left - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, labels).textContent = fmt(v)
    }
    const span = to - from
    const every = span <= 20 * 60e3 ? 5 * 60e3 : span <= 70 * 60e3 ? 15 * 60e3 : 30 * 60e3
    for (let t = Math.ceil(from / every) * every; t <= to; t += every) {
      svg('text', { class: 'tick-label', x: x(t), y: H - 6, 'text-anchor': 'middle' }, labels).textContent = clock(t)
    }
    for (const [k, v] of Object.entries({ x1: M.left, x2: M.left + iw, y1: y(0), y2: y(0) })) base.setAttribute(k, v)
    hit.setAttribute('x', M.left)
    hit.setAttribute('y', M.top)
    hit.setAttribute('width', iw)
    hit.setAttribute('height', ih)

    pts = series.map((h) => ({ t: h.t, v: value(h), x: x(h.t), y: y(value(h)) }))
    const runs = []
    for (const p of pts) {
      const run = runs.at(-1)
      if (!run || p.t - run.at(-1).t > GAP_MS) runs.push([p])
      else run.push(p)
    }
    const xy = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    const y0 = y(0).toFixed(1)
    line.setAttribute('d', runs.map((r) => `M${r.map(xy).join('L')}`).join(''))
    area.setAttribute('d', runs.filter((r) => r.length > 1).map((r) => `M${r[0].x.toFixed(1)},${y0}L${r.map(xy).join('L')}L${r.at(-1).x.toFixed(1)},${y0}Z`).join(''))

    const last = pts.at(-1)
    empty.hidden = pts.length >= 2
    endDot.setAttribute('visibility', last ? 'visible' : 'hidden')
    endLabel.setAttribute('visibility', last ? 'visible' : 'hidden')
    if (last) {
      endDot.setAttribute('cx', last.x)
      endDot.setAttribute('cy', last.y)
      endLabel.setAttribute('x', last.x + 9)
      endLabel.setAttribute('y', last.y)
      endLabel.textContent = short(last.v)
    }
    const highest = values.length ? Math.max(...values) : 0
    root.setAttribute(
      'aria-label',
      last
        ? `${name}, ${rangeText} terakhir: sekarang ${long(last.v)}, tertinggi ${long(highest)}. Panah kiri dan kanan untuk melihat tiap titik.`
        : `${name}: belum ada data.`,
    )

    if (!pts.length) clearHover()
    else if (pointerX !== null) showHover(nearest(pointerX))
    else if (document.activeElement === root && hover >= 0) {
      const i = pts.findIndex((p) => p.t === hoverT)
      showHover(i >= 0 ? i : pts.length - 1)
    }
  }

  return { draw }
}

const charts = [
  lineChart($('chart-online'), {
    name: 'Orang online',
    value: (h) => h.n,
    minTop: 10,
    short: (v) => fmt(v),
    long: (v) => `${fmt(v)} orang online`,
  }),
  lineChart($('chart-tick'), {
    name: 'Beban server',
    value: (h) => h.tick,
    minTop: 10,
    short: (v) => `${dec(v)} ms`,
    long: (v) => `${dec(v)} ms kerja per tick`,
  }),
]

const RANGE_TEXT = { 15: '15 menit', 60: '1 jam', 180: '3 jam' }

function renderCharts() {
  if (!state) return
  const to = state.now
  const from = to - rangeMin * 60e3
  const series = history.filter((h) => h.t >= from)
  for (const chart of charts) chart.draw(series, from, to, RANGE_TEXT[rangeMin])
}

const resize = new ResizeObserver(() => renderCharts())
resize.observe($('chart-online'))
resize.observe($('chart-tick'))

for (const button of $('range').querySelectorAll('button')) {
  button.addEventListener('click', () => {
    rangeMin = Number(button.dataset.min)
    for (const other of $('range').querySelectorAll('button')) other.setAttribute('aria-checked', String(other === button))
    renderCharts()
    renderMinutes()
  })
}

// the charts' table twin: one row per minute in the chosen range, newest first
function renderMinutes() {
  if (!state || !$('minutes').open) return
  const from = state.now - rangeMin * 60e3
  const byMinute = new Map()
  for (const h of history) {
    if (h.t < from) continue
    const minute = Math.floor(h.t / 60e3) * 60e3
    const b = byMinute.get(minute) ?? { n: 0, tick: 0, kb: 0, count: 0 }
    b.n = h.n // last sample of the minute
    b.tick += h.tick
    b.kb += h.kb
    b.count++
    byMinute.set(minute, b)
  }
  const rows = [...byMinute].reverse().map(([minute, b]) => {
    const tr = el('tr')
    tr.append(
      el('td', '', clock(minute)),
      el('td', 'num', fmt(b.n)),
      el('td', 'num', dec(b.tick / b.count)),
      el('td', 'num', fmt(Math.round(b.kb / b.count))),
    )
    return tr
  })
  if (!rows.length) {
    const tr = el('tr')
    const td = el('td', '', 'Belum ada data.')
    td.colSpan = 4
    tr.append(td)
    rows.push(tr)
  }
  $('minutes-body').replaceChildren(...rows)
}
$('minutes').addEventListener('toggle', renderMinutes)

// ---- participants ------------------------------------------------------------------------------

const peopleRows = new Map()

function personRow(p) {
  const tr = el('tr')
  const nameCell = el('td')
  const who = el('span', 'who')
  const dot = el('span', 'swatch-dot')
  const name = el('span')
  const tag = el('span', 'tag', 'dibisukan')
  who.append(dot, name, tag)
  nameCell.append(who)
  const zone = el('td')
  const since = el('td')
  const chats = el('td', 'num')
  const actions = el('td')
  const muteButton = el('button', 'small')
  muteButton.type = 'button'
  const kickButton = el('button', 'small kick', 'Keluarkan')
  kickButton.type = 'button'
  actions.append(muteButton, kickButton)
  tr.append(nameCell, zone, since, chats, actions)
  const row = { tr, dot, name, tag, zone, since, chats, muteButton, kickButton, data: p }

  muteButton.addEventListener('click', () => {
    const { id, name: who, muted } = row.data
    act({ a: 'mute', id, on: !muted }, muted ? `Chat ${who} dibuka lagi.` : `Chat ${who} dibisukan.`)
  })
  kickButton.addEventListener('click', async () => {
    const { id, name: who } = row.data
    const ok = await confirmDialog(
      `Keluarkan ${who}?`,
      `${who} langsung keluar dari kelas dan tidak bisa masuk lagi dari browser yang sama selama 15 menit.`,
      'Keluarkan',
    )
    if (ok) act({ a: 'kick', id }, `${who} dikeluarkan.`)
  })
  return row
}

function renderPeople() {
  if (!state) return
  const q = $('people-search').value.trim().toLowerCase()
  const list = state.people.filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.sinceS - b.sinceS || b.id - a.id)
  const shown = list.slice(0, PEOPLE_SHOWN)
  const keep = new Set(shown.map((p) => p.id))
  for (const [id, row] of peopleRows) {
    if (keep.has(id)) continue
    row.tr.remove()
    peopleRows.delete(id)
  }
  const body = $('people')
  shown.forEach((p, i) => {
    let row = peopleRows.get(p.id)
    if (!row) {
      row = personRow(p)
      peopleRows.set(p.id, row)
    }
    row.data = p
    row.dot.style.setProperty('--who', p.color)
    row.name.textContent = p.name
    row.tag.hidden = !p.muted
    row.zone.textContent = p.zone
    row.since.textContent = duration(p.sinceS)
    row.chats.textContent = fmt(p.chats)
    row.muteButton.textContent = p.muted ? 'Buka bisu' : 'Bisukan'
    row.muteButton.setAttribute('aria-label', `${p.muted ? 'Buka bisu' : 'Bisukan'} ${p.name}`)
    row.kickButton.setAttribute('aria-label', `Keluarkan ${p.name}`)
    if (body.children[i] !== row.tr) body.insertBefore(row.tr, body.children[i] ?? null)
  })
  $('people-count').textContent = `· ${fmt(state.people.length)} di dalam`
  $('people-note').textContent =
    list.length > shown.length
      ? `Menampilkan ${fmt(shown.length)} dari ${fmt(list.length)}. Cari nama untuk mempersempit.`
      : !list.length
        ? q ? 'Tidak ada nama yang cocok.' : 'Belum ada peserta di kelas.'
        : ''
}
$('people-search').addEventListener('input', renderPeople)

// ---- activity ----------------------------------------------------------------------------------

let eventsKey = ''
function renderEvents(s) {
  const key = `${s.startedAt}:${s.events.length}:${s.events.at(-1)?.t ?? 0}`
  if (key === eventsKey) return
  eventsKey = key
  const items = s.events
    .slice()
    .reverse()
    .map((e) => {
      const li = el('li')
      const time = el('time', '', clock(e.t, true))
      time.dateTime = new Date(e.t).toISOString()
      li.append(time, el('span', '', e.m))
      return li
    })
  $('events').replaceChildren(...items)
}

// ---- start -------------------------------------------------------------------------------------

if (token) {
  showApp()
  poll()
} else {
  $('login-token').focus()
}
