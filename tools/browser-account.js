'use strict';
// 瀏覽器實測：車手帳號與雲端存檔（Chrome 無頭模式，多個獨立瀏覽器環境＝不同裝置）
// 用法：npm install --no-save puppeteer-core && node tools/browser-account.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { createServer } = require('../server/server.js');

const OUT = path.join(__dirname, 'browser');
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const ok = (name, cond, detail) => log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '：' + detail : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nnd-browser-acct-'));
const srvLog = [];
const slog = (...a) => srvLog.push(a.map(x => (x && x.stack) ? x.stack : String(x)).join(' '));

const visible = id => `!document.getElementById('${id}').classList.contains('hidden')`;
const profileOf = page => page.evaluate(() => {
  const s = NND.app.save;
  return { level: s.level(), xp: Math.floor(s.data.profile.xp), total: s.totalXp(), unlocks: (s.data.cloud && s.data.cloud.unlocks || []).slice().sort(),
    name: s.data.profile.name, sync: document.getElementById('acctSync').textContent, who: document.getElementById('acctWho').textContent, guest: s === NND.app.guest };
});

async function register(page, user, pass, nick) {
  await page.click('#acctBtn'); await sleep(200);
  await page.click('#tabReg');
  await page.type('#auUser', user); await page.type('#auPass', pass);
  await page.$eval('#auNick', e => { e.value = ''; }); await page.type('#auNick', nick);
  await page.click('#auSubmit');
}
async function login(page, user, pass) {
  await page.click('#acctBtn'); await sleep(200);
  await page.click('#tabLogin');
  await page.type('#auUser', user); await page.type('#auPass', pass);
  await page.click('#auSubmit');
}

