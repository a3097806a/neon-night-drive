/* 霓虹夜行：比賽模擬（狀態機、檢查線計圈、碰撞、排名、完賽時限）
 * 單機與伺服器使用同一份程式。狀態：countdown → race → done
 */
(function (root, factory) {
  const N = root.NND || {};
  const mod = factory(N.data, N.track, N.physics, N.ai);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.NND = root.NND || {}; root.NND.sim = mod; }
})(typeof self !== 'undefined' ? self : this, function (Dm, Tm, Pm, Am) {
  'use strict';
  const D = Dm || require('./data.js');
  const T = Tm || require('./track.js');
  const P = Pm || require('./physics.js');
  const A = Am || require('./ai.js');
  const DT = D.SIM_DT;

  class Race {
    /**
     * opts：{ trackId, laps, skills(bool), countdown, ghostTime, finishTimeout, raceId }
     */
    constructor(opts) {
      this.opts = Object.assign({ laps: 3, skills: true, countdown: D.RULES.countdown,
        ghostTime: D.RULES.ghostTime, finishTimeout: D.RULES.finishTimeout }, opts);
      this.track = T.get(D.TRACKS, this.opts.trackId);
      this.K = this.track.cps.length;
      this.phase = 'countdown';
      this.countdown = this.opts.countdown;
      this.time = 0;           // 比賽經過時間（起跑後）
      this.tick = 0;
      this.cars = [];
      this.deadline = null;    // 第一名完賽後的截止時間
      this.raceId = this.opts.raceId || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    }

    /** 新增車輛。info：{ id, name, carId, skills, cos, ai: 'easy'|'normal'|'hard'|null, human } */
    addCar(info) {
      const slotN = this.cars.length;
      if (slotN >= this.track.grid.length) return null;
      const spec = D.CARS[info.carId] || D.CARS.swift;
      const skills = this.opts.skills ? (info.skills || []).filter(s => D.SKILLS[s]).slice(0, 2) : [];
      const e = {
        id: info.id, name: info.name, carId: spec.id, spec, cos: info.cos || {}, human: !!info.human,
        slot: slotN, car: P.createCar(this.track.grid[slotN], skills),
        brain: info.ai ? A.createBrain(info.ai, (slotN + 1) * 7919) : null,
        input: P.emptyInput(),
        cp: 0, lapsDone: 0, lapTimes: [], lapStart: 0, finished: false, finishTime: null,
        dnf: false, disconnected: false, rank: slotN + 1, progress: 0
      };
      this.cars.push(e);
      return e;
    }
    get(id) { return this.cars.find(c => c.id === id); }

    /** 設定輸入（s1/s2 為按下瞬間，會在下一步消耗） */
    setInput(id, inp) {
      const e = this.get(id); if (!e) return;
      const s1 = e.input.s1 || !!inp.s1, s2 = e.input.s2 || !!inp.s2;
      e.input = { throttle: +inp.throttle || 0, brake: +inp.brake || 0, steer: +inp.steer || 0, s1, s2 };
    }

    ghosted(e) { return this.phase !== 'race' || this.time < this.opts.ghostTime || e.finished || e.dnf || e.disconnected; }

    /** 推進一個固定步長，回傳事件 */
    step() {
      const ev = [];
      this.tick++;
      if (this.phase === 'countdown') {
        this.countdown -= DT;
        if (this.countdown <= 0) { this.phase = 'race'; this.time = 0; ev.push({ type: 'go' }); }
        return ev;
      }
      if (this.phase === 'done') {
        for (const e of this.cars) this.coast(e);
        return ev;
      }
      this.time += DT;
      const opts = { skillsOff: !this.opts.skills };
      for (const e of this.cars) {
        let inp = e.input;
        if (e.finished || e.dnf) inp = A.think(e.brain || (e.brain = A.createBrain('easy', e.slot + 1)), e.car, e.spec, this.track, DT, { cooldown: true, skillsOff: true });
        else if (e.brain && !e.human) inp = A.think(e.brain, e.car, e.spec, this.track, DT, { racing: true, skillsOff: opts.skillsOff });
        else if (e.disconnected) inp = { throttle: 0, brake: 0.6, steer: 0 };
        const r = P.step(e.car, inp, e.spec, this.track, DT, { skillsOff: opts.skillsOff || e.finished || e.dnf });
        e.input.s1 = false; e.input.s2 = false;
        for (const x of r.ev) { x.id = e.id; ev.push(x); }
        if (!e.finished && !e.dnf) this.checkLines(e, r.px, r.py, ev);
      }
      this.collide();
      this.rankCars();
      // 第一名完賽後的時限
      if (this.deadline != null && this.time >= this.deadline) {
        for (const e of this.cars) if (!e.finished && !e.dnf) { e.dnf = true; ev.push({ type: 'dnf', id: e.id }); }
      }
      if (this.cars.length && this.cars.every(e => e.finished || e.dnf)) {
        this.phase = 'done'; this.rankCars(); ev.push({ type: 'done' });
      }
      return ev;
    }

    coast(e) {
      P.step(e.car, { throttle: 0, brake: 0.4, steer: 0 }, e.spec, this.track, DT, { skillsOff: true });
    }

    /** 實體檢查線：必須依序、由正向穿越；反向穿越會撤銷上一條 */
    checkLines(e, px, py, ev) {
      const c = e.car, K = this.K, mx = c.x - px, my = c.y - py;
      if (mx === 0 && my === 0) return;
      const nextK = e.cp % K, prevK = (e.cp - 1 + K) % K;
      const tryLine = k => {
        const L = this.track.cps[k];
        return T.segCross(px, py, c.x, c.y, L.ax, L.ay, L.bx, L.by) ? (mx * L.tx + my * L.ty) : 0;
      };
      const fwd = tryLine(nextK);
      if (fwd > 0) {
        e.cp++;
        if (nextK === 0 && e.cp > 1) {
          const laps = Math.floor((e.cp - 1) / K);
          if (laps > e.lapsDone) {
            e.lapsDone = laps;
            const lt = this.time - e.lapStart;
            e.lapTimes.push(lt); e.lapStart = this.time;
            ev.push({ type: 'lap', id: e.id, lap: laps, time: lt });
            if (laps >= this.opts.laps) {
              e.finished = true; e.finishTime = this.time;
              ev.push({ type: 'finish', id: e.id, time: this.time });
              if (this.deadline == null) this.deadline = this.time + this.opts.finishTimeout;
            }
          }
        } else if (nextK !== 0) ev.push({ type: 'cp', id: e.id, k: nextK, of: K });
        return;
      }
      if (e.cp > 0 && tryLine(prevK) < 0) { e.cp--; ev.push({ type: 'cpBack', id: e.id }); }
    }

    collide() {
      const cs = this.cars;
      for (let i = 0; i < cs.length; i++) {
        const A1 = cs[i]; if (this.ghosted(A1)) continue;
        for (let j = i + 1; j < cs.length; j++) {
          const B = cs[j]; if (this.ghosted(B)) continue;
          const a = A1.car, b = B.car, dx = b.x - a.x, dy = b.y - a.y;
          const r = A1.spec.radius + B.spec.radius, d2 = dx * dx + dy * dy;
          if (d2 >= r * r || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = r - d;
          const ma = A1.spec.mass, mb = B.spec.mass, tot = ma + mb;
          a.x -= nx * over * mb / tot; a.y -= ny * over * mb / tot;
          b.x += nx * over * ma / tot; b.y += ny * over * ma / tot;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const jimp = -(1.3) * rv / (1 / ma + 1 / mb);
            a.vx -= jimp * nx / ma; a.vy -= jimp * ny / ma;
            b.vx += jimp * nx / mb; b.vy += jimp * ny / mb;
          }
          a.bump = b.bump = 0.4;
        }
      }
    }

    /** 進度：已通過檢查線數 + 到下一條線的比例 */
    progressOf(e) {
      const tr = this.track, K = this.K;
      const L0 = tr.cps[(e.cp - 1 + K) % K], L1 = tr.cps[e.cp % K];
      const s = tr.pts[e.car.idx].s;
      let span = (L1.s - L0.s + tr.length) % tr.length || tr.length;
      let at = (s - L0.s + tr.length) % tr.length;
      if (e.cp === 0) { span = tr.length; at = 0; }
      const frac = Math.min(0.999, Math.max(0, at > span + 200 ? 0 : at / span));
      return e.cp + frac;
    }

    rankCars() {
      for (const e of this.cars) e.progress = this.progressOf(e);
      const sorted = this.cars.slice().sort((a, b) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished) return a.finishTime - b.finishTime;
        if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
        return b.progress - a.progress;
      });
      sorted.forEach((e, n) => { e.rank = n + 1; });
      return sorted;
    }

    standings() {
      return this.rankCars().map(e => ({ id: e.id, name: e.name, carId: e.carId, human: e.human, rank: e.rank,
        finished: e.finished, dnf: e.dnf, time: e.finishTime, lapTimes: e.lapTimes.slice(),
        best: e.lapTimes.length ? Math.min(...e.lapTimes) : null }));
    }
  }

  return { Race, DT };
});
