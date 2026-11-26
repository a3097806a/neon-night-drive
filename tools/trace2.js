// 開發輔助：只記錄指定索引範圍內的狀態
const { Race } = require('../public/shared/sim.js');
const fs = require('fs');
const [trackId, carId, from, to, secs = '60'] = process.argv.slice(2);
const r = new Race({ trackId, laps: 3, skills: false });
const e = r.addCar({ id: 'a', carId, ai: 'hard' });
const out = [];
let n = 0;
while (r.time < +secs && r.phase !== 'done') {
  r.step(); n++;
  const c = e.car;
  if (n % 3 === 0 && c.idx >= +from && c.idx <= +to) {
    const p = r.track.pts[c.idx];
    out.push(`t=${r.time.toFixed(2)} idx=${c.idx} lat=${c.lat.toFixed(0)} sp=${Math.hypot(c.vx, c.vy).toFixed(0)} curv=${(p.curvS * 1000).toFixed(2)} av=${c.av.toFixed(2)} slip=${c.slip.toFixed(2)} steer=${c.steer.toFixed(2)} surf=${c.surf} in=${e.brain.dbg ? e.brain.dbg.steer.toFixed(2) : ''} th=${JSON.stringify(e.brain.last || '')}`);
  }
}
fs.writeFileSync(__dirname + '/trace2.txt', out.slice(0, 120).join('\n') + '\n');
