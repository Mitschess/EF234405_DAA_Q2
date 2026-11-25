import * as Phaser from 'phaser'
import { TILE, W, H, DX, DY, STEP_MS, COLORS, walkable, zoneIndexAt, ZONES } from '../shared/map.js'
import { ALGORITHMS } from '../shared/pathfinding.js'
import { drawWorld, drawAvatar, AV_W, AV_H } from './art.js'

const px = (x) => x * TILE + TILE / 2
const py = (y) => y * TILE + TILE / 2
const BODY_Y = 13
const BUBBLE_MS = 6000
const ROUTE_COLOR = { bfs: 0xffd43b, dijkstra: 0x2bcf83 }
const SPREAD_MS = 450 // how long the explored tiles take to appear, in the order they were visited

const NAME_STYLE = {
  fontFamily: 'Poppins, sans-serif',
  fontSize: '11px',
  fontStyle: '600',
  color: '#ffffff',
  stroke: '#160a45',
  strokeThickness: 3,
}

// hooks: send(msg), typing() -> bool, blurChat(), zone(zone, here, online, changed), ready(),
//        algo() -> 'bfs' | 'dijkstra', route({ used, runs })
export class WorldScene extends Phaser.Scene {
  constructor(hooks) {
    super('world')
    this.hooks = hooks
    this.players = new Map()
    this.me = null
    this.path = null
    this.routeColor = ROUTE_COLOR.bfs
    this.bubbles = new Map()
    this.lastZone = null
  }

