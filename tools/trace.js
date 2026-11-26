// 開發輔助：追蹤單台 AI 車前幾秒的狀態
const D = require('../public/shared/data.js');
const { Race } = require('../public/shared/sim.js');
const fs = require('fs');
const [trackId = 'city', carId = 'shadow', secs = '4'] = process.argv.slice(2);
const r = new Race({ trackId, laps: 3, skills: false });
const e = r.addCar({ id: 'a', carId, ai: 'hard' });
const out = [];
let n = 0;
while (r.phase === 'countdown') r.step();
while (r.time < +secs) {
  r.step(); n++;
  if (n % 6 === 0) {
    const c = e.car;
    out.push(`t=${r.time.toFixed(2)} idx=${c.idx} lat=${c.lat.toFixed(0)} sp=${Math.hypot(c.vx, c.vy).toFixed(0)} a=${c.a.toFixed(2)} av=${c.av.toFixed(2)} slip=${c.slip.toFixed(2)} steer=${c.steer.toFixed(2)} surf=${c.surf} ai=${JSON.stringify(e.brain.dbg, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)} in=${JSON.stringify(e.input)}`);
  }
}
fs.writeFileSync(__dirname + '/trace.txt', out.join('\n') + '\n');
