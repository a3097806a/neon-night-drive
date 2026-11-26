/* 霓虹夜行：多人連線用戶端（WebSocket、自動重連、時鐘同步、本車預測與他車插值） */
(function () {
  'use strict';
  const NND = window.NND;
  const P = NND.physics, T = NND.track, D = NND.data;

  /** 推導伺服器位址：設定檔 > 網址參數 > 同源；file:// 或 App 未設定時回傳 null */
  function serverUrl() {
    const q = new URLSearchParams(location.search).get('server');
    const cfg = (window.NND_CONFIG && window.NND_CONFIG.serverUrl) || '';
    let base = q || cfg;
    if (!base) {
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return null;
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
      base = location.origin;
    }
    return base.replace(/\/$/, '').replace(/^http/, 'ws') + '/ws';
  }
  function httpBase() {
    const ws = serverUrl();
    return ws ? ws.replace(/^ws/, 'http').replace(/\/ws$/, '') : null;
  }

  function token() {
    let t = sessionStorage.getItem('nnd.token');
    if (!t) {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      t = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('nnd.token', t);
    }
    return t;
  }

  function createClient() {
    const url = serverUrl();
    const h = {};
    const c = {
      url, status: url ? 'idle' : 'unavailable', latency: null, id: null, room: null,
      offset: 0, // serverTime - localTime
      on(type, fn) { (h[type] = h[type] || []).push(fn); },
      emit(type, data) { (h[type] || []).forEach(fn => fn(data)); },
      send(msg) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; },
      connect, close() { manual = true; if (ws) ws.close(); },
      /** 送出身分：分頁識別碼＋（若已登入）帳號登入憑證。登入或登出後重送即可切換身分 */
      rehello() {
        const acc = window.NND.account;
        c.send({ t: 'hello', token: token(), name, ver: D.GAME_VERSION, session: acc && acc.token ? acc.token : undefined });
      },
      serverNow() { return performance.now() + c.offset; }
    };
    let ws = null, retry = 0, manual = false, pingTimer = null;
    let name = '';

    function setStatus(s, detail) { c.status = s; c.emit('status', { status: s, detail }); }

    function connect(nick) {
      if (nick != null) name = nick;
      if (!url) { setStatus('unavailable'); return; }
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      manual = false;
      setStatus('connecting');
      try { ws = new WebSocket(url); } catch (e) { setStatus('offline', e.message); schedule(); return; }
      ws.onopen = () => {
        retry = 0; setStatus('online');
        c.rehello();
        ping(); clearInterval(pingTimer); pingTimer = setInterval(ping, 2000);
      };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'pong') {
          const now = performance.now(), rtt = now - m.c;
          c.latency = c.latency == null ? rtt : c.latency * 0.7 + rtt * 0.3;
          const off = m.s + rtt / 2 - now;
          c.offset = c.offset === 0 ? off : c.offset * 0.8 + off * 0.2;
          c.emit('status', { status: c.status });
          return;
        }
        if (m.t === 'welcome') c.id = m.id;
        if (m.t === 'room') c.room = m.room;
        c.emit(m.t, m);
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        setStatus(manual ? 'idle' : 'offline');
        if (!manual) schedule();
      };
      ws.onerror = () => {};
    }
    function schedule() {
      retry++;
      const wait = Math.min(8000, 500 * Math.pow(1.6, retry));
      setTimeout(() => { if (!manual) connect(); }, wait);
    }
    function ping() { c.send({ t: 'ping', c: performance.now() }); }
    return c;
  }

  /** 本車預測：送出輸入並立即在本地模擬，收到伺服器狀態後回溯重播未確認的輸入 */
  function createPredictor(trackId, carId, skillIds) {
    const track = T.get(D.TRACKS, trackId), spec = D.CARS[carId];
    const pending = [];
    let car = null, seq = 0, smooth = { x: 0, y: 0, a: 0 };
    return {
      get car() { return car; },
      get smooth() { return smooth; },
      reset(state) { car = Object.assign(P.createCar(track.grid[0], skillIds), state); pending.length = 0; },
      /** 每個固定步長呼叫一次；回傳要送給伺服器的封包 */
      step(input, active, skillsOff) {
        seq++;
        const pkt = { t: 'in', seq, th: input.throttle, br: input.brake, st: +input.steer.toFixed(3), s1: input.s1 ? 1 : 0, s2: input.s2 ? 1 : 0 };
        if (car && active) {
          pending.push({ seq, input: Object.assign({}, input) });
          if (pending.length > 240) pending.shift();
          P.step(car, input, spec, track, D.SIM_DT, { skillsOff });
        }
        smooth.x *= 0.85; smooth.y *= 0.85; smooth.a *= 0.85;
        return pkt;
      },
      /** 伺服器校正：以權威狀態為準，重播尚未確認的輸入 */
      reconcile(state, ack, skillsOff) {
        if (!car) { this.reset(state); return; }
        const ox = car.x, oy = car.y, oa = car.a;
        Object.assign(car, state);
        while (pending.length && pending[0].seq <= ack) pending.shift();
        for (const p of pending) P.step(car, p.input, spec, track, D.SIM_DT, { skillsOff });
        const ex = ox - car.x, ey = oy - car.y;
        if (ex * ex + ey * ey > 200 * 200) { smooth.x = smooth.y = smooth.a = 0; } // 差距過大直接跳到正確位置
        else { smooth.x += ex; smooth.y += ey; let da = oa - car.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; smooth.a += da; }
      }
    };
  }

  /** 他車插值：保留快照緩衝，以「伺服器時間 − 延遲」繪製 */
  function createInterpolator() {
    const buf = [];
    return {
      push(snap) { buf.push(snap); if (buf.length > 40) buf.shift(); },
      clear() { buf.length = 0; },
      sample(renderTime) {
        if (!buf.length) return null;
        let i = buf.length - 1;
        while (i > 0 && buf[i - 1].st > renderTime) i--;
        const b = buf[i], a = buf[i - 1] || b;
        if (renderTime >= b.st || a === b) return { cars: b.cars, t: 1, a: b, b };
        const t = Math.max(0, Math.min(1, (renderTime - a.st) / ((b.st - a.st) || 1)));
        const out = b.cars.map(cb => {
          const ca = a.cars.find(x => x.id === cb.id) || cb;
          let da = cb.a - ca.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          return Object.assign({}, cb, { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, a: ca.a + da * t });
        });
        return { cars: out, t, a, b };
      },
      get latest() { return buf[buf.length - 1] || null; }
    };
  }

  NND.net = { createClient, createPredictor, createInterpolator, serverUrl, httpBase, token };
})();
