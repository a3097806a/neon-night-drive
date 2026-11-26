'use strict';
// 多人伺服器整合測試：使用真實 WebSocket 連線（本機多客戶端）
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const { createServer } = require('../server/server.js');
const D = require('../public/shared/data.js');
const T = require('../public/shared/track.js');
const A = require('../public/shared/ai.js');
const P = require('../public/shared/physics.js');

let app, url;
test.before(async () => {
  const dataDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'nnd-srv-'));
  app = await createServer({ port: 0, host: '127.0.0.1', log: () => {}, grace: 2500, dataDir });
  url = `ws://127.0.0.1:${app.port}/ws`;
});
test.after(async () => { await app.close(); });

/** 測試用客戶端：記錄所有訊息，可等待特定訊息 */
function client(name, token) {
  token = token || crypto.randomBytes(16).toString('hex');
  const c = { name, token, msgs: [], waiters: [], id: null, ws: null, seq: 0, drive: false, closed: false };
  c.open = () => new Promise((resolve, reject) => {
    c.ws = new WebSocket(url);
    c.closed = false;
    c.ws.on('open', () => { c.send({ t: 'hello', token, name }); });
    c.ws.on('message', d => {
      const m = JSON.parse(d);
      c.msgs.push(m);
      if (m.t === 'welcome') { c.id = m.id; resolve(c); }
      if (m.t === 's' && c.drive) c.autoDrive(m);
      c.waiters = c.waiters.filter(w => { if (w.pred(m)) { w.resolve(m); return false; } return true; });
    });
    c.ws.on('close', () => { c.closed = true; });
    c.ws.on('error', reject);
  });
  c.send = m => c.ws.readyState === 1 && c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 8000, label = '') => new Promise((resolve, reject) => {
    const hit = c.msgs.find(pred); if (hit) return resolve(hit);
    const w = { pred, resolve };
    c.waiters.push(w);
    setTimeout(() => reject(new Error(`${c.name} 等待逾時 ${label}`)), ms);
  });
  c.waitNew = (pred, ms = 8000, label = '') => new Promise((resolve, reject) => {
    c.waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error(`${c.name} 等待逾時 ${label}`)), ms);
  });
  c.close = () => new Promise(r => { if (c.closed) return r(); c.ws.once('close', r); c.ws.close(); });
  // 用 AI 依伺服器回傳的本車狀態產生輸入（模擬真人送出的方向、油門、煞車）
  c.autoDrive = m => {
    if (m.phase !== 'race' || !m.me) return;
    const track = T.get(D.TRACKS, c.trackId);
    if (!c.brain) c.brain = A.createBrain('hard', c.name.length * 97);
    const car = Object.assign(P.createCar(track.grid[0], []), m.me);
    const spec = D.CARS[c.car || 'swift'];
    for (let k = 0; k < 3; k++) {
      const i = A.think(c.brain, car, spec, track, D.SIM_DT, { racing: true, skillsOff: true });
      c.send({ t: 'in', seq: ++c.seq, th: i.throttle, br: i.brake, st: i.steer, s1: 0, s2: 0 });
    }
  };
  return c;
}

