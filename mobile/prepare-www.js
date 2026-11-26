'use strict';
// 把 ../public 複製成 App 內建網頁（www），並寫入正式伺服器位址。
// App 內建網頁可離線玩單機；多人連到與網頁版相同的正式伺服器，因此能進同一個房間。
// 用法：NND_SERVER_URL=https://你的網域 node prepare-www.js
const fs = require('fs');
const path = require('path');

const url = (process.env.NND_SERVER_URL || '').trim().replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(url)) {
  console.error('錯誤：請設定 NND_SERVER_URL 為正式伺服器網址，例如 https://neon.example.com（必須是 https，不可使用 localhost）');
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/.test(url)) { console.error('錯誤：正式連線位置不可為 localhost'); process.exit(1); }

const src = path.join(__dirname, '..', 'public');
const dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: p => !p.includes(path.join('public', 'downloads')) && !p.endsWith('sw.js') });
fs.writeFileSync(path.join(dst, 'config.js'), `/* 由 mobile/prepare-www.js 產生 */\nwindow.NND_CONFIG = { serverUrl: ${JSON.stringify(url)} };\n`);
console.log(`已準備 www（伺服器：${url}）`);
