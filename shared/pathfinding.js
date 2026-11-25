// Shortest paths over the campus grid. Each walkable tile is a node, joined to its four
// neighbours; the edge into a tile weighs that tile's cost (see COST in map.js).
//
//   bfs       fewest steps, ignores the weights            O(V + E)
//   dijkstra  lowest total cost, uses a binary min-heap    O((V + E) log V)
//
// Both return { path, cost, steps, visited, order } or null when the target can't be reached.
// `path` lists the tiles to walk, start excluded; `visited` counts the nodes taken off the
// queue (or heap), and `order` lists them in that order, for drawing how the search spread.

import { W, H, DX, DY, walkable, tileCost, pathCost } from './map.js'

// a blocked target (a desk, a tree) means "walk up next to it"
function goalsFor(tx, ty) {
  const goals = new Set()
  if (walkable(tx, ty)) goals.add(ty * W + tx)
  else for (let d = 0; d < 4; d++) if (walkable(tx + DX[d], ty + DY[d])) goals.add((ty + DY[d]) * W + tx + DX[d])
  return goals
}

function trace(prev, start, end) {
  const path = []
  for (let at = end; at !== start; at = prev[at]) path.push([at % W, Math.floor(at / W)])
  return path.reverse()
}

function result(path, cost, order) {
  return { path, cost, steps: path.length, visited: order.length, order }
}

export function bfs(sx, sy, tx, ty) {
  const goals = goalsFor(tx, ty)
  if (!goals.size || !walkable(sx, sy)) return null
  const start = sy * W + sx
  if (goals.has(start)) return result([], 0, [start])
  const prev = new Int32Array(W * H).fill(-1)
  prev[start] = start
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const cx = cur % W
    const cy = (cur - cx) / W
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (!walkable(nx, ny)) continue
      const next = ny * W + nx
      if (prev[next] !== -1) continue
      prev[next] = cur
      if (goals.has(next)) {
        const path = trace(prev, start, next)
        return result(path, pathCost(path), queue.slice(0, head + 1))
      }
      queue.push(next)
    }
  }
  return null
}

// binary min-heap of (priority, node) pairs kept in two parallel arrays
class MinHeap {
  constructor() {
    this.keys = []
    this.nodes = []
  }

  get size() {
    return this.keys.length
  }

  push(key, node) {
    const { keys, nodes } = this
    let i = keys.length
    keys.push(key)
    nodes.push(node)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      keys[i] = keys[parent]
      nodes[i] = nodes[parent]
      i = parent
    }
    keys[i] = key
    nodes[i] = node
  }

  // removes and returns the node with the smallest key
  pop() {
    const { keys, nodes } = this
    const topNode = nodes[0]
    const key = keys.pop()
    const node = nodes.pop()
    const n = keys.length
    if (n) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= n) break
        if (child + 1 < n && keys[child + 1] < keys[child]) child++
        if (keys[child] >= key) break
        keys[i] = keys[child]
        nodes[i] = nodes[child]
        i = child
      }
      keys[i] = key
      nodes[i] = node
    }
    return topNode
  }
}

export function dijkstra(sx, sy, tx, ty) {
  const goals = goalsFor(tx, ty)
  if (!goals.size || !walkable(sx, sy)) return null
  const start = sy * W + sx
  const dist = new Float64Array(W * H).fill(Infinity)
  const prev = new Int32Array(W * H).fill(-1)
  const done = new Uint8Array(W * H)
  const order = []
  dist[start] = 0
  prev[start] = start
  const heap = new MinHeap()
  heap.push(0, start)
  while (heap.size) {
    const cur = heap.pop()
    if (done[cur]) continue // a stale entry: this node was already settled at a lower cost
    done[cur] = 1
    order.push(cur)
    // the first goal settled is the cheapest one to reach
    if (goals.has(cur)) return result(trace(prev, start, cur), dist[cur], order)
    const cx = cur % W
    const cy = (cur - cx) / W
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (!walkable(nx, ny)) continue
      const next = ny * W + nx
      const nd = dist[cur] + tileCost(nx, ny)
      if (nd < dist[next]) {
        dist[next] = nd
        prev[next] = cur
        heap.push(nd, next)
      }
    }
  }
  return null
}

export const ALGORITHMS = {
  bfs: { name: 'BFS', run: bfs },
  dijkstra: { name: 'Dijkstra', run: dijkstra },
}
