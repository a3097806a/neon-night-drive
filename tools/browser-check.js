'use strict';
// 瀏覽器端實測（Chrome 無頭模式 + puppeteer-core）：前端錯誤、單機、背景暫停、觸控多指、經驗值、多人兩個瀏覽器
// 用法：npm install --no-save puppeteer-core && node tools/browser-check.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { createServer } = require('../server/server.js');

const OUT = path.join(__dirname, 'browser');
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, detail) => { log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '：' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

(async () => {
  const app = await createServer({ port: 0, host: '127.0.0.1', log: () => {} });
  const base = `http://127.0.0.1:${app.port}`;
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  };
  try {
    /* ---------- 1. 桌機：舊紀錄、選單 ---------- */
    const ctxA = await browser.createBrowserContext();
    const a = await ctxA.newPage(); watch(a, 'A');
    await a.setViewport({ width: 1366, height: 768 });
    await a.evaluateOnNewDocument(() => { if (!localStorage.getItem('neonNightDrive.save')) localStorage.setItem('neonNightDriveBest', '83.45'); });
    await a.goto(base + '/', { waitUntil: 'networkidle0' });
    await sleep(800);
    const legacy = await a.$eval('#legacyNote', e => e.textContent);
    ok('原版舊紀錄讀取並顯示為「舊版霓虹市區」', /舊版霓虹市區 1:23\.45/.test(legacy), legacy);
    await a.screenshot({ path: path.join(OUT, '01-menu.png') });
    ok('APK 檔案不存在時不顯示下載按鈕', await a.$eval('#apkBtn', e => e.classList.contains('hidden')));

    /* ---------- 2. 車庫與試駕 ---------- */
    await a.click('[data-go="garage"]'); await sleep(400);
    const stats = await a.$$eval('.carcard .stat span:last-child', els => els.map(e => e.textContent));
    ok('車庫顯示四台車的實測指標', stats.length === 16, stats.slice(0, 4).join(' / '));
    await a.screenshot({ path: path.join(OUT, '02-garage.png') });
    await a.click('#testDriveBtn'); await sleep(1500);
    await a.keyboard.down('ArrowUp'); await sleep(1500);
    await a.keyboard.press('Digit4'); await sleep(800);
    const testCar = await a.evaluate(() => NND.app.game.race.cars[0].carId);
    ok('試駕中按 4 換成赤線', testCar === 'redline', testCar);
    await sleep(1200);
    await a.screenshot({ path: path.join(OUT, '03-testdrive.png') });
    await a.keyboard.up('ArrowUp');
    await a.click('#testExit'); await sleep(300);

    /* ---------- 3. 計時挑戰：實際計時、背景暫停 ---------- */
    await a.evaluate(() => NND.app.show('scrMenu'));
    await a.click('[data-go="tt"]'); await sleep(300);
    await a.click('#trackList .card:nth-child(2)'); await sleep(200);
    await a.click('#goRace');
    await sleep(3300); // 倒數
    const t0 = Date.now(), r0 = await a.evaluate(() => NND.app.game.race.time);
    await a.keyboard.down('ArrowUp'); await a.keyboard.down('ArrowRight');
    await sleep(150); await a.keyboard.up('ArrowRight');
    await sleep(3400);
    const r1 = await a.evaluate(() => NND.app.game.race.time), wall = (Date.now() - t0) / 1000;
    ok('單機計時與實際經過時間一致', Math.abs((r1 - r0) - wall) < 0.35, `比賽 ${(r1 - r0).toFixed(2)}s／實際 ${wall.toFixed(2)}s`);
    const mv = await a.evaluate(() => { const e = NND.app.game.race.get('me'), c = e.car, g = NND.app.game.race.track.grid[0]; return { sp: Math.hypot(c.vx, c.vy), dist: Math.hypot(c.x - g.x, c.y - g.y), surf: c.surf }; });
    ok('同時按油門與轉向，車輛加速前進（直線不轉向會開進草地減速）', mv.sp > 100 && mv.dist > 400, `速度 ${mv.sp.toFixed(0)} px/s，移動 ${mv.dist.toFixed(0)} px，路面 ${mv.surf}`);
    await a.screenshot({ path: path.join(OUT, '04-harbor-race.png') });
    await a.keyboard.up('ArrowUp');
    await a.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const paused = await a.evaluate(() => NND.app.game.paused);
    const tp = await a.evaluate(() => NND.app.game.race.time); await sleep(800);
    const tp2 = await a.evaluate(() => NND.app.game.race.time);
    ok('單機切到背景自動暫停，計時停止', paused && tp === tp2);
    await a.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
    await a.click('#pResume');

    /* ---------- 4. 完賽：只發一次經驗值、重開後仍在 ---------- */
    const before = await a.evaluate(() => ({ lv: NND.app.save.level(), xp: NND.app.save.data.profile.xp }));
    await a.evaluate(() => { // 把車放到最後一條檢查線之後、終點線前方，模擬即將完成第 3 圈
      const G = NND.app.game, r = G.race, e = r.get('me'), tr = r.track;
      e.cp = r.opts.laps * r.K; e.lapsDone = r.opts.laps - 1; e.lapStart = r.time - 20; e.lapTimes = [20, 20];
      const p = tr.pts[tr.N - 3]; e.car.x = p.x; e.car.y = p.y; e.car.a = Math.atan2(p.ty, p.tx); e.car.vx = p.tx * 300; e.car.vy = p.ty * 300; e.car.idx = tr.N - 3;
    });
    await a.waitForFunction(() => !document.getElementById('scrResults').classList.contains('hidden'), { timeout: 5000 });
    const xpTxt = await a.$eval('#resXp', e => e.textContent);
    const raceId = await a.evaluate(() => NND.app.game.race.raceId);
    const after = await a.evaluate(() => ({ lv: NND.app.save.level(), xp: NND.app.save.data.profile.xp, rec: NND.app.save.getRecord('harbor', NND.app.save.data.garage.car) }));
    ok('完賽發放經驗值（完賽＋首次完成地圖＋紀錄）', /合計 \+330/.test(xpTxt), xpTxt);
    await a.screenshot({ path: path.join(OUT, '05-results.png') });
    const again = await a.evaluate(id => NND.app.save.awardXP(id, [{ label: 'x', xp: 100 }]).granted, raceId);
    ok('同一場比賽再次發放被擋下', again === false);
    await a.reload({ waitUntil: 'networkidle0' }); await sleep(500);
    const reload = await a.evaluate(() => ({ lv: NND.app.save.level(), xp: NND.app.save.data.profile.xp, rec: NND.app.save.getRecord('harbor', NND.app.save.data.garage.car), legacy: NND.app.save.data.legacy }));
    ok('重新開啟後等級、經驗、紀錄、舊紀錄仍存在', reload.lv === after.lv && reload.xp === after.xp && reload.rec && reload.legacy && reload.legacy.time === 83.45,
      `Lv${before.lv}→Lv${reload.lv}，經驗 ${reload.xp}，港灣紀錄 ${reload.rec && reload.rec.time.toFixed(2)}`);
    const unlocked = await a.evaluate(() => NND.app.save.isUnlocked('paint', 'sunset'));
    ok('升到 Lv2 解鎖霓虹橘車漆', unlocked);

    /* ---------- 5. 手機：橫向、多指同時轉向＋油門＋技能、中斷清除 ---------- */
    const ctxM = await browser.createBrowserContext();
    const m = await ctxM.newPage(); watch(m, 'M');
    await m.emulate({ viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2, isLandscape: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
    await m.goto(base + '/', { waitUntil: 'networkidle0' });
    await m.screenshot({ path: path.join(OUT, '06-mobile-menu.png') });
    await m.evaluate(() => { document.querySelector('[data-go="arcade"]').click(); });
    await sleep(300);
    await m.evaluate(() => document.getElementById('goRace').click());
    await sleep(3400);
    const cdp = await m.target().createCDPSession();
    const pad = await m.$eval('#steerPad', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.6 }; });
    const gas = await m.$eval('#tGas', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const s1 = await m.$eval('#tS1', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const tp1 = { x: pad.x, y: pad.y, id: 1 }, tp2g = { x: gas.x, y: gas.y, id: 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp1] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp1, tp2g] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pad.x + 60, y: pad.y, id: 1 }, tp2g] });
    await sleep(100);
    const both = await m.evaluate(() => NND.input.read(false));
    ok('手機同時轉向與踩油門', both.throttle === 1 && both.steer > 0.5, JSON.stringify(both));
    await m.evaluate(() => { NND.app.game.race.get('me').car.energy = 100; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pad.x + 60, y: pad.y, id: 1 }, tp2g, { x: s1.x, y: s1.y, id: 3 }] });
    await sleep(80);
    const three = await m.evaluate(() => { const i = NND.input.read(false), c = NND.app.game.race.get('me').car; return { throttle: i.throttle, steer: i.steer, skillCd: c.skills[0].cd, energy: c.energy }; });
    ok('第三指施放技能時轉向與油門不中斷', three.throttle === 1 && three.steer > 0.5 && three.skillCd > 0, JSON.stringify(three));
    await sleep(1500);
    await m.screenshot({ path: path.join(OUT, '07-mobile-race.png') });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await sleep(50);
    const cleared = await m.evaluate(() => NND.input.read(false));
    ok('觸控中斷（touchcancel）後輸入清除', cleared.throttle === 0 && cleared.steer === 0, JSON.stringify(cleared));
    await m.evaluate(() => { document.querySelector('#tGas').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true })); });
    await m.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurred = await m.evaluate(() => NND.input.read(false));
    ok('切換視窗（blur）後輸入清除', blurred.throttle === 0);
    await m.evaluate(() => { NND.app.save.data.settings.autoThrottle = true; NND.input.setAutoThrottle(true); });
    const auto = await m.evaluate(() => NND.input.read(false));
    ok('自動油門開啟後不按也會加速', auto.throttle === 1);
    await m.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
    await sleep(400);
    const rot = await m.evaluate(() => !document.getElementById('rotate').classList.contains('hidden') && NND.app.game.paused);
    ok('手機直向時提示轉橫向並暫停單機', rot);

    /* ---------- 6. 多人：兩個獨立瀏覽器（不同 sessionStorage） ---------- */
    const ctxH = await browser.createBrowserContext(), ctxG = await browser.createBrowserContext();
    const h = await ctxH.newPage(), g = await ctxG.newPage(); watch(h, 'H'); watch(g, 'G');
    await h.setViewport({ width: 1280, height: 720 }); await g.setViewport({ width: 1280, height: 720 });
    await h.goto(base + '/', { waitUntil: 'networkidle0' });
    await h.click('[data-go="mp"]');
    await h.waitForFunction(() => document.getElementById('mpStatus').classList.contains('online'), { timeout: 5000 });
    ok('多人選單顯示真實連線狀態', true, await h.$eval('#mpStatus', e => e.textContent));
    await h.type('#nick', '房主小明'); await h.click('#mpCreate');
    await h.waitForFunction(() => !document.getElementById('scrLobby').classList.contains('hidden'), { timeout: 5000 });
    const code = await h.$eval('#lbCode', e => e.textContent);
    const link = await h.$eval('#lbLink', e => e.value);
    ok('建立房間後顯示房間碼、邀請連結、人數', /^[A-Z0-9]{4}$/.test(code) && link.endsWith('?room=' + code), `${code} ${link} ${await h.$eval('#lbCount', e => e.textContent)}`);
    await h.screenshot({ path: path.join(OUT, '08-lobby-host.png') });
    await g.evaluateOnNewDocument(() => { localStorage.setItem('neonNightDrive.save', JSON.stringify({ version: 2, profile: { name: '訪客阿華', xp: 0, level: 1 } })); });
    await g.goto(link.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'networkidle0' });
    await g.waitForFunction(() => !document.getElementById('scrLobby').classList.contains('hidden'), { timeout: 6000 });
    await h.waitForFunction(() => document.getElementById('lbCount').textContent.startsWith('2'), { timeout: 5000 });
    ok('受邀者用邀請連結直接加入', true, await h.$eval('#lbCount', e => e.textContent));
    await g.select('#lbCar', 'mist'); await sleep(200);
    await g.click('#lbReady');
    await h.waitForFunction(() => !document.getElementById('lbStart').disabled, { timeout: 5000 });
    await h.click('#lbStart');
    await Promise.all([h, g].map(p => p.waitForFunction(() => NND.app.game && NND.app.game.mode === 'mp' && NND.app.game.phase === 'race', { timeout: 8000 })));
    await g.keyboard.down('ArrowUp'); await h.keyboard.down('ArrowUp');
    await sleep(2500);
    const gState = await g.evaluate(() => { const G = NND.app.game; return { sp: Math.hypot(G.pred.car.vx, G.pred.car.vy), cars: G.cars.length, me: G.carId }; });
    ok('多人即時競速：本機預測車輛前進、看得到 8 台車', gState.sp > 150 && gState.cars === 8, JSON.stringify(gState));
    await g.keyboard.press('KeyR'); await sleep(200);
    const stillRace = await g.evaluate(() => NND.app.game.mode === 'mp' && NND.app.game.phase === 'race' && document.getElementById('msg').textContent);
    ok('多人模式按 R 不會重啟整場', /不能重新開始/.test(stillRace || ''), stillRace);
    await g.screenshot({ path: path.join(OUT, '09-mp-race-guest.png') });
    // 訪客重新整理 → 回到同一場比賽、同一台車
    await g.keyboard.up('ArrowUp');
    await g.reload({ waitUntil: 'networkidle0' });
    await g.click('[data-go="mp"]').catch(() => {});
    await g.waitForFunction(() => NND.app.game && NND.app.game.mode === 'mp', { timeout: 8000 });
    const back = await g.evaluate(() => ({ car: NND.app.game.carId, n: NND.app.game.grid.length }));
    const hostSees = await h.evaluate(() => NND.app.game.cars.length);
    ok('重新整理後回到原車位、不複製車輛', back.car === 'mist' && back.n === 8 && hostSees === 8, JSON.stringify(back));
    await h.screenshot({ path: path.join(OUT, '10-mp-race-host.png') });
  } catch (e) {
    ok('瀏覽器實測流程', false, e.stack);
  } finally {
    ok('前端沒有 JavaScript 錯誤', errors.length === 0, errors.slice(0, 6).join(' | '));
    fs.writeFileSync(path.join(OUT, 'result.txt'), log.join('\n') + '\n');
    await browser.close();
    await app.close();
  }
})();
