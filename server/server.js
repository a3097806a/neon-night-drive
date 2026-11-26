'use strict';
/* 霓虹夜行：HTTP 靜態檔案 + WebSocket 多人伺服器 + 健康檢查
 * 同一個網域同時提供遊戲網頁與 /ws 即時連線（正式環境由主機的 HTTPS 終結，瀏覽器使用 wss://）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const D = require('../public/shared/data.js');
const { Hub } = require('./rooms.js');
const { Store } = require('./db.js');
const { createApi } = require('./api.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const APK_PATH = path.join(PUBLIC, 'downloads', 'neon-night-drive.apk');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive'
};
const NO_CACHE = new Set(['/index.html', '/sw.js', '/config.js', '/manifest.webmanifest']);

function apkInfo() {
  try {
    const st = fs.statSync(APK_PATH);
    if (!st.isFile() || st.size < 1024) return null;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'downloads', 'apk.json'), 'utf8')); } catch (e) { /* 選填 */ }
    return { url: '/downloads/neon-night-drive.apk', size: st.size, version: meta.version || D.GAME_VERSION };
  } catch (e) { return null; }
}

function createServer(opts) {
  opts = Object.assign({ port: +process.env.PORT || 3000, host: process.env.HOST || '0.0.0.0', log: console.log,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    maxRooms: +process.env.MAX_ROOMS || 300, grace: process.env.RECONNECT_GRACE_MS ? +process.env.RECONNECT_GRACE_MS : undefined,
    dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data') }, opts);
  const started = Date.now();
  const store = new Store(opts.dataDir);
  opts.log(`車手資料庫：${store.file}`);
  const api = createApi(store, { log: opts.log });
  const hub = new Hub({ log: opts.log, maxRooms: opts.maxRooms, grace: opts.grace, store });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/info') { await api(req, res, url); return; }
    const sec = {
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    };
    if (url.pathname === '/healthz') {
      const s = hub.stats();
      let db = false;
      try { db = store.db.prepare('SELECT 1 AS ok').get().ok === 1; } catch (e) { /* 資料庫異常 */ }
      res.writeHead(db ? 200 : 503, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, sec));
      return res.end(JSON.stringify({ ok: db, db, version: D.GAME_VERSION, uptime: Math.round((Date.now() - started) / 1000), rooms: s.rooms, players: s.players }));
    }
    if (url.pathname === '/api/info') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, sec));
      return res.end(JSON.stringify({ version: D.GAME_VERSION, rulesVersion: D.RULES_VERSION, maxPlayers: D.RULES.maxPlayers, accounts: true, apk: apkInfo() }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, sec); return res.end(); }
    let p;
    try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400, sec); return res.end(); }
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403, sec); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, sec));
        return res.end('找不到檔案');
      }
      const ext = path.extname(file).toLowerCase();
      const headers = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
        'Cache-Control': NO_CACHE.has(p) ? 'no-cache' : ext === '.apk' ? 'no-store' : 'public, max-age=300' }, sec);
      if (ext === '.apk') headers['Content-Disposition'] = 'attachment; filename="neon-night-drive.apk"';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096,
    verifyClient: info => !opts.allowedOrigins.length || opts.allowedOrigins.includes(info.origin) });
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const conn = {
      player: null,
      send(m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      close() { try { ws.close(4001, 'replaced'); } catch (e) { /* 已關閉 */ } }
    };
    ws.on('message', data => {
      let msg; try { msg = JSON.parse(data); } catch (e) { return; }
      try { hub.handle(conn, msg); } catch (e) { opts.log('處理訊息錯誤', e); }
    });
    ws.on('close', () => hub.disconnect(conn));
    ws.on('error', () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 15000);

  // 固定 60Hz 模擬（以累積時間補償計時器誤差）
  let lastT = process.hrtime.bigint(), acc = 0;
  const loop = setInterval(() => {
    const t = process.hrtime.bigint(); acc += Number(t - lastT) / 1e9; lastT = t;
    let n = 0;
    while (acc >= D.SIM_DT && n < 10) { hub.tick(); acc -= D.SIM_DT; n++; }
    if (acc > 0.5) acc = 0;
  }, 1000 / 120);

  return new Promise(resolve => {
    server.listen(opts.port, opts.host, () => {
      const port = server.address().port;
      opts.log(`霓虹夜行伺服器啟動：http://localhost:${port}（WebSocket 路徑 /ws，健康檢查 /healthz）`);
      resolve({
        server, hub, port, wss, store,
        close: () => new Promise(r => { clearInterval(loop); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(() => { store.close(); r(); }); })
      });
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  createServer().then(app => {
    const stop = () => { console.log('收到結束訊號，正在關閉伺服器…'); app.close().then(() => process.exit(0)); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  });
}
