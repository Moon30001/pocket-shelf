// Pocket Shelf — round thumb pad. Replaces the cross-shaped D-pad with a circle: put your thumb down and roll it
// around; the player walks whichever way your thumb points (up/down/left/right, no diagonals, which Pokémon
// games don't use and which make walking stutter). Turning stays smooth: it only switches direction once you've
// clearly moved past the halfway line, so it doesn't flicker between two directions.
(function () {
  const IDX = { UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };
  const ANGLE = { RIGHT: 0, DOWN: 90, LEFT: 180, UP: 270 };      // screen angles (y grows downward)
  const DEAD = 0.22;                                           // centre area (fraction of radius) = let go
  const HYST = 12;                                             // degrees past the 45° line before switching

  function setup(emu) {
    const main = emu.virtualGamepad && emu.virtualGamepad.querySelector(".ejs_dpad_main");
    if (!main || main.dataset.round) return !!main;
    main.dataset.round = "1";
    main.classList.add("ps-round");
    const knob = document.createElement("div"); knob.className = "ps-knob";
    const ring = document.createElement("div"); ring.className = "ps-ring";
    ["UP", "RIGHT", "DOWN", "LEFT"].forEach(d => { const a = document.createElement("i"); a.className = "ps-arrow ps-" + d.toLowerCase(); ring.appendChild(a); });
    main.append(ring, knob);

    const gm = () => emu.gameManager;
    let touchId = null, dir = null;
    function press(next) {
      if (next === dir) return;
      if (dir) gm().simulateInput(0, IDX[dir], 0);
      dir = next;
      if (dir) { gm().simulateInput(0, IDX[dir], 1); try { navigator.vibrate && navigator.vibrate(6); } catch (e) {} }
      ring.dataset.dir = dir || "";
    }
    function track(x, y) {
      const r = main.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2;
      let dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      // knob follows the thumb, kept inside the circle
      const k = dist > rad * 0.62 ? (rad * 0.62) / dist : 1;
      knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      if (dist < rad * DEAD) return press(null);
      const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      if (dir) {                                               // stay on the current direction until clearly past the line
        const off = Math.abs(((ang - ANGLE[dir] + 540) % 360) - 180);
        if (off <= 45 + HYST) return;
      }
      press(ang >= 315 || ang < 45 ? "RIGHT" : ang < 135 ? "DOWN" : ang < 225 ? "LEFT" : "UP");
    }
    function release() { touchId = null; press(null); knob.style.transform = "translate(-50%, -50%)"; }

    // Listen on the container in the capture phase so EmulatorJS's own cross-pad code never sees these touches
    const host = main.parentElement;
    const inside = (t) => { const r = main.getBoundingClientRect(), p = 18; return t.clientX >= r.left - p && t.clientX <= r.right + p && t.clientY >= r.top - p && t.clientY <= r.bottom + p; };
    host.addEventListener("touchstart", (e) => {
      for (const t of e.changedTouches) if (touchId === null && inside(t)) { touchId = t.identifier; e.preventDefault(); e.stopPropagation(); track(t.clientX, t.clientY); }
    }, { capture: true, passive: false });
    const moveOrEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        e.preventDefault(); e.stopPropagation();
        if (e.type === "touchmove") track(t.clientX, t.clientY); else release();
      }
    };
    // moves/ends are followed on the whole page, so the thumb can wander past the circle's edge
    document.addEventListener("touchmove", moveOrEnd, { capture: true, passive: false });
    document.addEventListener("touchend", moveOrEnd, { capture: true, passive: false });
    document.addEventListener("touchcancel", moveOrEnd, { capture: true, passive: false });
    addEventListener("blur", release);
    document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
    return true;
  }

  window.PocketRoundPad = {
    init(emu) {
      let tries = 0;
      const t = setInterval(() => { if (setup(emu) || ++tries > 40) clearInterval(t); }, 250);
    },
  };
})();
