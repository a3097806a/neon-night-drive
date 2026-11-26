'use strict';
/* 霓虹夜行：帳號 HTTP API
 * 驗證方式：Authorization: Bearer <登入憑證>（不使用 Cookie，網頁與 Android App 都能用）
 *
 *   POST  /api/auth/register  { username, password, nickname }
 *   POST  /api/auth/login     { username, password }
 *   POST  /api/auth/logout
 *   GET   /api/me
 *   PATCH /api/me             { nickname }
 *   POST  /api/me/import      { deviceId, totalXp, completed[] }   首次登入「合併本機進度」
 *   POST  /api/me/awards      { raceId, mode, trackId, finished, rank, cars, newRecord }  單機比賽獎勵
 */
const D = require('../public/shared/data.js');

const ERR = {
  BAD_USERNAME: '帳號需為 3～20 個英文字母、數字或底線',
  BAD_PASSWORD: '密碼需為 8～72 個字元',
  BAD_NAME: '暱稱需為 1～12 個字',
  USERNAME_TAKEN: '這個帳號已經有人使用，請換一個',
  BAD_LOGIN: '帳號或密碼錯誤',
  UNAUTHORIZED: '登入已失效，請重新登入',
  RATE_LIMIT: '嘗試次數太多，請稍後再試',
  BAD_REQUEST: '請求格式錯誤',
  ALREADY_IMPORTED: '這台裝置的本機進度已經合併過了',
  TOO_FAST: '比賽結果送出太頻繁',
  NOT_FOUND: '找不到這個 API',
  SERVER: '伺服器暫時無法存取資料庫，請稍後再試'
};

function cleanName(n) {
  return String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
}

function createApi(store, opts) {
  opts = Object.assign({ trustProxy: !!process.env.TRUST_PROXY, log: () => {} }, opts);
  const hits = new Map();       // 登入／註冊節流：IP → [時間]
  const lastSolo = new Map();   // 單機回報節流：帳號 ID → 時間

  function limited(ip, max, windowMs) {
    const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < windowMs);
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return list.length > max;
  }
  function ipOf(req) {
    if (opts.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '';
  }
  function send(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'
    });
    res.end(JSON.stringify(body));
  }
  const fail = (res, status, code, extra) => send(res, status, Object.assign({ error: code, msg: ERR[code] || code }, extra));
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > 8192) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }
  const bearer = req => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };

  /** 單機獎勵：由伺服器依固定表格計算，用戶端只回報比賽事實，並設上限 */
  function soloParts(b) {
    const parts = [];
    if (!b.finished) return parts;
    parts.push({ label: '完賽', xp: D.XP.finish });
    if (b.mode === 'arcade') {
      const cars = Math.max(1, Math.min(8, b.cars | 0)), rank = Math.max(1, Math.min(cars, b.rank | 0 || cars));
      if (rank <= 3 && cars > 1) parts.push({ label: `第 ${rank} 名`, xp: D.XP.podiumBonus[rank - 1] });
      if (cars - rank > 0) parts.push({ label: `贏過 ${cars - rank} 台車`, xp: (cars - rank) * D.XP.perPositionAhead });
    }
    if (b.mode === 'tt' && b.newRecord) parts.push({ label: '刷新個人紀錄', xp: D.XP.newRecord });
    return parts;
  }

  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    if (url.pathname === '/api/info') return false; // 由 server.js 處理
    if (req.method === 'OPTIONS') { send(res, 204, {}); return true; }
    try {
      const p = url.pathname, m = req.method;
      if (m === 'POST' && (p === '/api/auth/register' || p === '/api/auth/login')) {
        if (limited(ipOf(req), 20, 10 * 60 * 1000)) return fail(res, 429, 'RATE_LIMIT'), true;
        const b = await readJson(req);
        const username = typeof b.username === 'string' ? b.username.trim() : '';
        const password = typeof b.password === 'string' ? b.password : '';
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail(res, 400, p.endsWith('login') ? 'BAD_LOGIN' : 'BAD_USERNAME'), true;
        if (password.length < 8 || password.length > 72) return fail(res, 400, p.endsWith('login') ? 'BAD_LOGIN' : 'BAD_PASSWORD'), true;
        let row;
        if (p.endsWith('register')) {
          const nickname = cleanName(b.nickname);
          if (!nickname) return fail(res, 400, 'BAD_NAME'), true;
          const r = store.register(username, password, nickname);
          if (r.error) return fail(res, 409, r.error), true;
          row = r.account;
          opts.log(`註冊帳號 ${row.username}`);
        } else {
          row = store.login(username, password);
          if (!row) return fail(res, 401, 'BAD_LOGIN'), true;
        }
        const token = store.createSession(row.id);
        send(res, 200, { token, profile: store.profile(row) });
        return true;
      }
      // 以下都需要登入
      const token = bearer(req), row = token && store.accountForToken(token);
      if (p === '/api/auth/logout' && m === 'POST') { if (token) store.logout(token); send(res, 200, { ok: true }); return true; }
      if (!row) return fail(res, 401, 'UNAUTHORIZED'), true;
      if (p === '/api/me' && m === 'GET') { send(res, 200, { profile: store.profile(row) }); return true; }
      if (p === '/api/me' && m === 'PATCH') {
        const b = await readJson(req), nickname = cleanName(b.nickname);
        if (!nickname) return fail(res, 400, 'BAD_NAME'), true;
        send(res, 200, { profile: store.profile(store.setNickname(row.id, nickname)) });
        return true;
      }
      if (p === '/api/me/import' && m === 'POST') {
        const b = await readJson(req);
        if (typeof b.deviceId !== 'string' || !/^[a-f0-9]{16,64}$/.test(b.deviceId) || !Array.isArray(b.completed)) return fail(res, 400, 'BAD_REQUEST'), true;
        const r = store.importLocal(row.id, b.deviceId, +b.totalXp, b.completed.slice(0, 20).map(String));
        if (r.error) return fail(res, 409, r.error, { profile: r.profile }), true;
        send(res, 200, { profile: r.profile });
        return true;
      }
      if (p === '/api/me/awards' && m === 'POST') {
        const b = await readJson(req);
        if (typeof b.raceId !== 'string' || !/^r[a-z0-9]{6,40}$/.test(b.raceId) || !['tt', 'arcade'].includes(b.mode) || !D.TRACK_ORDER.includes(b.trackId))
          return fail(res, 400, 'BAD_REQUEST'), true;
        const prev = lastSolo.get(row.id) || 0;
        // 同一場重送（斷線重試）不受節流影響；新的一場至少間隔 10 秒（實際一場比賽遠超過此時間）
        const already = store.q.getAward.get(row.id, 'solo:' + b.raceId);
        if (!already && Date.now() - prev < 10000) return fail(res, 429, 'TOO_FAST'), true;
        const r = store.grant(row.id, 'solo:' + b.raceId, 'solo-' + b.mode, soloParts(b), b.trackId, !!b.finished);
        if (r.granted) lastSolo.set(row.id, Date.now());
        send(res, 200, r);
        return true;
      }
      fail(res, 404, 'NOT_FOUND');
      return true;
    } catch (e) {
      if (e && /too large|JSON/.test(e.message)) { fail(res, 400, 'BAD_REQUEST'); return true; }
      opts.log('API 錯誤', e);
      fail(res, 500, 'SERVER');
      return true;
    }
  };
}

module.exports = { createApi, ERR };
