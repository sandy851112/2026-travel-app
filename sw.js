/* Service Worker — 德國奧地利之旅 · 行程與記帳
 * 目標：首次連線載入後，將 App 本體與所有 CDN 依賴快取起來，
 *       之後即使「完全離線」也能開啟網頁查看行程與記帳。
 * 注意：Service Worker 僅能在 https 或 http://localhost 下運作（file:// 不支援）。
 */
const CACHE = 'travel-planner-v2';

// 首次安裝時預先快取的核心資源（含所有 CDN 函式庫）
const PRECACHE = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.js',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&display=swap',
];

// 安裝：逐一預快取（跨網域資源以 no-cors 取得 opaque 回應，個別失敗不影響整體）
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map(async (url) => {
      try {
        const req = new Request(url, { mode: url.startsWith('http') && !url.startsWith(self.location.origin) ? 'no-cors' : 'same-origin' });
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) await cache.put(req, res.clone());
      } catch (e) { /* 忽略個別資源失敗 */ }
    }));
    self.skipWaiting();
  })());
});

// 啟用：清除舊版快取並立即接管頁面
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 取用策略：Cache First，未命中則連線並在成功後動態快取；離線導覽回退到快取的首頁
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Firebase 即時資料庫／驗證等連線一律走網路，不快取（避免即時同步被舊快取干擾）
  let host = '';
  try { host = new URL(req.url).hostname; } catch (e) {}
  if (/firebaseio\.com$/.test(host) || /firebasedatabase\.app$/.test(host) ||
      /(^|\.)googleapis\.com$/.test(host) || /firebaseinstallations/.test(host)) {
    return; // 交給瀏覽器預設網路行為
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // 動態快取成功的 GET（含字型檔等首次載入才會請求的資源）
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      // 離線且未命中：導覽請求回退到快取的 index.html
      if (req.mode === 'navigate') {
        const fallback = (await caches.match('./index.html')) || (await caches.match('./'));
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