(async () => {
  let app = await createServer({ port: 0, host: '127.0.0.1', log: slog, dataDir });
  const port = app.port, base = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/401|409|Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
  };
  try {
    /* ---------- 電腦：已有訪客存檔 → 註冊 → 先比較再選擇 ---------- */
    const pcCtx = await browser.createBrowserContext();
    const pc = await pcCtx.newPage(); watch(pc, 'PC');
    await pc.setViewport({ width: 1366, height: 768 });
    await pc.evaluateOnNewDocument(() => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('neonNightDriveBest', '83.45');
      localStorage.setItem('neonNightDrive.save', JSON.stringify({ version: 2, profile: { name: '阿明', level: 3, xp: 120 },
        completed: { mountain: true }, records: { 'mountain|swift|v2': { time: 47.5, laps: 3 } } }));
    });
    await pc.goto(base + '/', { waitUntil: 'networkidle0' }); await sleep(500);
    const g0 = await profileOf(pc);
    ok('訪客模式標示「儲存在此裝置」', /儲存在此裝置/.test(g0.sync) && g0.guest, g0.sync);
    ok('主選單有「登入／註冊」', (await pc.$eval('#acctBtn', e => e.textContent)) === '登入／註冊');
    const guestTotal = g0.total;
    await register(pc, 'pc_racer', 'neon-pass-1', '阿明');
    await pc.waitForFunction(visible('scrMerge'), { timeout: 5000 });
    const mg = await pc.evaluate(() => ({ local: document.getElementById('mgLocal').textContent, cloud: document.getElementById('mgCloud').textContent }));
    ok('首次登入先顯示本機與雲端進度', /Lv 3/.test(mg.local) && /Lv 1/.test(mg.cloud) && /山城曙光/.test(mg.local) && /新帳號/.test(mg.cloud),
      mg.local.replace(/\s+/g, ' ').slice(0, 60) + ' ｜ ' + mg.cloud.replace(/\s+/g, ' ').slice(0, 40));
    await pc.screenshot({ path: path.join(OUT, '11-merge.png') });
    await pc.click('#mgMerge');
    await pc.waitForFunction(visible('scrMenu'), { timeout: 5000 }); await sleep(300);
    const p1 = await profileOf(pc);
    ok('合併後帳號沿用本機進度，沒有被新帳號蓋掉', p1.total === guestTotal && p1.level === 3 && !p1.guest, `總經驗 ${p1.total}，Lv ${p1.level}`);
    ok('登入後顯示雲端同步狀態', /雲端已同步/.test(p1.sync), p1.sync);
    const guestKept = await pc.evaluate(() => { const g = JSON.parse(localStorage.getItem('neonNightDrive.save')); return { lv: g.profile.level, legacy: g.legacy && g.legacy.time, best: localStorage.getItem('neonNightDriveBest') }; });
    ok('此裝置的訪客存檔與舊紀錄原封不動', guestKept.lv === 3 && guestKept.legacy === 83.45 && guestKept.best === '83.45', JSON.stringify(guestKept));

    /* ---------- 電腦：完成一場多人比賽（伺服器結算並寫入資料庫） ---------- */
    await pc.click('[data-go="mp"]');
    await pc.waitForFunction(() => document.getElementById('mpStatus').classList.contains('online'), { timeout: 5000 });
    await pc.click('#mpCreate');
    await pc.waitForFunction(visible('scrLobby'), { timeout: 5000 });
    await pc.select('#lbLaps', '1'); await sleep(200);
    await pc.$eval('#lbAi', e => { if (e.checked) e.click(); }); await sleep(400);
    await pc.click('#lbStart');
    try {
      await pc.waitForFunction(() => NND.app.game && NND.app.game.mode === 'mp' && NND.app.game.phase === 'race', { timeout: 8000 });
    } catch (err) {
      const dbg = await pc.evaluate(() => ({ phase: NND.app.net.room && NND.app.net.room.phase, err: document.getElementById('lbErr').textContent,
        game: NND.app.game && { mode: NND.app.game.mode, phase: NND.app.game.phase } }));
      throw new Error('未開賽：' + JSON.stringify(dbg));
    }
    await pc.keyboard.down('ArrowUp');
    await sleep(500);
    // 測試輔助：在伺服器端把這台車移到終點線前（等同即將跑完最後一圈），之後由伺服器正式判定完賽
    const pid = await pc.evaluate(() => NND.app.net.id);
    const room = [...app.hub.rooms.values()].find(r => r.players.some(p => p.id === pid));
    const e = room.race.get(pid), tr = room.race.track;
    e.cp = room.race.opts.laps * room.race.K; e.lapsDone = room.race.opts.laps - 1;
    const pt = tr.pts[tr.N - 3]; Object.assign(e.car, { x: pt.x, y: pt.y, a: Math.atan2(pt.ty, pt.tx), vx: pt.tx * 300, vy: pt.ty * 300, idx: tr.N - 3 });
    await pc.waitForFunction(visible('scrResults'), { timeout: 8000 });
    await pc.keyboard.up('ArrowUp');
    const resTxt = await pc.$eval('#resXp', el => el.textContent);
    ok('多人結算由伺服器寫入雲端帳號', /已寫入雲端帳號/.test(resTxt), resTxt.replace(/\s+/g, ' ').slice(0, 140));
    await pc.screenshot({ path: path.join(OUT, '12-mp-results-cloud.png') });
    const raceId = room.results.raceId;
    const accId = app.store.q.byUsername.get('pc_racer').id;
    const dbTotal = app.store.get(accId).total_xp;
    // 電腦在結算畫面重新整理：不會再領一次
    await pc.reload({ waitUntil: 'networkidle0' }); await sleep(1500);
    const dbTotal2 = app.store.get(accId).total_xp;
    ok('結算後重新整理不會重複發放', dbTotal === dbTotal2 && dbTotal > guestTotal, `資料庫總經驗 ${guestTotal} → ${dbTotal} → 重新整理後 ${dbTotal2}（比賽 ${raceId}）`);
    await pc.evaluate(() => NND.app.show('scrMenu')); await sleep(800);
    const pcFinal = await profileOf(pc);
    ok('電腦顯示與資料庫一致', pcFinal.total === dbTotal, `Lv ${pcFinal.level}，經驗 ${pcFinal.xp}，總經驗 ${pcFinal.total}`);

    /* ---------- 手機：登入同一帳號 ---------- */
    const phCtx = await browser.createBrowserContext();
    const ph = await phCtx.newPage(); watch(ph, 'PHONE');
    await ph.emulate({ viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2, isLandscape: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
    await ph.goto(base + '/', { waitUntil: 'networkidle0' });
    await login(ph, 'pc_racer', 'neon-pass-1');
    await ph.waitForFunction(visible('scrMenu'), { timeout: 5000 }); await sleep(400);
    const phP = await profileOf(ph);
    const same = phP.level === pcFinal.level && phP.xp === pcFinal.xp && phP.total === pcFinal.total && JSON.stringify(phP.unlocks) === JSON.stringify(pcFinal.unlocks);
    ok('手機登入同一帳號：等級、經驗值、解鎖項目相同', same, `手機 Lv ${phP.level}／${phP.xp} 經驗／解鎖 ${phP.unlocks.length} 項；電腦 Lv ${pcFinal.level}／${pcFinal.xp}／${pcFinal.unlocks.length} 項`);
    await ph.screenshot({ path: path.join(OUT, '13-phone-menu.png') });
    await ph.click('#acctBtn'); await sleep(300);
    await ph.screenshot({ path: path.join(OUT, '14-phone-account.png') });
    const phAcct = await ph.$eval('#acUnlocks', el => el.textContent);
    ok('手機帳號畫面列出已解鎖項目', /已解鎖 \d+ 項/.test(phAcct), phAcct);

    /* ---------- 另一位玩家：相同暱稱，只看到自己的 ---------- */
    const otCtx = await browser.createBrowserContext();
    const ot = await otCtx.newPage(); watch(ot, 'OTHER');
    await ot.setViewport({ width: 1280, height: 720 });
    await ot.goto(base + '/', { waitUntil: 'networkidle0' });
    await register(ot, 'other_racer', 'other-pass-1', '阿明');
    await ot.waitForFunction(visible('scrMenu'), { timeout: 5000 }); await sleep(300);
    const otP = await profileOf(ot);
    ok('同暱稱的另一位玩家只看到自己的紀錄', otP.name === '阿明' && otP.level === 1 && otP.total === 0 && otP.unlocks.length < pcFinal.unlocks.length,
      `暱稱 ${otP.name}，Lv ${otP.level}，總經驗 ${otP.total}`);

    /* ---------- 訪客：仍可只輸入暱稱建立多人房間 ---------- */
    const gsCtx = await browser.createBrowserContext();
    const gs = await gsCtx.newPage(); watch(gs, 'GUEST');
    await gs.goto(base + '/', { waitUntil: 'networkidle0' });
    await gs.click('[data-go="mp"]');
    await gs.waitForFunction(() => document.getElementById('mpStatus').classList.contains('online'), { timeout: 5000 });
    await gs.type('#nick', '路人'); await gs.click('#mpCreate');
    await gs.waitForFunction(visible('scrLobby'), { timeout: 5000 });
    ok('訪客輸入暱稱即可建立多人房間', true, await gs.$eval('#lbCode', el => el.textContent));

    /* ---------- 重新部署：關閉伺服器，以同一個資料夾重新啟動 ---------- */
    await app.close();
    app = await createServer({ port, host: '127.0.0.1', log: slog, dataDir });
    await ph.reload({ waitUntil: 'networkidle0' }); await sleep(1500);
    const afterRedeploy = await profileOf(ph);
    ok('重新部署後，手機重新開啟仍是同一份進度且已同步', afterRedeploy.total === pcFinal.total && afterRedeploy.level === pcFinal.level && /雲端已同步/.test(afterRedeploy.sync),
      `Lv ${afterRedeploy.level}，總經驗 ${afterRedeploy.total}，${afterRedeploy.sync}`);
    const fresh = await (await browser.createBrowserContext()).newPage(); watch(fresh, 'NEW');
    await fresh.goto(base + '/', { waitUntil: 'networkidle0' });
    await login(fresh, 'pc_racer', 'neon-pass-1');
    await fresh.waitForFunction(visible('scrMenu'), { timeout: 5000 }); await sleep(300);
    const fp = await profileOf(fresh);
    ok('重新部署後在全新裝置登入，進度仍保留', fp.total === pcFinal.total && fp.level === pcFinal.level, `Lv ${fp.level}，總經驗 ${fp.total}`);

    /* ---------- 登出回到訪客 ---------- */
    await ph.click('#acctBtn'); await sleep(200); await ph.click('#acLogout'); await sleep(400);
    const lo = await profileOf(ph);
    ok('登出後回到此裝置的訪客進度', lo.guest && /儲存在此裝置/.test(lo.sync), lo.sync);
  } catch (e) {
    ok('帳號瀏覽器實測流程', false, e.stack);
  } finally {
    ok('前端沒有 JavaScript 錯誤', errors.length === 0, errors.slice(0, 6).join(' | '));
    fs.writeFileSync(path.join(OUT, 'account-result.txt'), log.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT, 'account-server.log'), srvLog.join('\n') + '\n');
    await browser.close();
    await app.close();
  }
})();
