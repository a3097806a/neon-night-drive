'use strict';
/* 霓虹夜行：車手帳號與雲端存檔（SQLite，使用 Node 內建 node:sqlite）
 * 資料庫檔案位於 DATA_DIR（預設 ./data）。正式環境請把 DATA_DIR 放在主機的「持久化磁碟／Volume」上，
 * 重新部署後資料才會保留。
 *
 * 唯一識別：
 *   accounts.id         玩家帳號 ID（隨機 UUID，暱稱可重複）
 *   accounts.username   登入用帳號名稱（不分大小寫唯一）
 *   awards(account_id, race_id)  每場比賽每位玩家只能領一次
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const D = require('../public/shared/data.js');

const SCHEMA_VERSION = 1;
const SESSION_DAYS = 60;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('hex')}$${key.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [alg, n, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32, { N: +n, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

class Store {
  constructor(dir) {
    this.dir = dir;
    if (dir !== ':memory:') fs.mkdirSync(dir, { recursive: true });
    this.file = dir === ':memory:' ? ':memory:' : path.join(dir, 'neon-night-drive.sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
    this.q = {
      insAccount: this.db.prepare(`INSERT INTO accounts (id, username, pass_hash, nickname, total_xp, completed, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, '{}', ?, ?)`),
      byUsername: this.db.prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE'),
      byId: this.db.prepare('SELECT * FROM accounts WHERE id = ?'),
      insSession: this.db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
      session: this.db.prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash = ?'),
      delSession: this.db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
      purgeSessions: this.db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
      setNick: this.db.prepare('UPDATE accounts SET nickname = ?, updated_at = ? WHERE id = ?'),
      insAward: this.db.prepare(`INSERT OR IGNORE INTO awards (account_id, race_id, source, xp, parts, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
      getAward: this.db.prepare('SELECT * FROM awards WHERE account_id = ? AND race_id = ?'),
      setProgress: this.db.prepare('UPDATE accounts SET total_xp = ?, completed = ?, updated_at = ? WHERE id = ?'),
      insImport: this.db.prepare('INSERT OR IGNORE INTO imports (account_id, device_id, created_at) VALUES (?, ?, ?)'),
      countAwards: this.db.prepare('SELECT COUNT(*) AS n FROM awards WHERE account_id = ?')
    };
  }

  migrate() {
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    if (v < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          pass_hash TEXT NOT NULL,
          nickname TEXT NOT NULL,
          total_xp INTEGER NOT NULL DEFAULT 0,
          completed TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS awards (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          race_id TEXT NOT NULL,
          source TEXT NOT NULL,
          xp INTEGER NOT NULL,
          parts TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (account_id, race_id)
        );
        CREATE TABLE IF NOT EXISTS imports (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          device_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (account_id, device_id)
        );
        PRAGMA user_version = ${SCHEMA_VERSION};`);
    }
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch (e2) { /* 已回復 */ } throw e; }
  }

  /** 對外公開的帳號資料（只回給本人） */
  profile(row) {
    const { level, xp } = D.levelFromTotal(row.total_xp);
    let completed = {};
    try { completed = JSON.parse(row.completed) || {}; } catch (e) { /* 損毀時當作空 */ }
    return { id: row.id, username: row.username, nickname: row.nickname, totalXp: row.total_xp, level, xp,
      xpNeeded: D.xpForLevel(level), unlocks: D.unlocksForLevel(level), completed, updatedAt: row.updated_at };
  }

  register(username, password, nickname) {
    const now = Date.now(), id = crypto.randomUUID();
    try { this.q.insAccount.run(id, username, hashPassword(password), nickname, now, now); }
    catch (e) { if (/UNIQUE/.test(e.message)) return { error: 'USERNAME_TAKEN' }; throw e; }
    return { account: this.q.byId.get(id) };
  }
  login(username, password) {
    const row = this.q.byUsername.get(username);
    if (!row) { hashPassword(password); return null; } // 讓「帳號不存在」與「密碼錯誤」耗時接近
    return checkPassword(password, row.pass_hash) ? row : null;
  }
  createSession(accountId) {
    const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
    this.q.insSession.run(sha256(token), accountId, now, now + SESSION_DAYS * 86400000);
    if (Math.random() < 0.05) this.q.purgeSessions.run(now);
    return token;
  }
  /** 由登入憑證取得帳號列；無效或過期回傳 null */
  accountForToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const s = this.q.session.get(sha256(token));
    if (!s || s.expires_at < Date.now()) return null;
    return this.q.byId.get(s.account_id) || null;
  }
  logout(token) { if (typeof token === 'string') this.q.delSession.run(sha256(token)); }
  get(id) { return this.q.byId.get(id) || null; }
  setNickname(id, nick) { this.q.setNick.run(nick, Date.now(), id); return this.get(id); }

  /**
   * 發放一場比賽的經驗值。以 (帳號 ID, 比賽 ID) 為唯一鍵，重複呼叫只會生效一次。
   * parts：[{ label, xp }]；trackId 與 finished 用來計算「首次完成地圖」。
   * 回傳 { granted, total, parts, levelsGained, unlocked, profile }
   */
  grant(accountId, raceId, source, parts, trackId, finished) {
    return this.tx(() => {
      const row = this.q.byId.get(accountId);
      if (!row) return { granted: false, error: 'NO_ACCOUNT' };
      const prev = this.q.getAward.get(accountId, raceId);
      if (prev) return { granted: false, total: prev.xp, parts: JSON.parse(prev.parts), levelsGained: 0, unlocked: [], profile: this.profile(row) };
      let completed = {};
      try { completed = JSON.parse(row.completed) || {}; } catch (e) { /* 空 */ }
      const all = parts.slice();
      if (finished && trackId && D.TRACKS[trackId] && !completed[trackId]) {
        completed[trackId] = true;
        all.push({ label: `首次完成「${D.TRACKS[trackId].name}」`, xp: D.XP.firstMap });
      }
      const total = all.reduce((s, p) => s + (p.xp | 0), 0);
      const r = this.q.insAward.run(accountId, raceId, source, total, JSON.stringify(all), Date.now());
      if (r.changes !== 1) return { granted: false, total: 0, parts: [], levelsGained: 0, unlocked: [], profile: this.profile(row) };
      const before = D.levelFromTotal(row.total_xp).level;
      this.q.setProgress.run(row.total_xp + total, JSON.stringify(completed), Date.now(), accountId);
      const after = this.profile(this.q.byId.get(accountId));
      const unlocked = D.unlocksForLevel(after.level).filter(u => !D.unlocksForLevel(before).includes(u));
      return { granted: true, total, parts: all, levelsGained: after.level - before, unlocked, profile: after };
    });
  }

  /**
   * 首次登入時「合併本機進度」：經驗值取較高者、完成地圖取聯集。
   * 每台裝置（deviceId）對同一帳號只能合併一次；取較高者的規則讓重複合併不會灌經驗。
   */
  importLocal(accountId, deviceId, totalXp, completed) {
    return this.tx(() => {
      const row = this.q.byId.get(accountId);
      if (!row) return { error: 'NO_ACCOUNT' };
      const ins = this.q.insImport.run(accountId, deviceId, Date.now());
      if (ins.changes !== 1) return { error: 'ALREADY_IMPORTED', profile: this.profile(row) };
      let cur = {};
      try { cur = JSON.parse(row.completed) || {}; } catch (e) { /* 空 */ }
      for (const t of completed) if (D.TRACKS[t] && D.TRACK_ORDER.includes(t)) cur[t] = true;
      const cap = D.totalFromLevel(D.MAX_LEVEL, 0);
      const total = Math.max(row.total_xp, Math.min(cap, Math.max(0, Math.floor(totalXp) || 0)));
      this.q.setProgress.run(total, JSON.stringify(cur), Date.now(), accountId);
      return { profile: this.profile(this.q.byId.get(accountId)) };
    });
  }

  close() { try { this.db.close(); } catch (e) { /* 已關閉 */ } }
}

module.exports = { Store, hashPassword, checkPassword };
