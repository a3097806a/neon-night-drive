'use strict';
// 車手帳號與雲端存檔：真實 HTTP API + WebSocket 多人比賽 + 重新啟動伺服器後資料保留
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { createServer } = require('../server/server.js');
const D = require('../public/shared/data.js');
const T = require('../public/shared/track.js');
const A = require('../public/shared/ai.js');
const P = require('../public/shared/physics.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nnd-acct-'));
let app, port;
async function boot() { app = await createServer({ port: 0, host: '127.0.0.1', log: () => {}, grace: 3000, dataDir }); port = app.port; }
test.before(boot);
test.after(async () => { if (app) await app.close(); });

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) { /* 空 */ } resolve({ status: res.statusCode, body: j }); }); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/** 多人測試用客戶端：以 AI 依伺服器回傳的本車狀態送出輸入 */
function client(name, session, token) {
  token = token || crypto.randomBytes(16).toString('hex');
  const c = { name, token, session, msgs: [], waiters: [], id: null, seq: 0, drive: false };
  c.open = () => new Promise((resolve, reject) => {
    c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    c.ws.on('open', () => c.send({ t: 'hello', token, name, session }));
    c.ws.on('message', d => {
      const m = JSON.parse(d); c.msgs.push(m);
      if (m.t === 'welcome') { c.id = m.id; c.welcome = m; resolve(c); }
      if (m.t === 's' && c.drive && m.phase === 'race' && m.me) {
        const tr = T.get(D.TRACKS, 'city'), car = Object.assign(P.createCar(tr.grid[0], []), m.me);
        c.brain = c.brain || A.createBrain('hard', c.name.length * 31 + 7);
        for (let k = 0; k < 3; k++) { const i = A.think(c.brain, car, D.CARS.swift, tr, D.SIM_DT, { racing: true, skillsOff: true }); c.send({ t: 'in', seq: ++c.seq, th: i.throttle, br: i.brake, st: i.steer }); }
      }
      c.waiters = c.waiters.filter(w => { if (w.pred(m)) { w.resolve(m); return false; } return true; });
    });
    c.ws.on('error', reject);
  });
  c.send = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 8000, label = '') => new Promise((resolve, reject) => {
    const hit = c.msgs.find(pred); if (hit) return resolve(hit);
    c.waiters.push({ pred, resolve }); setTimeout(() => reject(new Error(`${c.name} 等待逾時 ${label}`)), ms);
  });
  c.waitNew = (pred, ms = 8000, label = '') => new Promise((resolve, reject) => {
    c.waiters.push({ pred, resolve }); setTimeout(() => reject(new Error(`${c.name} 等待逾時 ${label}`)), ms);
  });
  c.close = () => new Promise(r => { if (c.ws.readyState === 3) return r(); c.ws.once('close', r); c.ws.close(); });
  return c;
}

const S = {}; // 跨測試共用的帳號資訊

test('註冊、登入驗證；帳號名稱唯一、暱稱可重複', async () => {
  let r = await req('POST', '/api/auth/register', { username: 'ab', password: '12345678', nickname: '阿明' });
  assert.strictEqual(r.status, 400); assert.match(r.body.msg, /3～20/);
  r = await req('POST', '/api/auth/register', { username: 'player_one', password: 'short', nickname: '阿明' });
  assert.strictEqual(r.status, 400); assert.match(r.body.msg, /密碼/);
  r = await req('POST', '/api/auth/register', { username: 'player_one', password: 'neon-pass-1', nickname: '阿明' });
  assert.strictEqual(r.status, 200);
  S.a = { token: r.body.token, id: r.body.profile.id };
  assert.match(S.a.id, /^[0-9a-f-]{36}$/, '玩家帳號 ID 是 UUID');
  assert.strictEqual(r.body.profile.level, 1);
  r = await req('POST', '/api/auth/register', { username: 'PLAYER_ONE', password: 'another-pass', nickname: '別人' });
  assert.strictEqual(r.status, 409, '帳號名稱不分大小寫唯一'); assert.match(r.body.msg, /已經有人使用/);
  r = await req('POST', '/api/auth/register', { username: 'player_two', password: 'neon-pass-2', nickname: '阿明' });
  assert.strictEqual(r.status, 200, '相同暱稱可以註冊');
  S.b = { token: r.body.token, id: r.body.profile.id };
  assert.notStrictEqual(S.a.id, S.b.id);
  r = await req('POST', '/api/auth/login', { username: 'player_one', password: 'wrong-pass' });
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.msg, '帳號或密碼錯誤');
  r = await req('POST', '/api/auth/login', { username: 'nobody_here', password: 'whatever1' });
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.msg, '帳號或密碼錯誤', '帳號不存在與密碼錯誤的訊息相同');
  r = await req('GET', '/api/me');
  assert.strictEqual(r.status, 401);
  // 資料庫不存明碼密碼
  const row = app.store.get(S.a.id);
  assert.ok(row.pass_hash.startsWith('scrypt$') && !row.pass_hash.includes('neon-pass-1'));
});

