'use strict';
/* 霓虹夜行：多人房間與權威模擬
 * 玩家裝置只送輸入；位置、能量、計圈、碰撞、排名都由伺服器以共用模擬計算。
 */
const crypto = require('crypto');
const D = require('../public/shared/data.js');
const { Race } = require('../public/shared/sim.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX = D.RULES.maxPlayers;
const SNAP_EVERY = 3;            // 60Hz 模擬，每 3 步送一次快照（20Hz）
const ERR = {
  BAD_NAME: '請輸入 1～12 字的暱稱',
  ROOM_NOT_FOUND: '找不到這個房間，請確認房號',
  ROOM_FULL: `房間已滿（${MAX}/${MAX}），請換一個房間`,
  RACE_IN_PROGRESS: '這個房間的比賽正在進行，請等這場結束後再加入',
  NOT_HOST: '只有房主可以這麼做',
  NOT_READY: '還有車手沒有準備',
  NOT_IN_ROOM: '你目前不在房間裡',
  BAD_REQUEST: '請求格式錯誤',
  TOO_MANY_ROOMS: '伺服器房間數已達上限，請稍後再試'
};

function cleanName(n) {
  return String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
}
const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;

class Hub {
  constructor(opts) {
    this.opts = Object.assign({ grace: D.RULES.reconnectGrace * 1000, maxRooms: 300, now: () => Date.now(), log: () => {} }, opts);
    this.rooms = new Map();      // code → room
    this.byToken = new Map();    // token → player
  }
  now() { return this.opts.now(); }
  stats() {
    let players = 0;
    for (const p of this.byToken.values()) if (p.connected) players++;
    return { rooms: this.rooms.size, players };
  }

  /* ---------- 連線 ---------- */
  hello(conn, msg) {
    let token = typeof msg.token === 'string' && /^[a-f0-9]{16,64}$/.test(msg.token) ? msg.token : null;
    if (!token) token = crypto.randomBytes(16).toString('hex');
    const store = this.opts.store;
    let acct = null;
    try { acct = store && msg.session ? store.accountForToken(msg.session) : null; } catch (e) { acct = null; }
    let p = this.byToken.get(token);
    // 已登入帳號換了分頁或裝置：接回同一帳號「斷線中」的車手，避免同一帳號在房內出現兩台車
    if (!p && acct) {
      const prev = [...this.byToken.values()].find(x => x.accountId === acct.id && x.room && !x.connected);
      if (prev) { this.byToken.delete(prev.token); prev.token = token; this.byToken.set(token, prev); p = prev; }
    }
    if (p) {
      if (p.conn && p.conn !== conn) { p.conn.send({ t: 'kicked', msg: '已在其他分頁或裝置重新連線' }); p.conn.close(); }
      p.conn = conn; p.connected = true; p.discAt = null;
    } else {
      p = { id: 'p' + crypto.randomBytes(4).toString('hex'), token, name: cleanName(msg.name) || '車手', conn, connected: true,
        room: null, car: 'swift', skills: ['nitro', 'grip'], cos: {}, ready: false, queue: [], held: null, lastSeq: 0, ack: 0, msgs: 0, msgWindow: 0 };
      this.byToken.set(token, p);
    }
    conn.player = p;
    const room = p.room && this.rooms.get(p.room);
    if (!room) p.room = null;
    // 比賽進行中不切換帳號，結算一律寫入開賽時的帳號
    if (!(room && room.phase === 'racing')) p.accountId = acct ? acct.id : null;
    p.send = m => p.conn && p.conn.send(m);
    p.send({ t: 'welcome', id: p.id, token, ver: D.GAME_VERSION, room: room ? room.code : null, account: p.accountId ? { id: p.accountId } : null });
    if (room) {
      const e = room.race && room.race.get(p.id);
      if (e) e.disconnected = false;
      p.queue = []; p.held = null;
      this.sendRoom(room);
      if (room.phase === 'racing') { p.send(this.startMsg(room)); this.sendSnap(room, p); }
      if (room.phase === 'results' && room.results) this.sendResults(room, p);
    }
    return p;
  }

  disconnect(conn) {
    const p = conn.player; if (!p || p.conn !== conn) return;
    p.connected = false; p.conn = null; p.discAt = this.now(); p.queue = []; p.held = null;
    const room = p.room && this.rooms.get(p.room);
    if (!room) { this.byToken.delete(p.token); return; }
    const e = room.race && room.race.get(p.id);
    if (e) { e.disconnected = true; e.input = { throttle: 0, brake: 0, steer: 0 }; }
    if (room.host === p.id) this.transferHost(room);
    this.sendRoom(room);
  }

  /* ---------- 訊息 ---------- */
  handle(conn, msg) {
    const p = conn.player;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') { this.hello(conn, msg); return; }
    if (!p) return;
    // 簡單節流：每秒最多 240 則
    const t = this.now();
    if (t - p.msgWindow > 1000) { p.msgWindow = t; p.msgs = 0; }
    if (++p.msgs > 240) return;
    const room = p.room && this.rooms.get(p.room);
    const fail = code => p.send({ t: 'err', code, msg: ERR[code] || code });
    switch (msg.t) {
      case 'ping': p.send({ t: 'pong', c: msg.c, s: t }); return;
      case 'create': {
        const name = cleanName(msg.name); if (!name) return fail('BAD_NAME');
        if (this.rooms.size >= this.opts.maxRooms) return fail('TOO_MANY_ROOMS');
        p.name = name;
        if (room) this.leave(p);
        const code = this.newCode();
        const r = { code, host: p.id, phase: 'lobby', players: [], race: null, results: null, tick: 0, emptySince: null,
          settings: { track: 'city', laps: D.RULES.defaultLaps, skills: true, aiFill: true, aiDiff: 'normal' } };
        this.rooms.set(code, r);
        this.addToRoom(r, p);
        this.opts.log(`建立房間 ${code}（${name}）`);
        return;
      }
      case 'join': {
        const name = cleanName(msg.name); if (!name) return fail('BAD_NAME');
        const code = String(msg.code || '').toUpperCase().slice(0, 8);
        const r = this.rooms.get(code);
        if (!r) return fail('ROOM_NOT_FOUND');
        if (r.players.includes(p)) { this.sendRoom(r); return; }
        if (r.phase !== 'lobby') return fail('RACE_IN_PROGRESS');
        if (r.players.length >= MAX) return fail('ROOM_FULL');
        p.name = name;
        if (room) this.leave(p);
        this.addToRoom(r, p);
        return;
      }
      case 'leave': if (room) this.leave(p); return;
    }
    if (!room) return fail('NOT_IN_ROOM');
    switch (msg.t) {
      case 'setup': {
        if (room.phase !== 'lobby') return;
        if (D.CARS[msg.car] && D.CAR_ORDER.includes(msg.car)) p.car = msg.car;
        if (Array.isArray(msg.skills) && msg.skills.length === 2 && msg.skills.every(s => D.SKILLS[s]) && msg.skills[0] !== msg.skills[1]) p.skills = msg.skills.slice();
        if (msg.cos && typeof msg.cos === 'object') {
          const cos = {};
          for (const k of Object.keys(D.COSMETICS)) if (D.COSMETICS[k].some(c => c.id === msg.cos[k])) cos[k] = msg.cos[k];
          p.cos = cos;
        }
        this.sendRoom(room); return;
      }
      case 'ready': if (room.phase === 'lobby') { p.ready = !!msg.v; this.sendRoom(room); } return;
      case 'settings': {
        if (room.host !== p.id) return fail('NOT_HOST');
        if (room.phase !== 'lobby') return;
        const s = room.settings;
        if (D.TRACK_ORDER.includes(msg.track)) s.track = msg.track;
        if (D.RULES.lapsChoices.includes(+msg.laps)) s.laps = +msg.laps;
        if (typeof msg.skills === 'boolean') s.skills = msg.skills;
        if (typeof msg.aiFill === 'boolean') s.aiFill = msg.aiFill;
        if (D.DIFFICULTY[msg.aiDiff]) s.aiDiff = msg.aiDiff;
        for (const q of room.players) if (q.id !== room.host) q.ready = false; // 規則改變後需重新確認
        this.sendRoom(room); return;
      }
      case 'start': {
        if (room.host !== p.id) return fail('NOT_HOST');
        if (room.phase !== 'lobby') return;
        if (room.players.some(q => q.id !== room.host && q.connected && !q.ready)) return fail('NOT_READY');
        this.startRace(room); return;
      }
      case 'in': {
        if (room.phase !== 'racing') return;
        const seq = msg.seq | 0;
        if (seq <= p.lastSeq) return; // 重送或亂序封包忽略
        p.lastSeq = seq;
        const clamp = (v, a, b) => (typeof v === 'number' && isFinite(v)) ? Math.max(a, Math.min(b, v)) : 0;
        p.queue.push({ seq, throttle: clamp(msg.th, 0, 1), brake: clamp(msg.br, 0, 1), steer: clamp(msg.st, -1, 1), s1: !!msg.s1, s2: !!msg.s2 });
        if (p.queue.length > 30) p.queue.splice(0, p.queue.length - 30);
        return;
      }
      case 'rematch': {
        if (room.host !== p.id) return fail('NOT_HOST');
        if (room.phase !== 'results') return;
        room.phase = 'lobby'; room.race = null; room.results = null; room.cloud = null;
        // 結算時已離開的人移出
        room.players = room.players.filter(q => q.connected || (this.now() - q.discAt) < this.opts.grace);
        for (const q of room.players) q.ready = false;
        this.sendRoom(room); return;
      }
    }
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }
  addToRoom(room, p) {
    p.room = room.code; p.ready = false; p.queue = []; p.held = null; p.lastSeq = 0; p.ack = 0;
    room.players.push(p); room.emptySince = null;
    this.sendRoom(room);
  }
  leave(p) {
    const room = this.rooms.get(p.room); p.room = null; p.ready = false;
    if (!room) return;
    room.players = room.players.filter(q => q !== p);
    const e = room.race && room.race.get(p.id);
    if (e && !e.finished) { e.dnf = true; e.disconnected = true; }
    if (room.host === p.id) this.transferHost(room);
    if (!room.players.some(q => q.connected)) { this.rooms.delete(room.code); this.opts.log(`關閉房間 ${room.code}`); return; }
    this.sendRoom(room);
  }
  transferHost(room) {
    const next = room.players.find(q => q.connected && q.id !== room.host);
    if (next) { room.host = next.id; next.ready = false; this.opts.log(`房間 ${room.code} 房主移交給 ${next.name}`); }
  }

  roomView(room) {
    return { code: room.code, host: room.host, phase: room.phase, max: MAX, settings: room.settings,
      players: room.players.map(q => ({ id: q.id, name: q.name, car: q.car, skills: q.skills, cos: q.cos, ready: q.ready, connected: q.connected })) };
  }
  sendRoom(room) { const m = { t: 'room', room: this.roomView(room) }; for (const q of room.players) q.send && q.connected && q.send(m); }
  broadcast(room, m) { for (const q of room.players) if (q.connected) q.send(m); }

  /* ---------- 比賽 ---------- */
  startRace(room) {
    const s = room.settings;
    const race = new Race({ trackId: s.track, laps: s.laps, skills: s.skills });
    const grid = [];
    for (const q of room.players.filter(q => q.connected)) {
      const e = race.addCar({ id: q.id, name: q.name, carId: q.car, skills: q.skills, cos: q.cos, human: true });
      grid.push({ id: q.id, slot: e.slot, name: q.name, car: q.car, skills: q.skills, cos: q.cos, ai: false });
      q.queue = []; q.held = null; q.lastSeq = 0; q.ack = 0;
    }
    if (s.aiFill) {
      const names = ['阿凱', '小雨', '老周', '米亞', '阿哲', '柚子', '黑貓', '阿光'];
      let k = 0;
      while (race.cars.length < MAX) {
        const id = 'ai' + k, car = D.CAR_ORDER[k % 4], skills = [D.SKILL_ORDER[k % 3], D.SKILL_ORDER[(k + 1) % 3]];
        const e = race.addCar({ id, name: names[k] + '（AI）', carId: car, skills, ai: s.aiDiff, cos: { trail: 'neon' } });
        grid.push({ id, slot: e.slot, name: names[k] + '（AI）', car, skills, cos: { trail: 'neon' }, ai: true });
        k++;
      }
    }
    room.race = race; room.grid = grid; room.phase = 'racing'; room.tick = 0; room.results = null; room.cloud = null;
    this.sendRoom(room);
    this.broadcast(room, this.startMsg(room));
    this.opts.log(`房間 ${room.code} 開賽：${D.TRACKS[s.track].name}，${grid.length} 台`);
  }
  startMsg(room) { return { t: 'start', raceId: room.race.raceId, settings: room.settings, grid: room.grid, trackId: room.settings.track }; }

  /** 每 1/60 秒呼叫一次 */
  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      // 斷線逾時處理
      for (const q of room.players.slice()) {
        if (q.connected || now - q.discAt < this.opts.grace) continue;
        const e = room.race && room.race.get(q.id);
        if (e && !e.finished && !e.dnf) e.dnf = true; // 逾時標記未完賽
        if (room.phase !== 'racing') { room.players = room.players.filter(x => x !== q); q.room = null; this.byToken.delete(q.token); this.sendRoom(room); }
      }
      if (!room.players.some(q => q.connected)) {
        if (room.emptySince == null) room.emptySince = now;
        if (now - room.emptySince > this.opts.grace) { this.rooms.delete(room.code); this.opts.log(`關閉空房間 ${room.code}`); continue; }
      } else room.emptySince = null;
      if (room.phase !== 'racing') continue;
      this.stepRoom(room);
    }
  }

  stepRoom(room) {
    const race = room.race;
    for (const q of room.players) {
      const e = race.get(q.id); if (!e) continue;
      if (!q.connected) { e.disconnected = true; continue; }
      e.disconnected = false;
      if (q.queue.length > 8) q.queue.splice(0, q.queue.length - 4); // 延遲累積時追上
      const inp = q.queue.shift();
      if (inp) { q.ack = inp.seq; q.held = inp; race.setInput(q.id, inp); }
      else if (q.held) race.setInput(q.id, Object.assign({}, q.held, { s1: false, s2: false }));
    }
    const ev = race.step();
    room.tick++;
    if (ev.length) {
      const pub = ev.filter(x => x.type === 'go' || x.type === 'finish');
      for (const q of room.players) {
        if (!q.connected) continue;
        const list = ev.filter(x => x.id === q.id || x.type === 'go' || (x.type === 'finish' && x.id !== q.id));
        if (list.length) q.send({ t: 'ev', list });
      }
      void pub;
    }
    if (room.tick % SNAP_EVERY === 0) for (const q of room.players) if (q.connected) this.sendSnap(room, q);
    if (race.phase === 'done') this.finishRace(room);
  }

  compactCars(race) {
    return race.cars.map(e => {
      const c = e.car;
      return { id: e.id, x: r1(c.x), y: r1(c.y), a: r3(c.a), vx: r1(c.vx), vy: r1(c.vy), b: c.brakeLight ? 1 : 0, n: c.fx.nitro > 0 ? 1 : 0,
        g: c.fx.grip > 0 ? 1 : 0, sl: r3(c.slip), sf: c.surf, lap: e.lapsDone, cp: e.cp, ls: e.lapStart, rk: e.rank,
        fin: e.finished, dnf: e.dnf, dc: e.disconnected, gh: race.ghosted(e) };
    });
  }
  sendSnap(room, q) {
    const race = room.race, e = race.get(q.id);
    const c = e && e.car;
    q.send({ t: 's', raceId: race.raceId, st: this.now(), phase: race.phase, cd: race.countdown, time: race.time,
      deadline: race.deadline, ack: q.ack, cars: room._snapCars && room._snapTick === room.tick ? room._snapCars : (room._snapTick = room.tick, room._snapCars = this.compactCars(race)),
      me: c ? { x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, av: c.av, steer: c.steer, idx: c.idx, lat: c.lat, surf: c.surf, slip: c.slip,
        energy: c.energy, skills: c.skills.map(s => ({ id: s.id, cd: s.cd })), fx: Object.assign({}, c.fx), rc: Object.assign({}, c.rc),
        charged: c.charged, bump: c.bump, brakeLight: c.brakeLight } : null });
  }

  /** 個人化結算：只附上自己的雲端帳號結果，不會看到別人的帳號資料 */
  sendResults(room, q) {
    q.send(Object.assign({}, room.results, { cloud: (room.cloud && room.cloud[q.id]) || null }));
  }

  /** 結算：每場只計算一次經驗值，重連時重送同一份結果 */
  finishRace(room) {
    const race = room.race, st = race.standings();
    const n = st.length, xp = {};
    for (const s of st) {
      if (!s.human) continue;
      const parts = [];
      if (s.finished) {
        parts.push({ label: '完賽', xp: D.XP.finish });
        if (s.rank <= 3) parts.push({ label: `第 ${s.rank} 名`, xp: D.XP.podiumBonus[s.rank - 1] });
        if (n - s.rank > 0) parts.push({ label: `贏過 ${n - s.rank} 台車`, xp: (n - s.rank) * D.XP.perPositionAhead });
      }
      xp[s.id] = parts;
    }
    room.results = { t: 'results', raceId: race.raceId, trackId: room.settings.track,
      standings: st.map(s => ({ id: s.id, name: s.name, car: s.carId, human: s.human, rank: s.rank, finished: s.finished, dnf: s.dnf, time: s.time, lapTimes: s.lapTimes, best: s.best })), xp };
    // 已登入的車手：由伺服器把正式結果寫入資料庫（帳號 ID＋比賽 ID 唯一，只會發一次）
    room.cloud = {};
    const store = this.opts.store;
    for (const s of st) {
      if (!s.human) continue;
      const q = room.players.find(x => x.id === s.id);
      if (!q || !q.accountId || !store) continue;
      try { room.cloud[q.id] = store.grant(q.accountId, race.raceId, 'mp', xp[s.id], room.settings.track, s.finished); }
      catch (e) { this.opts.log('寫入經驗值失敗', e); room.cloud[q.id] = { granted: false, error: 'SERVER' }; }
    }
    room.phase = 'results';
    for (const q of room.players) if (q.connected) this.sendResults(room, q);
    this.sendRoom(room);
    this.opts.log(`房間 ${room.code} 結算完成`);
  }
}

module.exports = { Hub, ERR, MAX };
