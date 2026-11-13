// Pocket Shelf offline cache — every app + emulator file is stored on install
const CACHE = "pocket-shelf-698ec6849b";
const FILES = [
 "./",
 "GameManager.js",
 "LICENSE-EmulatorJS.txt",
 "app.css",
 "auto.js",
 "compression.js",
 "controller.html",
 "desmume2015-legacy-wasm.data",
 "desmume2015-wasm.data",
 "desmume2015.json",
 "emulator.css",
 "emulator.js",
 "extract7z.js",
 "extractzip.js",
 "gamemem.js",
 "gamepad.js",
 "ghosts.js",
 "icon-192.png",
 "icon-512.png",
 "index.html",
 "jsqr.js",
 "lib.js",
 "loader.js",
 "manifest.webmanifest",
 "melonds-legacy-wasm.data",
 "melonds-wasm.data",
 "melonds.json",
 "mgba-legacy-wasm.data",
 "mgba-wasm.data",
 "mgba.json",
 "nav.js",
 "nipplejs.js",
 "offline.js",
 "peerjs.min.js",
 "pkconvert.js",
 "pkdata.js",
 "pksave-core.js",
 "pksave-gen12.js",
 "pksave-gen3.js",
 "pksave-gen45.js",
 "play.html",
 "pokecenter.html",
 "qrcode.js",
 "tour.js",
 "joystick.js",
 "remote.js",
 "shaders.js",
 "socket.io.min.js",
 "storage.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
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
