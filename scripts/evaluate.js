// Compares BFS and Dijkstra on random start/target pairs over the campus map.
//
//   node scripts/evaluate.js [--pairs 2000] [--seed 2027] [--check 300] [--out evaluation/results.md]
//
// For every pair it checks that both routes are valid walks, that Dijkstra is never more
// expensive than BFS and BFS never takes more steps than Dijkstra. For the first `--check`
// pairs it also compares both against Bellman-Ford, an independent shortest-path method, to
// confirm BFS finds the fewest steps and Dijkstra the lowest cost. Then it reports steps, cost,
// visited nodes and running time, overall and by route length.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { W, H, DX, DY, walkable, tileCost, pathCost } from '../shared/map.js'
import { bfs, dijkstra } from '../shared/pathfinding.js'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
)
const PAIRS = Number(args.pairs ?? 2000)
const SEED = Number(args.seed ?? 2027)
const CHECK = Number(args.check ?? 300)
const REPEAT = 5 // each search is timed over this many runs, then averaged

// small seeded PRNG (mulberry32) so every run picks the same pairs
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const nodes = []
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walkable(x, y)) nodes.push([x, y])
let edges = 0
for (const [x, y] of nodes) for (let d = 0; d < 4; d++) if (walkable(x + DX[d], y + DY[d])) edges++

