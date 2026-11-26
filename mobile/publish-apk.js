'use strict';
// 把已簽署的 release APK 複製到 ../public/downloads，網頁上的下載按鈕只有在這個檔案存在時才會出現。
// 用法：node publish-apk.js [APK 路徑]
const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const apk = process.argv[2] || path.join(__dirname, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(apk)) { console.error('找不到 APK：' + apk + '\n請先完成「建置與簽署」步驟。'); process.exit(1); }
const head = fs.readFileSync(apk).subarray(0, 4);
if (head.toString('hex') !== '504b0304') { console.error('檔案不是有效的 APK（ZIP 格式）'); process.exit(1); }
const outDir = path.join(__dirname, '..', 'public', 'downloads');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(apk, path.join(outDir, 'neon-night-drive.apk'));
fs.writeFileSync(path.join(outDir, 'apk.json'), JSON.stringify({ version: pkg.version, date: new Date().toISOString() }, null, 2));
console.log('已發布到 public/downloads/neon-night-drive.apk，重新部署伺服器後下載按鈕就會出現。');
