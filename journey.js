// Pocket Shelf — Journey: a chain of games played as one adventure. Beat the Champion in one region to unlock the next.
// You start each new game fresh (new starter, new map) and bring 1–2 Pokémon along from the region before.
// Stored on this phone. Both players set up the same chain so Hero vs Rival can tell they're in the same region.
(function () {
  const KEY = "ps_journey";
  // Gen 3 "game clear" flag (set when you enter the Hall of Fame) and where the flags sit in SaveBlock1
  const CLEAR = { FRLG: { flags: 0x0EE0, flag: 0x82C }, E: { flags: 0x1270, flag: 0x864 } };

  function load() { try { const j = JSON.parse(localStorage.getItem(KEY) || "null"); return j && Array.isArray(j.regions) ? j : null; } catch (e) { return null; } }
  function save(j) { try { localStorage.setItem(KEY, JSON.stringify(j)); } catch (e) {} }

  const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  function familyOf(game) {
    const c = String(game.code || "");
    if (game.system !== "gba") return null;
    if (/^BP[RG]/.test(c)) return "FRLG";
    if (/^BPE/.test(c)) return "E";
    return null;
  }
  // Read SaveBlock1 bytes [start, start+len) from a 128 KB Gen 3 save (newest of the two save slots)
  function readBlock1(u8, start, len) {
    let best = null;
    for (const slot of [0, 1]) {
      const sectors = {};
      let counter = -1;
      for (let s = 0; s < 14; s++) {
        const o = slot * 0xE000 + s * 0x1000;
        if (o + 0x1000 > u8.length || u32(u8, o + 0xFF8) !== 0x08012025) continue;
        sectors[u16(u8, o + 0xFF4)] = o; counter = u32(u8, o + 0xFFC);
      }
      if (Object.keys(sectors).length === 14 && (!best || counter > best.counter)) best = { sectors, counter };
    }
    if (!best) return null;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const off = start + i, sec = 1 + Math.floor(off / 0xF80), o = best.sectors[sec];
      if (o === undefined) return null;
      out[i] = u8[o + (off % 0xF80)];
    }
    return out;
  }
  // Has this save beaten the Champion? → { known: bool, cleared: bool, why }
  function checkCleared(game, saveBytes) {
    const fam = familyOf(game);
    if (!fam) return { known: false, cleared: false, why: "Pocket Shelf can't read a Champion win from this game yet." };
    if (!saveBytes || saveBytes.length < 0x1C000) return { known: true, cleared: false, why: "No save yet." };
    const c = CLEAR[fam], byte = readBlock1(saveBytes, c.flags + (c.flag >> 3), 1);
    const flag = byte ? (byte[0] >> (c.flag & 7)) & 1 : 0;
    // Hall of Fame record (its own sector at 0x1C000): the first team is written when you become Champion
    let hof = false;
    if (saveBytes.length >= 0x1D000 && u32(saveBytes, 0x1C000 + 0xFF8) === 0x08012025) { for (let i = 0; i < 0x14 * 6; i += 0x14) { const sp = u16(saveBytes, 0x1C000 + i + 8); if (sp && sp !== 0xFFFF) hof = true; } }
    return { known: true, cleared: !!(flag || hof) };
  }

  window.PocketJourney = {
    load, save, checkCleared, familyOf,
    regionOf(gameId) { const j = load(); if (!j) return -1; return j.regions.indexOf(gameId); },
    // what Hero vs Rival compares: which region you're in right now
    status(gameId) { const j = load(); if (!j) return null; const i = j.regions.indexOf(gameId); return i < 0 ? null : { region: i, current: j.current, total: j.regions.length }; },
  };
})();
