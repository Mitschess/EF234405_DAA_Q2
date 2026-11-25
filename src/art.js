// Everything is drawn with the 2D canvas at start-up, so the world needs no image files.
import { TILE, W, H, MAP, tileAt, zoneAt } from '../shared/map.js'

const T = TILE

// a stable pseudo-random number per tile, so texture noise is the same on every load
function hash(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

// what the floor under a piece of furniture looks like
function floorFor(x, y) {
  const zone = zoneAt(x, y)?.id
  if (zone === 'kelas-a' || zone === 'kelas-b') return '.'
  if (zone === 'aula') return '_'
  if (zone === 'lobi') return ','
  return 'g'
}

const floors = {
  '.'(ctx, x, y) {
    ctx.fillStyle = '#ecc89d'
    ctx.fillRect(0, 0, T, T)
    ctx.fillStyle = '#ddb383'
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 8 + 7, T, 1)
    const seam = (y % 2) * 16 + 8
    for (let i = 0; i < 4; i++) ctx.fillRect((seam + i * 13 + Math.floor(hash(x, y, i) * 6)) % T, i * 8, 1, 7)
  },
  ','(ctx, x, y) {
    ctx.fillStyle = (x + y) % 2 ? '#fff2f9' : '#fbe1ef'
    ctx.fillRect(0, 0, T, T)
    ctx.fillStyle = '#f1cfe2'
    ctx.fillRect(0, 0, T, 1)
    ctx.fillRect(0, 0, 1, T)
  },
  _(ctx, x, y) {
    ctx.fillStyle = '#3a1a8c'
    ctx.fillRect(0, 0, T, T)
    ctx.fillStyle = '#4524a3'
    ctx.beginPath()
    ctx.moveTo(16, 10); ctx.lineTo(22, 16); ctx.lineTo(16, 22); ctx.lineTo(10, 16)
    ctx.fill()
    if (hash(x, y) > 0.86) {
      ctx.fillStyle = 'rgba(255, 212, 59, 0.55)'
      ctx.fillRect(15, 15, 2, 2)
    }
  },
  g(ctx, x, y) {
    const v = hash(x, y)
    ctx.fillStyle = v > 0.66 ? '#42cd8d' : v > 0.33 ? '#3fc98a' : '#3dc688'
    ctx.fillRect(0, 0, T, T)
    ctx.strokeStyle = '#2fae72'
    ctx.lineWidth = 1.4
    for (let i = 0; i < 3; i++) {
      const bx = 4 + hash(x, y, i + 1) * 24
      const by = 8 + hash(x, y, i + 7) * 20
      ctx.beginPath()
      ctx.moveTo(bx, by); ctx.lineTo(bx - 1.5, by - 4)
      ctx.moveTo(bx, by); ctx.lineTo(bx + 1.5, by - 4)
      ctx.stroke()
    }
  },
  p(ctx, x, y) {
    ctx.fillStyle = '#f3ddb8'
    ctx.fillRect(0, 0, T, T)
    ctx.fillStyle = '#e4c796'
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.ellipse(4 + hash(x, y, i) * 24, 4 + hash(x, y, i + 3) * 24, 4, 3, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  S(ctx, x, y) {
    ctx.fillStyle = '#ffd43b'
    ctx.fillRect(0, 0, T, T)
    ctx.fillStyle = '#efbd1c'
    ctx.fillRect(0, 10, T, 1)
    ctx.fillRect(0, 21, T, 1)
    if (tileAt(x, y + 1) !== 'S') {
      ctx.fillStyle = '#c98f00'
      ctx.fillRect(0, T - 7, T, 7)
      ctx.fillStyle = '#ffe58a'
      ctx.fillRect(0, T - 8, T, 1)
    }
  },
  '#'(ctx, x, y) {
    ctx.fillStyle = '#2b1160'
    ctx.fillRect(0, 0, T, T)
    const below = tileAt(x, y + 1)
    if (below !== '#' && below !== 'B') {
      ctx.fillStyle = '#1a0a4c'
      ctx.fillRect(0, T - 11, T, 11)
      ctx.fillStyle = '#6a2ee6'
      ctx.fillRect(0, T - 12, T, 2)
    }
    // a few "constellation" stars on the wall tops, after the site's Konstelasi Kreasi identity
    if (hash(x, y, 9) > 0.8) {
      ctx.fillStyle = hash(x, y, 4) > 0.5 ? '#ffd43b' : '#b46ef0'
      ctx.fillRect(Math.floor(6 + hash(x, y, 2) * 20), Math.floor(4 + hash(x, y, 3) * 8), 2, 2)
    }
  },
}

const things = {
  D(ctx, x, y) {
    const l = tileAt(x - 1, y) === 'D' ? 0 : 3
    const r = tileAt(x + 1, y) === 'D' ? T : T - 3
    ctx.fillStyle = 'rgba(22, 10, 69, 0.18)'
    ctx.fillRect(l + 2, 12, r - l, 16)
    ctx.fillStyle = '#7a4a26'
    roundRect(ctx, l, 6, r - l, 18, 3)
    ctx.fillStyle = '#b07646'
    roundRect(ctx, l, 5, r - l, 14, 3)
    const v = hash(x, y, 5)
    if (v > 0.55) {
      ctx.fillStyle = v > 0.8 ? '#7ad7f0' : '#ff4d9e'
      ctx.fillRect(10 + Math.floor(v * 8), 8, 9, 7)
      ctx.fillStyle = '#fff'
      ctx.fillRect(11 + Math.floor(v * 8), 9, 7, 1)
    }
  },
  c(ctx) { chair(ctx, '#6a2ee6', '#4a19b8') },
  C(ctx) { chair(ctx, '#ff4d9e', '#d8247c') },
  B(ctx, x, y) {
    floors['#'](ctx, x, y)
    const hall = zoneAt(x, y)?.id === 'aula'
    const l = tileAt(x - 1, y) === 'B' ? 0 : 3
    const r = tileAt(x + 1, y) === 'B' ? T : T - 3
    ctx.fillStyle = hall ? '#160a45' : '#7a4a26'
    ctx.fillRect(l, 2, r - l, 24)
    ctx.fillStyle = hall ? '#def6fd' : '#fbfaff'
    ctx.fillRect(l + (l ? 2 : 0), 4, r - l - (l ? 2 : 0) - (r < T ? 2 : 0), 19)
    if (!hall) {
      ctx.fillStyle = '#a0683c'
      ctx.fillRect(l, 24, r - l, 3)
    }
  },
  P(ctx, x, y) {
    ctx.fillStyle = 'rgba(22, 10, 69, 0.18)'
    ctx.beginPath(); ctx.ellipse(16, 28, 10, 3, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ff9233'
    ctx.beginPath(); ctx.moveTo(9, 18); ctx.lineTo(23, 18); ctx.lineTo(21, 29); ctx.lineTo(11, 29); ctx.fill()
    ctx.fillStyle = '#149a5d'
    for (const [cx, cy, rr] of [[11, 13, 6], [21, 13, 6], [16, 8, 7]]) {
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = '#2bcf83'
    ctx.beginPath(); ctx.arc(14, 9, 3, 0, Math.PI * 2); ctx.fill()
  },
  T(ctx, x, y) {
    ctx.fillStyle = 'rgba(22, 10, 69, 0.22)'
    ctx.beginPath(); ctx.ellipse(16, 28, 12, 4, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#7a4a26'
    ctx.fillRect(13, 16, 6, 12)
    const tone = hash(x, y, 8) > 0.5
    ctx.fillStyle = tone ? '#149a5d' : '#118a55'
    ctx.beginPath(); ctx.arc(16, 9, 13, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = tone ? '#2bcf83' : '#22b873'
    ctx.beginPath(); ctx.arc(11, 4, 6, 0, Math.PI * 2); ctx.fill()
  },
  w(ctx, x, y) {
    ctx.fillStyle = '#d9bd8c'
    ctx.fillRect(0, 0, T, T)
    const edge = (dx, dy) => tileAt(x + dx, y + dy) !== 'w'
    const l = edge(-1, 0) ? 5 : 0
    const r = edge(1, 0) ? T - 5 : T
    const t = edge(0, -1) ? 5 : 0
    const b = edge(0, 1) ? T - 5 : T
    ctx.fillStyle = '#4fb8d8'
    ctx.fillRect(l, t, r - l, b - t)
    ctx.fillStyle = '#7ad7f0'
    ctx.fillRect(l, t, r - l, Math.min(6, b - t))
    ctx.fillStyle = '#def6fd'
    ctx.fillRect(6 + Math.floor(hash(x, y) * 14), 14 + Math.floor(hash(x, y, 1) * 8), 7, 2)
  },
  b(ctx, x, y) {
    const l = tileAt(x - 1, y) === 'b' ? 0 : 3
    const r = tileAt(x + 1, y) === 'b' ? T : T - 3
    ctx.fillStyle = 'rgba(22, 10, 69, 0.18)'
    ctx.fillRect(l + 2, 20, r - l, 8)
    ctx.fillStyle = '#7a4a26'
    if (l) ctx.fillRect(l + 2, 18, 3, 9)
    if (r < T) ctx.fillRect(r - 5, 18, 3, 9)
    ctx.fillStyle = '#b07646'
    ctx.fillRect(l, 10, r - l, 10)
    ctx.fillStyle = '#8a5530'
    ctx.fillRect(l, 14, r - l, 1)
  },
}

function chair(ctx, seat, back) {
  ctx.fillStyle = 'rgba(22, 10, 69, 0.18)'
  ctx.fillRect(10, 12, 14, 16)
  ctx.fillStyle = seat
  roundRect(ctx, 9, 8, 14, 13, 3)
  ctx.fillStyle = back
  roundRect(ctx, 8, 19, 16, 6, 2)
}

const LABELS = [
  { text: 'Kelas A', x: 9 * T, y: 1.45 * T, font: '700 26px "Caveat Variable", cursive', color: '#4a19b8' },
  { text: 'Kelas B', x: 43 * T, y: 1.45 * T, font: '700 26px "Caveat Variable", cursive', color: '#d8247c' },
  { text: 'Aula · ILITS 2027', x: 26 * T, y: 1.45 * T, font: '600 17px "Fredoka Variable", sans-serif', color: '#24106a' },
  { text: 'LOBI', x: 26 * T, y: 16.6 * T, font: '600 44px "Fredoka Variable", sans-serif', color: 'rgba(106, 46, 230, 0.13)' },
  { text: 'Info', x: 6 * T, y: 17.55 * T, font: '600 14px "Fredoka Variable", sans-serif', color: '#6b5592' },
]

export function drawWorld(ctx) {
  // floors and walls first, then furniture on top so trees and plants can overhang
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = MAP[y][x]
      ctx.save()
      ctx.translate(x * T, y * T)
      const floor = floors[ch] ?? floors[floorFor(x, y)]
      floor(ctx, x, y)
      ctx.restore()
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const draw = things[MAP[y][x]]
      if (!draw) continue
      ctx.save()
      ctx.translate(x * T, y * T)
      draw(ctx, x, y)
      ctx.restore()
    }
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const label of LABELS) {
    ctx.font = label.font
    ctx.fillStyle = label.color
    ctx.fillText(label.text, label.x, label.y)
  }
}

export const AV_W = 32
export const AV_H = 40

// a round little character in the chosen colour; d is 0 down, 1 left, 2 right, 3 up
export function drawAvatar(ctx, color, d) {
  ctx.clearRect(0, 0, AV_W, AV_H)
  ctx.fillStyle = color
  ctx.beginPath(); ctx.ellipse(16, 31, 10, 8, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(22, 10, 69, 0.22)'
  ctx.beginPath(); ctx.ellipse(16, 35, 9, 4, 0, 0, Math.PI); ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(16, 15, 11, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.beginPath(); ctx.arc(12, 10, 4, 0, Math.PI * 2); ctx.fill()
  if (d === 3) {
    // back of the head: just a little star pin
    star(ctx, 16, 8, 3.2)
    return
  }
  const fx = d === 1 ? -3 : d === 2 ? 3 : 0
  ctx.fillStyle = '#fff2f9'
  ctx.beginPath(); ctx.ellipse(16 + fx, 17, 8, 7, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#2b1160'
  const eyes = d === 0 ? [12.5, 19.5] : d === 1 ? [10, 15.5] : [16.5, 22]
  for (const ex of eyes) { ctx.beginPath(); ctx.arc(ex, 16.5, 1.7, 0, Math.PI * 2); ctx.fill() }
  ctx.fillStyle = 'rgba(255, 77, 158, 0.45)'
  if (d === 0) { ctx.fillRect(9.5, 19.5, 3, 2); ctx.fillRect(19.5, 19.5, 3, 2) }
  if (d !== 0) star(ctx, d === 1 ? 22 : 10, 7, 2.6)
  else star(ctx, 16, 30, 3)
}

function star(ctx, cx, cy, r) {
  ctx.fillStyle = '#ffd43b'
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.4 : r
    const a = (i * Math.PI) / 4 - Math.PI / 2
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  ctx.fill()
}
