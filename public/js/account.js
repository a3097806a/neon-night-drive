/* 霓虹夜行：車手帳號與雲端同步（瀏覽器端）
 * - 訪客：進度只在此裝置的 localStorage（neonNightDrive.save）
 * - 登入：以玩家帳號 ID 在伺服器資料庫保存暱稱、總經驗值、等級、已解鎖項目與已完成地圖；
 *         此裝置另存一份快取（neonNightDrive.acct.<帳號ID>），離線時顯示上次同步的資料
 */
(function () {
  'use strict';
  const NND = window.NND;
  const SESSION_KEY = 'nnd.session', DEVICE_KEY = 'nnd.device';
  const listeners = [];

  function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function writeSession(s) { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* 無法寫入 */ } }
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* 無 */ }
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
      const a = new Uint8Array(16); crypto.getRandomValues(a);
      id = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* 無 */ }
    }
    return id;
  }

  const A = {
    session: readSession(),
    status: 'guest',      // guest | syncing | synced | offline | error | unavailable
    detail: '',
    lastSync: null,
    get token() { return A.session && A.session.token; },
    get loggedIn() { return !!(A.session && A.session.token); },
    get available() { return !!NND.net.httpBase(); },
    onChange(fn) { listeners.push(fn); },
    deviceId
  };
  function set(status, detail) { A.status = status; A.detail = detail || ''; listeners.forEach(fn => fn(A)); }

  /** 呼叫 API；網路錯誤時丟出 { network: true } */
  async function api(method, path, body) {
    const base = NND.net.httpBase();
    if (!base) throw { network: true, msg: '沒有可用的伺服器' };
    const headers = { 'Content-Type': 'application/json' };
    if (A.token) headers.Authorization = 'Bearer ' + A.token;
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (e) { throw { network: true, msg: '無法連到伺服器' }; }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 空內容 */ }
    if (!res.ok) throw Object.assign({ status: res.status }, data);
    return data;
  }
  A.api = api;

  A.register = (username, password, nickname) => api('POST', '/api/auth/register', { username, password, nickname });
  A.login = (username, password) => api('POST', '/api/auth/login', { username, password });
  A.saveSession = (token, profile) => { A.session = { token, accountId: profile.id, username: profile.username }; writeSession(A.session); };
  A.logout = async () => {
    const t = A.token;
    A.session = null; writeSession(null); set('guest');
    if (t) { try { await fetch(NND.net.httpBase() + '/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); } catch (e) { /* 離線也照樣登出 */ } }
  };

  /**
   * 與雲端同步：先送出暫存的單機獎勵，再取回最新帳號資料。
   * mirror：此帳號的本機快取存檔。回傳最新 profile；登入失效時回傳 null。
   */
  A.sync = async mirror => {
    if (!A.loggedIn) return null;
    set('syncing');
    try {
      const pend = mirror.data.pending.slice();
      for (const item of pend) {
        try { await api('POST', '/api/me/awards', item); }
        catch (e) { if (e.network) throw e; if (e.status === 429) break; /* 其他錯誤：該筆無效，丟棄 */ }
        mirror.data.pending = mirror.data.pending.filter(x => x.raceId !== item.raceId); mirror.persist();
      }
      const { profile } = await api('GET', '/api/me');
      mirror.applyCloud(profile);
      A.lastSync = Date.now();
      set(mirror.data.pending.length ? 'offline' : 'synced', mirror.data.pending.length ? `還有 ${mirror.data.pending.length} 筆待同步` : '');
      return profile;
    } catch (e) {
      if (e.status === 401) { await A.logout(); set('guest', '登入已失效，請重新登入'); return null; }
      set(e.network ? 'offline' : 'error', e.network ? '離線中，顯示上次同步的資料' : (e.msg || '同步失敗'));
      throw e;
    }
  };

  /** 單機比賽獎勵：交給伺服器計算與記錄；離線時暫存，之後重送（以比賽 ID 去重，不會重複領取） */
  A.submitSolo = async (mirror, report) => {
    try {
      const r = await api('POST', '/api/me/awards', report);
      if (r.profile) mirror.applyCloud(r.profile);
      A.lastSync = Date.now(); set('synced');
      return r;
    } catch (e) {
      if (e.network || e.status >= 500 || e.status === 429) {
        if (!mirror.data.pending.some(x => x.raceId === report.raceId)) mirror.data.pending.push(report);
        mirror.persist();
        set('offline', `還有 ${mirror.data.pending.length} 筆待同步`);
        return { pending: true };
      }
      if (e.status === 401) { await A.logout(); set('guest', '登入已失效，請重新登入'); }
      return { error: e.msg || '無法寫入帳號' };
    }
  };

  A.importLocal = guest => api('POST', '/api/me/import', {
    deviceId: deviceId(), totalXp: guest.totalXp(), completed: Object.keys(guest.data.completed)
  });
  A.setNickname = nickname => api('PATCH', '/api/me', { nickname });
  A.fetchMe = () => api('GET', '/api/me');

  /** 介面用文字 */
  A.label = () => {
    if (!A.loggedIn) return { cls: 'guest', text: '訪客・進度儲存在此裝置' };
    const t = A.lastSync ? new Date(A.lastSync).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
    switch (A.status) {
      case 'syncing': return { cls: 'syncing', text: '雲端同步中…' };
      case 'synced': return { cls: 'synced', text: `雲端已同步${t ? '（' + t + '）' : ''}` };
      case 'offline': return { cls: 'offline', text: '離線：' + (A.detail || '顯示上次同步的資料，連線後自動重試') };
      case 'error': return { cls: 'offline', text: '同步失敗：' + A.detail };
      default: return { cls: 'syncing', text: '雲端帳號' };
    }
  };

  NND.account = A;
})();
