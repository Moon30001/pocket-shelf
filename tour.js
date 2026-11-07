// Pocket Shelf — step-by-step guided tour. Each step can spotlight a real button on the page.
// PocketTour.run(steps, { key }) — steps: [{ target: "#css-selector" | null, title, body (html), onShow?() }]
// PocketTour.maybe(key, steps) runs it once per device (until reset); PocketTour.reset(key) lets it show again.
(function () {
  let active = null;
  const seenKey = (k) => "ps_tour_" + k;
  const done = (k) => { try { return localStorage.getItem(seenKey(k)) === "1"; } catch (e) { return false; } };
  const markDone = (k) => { try { localStorage.setItem(seenKey(k), "1"); } catch (e) {} };

  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

  function run(steps, opts = {}) {
    if (active) active.close();
    const list = steps.filter(s => !s.when || s.when());
    if (!list.length) return;
    let i = 0;
    const shade = el(`<div class="tour-shade"></div>`);                // dims the page when nothing is spotlit
    const ring = el(`<div class="tour-ring"></div>`);                   // the highlight around the button
    const card = el(`<div class="tour-card" role="dialog" aria-live="polite"></div>`);
    const block = el(`<div class="tour-block"></div>`);                  // stops taps reaching the page underneath
    document.body.append(block, shade, ring, card);

    function place() {
      const s = list[i];
      const t = s.target && document.querySelector(s.target);
      const vis = t && t.getClientRects().length && getComputedStyle(t).visibility !== "hidden";
      if (vis) {
        const r = t.getBoundingClientRect(), pad = 6;
        Object.assign(ring.style, { display: "block", left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
        shade.style.display = "none";
        // card goes below the button if there's room, otherwise above
        const below = r.bottom + 14, ch = card.offsetHeight || 220;
        const top = below + ch < innerHeight - 8 ? below : Math.max(8, r.top - 14 - ch);
        Object.assign(card.style, { top: top + "px", bottom: "auto" });
      } else {
        ring.style.display = "none"; shade.style.display = "block";
        Object.assign(card.style, { top: "50%", bottom: "auto", transform: "translate(-50%, -50%)" });
        return;
      }
      card.style.transform = "translateX(-50%)";
    }
    function show() {
      const s = list[i];
      card.innerHTML = `
        <div class="tour-count">${i + 1} of ${list.length}</div>
        <h3>${s.title}</h3>
        <div class="tour-body">${s.body}</div>
        <div class="tour-btns">
          <button class="btn ghost tour-skip">Skip</button>
          <span style="flex:1"></span>
          ${i > 0 ? `<button class="btn ghost tour-back">Back</button>` : ""}
          <button class="btn primary tour-next">${i === list.length - 1 ? "Done" : "Next"}</button>
        </div>`;
      card.querySelector(".tour-skip").onclick = () => close(true);
      card.querySelector(".tour-next").onclick = () => { if (i === list.length - 1) close(true); else { i++; show(); } };
      const back = card.querySelector(".tour-back"); if (back) back.onclick = () => { i--; show(); };
      card.querySelectorAll("[data-tour-action]").forEach(b => b.onclick = () => { const a = list[i].actions && list[i].actions[b.dataset.tourAction]; if (a) a(); });
      const t = s.target && document.querySelector(s.target);
      if (t && t.scrollIntoView) t.scrollIntoView({ block: "center", behavior: "instant" });
      if (s.onShow) s.onShow();
      requestAnimationFrame(place);
    }
    function close(finished) {
      removeEventListener("resize", place); removeEventListener("scroll", place, true);
      block.remove(); shade.remove(); ring.remove(); card.remove();
      if (finished && opts.key) markDone(opts.key);
      active = null;
      if (opts.onClose) opts.onClose();
    }
    addEventListener("resize", place); addEventListener("scroll", place, true);
    active = { close };
    show();
  }
  window.PocketTour = {
    run,
    maybe(key, steps, opts = {}) { if (!done(key)) run(steps, Object.assign({ key }, opts)); },
    reset(key) { try { localStorage.removeItem(seenKey(key)); } catch (e) {} },
    isDone: done,
  };
})();
