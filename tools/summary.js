// 開發輔助：把 node --test 的 TAP 輸出整理成摘要（失敗項目與訊息），寫到 tools/summary.txt
const fs = require('fs');
const path = require('path');
const log = fs.readFileSync(path.join(__dirname, 'last.log'), 'utf8').split(/\r?\n/);
const out = [];
for (let i = 0; i < log.length; i++) {
  const l = log[i];
  if (/^\s*not ok/.test(l) || /^# (pass|fail|tests)/.test(l) || /^\s*# (實測|試駕|\[)/.test(l)) out.push(l);
  if (/^\s*not ok/.test(l)) {
    for (let j = i + 1; j < Math.min(log.length, i + 30); j++) {
      if (/error:|message|expected|actual|Error|at .*shared|at .*server|at .*tests/.test(log[j])) out.push('    ' + log[j].trim());
      if (/^\s*\.\.\./.test(log[j])) break;
    }
  }
}
fs.writeFileSync(path.join(__dirname, 'summary.txt'), out.join('\n') + '\n');
