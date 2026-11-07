// Pocket Shelf — walking around FireRed / LeafGreen / Emerald by reading the maps out of the ROM.
// Used by Train mode to reach the Pokémon Center, heal, and walk back. Map formats from pret's decompilations.
(function () {
  const ROM = 0x08000000;
  const DIR = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  const BEHAVIOR = {
    E:    { water: [16, 17, 18, 19, 20, 21], jump: { 56: "RIGHT", 57: "LEFT", 58: "UP", 59: "DOWN" }, doors: [96, 105], arrows: { 98: "RIGHT", 99: "LEFT", 100: "UP", 101: "DOWN", 109: "DOWN" }, counter: 128, blocked: [208, 102] },
    FRLG: { water: [16, 17, 18, 19, 21, 27], jump: { 56: "RIGHT", 57: "LEFT", 58: "UP", 59: "DOWN" }, doors: [96, 105], arrows: { 98: "RIGHT", 99: "LEFT", 100: "UP", 101: "DOWN" }, counter: 128, blocked: [] },
  };
  const PRIMARY_METATILES = { E: 512, FRLG: 640 };

  function world(m) {
    if (m._world) return m._world;
    const rom = m.rom, fam = m.profile.family, B = BEHAVIOR[fam];
    const u8 = (a) => rom[a - ROM], s8 = (a) => { const v = u8(a); return v > 127 ? v - 256 : v; };
    const u16 = (a) => u8(a) | (u8(a + 1) << 8), s16 = (a) => { const v = u16(a); return v > 32767 ? v - 65536 : v; };
    const u32 = (a) => (u8(a) | (u8(a + 1) << 8) | (u8(a + 2) << 16) | (u8(a + 3) << 24)) >>> 0;
    const isPtr = (p) => p >= ROM && p < ROM + rom.length;
    const cache = new Map();
    function map(group, num) {
      const key = group + "." + num;
      if (cache.has(key)) return cache.get(key);
      let result = null;
      try {
        const groupPtr = u32(m.mapGroupsAddr + group * 4);
        const header = u32(groupPtr + num * 4);
        if (!isPtr(groupPtr) || !isPtr(header)) throw 0;
        const layout = u32(header), events = u32(header + 4), conns = u32(header + 12);
        const w = u32(layout), h = u32(layout + 4), grid = u32(layout + 12), prim = u32(layout + 16), sec = u32(layout + 20);
        if (w > 256 || h > 256 || !isPtr(grid)) throw 0;
        const attrsOf = (ts) => isPtr(ts) ? u32(ts + 16) : 0;
        const pa = attrsOf(prim), sa = attrsOf(sec), np = PRIMARY_METATILES[fam];
        const behaviorOf = (mt) => {
          const base = mt < np ? pa : sa, idx = mt < np ? mt : mt - np;
          if (!base) return 0;
          return fam === "E" ? u16(base + idx * 2) & 0xFF : u32(base + idx * 4) & 0x1FF;
        };
        const tiles = new Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const v = u16(grid + i * 2);
          tiles[i] = { collision: (v >> 10) & 3, elevation: v >> 12, behavior: behaviorOf(v & 0x3FF) };
        }
        const warps = [], objects = [];
        if (isPtr(events)) {
          const nObj = u8(events), nWarp = u8(events + 1), objPtr = u32(events + 4), warpPtr = u32(events + 8);
          for (let i = 0; i < nWarp && isPtr(warpPtr); i++) {
            const a = warpPtr + i * 8;
            warps.push({ x: s16(a), y: s16(a + 2), warpId: u8(a + 5), mapNum: u8(a + 6), mapGroup: u8(a + 7) });
          }
          for (let i = 0; i < nObj && isPtr(objPtr); i++) {
            const a = objPtr + i * 24;
            objects.push({ x: s16(a + 4), y: s16(a + 6) });
          }
        }
        const connections = [];
        if (isPtr(conns)) {
          const n = u32(conns), list = u32(conns + 4);
          for (let i = 0; i < n && i < 8 && isPtr(list); i++) {
            const a = list + i * 12;
            connections.push({ direction: u8(a), offset: (u32(a + 4) | 0), mapGroup: u8(a + 8), mapNum: u8(a + 9) });
          }
        }
        result = { group, num, w, h, tiles, warps, objects, connections };
      } catch (e) { result = null; }
      cache.set(key, result);
      return result;
    }
    m._world = { map, B };
    return m._world;
  }

  // ---- route finding: breadth-first search over (map, x, y), following doors, stairs and map edges ----
  function plan(m, from, goalTest, { maxNodes = 250000 } = {}) {
    const W = world(m), B = W.B;
    const key = (g, n, x, y) => `${g}.${n}.${x}.${y}`;
    const start = { g: from.mapGroup, n: from.mapNum, x: from.x, y: from.y };
    const prev = new Map([[key(start.g, start.n, start.x, start.y), null]]);
    const queue = [start];
    const objectsAt = (mp) => new Set(mp.objects.map(o => o.x + "," + o.y));
    const objCache = new Map();
    for (let qi = 0; qi < queue.length && prev.size < maxNodes; qi++) {
      const cur = queue[qi];
      if (goalTest(cur)) {
        const steps = [];
        for (let k = key(cur.g, cur.n, cur.x, cur.y); prev.get(k); k = prev.get(k).from) steps.unshift(prev.get(k));
        return steps;
      }
      const mp = W.map(cur.g, cur.n); if (!mp) continue;
      if (!objCache.has(mp)) objCache.set(mp, objectsAt(mp));
      const people = objCache.get(mp);
      const here = mp.tiles[cur.y * mp.w + cur.x];
      for (const [dir, [dx, dy]] of Object.entries(DIR)) {
        const push = (nx, ny, ng, nn, extra) => {
          const k = key(ng, nn, nx, ny);
          if (prev.has(k)) return;
          prev.set(k, { from: key(cur.g, cur.n, cur.x, cur.y), dir, at: { g: cur.g, n: cur.n, x: cur.x, y: cur.y }, to: { g: ng, n: nn, x: nx, y: ny }, ...extra });
          queue.push({ g: ng, n: nn, x: nx, y: ny });
        };
        // arrow warps (stairs, door mats): stand on them and press the arrow's direction
        if (here && B.arrows[here.behavior] === dir) {
          const wp = mp.warps.find(w => w.x === cur.x && w.y === cur.y);
          if (wp) { const dest = warpDest(W, wp); if (dest) push(dest.x, dest.y, dest.g, dest.n, { warp: true }); continue; }
        }
        let nx = cur.x + dx, ny = cur.y + dy;
        // walking off the edge of the map into a connected one
        if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) {
          const want = { DOWN: 1, UP: 2, LEFT: 3, RIGHT: 4 }[dir];
          const c = mp.connections.find(c => c.direction === want);
          if (!c) continue;
          const t = W.map(c.mapGroup, c.mapNum); if (!t) continue;
          let tx = nx, ty = ny;
          if (want === 1) { ty = 0; tx = nx - c.offset; } else if (want === 2) { ty = t.h - 1; tx = nx - c.offset; }
          else if (want === 3) { tx = t.w - 1; ty = ny - c.offset; } else { tx = 0; ty = ny - c.offset; }
          if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) continue;
          const tt = t.tiles[ty * t.w + tx];
          if (tt.collision || B.water.includes(tt.behavior)) continue;
          push(tx, ty, c.mapGroup, c.mapNum, {});
          continue;
        }
        const t = mp.tiles[ny * mp.w + nx];
        const wp = mp.warps.find(w => w.x === nx && w.y === ny);
        if (wp && !(t && B.arrows[t.behavior])) {                // doors and holes warp as soon as you step on them
          const dest = warpDest(W, wp); if (dest) push(dest.x, dest.y, dest.g, dest.n, { warp: true });
          continue;
        }
        if (!t || people.has(nx + "," + ny)) continue;
        const jump = B.jump[t.behavior];
        if (jump) {                                              // ledges: only hop down them, landing one tile further
          if (jump !== dir) continue;
          const lx = nx + dx, ly = ny + dy;
          if (lx < 0 || ly < 0 || lx >= mp.w || ly >= mp.h) continue;
          const land = mp.tiles[ly * mp.w + lx];
          if (land.collision || B.water.includes(land.behavior)) continue;
          push(lx, ly, cur.g, cur.n, { jump: true });
          continue;
        }
        if (t.collision || B.water.includes(t.behavior) || B.blocked.includes(t.behavior)) continue;
        if (here && t.elevation !== here.elevation && ![0, 15].includes(t.elevation) && ![0, 15].includes(here.elevation)) continue;
        if (wp) { push(nx, ny, cur.g, cur.n, {}); continue; }  // stepping onto an arrow warp tile (used next step)
        push(nx, ny, cur.g, cur.n, {});
      }
    }
    return null;
  }
  function warpDest(W, wp) {
    const t = W.map(wp.mapGroup, wp.mapNum);
    if (!t || !t.warps[wp.warpId]) return null;
    const d = t.warps[wp.warpId];
    let x = d.x, y = d.y;
    const tile = t.tiles[y * t.w + x];
    if (tile && W.B.doors.includes(tile.behavior)) y += 1;      // coming out of a door, the game walks you one step down
    return { g: wp.mapGroup, n: wp.mapNum, x, y };
  }

  // ---- walking a planned route ----
  async function walk(m, ctl, steps) {
    for (const s of steps) {
      if (ctl.stopped()) return { ok: false, stopped: true };
      if (!m.inOverworld()) return { ok: false, interrupted: true };
      await ctl.stepTo(s.dir);
      if (s.warp || s.jump) await ctl.sleep(s.warp ? 1200 : 300);  // door/stairs transitions and ledge hops take a moment
      const now = m.location();
      if (now.mapGroup !== s.to.g || now.mapNum !== s.to.n || now.x !== s.to.x || now.y !== s.to.y) {
        if (!m.inOverworld()) return { ok: false, interrupted: true };
        return { ok: false, replan: true };                     // something was in the way (a person walking about) — plan again
      }
    }
    return { ok: true };
  }
  async function walkTo(m, ctl, goalTest, label) {
    for (let attempt = 0; attempt < 12; attempt++) {
      if (ctl.stopped()) return { ok: false, stopped: true };
      const steps = plan(m, m.location(), goalTest);
      if (!steps) return { ok: false, reason: `Couldn't find a way ${label}. Heal manually, then start Train again.` };
      if (!steps.length) return { ok: true };
      const r = await walk(m, ctl, steps);
      if (r.ok || r.stopped || r.interrupted) return r;
      await ctl.sleep(400 + attempt * 200);
    }
    return { ok: false, reason: `Kept getting blocked ${label}.` };
  }

  // Inside a Pokémon Center: stand in front of the counter below the nurse, talk, say yes
  async function talkToNurse(m, ctl) {
    const W = world(m), here = m.location(), mp = W.map(here.mapGroup, here.mapNum);
    if (!mp) return { ok: false, reason: "Couldn't read this building's layout." };
    const spots = mp.objects.filter(o => { const t = mp.tiles[(o.y + 1) * mp.w + o.x]; return t && t.behavior === W.B.counter; })
      .map(o => ({ x: o.x, y: o.y + 2 }));
    if (!spots.length) return { ok: false, reason: "Couldn't find the nurse's counter." };
    const r = await walkTo(m, ctl, (c) => c.g === here.mapGroup && c.n === here.mapNum && spots.some(s => s.x === c.x && s.y === c.y), "to the counter");
    if (!r.ok) return r;
    await ctl.stepTo("UP");                                    // face the nurse (blocked by the counter, so this only turns)
    for (let i = 0; i < 14 && !ctl.stopped(); i++) {
      await ctl.tap("A", 70, 650);
      const party = m.party().filter(Boolean);
      if (i > 3 && party.length && party.every(p => p.hp === p.maxHp) && m.inOverworld()) return { ok: true };
    }
    for (let i = 0; i < 3; i++) await ctl.tap("B", 70, 400);
    const party = m.party().filter(Boolean);
    return party.every(p => p.hp === p.maxHp) ? { ok: true } : { ok: false, reason: "The nurse didn't heal the team." };
  }

  // The whole trip: Pokémon Center → heal → back to where training started.
  // Returns { ok } when done, { ok:false, interrupted:true } if a battle starts on the way (Train handles it, then calls again).
  async function healAndReturn(m, ctl, home, state) {
    const W = world(m);
    state.phase = state.phase || "toCenter";
    if (state.phase === "toCenter") {
      const heal = m.location().heal;
      // the last Pokémon Center the game remembers: stand on its spot, then go inside through the door above it
      const healMap = W.map(heal.mapGroup, heal.mapNum);
      if (!healMap) return { ok: false, reason: "Couldn't read the map of your last Pokémon Center." };
      const door = healMap.warps.find(w => Math.abs(w.x - heal.x) <= 1 && (w.y === heal.y - 1 || w.y === heal.y));
      const inside = door ? { g: door.mapGroup, n: door.mapNum } : { g: heal.mapGroup, n: heal.mapNum };
      ctl.status("HP is low, walking to the Pokémon Center…");
      const r = await walkTo(m, ctl, (c) => c.g === inside.g && c.n === inside.n, "to the Pokémon Center");
      if (!r.ok) return r;
      state.phase = "healing";
    }
    if (state.phase === "healing") {
      ctl.status("Healing at the Pokémon Center…");
      const r = await talkToNurse(m, ctl);
      if (!r.ok) return r;
      state.phase = "return";
    }
    if (state.phase === "return") {
      ctl.status("Healed! Walking back to the training spot…");
      const r = await walkTo(m, ctl, (c) => c.g === home.mapGroup && c.n === home.mapNum && Math.abs(c.x - home.x) <= 1 && Math.abs(c.y - home.y) <= 1, "back to the training spot");
      if (!r.ok) return r;
      state.phase = null;
      return { ok: true, done: true };
    }
    return { ok: true, done: true };
  }

  window.PocketNav = { healAndReturn, plan, world, _walkTo: walkTo };
})();
