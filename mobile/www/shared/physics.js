/* 霓虹夜行：車輛物理與技能規則（單機、電腦車手、伺服器共用，固定步長） */
(function (root, factory) {
  const mod = factory(root.NND ? root.NND.data : null);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.NND = root.NND || {}; root.NND.physics = mod; }
})(typeof self !== 'undefined' ? self : this, function (dataMaybe) {
  'use strict';
  const D = dataMaybe || require('./data.js');
  const { SKILLS, ENERGY } = D;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function createCar(slot, skills) {
    return {
      x: slot.x, y: slot.y, a: slot.a, vx: 0, vy: 0, av: 0, steer: 0,
      idx: slot.idx, lat: 0, surf: 'road', slip: 0, energy: ENERGY.start,
      skills: (skills || []).slice(0, 2).map(id => ({ id, cd: 0 })),
      fx: { nitro: 0, grip: 0, recharge: 0 }, rc: { phase: 0, v0: 0, turnT: 0 },
      charged: false, // 是否曾成功蓄能（用來顯示第一次提示）
      bump: 0, brakeLight: false
    };
  }

  /** 產生空白輸入 */
  function emptyInput() { return { throttle: 0, brake: 0, steer: 0, s1: false, s2: false }; }

  /** 嘗試施放技能。回傳事件或 null */
  function useSkill(car, slotIdx, opts) {
    if (opts && opts.skillsOff) return null;
    const slot = car.skills[slotIdx];
    if (!slot || slot.cd > 0) return null;
    const sk = SKILLS[slot.id];
    if (!sk || car.energy < sk.cost) return { type: 'skillFail', skill: slot.id };
    car.energy -= sk.cost;
    slot.cd = sk.cooldown;
    car.fx[slot.id] = sk.duration;
    if (slot.id === 'recharge') car.rc = { phase: 0, v0: 0, turnT: 0 };
    return { type: 'skill', skill: slot.id };
  }

  /**
   * 推進一個固定步長。
   * input：{throttle 0..1, brake 0..1, steer -1..1, s1, s2}（s1/s2 為「這一步按下」）
   * opts：{ skillsOff, frozen }
   * 回傳事件陣列。
   */
  function step(car, input, spec, track, dt, opts) {
    opts = opts || {};
    const ev = [];
    if (input.s1) { const e = useSkill(car, 0, opts); if (e) ev.push(e); }
    if (input.s2) { const e = useSkill(car, 1, opts); if (e) ev.push(e); }
    for (const s of car.skills) s.cd = Math.max(0, s.cd - dt);
    for (const k in car.fx) car.fx[k] = Math.max(0, car.fx[k] - dt);

    const throttle = clamp(+input.throttle || 0, 0, 1);
    const brake = clamp(+input.brake || 0, 0, 1);
    const steerIn = clamp(+input.steer || 0, -1, 1);

    // 路面
    const loc = track.locate(car.x, car.y, car.idx);
    car.idx = loc.i; car.lat = loc.lat;
    const surf = track.surface(loc.i, loc.lat);
    car.surf = surf.type;

    const nitro = car.fx.nitro > 0, gripSk = car.fx.grip > 0;
    let gripMul = 1, cap = spec.maxSpeed, drag = spec.drag, brakeMul = 1;
    let traction = 1;
    if (surf.type === 'wet') {
      const w = surf.wet, wg = 1 - w * (1 - spec.wetGrip); // 濕滑程度 0..1
      gripMul = gripSk ? 1 : wg; brakeMul = 1 - w * 0.45 * (1 - spec.wetGrip) - w * 0.15; traction = 1 - w * 0.55 * (1 - spec.wetGrip);
    }
    if (surf.type === 'grass') { gripMul = 0.75; cap = spec.offRoadCap; drag = spec.offRoadDrag; }
    if (gripSk) gripMul *= SKILLS.grip.gripMul;
    if (nitro) cap = (surf.type === 'grass' ? cap : cap * SKILLS.nitro.speedMul);

    const fxh = Math.cos(car.a), fyh = Math.sin(car.a);
    let fwd = car.vx * fxh + car.vy * fyh;
    let lat = -car.vx * fyh + car.vy * fxh;

    // 引擎推力：accelCurve 越大，接近極速時推力衰減越晚
    if (throttle > 0 && fwd > -20) {
      const r = clamp(fwd / cap, 0, 1);
      const acc = spec.accel * (nitro ? SKILLS.nitro.accelMul : 1) * (1 - Math.pow(r, spec.accelCurve + 1));
      fwd += acc * throttle * traction * dt;
    }
    // 煞車／倒車
    car.brakeLight = false;
    if (brake > 0) {
      if (fwd > 15) { fwd = Math.max(0, fwd - spec.brake * brakeMul * brake * dt); car.brakeLight = true; }
      else fwd = Math.max(-spec.maxSpeed * 0.25, fwd - spec.accel * 0.5 * brake * dt);
    }
    if (throttle > 0 && fwd < -20) fwd = Math.min(0, fwd + spec.brake * dt);
    // 阻力與滾動阻力
    fwd -= fwd * drag * dt;
    if (!throttle && !brake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 55 * dt);
    if (fwd > cap) fwd -= (fwd - cap) * Math.min(1, 2.5 * dt);
    if (surf.slope) fwd += surf.slope * dt * (fwd > 0 ? 1 : 0);

    // 側向抓地：有上限，超過即滑動；油門加轉向會讓後驅車車尾滑出
    const sp = Math.abs(fwd);
    const slide = spec.powerSlide * throttle * Math.abs(car.steer) * clamp(sp / 380, 0, 1);
    const gripRate = spec.grip * gripMul * (1 - slide) * (gripSk ? 1.4 : 1);
    const maxLat = spec.latAcc * gripMul * (1 - slide * 0.6) * dt;
    const dLat = Math.min(Math.abs(lat) * Math.min(1, gripRate * dt), maxLat);
    lat -= Math.sign(lat) * dLat;

    // 轉向慣性：輸入先帶動方向盤，再帶動車身角速度
    car.steer += (steerIn - car.steer) * Math.min(1, (Math.abs(steerIn) < 0.05 ? 14 : 9) * dt);
    const sf = clamp(sp / spec.steerRef, 0, 1) * (1 - spec.hsLoss * clamp(sp / spec.maxSpeed, 0, 1));
    const targetAv = car.steer * spec.steerRate * sf * (fwd >= -5 ? 1 : -1);
    car.av += (targetAv - car.av) * Math.min(1, spec.yawResp * Math.min(1, gripMul) * dt);
    // 滑動時車尾外甩（需反打方向修正）
    const slip = Math.atan2(lat, Math.max(sp, 40));
    car.slip = slip;
    car.av += -slip * spec.oversteer * clamp(sp / 300, 0, 1) * dt * 4 * (gripSk ? 0.3 : 1);
    car.av = clamp(car.av, -5, 5);

    car.vx = fxh * fwd - fyh * lat;
    car.vy = fyh * fwd + fxh * lat;
    const px = car.x, py = car.y;
    car.x += car.vx * dt; car.y += car.vy * dt;
    car.a += car.av * dt;
    if (car.a > Math.PI) car.a -= 2 * Math.PI; else if (car.a < -Math.PI) car.a += 2 * Math.PI;
    car.bump = Math.max(0, car.bump - dt);

    // 能量：乾淨過彎或受控甩尾，且必須沿賽道正向前進（原地打轉無效）
    if (!opts.skillsOff) {
      const p = track.pts[car.idx];
      const speed = Math.hypot(car.vx, car.vy);
      const along = speed > 1 ? (car.vx * p.tx + car.vy * p.ty) / speed : 0;
      const onRoad = surf.type !== 'grass' && car.bump <= 0;
      let gain = 0;
      if (onRoad && speed > 180 && along > 0.6) {
        const as = Math.abs(slip);
        if (as > 0.18 && as < 0.9 && Math.abs(car.av) > 0.4) gain = ENERGY.driftRate;
        else if (as <= 0.18 && Math.abs(car.av) > 0.5 && speed > 220) gain = ENERGY.cleanCornerRate;
      }
      if (gain) {
        const before = car.energy;
        car.energy = Math.min(ENERGY.max, car.energy + gain * dt);
        if (!car.charged && car.energy > before) { car.charged = true; ev.push({ type: 'firstCharge' }); }
      }
      // 電能回充：有效煞車入彎 → 轉彎 → 順利出彎
      if (car.fx.recharge > 0) {
        const rc = car.rc;
        if (surf.type === 'grass') rc.phase = 0;
        else if (rc.phase === 0) {
          if (brake > 0.5 && fwd > 200) { rc.phase = 1; rc.v0 = fwd; }
        } else if (rc.phase === 1) {
          if (rc.v0 - fwd > 60) { rc.phase = 2; rc.turnT = 0; }
          else if (!brake) rc.phase = 0;
        } else if (rc.phase === 2) {
          if (Math.abs(car.av) > 0.45) rc.turnT += dt;
          if (rc.turnT > 0.3 && Math.abs(car.av) < 0.35 && throttle > 0.5 && speed > 160 && along > 0.7) {
            car.energy = Math.min(ENERGY.max, car.energy + SKILLS.recharge.gain);
            car.fx.recharge = 0; rc.phase = 3;
            ev.push({ type: 'recharged' });
            if (!car.charged) { car.charged = true; ev.push({ type: 'firstCharge' }); }
          }
        }
      }
    }
    return { ev, px, py };
  }

  /** 由實際物理設定量測四項指標（直線測試） */
  function measure(spec) {
    const flat = { locate: () => ({ i: 0, lat: 0 }), surface: () => ({ type: 'road', slope: 0 }), pts: [{ tx: 1, ty: 0 }] };
    const dt = D.SIM_DT;
    let c = createCar({ x: 0, y: 0, a: 0, idx: 0 }, []), t = 0;
    const thr = { throttle: 1, brake: 0, steer: 0 };
    while (Math.hypot(c.vx, c.vy) < 400 && t < 20) { step(c, thr, spec, flat, dt, { skillsOff: true }); t += dt; }
    const t400 = t;
    for (let i = 0; i < 60 * 30; i++) step(c, thr, spec, flat, dt, { skillsOff: true });
    const top = Math.hypot(c.vx, c.vy);
    c = createCar({ x: 0, y: 0, a: 0, idx: 0 }, []); c.vx = 500;
    const x0 = c.x;
    while (c.vx > 5) step(c, { throttle: 0, brake: 1, steer: 0 }, spec, flat, dt, { skillsOff: true });
    const brakeDist = c.x - x0;
    return { top, t400, brakeDist, grip: spec.latAcc, wet: spec.wetGrip };
  }

  return { createCar, step, useSkill, emptyInput, measure, clamp };
});
