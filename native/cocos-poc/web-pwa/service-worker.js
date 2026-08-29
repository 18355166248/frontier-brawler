const CACHE_NAME = 'frontier-brawler-__CACHE_VERSION__';
const APP_SHELL = ['./', './index.html', './style.css', './manifest.webmanifest', './frontier-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    // 页面导航优先取新版本；离线时才回退到已安装的游戏壳。
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // 体积较大的引擎与动作资源先秒开旧缓存，同时在后台刷新，下次启动使用新版。
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const refreshed = fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
      return cached ?? refreshed;
    }),
  );
});
