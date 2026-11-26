// Pocket Shelf — "Play together": see other players walking around your FireRed / LeafGreen / Emerald world.
// Each phone reads its own player's map + position from memory and shares it; friends on the same map are drawn on top
// of the game picture. Up to 6 players: the host relays everyone's updates. Works online (PeerJS) or offline (QR swap).
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419", "#cc5de8", "#ff922b"];
  // Where the player's tile is on the 240×160 GBA screen (the camera keeps the player here)
  const PLAYER_TILE = { x: 112, y: 64 };
  const FAMILY_MAPS = (fam) => fam === "E" ? "E" : "FRLG";      // FireRed and LeafGreen share every map

  let ctx = null, mem = null, me = null, role = null;            // role: 'host' | 'guest'
  let peer = null, links = [], others = new Map(), sendTimer = null, drawRaf = null, emotes = new Map();
  let offline = null, hooks = [];                                // hooks: other features (Hero vs Rival) listening on this connection

  function myInfo() {
    if (!mem || !mem.supported) return null;
    const L = mem.location();
    return { t: "pos", id: me.id, name: me.name, color: me.color, fam: FAMILY_MAPS(mem.profile.family), g: L.mapGroup, n: L.mapNum, x: L.x, y: L.y, f: L.facing,
      field: mem.inOverworld(), gfx: myLook(), dur: Math.round(self.dur), at: Date.now() };
  }

  // ---------- real trainer sprites from the game's ROM ----------
  // The overworld sprite table (pointers to graphics info) and the palette table are found by their shape, so hacks work too.
  // Each player shares a sprite number; everyone draws it from their own copy of the game.
  let kit;   // undefined = not tried yet, null = not found
  function spriteKit() {
    if (kit !== undefined) return kit;
    kit = null;
    const r = mem && mem.rom; if (!r) return (kit = undefined, null);
    const N = r.length, ROM = 0x08000000;
    const u16 = (o) => r[o] | (r[o + 1] << 8), u32 = (o) => (r[o] | (r[o + 1] << 8) | (r[o + 2] << 16) | (r[o + 3] << 24)) >>> 0;
    const okp = (p) => p >= ROM && p < ROM + N;
    const info = (p) => { if (!okp(p) || p & 3) return false; const o = p - ROM, w = u16(o + 8), h = u16(o + 10);
      return u16(o) === 0xFFFF && (w === 16 || w === 32 || w === 64) && (h === 16 || h === 32 || h === 64) && okp(u32(o + 28)) && okp(u32(o + 24)); };
    let table = null;
    for (let o = 0; o < N - 4; o += 4) {
      if (!info(u32(o))) continue;
      let k = o; while (k < N - 4 && info(u32(k))) k += 4;
      const n = (k - o) >> 2; if (n > 100 && (!table || n > table.n)) table = { o, n };
      o = k;
    }
    let pal = null;
    for (let o = 0; o < N - 8; o += 4) {
      let k = o; while (k < N - 8 && okp(u32(k)) && u16(k + 4) >= 0x1100 && u16(k + 4) <= 0x11FF) k += 8;
      const n = (k - o) >> 3; if (n >= 10 && (!pal || n > pal.n)) pal = { o, n };
      if (k > o) o = k - 4;
    }
    if (!table || !pal) return null;
    const pals = {}; for (let i = 0; i < pal.n; i++) pals[u16(pal.o + i * 8 + 4)] = u32(pal.o + i * 8) - ROM;
    const cache = new Map();
    kit = {
      count: table.n, tableOff: table.o,
      gfx(id) {
        if (id < 0 || id >= table.n) return null;
        const g = u32(table.o + id * 4) - ROM, p = pals[u16(g + 2)];
        return p === undefined ? null : { g, w: u16(g + 8), h: u16(g + 10), images: u32(g + 28) - ROM, pal: p };
      },
      frame(id, f) {   // → canvas, or null
        const key = id + ":" + f; if (cache.has(key)) return cache.get(key);
        let c = null;
        try {
          const s = kit.gfx(id);
          if (s) {
            const ptr = u32(s.images + f * 8);
            if (okp(ptr)) {
              const data = ptr - ROM, cols = [null];
              for (let i = 1; i < 16; i++) { const v = u16(s.pal + i * 2); cols.push([(v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3]); }
              c = document.createElement("canvas"); c.width = s.w; c.height = s.h;
              const cx = c.getContext("2d"), im = cx.createImageData(s.w, s.h), tw = s.w >> 3;
              let any = false;
              for (let t = 0; t < tw * (s.h >> 3); t++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
                const b = r[data + t * 32 + y * 4 + (x >> 1)], v = x & 1 ? b >> 4 : b & 15;
                if (!v) continue;
                const px = ((t % tw) * 8 + x), py = (Math.floor(t / tw) * 8 + y), at = (py * s.w + px) * 4;
                im.data[at] = cols[v][0]; im.data[at + 1] = cols[v][1]; im.data[at + 2] = cols[v][2]; im.data[at + 3] = 255; any = true;
              }
              cx.putImageData(im, 0, 0);
              if (!any) c = null;
              else { let top = s.h, bottom = 0; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (im.data[(y * s.w + x) * 4 + 3]) { top = Math.min(top, y); bottom = Math.max(bottom, y); } c.top = top; c.bottom = bottom; }
            }
          }
        } catch (e) { c = null; }
        cache.set(key, c); return c;
      },
      // walking trainers only, for the look picker: 16×32, all 9 walking frames present, feet at the bottom
      // (leaves out swimmers in the water, Pokémon, shadows and object sheets)
      people() {
        if (kit._people) return kit._people;
        const out = [];
        for (let i = 0; i < table.n; i++) {
          const s = kit.gfx(i); if (!s || s.w !== 16 || s.h !== 32) continue;
          const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(f => kit.frame(i, f));
          if (frames.some(f => !f || f.bottom < 30)) continue;
          out.push(i);
        }
        return (kit._people = out);
      },
    };
    return kit;
  }
  // which sprite I show: the one picked in "Your look", or whatever my game is showing right now (walking, bike, surf…)
  let lookCache = { at: 0, v: -1 };
  function myLook() {
    if (performance.now() - lookCache.at < 1000) return lookCache.v;
    lookCache = { at: performance.now(), v: readLook() };
    return lookCache.v;
  }
  function readLook() {
    let pick = -1; try { const v = localStorage.getItem("ps_player_look"); if (v !== null && v !== "") pick = +v; } catch (e) {}
    if (pick >= 0) { const k = spriteKit(); if (!k || k.people().includes(pick)) return pick; }
    try { const rd = mem.reader, id = rd.u8(mem.ram.playerAvatar + 5); return rd.u8(mem.ram.objectEvents + id * 0x24 + 5); } catch (e) { return -1; }
  }
  // Gen 3 frames: 0 down, 1 up, 2 left (right = left mirrored), walking 3–4 down, 5–6 up, 7–8 left
  function drawSprite(g, cx, top, scale, gfx, facing, walking, step) {
    const k = spriteKit(); if (!k || gfx == null || gfx < 0) return false;
    const base = { 1: 0, 2: 1, 3: 2, 4: 2 }[facing] ?? 0, walk = { 1: [3, 4], 2: [5, 6], 3: [7, 8], 4: [7, 8] }[facing] || [3, 4];
    const c = (walking && k.frame(gfx, walk[step & 1])) || k.frame(gfx, base);
    if (!c) return false;
    const w = c.width * scale, h = c.height * scale, x = cx - w / 2, y = top + 32 * scale - h;
    g.save(); g.imageSmoothingEnabled = false;
    if (facing === 4) { g.translate(x + w, y); g.scale(-1, 1); g.drawImage(c, 0, 0, w, h); } else g.drawImage(c, x, y, w, h);
    g.restore();
    return y + (c.top || 0) * scale;                                     // where the head is, so the name sits right above it
  }
  function lookPicker(back) {
    const k = spriteKit();
    if (!k) { sheet(`<h3>Your look</h3><div class="sub">Couldn't find this game's trainer sprites.</div><div class="actions"><button class="btn ghost full" data-g="back">Back</button></div>`, () => back()); return; }
    let cur = ""; try { cur = localStorage.getItem("ps_player_look") || ""; } catch (e) {}
    const tile = (i) => { const c = k.frame(i, 0); return `<button data-g="look-${i}" style="all:unset;cursor:pointer;display:grid;place-items:center;padding:4px;border-radius:10px;background:${String(i) === cur ? "#3a3010" : "var(--panel-2)"};outline:${String(i) === cur ? "2px solid var(--accent)" : "none"}"><img src="${c.toDataURL()}" style="width:32px;height:64px;image-rendering:pixelated"></button>`; };
    sheet(`<h3>Your look</h3><div class="sub">How friends see you, and how you look in your own game while you're connected. Your game switches to it after you go through a door or into a new area, and goes back when you leave Play together.</div>
      <button class="btn ${cur === "" ? "primary" : "ghost"} full" data-g="look-game" style="width:100%;margin-bottom:10px">Same as in my game</button>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;max-height:50vh;overflow:auto">${k.people().map(tile).join("")}</div>
      <div class="actions"><button class="btn ghost full" data-g="back">Done</button></div>`, (a) => {
      if (a === "back") return back();
      try { localStorage.setItem("ps_player_look", a === "look-game" ? "" : a.slice(5)); } catch (e) {}
      lookCache.at = 0;
      if (role) applySelfLook();
      lookPicker(back);
    });
  }

  // ---------- show my picked look as MY character too (only while connected) ----------
  // The game reads its sprite table from the ROM every time it creates the player sprite. While connected, the player's
  // walking sprite entry points at a copy of it that uses the picked trainer's frames and colours. Leaving restores it.
  // Takes effect the next time the game builds the player sprite (going through a door, a new area, getting off a bike).
  const selfLook = { heapRoms: null, playerGfx: null, orig: null, applied: -1, free: null };
  function heapRomCopies() {
    if (selfLook.heapRoms) return selfLook.heapRoms;
    const H = window.EJS_emulator.gameManager.Module.HEAPU8, rom = mem.rom, out = [];
    const probe = [0xA0, 0x200, 0x1000, 0x100000, rom.length - 0x1000];      // the emulator keeps its own copy of the ROM in memory
    for (let i = 0; i + rom.length <= H.length; i += 4) {
      if (H[i + 0xA0] !== rom[0xA0] || H[i + 0xAC] !== rom[0xAC] || H[i + 4] !== rom[4]) continue;
      if (probe.every(o => { for (let k = 0; k < 64; k++) if (H[i + o + k] !== rom[o + k]) return false; return true; })) out.push(i);
    }
    return (selfLook.heapRoms = out);
  }
  function romW32(base, off, v) { const H = window.EJS_emulator.gameManager.Module.HEAPU8; H[base + off] = v & 255; H[base + off + 1] = (v >>> 8) & 255; H[base + off + 2] = (v >>> 16) & 255; H[base + off + 3] = v >>> 24; }
  function applySelfLook() {
    try {
      const k = spriteKit(); if (!k) return;
      const pick = readLook(), rom = mem.rom, ROM = 0x08000000;
      const u16 = (o) => rom[o] | (rom[o + 1] << 8), u32 = (o) => (rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16) | (rom[o + 3] << 24)) >>> 0;
      // which sprite is "me on foot": remember it the first time we see it (player-only palette slot, 16×32)
      if (selfLook.playerGfx == null) {
        const rd = mem.reader, onFoot = rd.u8(mem.ram.playerAvatar) & 1, id = rd.u8(mem.ram.objectEvents + rd.u8(mem.ram.playerAvatar + 5) * 0x24 + 5), s = k.gfx(id);
        if (onFoot && s && s.w === 16 && s.h === 32 && (rom[s.g + 12] & 15) === 0) selfLook.playerGfx = id; else return;
      }
      const want = pick >= 0 && k.people().includes(pick) ? pick : -1;
      if (want === selfLook.applied) return;
      const copies = heapRomCopies(); if (!copies.length) return;
      const tableSlot = k.tableOff + selfLook.playerGfx * 4;
      if (selfLook.orig == null) selfLook.orig = u32(tableSlot);
      if (want < 0) { copies.forEach(b => romW32(b, tableSlot, selfLook.orig)); selfLook.applied = -1; return; }
      // free space for the copy: the biggest run of unused (0xFF) bytes in the ROM
      if (selfLook.free == null) { let best = 0, bl = 0; for (let i = 0; i < rom.length;) { if (rom[i] !== 0xFF) { i++; continue; } let j = i; while (j < rom.length && rom[j] === 0xFF) j++; if (j - i > bl) { bl = j - i; best = i; } i = j; } if (bl < 1024) return; selfLook.free = (best + 512) & ~3; }
      const F = selfLook.free, mineInfo = selfLook.orig - ROM, npc = k.gfx(want), H = window.EJS_emulator.gameManager.Module.HEAPU8;
      for (const b of copies) {
        for (let i = 0; i < 36; i++) H[b + F + i] = rom[mineInfo + i];                 // my sprite's settings (size, animations)…
        H[b + F + 2] = rom[npc.g + 2]; H[b + F + 3] = rom[npc.g + 3];                  // …with their colours
        romW32(b, F + 28, ROM + F + 40);                                                 // …and their frames
        for (let f = 0; f < 32; f++) { const src = npc.images + (f % 9) * 8; for (let i = 0; i < 8; i++) H[b + F + 40 + f * 8 + i] = rom[src + i]; }
        romW32(b, tableSlot, ROM + F);
      }
      selfLook.applied = want;
    } catch (e) { console.warn("Couldn't change my character:", e); }
  }
  function restoreSelfLook() {
    try { if (selfLook.orig != null && selfLook.applied >= 0) { const k = spriteKit(); heapRomCopies().forEach(b => romW32(b, k.tableOff + selfLook.playerGfx * 4, selfLook.orig)); } } catch (e) {}
    selfLook.applied = -1;
  }

  // ---------- networking ----------
  function broadcast(msg, except) { links.forEach(l => { if (l !== except && l.open) try { l.send(msg); } catch (e) {} }); }
  function onMessage(link, msg) {
    if (!msg || !msg.t) return;
    if (role === "host" && msg.t !== "roster") broadcast(msg, link);       // host relays to everyone else
    hooks.forEach(h => { try { h(msg); } catch (e) { console.warn("Play together hook:", e); } });
    if (msg.t === "pos") {
      let o = others.get(msg.id);
      const sameMap = o && o.g === msg.g && o.n === msg.n && o.fam === msg.fam;
      if (!o) o = { id: msg.id };
      if (!sameMap || o.tx === undefined) { o.vx = msg.x; o.vy = msg.y; o.path = []; o.step = null; }          // new map: appear there
      else if (o.tx !== msg.x || o.ty !== msg.y) {
        // fill in every tile between the last known spot and this one, so they walk the route instead of jumping
        let cx = o.tx, cy = o.ty;
        while (cx !== msg.x && o.path.length < 12) { cx += Math.sign(msg.x - cx); o.path.push([cx, cy]); }
        while (cy !== msg.y && o.path.length < 12) { cy += Math.sign(msg.y - cy); o.path.push([cx, cy]); }
        if (o.path.length >= 12 || Math.abs(cx - msg.x) + Math.abs(cy - msg.y) > 0) { o.vx = msg.x; o.vy = msg.y; o.path = []; o.step = null; }  // too far: snap
      }
      o.tx = msg.x; o.ty = msg.y;
      Object.assign(o, msg, { seen: Date.now() });
      others.set(msg.id, o);
    }
    if (msg.t === "emote") emotes.set(msg.id, { text: msg.text, until: Date.now() + 2500 });
    if (msg.t === "bye") others.delete(msg.id);
    if (msg.t === "trade-invite" && msg.to === me.id) inviteReceived(msg);
    if (msg.t === "trade-answer" && msg.to === me.id) inviteAnswered(msg);
    updateStatus();
  }
  function addLink(conn) {
    links.push(conn);
    conn.on("data", (m) => {
      let msg; try { msg = typeof m === "string" ? JSON.parse(m) : m; } catch (e) { return; }
      if (!msg || typeof msg !== "object") return;
      try { onMessage(conn, msg); } catch (e) { console.warn("Ghost message ignored:", e); }
    });
    conn.on("close", () => { links = links.filter(l => l !== conn); updateStatus(); });
    conn.on("open", () => { const i = myInfo(); if (i) conn.send(i); updateStatus(); });
    if (conn.open) { const i = myInfo(); if (i) conn.send(i); }
  }

  async function hostOnline() {
    const AB = "abcdefghjkmnpqrstuvwxyz23456789";                  // no 0/o or 1/l/i, so it's easy to type on a PC
    const id = "pkshelf-play-" + Array.from({ length: 6 }, () => AB[Math.floor(Math.random() * AB.length)]).join("");
    peer = new Peer(id); role = "host";
    await new Promise((res, rej) => { peer.on("open", res); peer.on("error", rej); });
    peer.on("connection", (c) => { if (links.length >= 5) return c.close(); addLink(c); });      // up to 6 players
    return "PSG1:" + id;
  }
  async function joinOnline(code) {
    const id = code.slice(5);
    peer = new Peer(); role = "guest";
    await new Promise((res, rej) => { peer.on("open", res); peer.on("error", rej); });
    addLink(peer.connect(id, { reliable: true, serialization: "json" }));
  }

  // ---------- drawing friends on top of the game ----------
  function overlay() {
    let c = $("#ghostCanvas");
    if (!c) {
      c = document.createElement("canvas"); c.id = "ghostCanvas";
      c.style.cssText = "position:fixed;pointer-events:none;z-index:25;image-rendering:pixelated";
      document.body.appendChild(c);
    }
    return c;
  }
  function pictureRect() {
    const can = window.EJS_emulator && EJS_emulator.canvas; if (!can) return null;
    const r = can.getBoundingClientRect(), aspect = 1.5;
    let w = r.width, h = r.width / aspect;
    if (h > r.height) { h = r.height; w = h * aspect; }
    const portrait = r.height > r.width;
    return { x: r.left + (r.width - w) / 2, y: portrait ? r.top : r.top + (r.height - h) / 2, w, h };
  }
  function drawTrainer(g, cx, top, scale, color, facing) {
    const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(cx + (x - 8) * scale), Math.round(top + y * scale), Math.ceil(w * scale), Math.ceil(h * scale)); };
    g.globalAlpha = 0.92;
    px(4, 28, 8, 3, "rgba(0,0,0,.25)");                     // shadow
    px(5, 3, 6, 3, color);                                   // cap
    px(4, 5, 8, 2, color);
    px(5, 7, 6, 6, "#f1c9a5");                               // face
    if (facing !== 2) { px(6, 9, 1, 1, "#222"); px(9, 9, 1, 1, "#222"); }
    px(4, 13, 8, 8, color);                                  // jacket
    px(3, 14, 1, 6, "#f1c9a5"); px(12, 14, 1, 6, "#f1c9a5"); // arms
    px(5, 21, 6, 5, "#334");                                 // legs
    px(4, 26, 3, 2, "#222"); px(9, 26, 3, 2, "#222");        // shoes
    g.globalAlpha = 1;
  }
  // Walk a remote player along their queued tiles at the speed their own game is moving (walk / run / bike).
  function advance(o, now) {
    if (!o.step && o.path && o.path.length) {
      const [x, y] = o.path.shift(), behind = o.path.length;
      o.step = { fx: o.vx, fy: o.vy, x, y, start: now, dur: Math.max(50, (o.dur || 267) * (behind > 2 ? 0.5 : behind > 0 ? 0.8 : 1)) };
      o.stepNo = (o.stepNo || 0) + 1;
    }
    if (!o.step) return false;
    const st = o.step, t = Math.min(1, (now - st.start) / st.dur);
    o.vx = st.fx + (st.x - st.fx) * t; o.vy = st.fy + (st.y - st.fy) * t;
    if (t >= 1) { o.step = null; if (o.path.length) advance(o, now); }
    return t < 0.75 || !!o.step;
  }
  // My own position between tiles: the game updates the tile as a step starts, then scrolls over the step's duration.
  const self = { x: 0, y: 0, fx: 0, fy: 0, start: 0, dur: 267, last: 0, key: "" };
  function myVisual(i, now) {
    const key = i.fam + ":" + i.g + ":" + i.n;
    if (key !== self.key || Math.abs(i.x - self.x) + Math.abs(i.y - self.y) > 1) { Object.assign(self, { key, x: i.x, y: i.y, fx: i.x, fy: i.y, start: 0 }); }
    else if (i.x !== self.x || i.y !== self.y) {
      const gap = now - self.last;
      if (gap > 40 && gap < 400) self.dur = Math.max(50, Math.min(300, gap));     // walking ≈ 267 ms a tile, running ≈ 133, bike faster
      self.last = now;
      Object.assign(self, { fx: self.x + (self.vx - self.x || 0), fy: self.y + (self.vy - self.y || 0), x: i.x, y: i.y, start: now });
      self.sendNow = true;
    }
    const t = self.start ? Math.min(1, (now - self.start) / self.dur) : 1;
    self.vx = self.fx + (self.x - self.fx) * t; self.vy = self.fy + (self.y - self.fy) * t;
    return { x: self.vx, y: self.vy };
  }
  function draw() {
    drawRaf = requestAnimationFrame(draw);
    const c = overlay(), rect = pictureRect(), i = myInfo();
    const dpr = window.devicePixelRatio || 1;
    if (!rect) return;
    Object.assign(c.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px" });
    if (c.width !== Math.round(rect.w * dpr)) { c.width = Math.round(rect.w * dpr); c.height = Math.round(rect.h * dpr); }
    const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
    const btn = $("#ghostInteract");
    let near = null;
    if (!i || !i.field) { if (btn) btn.hidden = true; return; }
    if (self.sendNow) { self.sendNow = false; if (links.length) broadcast(i); }
    if (i.f !== self.f) { self.f = i.f; if (links.length) broadcast(i); }        // turning on the spot
    const scale = c.width / 240, now = performance.now();
    const mine = myVisual(i, now);                                          // my own position, sliding like the game's camera
    for (const o of others.values()) {
      if (Date.now() - o.seen > 8000) { others.delete(o.id); continue; }
      if (o.fam !== i.fam || o.g !== i.g || o.n !== i.n || !o.field) continue;
      const walking = advance(o, now);
      const sx = (PLAYER_TILE.x + (o.vx - mine.x) * 16 + 8) * scale, sy = (PLAYER_TILE.y + (o.vy - mine.y) * 16 - 16) * scale;
      if (sx < -40 * scale || sx > 280 * scale || sy < -40 * scale || sy > 200 * scale) continue;
      let head = drawSprite(g, sx, sy, scale, o.gfx, o.f, walking, o.stepNo || 0);
      if (head === false) { drawTrainer(g, sx, sy, scale, o.color, o.f); head = sy + 3 * scale; }
      g.font = `600 ${Math.round(6 * scale)}px system-ui, sans-serif`; g.textAlign = "center";
      g.fillStyle = "rgba(0,0,0,.6)"; const tw = g.measureText(o.name).width + 5 * scale;
      g.fillRect(sx - tw / 2, head - 9 * scale, tw, 8 * scale);
      g.fillStyle = "#fff"; g.fillText(o.name, sx, head - 3 * scale);
      const em = emotes.get(o.id);
      if (em && em.until > Date.now()) { g.font = `${Math.round(12 * scale)}px system-ui`; g.fillText(em.text, sx, head - 11 * scale); }
      // standing next to them and facing them? offer to interact
      const dx = o.x - i.x, dy = o.y - i.y, facingVec = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] }[i.f] || [0, 0];
      if (dx === facingVec[0] && dy === facingVec[1]) near = o;
    }
    const myEm = emotes.get(me.id);
    if (myEm && myEm.until > Date.now()) { g.font = `${Math.round(12 * scale)}px system-ui`; g.textAlign = "center"; g.fillText(myEm.text, (PLAYER_TILE.x + 8) * scale, (PLAYER_TILE.y - 20) * scale); }
    if (btn) { btn.hidden = !near; if (near) { btn.dataset.id = near.id; btn.textContent = `Interact with ${near.name}`; } }
  }

  // ---------- interacting ----------
  function interactMenu(id) {
    const o = others.get(id); if (!o) return;
    sheet(`<h3>${esc(o.name)}</h3><div class="sub">Playing nearby on the same map.</div>
      <div class="actions"><button class="btn ghost" data-g="wave">👋 Wave</button><button class="btn primary" data-g="trade">⇄ Trade</button>
      ${window.PocketRivals ? `<button class="btn primary full" data-g="battle">⚔ Battle</button>` : ""}
      <button class="btn ghost full" data-g="close">Close</button></div>`, (a) => {
      if (a === "battle") { closeSheet(); return PocketRivals.challenge(id, o.name); }
      if (a === "wave") { const msg = { t: "emote", id: me.id, text: "👋" }; emotes.set(me.id, { text: "👋", until: Date.now() + 2500 }); broadcast(msg); closeSheet(); }
      if (a === "trade") { if (peer && !offline) { const tradeId = "pkshelf-trade-" + Math.random().toString(36).slice(2, 9); pendingTrade = tradeId; broadcast({ t: "trade-invite", from: me.id, fromName: me.name, to: id, tradeId }); sheet(`<h3>Asked ${esc(o.name)} to trade…</h3><div class="sub">Waiting for them to accept.</div><div class="actions"><button class="btn ghost full" data-g="close">Cancel</button></div>`, () => closeSheet()); }
        else sheet(`<h3>Trade with ${esc(o.name)}</h3><div class="sub">For an offline trade, both save in-game, then open <b>⇄ Pokémon → Trade → Offline</b> from the library.</div><div class="actions"><button class="btn ghost full" data-g="close">OK</button></div>`, () => closeSheet()); }
      if (a === "close") closeSheet();
    });
  }
  let pendingTrade = null;
  function inviteReceived(msg) {
    sheet(`<h3>${esc(msg.fromName)} wants to trade</h3><div class="sub">Save in-game first. Then you'll both go to the Pokémon Center, already connected.</div>
      <div class="actions"><button class="btn ghost" data-g="no">No</button><button class="btn primary" data-g="yes">Yes, trade</button></div>`, (a) => {
      broadcast({ t: "trade-answer", from: me.id, to: msg.from, yes: a === "yes", tradeId: msg.tradeId });
      closeSheet();
      if (a === "yes") ctx.leaveTo(`pokecenter.html#trade=${encodeURIComponent(msg.tradeId)}&game=${encodeURIComponent(ctx.getGame().id)}`);
    });
  }
  function inviteAnswered(msg) {
    if (msg.tradeId !== pendingTrade) return;
    if (!msg.yes) { sheet(`<h3>They said no this time.</h3><div class="actions"><button class="btn ghost full" data-g="close">OK</button></div>`, () => closeSheet()); return; }
    ctx.leaveTo(`pokecenter.html#hostid=${encodeURIComponent(msg.tradeId)}&game=${encodeURIComponent(ctx.getGame().id)}`);
  }

  // ---------- setup screens ----------
  function sheet(html, onAction) {
    const s = $("#ghostSheet"), box = s.querySelector(".sheet");
    box.innerHTML = html;
    box.onclick = (e) => { const a = e.target.closest("[data-g]"); if (a) onAction(a.dataset.g, a); };
    s.classList.add("open");
  }
  function closeSheet() { $("#ghostSheet").classList.remove("open"); }
  function updateStatus() {
    const b = $("#ghostBadge"); if (!b) return;
    const n = links.filter(l => l.open).length;
    b.hidden = !role; b.textContent = role ? `👥 ${others.size + 1} playing` : "";
    if (role && !n && role === "guest") b.textContent = "👥 reconnecting…";
  }
  function start() {
    if (!sendTimer) sendTimer = setInterval(() => { const i = myInfo(); if (i && links.length) broadcast(i); }, 400);
    if (!drawRaf) draw();
    if (!start.lookTimer) start.lookTimer = setInterval(applySelfLook, 1500);
    updateStatus();
  }
  function stop() {
    clearInterval(start.lookTimer); start.lookTimer = null; restoreSelfLook();
    broadcast({ t: "bye", id: me.id });
    links.forEach(l => { try { l.close(); } catch (e) {} }); links = [];
    try { peer && peer.destroy(); } catch (e) {} peer = null; offline = null; role = null; others.clear();
    clearInterval(sendTimer); sendTimer = null; cancelAnimationFrame(drawRaf); drawRaf = null;
    const c = $("#ghostCanvas"); if (c) c.remove();
    const btn = $("#ghostInteract"); if (btn) btn.hidden = true;
    updateStatus();
  }

  async function openMenu() {
    mem = await ctx.getMem();
    if (!mem || !mem.supported) { sheet(`<h3>Play together</h3><div class="sub">${esc((mem && mem.reason) || "This game isn't supported yet.")}</div><div class="actions"><button class="btn ghost full" data-g="close">OK</button></div>`, () => closeSheet()); return; }
    if (!mem.profile.rom) mem.learnOverworld();
    if (!me) {
      let name = ""; try { name = localStorage.getItem("ps_player_name") || ""; } catch (e) {}
      me = { id: Math.random().toString(36).slice(2, 10), name: name || "Player", color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    }
    if (role) {
      sheet(`<h3>Play together</h3><div class="sub">${others.size + 1} player(s) connected. Friends on the same map show up walking around.</div>
        <div class="actions"><button class="btn ghost full" data-g="look">👤 Your look</button><button class="btn ghost full" data-g="mute">${muteLabel()}</button><button class="btn danger full" data-g="leave">Leave</button><button class="btn ghost full" data-g="close">Close</button></div>`, (a) => { if (a === "mute") { toggleMute(); return openMenu(); } if (a === "look") return lookPicker(openMenu); if (a === "leave") stop(); closeSheet(); });
      return;
    }
    const online = navigator.onLine;
    sheet(`<h3>Play together <small style="color:var(--accent);font-size:12px">beta</small></h3>
      <div class="sub">See up to 5 friends walking around your world and trade when you meet. Everyone needs FireRed/LeafGreen together, or Emerald together.</div>
      <label class="k" style="display:block;margin:6px 0">Your name</label><input type="text" id="ghostName" maxlength="10" value="${esc(me.name)}">
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-g="host">Host</button><button class="btn ghost" data-g="join">Join</button>
        <button class="btn ghost full" data-g="look">👤 Your look</button>
        <button class="btn ghost full" data-g="mute">${muteLabel()}</button>
        <button class="btn ghost full" data-g="close">Cancel</button></div>
      <p class="d" style="margin-top:10px">${online ? "Online: friends can be anywhere." : "No internet: everyone joins the same Wi-Fi or hotspot and you'll scan each other's codes."}</p>`,
      async (a) => {
        if (a === "close") return closeSheet();
        if (a === "mute") { toggleMute(); return openMenu(); }
        if (a === "look") { me.name = ($("#ghostName").value.trim() || "Player").slice(0, 10); try { localStorage.setItem("ps_player_name", me.name); } catch (e) {} return lookPicker(openMenu); }
        me.name = ($("#ghostName").value.trim() || "Player").slice(0, 10); try { localStorage.setItem("ps_player_name", me.name); } catch (e) {}
        try {
          if (a === "host") {
            if (online) {
              const code = await hostOnline();
              start();
              const room = code.slice(-6).toUpperCase();
              sheet(`<h3>Hosting</h3><div class="sub">Friends tap <b>Auto → Play together → Join</b> and type this code. Up to 5 can join.</div>
                <div style="text-align:center;font:800 40px/1.2 ui-monospace,monospace;letter-spacing:.25em;margin:14px 0 2px">${room}</div><div class="sub" style="text-align:center">Room code</div>
                <div class="actions"><button class="btn primary full" data-g="close">Start playing</button></div>`, () => closeSheet());
            } else {
              offline = await PocketOffline.host(); role = "host"; addLink(offline.conn); start();
              sheet(`<h3>Hosting offline</h3><div class="sub">1. Your friend taps <b>Join</b> and scans this.<br>2. Then tap below and scan the code on their phone.</div><div class="qr" style="width:min(240px,70vw);margin:10px auto;background:#fff;border-radius:12px;padding:8px">${PocketOffline.qrSvg(offline.code)}</div>
                <div class="actions"><button class="btn primary full" data-g="scan">Scan your friend's code</button></div>`, async (b) => {
                if (b !== "scan") return closeSheet();
                try { await offline.accept(await PocketOffline.scan("Scan the code on your friend's phone")); closeSheet(); } catch (e) { if (e.message !== "cancelled") alertSheet(e.message); }
              });
            }
          }
          if (a === "join") {
            const code = await askJoinCode();
            if (code.startsWith("PSG1:")) { await joinOnline(code); start(); closeSheet(); }
            else {
              offline = await PocketOffline.guest(code); role = "guest"; addLink(offline.conn); start();
              sheet(`<h3>Almost there</h3><div class="sub">Let the host scan this code.</div><div class="qr" style="width:min(240px,70vw);margin:10px auto;background:#fff;border-radius:12px;padding:8px">${PocketOffline.qrSvg(offline.code)}</div><div class="actions"><button class="btn primary full" data-g="close">Done</button></div>`, () => closeSheet());
            }
          }
        } catch (e) { if (e.message !== "cancelled") alertSheet("Couldn't connect: " + (e.type || e.message)); }
      });
  }
  // Join by scanning the host's QR code, or by typing their 6-letter room code (no camera needed, e.g. on a PC)
  function askJoinCode() {
    return new Promise((resolve, reject) => {
      const typeIt = () => {
        sheet(`<h3>Join</h3><div class="sub">Type the 6-letter room code from the host's screen.</div>
          <input type="text" id="ghostRoom" maxlength="6" autocomplete="off" autocapitalize="characters" style="width:100%;font:800 24px ui-monospace,monospace;letter-spacing:.25em;text-align:center;text-transform:uppercase">
          <div class="actions"><button class="btn ghost" data-g="back">Cancel</button><button class="btn primary" data-g="go">Join</button></div>`, (b) => {
          if (b === "back") { closeSheet(); return reject(new Error("cancelled")); }
          const room = ($("#ghostRoom").value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
          if (room.length !== 6) return;
          closeSheet(); resolve("PSG1:pkshelf-play-" + room);
        });
        setTimeout(() => { const i = $("#ghostRoom"); if (i) { i.focus(); i.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") $("#ghostSheet [data-g='go']").click(); }; } }, 50);
      };
      const choose = () => sheet(`<h3>Join</h3><div class="sub">Scan the host's QR code, or type their room code.</div>
        <div class="actions"><button class="btn primary" data-g="scan">📷 Scan code</button><button class="btn ghost" data-g="type">⌨ Type code</button>
        <button class="btn ghost full" data-g="cancel">Cancel</button></div>`, (b) => {
        if (b === "cancel") { closeSheet(); return reject(new Error("cancelled")); }
        if (b === "type") return typeIt();
        if (b === "scan") { closeSheet(); PocketOffline.scan("Scan the code on the host's screen").then(resolve, reject); }
      });
      if (!navigator.onLine) return PocketOffline.scan("Scan the code on the host's phone").then(resolve, reject);   // no internet: phones swap long codes, only a QR can carry them
      typeIt();
    });
  }
  // Each device only ever plays its own game's sound. Two devices side by side play the same music slightly out of step,
  // which sounds like a messy echo, so one of them can be muted here.
  const muted = () => !!(window.EJS_emulator && EJS_emulator.muted);
  const muteLabel = () => muted() ? "🔊 Turn this device's sound on" : "🔇 Mute this device";
  function toggleMute() {
    const e = window.EJS_emulator; if (!e) return;
    try { if (muted()) { e.muted = false; e.setVolume(e.volume || 0.5); } else { e.muted = true; e.setVolume(0); } } catch (err) {}
  }
  function alertSheet(msg) { sheet(`<h3>Play together</h3><div class="sub">${esc(msg)}</div><div class="actions"><button class="btn ghost full" data-g="close">OK</button></div>`, () => closeSheet()); }

  window.PocketGhosts = {
    init(c) {
      ctx = c;
      $("#ghostInteract").onclick = (e) => interactMenu(e.currentTarget.dataset.id);
      $("#ghostSheet").addEventListener("click", (e) => { if (e.target.id === "ghostSheet") closeSheet(); });
      addEventListener("pagehide", () => { try { broadcast({ t: "bye", id: me && me.id }); } catch (e) {} });
    },
    open: openMenu,
    _sprites: () => spriteKit(),
    _self: () => ({ selfLook, applySelfLook, restoreSelfLook, heapRomCopies }),
    _state: () => ({ role, others: [...others.values()], me, links: links.length }),
    // for other features riding on the same connection
    on: (fn) => hooks.push(fn),
    send: (msg) => broadcast(msg),
    me: () => me,
    others: () => others,
    connected: () => !!role,
    isHost: () => role === "host",
  };
})();