test('多人比賽結束由伺服器寫入資料庫；同名玩家各自計算；訪客不寫入；重連只領一次', { timeout: 60000 }, async () => {
  const a = await client('阿明', S.a.token).open();
  const b = await client('阿明', S.b.token).open();   // 另一位玩家，暱稱相同
  const g = await client('訪客小華').open();           // 訪客：只輸入暱稱就能加入
  assert.deepStrictEqual(a.welcome.account, { id: S.a.id });
  assert.strictEqual(g.welcome.account, null);
  a.send({ t: 'create', name: '阿明' });
  const code = (await a.wait(m => m.t === 'room')).room.code;
  for (const x of [b, g]) { x.send({ t: 'join', code, name: x.name }); await x.wait(m => m.t === 'room' && m.room.code === code); }
  a.send({ t: 'settings', track: 'city', laps: 1, skills: false, aiFill: false });
  await a.waitNew(m => m.t === 'room' && m.room.settings.laps === 1 && !m.room.settings.aiFill);
  b.send({ t: 'ready', v: true }); g.send({ t: 'ready', v: true });
  await a.waitNew(m => m.t === 'room' && m.room.players.every(p => p.id === m.room.host || p.ready));
  for (const x of [a, b, g]) x.drive = true;
  a.send({ t: 'start' });
  const start = await a.wait(m => m.t === 'start');
  S.raceId = start.raceId;
  const [ra, rb, rg] = await Promise.all([a, b, g].map(x => x.wait(m => m.t === 'results', 45000, '結算')));
  const st = ra.standings;
  assert.ok(st.every(s => s.finished), '三人都完賽：' + JSON.stringify(st.map(s => [s.name, s.rank, s.finished])));
  // 已登入：伺服器回傳雲端結果；訪客：沒有雲端結果
  assert.ok(ra.cloud && ra.cloud.granted, 'A 寫入帳號');
  assert.ok(rb.cloud && rb.cloud.granted, 'B 寫入帳號');
  assert.strictEqual(rg.cloud, null, '訪客不寫入資料庫');
  // 個人化：A 的結算只含 A 自己的帳號資料
  assert.strictEqual(ra.cloud.profile.id, S.a.id);
  assert.strictEqual(rb.cloud.profile.id, S.b.id);
  assert.ok(!JSON.stringify(ra).includes(S.b.id), 'A 收不到 B 的帳號 ID');
  // 依正式名次計算：完賽 100 + 名次獎勵 + 贏過人數 + 首次完成霓虹市區 150
  const rankA = st.find(s => s.id === a.id).rank;
  const expectA = 100 + (D.XP.podiumBonus[rankA - 1] || 0) + (3 - rankA) * 10 + 150;
  assert.strictEqual(ra.cloud.total, expectA);
  assert.strictEqual(ra.cloud.profile.totalXp, expectA);
  assert.ok(ra.cloud.parts.some(p => /首次完成/.test(p.label)));
  S.aProfile = ra.cloud.profile;
  S.bTotal = rb.cloud.profile.totalXp;

  // A 重新整理（斷線後用同一個分頁識別碼重連）：重送同一份結果，但不會再發一次
  await a.close();
  const a2 = client('阿明', S.a.token, a.token); await a2.open();
  const again = await a2.wait(m => m.t === 'results');
  assert.strictEqual(again.raceId, S.raceId);
  assert.strictEqual(app.store.get(S.a.id).total_xp, expectA, '重連後總經驗不變');
  // 直接再呼叫一次發放（模擬重送或程式重入）：資料庫唯一鍵擋下
  const dup = app.store.grant(S.a.id, S.raceId, 'mp', [{ label: '完賽', xp: 100 }], 'city', true);
  assert.strictEqual(dup.granted, false);
  assert.strictEqual(app.store.get(S.a.id).total_xp, expectA);
  const n = app.store.db.prepare('SELECT COUNT(*) AS n FROM awards WHERE account_id = ? AND race_id = ?').get(S.a.id, S.raceId).n;
  assert.strictEqual(n, 1, '玩家 ID＋比賽 ID 只有一筆');
  await Promise.all([a2.close(), b.close(), g.close()]);
});

