// The campus map, shared by the server (to check every step) and the client (to draw it
// and to walk without waiting for the server). One character per tile.
//
//   #  wall          .  wood floor     ,  lobby tile     _  hall carpet
//   g  grass         p  garden path    S  stage          c  chair (class)
//   C  seat (hall)   D  desk           B  board/screen   P  plant
//   T  tree          w  fountain       b  bench
//
// Chairs, seats and the stage can be walked on; everything else that is furniture blocks.

export const TILE = 32
export const W = 52
export const H = 36

export const ZONES = [
  { id: 'kelas-a', name: 'Kelas A', x: 1, y: 1, w: 16, h: 13 },
  { id: 'aula', name: 'Aula', x: 18, y: 1, w: 16, h: 13 },
  { id: 'kelas-b', name: 'Kelas B', x: 35, y: 1, w: 16, h: 13 },
  { id: 'lobi', name: 'Lobi', x: 1, y: 14, w: 50, h: 10 },
  { id: 'taman', name: 'Taman', x: 0, y: 24, w: 52, h: 12 },
]

const grid = Array.from({ length: H }, () => Array(W).fill('#'))
const fill = (x, y, w, h, ch) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = ch
}
const put = (x, y, ch) => { grid[y][x] = ch }

function classroom(ox) {
  fill(ox, 1, 16, 13, '.')
  fill(ox + 3, 1, 10, 1, 'B') // whiteboard
  fill(ox + 12, 3, 2, 1, 'D') // teacher's desk
  for (const row of [5, 8, 11]) {
    for (const col of [1, 5, 9, 13]) {
      fill(ox + col, row, 2, 1, 'D')
      fill(ox + col, row + 1, 2, 1, 'c')
    }
  }
  for (const [x, y] of [[0, 1], [15, 1], [0, 12], [15, 12]]) put(ox + x, y, 'P')
}

// building: two classrooms with the hall between them, a lobby along the front
classroom(1)
classroom(35)

fill(18, 1, 16, 13, '_')
fill(20, 1, 12, 1, 'B') // screen above the stage
fill(19, 2, 14, 2, 'S')
for (const row of [6, 8, 10, 12]) {
  for (let x = 19; x <= 32; x++) if (x !== 25 && x !== 26) put(x, row, 'C')
}
put(18, 13, 'P')
put(33, 13, 'P')

fill(1, 15, 50, 9, ',')
for (const x of [8, 9, 25, 26, 42, 43]) put(x, 14, ',') // classroom and hall doors
fill(4, 18, 4, 1, 'D') // info desk
for (const [x, y] of [[1, 15], [50, 15], [1, 23], [50, 23], [19, 15], [32, 15]]) put(x, y, 'P')
fill(12, 22, 3, 1, 'b')
fill(37, 22, 3, 1, 'b')

// garden: entrance at the front of the lobby, a fountain ringed by a path
fill(0, 25, W, 11, 'g')
put(25, 24, ',')
put(26, 24, ',')
fill(25, 25, 2, 3, 'p')
fill(21, 28, 10, 5, 'p')
fill(1, 30, 20, 1, 'p')
fill(31, 30, 20, 1, 'p')
fill(23, 29, 6, 3, 'w')
fill(18, 33, 3, 1, 'b')
fill(31, 33, 3, 1, 'b')
for (let x = 0; x < W; x++) put(x, H - 1, 'T')
for (let y = 25; y < H; y++) { put(0, y, 'T'); put(W - 1, y, 'T') }
for (const [x, y] of [[4, 27], [9, 33], [14, 27], [16, 32], [36, 27], [41, 32], [46, 27], [48, 33], [6, 32], [43, 28], [11, 28], [39, 28]]) put(x, y, 'T')

export const MAP = grid.map((row) => row.join(''))

const BLOCKING = new Set(['#', 'T', 'D', 'B', 'P', 'w', 'b'])
export const tileAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? grid[y][x] : '#')
export const walkable = (x, y) => !BLOCKING.has(tileAt(x, y))

// Cost of stepping onto a tile, the edge weight for the weighted shortest path (Dijkstra).
// Floors and garden paths are quick, the stage is a step up, grass is slow, and squeezing
// along a row of chairs or seats is slowest. BFS ignores these and counts every step as 1.
export const COST = { '.': 1, ',': 1, _: 1, p: 1, S: 2, g: 3, c: 5, C: 5 }
export const tileCost = (x, y) => (walkable(x, y) ? COST[tileAt(x, y)] ?? 1 : Infinity)
export const pathCost = (path) => path.reduce((sum, [x, y]) => sum + tileCost(x, y), 0)

const zoneGrid = new Int8Array(W * H).fill(-1)
ZONES.forEach((z, i) => {
  for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) zoneGrid[y * W + x] = i
})
export const zoneIndexAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? zoneGrid[y * W + x] : -1)
export const zoneAt = (x, y) => ZONES[zoneIndexAt(x, y)] ?? null

// everyone arrives in the lobby, just inside the entrance
export const SPAWN = []
for (let y = 19; y <= 22; y++) for (let x = 20; x <= 31; x++) if (walkable(x, y)) SPAWN.push([x, y])

export const COLORS = ['#6a2ee6', '#ff4d9e', '#24a4b6', '#ff9233', '#2bcf83', '#e9a800', '#b46ef0', '#e5484d']

// directions: 0 down, 1 left, 2 right, 3 up
export const DX = [0, -1, 1, 0]
export const DY = [1, 0, 0, -1]

export const STEP_MS = 140 // how long one tile takes to walk
export const NEAR_RADIUS = 6 // tiles; "Sekitar" chat reaches this far
export const NAME_MAX = 20
export const CHAT_MAX = 200

// the path searches (BFS and Dijkstra) live in pathfinding.js

// strip control and bidi-override characters, then cut to a length in characters (not UTF-16 units)
export function cleanText(value, max) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text).slice(0, max).join('')
}
