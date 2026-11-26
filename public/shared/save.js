/* 霓虹夜行：具版本號的本機存檔（等級、解鎖、設定、紀錄）與舊存檔升級
 * 存檔只存在「這個瀏覽器、這個網址」的 localStorage。
 * storage 參數可注入（測試用），預設為 window.localStorage。
 */
(function (root, factory) {
  const mod = factory(root.NND ? root.NND.data : null);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.NND = root.NND || {}; root.NND.save = mod; }
})(typeof self !== 'undefined' ? self : this, function (Dm) {
  'use strict';
  const D = Dm || require('./data.js');
  const KEY = 'neonNightDrive.save';
  const LEGACY_KEY = 'neonNightDriveBest'; // 第一版只存一個最佳總時間（秒）
  const VERSION = 2;
  const LEGACY_RECORD = 'city-legacy';     // 「舊版霓虹市區」紀錄鍵

  function blank() {
    return {
      version: VERSION,
      profile: { name: '', xp: 0, level: 1 },
      settings: { autoThrottle: false, quality: 'auto', showGhost: true },
      garage: { car: 'swift', presets: [['nitro', 'grip'], ['nitro', 'recharge'], ['grip', 'recharge']], preset: 0,
        cos: { paint: 'stock', rims: 'basic', taillight: 'red', trail: 'neon' } },
      records: {},          // 鍵：trackId|carId|v規則版本 → { time, laps, date, ghost }
      legacy: null,          // 舊版霓虹市區最佳紀錄 { time }
      completed: {},         // 已完成過的地圖 { trackId: true }
      awarded: [],           // 已發放經驗值的比賽 ID（防止重複發放）
      flags: { chargeTip: false },
      linked: {},            // 訪客存檔：已處理過「首次登入比較」的帳號 { 帳號ID: 'cloud' | 'merged' }
      pending: [],           // 帳號快取：尚未上傳的單機獎勵（離線時暫存，上線後重送）
      cloud: null            // 帳號快取：上次同步的雲端資料摘要
    };
  }

  /** 舊存檔升級：v1（只有 neonNightDriveBest）→ v2 */
  function migrate(obj, storage) {
    let s = obj && typeof obj === 'object' ? obj : null;
    if (!s || !s.version) {
      s = blank();
      try {
        const v = parseFloat(storage && storage.getItem(LEGACY_KEY));
        if (v > 0 && isFinite(v)) s.legacy = { time: v, from: 'v1' };
      } catch (e) { /* 無法讀取時略過 */ }
    }
    else if (!s.legacy && storage) {
      // 已是新版存檔但沒有舊版紀錄（例如先開過新版、後來才保留舊鍵）：補讀一次，不刪除原始鍵
      try {
        const v = parseFloat(storage.getItem(LEGACY_KEY));
        if (v > 0 && isFinite(v)) s.legacy = { time: v, from: 'v1' };
      } catch (e) { /* 略過 */ }
    }
    const b = blank();
    // 補上新版欄位，保留既有值
    for (const k of Object.keys(b)) if (s[k] == null) s[k] = b[k];
    for (const k of ['profile', 'settings', 'garage', 'flags']) s[k] = Object.assign({}, b[k], s[k]);
    s.garage.cos = Object.assign({}, b.garage.cos, s.garage.cos);
    if (!Array.isArray(s.garage.presets)) s.garage.presets = b.garage.presets;
    if (!Array.isArray(s.awarded)) s.awarded = [];
    if (!Array.isArray(s.pending)) s.pending = [];
    if (!s.linked || typeof s.linked !== 'object') s.linked = {};
    s.version = VERSION;
    return s;
  }

  /**
   * opts.key：存檔鍵（預設訪客存檔 KEY）
   * opts.legacy：是否讀取第一版舊紀錄（只有訪客存檔需要）
   */
  function create(storage, opts) {
    storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    opts = Object.assign({ key: KEY, legacy: true }, opts);
    const key = opts.key;
    let data;
    try { data = migrate(JSON.parse(storage ? storage.getItem(key) || 'null' : 'null'), opts.legacy ? storage : null); }
    catch (e) { data = migrate(null, opts.legacy ? storage : null); }

    const api = {
      get data() { return data; },
      key,
      persist() {
        try { storage && storage.setItem(key, JSON.stringify(data)); return true; } catch (e) { return false; }
      },
      /** 總經驗值（含之前各級已用掉的經驗） */
      totalXp() { return D.totalFromLevel(data.profile.level, data.profile.xp); },
      /** 有沒有值得保留的進度（用於首次登入的比較） */
      hasProgress() { return api.totalXp() > 0 || Object.keys(data.completed).length > 0; },
      /** 以雲端帳號資料覆蓋本機快取的車手進度（不動設定、車庫與賽道紀錄） */
      applyCloud(p) {
        const lv = D.levelFromTotal(p.totalXp);
        data.profile.level = lv.level; data.profile.xp = lv.xp;
        data.profile.name = p.nickname || data.profile.name;
        data.completed = Object.assign({}, p.completed || {});
        data.cloud = { accountId: p.id, username: p.username, unlocks: (p.unlocks || []).slice(), updatedAt: p.updatedAt, syncedAt: Date.now() };
        api.persist();
      },
      /** 解鎖後才能使用的外觀若已失效（例如選擇保留雲端進度後等級較低），換回預設 */
      fixCosmetics() {
        for (const kind of Object.keys(D.COSMETICS)) if (!api.isUnlocked(kind, data.garage.cos[kind])) data.garage.cos[kind] = D.COSMETICS[kind][0].id;
        if (data.garage.preset >= api.presetSlots()) data.garage.preset = 0;
      },
      recordKey(trackId, carId) { return `${trackId}|${carId}|v${D.RULES_VERSION}`; },
      getRecord(trackId, carId) { return data.records[api.recordKey(trackId, carId)] || null; },
      /** 取得某賽道（不分車款）的最佳成績 */
      bestForTrack(trackId) {
        let best = null;
        for (const [k, r] of Object.entries(data.records)) {
          if (k.startsWith(trackId + '|') && k.endsWith('|v' + D.RULES_VERSION) && (!best || r.time < best.time)) best = Object.assign({ car: k.split('|')[1] }, r);
        }
        return best;
      },
      /** 保存成績，回傳是否刷新紀錄 */
      submitTime(trackId, carId, time, laps, ghost) {
        const key = api.recordKey(trackId, carId), old = data.records[key];
        if (!(time > 0) || laps !== D.RULES.defaultLaps) return false; // 只有標準三圈列入紀錄
        if (old && old.time <= time) return false;
        data.records[key] = { time, laps, date: Date.now(), ghost: ghost || null };
        api.persist();
        return true;
      },
      level() { return data.profile.level; },
      xpNeeded() { return D.xpForLevel(data.profile.level); },
      /**
       * 發放經驗值；同一 raceId 只會發一次。
       * parts：[{ label, xp }]；回傳 { granted, total, levelsGained, unlocked }
       */
      awardXP(raceId, parts) {
        if (!raceId || data.awarded.includes(raceId)) return { granted: false, total: 0, levelsGained: 0, unlocked: [] };
        const total = parts.reduce((s, p) => s + (p.xp || 0), 0);
        data.awarded.push(raceId);
        if (data.awarded.length > 200) data.awarded.splice(0, data.awarded.length - 200);
        const before = data.profile.level;
        data.profile.xp += total;
        while (data.profile.level < D.MAX_LEVEL && data.profile.xp >= D.xpForLevel(data.profile.level)) {
          data.profile.xp -= D.xpForLevel(data.profile.level);
          data.profile.level++;
        }
        const unlocked = api.unlocksBetween(before + 1, data.profile.level);
        api.persist();
        return { granted: true, total, levelsGained: data.profile.level - before, unlocked };
      },
      /** 列出等級區間內解鎖的獎勵 */
      unlocksBetween(from, to) {
        const out = [];
        for (const [kind, list] of Object.entries(D.COSMETICS)) for (const c of list) if (c.level >= from && c.level <= to) out.push({ kind, id: c.id, name: c.name, level: c.level });
        D.PRESET_SLOTS.forEach((p, i) => { if (p.level >= from && p.level <= to && i > 0) out.push({ kind: 'preset', id: 'preset' + i, name: `技能配置欄 ${i + 1}`, level: p.level }); });
        return out.sort((a, b) => a.level - b.level);
      },
      nextUnlocks() { return api.unlocksBetween(data.profile.level + 1, D.MAX_LEVEL).slice(0, 3); },
      isUnlocked(kind, id) {
        const c = (D.COSMETICS[kind] || []).find(x => x.id === id);
        return !!c && c.level <= data.profile.level;
      },
      presetSlots() { return D.PRESET_SLOTS.filter(p => p.level <= data.profile.level).length; },
      currentSkills() {
        const i = Math.min(data.garage.preset, api.presetSlots() - 1);
        return data.garage.presets[i].slice(0, 2);
      },
      markCompleted(trackId) {
        if (data.completed[trackId]) return false;
        data.completed[trackId] = true; api.persist(); return true;
      },
      reset() { data = migrate(null, null); api.persist(); }
    };
    api.persist();
    return api;
  }

  /** 帳號快取的存檔鍵：每個帳號 ID 一份，不會與訪客存檔互相覆蓋 */
  const accountKey = id => 'neonNightDrive.acct.' + id;

  return { create, migrate, KEY, LEGACY_KEY, VERSION, LEGACY_RECORD, accountKey };
});
