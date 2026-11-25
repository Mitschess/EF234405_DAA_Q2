# Virtual classroom image: builds the page with Vite, then runs the Node server, which serves
# dist/ and the realtime room (/ws) on one port. Used by Azure Container Apps (see README).
#
#   docker build -t kelas . && docker run -p 8080:8080 -e KELAS_ADMIN_TOKEN=... kelas

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# The server needs only dist/, server/, shared/ and the ws package at runtime; Phaser, Vite and the
# fonts are already bundled into dist/, so the final image stays small.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/package.json ./
RUN node -e "const p=require('./package.json');require('fs').writeFileSync('package.json',JSON.stringify({name:p.name,private:true,version:p.version,type:p.type,scripts:{start:p.scripts.start},dependencies:{ws:p.dependencies.ws}},null,2))" \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
