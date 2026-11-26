// 開發輔助：網格搜尋 AI 控制器參數，評分＝四車在四賽道的離開路面時間與完賽時間
const D = require('../public/shared/data.js');
const A = require('../public/shared/ai.js');
const { Race } = require('../public/shared/sim.js');
const fs = require('fs');

function score(params, laps) {
  Object.assign(A.TUNE, params);
  let total = 0, fails = 0, offT = 0;
  for (const id of [...D.TRACK_ORDER, 'test']) for (const carId of D.CAR_ORDER) {
    const r = new Race({ trackId: id, laps: id === 'test' ? 1 : laps, skills: false });
    const e = r.addCar({ id: 'a', carId, ai: 'hard' });
    let steps = 0, off = 0;
    while (r.phase !== 'done' && steps < 60 * 150 * laps) {
      r.step(); steps++;
      if (e.car.surf === 'grass' && r.phase === 'race') off += D.SIM_DT;
    }
    if (!e.finished) fails++;
    offT += off;
    total += e.finished ? e.finishTime : 400;
  }
  return { total, fails, offT };
}
const out = [];
let best = null;
for (const pred of [0.25, 0.32, 0.4]) for (const gain of [1.1, 1.5, 2.0]) for (const cross of [0.6, 1.0, 1.5]) for (const lag of [0]) {
  const p = { pred, gain, cross, lag };
  const s = score(p, 1);
  const line = JSON.stringify(p) + ' ' + JSON.stringify({ total: +s.total.toFixed(1), fails: s.fails, off: +s.offT.toFixed(1) });
  out.push(line);
  const val = s.total + s.offT * 5;
  if (!best || val < best.val) best = { val, p, s };
  fs.writeFileSync(__dirname + '/tune.txt', out.join('\n') + '\nBEST ' + JSON.stringify(best) + '\n');
}
out.push('DONE');
fs.writeFileSync(__dirname + '/tune.txt', out.join('\n') + '\nBEST ' + JSON.stringify(best) + '\n');
