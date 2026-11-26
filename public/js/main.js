/* 霓虹夜行：主程式（畫面流程、單機／試駕／多人遊戲迴圈、HUD、結算、PWA） */
(function () {
  'use strict';
  const NND = window.NND, D = NND.data, T = NND.track, P = NND.physics, S = NND.sim, R = NND.render, I = NND.input, Net = NND.net;
  const $ = id => document.getElementById(id);
  const DT = D.SIM_DT;
  const save = NND.save.create();
  const AI_NAMES = ['阿凱', '小雨', '老周', '米亞', '阿哲', '柚子', '黑貓'];
  const fmt = t => {
    if (t == null || !isFinite(t)) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  /* ================= 畫面 ================= */
  const SCREENS = ['scrMenu', 'scrTracks', 'scrGarage', 'scrMp', 'scrLobby', 'scrResults', 'scrPause', 'scrSettings', 'scrHelp'];
  let screen = 'scrMenu';
  function show(id) {
    screen = id;
    SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id));
    if (id === 'scrMenu') renderMenu();
    if (id === 'scrGarage') renderGarage();
    if (id === 'scrTracks') renderTracks();
    if (id === 'scrSettings') renderSettings();
    if (id === 'scrMp') openMp();
    refreshUpdateBtn();
  }
  function hideScreens() { SCREENS.forEach(s => $(s).classList.add('hidden')); screen = null; }
  let toastTimer = 0;
  function toast(text, ms) {
    const t = $('toast'); t.textContent = text; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }

  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'tt' || go === 'arcade') { ui.mode = go; show('scrTracks'); }
    else if (go === 'garage') show('scrGarage');
    else if (go === 'mp') show('scrMp');
    else if (go === 'help') show('scrHelp');
    else if (go === 'settings') show('scrSettings');
    else show('scrMenu');
  }));

  const ui = { mode: 'tt', trackId: 'city' };
  const renderer = R.createRenderer($('game'));
  renderer.setQuality(save.data.settings.quality);
  I.setupTouch();
  I.setAutoThrottle(save.data.settings.autoThrottle);
  const touchUI = () => I.isTouchDevice() || save.data.settings.forceTouch;

  /* ================= 主選單 ================= */
  function levelHtml() {
    const p = save.data.profile, need = save.xpNeeded();
    const next = save.nextUnlocks().map(u => `Lv${u.level} ${u.name}`).join('、') || '已全部解鎖';
    return `<div>車手等級 <b>Lv ${p.level}</b>　經驗 ${Math.floor(p.xp)} / ${need}</div>
      <div class="bar"><i style="width:${Math.min(100, p.xp / need * 100).toFixed(1)}%"></i></div>
      <div class="hint">下一個獎勵：${esc(next)}</div>`;
  }
  function renderMenu() {
    $('menuLevel').innerHTML = levelHtml();
    const lg = save.data.legacy;
    $('legacyNote').classList.toggle('hidden', !lg);
    if (lg) $('legacyNote').textContent = `已保留第一版紀錄：舊版霓虹市區 ${fmt(lg.time)}`;
    $('verTxt').textContent = `版本 ${D.GAME_VERSION}・規則 v${D.RULES_VERSION}`;
  }

  /* ================= 賽道選擇 ================= */
  function renderTracks() {
    $('tracksTitle').textContent = ui.mode === 'tt' ? '計時挑戰：選擇賽道' : '街機競速：選擇賽道';
    $('arcadeOpts').classList.toggle('hidden', ui.mode !== 'arcade');
    $('ttOpts').classList.toggle('hidden', ui.mode !== 'tt');
    $('optGhost').checked = save.data.settings.showGhost;
    const carId = save.data.garage.car;
    $('curCarTxt').textContent = `${D.CARS[carId].name}（${D.CARS[carId].type}）`;
    const list = $('trackList'); list.innerHTML = '';
    for (const id of D.TRACK_ORDER) {
      const def = D.TRACKS[id], tr = T.get(D.TRACKS, id);
      const mine = save.getRecord(id, carId), any = save.bestForTrack(id);
      const el = document.createElement('div');
      el.className = 'card' + (ui.trackId === id ? ' sel' : '');
      el.tabIndex = 0;
      let rec = `本車最佳 ${fmt(mine && mine.time)}`;
      if (any && (!mine || any.car !== carId)) rec += `<br>全車款最佳 ${fmt(any.time)}（${esc(D.CARS[any.car].name)}）`;
      if (id === 'city' && save.data.legacy) rec += `<br>舊版霓虹市區 ${fmt(save.data.legacy.time)}`;
      el.innerHTML = `<canvas width="240" height="150"></canvas><b>${esc(def.name)}</b>
        <div class="sig">招牌彎：${esc(def.signature.name)}</div><p>${esc(def.desc)}</p><div class="rec">${rec}</div>
        ${save.data.completed[id] ? '<p>✔ 已完成</p>' : '<p>首次完成 +150 經驗</p>'}`;
      R.drawMinimap(el.querySelector('canvas'), tr, [], { color: R.THEMES[def.theme].edgeA });
      const pick = () => { ui.trackId = id; renderTracks(); };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { pick(); startFromTracks(); } });
      list.appendChild(el);
    }
  }
  $('optGhost').addEventListener('change', e => { save.data.settings.showGhost = e.target.checked; save.persist(); });
  $('goRace').addEventListener('click', startFromTracks);
  function startFromTracks() {
    if (ui.mode === 'tt') startSingle('tt', ui.trackId, { skills: $('optTtSkills').checked, ghost: $('optGhost').checked });
    else startSingle('arcade', ui.trackId, { skills: $('optSkills').checked, ai: +$('optAi').value, diff: $('optDiff').value });
  }

  /* ================= 車庫 ================= */
  const STATS = {};
  for (const id of D.CAR_ORDER) {
    const m = P.measure(D.CARS[id]);
    STATS[id] = { top: m.top * D.KMH, t160: m.t400, brake: m.brakeDist / 10, grip: m.grip, wet: m.wet };
  }
  const range = k => { const v = D.CAR_ORDER.map(id => STATS[id][k]); return [Math.min(...v), Math.max(...v)]; };
  const norm = (k, v, inv) => { const [a, b] = range(k); const t = b === a ? 1 : (v - a) / (b - a); return 0.3 + 0.7 * (inv ? 1 - t : t); };

  function renderGarage() {
    $('garageLevel').innerHTML = levelHtml();
    const g = save.data.garage, list = $('carList'); list.innerHTML = '';
    for (const id of D.CAR_ORDER) {
      const c = D.CARS[id], s = STATS[id];
      const el = document.createElement('div');
      el.className = 'carcard' + (g.car === id ? ' sel' : ''); el.tabIndex = 0;
      const bar = (label, v, txt) => `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></div><span>${txt}</span></div>`;
      el.innerHTML = `<canvas width="180" height="180"></canvas><div><b>${esc(c.name)}</b><em>${esc(c.type)}</em><p>${esc(c.desc)}</p>
        ${bar('極速', norm('top', s.top), Math.round(s.top) + ' km/h')}
        ${bar('加速', norm('t160', s.t160, true), '0→160 ' + s.t160.toFixed(2) + 's')}
        ${bar('抓地', norm('grip', s.grip), '濕地 ' + Math.round(s.wet * 100) + '%')}
        ${bar('煞車', norm('brake', s.brake, true), '200→0 ' + s.brake.toFixed(1) + 'm')}</div>`;
      R.drawCarPreview(el.querySelector('canvas'), id, id === g.car ? g.cos : {});
      el.addEventListener('click', () => { g.car = id; save.persist(); renderGarage(); });
      list.appendChild(el);
    }
    // 技能配置
    const pl = $('presetList'); pl.innerHTML = '';
    D.PRESET_SLOTS.forEach((slot, i) => {
      const unlocked = slot.level <= save.level();
      const row = document.createElement('div'); row.className = 'preset' + (unlocked ? '' : ' locked');
      const opts = sel => D.SKILL_ORDER.map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${D.SKILLS[s].name}</option>`).join('');
      const pr = g.presets[i];
      row.innerHTML = unlocked
        ? `<label><input type="radio" name="preset" ${g.preset === i ? 'checked' : ''}> 配置 ${i + 1}</label>
           <select data-k="0">${opts(pr[0])}</select><select data-k="1">${opts(pr[1])}</select>`
        : `<span>🔒 配置 ${i + 1}：Lv ${slot.level} 解鎖</span>`;
      if (unlocked) {
        row.querySelector('input').addEventListener('change', () => { g.preset = i; save.persist(); });
        row.querySelectorAll('select').forEach(selEl => selEl.addEventListener('change', () => {
          const k = +selEl.dataset.k, v = selEl.value, other = pr[1 - k];
          if (v === other) pr[1 - k] = pr[k]; // 兩格不可相同：互換
          pr[k] = v; save.persist(); renderGarage();
        }));
      }
      pl.appendChild(row);
    });
    const desc = document.createElement('p'); desc.className = 'hint';
    desc.innerHTML = D.SKILL_ORDER.map(s => `<b>${D.SKILLS[s].name}</b>（能量 ${D.SKILLS[s].cost}、冷卻 ${D.SKILLS[s].cooldown} 秒）：${D.SKILLS[s].desc}`).join('<br>');
    pl.appendChild(desc);
    // 外觀
    const cl = $('cosList'); cl.innerHTML = '';
    const KIND = { paint: '車漆', rims: '輪框', taillight: '尾燈', trail: '尾流' };
    for (const kind of Object.keys(KIND)) {
      const row = document.createElement('div'); row.className = 'cosrow';
      row.innerHTML = `<span>${KIND[kind]}</span>`;
      for (const c of D.COSMETICS[kind]) {
        const b = document.createElement('button');
        const ok = c.level <= save.level();
        b.className = 'small' + (g.cos[kind] === c.id ? ' sel' : '');
        b.textContent = ok ? c.name : `🔒 ${c.name} Lv${c.level}`;
        b.disabled = !ok;
        b.addEventListener('click', () => { g.cos[kind] = c.id; save.persist(); renderGarage(); });
        row.appendChild(b);
      }
      cl.appendChild(row);
    }
  }
  $('testDriveBtn').addEventListener('click', () => startSingle('test', 'test', { skills: false }));

  /* ================= 設定 ================= */
  function renderSettings() {
    $('setAuto').checked = save.data.settings.autoThrottle;
    $('setTouch').checked = !!save.data.settings.forceTouch;
    $('setQuality').value = save.data.settings.quality || 'auto';
    $('saveVer').textContent = NND.save.VERSION;
  }
  $('setAuto').addEventListener('change', e => { save.data.settings.autoThrottle = e.target.checked; I.setAutoThrottle(e.target.checked); save.persist(); });
  $('setTouch').addEventListener('change', e => { save.data.settings.forceTouch = e.target.checked; save.persist(); });
  $('setQuality').addEventListener('change', e => { save.data.settings.quality = e.target.value; renderer.setQuality(e.target.value); save.persist(); });
  $('resetSave').addEventListener('click', () => {
    if (!confirm('確定要清除本機進度嗎？等級、解鎖與紀錄都會刪除（舊版紀錄 neonNightDriveBest 仍保留在瀏覽器中）。')) return;
    save.reset(); toast('已清除本機進度'); renderSettings();
  });

  /* ================= 單機遊戲 ================= */
  let G = null;           // 進行中的遊戲
  let demo = null;        // 選單背景展示
  const cam = { x: 0, y: 0, zoom: 1, shake: 0 };

  function startSingle(mode, trackId, opts) {
    const laps = mode === 'test' ? 99 : D.RULES.defaultLaps;
    const race = new S.Race({ trackId, laps, skills: !!opts.skills, countdown: mode === 'test' ? 1 : D.RULES.countdown });
    const carId = save.data.garage.car, skills = save.currentSkills();
    race.addCar({ id: 'me', name: save.data.profile.name || '你', carId, skills, cos: save.data.garage.cos, human: true });
    if (mode === 'arcade') {
      for (let k = 0; k < opts.ai; k++) {
        const sk = [D.SKILL_ORDER[k % 3], D.SKILL_ORDER[(k + 1) % 3]];
        race.addCar({ id: 'ai' + k, name: AI_NAMES[k], carId: D.CAR_ORDER[(k + 1) % 4], ai: opts.diff, skills: sk,
          cos: { trail: k % 2 ? 'neon' : 'none' } });
      }
    }
    const rec = mode === 'tt' && opts.ghost ? save.getRecord(trackId, carId) : null;
    G = { mode, race, track: race.track, trackId, opts, acc: 0, paused: false, ended: false,
      ghost: rec && rec.ghost, rec: [], tick: 0, wrongT: 0, sigLap: -1, testTimes: {}, msgT: 0 };
    renderer.setTrack(race.track);
    enterRaceUI();
    if (mode === 'test') renderTestPanel();
  }

  function enterRaceUI() {
    hideScreens();
    $('hud').classList.remove('hidden');
    document.body.classList.add('racing');
    document.body.classList.toggle('touchui', touchUI());
    $('touch').classList.toggle('hidden', !touchUI());
    $('testPanel').classList.toggle('hidden', !(G && G.mode === 'test'));
    $('board').classList.toggle('hidden', !(G && (G.mode === 'arcade' || G.mode === 'mp')));
    $('hPosBox').classList.toggle('hidden', !(G && (G.mode === 'arcade' || G.mode === 'mp')));
    const skillsOn = G.mode === 'mp' ? G.settings.skills : G.race.opts.skills;
    $('skillBar').classList.toggle('hidden', !skillsOn);
    $('tS1').classList.toggle('hidden', !skillsOn); $('tS2').classList.toggle('hidden', !skillsOn);
    $('netBadge').classList.toggle('hidden', G.mode !== 'mp');
    ['cd', 'msg', 'sig', 'tip', 'warn'].forEach(id => $(id).classList.add('hidden'));
    $('cd').classList.remove('hidden');
    I.clearAll();
    last = performance.now();
  }
  function leaveRaceUI() {
    $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); $('rotate').classList.add('hidden');
    document.body.classList.remove('racing');
    I.clearAll();
  }

  function restartSingle() {
    if (!G || G.mode === 'mp') return;
    const { mode, trackId, opts } = G;
    if (mode === 'test') return;
    startSingle(mode, trackId, opts);
  }
  function quitToMenu() {
    if (G && G.mode === 'mp') mpLeave();
    G = null; leaveRaceUI(); show('scrMenu');
  }

  function pause(reason) {
    if (!G || G.ended || G.paused) return;
    if (G.mode === 'mp') { // 多人不暫停，只開選單
      $('pauseNote').textContent = '多人比賽不會暫停，伺服器時間持續進行。';
      $('pResume').textContent = '返回比賽'; $('pRestart').classList.add('hidden');
      $('scrPause').classList.remove('hidden'); screen = 'scrPause';
      return;
    }
    G.paused = true; I.clearAll();
    $('pauseNote').textContent = reason || '';
    $('pResume').textContent = '繼續'; $('pRestart').classList.toggle('hidden', G.mode === 'test');
    $('scrPause').classList.remove('hidden'); screen = 'scrPause';
  }
  function resume() {
    $('scrPause').classList.add('hidden'); screen = null;
    if (G) { G.paused = false; G.acc = 0; last = performance.now(); }
  }
  $('pauseBtn').addEventListener('click', () => pause());
  $('pResume').addEventListener('click', resume);
  $('pRestart').addEventListener('click', () => { $('scrPause').classList.add('hidden'); restartSingle(); });
  $('pQuit').addEventListener('click', () => { $('scrPause').classList.add('hidden'); quitToMenu(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G && G.mode !== 'mp' && !G.ended) pause('已自動暫停（切換到背景）');
  });

  I.onKey(e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (!G || G.ended) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (screen === 'scrPause') resume(); else pause(); }
    else if (e.code === 'KeyR' && !e.repeat) {
      if (G.mode === 'mp') flash('多人模式不能重新開始整場比賽');
      else if (G.mode !== 'test') restartSingle();
    } else if (G.mode === 'test' && /^Digit[1-4]$/.test(e.code)) switchTestCar(D.CAR_ORDER[+e.code.slice(5) - 1]);
  });

  function flash(text, sec) { const m = $('msg'); m.textContent = text; m.classList.remove('hidden'); if (G) G.msgT = sec || 1.6; }
  function showTip(text) { const t = $('tip'); t.textContent = text; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 5000); }

  function handleEvent(x, meId, names) {
    const mine = x.id === meId;
    if (x.type === 'go') { $('cd').textContent = 'GO!'; setTimeout(() => $('cd').classList.add('hidden'), 700); return; }
    if (x.type === 'finish' && !mine && names) { flash(`${names[x.id] || '車手'} 完賽！`); return; }
    if (!mine) return;
    switch (x.type) {
      case 'cp': flash(`檢查點 ${x.k} / ${x.of - 1}`); break;
      case 'cpBack': flash('逆向穿越檢查線，請掉頭'); break;
      case 'lap':
        if (G.mode === 'test') { const id = G.race.cars[0].carId; (G.testTimes[id] = G.testTimes[id] || []).push(x.time); renderTestPanel(); flash(`${D.CARS[id].name} 一圈 ${fmt(x.time)}`); }
        else flash(`第 ${x.lap} 圈 ${fmt(x.time)}`);
        break;
      case 'finish': flash('完賽！', 3); break;
      case 'skill': flash(`${D.SKILLS[x.skill].name} 啟動`); break;
      case 'skillFail': flash('能量不足'); break;
      case 'recharged': flash(`電能回充 +${D.SKILLS.recharge.gain}`); break;
      case 'firstCharge':
        if (!save.data.flags.chargeTip) {
          save.data.flags.chargeTip = true; save.persist();
          showTip('第一次蓄能成功！乾淨過彎或受控甩尾會累積能量，按 Q／E（或技能按鈕）施放');
        }
        break;
    }
  }

  function singleTick(fdt) {
    if (!G || G.paused || G.ended) return;
    const race = G.race, me = race.get('me');
    G.acc += fdt;
    let steps = 0;
    while (G.acc >= DT && steps < 40) {
      race.setInput('me', I.read(true));
      const ev = race.step();
      for (const x of ev) handleEvent(x, 'me', null);
      if (race.phase === 'race' && !me.finished && G.tick++ % 6 === 0) G.rec.push(Math.round(me.car.x), Math.round(me.car.y), Math.round(me.car.a * 100));
      G.acc -= DT; steps++;
      if ((G.mode === 'tt' && me.finished) || race.phase === 'done') { endSingle(); return; }
    }
    if (G.mode === 'test') { me.finished = false; }
  }

  function endSingle() {
    if (G.ended) return;
    G.ended = true;
    const race = G.race, me = race.get('me');
    const st = race.standings(), tdef = D.TRACKS[G.trackId];
    const parts = [];
    let isNew = false;
    if (me.finished) parts.push({ label: '完賽', xp: D.XP.finish });
    if (G.mode === 'arcade' && me.finished) {
      if (me.rank <= 3) parts.push({ label: `第 ${me.rank} 名`, xp: D.XP.podiumBonus[me.rank - 1] });
      const ahead = race.cars.length - me.rank;
      if (ahead > 0) parts.push({ label: `贏過 ${ahead} 台車`, xp: ahead * D.XP.perPositionAhead });
    }
    if (G.mode === 'tt' && me.finished) {
      isNew = save.submitTime(G.trackId, me.carId, me.finishTime, race.opts.laps, { dt: 0.1, f: G.rec });
      if (isNew) parts.push({ label: '刷新個人紀錄', xp: D.XP.newRecord });
    }
    if (me.finished && save.markCompleted(G.trackId)) parts.push({ label: `首次完成「${tdef.name}」`, xp: D.XP.firstMap });
    const xp = save.awardXP(race.raceId, parts);
    showResults({
      title: me.finished ? (G.mode === 'arcade' ? `第 ${me.rank} 名完賽！` : '完賽！') : '未完賽',
      time: me.finished ? me.finishTime : null, isNew, laps: me.lapTimes,
      standings: G.mode === 'arcade' ? st : null, meId: 'me', parts, xp,
      legacy: G.trackId === 'city' && G.mode === 'tt' ? save.data.legacy : null
    });
  }

  function showResults(r) {
    $('resTitle').textContent = r.title;
    $('resTime').textContent = r.time != null ? fmt(r.time) : '—';
    $('resNew').classList.toggle('hidden', !r.isNew);
    $('resLaps').innerHTML = (r.laps || []).map((t, i) => `第 ${i + 1} 圈　${fmt(t)}`).join('<br>') +
      (r.legacy ? `<br><span class="hint">參考：舊版霓虹市區 ${fmt(r.legacy.time)}（舊規則，分開保存）</span>` : '');
    const tb = $('resTable');
    if (r.standings) {
      tb.innerHTML = '<tr><th>名次</th><th>車手</th><th>車款</th><th>時間</th><th>最快圈</th></tr>' + r.standings.map(s =>
        `<tr class="${s.id === r.meId ? 'me' : ''}"><td>${s.rank}</td><td>${esc(s.name)}${s.human === false ? '（AI）' : ''}</td><td>${esc(D.CARS[s.carId || s.car].name)}</td>
         <td>${s.finished ? fmt(s.time) : s.dnf ? '未完賽' : '—'}</td><td>${fmt(s.best)}</td></tr>`).join('');
      tb.classList.remove('hidden');
    } else tb.classList.add('hidden');
    const x = r.xp;
    let xh = '';
    if (x && x.granted) {
      xh = r.parts.map(p => `${esc(p.label)} +${p.xp}`).join('　') + `<br>合計 +${x.total} 經驗`;
      if (x.levelsGained) xh += `<br><span class="lv">升級！Lv ${save.level()}</span>`;
      if (x.unlocked.length) xh += `<br>解鎖：${x.unlocked.map(u => esc(u.name)).join('、')}`;
    } else if (x && !x.granted && r.parts.length) xh = '<span class="hint">這場的經驗值已經領取過</span>';
    $('resXp').innerHTML = xh;
    const mp = G && G.mode === 'mp';
    $('resAgain').textContent = mp ? (amHost() ? '再戰（回到房間）' : '回到房間') : '重新開始';
    $('resMenu').textContent = mp ? '離開房間' : '返回選單';
    $('resWait').classList.add('hidden');
    leaveRaceUI();
    show('scrResults');
  }
  $('resAgain').addEventListener('click', () => {
    if (G && G.mode === 'mp') { if (amHost()) net.send({ t: 'rematch' }); G = null; showLobby(); return; }
    restartSingle();
  });
  $('resMenu').addEventListener('click', quitToMenu);

  /* ---------- 試駕 ---------- */
  function renderTestPanel() {
    const cur = G.race.cars[0].carId;
    $('testCars').innerHTML = D.CAR_ORDER.map((id, i) => `<button data-car="${id}" class="${id === cur ? 'sel' : ''}">${i + 1} ${D.CARS[id].name}</button>`).join('');
    $('testCars').querySelectorAll('button').forEach(b => b.addEventListener('click', () => switchTestCar(b.dataset.car)));
    $('testTimes').innerHTML = '<tr><td>車款</td><td>上一圈</td><td>最快</td></tr>' + D.CAR_ORDER.map(id => {
      const t = G.testTimes[id] || [];
      return `<tr><td>${D.CARS[id].name}</td><td>${fmt(t[t.length - 1])}</td><td>${fmt(t.length ? Math.min(...t) : null)}</td></tr>`;
    }).join('');
  }
  function switchTestCar(id) {
    if (!G || G.mode !== 'test' || !D.CARS[id]) return;
    const e = G.race.cars[0];
    e.carId = id; e.spec = D.CARS[id];
    e.car = P.createCar(G.race.track.grid[0], []);
    e.cp = 0; e.lapsDone = 0; e.lapTimes = []; e.lapStart = G.race.time;
    save.data.garage.car = id; save.persist();
    renderTestPanel(); flash(`換成 ${D.CARS[id].name}`);
  }
  $('testExit').addEventListener('click', () => { G = null; leaveRaceUI(); show('scrGarage'); });

  /* ================= HUD ================= */
  let hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }

  function updateHud(v) {
    // v：{ lap, laps, lapT, total, best, pos, n, car, spec, skillsOn, board, cd, phase }
    setText('hLap', `${Math.min(v.lap, v.laps)} / ${v.laps > 50 ? '∞' : v.laps}`);
    setText('hLapT', fmt(v.lapT));
    setText('hTotal', fmt(v.total));
    setText('hBest', fmt(v.best));
    setText('hPos', `${v.pos} / ${v.n}`);
    const sp = Math.hypot(v.car.vx, v.car.vy);
    setText('hSpeed', String(Math.round(sp * D.KMH)));
    if (v.phase === 'countdown') { $('cd').classList.remove('hidden'); setText('cd', String(Math.max(1, Math.ceil(v.cd)))); }
    if (v.skillsOn) {
      const e = v.car.energy;
      $('energyFill').style.width = (e / D.ENERGY.max * 100).toFixed(1) + '%';
      setText('energyTxt', `能量 ${Math.floor(e)} / ${D.ENERGY.max}`);
      v.car.skills.forEach((s, i) => {
        const el = $('sk' + (i + 1)), sk = D.SKILLS[s.id];
        el.style.setProperty('--sk', sk.color);
        el.querySelector('i').textContent = sk.icon; el.querySelector('i').style.color = sk.color;
        el.querySelector('b').textContent = sk.name;
        el.querySelector('.cd').style.width = (s.cd / sk.cooldown * 100).toFixed(0) + '%';
        el.classList.toggle('ready', s.cd <= 0 && e >= sk.cost);
        el.classList.toggle('poor', e < sk.cost);
        el.classList.toggle('active', v.car.fx[s.id] > 0);
        const tb = $('tS' + (i + 1));
        setText('tS' + (i + 1), `${sk.name}${s.cd > 0 ? ' ' + Math.ceil(s.cd) : ''}`);
        tb.style.opacity = s.cd <= 0 && e >= sk.cost ? 1 : 0.5;
      });
    }
    if (v.board) {
      const html = v.board.map(b => `<li class="${b.me ? 'me' : ''} ${b.fin ? 'fin' : ''} ${b.dnf ? 'dnf' : ''}">${esc(b.name)}${b.fin ? ' ✔' : b.dnf ? ' ✖' : ''}${b.disc ? ' ⚠' : ''}</li>`).join('');
      if (hudCache.board !== html) { hudCache.board = html; $('board').innerHTML = html; }
    }
    // 招牌彎提示
    const tr = v.track, sig = tr.signature;
    if (sig && v.phase === 'race') {
      const d = (sig.i - v.car.idx + tr.N) % tr.N;
      if (d < 35 && G.sigLap !== v.lap) { G.sigLap = v.lap; const s = $('sig'); s.textContent = `招牌彎・${sig.name}｜${sig.hint}`; s.classList.remove('hidden'); setTimeout(() => s.classList.add('hidden'), 3200); }
    }
    // 逆向／駛出賽道
    const p = tr.pts[v.car.idx];
    const along = sp > 1 ? (v.car.vx * p.tx + v.car.vy * p.ty) / sp : 1;
    G.wrongT = along < -0.5 && sp > 80 ? G.wrongT + 1 / 60 : 0;
    let warn = '';
    if (v.phase === 'race' && !v.finished) {
      if (G.wrongT > 0.8) warn = '⚠ 逆向行駛';
      else if (v.car.surf === 'grass') warn = '⚠ 駛出賽道';
      else if (v.wait) warn = v.wait;
    } else if (v.wait) warn = v.wait;
    $('warn').classList.toggle('hidden', !warn); setText('warn', warn);
  }

  let mmTick = 0;
  function drawMini(track, dots) { if (mmTick++ % 3 === 0) R.drawMinimap($('minimap'), track, dots, { bg: true }); }

  /* ================= 主迴圈 ================= */
  let last = performance.now();
  function frame(now) {
    const fdt = Math.min(0.5, (now - last) / 1000); last = now;
    if (G && G.mode === 'mp') mpTick(fdt);
    else if (G) singleTick(fdt);
    else demoTick(fdt);
    if (G && G.msgT > 0) { G.msgT -= fdt; if (G.msgT <= 0) $('msg').classList.add('hidden'); }
    // 手機直向提示
    const portrait = G && !G.ended && touchUI() && innerHeight > innerWidth;
    $('rotate').classList.toggle('hidden', !portrait);
    if (portrait && G.mode !== 'mp' && !G.paused) pause('請將手機轉為橫向');
    drawFrame(fdt, now);
    requestAnimationFrame(frame);
  }

  function viewCar(e, race, opts) {
    const c = e.car;
    return { x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, slip: c.slip, surf: c.surf, carId: e.carId, cos: e.cos,
      brake: c.brakeLight, nitro: c.fx.nitro > 0, grip: c.fx.grip > 0, me: opts.me, label: opts.label,
      ghosted: race.phase === 'race' && race.time < race.opts.ghostTime && race.cars.length > 1 };
  }

  function follow(c, fdt) {
    const sp = Math.hypot(c.vx, c.vy);
    const k = Math.min(1, 6 * fdt);
    cam.x += (c.x + c.vx * 0.25 - cam.x) * k; cam.y += (c.y + c.vy * 0.25 - cam.y) * k;
    cam.zoom += ((1 - 0.22 * Math.min(1, sp / 700)) - cam.zoom) * k;
    cam.shake = c.surf === 'grass' ? Math.min(1.5, sp / 200) : 0;
    return sp;
  }

  function drawFrame(fdt, now) {
    if (G && G.mode === 'mp') return drawMp(fdt, now);
    const race = G ? G.race : demo && demo.race;
    if (!race) return;
    const me = G ? race.get('me') : race.cars[0];
    const sp = follow(me.car, fdt);
    const cars = race.cars.map(e => viewCar(e, race, { me: e.id === 'me', label: G && G.mode === 'arcade' ? (e.id === 'me' ? '你' : e.name) : null }));
    if (G && G.ghost && G.ghost.f && race.phase === 'race') {
      const f = G.ghost.f, t = race.time / G.ghost.dt, i = Math.floor(t) * 3;
      if (i + 5 < f.length) {
        const u = t - Math.floor(t);
        cars.unshift({ x: f[i] + (f[i + 3] - f[i]) * u, y: f[i + 1] + (f[i + 4] - f[i + 1]) * u, a: (f[i + 2] + (f[i + 5] - f[i + 2]) * u) / 100,
          vx: 0, vy: 0, carId: me.carId, cos: { trail: 'none' }, ghostRun: true, label: '最佳幽靈' });
      }
    }
    renderer.draw({ cars, cam, time: now, speedRatio: Math.min(1, sp / 700), velAngle: Math.atan2(me.car.vy, me.car.vx),
      nitro: me.car.fx.nitro > 0, nextCp: me.cp % race.K }, fdt);
    if (!G) return;
    const best = G.mode === 'test' ? null : (save.getRecord(G.trackId, me.carId) || {}).time;
    const wait = G.mode === 'arcade' && me.finished && race.deadline != null ? `等待其他車手完賽：剩 ${Math.max(0, Math.ceil(race.deadline - race.time))} 秒` : '';
    updateHud({
      lap: me.lapsDone + 1, laps: race.opts.laps, lapT: race.phase === 'race' ? race.time - me.lapStart : 0,
      total: race.time, best, pos: me.rank, n: race.cars.length, car: me.car, skillsOn: race.opts.skills,
      phase: race.phase, cd: race.countdown, track: race.track, finished: me.finished, wait,
      board: G.mode === 'arcade' ? race.rankCars().map(e => ({ name: e.id === 'me' ? '你' : e.name, me: e.id === 'me', fin: e.finished, dnf: e.dnf })) : null
    });
    drawMini(race.track, race.cars.map(e => ({ x: e.car.x, y: e.car.y, me: e.id === 'me', color: e.id === 'me' ? '#ffe14a' : R.carColors(e.carId, e.cos).body })));
  }

  /* ---------- 選單背景展示 ---------- */
  let demoIdx = 0;
  function newDemo() {
    const id = D.TRACK_ORDER[demoIdx++ % D.TRACK_ORDER.length];
    const race = new S.Race({ trackId: id, laps: 2, skills: true, countdown: 0.01 });
    for (let k = 0; k < 4; k++) race.addCar({ id: 'd' + k, name: AI_NAMES[k], carId: D.CAR_ORDER[k], ai: 'hard', skills: ['nitro', 'grip'], cos: { trail: 'neon' } });
    demo = { race, acc: 0 };
    renderer.setTrack(race.track);
    cam.x = race.cars[0].car.x; cam.y = race.cars[0].car.y;
  }
  function demoTick(fdt) {
    if (!demo || demo.race.phase === 'done' || demo.race.time > 40) newDemo();
    demo.acc += fdt;
    while (demo.acc >= DT) { demo.race.step(); demo.acc -= DT; }
  }

  /* ================= 多人 ================= */
  let net = null;
  function ensureNet() {
    if (net) return net;
    net = Net.createClient();
    net.on('status', renderMpStatus);
    net.on('welcome', m => {
      if (!m.room && G && G.mode === 'mp') { toast('房間已不存在（伺服器可能已重新啟動）'); G = null; leaveRaceUI(); show('scrMp'); }
      if (pendingAction) { const a = pendingAction; pendingAction = null; net.send(a); }
    });
    net.on('room', m => onRoom(m.room));
    net.on('err', m => {
      const text = m.msg || '發生錯誤';
      if (screen === 'scrLobby') $('lbErr').textContent = text; else $('mpErr').textContent = text;
      toast(text);
      if (m.code === 'NOT_IN_ROOM' && screen === 'scrLobby') show('scrMp');
    });
    net.on('start', m => startMp(m));
    net.on('s', m => onSnap(m));
    net.on('ev', m => { if (G && G.mode === 'mp') for (const x of m.list) handleEvent(x, net.id, G.names); });
    net.on('results', m => onResults(m));
    net.on('kicked', m => { toast(m.msg || '已離開房間'); if (G && G.mode === 'mp') { G = null; leaveRaceUI(); } show('scrMp'); });
    return net;
  }
  let pendingAction = null;

  function renderMpStatus() {
    if (!net) return;
    const el = $('mpStatus'), s = net.status;
    const text = {
      online: `● 已連線伺服器${net.latency != null ? `・延遲 ${Math.round(net.latency)} ms` : ''}`,
      connecting: '● 連線中…',
      offline: '● 離線：無法連到伺服器，正在自動重試（單機模式仍可遊玩）',
      idle: '● 尚未連線',
      unavailable: isApp ? '● 此 App 尚未設定正式伺服器位址' : '● 目前以檔案直接開啟，沒有多人伺服器。請用 npm start 或公開網址開啟'
    }[s];
    el.textContent = text; el.className = 'status ' + s;
    $('mpCreate').disabled = s !== 'online'; $('mpJoin').disabled = s !== 'online';
    const badge = $('netBadge');
    if (G && G.mode === 'mp') {
      badge.textContent = s === 'online' ? `連線良好・${Math.round(net.latency || 0)} ms` : '連線中斷，正在重新連線…';
      badge.style.color = s === 'online' ? '#3dff9a' : '#ff6b6b';
    }
    if (screen === 'scrLobby') $('lbCount').textContent = net.room ? `${humans(net.room)} / ${net.room.max} 人` : '';
  }
  function openMp() {
    ensureNet();
    $('nick').value = save.data.profile.name || '';
    $('mpErr').textContent = '';
    if (net.status === 'idle' || net.status === 'offline') net.connect(save.data.profile.name);
    renderMpStatus();
  }
  function nickOk() {
    const n = $('nick').value.replace(/[\u0000-\u001f]/g, '').trim();
    if (!n) { $('mpErr').textContent = '請先輸入暱稱'; $('nick').focus(); return null; }
    save.data.profile.name = n.slice(0, 12); save.persist();
    return save.data.profile.name;
  }
  $('mpCreate').addEventListener('click', () => { const n = nickOk(); if (n) { $('mpErr').textContent = ''; net.send({ t: 'create', name: n }); } });
  $('mpJoin').addEventListener('click', () => {
    const n = nickOk(); if (!n) return;
    const code = $('roomCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('mpErr').textContent = '房號是 4 碼英數字'; return; }
    $('mpErr').textContent = '';
    net.send({ t: 'join', code, name: n });
  });
  $('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('mpJoin').click(); });

  const humans = room => room.players.filter(p => !p.ai).length;
  const amHost = () => net && net.room && net.room.host === net.id;
  const myPlayer = () => net && net.room && net.room.players.find(p => p.id === net.id);

  function onRoom(room) {
    if (!room) return;
    if (room.phase === 'lobby' && (screen === 'scrMp' || screen === 'scrLobby' || screen === 'scrResults' && !G)) showLobby();
    else if (screen === 'scrLobby') renderLobby();
    renderMpStatus();
  }
  function showLobby() {
    show('scrLobby'); $('lbErr').textContent = '';
    const me = myPlayer();
    if (me && !lobbySetupSent) { lobbySetupSent = true; sendSetup(); }
    renderLobby();
  }
  let lobbySetupSent = false;
  function inviteLink(code) {
    const base = Net.httpBase() || location.origin;
    return `${base}/?room=${code}`;
  }
  function fillSelect(sel, items, value) {
    const html = items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
    sel.value = value;
  }
  function renderLobby() {
    const room = net && net.room; if (!room) return;
    const host = amHost(), me = myPlayer();
    $('lbCode').textContent = room.code;
    $('lbCount').textContent = `${humans(room)} / ${room.max} 人`;
    $('lbLink').value = inviteLink(room.code);
    $('lbPlayers').innerHTML = room.players.map(p => `<li><span>${esc(p.name)}
      ${p.id === room.host ? '<span class="tag">房主</span>' : ''}${p.id === net.id ? '<span class="tag">你</span>' : ''}</span>
      <span>${esc(D.CARS[p.car] ? D.CARS[p.car].name : '')}　${!p.connected ? '<b class="disc">斷線中</b>' : p.ready || p.id === room.host ? '<b class="ready">已準備</b>' : '<b class="wait">未準備</b>'}</span></li>`).join('')
      + (room.settings.aiFill ? `<li><span class="hint">另有 ${room.max - humans(room)} 台 AI 補位（${D.DIFFICULTY[room.settings.aiDiff].name}）</span></li>` : '');
    const s = room.settings;
    fillSelect($('lbTrack'), D.TRACK_ORDER.map(id => [id, D.TRACKS[id].name]), s.track);
    fillSelect($('lbLaps'), D.RULES.lapsChoices.map(n => [n, n + ' 圈']), String(s.laps));
    $('lbSkills').checked = s.skills; $('lbAi').checked = s.aiFill; $('lbAiDiff').value = s.aiDiff;
    ['lbTrack', 'lbLaps', 'lbSkills', 'lbAi', 'lbAiDiff'].forEach(id => { $(id).disabled = !host; });
    $('lbHostNote').textContent = host ? '（你是房主，可修改）' : '（由房主設定）';
    $('lbRules').innerHTML = `地圖：<b>${esc(D.TRACKS[s.track].name)}</b>｜${s.laps} 圈｜技能：${s.skills ? '開放' : '關閉'}｜AI 補位：${s.aiFill ? '開（' + D.DIFFICULTY[s.aiDiff].name + '）' : '關'}<br>
      公平規則：所有人使用相同的車輛物理數值，等級只解鎖外觀與技能配置欄。起跑後 ${D.RULES.ghostTime} 秒內車輛互相穿透；第一名完賽後 ${D.RULES.finishTimeout} 秒統一結算，未抵達者記為未完賽。`;
    if (me) {
      fillSelect($('lbCar'), D.CAR_ORDER.map(id => [id, `${D.CARS[id].name}（${D.CARS[id].type}）`]), me.car);
      const sk = D.SKILL_ORDER.map(id => [id, D.SKILLS[id].name]);
      fillSelect($('lbSk1'), sk, me.skills[0]); fillSelect($('lbSk2'), sk, me.skills[1]);
      $('lbSk1').disabled = $('lbSk2').disabled = !s.skills;
      $('lbReady').textContent = me.ready ? '取消準備' : '準備';
      $('lbReady').classList.toggle('hidden', host);
    }
    const others = room.players.filter(p => p.id !== room.host && !p.ai);
    const allReady = others.every(p => p.ready || !p.connected);
    $('lbStart').classList.toggle('hidden', !host);
    $('lbStart').disabled = !allReady;
    $('lbStart').textContent = allReady ? '開始比賽' : '等待其他人準備';
  }
  function sendSetup() {
    const car = $('lbCar').value || save.data.garage.car;
    let s1 = $('lbSk1').value, s2 = $('lbSk2').value;
    if (!s1 || !s2) { [s1, s2] = save.currentSkills(); }
    if (s1 === s2) s2 = D.SKILL_ORDER.find(x => x !== s1);
    net.send({ t: 'setup', car, skills: [s1, s2], cos: save.data.garage.cos });
  }
  ['lbCar', 'lbSk1', 'lbSk2'].forEach(id => $(id).addEventListener('change', () => {
    if (id === 'lbCar') { save.data.garage.car = $('lbCar').value; save.persist(); }
    sendSetup();
  }));
  ['lbTrack', 'lbLaps', 'lbSkills', 'lbAi', 'lbAiDiff'].forEach(id => $(id).addEventListener('change', () => {
    if (!amHost()) return;
    net.send({ t: 'settings', track: $('lbTrack').value, laps: +$('lbLaps').value, skills: $('lbSkills').checked, aiFill: $('lbAi').checked, aiDiff: $('lbAiDiff').value });
  }));
  $('lbReady').addEventListener('click', () => { const me = myPlayer(); net.send({ t: 'ready', v: !(me && me.ready) }); });
  $('lbStart').addEventListener('click', () => net.send({ t: 'start' }));
  $('lbLeave').addEventListener('click', () => { mpLeave(); show('scrMp'); });
  $('lbCopy').addEventListener('click', async () => {
    const link = $('lbLink').value;
    try { await navigator.clipboard.writeText(link); toast('已複製邀請連結'); }
    catch (e) { $('lbLink').select(); document.execCommand && document.execCommand('copy'); toast('已選取連結，請手動複製'); }
  });
  function mpLeave() { if (net) net.send({ t: 'leave' }); lobbySetupSent = false; if (net) net.room = null; }

  function startMp(m) {
    if (G && G.mode === 'mp' && G.raceId === m.raceId) return; // 重連時重送，不重建
    const track = T.get(D.TRACKS, m.settings.track);
    const mine = m.grid.find(g => g.id === net.id);
    if (!mine) return;
    const names = {}; m.grid.forEach(g => { names[g.id] = g.name; });
    G = { mode: 'mp', raceId: m.raceId, track, trackId: m.settings.track, settings: m.settings, grid: m.grid, names,
      pred: Net.createPredictor(m.settings.track, mine.car, mine.skills), interp: Net.createInterpolator(),
      acc: 0, phase: 'countdown', cd: D.RULES.countdown, time: 0, timeAt: performance.now(), meId: net.id, carId: mine.car,
      snapMe: null, cars: [], ended: false, wrongT: 0, sigLap: -1, msgT: 0, deadline: null };
    renderer.setTrack(track);
    cam.x = track.grid[mine.slot].x; cam.y = track.grid[mine.slot].y;
    enterRaceUI();
    renderMpStatus();
  }
  function onSnap(m) {
    if (!G || G.mode !== 'mp' || m.raceId !== G.raceId) return;
    G.phase = m.phase; G.cd = m.cd; G.time = m.time; G.timeAt = performance.now(); G.deadline = m.deadline;
    G.interp.push({ st: m.st, cars: m.cars });
    G.cars = m.cars;
    G.snapMe = m.cars.find(c => c.id === G.meId);
    if (m.me && !(G.snapMe && (G.snapMe.fin || G.snapMe.dnf))) G.pred.reconcile(m.me, m.ack, !G.settings.skills);
    else if (m.me && !G.pred.car) G.pred.reset(m.me);
  }
  function mpTick(fdt) {
    if (G.ended) return;
    G.acc += fdt;
    let n = 0;
    const active = G.phase === 'race' && G.snapMe && !G.snapMe.fin && !G.snapMe.dnf;
    while (G.acc >= DT && n < 30) {
      const inp = I.read(true);
      const pkt = G.pred.step(inp, active, !G.settings.skills);
      if (active) net.send(pkt);
      G.acc -= DT; n++;
    }
  }
  function drawMp(fdt, now) {
    const renderT = net.serverNow() - 110;
    const sm = G.interp.sample(renderT);
    const others = sm ? sm.cars : [];
    const pc = G.pred.car;
    const meSnap = G.snapMe;
    const predicted = pc && meSnap && !meSnap.fin && !meSnap.dnf;
    const look = c => ({ x: c.x, y: c.y, a: c.a, vx: c.vx || 0, vy: c.vy || 0, slip: c.sl || 0, surf: c.sf || 'road',
      brake: !!c.b, nitro: !!c.n, grip: !!c.g });
    const cars = [];
    for (const c of others) {
      if (c.id === G.meId && predicted) continue;
      const info = G.grid.find(g => g.id === c.id) || {};
      cars.push(Object.assign(look(c), { carId: info.car || 'swift', cos: info.cos || {}, label: (info.name || '') + (c.dc ? '（斷線）' : ''),
        me: c.id === G.meId, ghosted: c.gh }));
    }
    let meView;
    if (predicted) {
      const s = G.pred.smooth;
      meView = { x: pc.x + s.x, y: pc.y + s.y, a: pc.a + s.a, vx: pc.vx, vy: pc.vy, slip: pc.slip, surf: pc.surf, carId: G.carId,
        cos: save.data.garage.cos, brake: pc.brakeLight, nitro: pc.fx.nitro > 0, grip: pc.fx.grip > 0, me: true, label: '你',
        ghosted: meSnap && meSnap.gh };
      cars.push(meView);
    } else meView = cars.find(c => c.me) || { x: cam.x, y: cam.y, vx: 0, vy: 0, surf: 'road' };
    const sp = follow(meView, fdt);
    renderer.draw({ cars, cam, time: now, speedRatio: Math.min(1, sp / 700), velAngle: Math.atan2(meView.vy, meView.vx),
      nitro: meView.nitro, nextCp: meSnap ? meSnap.cp % G.track.cps.length : 1 }, fdt);
    const extra = G.phase === 'race' ? (performance.now() - G.timeAt) / 1000 : 0;
    const total = G.time + extra;
    const carState = pc || P.createCar(G.track.grid[0], []);
    const board = G.cars.slice().sort((a, b) => a.rk - b.rk).map(c => ({ name: (G.names[c.id] || '?') + (c.id === G.meId ? '（你）' : ''), me: c.id === G.meId, fin: c.fin, dnf: c.dnf, disc: c.dc }));
    const wait = meSnap && meSnap.fin && G.deadline != null ? `等待其他車手：剩 ${Math.max(0, Math.ceil(G.deadline - total))} 秒` : '';
    updateHud({
      lap: meSnap ? meSnap.lap + 1 : 1, laps: G.settings.laps, lapT: meSnap && G.phase === 'race' ? total - meSnap.ls : 0, total,
      best: null, pos: meSnap ? meSnap.rk : 1, n: G.cars.length || 1, car: Object.assign({}, carState, { idx: carState.idx, vx: meView.vx, vy: meView.vy }),
      skillsOn: G.settings.skills, phase: G.phase, cd: G.cd, track: G.track, finished: meSnap && meSnap.fin, wait, board
    });
    drawMini(G.track, cars.map(c => ({ x: c.x, y: c.y, me: c.me, color: c.me ? '#ffe14a' : R.carColors(c.carId, c.cos).body })));
  }
  function onResults(m) {
    if (!G || G.mode !== 'mp' || G.raceId !== m.raceId) {
      // 重連後補收結算：仍然只會發放一次經驗值
      if (!m.raceId) return;
    }
    const meRow = m.standings.find(s => s.id === net.id);
    const parts = (m.xp && m.xp[net.id]) ? m.xp[net.id].slice() : [];
    if (meRow && meRow.finished && save.markCompleted(m.trackId)) parts.push({ label: `首次完成「${D.TRACKS[m.trackId].name}」`, xp: D.XP.firstMap });
    const xp = save.awardXP(m.raceId, parts);
    if (G && G.mode === 'mp') G.ended = true;
    else G = { mode: 'mp', ended: true, raceId: m.raceId };
    showResults({
      title: meRow ? (meRow.finished ? `第 ${meRow.rank} 名完賽！` : '未完賽') : '比賽結束',
      time: meRow && meRow.finished ? meRow.time : null, isNew: false, laps: meRow ? meRow.lapTimes : [],
      standings: m.standings.map(s => Object.assign({}, s, { carId: s.car })), meId: net.id, parts, xp
    });
  }

  /* ================= PWA：安裝、更新、APK ================= */
  let deferredInstall = null, swReg = null, updateReady = false, userRequestedUpdate = false;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('installBtn').classList.add('hidden');
  });
  function refreshUpdateBtn() {
    // 只在選單或結算畫面提示更新，比賽中不打斷
    const ok = updateReady && (screen === 'scrMenu' || screen === 'scrResults');
    $('updateBtn').classList.toggle('hidden', !ok);
    if (ok && screen === 'scrResults' && !$('scrResults').contains($('updateBtn'))) $('scrResults').appendChild($('updateBtn'));
    if (ok && screen === 'scrMenu' && !$('scrMenu').contains($('updateBtn'))) $('installBtn').parentNode.appendChild($('updateBtn'));
  }
  $('updateBtn').addEventListener('click', () => {
    if (!swReg || !swReg.waiting) { location.reload(); return; }
    userRequestedUpdate = true; swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !isApp) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      swReg = reg;
      const mark = () => { if (reg.waiting && navigator.serviceWorker.controller) { updateReady = true; refreshUpdateBtn(); } };
      mark();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') mark(); });
      });
      setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (userRequestedUpdate) location.reload(); });
  }
  // APK 下載：伺服器確認檔案真的存在才顯示
  (function checkApk() {
    if (isApp) return;
    const base = Net.httpBase(); if (!base) return;
    fetch(base + '/api/info', { cache: 'no-store' }).then(r => r.json()).then(info => {
      if (info && info.apk && info.apk.url) { const a = $('apkBtn'); a.href = base + info.apk.url; a.textContent = `下載 Android App（APK ${info.apk.version || ''}，${(info.apk.size / 1048576).toFixed(1)} MB）`; a.classList.remove('hidden'); }
    }).catch(() => {});
  })();

  /* ================= 啟動 ================= */
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(roomParam)) {
    show('scrMp'); $('roomCode').value = roomParam;
    if (save.data.profile.name) {
      pendingAction = { t: 'join', code: roomParam, name: save.data.profile.name };
      if (net && net.status === 'online') { net.send(pendingAction); pendingAction = null; }
    } else $('mpErr').textContent = '輸入暱稱後按「加入房間」';
  } else show('scrMenu');
  addEventListener('keydown', e => {
    if (!G && screen === 'scrMenu' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement === document.body) {
      e.preventDefault(); ui.mode = 'tt'; show('scrTracks');
    }
  });
  newDemo();
  requestAnimationFrame(frame);

  // 測試用：暴露少量狀態（不影響遊戲）
  NND.app = { get game() { return G; }, save, get net() { return net; }, show };
})();
