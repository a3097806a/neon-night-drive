'use strict';
// 存檔測試：舊紀錄升級、經驗值只發一次、重新開啟後等級與解鎖仍存在
const test = require('node:test');
const assert = require('node:assert');
const D = require('../public/shared/data.js');
const Save = require('../public/shared/save.js');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}

test('原版 neonNightDriveBest 歸入「舊版霓虹市區」，且原始鍵保留', () => {
  const st = memStorage({ neonNightDriveBest: '83.456' });
  const s = Save.create(st);
  assert.strictEqual(s.data.legacy.time, 83.456);
  assert.strictEqual(st.getItem('neonNightDriveBest'), '83.456', '不得刪除舊紀錄');
  assert.strictEqual(s.data.version, Save.VERSION);
  // 新版霓虹市區紀錄與舊版分開
  assert.strictEqual(s.getRecord('city', 'swift'), null);
});

test('沒有舊紀錄時不會產生假紀錄', () => {
  const s = Save.create(memStorage({}));
  assert.strictEqual(s.data.legacy, null);
});

test('同一場比賽只發一次經驗值；重新開啟後等級、解鎖、紀錄仍存在', () => {
  const st = memStorage({});
  let s = Save.create(st);
  const parts = [{ label: '完賽', xp: 100 }, { label: '首次完成', xp: 150 }];
  const r1 = s.awardXP('race-1', parts);
  const r2 = s.awardXP('race-1', parts);
  assert.ok(r1.granted); assert.ok(!r2.granted, '重複發放必須被擋下');
  assert.strictEqual(s.level(), 2, '250 經驗應升到 Lv2（需要 200）');
  assert.ok(r1.unlocked.some(u => u.id === 'sunset'), 'Lv2 解鎖霓虹橘車漆');
  assert.ok(s.submitTime('city', 'swift', 50.12, 3, { dt: 0.1, f: [0, 0, 0] }));
  assert.ok(!s.submitTime('city', 'swift', 55, 3, null), '較慢不覆蓋');
  s.data.garage.cos.paint = 'sunset'; s.persist();
  // 模擬重新開啟瀏覽器
  s = Save.create(st);
  assert.strictEqual(s.level(), 2);
  assert.strictEqual(s.data.profile.xp, 50);
  assert.ok(s.isUnlocked('paint', 'sunset'));
  assert.strictEqual(s.data.garage.cos.paint, 'sunset');
  assert.strictEqual(s.getRecord('city', 'swift').time, 50.12);
  assert.ok(!s.awardXP('race-1', parts).granted, '重開後同一場仍不能重複領取');
  assert.ok(s.recordKey('city', 'swift').endsWith('|v' + D.RULES_VERSION), '成績依規則版本分開保存');
});

test('等級解鎖技能配置欄', () => {
  const s = Save.create(memStorage({}));
  assert.strictEqual(s.presetSlots(), 1);
  s.awardXP('big', [{ label: 'x', xp: 6000 }]); // 升到 Lv10 共需 5400
  assert.ok(s.level() >= 10);
  assert.strictEqual(s.presetSlots(), 3);
});

test('損毀的存檔可以恢復成預設值', () => {
  const s = Save.create(memStorage({ 'neonNightDrive.save': '{壞掉的 JSON', neonNightDriveBest: '70' }));
  assert.strictEqual(s.data.version, Save.VERSION);
  assert.strictEqual(s.data.legacy.time, 70);
});
