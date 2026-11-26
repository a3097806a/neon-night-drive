# 霓虹夜行：正式環境容器（遊戲網頁 + WebSocket + 帳號 API 同一個埠）
# 需要 Node 22.13 以上（使用內建 node:sqlite）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# 車手資料庫位置：請把 /data 掛載到持久化磁碟（Volume），重新部署後資料才會保留
ENV DATA_DIR=/data
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
