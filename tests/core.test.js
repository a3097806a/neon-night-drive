'use strict';
// 核心規則測試：賽道幾何、計圈、防誤計、AI 完賽、車款差異
const test = require('node:test');
const assert = require('node:assert');
const D = require('../public/shared/data.js');
const T = require('../public/shared/track.js');
const P = require('../public/shared/physics.js');
const { Race } = require('../public/shared/sim.js');

const ALL = [...D.TRACK_ORDER, 'test'];

/** 以「瞬移」方式讓車沿指定點列移動並觸發檢查線判定 */
function moveAlong(race, e, pts) {
  const ev = [];
  race.phase = 'race';
  for (const [x, y] of pts) {
    const px = e.car.x, py = e.car.y;
    e.car.x = x; e.car.y = y;
    e.car.idx = race.track.locate(x, y, e.car.idx).i;
    race.time += D.SIM_DT;
    race.checkLines(e, px, py, ev);
  }
  return ev;
}
function centerPath(tr, fromIdx, count, dir, lat) {
  const out = [];
  for (let k = 1; k <= count; k++) {
    const i = ((fromIdx + dir * k) % tr.N + tr.N) % tr.N, p = tr.pts[i];
    out.push([p.x + p.nx * (lat || 0), p.y + p.ny * (lat || 0)]);
  }
  return out;
}

test('四張賽道（與試駕彎道）不會自我重疊', () => {
  for (const id of ALL) {
    const tr = T.get(D.TRACKS, id);
    const minGap = tr.width + 30;
    for (let i = 0; i < tr.N; i++) for (let j = i + 1; j < tr.N; j++) {
      const arc = Math.min(j - i, tr.N - (j - i)) * tr.ds;
      if (arc < tr.width * 3) continue;
      const d = Math.hypot(tr.pts[i].x - tr.pts[j].x, tr.pts[i].y - tr.pts[j].y);
      assert.ok(d >= minGap, `${id} 第 ${i} 與 ${j} 取樣點過近：${d.toFixed(0)} < ${minGap}`);
    }
  }
});

for (const id of D.TRACK_ORDER) {
  test(`${D.TRACKS[id].name}：沿中心線正向跑三圈恰好計三圈並完賽`, () => {
    const r = new Race({ trackId: id, laps: 3 });
    const e = r.addCar({ id: 'p', carId: 'swift', human: true });
    const ev = moveAlong(r, e, centerPath(r.track, e.car.idx, r.track.N * 3 + 40, 1));
    const laps = ev.filter(x => x.type === 'lap');
    assert.strictEqual(laps.length, 3);
    assert.ok(e.finished);
    assert.ok(ev.some(x => x.type === 'finish'));
  });

  test(`${D.TRACKS[id].name}：逆向行駛三圈不計圈`, () => {
    const r = new Race({ trackId: id, laps: 3 });
    const e = r.addCar({ id: 'p', carId: 'swift', human: true });
    const ev = moveAlong(r, e, centerPath(r.track, e.car.idx, r.track.N * 3 + 40, -1));
    assert.strictEqual(ev.filter(x => x.type === 'lap').length, 0);
    assert.strictEqual(e.lapsDone, 0);
  });

  test(`${D.TRACKS[id].name}：在起點線來回 30 次不計圈`, () => {
    const r = new Race({ trackId: id, laps: 3 });
    const e = r.addCar({ id: 'p', carId: 'swift', human: true });
    const tr = r.track, path = [];
    for (let n = 0; n < 30; n++) {
      path.push(...centerPath(tr, tr.N - 8, 16, 1));   // 越過起點線
      path.push(...centerPath(tr, 8, 16, -1));         // 倒車越回
    }
    const ev = moveAlong(r, e, path);
    assert.strictEqual(ev.filter(x => x.type === 'lap').length, 0);
    assert.ok(e.cp <= 1, '來回不得累積檢查線');
  });

  test(`${D.TRACKS[id].name}：從草地繞過檢查線不計圈`, () => {
    const r = new Race({ trackId: id, laps: 1 });
    const e = r.addCar({ id: 'p', carId: 'swift', human: true });
    const tr = r.track, skip = tr.cps[3].i, path = [];
    // 正向繞一圈，但在第 3 條檢查線附近改走草地（路面外 60px）
    for (let k = 1; k <= tr.N + 40; k++) {
      const i = (e.car.idx + k) % tr.N, p = tr.pts[i];
      const near = Math.abs(((i - skip + tr.N + tr.N / 2) % tr.N) - tr.N / 2) < 4;
      const lat = near ? tr.half + 60 : 0;
      path.push([p.x + p.nx * lat, p.y + p.ny * lat]);
    }
    const ev = moveAlong(r, e, path);
    assert.strictEqual(ev.filter(x => x.type === 'lap').length, 0);
    assert.ok(!e.finished);
  });
}

