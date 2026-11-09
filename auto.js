// Pocket Shelf — Auto modes: auto-advance, grind, auto-run (offline) and AI play (online, Google Gemini API)
(function () {
  const BTN = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };
  const AI_STEP_LIMIT = 150;
  const UNDO_SLOT = 9;

  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const gm = () => window.EJS_emulator && window.EJS_emulator.gameManager;
  const ls = {
    get(k, d = "") { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let run = null;            // { mode, stop: bool }
  let undoReady = false;

  // ---------- emulator helpers ----------
  function press(name, down) { const m = gm(); if (m) m.simulateInput(0, BTN[name], down ? 1 : 0); }
  function releaseAll() { Object.keys(BTN).forEach(k => press(k, false)); }
  async function tap(name, hold = 90, gap = 110) {
    if (!run || run.stop) return;
    press(name, true); await sleep(hold); press(name, false); await sleep(gap);
  }
  async function holdFor(name, ms) {
    if (!run || run.stop) return;
    press(name, true);
    const end = Date.now() + ms;
    while (Date.now() < end && run && !run.stop) await sleep(30);
    press(name, false);
  }
  function setFast(on) {
    const m = gm(); if (!m) return;
    try { m.toggleFastForward(on ? 1 : (window.EJS_emulator.isFastForward ? 1 : 0)); } catch (e) {}
  }
  function setRunning(on) { const m = gm(); if (m) try { m.toggleMainLoop(on ? 1 : 0); } catch (e) {} }

  // Native-resolution PNG of the game screen (only works while the emulator is running)
  async function grabPNG() {
    const m = gm();
    return Promise.race([m.screenshot(), sleep(2500).then(() => null)]);
  }
  async function pngToPixels(png) {
    const bmp = await createImageBitmap(new Blob([png], { type: "image/png" }));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d"); ctx.drawImage(bmp, 0, 0);
    return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, bmp };
  }
  function diffRatio(a, b) {
    if (!a || !b || a.data.length !== b.data.length) return 1;
    let changed = 0, n = 0;
    for (let i = 0; i < a.data.length; i += 16) { // sample every 4th pixel
      n++;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30) changed++;
    }
    return changed / n;
  }
  async function pngToBase64Upscaled(png, scale = 2) {
    const { bmp } = await pngToPixels(png);
    const c = document.createElement("canvas"); c.width = bmp.width * scale; c.height = bmp.height * scale;
    const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/png").split(",")[1];
  }

  // ---------- banner ----------
  function banner(html, actions = "") {
    const b = $("#autoBanner");
    b.innerHTML = `<div class="ab-text">${html}</div>${actions}`;
    b.classList.add("show");
  }
  function hideBanner() { $("#autoBanner").classList.remove("show"); }

  // ---------- start / stop ----------
  function begin(mode) {
    stopAuto(true);
    const m = gm();
    if (!m || !window.EJS_emulator.started) return false;
    try { undoReady = m.quickSave(UNDO_SLOT); } catch (e) { undoReady = false; }
    run = { mode, stop: false };
    return true;
  }
  function stopAuto(silent) {
    if (!run) return;
    const mode = run.mode;
    run.stop = true; run = null;
    releaseAll(); setFast(false); setRunning(true);
    if (silent) { hideBanner(); return; }
    const undo = undoReady ? `<button class="ab-btn" id="abUndo">Undo</button>` : "";
    banner(`Auto stopped`, `${undo}<button class="ab-btn" id="abClose">OK</button>`);
    const close = () => hideBanner();
    $("#abClose").onclick = close;
    if ($("#abUndo")) $("#abUndo").onclick = () => {
      try { gm().quickLoad(UNDO_SLOT); window.EJS_emulator.displayMessage("Back to before " + mode, 2500); } catch (e) {}
      undoReady = false; hideBanner();
    };
    clearTimeout(stopAuto._t); stopAuto._t = setTimeout(close, 8000);
  }
  window.PocketAuto = { stop: () => stopAuto(false), isRunning: () => !!run };

  // Any real control input stops auto modes
  function wireStopListeners() {
    const emu = window.EJS_emulator;
    const onUser = (e) => { if (run) { e.stopPropagation(); stopAuto(false); } };
    if (emu.virtualGamepad) {
      emu.virtualGamepad.addEventListener("touchstart", onUser, { capture: true, passive: true });
      emu.virtualGamepad.addEventListener("pointerdown", onUser, { capture: true });
    }
    document.addEventListener("keydown", (e) => { if (run && !e.target.closest("input,select,textarea")) stopAuto(false); }, true);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && run) stopAuto(true); });
  }

  // ---------- offline modes ----------
  async function autoAdvance() {
    if (!begin("auto-advance")) return;
    setFast(true);
    banner(`<b>Auto-advance</b> · skipping text at high speed<br><small>Tap any control to stop</small>`);
    const r = run;
    while (!r.stop) { await tap("A", 70, 260); }
  }

  async function grind() {
    if (!begin("grinding")) return;
    setFast(true);
    banner(`<b>Grinding</b> · walking in grass and fighting with your first move<br><small>Tap any control to stop</small>`);
    const r = run;
    let dir = "LEFT";
    while (!r.stop) {
      await holdFor(dir, 260);
      dir = dir === "LEFT" ? "RIGHT" : "LEFT";
      // A advances battle text and picks FIGHT → first move; B backs out of anything unexpected
      for (let i = 0; i < 3 && !r.stop; i++) await tap("A", 70, 160);
    }
  }

  async function autoRun(dir) {
    if (!begin("auto-run")) return;
    banner(`<b>Auto-run ${dir.toLowerCase()}</b> · stops when you bump into something<br><small>Tap any control to stop</small>`);
    const r = run;
    press(dir, true); press("B", true); // B = run (where the game supports it)
    let prev = null, still = 0;
    await sleep(500);
    while (!r.stop) {
      const png = await grabPNG(); if (!png || r.stop) break;
      const px = await pngToPixels(png);
      if (prev) {
        const d = diffRatio(prev, px);
        still = d < 0.004 ? still + 1 : 0;
        if (still >= 3) { stopAuto(false); window.EJS_emulator.displayMessage("Stopped: something's in the way", 2500); break; }
      }
      prev = px;
      await sleep(250);
    }
  }

  // ---------- Train mode (FireRed / LeafGreen / Emerald + hacks): grind, flee at low HP, heal, return ----------
  const DIRS = ["LEFT", "RIGHT", "UP", "DOWN"];
  const lowHp = (hp, maxHp) => hp < (maxHp >= 30 ? 15 : Math.ceil(maxHp / 2));
  function needsHeal(m) {
    const party = m.party().filter(Boolean);
    if (!party.length) return false;
    if (m.inBattle()) {                                    // the active Pokémon's battle HP is the freshest number
      const me = m.battleMon(0);
      if (me.maxHp && lowHp(me.hp, me.maxHp)) return true;
    }
    return party.some(p => !p.isEgg && p.maxHp && lowHp(p.hp, p.maxHp));
  }
  const FACING = { DOWN: 1, UP: 2, LEFT: 3, RIGHT: 4 };
  async function stepTo(m, dir, r) {                       // one tile in the field; true if the player moved
    const before = m.location();
    if (before.facing !== FACING[dir]) { await holdFor(dir, 60); await sleep(60); }   // turn first
    await holdFor(dir, 200);
    for (let i = 0; i < 25 && m.location().moving && !r.stop; i++) await sleep(20);
    const after = m.location();
    return after.x !== before.x || after.y !== before.y || after.mapNum !== before.mapNum || after.mapGroup !== before.mapGroup;
  }
  async function train() {
    const m = await getMem();
    const say = (html) => { banner(html, `<button class="ab-btn" id="abClose">OK</button>`); $("#abClose").onclick = hideBanner; };
    if (!m.supported) return say(esc(m.reason));
    if (!m.profile.rom) m.learnOverworld();               // hacks: we start from the field, so remember what "field" looks like
    if (!m.inOverworld()) return say("Start Train while walking around (not in a battle or menu).");
    if (!begin("training")) return;
    const r = run;
    const home = m.location();
    let dirIdx = 0, battles = 0, wasBattle = false, heals = 0, lastLearn = 0, trip = {};
    setFast(true);
    const show = (line) => { banner(`<b>Training</b> · ${battles} battle${battles === 1 ? "" : "s"}${heals ? ` · healed ${heals}×` : ""}<br><small>${esc(line)}</small>`, `<button class="ab-btn" id="abStop">Stop</button>`); const b = $("#abStop"); if (b) b.onclick = () => stopAuto(false); };
    const pause = (why) => { stopAuto(true); say(`<b>Training paused</b><br><small>${esc(why)}</small>`); };
    show("Walking in the grass…");
    while (!r.stop) {
      if (m.inBattle()) {
        if (!wasBattle) { battles++; wasBattle = true; }
        const low = needsHeal(m), trainer = m.isTrainerBattle();
        if (m.isLearningMove()) {                          // decline new moves: "No" to deleting one, then "Yes" to stop learning
          show("Skipping a new move so nothing gets forgotten");
          if (Date.now() - lastLearn > 900) { await tap("B", 70, 450); await tap("A", 70, 450); lastLearn = Date.now(); } else await sleep(150);
        } else if (low && !trainer) {
          show("HP is low, running away");
          if (m.setActionCursor(3)) {                      // RUN; the two B presses answer "No" to "Use next Pokémon?"
            await tap("B", 60, 160); await tap("B", 60, 160); await tap("A", 60, 220);
          } else {                                         // unknown layout: walk the cursor to RUN with buttons
            await tap("B", 60, 160); await tap("B", 60, 160);
            await tap("UP", 60, 120); await tap("LEFT", 60, 120); await tap("DOWN", 60, 120); await tap("RIGHT", 60, 120); await tap("A", 60, 220);
          }
        } else {
          const best = m.bestMoveIndex();
          show(`${trainer ? "Trainer battle" : "Wild battle"}: using ${m.canWrite() ? (PkData.moves[m.battleMon(0).moves[best]] || "a move") : "the first move"}`);
          if (m.setActionCursor(0) && m.setMoveCursor(best)) await tap("A", 60, 200);   // FIGHT → best move
          else {                                           // unknown layout: FIGHT, then the first move
            await tap("UP", 60, 100); await tap("LEFT", 60, 100); await tap("A", 60, 250);
            await tap("UP", 60, 100); await tap("LEFT", 60, 100); await tap("A", 60, 200);
          }
        }
        continue;
      }
      if (wasBattle) { wasBattle = false; await sleep(400); }
      if (!m.inOverworld()) {                              // text boxes, evolutions, the party menu after a faint…
        if (m.isLearningMove()) { await tap("B", 70, 400); await tap("A", 70, 400); continue; }
        const party = m.party(), healthy = party.findIndex(p => p && p.hp > 0);
        if (healthy > 0 && !m.setPartyMenuSlot(healthy)) {  // trainer battle faint: send out the first healthy Pokémon
          await tap("RIGHT", 60, 120); for (let i = 1; i < healthy; i++) await tap("DOWN", 60, 120);
        }
        await tap("A", 60, 260);
        continue;
      }
      // ---- in the field ----
      if (trip.phase || needsHeal(m)) {
        if (!window.PocketNav || !m.mapGroupsAddr) return pause("A Pokémon is low on HP. Heal it, then start Train again.");
        const res = await PocketNav.healAndReturn(m, { stepTo: (dir) => stepTo(m, dir, r), tap, sleep, stopped: () => r.stop, status: show }, home, trip);
        if (r.stop) break;
        if (res.interrupted) continue;                     // a battle on the way: handled above, then the trip carries on
        if (!res.ok) return pause(res.reason);
        heals++; trip = {}; show("Back to training");
        continue;
      }
      // pace back and forth near the starting spot; turn round at 3 tiles away or when something's in the way
      const here = m.location();
      if (here.mapNum !== home.mapNum || here.mapGroup !== home.mapGroup) return pause("Ended up on a different map.");
      let dir = DIRS[dirIdx];
      if (Math.abs(here.x - home.x) >= 3) dir = here.x > home.x ? "LEFT" : "RIGHT";
      else if (Math.abs(here.y - home.y) >= 3) dir = here.y > home.y ? "UP" : "DOWN";
      const moved = await stepTo(m, dir, r);
      dirIdx = moved ? (DIRS.indexOf(dir) ^ 1) : (DIRS.indexOf(dir) + 1) % 4;   // moved: walk back the other way · blocked: try another direction
      if (!moved && Math.random() < 0.3) await tap("A", 60, 200);  // clears any sign or text that popped up
    }
  }

  // ---------- online AI play ----------
  const SYSTEM_PROMPT = `You are an expert Pokémon player controlling a Game Boy / GBA / DS emulator one small step at a time.
Each turn you get the current screen and must call press_buttons with a SHORT sequence (1–8 presses) toward the goal, then you will see the new screen.

Controls: A = confirm/talk/advance text, B = cancel/back (hold B while moving to run once Running Shoes are owned), START = menu, SELECT = registered item, D-pad = move / move cursor. L/R rarely needed. On DS, X opens the menu.
Movement: holding a direction ~250 ms moves one tile; turning to face a new direction takes a short tap (~80 ms) first.

Play well and safely:
- Follow the main story toward the goal. Talk to people and read signs only when it helps progress.
- In battle choose sensible moves (type matchups), switch or heal when HP is low, use Poké Balls on new Pokémon when it makes sense, and run from pointless wild battles if the team is weak.
- Heal at Pokémon Centers when the team is hurt.
- NEVER release Pokémon, NEVER overwrite or delete the save file, never toss key items, never start a new game.
- When a Pokémon wants to learn a new move, only replace a clearly weaker move; otherwise decline.
- If the screen hasn't changed after your last presses, you are probably stuck: try something different.
Keep your notes updated with progress (badges, team, current objective, where you've been) so you can continue later.`;

  function toolDef(isDS) {
    const buttons = ["A", "B", "UP", "DOWN", "LEFT", "RIGHT", "START", "SELECT", "L", "R"].concat(isDS ? ["X", "Y"] : []);
    return {
      name: "press_buttons",
      description: "Press a short sequence of buttons on the console, in order.",
      input_schema: {
        type: "object",
        properties: {
          observation: { type: "string", description: "One sentence: what is on screen right now." },
          plan: { type: "string", description: "One short sentence: what these presses are for." },
          buttons: {
            type: "array", minItems: 1, maxItems: 8,
            items: {
              type: "object",
              properties: {
                button: { type: "string", enum: buttons },
                hold_ms: { type: "integer", minimum: 50, maximum: 2000, description: "How long to hold. ~80 for a tap, ~250 per tile walked." }
              },
              required: ["button"]
            }
          },
          notes: { type: "string", description: "Optional. Your full updated long-term notes (replaces the old ones). Under 1200 characters." }
        },
        required: ["observation", "plan", "buttons"]
      }
    };
  }

  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

  // Newest Flash models first (skips audio/image/tts/live/embedding variants)
  async function listGeminiModels(key) {
    const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((body.error && body.error.message) || `HTTP ${res.status}`); e.status = res.status; throw e; }
    const ver = (id) => (id.match(/gemini-(\d+(?:\.\d+)?)/) || [0, "0"])[1] * 1;
    return (body.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ""))
      .filter(id => /^gemini-/.test(id) && /flash|pro/.test(id) && !/tts|audio|image|live|embedding|native|thinking-exp|computer/.test(id))
      .sort((a, b) => (ver(b) - ver(a)) || (/lite/.test(a) - /lite/.test(b)) || (/preview|exp/.test(a) - /preview|exp/.test(b)) || (/pro/.test(a) - /pro/.test(b)));
  }

  // Gemini's schema dialect: plain types, no numeric/array bounds
  function toGeminiSchema(x) {
    if (Array.isArray(x)) return x.map(toGeminiSchema);
    if (!x || typeof x !== "object") return x;
    const out = {};
    for (const [k, v] of Object.entries(x)) {
      if (["minimum", "maximum", "minItems", "maxItems"].includes(k)) continue;
      out[k] = (k === "type" && typeof v === "string") ? v.toUpperCase() : toGeminiSchema(v);
    }
    return out;
  }

  async function callGemini({ key, model, system, tool, imageB64, text, onWait }) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: imageB64 } }, { text }] }],
      tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] } },
      generationConfig: { maxOutputTokens: 4096 }
    };
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body)
      });
      const out = await res.json().catch(() => ({}));
      // 429 = free-tier speed limit: wait and retry the same model.
      // 500/503 = this model is busy ("high demand"): fail fast so the caller tries the next model.
      if (res.status === 429 && attempt < 3) {
        const wait = 6000 * (attempt + 1);
        if (onWait) onWait(wait, res.status);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const e = new Error((out.error && out.error.message) || `HTTP ${res.status}`); e.status = res.status; throw e;
      }
      const parts = (((out.candidates || [])[0] || {}).content || {}).parts || [];
      const call = parts.find(p => p.functionCall);
      if (!call) throw new Error("Gemini didn't return any button presses.");
      return { input: call.functionCall.args || {}, usage: out.usageMetadata || {} };
    }
  }

  async function aiPlay(ctx) {
    const key = ls.get("ps_gemini_key").trim();
    if (!key) return openSheet("ai-setup");
    if (!navigator.onLine) { banner(`AI play needs internet. The offline helpers still work.`, `<button class="ab-btn" id="abClose">OK</button>`); $("#abClose").onclick = hideBanner; return; }
    let model = ls.get("ps_gemini_model");
    if (!model) {
      try { model = (await listGeminiModels(key))[0]; ls.set("ps_gemini_model", model || ""); } catch (e) {}
      if (!model) return openSheet("ai-setup");
    }
    if (!begin("AI play")) return;
    const r = run;
    const game = ctx.getGame();
    const isDS = game.system === "nds";
    const tool = toolDef(isDS);
    const history = [];
    let steps = 0, tokens = 0, lastPNG = null, stuck = 0, mem;

    const show = (line) => banner(
      `<b>AI playing</b> · step ${steps}<br><small>${esc(line || "Thinking…")}</small>`,
      `<button class="ab-btn" id="abStop">Stop</button>`);
    show("Looking at the screen…");
    const wireStop = () => { const b = $("#abStop"); if (b) b.onclick = () => stopAuto(false); };
    wireStop();

    while (!r.stop) {
      if (steps > 0 && steps % AI_STEP_LIMIT === 0) {
        setRunning(false);
        banner(`<b>AI paused after ${steps} moves</b> · ${Math.round(tokens / 1000)}k tokens used`, `<button class="ab-btn" id="abGo">Keep going</button><button class="ab-btn" id="abStop">Stop</button>`);
        const go = await new Promise(res => { $("#abGo").onclick = () => res(true); $("#abStop").onclick = () => res(false); });
        if (!go || r.stop) { stopAuto(false); break; }
        setRunning(true);
      }
      await sleep(350);                       // let the last presses settle
      const png = await grabPNG();
      if (!png || r.stop) break;
      let changed = true;
      try { if (lastPNG) changed = diffRatio(await pngToPixels(lastPNG), await pngToPixels(png)) > 0.003; } catch (e) {}
      stuck = changed ? 0 : stuck + 1;
      lastPNG = png;
      setRunning(false);                      // freeze the game while the AI thinks
      const image = await pngToBase64Upscaled(png, 2);
      const notes = game.aiNotes || "(none yet)";
      // Exact game state read from memory (FireRed / LeafGreen / Emerald + hacks) — far more reliable than the screenshot alone
      let liveInfo = "";
      try {
        if (mem === undefined) mem = game.system === "gba" ? await getMem() : null;
        if (mem && mem.supported) {
          const x = mem.snapshot(), L = x.location;
          const lines = [`LIVE GAME DATA (read from memory, trust this over the picture):`,
            `State: ${x.state}. Map ${L.mapGroup}.${L.mapNum}, position x=${L.x} y=${L.y}, facing ${["?", "down", "up", "left", "right"][L.facing] || "?"}.`,
            `Last Pokémon Center: map ${L.heal.mapGroup}.${L.heal.mapNum}.`,
            `Party: ${x.party.map(p => p ? `${p.name} Lv${p.level} ${p.hp}/${p.maxHp}HP` : "?").join(", ") || "none"}.`];
          if (x.state === "battle") {
            const me = mem.battleMon(0), foe = mem.battleMon(1);
            lines.push(`Battle: your ${(PkData.species[me.species] || {}).name} ${me.hp}/${me.maxHp}HP vs ${(PkData.species[foe.species] || {}).name} Lv${foe.level} ${foe.hp}/${foe.maxHp}HP${mem.isTrainerBattle() ? " (trainer battle, can't run)" : " (wild)"}.`);
            lines.push(`Your moves: ${me.moves.map((mv, i) => mv ? `${i + 1}. ${PkData.moves[mv]} (${me.pp[i]} PP)` : "").filter(Boolean).join("; ")}. Strongest choice by type matchup: move ${mem.bestMoveIndex() + 1}.`);
            lines.push(`Battle menu: FIGHT top-left, BAG top-right, POKéMON bottom-left, RUN bottom-right.`);
          }
          liveInfo = lines.join("\n");
        }
      } catch (e) { liveInfo = ""; }
      const text = [
        `Game: ${game.title} (${isDS ? "Nintendo DS — top and bottom screen stacked" : game.system === "gb" ? "Game Boy" : "Game Boy Advance"}).`,
        `Goal: ${game.aiGoal || "Progress through the main story."}`,
        `Your notes so far:\n${notes}`,
        history.length ? `Your recent steps (oldest first):\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "This is your first step this session.",
        stuck >= 2 ? `WARNING: the screen has not changed for ${stuck} steps — you are likely stuck; try a different approach.` : "",
        liveInfo,
        "Choose your next presses."
      ].filter(Boolean).join("\n\n");

      let out;
      try {
        const onWait = (ms, status) => { banner(`<b>AI playing</b> · step ${steps}<br><small>${status === 429 ? "Free-tier speed limit" : "Gemini is busy"}, retrying in ${Math.round(ms / 1000)}s…</small>`, `<button class="ab-btn" id="abStop">Stop</button>`); wireStop(); };
        // Try the saved model first, then every other Gemini model on this key, until one answers.
        let order = [model];
        let lastErr = null;
        for (let round = 0; round < 2 && !out && !r.stop; round++) {
          for (let i = 0; i < order.length && !r.stop; i++) {
            const m = order[i];
            if (m !== model || round > 0) { banner(`<b>AI playing</b> · step ${steps}<br><small>${esc(model)} is busy, trying ${esc(m)}…</small>`, `<button class="ab-btn" id="abStop">Stop</button>`); wireStop(); }
            try {
              out = await callGemini({ key, model: m, system: SYSTEM_PROMPT, tool, imageB64: image, text, onWait });
              if (m !== model) { model = m; ls.set("ps_gemini_model", m); }
              lastErr = null; break;
            } catch (e) {
              lastErr = e;
              if (![500, 503, 404].includes(e.status)) throw e;          // a real error (bad key, daily limit) — stop
              if (order.length === 1) { try { order = order.concat((await listGeminiModels(key)).filter(id => id !== model)); } catch (e2) {} }
            }
          }
          if (!out && !r.stop && round === 0) {                          // every model was busy: short pause, then one more lap
            banner(`<b>AI playing</b> · step ${steps}<br><small>All Gemini models are busy, trying again in 15s…</small>`, `<button class="ab-btn" id="abStop">Stop</button>`); wireStop();
            await sleep(15000);
          }
        }
        if (!out && lastErr) throw lastErr;
      } catch (e) {
        if (r.stop) break;
        const why = (e.status === 400 && /api key/i.test(e.message)) || e.status === 401 || e.status === 403 ? "Your Gemini API key was rejected. Check it in AI settings."
          : e.status === 404 ? "That Gemini model isn't available any more. Open AI settings to pick another."
          : e.status === 429 ? "Gemini's daily free limit is used up. It resets overnight (Pacific time)."
          : [500, 503].includes(e.status) ? "Every Gemini model on your key is busy right now. Try again in a few minutes."
          : !navigator.onLine ? "You went offline." : e.message;
        stopAuto(true);
        banner(`<b>AI stopped</b><br><small>${esc(why)}</small>`, `<button class="ab-btn" id="abClose">OK</button>`);
        $("#abClose").onclick = hideBanner;
        return;
      }
      if (r.stop) break;
      const u = out.usage;
      tokens += (u.totalTokenCount || 0);
      steps++;
      const inp = out.input || {};
      if (typeof inp.notes === "string" && inp.notes.trim()) {
        game.aiNotes = inp.notes.trim().slice(0, 1500);
        ctx.saveGame(game);
      }
      const seq = (Array.isArray(inp.buttons) ? inp.buttons : []).slice(0, 8);
      history.push(`${inp.plan || ""} → ${seq.map(b => b.button).join(", ")}`);
      if (history.length > 10) history.shift();
      show(inp.plan || inp.observation || "");
      wireStop();
      setRunning(true);
      for (const b of seq) {
        if (r.stop || !BTN.hasOwnProperty(b.button)) break;
        const hold = Math.max(50, Math.min(2000, parseInt(b.hold_ms) || 90));
        await holdFor(b.button, hold);
        await sleep(120);
      }
    }
  }

  // ---------- sheet UI ----------
  let ctxRef = null;

  // ---- live game memory (FireRed / LeafGreen / Emerald + hacks) ----
  let memPromise = null;
  async function getMem() {
    if (!memPromise) memPromise = (async () => window.PocketMem.attach(gm(), await ctxRef.getRom()))().catch(e => ({ supported: false, reason: e.message }));
    const m = await memPromise;
    if (!m.supported) memPromise = null;                 // try again next time (e.g. still on the title screen)
    return m;
  }
  window.PocketGameMem = getMem;

  let infoTimer = null;
  async function showInfo() {
    const s = $("#autoSheet"), box = s.querySelector(".sheet");
    box.innerHTML = `<h3>Game info <small style="color:var(--accent);font-size:12px">beta</small></h3><div class="sub">Live readings from the game's memory. If something here looks wrong, send Claude a screenshot.</div><div id="infoBody" class="d">Reading the game's memory…</div>
      <div class="actions"><button class="btn ghost full" data-a="close">Close</button></div>`;
    box.onclick = (e) => { if (e.target.closest("[data-a='close']")) { clearInterval(infoTimer); closeSheet(); } };
    if (!s.classList.contains("open")) s.classList.add("open");
    setRunning(true);                                    // keep the game running so the numbers update
    const m = await getMem();
    const body = $("#infoBody");
    if (!m.supported) { body.textContent = m.reason; return; }
    const bar = (hp, mx) => `<span style="display:inline-block;width:70px;height:6px;border-radius:3px;background:#333;vertical-align:middle;margin:0 6px"><span style="display:block;height:100%;width:${mx ? Math.round(100 * hp / mx) : 0}%;border-radius:3px;background:${hp / mx < 0.25 ? "#ff6b6b" : hp / mx < 0.5 ? "#ffcb3d" : "#47d18c"}"></span></span>`;
    const draw = () => {
      try {
        const x = m.snapshot(), L = x.location;
        body.innerHTML = `<div class="row"><div><div class="k">${esc(x.game)}${m.relocated ? " · memory found by search" : ""}</div><div class="d">Now: ${esc(x.state)}</div></div></div>
          <div class="row"><div><div class="k">Position</div><div class="d">Map ${L.mapGroup}.${L.mapNum} · x ${L.x}, y ${L.y} · facing ${["", "down", "up", "left", "right"][L.facing] || L.facing}</div>
          <div class="d">Last Pokémon Center: map ${L.heal.mapGroup}.${L.heal.mapNum} (x ${L.heal.x}, y ${L.heal.y})</div></div></div>
          <div class="row" style="display:block"><div class="k" style="margin-bottom:4px">Party</div>${x.party.length ? x.party.map(p => p ? `<div class="d">${esc(p.name)} Lv ${p.level}${bar(p.hp, p.maxHp)}${p.hp}/${p.maxHp} HP</div>` : `<div class="d">(unreadable slot)</div>`).join("") : `<div class="d">${esc(m.partyWarning || "No Pokémon yet")}</div>`}</div>
          ${x.enemy && x.enemy.maxHp ? `<div class="row"><div><div class="k">Opponent</div><div class="d">${esc((PkData.species[x.enemy.species] || {}).name || "#" + x.enemy.species)} Lv ${x.enemy.level}${bar(x.enemy.hp, x.enemy.maxHp)}${x.enemy.hp}/${x.enemy.maxHp} HP</div></div></div>` : ""}`;
      } catch (e) { body.textContent = "Reading failed: " + e.message; }
    };
    if (!m.profile.rom) m.learnOverworld();              // hacks: assume we're in the overworld when this opens from the field
    draw(); clearInterval(infoTimer); infoTimer = setInterval(draw, 500);
  }
  function openSheet(view) {
    const s = $("#autoSheet");
    const online = navigator.onLine;
    const key = ls.get("ps_gemini_key");
    const model = ls.get("ps_gemini_model");
    const game = ctxRef.getGame();
    if (view === "ai-setup") {
      s.querySelector(".sheet").innerHTML = `
        <h3>AI play settings</h3>
        <div class="sub">AI play uses Google Gemini with your own free API key. The key stays on this phone and is only sent to Google.</div>
        <label class="k">Gemini API key</label>
        <input type="password" id="aiKey" placeholder="Paste your key here" value="${esc(key)}" autocomplete="off">
        <div class="d" style="margin:6px 0 12px">Get one free at <b>aistudio.google.com</b> → Get API key. No credit card needed.</div>
        <label class="k">Model</label>
        <select id="aiModel" style="width:100%;margin:6px 0 4px"><option value="${esc(model)}">${esc(model || "Add your key first")}</option></select>
        <div class="d" id="aiModelNote" style="margin:0 0 12px"></div>
        <label class="k">Goal for ${esc(game.title)}</label>
        <input type="text" id="aiGoal" placeholder="e.g. Beat the next gym" value="${esc(game.aiGoal || "")}">
        <div class="d" style="margin:6px 0 12px">Leave empty to just progress the story. The AI keeps its own notes per game${game.aiNotes ? ` · <a href="#" id="aiForget" style="color:var(--muted)">clear its notes</a>` : ""}.</div>
        <div class="actions">
          <button class="btn ghost" data-a="back">Back</button>
          <button class="btn primary" data-a="save">Save & start</button>
        </div>`;
      const loadModels = async () => {
        const k = $("#aiKey").value.trim(), sel = $("#aiModel"), note = $("#aiModelNote");
        if (!k) return;
        note.textContent = "Checking your key…";
        try {
          const list = await listGeminiModels(k);
          if (!list.length) { note.textContent = "No suitable models found for this key."; return; }
          const keep = list.includes(sel.value) ? sel.value : list[0];
          sel.innerHTML = list.map(id => `<option value="${esc(id)}" ${id === keep ? "selected" : ""}>${esc(id)}</option>`).join("");
          note.textContent = "Key works ✓ The newest Flash model is picked by default.";
        } catch (e) {
          note.textContent = e.status === 400 || e.status === 403 ? "That key was rejected. Check you copied all of it." : "Couldn't reach Google: " + e.message;
        }
      };
      $("#aiKey").addEventListener("change", loadModels);
      if (key && navigator.onLine) loadModels();
      const forget = s.querySelector("#aiForget");
      if (forget) forget.onclick = (e) => { e.preventDefault(); game.aiNotes = ""; ctxRef.saveGame(game); forget.textContent = "notes cleared"; };
      s.querySelector(".sheet").onclick = (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "back") return openSheet("menu");
        if (a === "save") {
          ls.set("ps_gemini_key", $("#aiKey").value.trim());
          if ($("#aiModel").value) ls.set("ps_gemini_model", $("#aiModel").value);
          game.aiGoal = $("#aiGoal").value.trim(); ctxRef.saveGame(game);
          if (!$("#aiKey").value.trim()) return;
          closeSheet(true); aiPlay(ctxRef);
        }
      };
    } else {
      s.querySelector(".sheet").innerHTML = `
        <h3>Auto</h3>
        <div class="sub">Tap any game control to stop. A restore point is made each time, so you can undo.</div>
        <button class="auto-item" data-a="ai" ${online ? "" : "disabled"}>
          <span class="ai-ic">AI</span>
          <span><b>AI plays</b><br><small>${online ? (key ? `Gemini decides every move${model ? " · " + esc(model) : ""}` : "Set up once with a free Gemini key") : "Needs internet"}</small></span>
        </button>
        ${key ? `<button class="link-btn" data-a="ai-setup">AI settings & goal</button>` : ""}
        ${game.system === "gba" ? `<button class="auto-item" data-a="info"><span class="ai-ic">ⓘ</span><span><b>Game info</b> <small style="color:var(--accent)">beta</small><br><small>What Pocket Shelf can read from the game right now</small></span></button>` : ""}
        ${game.system === "gba" ? `<button class="auto-item" data-a="train"><span class="ai-ic">⚡</span><span><b>Train</b> <small style="color:var(--accent)">beta</small><br><small>Grinds here, runs at low HP, heals at the Pokémon Center and comes back. FireRed, LeafGreen, Emerald &amp; hacks</small></span></button>` : ""}
        ${game.system === "gba" ? `<button class="auto-item" data-a="together"><span class="ai-ic">👥</span><span><b>Play together</b> <small style="color:var(--accent)">beta</small><br><small>See friends walking around your world, wave and trade. Up to 4 players</small></span></button>` : ""}
        <button class="auto-item" data-a="advance"><span class="ai-ic">≫</span><span><b>Auto-advance</b><br><small>Mashes A at high speed to skip dialogue</small></span></button>
        <button class="auto-item" data-a="grind"><span class="ai-ic">⚔</span><span><b>Grind in grass</b><br><small>Stand in tall grass first. Walks and battles with your first move</small></span></button>
        <div class="auto-item" style="cursor:default"><span class="ai-ic">➜</span><span style="flex:1"><b>Auto-run</b><br><small>Runs until you hit something</small></span>
          <span class="dirs"><button data-a="run" data-d="UP">↑</button><button data-a="run" data-d="LEFT">←</button><button data-a="run" data-d="DOWN">↓</button><button data-a="run" data-d="RIGHT">→</button></span></div>`;
      s.querySelector(".sheet").onclick = (e) => {
        const el = e.target.closest("[data-a]"); if (!el || el.disabled) return;
        const a = el.dataset.a;
        if (a === "ai-setup") return openSheet("ai-setup");
        if (a === "ai") { if (!key) return openSheet("ai-setup"); closeSheet(true); return aiPlay(ctxRef); }
        closeSheet(true);
        if (a === "info") return showInfo();
        if (a === "train") { closeSheet(true); return train(); }
        if (a === "together") { closeSheet(true); return window.PocketGhosts && PocketGhosts.open(); }
        if (a === "advance") autoAdvance();
        if (a === "grind") grind();
        if (a === "run") autoRun(el.dataset.d);
      };
    }
    if (!s.classList.contains("open")) { setRunning(false); s.classList.add("open"); }
  }
  function closeSheet(starting) {
    clearInterval(infoTimer); infoTimer = null;          // stop live Game info however the sheet was closed
    $("#autoSheet").classList.remove("open");
    setRunning(true);
  }

  // Keep the Auto button away from every game control:
  // portrait → right side of the empty strip under the game picture (or top-right if there's no strip, e.g. DS)
  function placeAutoBtn() {
    const btn = $("#autoBtn"), emu = window.EJS_emulator;
    if (!btn || !emu || !emu.canvas) return;
    btn.style.cssText = "";
    const groups = emu.virtualGamepad ? emu.virtualGamepad.querySelectorAll(".ejs_virtualGamepad_left, .ejs_virtualGamepad_right") : [];
    groups.forEach(g => g.style.transform = "");          // measure from EmulatorJS's own layout
    if (innerWidth > innerHeight) return;                 // landscape: CSS puts it in the left side bar
    let aspect = 1.5;
    try { aspect = emu.gameManager.getVideoDimensions("aspect") || aspect; } catch (e) {}
    const c = emu.canvas.getBoundingClientRect();
    const pictureBottom = c.top + Math.min(c.height, c.width / aspect);
    let controlsTop = innerHeight;
    if (emu.virtualGamepad && emu.virtualGamepad.style.display !== "none") {
      emu.virtualGamepad.querySelectorAll(".ejs_virtualGamepad_button, .ejs_dpad_main").forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) controlsTop = Math.min(controlsTop, r.top);
      });
    }
    btn.style.position = "fixed";
    btn.style.right = "10px";
    btn.style.left = "auto"; btn.style.bottom = "auto";
    btn.style.top = (controlsTop - pictureBottom >= 48 ? pictureBottom + 10 : c.top + 8) + "px";
    if (controlsTop - pictureBottom < 48) btn.style.right = "52px";   // sit beside the ☰ menu
    // Portrait: lift the D-pad, A/B and L/R up into the empty space under the game (just below Auto),
    // leaving a gap above the bottom row (Library, Select, Start, Games).
    if (controlsTop - pictureBottom >= 48 && groups.length) {
      const target = pictureBottom + 10 + btn.offsetHeight + 14;
      const lift = Math.round((controlsTop - target) * 0.55);   // about halfway: room under Auto and above the bottom row
      if (lift > 8) groups.forEach(g => g.style.transform = `translateY(${-lift}px)`);
    }
  }

  window.PocketAutoInit = function (ctx) {
    ctxRef = ctx;
    wireStopListeners();
    placeAutoBtn();
    setTimeout(placeAutoBtn, 600);
    addEventListener("resize", () => setTimeout(placeAutoBtn, 200));
    $("#autoBtn").onclick = () => { if (run) return stopAuto(false); openSheet("menu"); };
    $("#autoSheet").addEventListener("click", (e) => { if (e.target.id === "autoSheet") closeSheet(false); });
  };
})();
