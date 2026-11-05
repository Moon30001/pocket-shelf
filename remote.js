// Pocket Shelf — use a phone as a wireless controller for the game running on this screen
(function () {
  const BTN = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let peer = null, conns = [], ctxRef = null;

  const gm = () => window.EJS_emulator && window.EJS_emulator.gameManager;

  function setPill(text, ok) {
    const b = $("#padBtn"); if (!b) return;
    b.textContent = text; b.classList.toggle("connected", !!ok);
  }

  function onData(msg) {
    if (!msg || !BTN.hasOwnProperty(msg.b)) return;
    if (msg.v && window.PocketAuto && PocketAuto.isRunning()) PocketAuto.stop();   // phone input stops auto modes
    const m = gm(); if (m) m.simulateInput(0, BTN[msg.b], msg.v ? 1 : 0);
  }

  function releaseAll() { const m = gm(); if (m) Object.values(BTN).forEach(i => m.simulateInput(0, i, 0)); }

  function startHost() {
    if (peer && !peer.destroyed) return Promise.resolve(peer.id);
    return new Promise((resolve, reject) => {
      if (typeof Peer === "undefined") return reject(new Error("Connection library missing"));
      const id = "pocketshelf-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
      peer = new Peer(id);
      peer.on("open", resolve);
      peer.on("error", (e) => { if (!peer.open) reject(e); else console.warn("Phone pad:", e); });
      peer.on("connection", (c) => {
        c.on("open", () => {
          conns.push(c);
          const g = ctxRef.getGame();
          c.send({ hello: true, title: g.title, system: g.system });
          setPill("📱 Connected", true);
          const st = $("#padState"); if (st) st.innerHTML = "Phone connected ✓ You can close this.";
          setTimeout(() => { if ($("#padSheet").classList.contains("open")) closeSheet(); }, 1200);
        });
        c.on("data", onData);
        c.on("close", () => {
          conns = conns.filter(x => x !== c); releaseAll();
          setPill(conns.length ? "📱 Connected" : "📱 Phone pad", conns.length > 0);
        });
      });
    });
  }

  function qrSvg(text) {
    const q = qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  async function openSheet() {
    const s = $("#padSheet"), box = s.querySelector(".sheet");
    box.innerHTML = `<h3>Use your phone as the controller</h3>
      <div class="sub">The game stays on this screen; your phone becomes a full-screen gamepad. Both devices need internet to pair.</div>
      <div id="padQR" class="pad-qr">Getting a pairing code…</div>
      <div id="padState" class="d" style="text-align:center;margin-top:10px"></div>
      <div class="actions"><button class="btn ghost full" data-a="close">Close</button></div>`;
    box.onclick = (e) => { if (e.target.closest("[data-a='close']")) closeSheet(); };
    s.classList.add("open");
    if (!navigator.onLine) { $("#padQR").textContent = "You're offline. Pairing needs internet on both devices."; return; }
    try {
      const id = await startHost();
      const url = new URL("controller.html#" + encodeURIComponent(id), location.href).href;
      $("#padQR").innerHTML = qrSvg(url);
      $("#padState").innerHTML = conns.length ? "Phone connected ✓" :
        `Scan with your phone's camera, then tap <b>Start controller</b>.<br><span style="word-break:break-all;font-size:11px">${esc(url)}</span>`;
    } catch (e) {
      $("#padQR").textContent = "Couldn't create a pairing code: " + (e.type || e.message) + ". Check the internet and try again.";
    }
  }
  function closeSheet() { $("#padSheet").classList.remove("open"); }

  window.PocketRemoteInit = function (ctx) {
    ctxRef = ctx;
    $("#padBtn").onclick = openSheet;
    $("#padSheet").addEventListener("click", (e) => { if (e.target.id === "padSheet") closeSheet(); });
    addEventListener("pagehide", () => { try { peer && peer.destroy(); } catch (e) {} });
  };
})();