const get = path => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${app.port}${path}`, res => {
    let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
  }).on('error', reject);
});

test('健康檢查與 API 資訊；未產生 APK 時不提供下載', async () => {
  const h = await get('/healthz');
  assert.strictEqual(h.status, 200);
  assert.strictEqual(JSON.parse(h.body).ok, true);
  const info = JSON.parse((await get('/api/info')).body);
  assert.strictEqual(info.maxPlayers, 8);
  assert.strictEqual(info.apk, null, '沒有 APK 檔案時 apk 必須為 null');
  const idx = await get('/');
  assert.strictEqual(idx.status, 200);
  assert.match(idx.body, /霓虹夜行/);
  const trav = await get('/..%2f..%2fpackage.json');
  assert.notStrictEqual(trav.status, 200, '不得讀取 public 以外的檔案');
});

test('房號錯誤有明確提示', async () => {
  const a = await client('甲').open();
  a.send({ t: 'join', code: 'ZZZZ', name: '甲' });
  const e = await a.wait(m => m.t === 'err');
  assert.strictEqual(e.code, 'ROOM_NOT_FOUND');
  assert.match(e.msg, /找不到/);
  await a.close();
});

test('8 人同場即時比賽、第 9 人房滿、比賽中禁止加入、結算只送一次', { timeout: 90000 }, async () => {
  const cs = [];
  for (let i = 0; i < 9; i++) cs.push(await client('車手' + (i + 1)).open());
  const [host, ...rest] = cs;
  host.send({ t: 'create', name: host.name });
  const room = (await host.wait(m => m.t === 'room')).room;
  const code = room.code;
  // 6 人先加入，剩下 2 人「同時」搶最後 1 席
  for (const c of rest.slice(0, 6)) { c.send({ t: 'join', code, name: c.name }); await c.wait(m => m.t === 'room' && m.room.code === code); }
  const [r1, r2] = [rest[6], rest[7]];
  r1.send({ t: 'join', code, name: r1.name }); r2.send({ t: 'join', code, name: r2.name });
  const res = await Promise.all([r1, r2].map(c => c.wait(m => (m.t === 'room' && m.room.code === code) || m.t === 'err')));
  const ok = res.filter(m => m.t === 'room').length, full = res.filter(m => m.t === 'err' && m.code === 'ROOM_FULL').length;
  assert.strictEqual(ok, 1, '搶最後一席只能有 1 人成功'); assert.strictEqual(full, 1);
  const inRoom = cs.filter(c => c.msgs.some(m => m.t === 'room' && m.room.code === code));
  const outside = cs.find(c => !inRoom.includes(c));
  assert.strictEqual(inRoom.length, 8);
  // 第 9 個（另一個）再試一次也是房滿
  outside.send({ t: 'join', code, name: outside.name });
  const fullErr = await outside.waitNew(m => m.t === 'err');
  assert.strictEqual(fullErr.code, 'ROOM_FULL'); assert.match(fullErr.msg, /房間已滿/);

  // 房主設定：1 圈、不補 AI；非房主不能改設定
  inRoom[1].send({ t: 'settings', laps: 1 });
  assert.strictEqual((await inRoom[1].waitNew(m => m.t === 'err')).code, 'NOT_HOST');
  host.send({ t: 'settings', track: 'city', laps: 1, skills: false, aiFill: false, aiDiff: 'normal' });
  await host.waitNew(m => m.t === 'room' && m.room.settings.laps === 1);
  // 未全員準備時不能開賽
  host.send({ t: 'start' });
  assert.strictEqual((await host.waitNew(m => m.t === 'err')).code, 'NOT_READY');
  for (const c of inRoom) { c.car = D.CAR_ORDER[inRoom.indexOf(c) % 4]; c.send({ t: 'setup', car: c.car, skills: ['nitro', 'grip'] }); }
  for (const c of inRoom.slice(1)) c.send({ t: 'ready', v: true });
  await host.waitNew(m => m.t === 'room' && m.room.players.filter(p => p.id !== m.room.host).every(p => p.ready));
  for (const c of inRoom) { c.trackId = 'city'; c.drive = true; }
  host.send({ t: 'start' });
  const starts = await Promise.all(inRoom.map(c => c.wait(m => m.t === 'start')));
  const raceId = starts[0].raceId;
  assert.ok(starts.every(s => s.raceId === raceId && s.grid.length === 8));
  assert.strictEqual(new Set(starts[0].grid.map(g => g.id)).size, 8, '不得有重複車輛');
  assert.strictEqual(new Set(starts[0].grid.map(g => g.slot)).size, 8, '每台車有獨立起跑格');

  // 比賽中第 9 人加入：比賽進行中
  outside.send({ t: 'join', code, name: outside.name });
  const busy = await outside.waitNew(m => m.t === 'err');
  assert.ok(busy.code === 'RACE_IN_PROGRESS' || busy.code === 'ROOM_FULL');

  // 起跑後前 4 秒幽靈化
  const early = await host.wait(m => m.t === 's' && m.phase === 'race' && m.time < 1);
  assert.ok(early.cars.every(c => c.gh), '起跑初期所有車應為幽靈狀態');

  // 等待 8 台車由各自連線的輸入完成比賽
  const results = await Promise.all(inRoom.map(c => c.wait(m => m.t === 'results', 70000, '結算')));
  for (const r of results) {
    assert.strictEqual(r.raceId, raceId);
    assert.strictEqual(r.standings.length, 8);
  }
  const st = results[0].standings;
  assert.ok(st.filter(s => s.finished).length >= 6, '多數車手應完賽：' + JSON.stringify(st.map(s => [s.rank, s.finished, s.dnf])));
  assert.deepStrictEqual(st.map(s => s.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const s of st.filter(x => x.finished)) assert.ok(results[0].xp[s.id].some(p => p.label === '完賽'));
  await new Promise(r => setTimeout(r, 400));
  for (const c of inRoom) assert.strictEqual(c.msgs.filter(m => m.t === 'results').length, 1, '結算只送一次');

  // 房主再戰 → 回到大廳
  host.send({ t: 'rematch' });
  const lobby = await inRoom[3].waitNew(m => m.t === 'room' && m.room.phase === 'lobby');
  assert.strictEqual(lobby.room.players.length, 8);
  await Promise.all(cs.map(c => c.close()));
});

test('斷線重連回到原車位、不複製車輛；重複封包被忽略；逾時標記未完賽', { timeout: 30000 }, async () => {
  const a = await client('房主A').open(), b = await client('玩家B').open(), c = await client('玩家C').open();
  a.send({ t: 'create', name: a.name });
  const code = (await a.wait(m => m.t === 'room')).room.code;
  for (const x of [b, c]) { x.send({ t: 'join', code, name: x.name }); await x.wait(m => m.t === 'room' && m.room.code === code); }
  a.send({ t: 'settings', laps: 3, aiFill: true, skills: true });
  await a.waitNew(m => m.t === 'room' && m.room.settings.aiFill);
  b.send({ t: 'ready', v: true }); c.send({ t: 'ready', v: true });
  await a.waitNew(m => m.t === 'room' && m.room.players.every(p => p.id === m.room.host || p.ready));
  a.send({ t: 'start' });
  const s0 = await b.wait(m => m.t === 'start');
  assert.strictEqual(s0.grid.length, 8, '真人 3 + AI 補位 5');
  const slotB = s0.grid.find(g => g.id === b.id).slot;

  // 重複封包：同一個 seq 送兩次，只會排入一次
  await b.wait(m => m.t === 's' && m.phase === 'race', 8000, '起跑');
  const pB = [...app.hub.byToken.values()].find(p => p.id === b.id);
  pB.queue.length = 0; const before = pB.lastSeq;
  b.send({ t: 'in', seq: before + 1, th: 1, br: 0, st: 0 }); b.send({ t: 'in', seq: before + 1, th: 1, br: 0, st: 0 }); b.send({ t: 'in', seq: before, th: 1, br: 0, st: 0 });
  await new Promise(r => setTimeout(r, 30));
  assert.ok(pB.lastSeq === before + 1);

  // B 斷線（像重新整理）→ 用同一個 token 重連
  await b.close();
  const dc = await a.waitNew(m => m.t === 's' && m.cars.find(x => x.id === b.id).dc, 4000, 'B 斷線');
  assert.ok(dc);
  const b2 = client('玩家B', b.token);
  await b2.open();
  assert.strictEqual(b2.id, b.id, '重連後是同一位玩家');
  const s1 = await b2.wait(m => m.t === 'start');
  assert.strictEqual(s1.raceId, s0.raceId);
  assert.strictEqual(s1.grid.find(g => g.id === b.id).slot, slotB, '回到原車位');
  assert.strictEqual(s1.grid.length, 8, '不得複製車輛');
  const snap = await b2.wait(m => m.t === 's');
  assert.ok(snap.me, '重連後拿得到自己的車輛狀態');
  assert.strictEqual(snap.cars.filter(x => x.id === b.id).length, 1);

  // 同一 token 從第二個分頁連線：舊連線被取代，車輛仍只有一台
  const b3 = client('玩家B', b.token); await b3.open();
  await b2.wait(m => m.t === 'kicked', 3000, '舊分頁被取代');
  const snap3 = await b3.wait(m => m.t === 's');
  assert.strictEqual(snap3.cars.filter(x => x.id === b.id).length, 1);

  // C 斷線且不回來 → 超過寬限時間後標記未完賽
  await c.close();
  const dnf = await a.waitNew(m => m.t === 's' && m.cars.find(x => x.id === c.id).dnf, 6000, 'C 逾時未完賽');
  assert.ok(dnf);

  // 多人模式沒有「重新開始整場」的指令：未知指令不影響比賽
  const t0 = (await a.waitNew(m => m.t === 's')).time;
  b3.send({ t: 'restart' }); b3.send({ t: 'start' });
  const t1 = (await a.waitNew(m => m.t === 's' && m.time > t0 + 0.3)).time;
  assert.ok(t1 > t0, '比賽時間持續前進，沒有被重新開始');
  await Promise.all([a.close(), b3.close()]);
});

test('房主離開時移交房主，其他人可以繼續開賽', { timeout: 20000 }, async () => {
  const a = await client('房主').open(), b = await client('乙').open(), c = await client('丙').open();
  a.send({ t: 'create', name: a.name });
  const code = (await a.wait(m => m.t === 'room')).room.code;
  for (const x of [b, c]) { x.send({ t: 'join', code, name: x.name }); await x.wait(m => m.t === 'room' && m.room.code === code); }
  a.send({ t: 'leave' });
  const r = await b.waitNew(m => m.t === 'room' && m.room.host !== a.id);
  assert.strictEqual(r.room.host, b.id, '房主移交給下一位');
  assert.strictEqual(r.room.players.length, 2);
  c.send({ t: 'ready', v: true });
  await b.waitNew(m => m.t === 'room' && m.room.players.find(p => p.id === c.id).ready);
  b.send({ t: 'start' });
  const st = await c.wait(m => m.t === 'start');
  assert.ok(st.grid.some(g => g.id === b.id) && !st.grid.some(g => g.id === a.id));
  // 房主（乙）斷線 → 丙成為房主，比賽繼續
  await b.close();
  const r2 = await c.waitNew(m => m.t === 'room' && m.room.host === c.id, 4000, '斷線移交');
  assert.strictEqual(r2.room.phase, 'racing');
  await Promise.all([a.close(), c.close()]);
});
