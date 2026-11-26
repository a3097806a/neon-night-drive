/* 霓虹夜行 Service Worker：離線快取 App 外殼，支援單機離線遊玩。
 * 發布新版時修改 VERSION；新版會等玩家在選單或結算畫面按「更新」才啟用，不會打斷比賽。 */
const VERSION = '2.1.0-1';
const CACHE = 'nnd-' + VERSION;
const SHELL = [
  './', './index.html', './css/style.css', './config.js', './manifest.webmanifest',
  './shared/data.js', './shared/track.js', './shared/physics.js', './shared/ai.js', './shared/sim.js', './shared/save.js',
  './js/input.js', './js/render.js', './js/net.js', './js/account.js', './js/main.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  // 不呼叫 skipWaiting：等待玩家確認後才切換
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nnd-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 伺服器 API、健康檢查、APK 下載一律走網路
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname.startsWith('/downloads/') || url.pathname === '/ws') return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(hit => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
