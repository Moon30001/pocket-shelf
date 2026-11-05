// Pocket Shelf — offline trading: two phones on the same Wi-Fi or hotspot connect directly (WebRTC),
// swapping connection codes by scanning each other's QR codes. No internet or server needed.
(function () {
  const PREFIX = "PSX1:";

  // ---- compact codes: SDP → deflate → base64url ----
  const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  async function squeeze(u8, mode) {
    const stream = new Blob([u8]).stream().pipeThrough(mode === "c" ? new CompressionStream("deflate-raw") : new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // Drop lines a direct phone-to-phone data link doesn't need, so the QR code stays small and easy to scan
  const slim = (sdp) => sdp.split("\r\n").filter(l => l && !/^a=candidate:.* tcp /.test(l) && !/^a=(ice-options|extmap-allow-mixed|msid-semantic)/.test(l)).join("\r\n") + "\r\n";
  async function pack(desc) {
    const json = JSON.stringify({ t: desc.type === "offer" ? "o" : "a", s: slim(desc.sdp) });
    return PREFIX + b64u(await squeeze(new TextEncoder().encode(json), "c"));
  }
  async function unpack(code, want) {
    if (!code || !code.startsWith(PREFIX)) throw new Error("That isn't a Pocket Shelf trade code.");
    const o = JSON.parse(new TextDecoder().decode(await squeeze(unb64u(code.slice(PREFIX.length)), "d")));
    const type = o.t === "o" ? "offer" : "answer";
    if (want && type !== want) throw new Error(want === "offer" ? "Scan the code on the phone that started the trade." : "Scan the code your friend's phone is showing now.");
    return { type, sdp: o.s };
  }

  // ---- a data channel that looks like a PeerJS connection to the trade screen ----
  class Conn {
    constructor(pc) { this.pc = pc; this.h = {}; this.open = false; }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, ...a) { (this.h[e] || []).forEach(f => { try { f(...a); } catch (err) { console.error(err); } }); }
    attach(dc) {
      this.dc = dc;
      dc.onopen = () => { this.open = true; this.emit("open"); };
      dc.onmessage = (ev) => { let m = ev.data; try { m = JSON.parse(m); } catch (e) {} this.emit("data", m); };
      dc.onclose = () => { if (this.open) { this.open = false; this.emit("close"); } };
      this.pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(this.pc.connectionState) && this.open) { this.open = false; this.emit("close"); } };
    }
    send(obj) { if (this.dc && this.dc.readyState === "open") this.dc.send(JSON.stringify(obj)); }
    close() { try { this.dc && this.dc.close(); this.pc.close(); } catch (e) {} }
  }

  function gathered(pc, ms = 4000) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(res, ms);
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
    });
  }
  const newPC = () => new RTCPeerConnection({ iceServers: [] });

  // Chrome hides local network addresses from pages without camera access; we need the camera to scan anyway,
  // so ask first — that lets the two phones find each other on the same network.
  async function warmCamera() {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); s.getTracks().forEach(t => t.stop()); return true; }
    catch (e) { return false; }
  }

  // Host: make the first code, later accept the friend's reply code
  async function host() {
    await warmCamera();
    const pc = newPC(), conn = new Conn(pc);
    conn.attach(pc.createDataChannel("trade", { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return { conn, code: await pack(pc.localDescription), accept: async (answerCode) => pc.setRemoteDescription(await unpack(answerCode, "answer")) };
  }
  // Guest: read the host's code, make a reply code
  async function guest(offerCode) {
    const offer = await unpack(offerCode, "offer");
    await warmCamera();
    const pc = newPC(), conn = new Conn(pc);
    pc.ondatachannel = (ev) => conn.attach(ev.channel);
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return { conn, code: await pack(pc.localDescription) };
  }

  // ---- camera QR scanner (full-screen overlay) ----
  function scan(title) {
    if (window.__testScan) return window.__testScan(title);        // test hook
    return new Promise(async (resolve, reject) => {
      const ov = document.createElement("div");
      ov.className = "scan-overlay";
      ov.innerHTML = `<div class="scan-title">${title}</div><video playsinline muted></video><div class="scan-frame"></div>
        <button class="btn ghost scan-cancel">Cancel</button>`;
      document.body.appendChild(ov);
      const video = ov.querySelector("video");
      let stream, done = false;
      const finish = (err, val) => { if (done) return; done = true; try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {} ov.remove(); err ? reject(err) : resolve(val); };
      ov.querySelector(".scan-cancel").onclick = () => finish(new Error("cancelled"));
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
      catch (e) { return finish(new Error("Pocket Shelf needs the camera to scan your friend's code. Allow camera access and try again.")); }
      video.srcObject = stream; await video.play().catch(() => {});
      const detector = ("BarcodeDetector" in window) ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
      const c = document.createElement("canvas"), ctx = c.getContext("2d", { willReadFrequently: true });
      const tick = async () => {
        if (done) return;
        try {
          if (video.readyState >= 2) {
            let text = null;
            if (detector) { const r = await detector.detect(video); if (r.length) text = r[0].rawValue; }
            if (!text && window.jsQR) {
              const w = Math.min(720, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
              c.width = w; c.height = h; ctx.drawImage(video, 0, 0, w, h);
              const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
              if (r) text = r.data;
            }
            if (text && text.startsWith(PREFIX)) { if (navigator.vibrate) navigator.vibrate(30); return finish(null, text); }
          }
        } catch (e) {}
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  function qrSvg(text) {
    const q = qrcode(0, "L"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  window.PocketOffline = { host, guest, scan, qrSvg, _pack: pack, _unpack: unpack };
})();
