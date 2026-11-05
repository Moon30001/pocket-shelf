// Pocket Shelf — live game memory for FireRed / LeafGreen / Emerald (and hacks built on them).
// The emulator has no memory API, so: take a save state (which contains the GBA's RAM), find that RAM inside the
// emulator's own memory, then read/write it directly. Addresses come from pret's pokefirered / pokeemerald symbol files.
(function () {
  const EWRAM = 0x02000000, IWRAM = 0x03000000, ROM = 0x08000000;
  const STATE_IWRAM = 0x19000, STATE_EWRAM = 0x21000;              // mGBA serialized-state layout (version 7)

  // RAM symbols are identical across FireRed/LeafGreen 1.0/1.1. ROM symbols differ per revision.
  const PROFILES = {
    FRLG: {
      ram: { sb1Ptr: 0x03005008, sb2Ptr: 0x0300500C, party: 0x02024284, partyCount: 0x02024029, enemyParty: 0x0202402C, main: 0x030030F0,
        objectEvents: 0x02036E38, playerAvatar: 0x02037078, battleTypeFlags: 0x02022B4C, battleMons: 0x02023BE4, battleOutcome: 0x02023E8A, camera: 0x02036E18,
        actionCursor: 0x02023FF8, moveCursor: 0x02023FFC, moveToLearn: 0x02024022, partyIndexes: 0x02023BCE, partyMenu: 0x0203B0A0 },
      rom: {
        "BPRE-0": { overworld: 0x080565B4, battle: 0x08011100, mapGroups: 0x083526A8, battleMoves: 0x08250C04, typeEff: 0x0824F050, evoScene: 0x080CE710 },
        "BPRE-1": { overworld: 0x080565C8, battle: 0x08011114, mapGroups: 0x08352718, battleMoves: 0x08250C74, typeEff: 0x0824F0C0, evoScene: 0x080CE724 },
        "BPGE-0": { overworld: 0x080565B4, battle: 0x08011100, mapGroups: 0x08352688, battleMoves: 0x08250BE0, typeEff: 0x0824F02C, evoScene: 0x080CE6E4 },
        "BPGE-1": { overworld: 0x080565C8, battle: 0x08011114, mapGroups: 0x083526F8, battleMoves: 0x08250C50, typeEff: 0x0824F09C, evoScene: 0x080CE6F8 },
      },
    },
    E: {
      ram: { sb1Ptr: 0x03005D8C, sb2Ptr: 0x03005D90, party: 0x020244EC, partyCount: 0x020244E9, enemyParty: 0x02024744, main: 0x030022C0,
        objectEvents: 0x02037350, playerAvatar: 0x02037590, battleTypeFlags: 0x02022FEC, battleMons: 0x02024084, battleOutcome: 0x0202433A, camera: 0x02037334,
        actionCursor: 0x020244AC, moveCursor: 0x020244B0, moveToLearn: 0x020244E2, partyIndexes: 0x0202406E, partyMenu: 0x0203CEC8 },
      rom: { "BPEE-0": { overworld: 0x08085E5C, battle: 0x08038420, mapGroups: 0x08486578, battleMoves: 0x0831C898, typeEff: 0x0831ACE8, evoScene: 0x0813E3A4 } },
    },
  };

  function profileFor(rom) {
    const code = String.fromCharCode(rom[0xAC], rom[0xAD], rom[0xAE], rom[0xAF]);
    const rev = rom[0xBC];
    const fam = /^BP[RG]/.test(code) ? "FRLG" : code === "BPEE" ? "E" : null;
    if (!fam) return null;
    const known = PROFILES[fam].rom[`${code}-${rev}`];
    return { family: fam, code, rev, ram: PROFILES[fam].ram, rom: known || null, hack: !known };
  }

  // ---- finding the GBA's RAM inside the emulator ----
  function coreState(gm) {
    const info = gm.functions.saveStateInfo().split("|");          // "size|heapOffset|ok"
    const stateStart = parseInt(info[1]), stateSize = parseInt(info[0]);
    const st = gm.getState();
    const head = String.fromCharCode(...st.subarray(0, 7));
    if (head !== "RASTATE") return { mem: st, stateStart, stateSize };
    let o = 8;
    while (o + 8 <= st.length) {
      const id = String.fromCharCode(...st.subarray(o, o + 4));
      const len = st[o + 4] | (st[o + 5] << 8) | (st[o + 6] << 16) | (st[o + 7] << 24);
      if (id === "MEM ") return { mem: st.subarray(o + 8, o + 8 + len), stateStart, stateSize };
      o = (o + 8 + len + 7) & ~7;
    }
    throw new Error("Unexpected save-state format");
  }

  // Most distinctive 16-byte stretches of a memory region (rich RAM in real games; sparse in tiny test programs)
  function findWindows(region, count = 4) {
    const scored = [];
    for (let off = 0; off + 16 <= region.length; off += 16) {
      const d = new Set(region.subarray(off, off + 16)).size;
      if (d >= 4) scored.push([d, off]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, count).map(x => x[1]);
  }

  function locate(gm) {
    const M = gm.Module;
    gm.toggleMainLoop(0);                                        // freeze so the heap and the state agree exactly
    try {
      const { mem, stateStart, stateSize } = coreState(gm);
      const insideStateBuffer = (b) => b + 0x48000 > stateStart && b < stateStart + stateSize;
      const ew = mem.subarray(STATE_EWRAM, STATE_EWRAM + 0x40000), iw = mem.subarray(STATE_IWRAM, STATE_IWRAM + 0x8000);
      const H = M.HEAPU8;
      const tryRegion = (region, regionOffsetInBlock) => {
        for (const off of findWindows(region)) {
          const pat = region.subarray(off, off + 16);
          for (let i = 0; i < H.length - 16; i++) {
            if (H[i] !== pat[0] || H[i + 1] !== pat[1] || H[i + 2] !== pat[2] || H[i + 3] !== pat[3]) continue;
            let ok = true; for (let k = 4; k < 16; k++) if (H[i + k] !== pat[k]) { ok = false; break; }
            if (!ok) continue;
            const base = i - off - regionOffsetInBlock;              // base = where EWRAM starts (IWRAM follows at +0x40000)
            if (base < 0) continue;
            // the live copy matches the whole frozen state; stale copies (old states, rewind buffers) don't
            let diff = 0;
            for (let k = 0; k < 0x40000 && diff < 8; k += 1) if (H[base + k] !== ew[k]) diff++;
            for (let k = 0; k < 0x8000 && diff < 8; k += 1) if (H[base + 0x40000 + k] !== iw[k]) diff++;
            if (diff === 0 && !insideStateBuffer(base)) return base;
          }
        }
        return -1;
      };
      let base = tryRegion(iw, 0x40000);
      if (base < 0) base = tryRegion(ew, 0);
      return base;
    } finally { gm.toggleMainLoop(1); }
  }

  // ---- reader ----
  function makeReader(gm, base) {
    const H = () => gm.Module.HEAPU8;
    const at = (addr) => {
      if (addr >= IWRAM && addr < IWRAM + 0x8000) return base + 0x40000 + (addr - IWRAM);
      if (addr >= EWRAM && addr < EWRAM + 0x40000) return base + (addr - EWRAM);
      return -1;
    };
    const r = {
      ok: true,
      u8: (a) => { const p = at(a); return p < 0 ? 0 : H()[p]; },
      u16: (a) => { const p = at(a); if (p < 0) return 0; const h = H(); return h[p] | (h[p + 1] << 8); },
      u32: (a) => { const p = at(a); if (p < 0) return 0; const h = H(); return (h[p] | (h[p + 1] << 8) | (h[p + 2] << 16) | (h[p + 3] << 24)) >>> 0; },
      s16: (a) => { const v = r.u16(a); return v & 0x8000 ? v - 0x10000 : v; },
      s8: (a) => { const v = r.u8(a); return v & 0x80 ? v - 0x100 : v; },
      bytes: (a, n) => { const p = at(a); return p < 0 ? new Uint8Array(n) : H().slice(p, p + n); },
      w8: (a, v) => { const p = at(a); if (p >= 0) H()[p] = v & 255; },
      w16: (a, v) => { const p = at(a); if (p >= 0) { const h = H(); h[p] = v & 255; h[p + 1] = (v >> 8) & 255; } },
    };
    return r;
  }

  // ---- Gen 3 Pokémon in RAM (100-byte party structs) ----
  function decodePartyMon(raw) {
    const g3 = globalThis.PkSave && PkSave.codecs.find(c => c.id === "gen3");
    if (!g3 || !g3._internal) return null;
    const I = g3._internal;
    const box = I.decrypt3(raw.slice(0, 80));
    if (!box) return null;
    const mon = I.toNeutral(box);
    if (!mon || !mon.species) return null;
    const u16 = (o) => raw[o] | (raw[o + 1] << 8);
    mon.status = raw[0x50] | (raw[0x51] << 8) | (raw[0x52] << 16) | (raw[0x53] << 24);
    mon.level = raw[0x54]; mon.hp = u16(0x56); mon.maxHp = u16(0x58);
    return mon;
  }

  // Hacks that moved memory: look for six consecutive valid Pokémon structs
  function scanForParty(rd) {
    for (let a = EWRAM; a < EWRAM + 0x40000 - 600; a += 4) {
      const lv = rd.u8(a + 0x54), hp = rd.u16(a + 0x56), mx = rd.u16(a + 0x58);
      if (!lv || lv > 100 || !mx || hp > mx || mx > 999) continue;
      const m = decodePartyMon(rd.bytes(a, 100));
      if (m && m.level === lv) {
        return { party: a, partyCount: rd.u8(a - 3) <= 6 ? a - 3 : null };
      }
    }
    return null;
  }

  // The map table's address, found the way the game finds it: Overworld_GetMapHeaderByGroupAndId keeps a pointer to
  // gMapGroups at its end. Hacks that add maps usually move the table but keep this function, so this follows them.
  const MAP_HEADER_FN = { FRLG: [0x08055238, 0x0805524C], E: [0x08084A90] };
  function findMapGroups(rom, prof) {
    const u32 = (a) => { const o = a - ROM; return (rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16) | (rom[o + 3] << 24)) >>> 0; };
    const plausible = (t) => t >= ROM && t < ROM + rom.length && [0, 1, 2].every(i => { const g = u32(t + i * 4); return g >= ROM && g < ROM + rom.length && u32(g) >= ROM && u32(g) < ROM + rom.length; });
    for (const fn of MAP_HEADER_FN[prof.family]) {
      const t = u32(fn + 0x14);
      if (plausible(t)) return t;
    }
    return prof.rom && plausible(prof.rom.mapGroups) ? prof.rom.mapGroups : null;
  }

  // ---- the public object: attach once per game session ----
  async function attach(gm, romBytes) {
    const prof = profileFor(romBytes);
    if (!prof) return { supported: false, reason: "Live game info works with FireRed, LeafGreen, Emerald and hacks based on them." };
    const base = locate(gm);
    if (base < 0) return { supported: false, reason: "Couldn't find the game's memory. Try again once the game is past the title screen." };
    const rd = makeReader(gm, base);
    const ram = { ...prof.ram };
    const romU32 = (a) => { const o = a - ROM; return (romBytes[o] | (romBytes[o + 1] << 8) | (romBytes[o + 2] << 16) | (romBytes[o + 3] << 24)) >>> 0; };
    let learnedOverworld = prof.rom ? (prof.rom.overworld | 1) : null;

    const g = {
      supported: true, profile: prof, reader: rd, ram, romU32,
      rom: romBytes,
      mapGroupsAddr: findMapGroups(romBytes, prof),
      partyCount: () => Math.min(6, rd.u8(ram.partyCount)),
      party() {
        const n = g.partyCount(), out = [];
        for (let i = 0; i < n; i++) out.push(decodePartyMon(rd.bytes(ram.party + i * 100, 100)));
        return out;
      },
      callback2: () => rd.u32(ram.main + 4),
      learnOverworld() { learnedOverworld = g.callback2(); },
      inOverworld: () => learnedOverworld != null && g.callback2() === learnedOverworld,
      inBattle: () => (prof.rom ? g.callback2() === (prof.rom.battle | 1) : (!g.inOverworld() && rd.u32(ram.battleTypeFlags) !== 0 && g.battleMon(1).maxHp > 0)),
      isTrainerBattle: () => (rd.u32(ram.battleTypeFlags) & 0x08) !== 0,
      battleMon(i) {
        const a = ram.battleMons + i * 0x58;
        const g3 = PkSave.codecs.find(c => c.id === "gen3")._internal;
        return { species: g3.toNational(rd.u16(a)), moves: [0, 1, 2, 3].map(k => rd.u16(a + 0x0C + k * 2)), pp: [0, 1, 2, 3].map(k => rd.u8(a + 0x24 + k)),
          types: [rd.u8(a + 0x21), rd.u8(a + 0x22)], hp: rd.u16(a + 0x28), level: rd.u8(a + 0x2A), maxHp: rd.u16(a + 0x2C) };
      },
      playerObject() {
        const id = rd.u8(ram.playerAvatar + 5);
        const a = ram.objectEvents + id * 0x24;
        return { x: rd.s16(a + 0x10) - 7, y: rd.s16(a + 0x12) - 7, facing: rd.u8(a + 0x18) & 0x0F, moving: rd.u8(ram.playerAvatar + 3) !== 0,
          behavior: rd.u8(a + 0x1E), elevation: rd.u8(a + 0x0B) & 0x0F };
      },
      location() {
        const sb1 = rd.u32(ram.sb1Ptr);
        const p = g.playerObject();
        return { mapGroup: rd.s8(sb1 + 4), mapNum: rd.s8(sb1 + 5), x: p.x, y: p.y, facing: p.facing, moving: p.moving, behavior: p.behavior, elevation: p.elevation,
          heal: { mapGroup: rd.s8(sb1 + 0x1C), mapNum: rd.s8(sb1 + 0x1D), warpId: rd.s8(sb1 + 0x1E), x: rd.s16(sb1 + 0x20), y: rd.s16(sb1 + 0x22) } };
      },
      snapshot() {
        const party = g.party();
        return { game: prof.code + (prof.hack ? " (hack)" : ` v1.${prof.rev}`), state: g.inBattle() ? "battle" : g.inOverworld() ? "overworld" : "menu / text",
          location: g.location(), party: party.map(m => m && { species: m.species, name: m.isNicknamed ? m.nickname : (PkData.species[m.species] || {}).name, level: m.level, hp: m.hp, maxHp: m.maxHp }),
          enemy: g.inBattle() ? g.battleMon(1) : null };
      },
    };
    // Move power/type and the type chart come straight from the ROM (vanilla layouts only)
    const romByte = (a) => romBytes[a - ROM];
    g.moveData = (move) => {
      if (!prof.rom || !move) return null;
      const a = prof.rom.battleMoves + move * 12;
      return { effect: romByte(a), power: romByte(a + 1), type: romByte(a + 2), accuracy: romByte(a + 3) };
    };
    let typeChart = null;
    g.effectiveness = (atkType, defTypes) => {
      if (!prof.rom) return 1;
      if (!typeChart) {
        typeChart = [];
        for (let a = prof.rom.typeEff; romByte(a) !== 0xFF && a < prof.rom.typeEff + 1200; a += 3) {
          if (romByte(a) === 0xFE) continue;                           // Foresight separator
          typeChart.push([romByte(a), romByte(a + 1), romByte(a + 2) / 10]);
        }
      }
      let mul = 1;
      for (const d of new Set(defTypes)) for (const [at, df, m] of typeChart) if (at === atkType && df === d) mul *= m;
      return mul;
    };
    g.bestMoveIndex = () => {
      const me = g.battleMon(0), foe = g.battleMon(1);
      let best = -1, bestScore = -1;
      me.moves.forEach((mv, i) => {
        if (!mv || !me.pp[i]) return;
        const d = g.moveData(mv);
        let score = d ? d.power * (me.types.includes(d.type) ? 1.5 : 1) * g.effectiveness(d.type, foe.types) * Math.max(0.5, (d.accuracy || 100) / 100) : (i === 0 ? 1 : 0);
        if (d && d.power === 0) score = 0.01;                               // status moves only as a last resort
        if (score > bestScore) { bestScore = score; best = i; }
      });
      return Math.max(0, best);
    };
    g.activePartyIndex = () => rd.u8(ram.partyIndexes);
    g.isLearningMove = () => rd.u16(ram.moveToLearn) !== 0;
    g.inEvolution = () => !!prof.rom && g.callback2() === (prof.rom.evoScene | 1);
    // Only poke memory when we're sure of the layout (known game revision, party where we expect it).
    // Otherwise these return false and the caller presses buttons instead.
    g.canWrite = () => !g.relocated && !!prof.rom;
    g.setActionCursor = (i) => g.canWrite() ? (rd.w8(ram.actionCursor, i), true) : false;
    g.setMoveCursor = (i) => g.canWrite() ? (rd.w8(ram.moveCursor, i), true) : false;
    g.setPartyMenuSlot = (i) => g.canWrite() ? (rd.w8(ram.partyMenu + 9, i), true) : false;

    // sanity check (and the fallback for hacks whose party moved)
    const p0 = decodePartyMon(rd.bytes(ram.party, 100));
    if (!p0 || !g.partyCount()) {
      const found = scanForParty(rd);
      if (found) { ram.party = found.party; if (found.partyCount) ram.partyCount = found.partyCount; g.relocated = true; }
      else g.partyWarning = "Couldn't read the party yet (start or load the game first).";
    }
    return g;
  }

  window.PocketMem = { attach, profileFor, _locate: locate, _coreState: coreState };
})();
