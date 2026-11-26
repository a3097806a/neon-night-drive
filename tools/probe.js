// 開發輔助：統計各車在各賽道的 AI 表現（完賽時間、離開路面時間、最大滑動、卡住次數）
const D = require('../public/shared/data.js');
const { Race } = require('../public/shared/sim.js');
const fs = require('fs');
const out = [];
const diff = process.argv[2] || 'hard';
for (const id of [...D.TRACK_ORDER, 'test']) {
  for (const carId of D.CAR_ORDER) {
    const r = new Race({ trackId: id, laps: id === 'test' ? 1 : 3, skills: false });
    const e = r.addCar({ id: 'a', carId, ai: diff });
    let off = 0, maxSlip = 0, steps = 0, stuck = 0, worst = null;
    while (r.phase !== 'done' && steps < 60 * 400) {
      r.step(); steps++;
      if (r.phase === 'race') {
        if (e.car.surf === 'grass') { off += D.SIM_DT; if (!worst) worst = { idx: e.car.idx, frac: +(e.car.idx / r.track.N).toFixed(3) }; }
        maxSlip = Math.max(maxSlip, Math.abs(e.car.slip));
        if (e.brain.reverse > 1.05) stuck++;
      }
    }
    out.push(`${id.padEnd(10)} ${carId.padEnd(8)} fin=${e.finished ? e.finishTime.toFixed(1) : 'NO cp=' + e.cp} laps=${e.lapTimes.map(t => t.toFixed(1)).join('/')} off=${off.toFixed(1)}s slip=${maxSlip.toFixed(2)} stuck=${stuck} firstOff=${JSON.stringify(worst)}`);
  }
}
fs.writeFileSync(__dirname + '/probe-' + diff + '.txt', out.join('\n') + '\n');
