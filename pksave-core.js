// Pocket Shelf save engine — shared registry + helpers. Codecs (pksave-gen12.js, pksave-gen3.js, pksave-gen45.js) register here.
// Works in the browser (globalThis) and in Node (tests).
(function () {
  const PkSave = globalThis.PkSave || (globalThis.PkSave = { codecs: [] });
  PkSave.register = (codec) => { PkSave.codecs.push(codec); };

  // Open a save: hint = { system: 'gb'|'gba'|'nds', code: ROM header code/title } (optional but helps)
  const tryOpen = (u8, hint) => {
    for (const c of PkSave.codecs) {
      let d = null;
      try { d = c.detect(u8, hint); } catch (e) { d = null; }
      if (d) return c.open(u8, hint, d);
    }
    return null;
  };
  PkSave.open = (bytes, hint = {}) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const direct = tryOpen(u8, hint);
    if (direct) return direct;
    // Emulators sometimes append extra data (mGBA real-time-clock bytes, DeSmuME's .dsv footer).
    // Read the save without it, then put it back unchanged when writing.
    for (const size of [0x8000, 0x10000, 0x20000, 0x80000]) {
      if (u8.length <= size || u8.length - size > 0x400) continue;
      const save = tryOpen(u8.slice(0, size), hint);
      if (!save) continue;
      const tail = u8.slice(size);
      const inner = save.toBytes.bind(save);
      save.toBytes = () => { const body = inner(), out = new Uint8Array(body.length + tail.length); out.set(body); out.set(tail, body.length); return out; };
      return save;
    }
    throw new Error("This save isn't a supported Pokémon Gen 1–5 save (or it's a Japanese/Korean version).");
  };

  // ---- shared helpers ----
  const H = PkSave.util = {};
  H.levelFromExp = (species, exp) => {
    const sp = globalThis.PkData.species[species]; if (!sp) return 1;
    const t = globalThis.PkData.expTable[sp.growth];
    let lv = 1; while (lv < 100 && exp >= t[lv]) lv++;
    return lv;
  };
  H.expForLevel = (species, level) => globalThis.PkData.expTable[globalThis.PkData.species[species].growth][Math.max(1, Math.min(100, level)) - 1];
  // Gen 4+ national item id <-> gen 2 / gen 3 ids (PKHeX ItemConverter tables). 0 = no item.
  H.itemFrom2 = (i) => { const v = globalThis.PkData.item2to4[i] || 0; return v === 128 ? 0 : v; };
  H.itemFrom3 = (i) => { const v = globalThis.PkData.item3to4[i] || 0; return v === 128 ? 0 : v; };
  H.itemTo2 = (n) => { if (!n) return 0; const i = globalThis.PkData.item2to4.indexOf(n); return i < 0 ? 0 : i; };
  H.itemTo3 = (n) => { if (!n) return 0; const i = globalThis.PkData.item3to4.indexOf(n); return i < 0 ? 0 : i; };
  H.basePP = (gen, move) => (globalThis.PkData.pp[gen] || [])[move] || 0;
  H.ppWithUps = (gen, move, ups) => { const b = H.basePP(gen, move); return b + Math.floor(b * (ups || 0) / 5); };
  H.u16 = (b, o) => b[o] | (b[o + 1] << 8);
  H.u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  H.w16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; };
  H.w32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
  H.u16be = (b, o) => (b[o] << 8) | b[o + 1];
  H.w16be = (b, o, v) => { b[o] = (v >>> 8) & 255; b[o + 1] = v & 255; };
  H.crc16ccitt = (b, start, len) => {          // CRC-16/CCITT-FALSE as used by Gen 4/5 saves
    let crc = 0xFFFF;
    for (let i = start; i < start + len; i++) {
      crc ^= b[i] << 8;
      for (let k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc;
  };
  // Gen 3+ shiny check
  H.isShiny = (pid, tid, sid, thresh = 8) => ((tid ^ sid ^ (pid >>> 16) ^ (pid & 0xFFFF)) < thresh);
  // Gen 3+ gender from PID and species ratio (0 male, 1 female, 2 genderless)
  H.genderFromPid = (species, pid) => {
    const r = globalThis.PkData.species[species].gender;
    if (r === 255) return 2; if (r === 254) return 1; if (r === 0) return 0;
    return (pid & 0xFF) < r ? 1 : 0;
  };
  if (typeof module !== "undefined") module.exports = PkSave;
})();