  create() {
    const world = this.textures.createCanvas('world', W * TILE, H * TILE)
    drawWorld(world.getContext())
    world.refresh()
    this.add.image(0, 0, 'world').setOrigin(0, 0).setDepth(-10)
    this.searchG = this.add.graphics().setDepth(-7) // tiles the last search explored
    this.routeG = this.add.graphics().setDepth(-6) // the route still to walk

    COLORS.forEach((color, i) => {
      for (let d = 0; d < 4; d++) {
        const tex = this.textures.createCanvas(`av${i}d${d}`, AV_W, AV_H)
        drawAvatar(tex.getContext(), color, d)
        tex.refresh()
      }
    })
    const g = this.make.graphics({ add: false })
    g.fillStyle(0x160a45, 0.25).fillEllipse(13, 5, 26, 9).generateTexture('shadow', 26, 10).clear()
    g.lineStyle(2, 0xffd43b, 1).strokeCircle(12, 12, 10).generateTexture('target', 24, 24).destroy()

    const cam = this.cameras.main
    cam.setBounds(0, 0, W * TILE, H * TILE)
    cam.setRoundPixels(true)
    this.fitZoom()
    this.scale.on('resize', () => this.fitZoom())
    // before anyone joins, drift slowly over the campus behind the join card
    cam.centerOn(px(26), py(18))
    this.idle = this.tweens.add({ targets: cam, scrollX: cam.scrollX + 260, scrollY: cam.scrollY - 140, duration: 18000, yoyo: true, repeat: -1, ease: 'Sine.inOut' })

    this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D', false)
    this.input.on('pointerdown', (pointer) => this.onTap(pointer))
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.reportZone() })
    this.hooks.ready?.()
  }

  fitZoom() {
    const short = Math.min(this.scale.width, this.scale.height)
    this.cameras.main.setZoom(short < 560 ? 1 : this.scale.width > 1500 ? 1.6 : 1.3)
  }

  // ---- network events ------------------------------------------------------------------------

  enter(hi) {
    this.clear()
    for (const row of hi.players) this.addPlayer(row)
    this.me = this.players.get(hi.id) ?? null
    if (!this.me) return
    this.me.label.setColor('#ffd43b')
    this.me.c.setDepth(this.depthOf(this.me))
    this.idle?.stop()
    this.cameras.main.startFollow(this.me.c, true, 0.18, 0.18)
    this.reportZone()
  }

  tick(msg) {
    for (const row of msg.j) if (row[0] !== this.me?.id) this.addPlayer(row)
    for (const [id, x, y, d] of msg.m) {
      if (id === this.me?.id) continue
      const p = this.players.get(id)
      if (p) this.place(p, x, y, d)
    }
    for (const id of msg.l) this.removePlayer(id)
  }

  resync(players) {
    const seen = new Set()
    for (const row of players) {
      seen.add(row[0])
      if (row[0] === this.me?.id) continue
      if (this.players.has(row[0])) this.place(this.players.get(row[0]), row[3], row[4], row[5], true)
      else this.addPlayer(row)
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id)
  }

  fix(x, y) {
    if (!this.me) return
    this.setPath(null)
    this.place(this.me, x, y, this.me.d, true)
  }

  clear() {
    for (const id of [...this.players.keys()]) this.removePlayer(id)
    this.me = null
    this.setPath(null)
    this.cameras.main.stopFollow()
  }

  // ---- avatars ---------------------------------------------------------------------------------

  addPlayer([id, name, color, x, y, d]) {
    if (this.players.has(id)) return
    const c = this.add.container(px(x), py(y))
    const shadow = this.add.image(0, BODY_Y - 1, 'shadow')
    const body = this.add.image(0, BODY_Y, `av${color}d${d}`).setOrigin(0.5, 1)
    const label = this.add.text(0, BODY_Y - AV_H - 1, name, NAME_STYLE).setOrigin(0.5, 1).setResolution(2)
    c.add([shadow, body, label])
    c.setDepth(c.y)
    this.players.set(id, { id, name, color, x, y, d, c, body, label, tween: null })
  }

  removePlayer(id) {
    const p = this.players.get(id)
    if (!p) return
    p.tween?.remove()
    p.c.destroy()
    this.bubbles.get(id)?.destroy()
    this.bubbles.delete(id)
    this.players.delete(id)
  }

  place(p, x, y, d, instant = false) {
    if (p.d !== d) {
      p.d = d
      p.body.setTexture(`av${p.color}d${d}`)
    }
    if (p.x === x && p.y === y && !instant) return
    const dist = Math.abs(x - p.x) + Math.abs(y - p.y)
    p.x = x
    p.y = y
    p.tween?.remove()
    p.tween = null
    if (instant || dist > 3) {
      p.c.setPosition(px(x), py(y)).setDepth(this.depthOf(p))
      p.body.y = BODY_Y
      return
    }
    p.tween = this.tweens.add({
      targets: p.c,
      x: px(x),
      y: py(y),
      duration: STEP_MS * dist,
      ease: 'Linear',
      onUpdate: (tween) => {
        p.body.y = BODY_Y - Math.abs(Math.sin(tween.progress * Math.PI * dist)) * 3
        p.c.setDepth(this.depthOf(p))
      },
      onComplete: () => {
        p.body.y = BODY_Y
        p.tween = null
      },
    })
  }

  // lower on screen draws in front; your own avatar wins ties so your name stays readable
  depthOf(p) {
    return p.c.y + (p === this.me ? 0.5 : 0)
  }

  say(id, text) {
    const p = this.players.get(id)
    if (!p) return
    this.bubbles.get(id)?.destroy()
    const short = Array.from(text).length > 90 ? Array.from(text).slice(0, 88).join('') + '…' : text
    const label = this.add.text(0, 0, short, {
      fontFamily: 'Poppins, sans-serif',
      fontSize: '12px',
      color: '#2b1160',
      align: 'center',
      wordWrap: { width: 170, useAdvancedWrap: true },
    }).setOrigin(0.5, 0.5).setResolution(2)
    const w = Math.ceil(label.width) + 16
    const h = Math.ceil(label.height) + 8
    const bg = this.add.graphics()
    bg.fillStyle(0x160a45, 0.18).fillRoundedRect(-w / 2 + 1, -h + 2, w, h, 9)
    bg.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h, w, h, 9)
    bg.fillTriangle(-5, -1, 5, -1, 0, 6)
    label.setPosition(0, -h / 2)
    const bubble = this.add.container(p.c.x, p.c.y, [bg, label]).setDepth(100000)
    this.bubbles.set(id, bubble)
    this.time.delayedCall(BUBBLE_MS, () => {
      if (this.bubbles.get(id) !== bubble) return
      this.tweens.add({ targets: bubble, alpha: 0, duration: 300, onComplete: () => bubble.destroy() })
      this.bubbles.delete(id)
    })
  }

  // ---- walking ---------------------------------------------------------------------------------

  // a key held down keeps walking; a quick tap still counts as one step even if it was
  // pressed and released between two frames
  keyDir() {
    const k = this.keys
    const pressed = (a, b) => {
      const tapped = Phaser.Input.Keyboard.JustDown(a) | Phaser.Input.Keyboard.JustDown(b)
      return tapped || a.isDown || b.isDown
    }
    if (pressed(k.LEFT, k.A)) return 1
    if (pressed(k.RIGHT, k.D)) return 2
    if (pressed(k.UP, k.W)) return 3
    if (pressed(k.DOWN, k.S)) return 0
    return null
  }

  step(d) {
    const me = this.me
    const nx = me.x + DX[d]
    const ny = me.y + DY[d]
    if (!walkable(nx, ny)) {
      if (me.d !== d) {
        this.place(me, me.x, me.y, d)
        this.hooks.send({ t: 'mv', x: me.x, y: me.y, d })
      }
      return false
    }
    this.place(me, nx, ny, d)
    this.hooks.send({ t: 'mv', x: nx, y: ny, d })
    return true
  }

  onTap(pointer) {
    if (this.hooks.typing()) this.hooks.blurChat()
    if (!this.me) return
    const tx = Math.floor(pointer.worldX / TILE)
    const ty = Math.floor(pointer.worldY / TILE)
    // run every algorithm so the panel can compare them; walk the chosen one's route
    const runs = {}
    for (const [key, a] of Object.entries(ALGORITHMS)) {
      const t0 = performance.now()
      const r = a.run(this.me.x, this.me.y, tx, ty)
      runs[key] = r && { ...r, ms: performance.now() - t0 }
    }
    const used = ALGORITHMS[this.hooks.algo?.()] ? this.hooks.algo() : 'bfs'
    const chosen = runs[used]
    if (!chosen?.path.length) return
    this.hooks.route?.({ used, runs })
    this.routeColor = ROUTE_COLOR[used]
    this.showSearch(chosen.order)
    this.setPath(chosen.path.slice())
    const [gx, gy] = chosen.path[chosen.path.length - 1]
    const mark = this.add.image(px(gx), py(gy), 'target').setDepth(-5).setAlpha(0.9)
    this.tweens.add({ targets: mark, scale: 0.4, alpha: 0, duration: 650, onComplete: () => mark.destroy() })
  }

  setPath(path) {
    this.path = path
    this.drawRoute()
  }

  // a line from where you stand through every tile still to walk
  drawRoute() {
    const g = this.routeG
    if (!g) return
    g.clear()
    if (!this.me || !this.path?.length) return
    g.lineStyle(4, this.routeColor, 0.85)
    g.beginPath()
    g.moveTo(px(this.me.x), py(this.me.y))
    for (const [x, y] of this.path) g.lineTo(px(x), py(y))
    g.strokePath()
    g.fillStyle(this.routeColor, 1)
    for (const [x, y] of this.path) g.fillCircle(px(x), py(y), 3)
  }

  // shade the tiles the search took off its queue, in that order, then fade them out
  showSearch(order) {
    const g = this.searchG
    this.searchTween?.remove()
    this.searchFade?.remove()
    g.clear().setAlpha(1)
    g.fillStyle(this.routeColor, 0.22)
    let drawn = 0
    const upTo = (n) => {
      for (; drawn < n; drawn++) {
        const i = order[drawn]
        const x = i % W
        g.fillRect(x * TILE + 2, ((i - x) / W) * TILE + 2, TILE - 4, TILE - 4)
      }
    }
    const counter = { n: 0 }
    this.searchTween = this.tweens.add({
      targets: counter,
      n: order.length,
      duration: SPREAD_MS,
      ease: 'Linear',
      onUpdate: () => upTo(Math.floor(counter.n)),
      onComplete: () => {
        upTo(order.length)
        this.searchFade = this.tweens.add({ targets: g, alpha: 0, delay: 700, duration: 600 })
      },
    })
  }

  update() {
    for (const [id, bubble] of this.bubbles) {
      const p = this.players.get(id)
      if (p) bubble.setPosition(p.c.x, p.c.y + BODY_Y - AV_H - 20)
    }
    const me = this.me
    if (!me || me.tween) return
    const dir = this.hooks.typing() ? null : this.keyDir()
    if (dir !== null) {
      if (this.path) this.setPath(null)
      this.step(dir)
      return
    }
    if (this.path?.length) {
      const [nx, ny] = this.path.shift()
      const d = nx < me.x ? 1 : nx > me.x ? 2 : ny < me.y ? 3 : 0
      if (this.step(d)) this.drawRoute()
      else this.setPath(null)
    }
  }

  reportZone() {
    if (!this.me) return
    const zi = zoneIndexAt(this.me.x, this.me.y)
    let here = 0
    for (const p of this.players.values()) if (zoneIndexAt(p.x, p.y) === zi) here++
    this.hooks.zone(ZONES[zi] ?? null, here, this.players.size, zi !== this.lastZone)
    this.lastZone = zi
  }
}