test('換裝置（手機）登入同一帳號：等級、經驗值、解鎖項目相同；同名的另一位玩家只看到自己的', async () => {
  const phone = await req('POST', '/api/auth/login', { username: 'player_one', password: 'neon-pass-1' });
  assert.strictEqual(phone.status, 200);
  assert.notStrictEqual(phone.body.token, S.a.token, '手機拿到另一個登入憑證');
  const me = (await req('GET', '/api/me', null, phone.body.token)).body.profile;
  for (const k of ['id', 'level', 'xp', 'totalXp', 'nickname']) assert.deepStrictEqual(me[k], S.aProfile[k], k);
  assert.deepStrictEqual(me.unlocks, S.aProfile.unlocks);
  assert.ok(me.level >= 2 && me.unlocks.includes('paint:sunset'), '升到 Lv2 並解鎖霓虹橘');
  const other = (await req('GET', '/api/me', null, S.b.token)).body.profile;
  assert.strictEqual(other.nickname, me.nickname, '兩人暱稱相同');
  assert.strictEqual(other.id, S.b.id);
  assert.strictEqual(other.totalXp, S.bTotal, 'B 只看到自己的經驗值');
  S.phoneToken = phone.body.token;
});

test('單機獎勵：伺服器依固定表格計算、同一場只領一次、不能灌經驗', async () => {
  const before = (await req('GET', '/api/me', null, S.b.token)).body.profile.totalXp;
  const rep = { raceId: 'rsolo' + Date.now().toString(36), mode: 'arcade', trackId: 'harbor', finished: true, rank: 1, cars: 99, newRecord: true };
  const r1 = await req('POST', '/api/me/awards', rep, S.b.token);
  assert.strictEqual(r1.status, 200); assert.ok(r1.body.granted);
  // cars 上限 8：100 + 60 + 7×10 + 首次完成 150；arcade 不給「刷新紀錄」
  assert.strictEqual(r1.body.total, 100 + 60 + 70 + 150);
  const r2 = await req('POST', '/api/me/awards', rep, S.b.token);
  assert.strictEqual(r2.status, 200); assert.strictEqual(r2.body.granted, false, '重送同一場不再發放');
  const after = (await req('GET', '/api/me', null, S.b.token)).body.profile.totalXp;
  assert.strictEqual(after - before, 380);
  const r3 = await req('POST', '/api/me/awards', Object.assign({}, rep, { raceId: 'rsolo' + (Date.now() + 1).toString(36) }), S.b.token);
  assert.strictEqual(r3.status, 429, '連續回報新比賽會被節流');
  const bad = await req('POST', '/api/me/awards', { raceId: '../x', mode: 'tt', trackId: 'city' }, S.b.token);
  assert.strictEqual(bad.status, 400);
});

test('首次登入合併本機進度：取較高者、地圖取聯集；同一裝置只能合併一次', async () => {
  const reg = await req('POST', '/api/auth/register', { username: 'merge_me', password: 'merge-pass-1', nickname: '合併測試' });
  const t = reg.body.token, dev = crypto.randomBytes(16).toString('hex');
  let r = await req('POST', '/api/me/import', { deviceId: dev, totalXp: 950, completed: ['mountain', 'not_a_track'] }, t);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.profile.totalXp, 950);
  assert.deepStrictEqual(r.body.profile.completed, { mountain: true });
  r = await req('POST', '/api/me/import', { deviceId: dev, totalXp: 99999, completed: [] }, t);
  assert.strictEqual(r.status, 409, '同一裝置不能重複合併');
  assert.strictEqual(r.body.profile.totalXp, 950);
  // 另一台裝置進度較低：取較高者，不會降低雲端進度
  r = await req('POST', '/api/me/import', { deviceId: crypto.randomBytes(16).toString('hex'), totalXp: 10, completed: ['city'] }, t);
  assert.strictEqual(r.body.profile.totalXp, 950);
  assert.deepStrictEqual(r.body.profile.completed, { mountain: true, city: true });
});

test('重新啟動伺服器（模擬重新部署，資料夾保留）：帳號、進度與獎勵紀錄仍在，登入憑證仍有效', async () => {
  const total = app.store.get(S.a.id).total_xp;
  await app.close(); app = null;
  await boot();
  const login = await req('POST', '/api/auth/login', { username: 'player_one', password: 'neon-pass-1' });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.profile.totalXp, total);
  assert.deepStrictEqual(login.body.profile.unlocks, S.aProfile.unlocks);
  const me = await req('GET', '/api/me', null, S.phoneToken);
  assert.strictEqual(me.status, 200, '舊的登入憑證重新部署後仍有效');
  assert.strictEqual(me.body.profile.totalXp, total);
  const dup = app.store.grant(S.a.id, S.raceId, 'mp', [{ label: '完賽', xp: 100 }], 'city', true);
  assert.strictEqual(dup.granted, false, '重新部署後同一場仍不能重複領取');
  assert.ok(fs.existsSync(path.join(dataDir, 'neon-night-drive.sqlite')));
});

test('登出後該登入憑證失效', async () => {
  const r = await req('POST', '/api/auth/logout', null, S.phoneToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await req('GET', '/api/me', null, S.phoneToken)).status, 401);
  assert.strictEqual((await req('GET', '/api/me', null, S.a.token)).status, 200, '其他裝置的登入不受影響');
});
