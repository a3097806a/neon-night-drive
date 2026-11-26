// 開發輔助：確認 node:sqlite 可用
const fs = require('fs');
let out;
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT)');
  const r = db.prepare('INSERT OR IGNORE INTO t(a,b) VALUES (?,?)').run(1, 'x');
  const r2 = db.prepare('INSERT OR IGNORE INTO t(a,b) VALUES (?,?)').run(1, 'y');
  out = `ok ${process.version} changes=${r.changes},${r2.changes}`;
} catch (e) { out = 'fail ' + process.version + ' ' + e.message; }
fs.writeFileSync(__dirname + '/sqlite.txt', out + '\n');
