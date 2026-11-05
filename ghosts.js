// Pocket Shelf — "Play together": see other players walking around your FireRed / LeafGreen / Emerald world.
// Each phone reads its own player's map + position from memory and shares it; friends on the same map are drawn on top
// of the game picture. Up to 4 players: the host relays everyone's updates. Works online (PeerJS) or offline (QR swap).
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419"];
  // Where the player's tile is on the 240×160 GBA screen (the camera keeps the player here)
  const PLAYER_TILE = { x: 112, y: 64 };
  const FAMILY_MAPS = (fam) => fam === "E" ? "E" : "FRLG";      // FireRed and LeafGreen share every map

  let ctx = null, mem = null, me = null, role = null;            // role: 'host' | 'guest'
  let peer = null, links = [], others = new Map(), sendTimer = null, drawRaf = null, emotes = new Map();
  let offline = null;

  function myInfo() {
    if (!mem || !mem.supported) return null;
    const L = mem.location();
    return { t: "pos", id: me.id, name: me.name, color: me.color, fam: FAMILY_MAPS(mem.profile.family), g: L.mapGroup, n: L.mapNum, x: L.x, y: L.y, f: L.facing,
      field: mem.inOverworld(), at: Date.now() };
  }

  // ---------- networking ----------
  function broadcast(msg, except) { links.forEach(l => { if (l !== except && l.open) try { l.send(msg); } catch (e) {} }); }
  function onMessage(link, msg) {
    if (!msg || !msg.t) return;
    if (role === "host" && msg.t !== "roster") broadcast(msg, link);       // host relays to everyone else
    if (msg.t === "pos") {
      const o = others.get(msg.id) || { id: msg.id, px: msg.x, py: msg.y, moveStart: 0 };
      if (o.x !== undefined && (o.x !== msg.x || o.y !== msg.y)) { o.px = o.x; o.py = o.y; o.moveStart = performance.now(); }
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
    const id = "pkshelf-play-" + Math.random().toString(36).slice(2, 8);
    peer = new Peer(id); role = "host";
    await new Promise((res, rej) => { peer.on("open", res); peer.on("error", rej); });
    peer.on("connection", (c) => { if (links.length >= 3) return c.close(); addLink(c); });
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
    const scale = c.width / 240, now = performance.now();
    for (const o of others.values()) {
      if (Date.now() - o.seen > 8000) { others.delete(o.id); continue; }
      if (o.fam !== i.fam || o.g !== i.g || o.n !== i.n || !o.field) continue;
      const t = Math.min(1, (now - (o.moveStart || 0)) / 260);              // walk smoothly between tiles
      const gx = (o.px ?? o.x) + ((o.x - (o.px ?? o.x)) * t), gy = (o.py ?? o.y) + ((o.y - (o.py ?? o.y)) * t);
      const sx = (PLAYER_TILE.x + (gx - i.x) * 16 + 8) * scale, sy = (PLAYER_TILE.y + (gy - i.y) * 16 - 16) * scale;
      if (sx < -40 * scale || sx > 280 * scale || sy < -40 * scale || sy > 200 * scale) continue;
      drawTrainer(g, sx, sy, scale, o.color, o.f);
      g.font = `${Math.round(7 * scale)}px system-ui, sans-serif`; g.textAlign = "center";
      g.fillStyle = "rgba(0,0,0,.6)"; const tw = g.measureText(o.name).width + 6 * scale;
      g.fillRect(sx - tw / 2, sy - 9 * scale, tw, 9 * scale);
      g.fillStyle = "#fff"; g.fillText(o.name, sx, sy - 2.5 * scale);
      const em = emotes.get(o.id);
      if (em && em.until > Date.now()) { g.font = `${Math.round(12 * scale)}px system-ui`; g.fillText(em.text, sx, sy - 12 * scale); }
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
      <button class="btn ghost full" data-g="close">Close</button></div>`, (a) => {
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
    if (!sendTimer) sendTimer = setInterval(() => { const i = myInfo(); if (i && links.length) broadcast(i); }, 125);
    if (!drawRaf) draw();
    updateStatus();
  }
  function stop() {
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
      me = { id: Math.random().toString(36).slice(2, 10), name: name || "Player", color: COLORS[Math.floor(Math.random() * 4)] };
    }
    if (role) {
      sheet(`<h3>Play together</h3><div class="sub">${others.size + 1} player(s) connected. Friends on the same map show up walking around.</div>
        <div class="actions"><button class="btn danger full" data-g="leave">Leave</button><button class="btn ghost full" data-g="close">Close</button></div>`, (a) => { if (a === "leave") stop(); closeSheet(); });
      return;
    }
    const online = navigator.onLine;
    sheet(`<h3>Play together <small style="color:var(--accent);font-size:12px">beta</small></h3>
      <div class="sub">See up to 3 friends walking around your world and trade when you meet. Everyone needs FireRed/LeafGreen together, or Emerald together.</div>
      <label class="k" style="display:block;margin:6px 0">Your name</label><input type="text" id="ghostName" maxlength="10" value="${esc(me.name)}">
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-g="host">Host</button><button class="btn ghost" data-g="join">Join</button>
        <button class="btn ghost full" data-g="close">Cancel</button></div>
      <p class="d" style="margin-top:10px">${online ? "Online: friends can be anywhere." : "No internet: everyone joins the same Wi-Fi or hotspot and you'll scan each other's codes."}</p>`,
      async (a) => {
        if (a === "close") return closeSheet();
        me.name = ($("#ghostName").value.trim() || "Player").slice(0, 10); try { localStorage.setItem("ps_player_name", me.name); } catch (e) {}
        try {
          if (a === "host") {
            if (online) {
              const code = await hostOnline();
              start();
              sheet(`<h3>Hosting</h3><div class="sub">Friends tap <b>Auto → Play together → Join</b> and scan this.</div><div class="qr" style="width:min(240px,70vw);margin:10px auto;background:#fff;border-radius:12px;padding:8px">${PocketOffline.qrSvg(code)}</div><div class="actions"><button class="btn primary full" data-g="close">Start playing</button></div>`, () => closeSheet());
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
            const code = await PocketOffline.scan("Scan the code on the host's phone");
            if (code.startsWith("PSG1:")) { await joinOnline(code); start(); closeSheet(); }
            else {
              offline = await PocketOffline.guest(code); role = "guest"; addLink(offline.conn); start();
              sheet(`<h3>Almost there</h3><div class="sub">Let the host scan this code.</div><div class="qr" style="width:min(240px,70vw);margin:10px auto;background:#fff;border-radius:12px;padding:8px">${PocketOffline.qrSvg(offline.code)}</div><div class="actions"><button class="btn primary full" data-g="close">Done</button></div>`, () => closeSheet());
            }
          }
        } catch (e) { if (e.message !== "cancelled") alertSheet("Couldn't connect: " + (e.type || e.message)); }
      });
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
    _state: () => ({ role, others: [...others.values()], me, links: links.length }),
  };
})();
