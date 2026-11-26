/* 霓虹夜行：電腦車手。只產生與玩家相同格式的輸入，再交給共用物理 */
(function (root, factory) {
  const mod = factory(root.NND ? root.NND.data : null);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.NND = root.NND || {}; root.NND.ai = mod; }
})(typeof self !== 'undefined' ? self : this, function (dataMaybe) {
  'use strict';
  const D = dataMaybe || require('./data.js');
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  /** 控制器參數（由 tools/tune.js 搜尋得出） */
  const TUNE = { pred: 0.32, gain: 1.5, cross: 1.0, lag: 0 };
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  /** 每台車在賽道上的安全彎速（依車輛側向抓地上限） */
  const speedCache = new Map();
  function safeSpeeds(track, spec) {
    const key = track.id + '|' + spec.id;
    if (speedCache.has(key)) return speedCache.get(key);
    const arr = track.pts.map((p, i) => {
      const wet = track.zoneIdx[i].reduce((m, z) => z.type === 'wet' ? Math.max(m, z.level == null ? 1 : z.level) : m, 0);
      const g = spec.latAcc * (1 - wet * (1 - spec.wetGrip)) * 0.92;
      const k = Math.max(Math.abs(p.curvS), 1e-5);
      // 轉向能力上限：曲率 × 車速 ≤ 最大轉向角速度（高速時轉向衰減）
      const steerV = 0.9 * spec.steerRate / (k + spec.steerRate * spec.hsLoss / spec.maxSpeed);
      return Math.min(spec.maxSpeed, Math.sqrt(g / k) * 1.05, steerV);
    });
    speedCache.set(key, arr);
    return arr;
  }

  /** 建立電腦車手狀態。rand 為可重現的亂數函式 */
  function createBrain(diffId, seed) {
    let s = (seed >>> 0) || 1;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    return { diff: D.DIFFICULTY[diffId] || D.DIFFICULTY.normal, rand, phase: rand() * 6.28,
      mistake: 0, mistakeSteer: 0, stuck: 0, reverse: 0, t: 0 };
  }

  /** 計算下一步輸入 */
  function think(brain, car, spec, track, dt, opts) {
    opts = opts || {};
    const dif = brain.diff, N = track.N, ds = track.ds;
    brain.t += dt;
    const sp = Math.hypot(car.vx, car.vy);
    const spd = safeSpeeds(track, spec);
    const slow = opts.cooldown ? 0.45 : 1;

    // 卡住時倒車脫困
    if (brain.reverse > 0) {
      brain.reverse -= dt;
      const p = track.pts[car.idx];
      const want = Math.atan2(p.ty, p.tx);
      return { throttle: 0, brake: 1, steer: -clamp(angDiff(want, car.a) * 2, -1, 1), s1: false, s2: false };
    }
    if (sp < 25 && opts.racing) { brain.stuck += dt; if (brain.stuck > 1.5) { brain.stuck = 0; brain.reverse = 1.1; } }
    else brain.stuck = 0;

    // 目標點：前方取樣點加上賽車線偏移（彎內側）與難度造成的路線誤差
    // 路徑追蹤：曲率前饋 + 方向誤差 + 橫向誤差（Stanley 控制器），以速度方向計算，打滑時自然反打
    const look = Math.round((20 + sp * 0.18) / ds);
    const ti = (car.idx + look) % N, tp = track.pts[ti];
    const inside = clamp(tp.curvS * 450, -1, 1) * track.half * 0.35;
    const noise = Math.sin(brain.t * 0.7 + brain.phase) * dif.lineNoise;
    const targetLat = clamp(inside + noise, -track.half * 0.7, track.half * 0.7);
    const K = brain.k || (brain.k = { pred: TUNE.pred, gain: TUNE.gain, cross: TUNE.cross, lag: TUNE.lag });
    // 車身反應越慢（yawResp、grip 越低），控制增益越低，避免擺盪
    const lag = 1 / spec.yawResp + 1 / spec.grip;
    const gainMul = 1 / (1 + K.lag * lag * 10);
    const heading = (sp > 60 ? Math.atan2(car.vy, car.vx) : car.a) + car.av * K.pred;
    const headErr = angDiff(Math.atan2(tp.ty, tp.tx), heading);
    const crossErr = car.lat - targetLat;
    const desired = clamp(headErr - Math.atan2(K.cross * crossErr, sp + 80), -1.2, 1.2);
    const sf = clamp(sp / spec.steerRef, 0.15, 1) * (1 - spec.hsLoss * clamp(sp / spec.maxSpeed, 0, 1));
    const maxAv = spec.steerRate * sf;
    const wantAv = tp.curvS * sp + desired * dif.steerGain * K.gain * gainMul;
    let steer = clamp(wantAv / maxAv, -1, 1);
    brain.dbg = { headErr, crossErr, wantAv, maxAv, steer, ti };

    // 煞車點：在煞車距離內找出最低安全速度
    const decel = spec.brake * 0.75;
    let target = spec.maxSpeed;
    const range = Math.round(((sp * sp) / (2 * decel) * dif.brakeEarly + 60) / ds);
    for (let k = 1; k <= range; k++) {
      const j = (car.idx + k) % N, dist = k * ds;
      const v = spd[j] * dif.speedMul * slow;
      const allowed = Math.sqrt(v * v + 2 * decel * Math.max(0, dist - 40) / dif.brakeEarly);
      if (allowed < target) target = allowed;
    }
    target = Math.min(target, spd[car.idx] * dif.speedMul * slow + 30);

    // 隨機失誤
    if (brain.mistake > 0) { brain.mistake -= dt; steer = clamp(steer + brain.mistakeSteer, -1, 1); target *= 1.15; }
    else if (opts.racing && brain.rand() < dif.mistakeRate * dt * 10) { brain.mistake = 0.5; brain.mistakeSteer = (brain.rand() - 0.5) * 1.4; }

    let throttle = 0, brake = 0;
    if (sp > target + 25) brake = 1;
    else if (sp < target) throttle = 1;
    else throttle = 0.3;
    if (car.surf === 'grass') { throttle = Math.min(throttle, 0.7); }

    // 技能
    let s1 = false, s2 = false;
    if (opts.racing && !opts.skillsOff && !opts.cooldown && brain.rand() < dif.skillUse * dt * 3) {
      car.skills.forEach((sk, n) => {
        const S = D.SKILLS[sk.id];
        if (sk.cd > 0 || car.energy < S.cost) return;
        let want = false;
        if (sk.id === 'nitro') want = target > sp + 120 && Math.abs(steer) < 0.25;
        else if (sk.id === 'grip') want = Math.abs(car.slip) > 0.3 || car.surf === 'wet';
        else if (sk.id === 'recharge') want = brake > 0 && sp > 250;
        if (want) { if (n === 0) s1 = true; else s2 = true; }
      });
    }
    return { throttle, brake, steer, s1, s2 };
  }

  return { createBrain, think, safeSpeeds, TUNE };
});