test('高雄港灣：直線切過髮夾彎（草地捷徑）不計圈', () => {
  const r = new Race({ trackId: 'harbor', laps: 1 });
  const e = r.addCar({ id: 'p', carId: 'swift', human: true });
  const tr = r.track;
  const a = Math.floor(tr.N * 0.47), b = Math.floor(tr.N * 0.60);
  const path = centerPath(tr, e.car.idx, ((a - e.car.idx) + tr.N) % tr.N, 1);
  const pa = tr.pts[a], pb = tr.pts[b];
  for (let t = 0; t <= 1; t += 0.02) path.push([pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t]);
  path.push(...centerPath(tr, b, tr.N - b + 30, 1));
  const ev = moveAlong(r, e, path);
  assert.strictEqual(ev.filter(x => x.type === 'lap').length, 0);
});

for (const id of D.TRACK_ORDER) {
  test(`${D.TRACKS[id].name}：四台車由 AI（困難）以實際物理完成三圈`, () => {
    for (const carId of D.CAR_ORDER) {
      const r = new Race({ trackId: id, laps: 3, skills: true });
      const e = r.addCar({ id: 'a', carId, ai: 'hard', skills: ['nitro', 'grip'] });
      let steps = 0, laps = 0;
      while (r.phase !== 'done' && steps < 60 * 400) {
        for (const x of r.step()) if (x.type === 'lap' && x.id === 'a') laps++;
        steps++;
      }
      assert.ok(e.finished, `${carId} 在 ${id} 未完賽（進度 ${e.cp}）`);
      assert.strictEqual(laps, 3);
      const offTime = e.finishTime;
      assert.ok(offTime > 20 && offTime < 300, `${carId} ${id} 時間異常 ${offTime}`);
    }
  });
}

test('完賽後成績鎖定，不再產生圈數事件', () => {
  const r = new Race({ trackId: 'city', laps: 1 });
  const e = r.addCar({ id: 'a', carId: 'swift', ai: 'hard' });
  r.addCar({ id: 'b', carId: 'swift', ai: 'easy' });
  let finishEv = 0, lapEvA = 0;
  for (let s = 0; s < 60 * 200; s++) for (const x of r.step()) {
    if (x.id === 'a' && x.type === 'finish') finishEv++;
    if (x.id === 'a' && x.type === 'lap') lapEvA++;
  }
  assert.strictEqual(finishEv, 1);
  assert.strictEqual(lapEvA, 1);
  const t = e.finishTime;
  for (let s = 0; s < 600; s++) r.step();
  assert.strictEqual(e.finishTime, t);
  assert.strictEqual(r.phase, 'done');
});

test('倒數結束前車輛不會移動、計時不會開始', () => {
  const r = new Race({ trackId: 'city', laps: 3 });
  const e = r.addCar({ id: 'p', carId: 'redline', human: true });
  const x0 = e.car.x, y0 = e.car.y;
  r.setInput('p', { throttle: 1 });
  for (let s = 0; s < 60 * 2.9; s++) { r.setInput('p', { throttle: 1 }); r.step(); }
  assert.strictEqual(r.phase, 'countdown');
  assert.strictEqual(e.car.x, x0); assert.strictEqual(e.car.y, y0);
  assert.strictEqual(r.time, 0);
});