// Bellman-Ford from one source; unit=true counts steps instead of tile costs
function bellmanFord(sx, sy, unit) {
  const dist = new Float64Array(W * H).fill(Infinity)
  dist[sy * W + sx] = 0
  for (let round = 0; round < nodes.length; round++) {
    let changed = false
    for (const [x, y] of nodes) {
      const du = dist[y * W + x]
      if (du === Infinity) continue
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (!walkable(nx, ny)) continue
        const nd = du + (unit ? 1 : tileCost(nx, ny))
        if (nd < dist[ny * W + nx]) {
          dist[ny * W + nx] = nd
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return dist
}

function checkWalk(name, [sx, sy], [tx, ty], r) {
  let [x, y] = [sx, sy]
  for (const [nx, ny] of r.path) {
    if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || !walkable(nx, ny)) throw new Error(`${name}: invalid step to ${nx},${ny}`)
    ;[x, y] = [nx, ny]
  }
  if (x !== tx || y !== ty) throw new Error(`${name}: ends at ${x},${y}, not ${tx},${ty}`)
  if (r.cost !== pathCost(r.path)) throw new Error(`${name}: reported cost ${r.cost} but the path costs ${pathCost(r.path)}`)
  if (r.steps !== r.path.length) throw new Error(`${name}: reported ${r.steps} steps but the path has ${r.path.length}`)
}

function timeUs(fn, ...a) {
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < REPEAT; i++) fn(...a)
  return Number(process.hrtime.bigint() - t0) / 1000 / REPEAT
}

const random = rng(SEED)
const pick = () => nodes[Math.floor(random() * nodes.length)]

// warm up the JIT so the first timings aren't skewed
for (let i = 0; i < 300; i++) {
  const [s, t] = [pick(), pick()]
  bfs(...s, ...t)
  dijkstra(...s, ...t)
}

const rows = []
let checked = 0
while (rows.length < PAIRS) {
  const s = pick()
  const t = pick()
  if (s[0] === t[0] && s[1] === t[1]) continue
  const b = bfs(...s, ...t)
  const d = dijkstra(...s, ...t)
  if (!b || !d) {
    if (b || d) throw new Error(`only one search reached ${t} from ${s}`)
    continue // unreachable pair (the map has none, but stay safe)
  }
  checkWalk('BFS', s, t, b)
  checkWalk('Dijkstra', s, t, d)
  if (d.cost > b.cost) throw new Error(`Dijkstra cost ${d.cost} > BFS cost ${b.cost} from ${s} to ${t}`)
  if (b.steps > d.steps) throw new Error(`BFS steps ${b.steps} > Dijkstra steps ${d.steps} from ${s} to ${t}`)
  if (checked < CHECK) {
    const goal = t[1] * W + t[0]
    const steps = bellmanFord(...s, true)[goal]
    const cost = bellmanFord(...s, false)[goal]
    if (b.steps !== steps) throw new Error(`BFS found ${b.steps} steps, Bellman-Ford ${steps}, from ${s} to ${t}`)
    if (d.cost !== cost) throw new Error(`Dijkstra found cost ${d.cost}, Bellman-Ford ${cost}, from ${s} to ${t}`)
    checked++
  }
  rows.push({
    bSteps: b.steps, bCost: b.cost, bVisited: b.visited, bUs: timeUs(bfs, ...s, ...t),
    dSteps: d.steps, dCost: d.cost, dVisited: d.visited, dUs: timeUs(dijkstra, ...s, ...t),
  })
}

// ---- report ------------------------------------------------------------------------------------

const mean = (list, key) => list.reduce((sum, r) => sum + r[key], 0) / (list.length || 1)
const f1 = (n) => n.toFixed(1)
const f2 = (n) => n.toFixed(2)
const pct = (n) => `${(n * 100).toFixed(1)}%`

const cheaper = rows.filter((r) => r.dCost < r.bCost)
const savings = cheaper.map((r) => (r.bCost - r.dCost) / r.bCost)
const longer = rows.filter((r) => r.dSteps > r.bSteps)

const BUCKETS = [[1, 10], [11, 20], [21, 40], [41, Infinity]]

const lines = [
  '# Evaluasi BFS vs Dijkstra',
  '',
  `Peta: ${W}×${H} petak, ${nodes.length} node bisa dilewati, ${edges} sisi berarah. ` +
    `${PAIRS} pasangan acak (seed ${SEED}); waktu adalah rata-rata ${REPEAT} kali jalan per pasangan, Node.js ${process.version}.`,
  '',
  '## Kebenaran',
  '',
  `- Semua ${PAIRS} rute dari kedua algoritma adalah jalan yang sah (petak bersebelahan, bisa dilewati, berakhir di tujuan), dan biaya yang dilaporkan sama dengan biaya jalurnya.`,
  `- Di semua pasangan, biaya Dijkstra ≤ biaya BFS dan langkah BFS ≤ langkah Dijkstra.`,
  `- ${checked} pasangan pertama dicocokkan dengan Bellman-Ford: BFS selalu menemukan jumlah langkah paling sedikit, Dijkstra selalu menemukan biaya paling rendah.`,
  '',
  '## Ringkasan',
  '',
  '| Algoritma | Rata-rata langkah | Rata-rata biaya | Rata-rata node dikunjungi | Rata-rata waktu (µs) |',
  '| --- | ---: | ---: | ---: | ---: |',
  `| BFS | ${f1(mean(rows, 'bSteps'))} | ${f1(mean(rows, 'bCost'))} | ${f1(mean(rows, 'bVisited'))} | ${f2(mean(rows, 'bUs'))} |`,
  `| Dijkstra | ${f1(mean(rows, 'dSteps'))} | ${f1(mean(rows, 'dCost'))} | ${f1(mean(rows, 'dVisited'))} | ${f2(mean(rows, 'dUs'))} |`,
  '',
  `- Dijkstra menemukan rute yang lebih murah di ${cheaper.length} dari ${PAIRS} pasangan (${pct(cheaper.length / PAIRS)}); di sisanya biayanya sama.`,
  cheaper.length
    ? `- Pada pasangan itu, biaya turun rata-rata ${pct(savings.reduce((a, b) => a + b, 0) / savings.length)} dan paling banyak ${pct(Math.max(...savings))}.`
    : '- Tidak ada pasangan yang biayanya turun.',
  `- Harga yang dibayar: rute Dijkstra lebih panjang (dalam langkah) di ${longer.length} pasangan (${pct(longer.length / PAIRS)}), dan rata-rata waktunya ${f1(mean(rows, 'dUs') / mean(rows, 'bUs'))}× BFS.`,
  '',
  '## Menurut panjang rute (langkah BFS)',
  '',
  '| Panjang | Pasangan | Biaya BFS | Biaya Dijkstra | Node BFS | Node Dijkstra | µs BFS | µs Dijkstra |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...BUCKETS.map(([lo, hi]) => {
    const g = rows.filter((r) => r.bSteps >= lo && r.bSteps <= hi)
    const label = hi === Infinity ? `${lo}+` : `${lo}–${hi}`
    if (!g.length) return `| ${label} | 0 | – | – | – | – | – | – |`
    return `| ${label} | ${g.length} | ${f1(mean(g, 'bCost'))} | ${f1(mean(g, 'dCost'))} | ${f1(mean(g, 'bVisited'))} | ${f1(mean(g, 'dVisited'))} | ${f2(mean(g, 'bUs'))} | ${f2(mean(g, 'dUs'))} |`
  }),
  '',
]

const report = lines.join('\n')
console.log(report)
if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, report)
  console.log(`(disimpan ke ${args.out})`)
}
