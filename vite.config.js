import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { createGame } from './server/game.js'
import { createAdmin } from './server/admin.js'

// In development the realtime room rides on Vite's own HTTP server at /ws, so `npm run dev`
// is the only command needed. Production runs server/index.js on its own.
//
// The admin panel (/admin) works in dev too. Its code is KELAS_ADMIN_TOKEN if set, otherwise
// "admin-dev" (printed on start). Production has no default: no token, no admin.
const DEV_ADMIN_TOKEN = 'admin-dev'

function kelasRealtime() {
  let game = null
  const attach = (server) => {
    const httpServer = server.httpServer
    if (!httpServer) return
    game ??= createGame({ maxPlayers: Number(process.env.MAX_PLAYERS || 500) })
    const token = process.env.KELAS_ADMIN_TOKEN || DEV_ADMIN_TOKEN
    const adminApi = createAdmin(game, { token })
    httpServer.on('upgrade', (req, socket, head) => {
      if ((req.url || '').split('?')[0] === '/ws') game.handleUpgrade(req, socket, head)
    })
    httpServer.on('close', () => {
      game?.close()
      game = null
    })
    httpServer.once('listening', () => {
      const where = server.resolvedUrls?.local?.[0] ?? '/'
      const code = process.env.KELAS_ADMIN_TOKEN ? 'dari KELAS_ADMIN_TOKEN' : `kode: ${DEV_ADMIN_TOKEN}`
      server.config.logger.info(`  ➜  Admin:   ${where}admin (${code})`)
    })
    server.middlewares.use('/stats', (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(game?.stats() ?? {}))
    })
    server.middlewares.use((req, res, next) => {
      const pathname = (req.url || '').split('?')[0]
      if (pathname.startsWith('/admin/api/')) {
        if (!game || !adminApi(req, res)) next()
      } else if (pathname === '/admin') {
        req.url = '/admin.html' // same clean path as production
        next()
      } else if (pathname === '/admin/') {
        res.statusCode = 308
        res.setHeader('Location', '../admin')
        res.end()
      } else next()
    })
  }
  return { name: 'kelas-realtime', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig({
  base: './',
  plugins: [kelasRealtime()],
  server: {
    host: '127.0.0.1',
    port: 5185, // 5173 is the main site, 5180 the Fund app
  },
  preview: { host: '127.0.0.1', port: 5186 },
  build: {
    // Phaser is one ~1.5 MB library (≈350 KB gzipped); splitting it buys nothing here
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
})