test('四台車的實測指標彼此不同且符合定位', () => {
  const m = {};
  for (const id of D.CAR_ORDER) m[id] = P.measure(D.CARS[id]);
  console.log('實測指標', JSON.stringify(m, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
  assert.ok(m.redline.top > m.swift.top * 1.12, '赤線極速應明顯高於夜燕（至少 12%）');
  assert.ok(m.swift.t400 < m.redline.t400, '夜燕起步應快於赤線');
  assert.ok(m.mist.brakeDist < m.redline.brakeDist, '海霧煞車應短於赤線');
  assert.ok(D.CARS.mist.wetGrip > D.CARS.shadow.wetGrip, '海霧濕地抓地最好');
});

test('同一試駕彎道，四台車的過彎表現不同', () => {
  const res = {};
  for (const carId of D.CAR_ORDER) {
    const r = new Race({ trackId: 'test', laps: 1, skills: false });
    const e = r.addCar({ id: 'a', carId, ai: 'hard' });
    let maxSlip = 0, minSpeed = Infinity, steps = 0;
    while (!e.finished && steps < 60 * 120) {
      r.step(); steps++;
      if (r.phase === 'race' && r.time > 3) {
        maxSlip = Math.max(maxSlip, Math.abs(e.car.slip));
        minSpeed = Math.min(minSpeed, Math.hypot(e.car.vx, e.car.vy));
      }
    }
    assert.ok(e.finished, carId + ' 試駕未完成');
    res[carId] = { time: +e.finishTime.toFixed(2), maxSlip: +maxSlip.toFixed(3), minSpeed: Math.round(minSpeed) };
  }
  console.log('試駕彎道比較', JSON.stringify(res));
  const times = Object.values(res).map(v => v.time);
  assert.ok(new Set(times).size === 4, '四台車圈速應不同');
  assert.ok(res.shadow.maxSlip > res.mist.maxSlip, '墨影的車尾滑動應大於海霧');
});

test('原地打轉無法取得能量；受控過彎可以蓄能', () => {
  const tr = T.get(D.TRACKS, 'city');
  const car = P.createCar(tr.grid[0], ['nitro', 'grip']);
  car.energy = 10;
  for (let s = 0; s < 600; s++) P.step(car, { throttle: 1, brake: 0, steer: 1 }, D.CARS.shadow, tr, D.SIM_DT, {});
  // 原地打轉：低速或沒有沿賽道前進
  const spin = P.createCar(tr.grid[0], []); spin.energy = 10;
  for (let s = 0; s < 600; s++) { spin.vx = spin.vy = 0; P.step(spin, { throttle: 0.2, brake: 0, steer: 1 }, D.CARS.shadow, tr, D.SIM_DT, {}); }
  assert.ok(spin.energy <= 10.0001, '原地打轉不得增加能量：' + spin.energy);
  // AI 正常跑一圈應累積能量
  const r = new Race({ trackId: 'city', laps: 1 });
  const e = r.addCar({ id: 'a', carId: 'shadow', ai: 'hard', skills: ['recharge', 'grip'] });
  let first = 0;
  for (let s = 0; s < 60 * 60; s++) for (const x of r.step()) if (x.type === 'firstCharge') first++;
  assert.ok(first === 1, '第一次蓄能提示只出現一次');
});

test('技能：消耗、冷卻、能量不足時失敗', () => {
  const tr = T.get(D.TRACKS, 'city');
  const car = P.createCar(tr.grid[0], ['nitro', 'grip']);
  car.energy = 50;
  const ev1 = P.step(car, { throttle: 1, s1: true }, D.CARS.swift, tr, D.SIM_DT, {}).ev;
  assert.ok(ev1.some(e => e.type === 'skill'));
  assert.strictEqual(car.energy, 15);
  assert.ok(car.skills[0].cd > 0);
  const ev2 = P.step(car, { throttle: 1, s1: true }, D.CARS.swift, tr, D.SIM_DT, {}).ev;
  assert.ok(!ev2.some(e => e.type === 'skill'), '冷卻中不得再次施放');
  const ev3 = P.step(car, { throttle: 1, s2: true }, D.CARS.swift, tr, D.SIM_DT, {}).ev;
  assert.ok(ev3.some(e => e.type === 'skillFail'), '能量不足應失敗');
  assert.ok(car.energy <= D.ENERGY.max);
});
