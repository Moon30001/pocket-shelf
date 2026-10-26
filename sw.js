// Pocket Shelf offline cache — every app + emulator file is stored on install
const CACHE = "pocket-shelf-0123763238";
const FILES = [
 "./",
 "GameManager.js",
 "LICENSE-EmulatorJS.txt",
 "app.css",
 "compression.js",
 "desmume2015-legacy-wasm.data",
 "desmume2015-wasm.data",
 "desmume2015.json",
 "emulator.css",
 "emulator.js",
 "extract7z.js",
 "extractzip.js",
 "gamepad.js",
 "icon-192.png",
 "icon-512.png",
 "index.html",
 "lib.js",
 "loader.js",
 "manifest.webmanifest",
 "melonds-legacy-wasm.data",
 "melonds-wasm.data",
 "melonds.json",
 "mgba-legacy-wasm.data",
 "mgba-wasm.data",
 "mgba.json",
 "nipplejs.js",
 "play.html",
 "shaders.js",
 "socket.io.min.js",
 "storage.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }))
  );
});
