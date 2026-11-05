// Pocket Shelf save engine — Gen 1 (Red/Blue/Yellow) + Gen 2 (Gold/Silver/Crystal) codecs, English/international saves.
// Logic ported from PKHeX (https://github.com/kwsch/PKHeX, GPL-3.0): SAV1/SAV2, SAV1Offsets/SAV2Offsets, PK1/PK2, GBPKM,
// PokeList1/PokeList2, SpeciesConverter (Gen 1 index table), StringConverter1/2 and SaveUtil detection. Thanks to kwsch & contributors.
(function () {
  const PkSave = globalThis.PkSave;
  const U = PkSave.util;
  const D = () => globalThis.PkData;

  // ---------------------------------------------------------------- constants
  const STR_LEN = 11;              // GBPKML.StringLengthNotJapan
  const MAX_OT = 7, MAX_NICK = 10;
  const SLOT_EMPTY = 0xFF, SLOT_EGG = 0xFD, TERM = 0x50, TRADE_OT = 0x5D;
  const SIZE = { pk1: { box: 0x21, party: 0x2C }, pk2: { box: 0x20, party: 0x30 } };
  const VER = { RD: 35, BU: 37, YW: 38, GD: 39, SI: 40, C: 41, RB: 58, GS: 60 }; // PKHeX GameVersion ids (RB/GS = group ids)

  // ---------------------------------------------------------------- Gen 1 species index <-> national (SpeciesConverter)
  const NAT_TO_INT1 = [0x00, 0x99, 0x09, 0x9A, 0xB0, 0xB2, 0xB4, 0xB1, 0xB3, 0x1C, 0x7B, 0x7C, 0x7D, 0x70, 0x71, 0x72, 0x24, 0x96, 0x97, 0xA5, 0xA6, 0x05, 0x23, 0x6C, 0x2D, 0x54, 0x55, 0x60, 0x61, 0x0F, 0xA8, 0x10, 0x03, 0xA7, 0x07, 0x04, 0x8E, 0x52, 0x53, 0x64, 0x65, 0x6B, 0x82, 0xB9, 0xBA, 0xBB, 0x6D, 0x2E, 0x41, 0x77, 0x3B, 0x76, 0x4D, 0x90, 0x2F, 0x80, 0x39, 0x75, 0x21, 0x14, 0x47, 0x6E, 0x6F, 0x94, 0x26, 0x95, 0x6A, 0x29, 0x7E, 0xBC, 0xBD, 0xBE, 0x18, 0x9B, 0xA9, 0x27, 0x31, 0xA3, 0xA4, 0x25, 0x08, 0xAD, 0x36, 0x40, 0x46, 0x74, 0x3A, 0x78, 0x0D, 0x88, 0x17, 0x8B, 0x19, 0x93, 0x0E, 0x22, 0x30, 0x81, 0x4E, 0x8A, 0x06, 0x8D, 0x0C, 0x0A, 0x11, 0x91, 0x2B, 0x2C, 0x0B, 0x37, 0x8F, 0x12, 0x01, 0x28, 0x1E, 0x02, 0x5C, 0x5D, 0x9D, 0x9E, 0x1B, 0x98, 0x2A, 0x1A, 0x48, 0x35, 0x33, 0x1D, 0x3C, 0x85, 0x16, 0x13, 0x4C, 0x66, 0x69, 0x68, 0x67, 0xAA, 0x62, 0x63, 0x5A, 0x5B, 0xAB, 0x84, 0x4A, 0x4B, 0x49, 0x58, 0x59, 0x42, 0x83, 0x15];
  const INT_TO_NAT1 = new Uint8Array(256);
  NAT_TO_INT1.forEach((v, nat) => { if (nat) INT_TO_NAT1[v] = nat; });
  const toInternal1 = (nat) => (nat > 0 && nat < NAT_TO_INT1.length ? NAT_TO_INT1[nat] : 0);
  const toNational1 = (raw) => INT_TO_NAT1[raw & 0xFF];

  // ---------------------------------------------------------------- charsets (StringConverter1/2 TableEN)
  const N = "\0";
  const mkTable = (hi) => { const t = new Array(256).fill(N); t[0x5D] = "*"; let i = 0x70; for (const c of hi) t[i++] = c; return t; };
  const TAIL_70_CF = [..."@#“”" + N + "…" + N + N + N + "┌─┐│└┘ ", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ():;[]", ..."abcdefghijklmnopqrstuvwxyzàèéùÀÁ", ..."ÄÖÜäöüÈÉÌÍÑÒÓÙÚá"];
  const TABLE1 = mkTable([...TAIL_70_CF,
    ..."ìíñòóúº", N, N, N, N, N, N, N, "←", "'",
    "’", "{", "}", "-", N, N, "?", "!", "․", "&", "%", "→", "▷", "▶", "▼", "♂",
    "¥", "×", ".", "/", ",", "♀", ..."0123456789"]);
  const TABLE2 = mkTable([...TAIL_70_CF,
    ..."０１２３４５６", N, N, N, N, N, N, N, N, "←",
    "’", "{", "}", "-", "+", N, "?", "!", "․", "&", "%", "→", "▷", "▶", "▼", "♂",
    "¥", "×", ".", "/", ",", "♀", ..."0123456789"]);
  TABLE2[0x4E] = "⏎";

  function decodeStr(table, bytes) {
    if (!bytes.length) return "";
    if (bytes[0] === TRADE_OT) return "*";
    let s = "";
    for (const b of bytes) { const c = table[b]; if (c === N) break; s += c; }
    return s;
  }
  function charCode(table, c) {
    let i = table.indexOf(c);
    if (i > 0 && i !== TRADE_OT) return i;
    const base = c.normalize("NFD")[0];                // strip accents the table lacks (e.g. "ç" -> "c")
    if (base !== c) { i = table.indexOf(base); if (i > 0 && i !== TRADE_OT) return i; }
    if (c === "'" || c === "‘") return table.indexOf("’");
    if (c === "․" || c === "．") return table.indexOf(".");
    return table.indexOf("?");                         // unencodable -> '?'
  }
  // SetString with Clear50: fill buffer with terminators, write up to maxLen chars, terminate.
  function encodeStr(table, str, maxLen, len = STR_LEN) {
    const out = new Uint8Array(len).fill(TERM);
    str = String(str || "");
    if (str[0] === "*") { out[0] = TRADE_OT; return out; }
    const chars = [...str].slice(0, maxLen);
    chars.forEach((c, i) => { out[i] = charCode(table, c); });
    return out;
  }
  // SpeciesName.GetSpeciesNameGeneration(species, English, 1|2)
  function defaultName(species) {
    if (species === 0) return "EGG";
    const sp = D().species[species]; if (!sp) return "";
    let n = sp.name.toUpperCase();
    if (species === 122) n = n.replace(". ", "․").replace(" ", "");  // MR․MIME
    return n;
  }
  function defaultNameBytes(table, species) {
    const b = encodeStr(table, defaultName(species), MAX_NICK);
    for (let i = 0; i < b.length; i++) if (b[i] === 0xF2) b[i] = 0xE8; // decimal point <-> period fix
    return b;
  }

  // ---------------------------------------------------------------- GB stat / DV helpers (GBPKM)
  const dvsFrom16 = (dv) => ({ atk: (dv >> 12) & 15, def: (dv >> 8) & 15, spe: (dv >> 4) & 15, spc: dv & 15 });
  const dvsTo16 = (d) => (((d.atk & 15) << 12) | ((d.def & 15) << 8) | ((d.spe & 15) << 4) | (d.spc & 15));
  const hpDV = (d) => ((d.atk & 1) << 3) | ((d.def & 1) << 2) | ((d.spe & 1) << 1) | (d.spc & 1);
  const isShinyGB = (dv16) => (dv16 & 0x2FFF) === 0x2AAA;
  function genderGB(species, d) {
    const sp = D().species[species]; const gv = sp ? sp.gender : 255;
    if (gv === 255) return 2; if (gv === 254) return 1; if (gv === 0) return 0;
    return d.atk > (gv >> 4) ? 0 : 1;
  }
  function gbStat(base, iv, statExp, level) {
    const sq = Math.min(255, Math.ceil(Math.sqrt(statExp)));
    return Math.floor(((2 * (base + iv)) + (sq >> 2)) * level / 100) + 5;
  }
  const gbPP = (gen, move, ups) => { const pp = U.basePP(gen, move); return pp + (ups * Math.min(7, Math.floor(pp / 5))); };

  // ---------------------------------------------------------------- list storage (PokeList1/PokeList2)
  // entry = { marker, body: Uint8Array(box or party size), ot: Uint8Array(11), nick: Uint8Array(11) }
  const listLength = (cap, bodyLen) => 1 + (cap + 1) + bodyLen * cap + STR_LEN * cap * 2;
  function unpackList(u8, ofs, cap, bodyLen) {
    const count = Math.min(cap, u8[ofs]);
    const ofsBody = ofs + 1 + cap + 1, ofsOT = ofsBody + cap * bodyLen, ofsNick = ofsOT + cap * STR_LEN;
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        marker: u8[ofs + 1 + i],
        body: u8.slice(ofsBody + i * bodyLen, ofsBody + (i + 1) * bodyLen),
        ot: u8.slice(ofsOT + i * STR_LEN, ofsOT + (i + 1) * STR_LEN),
        nick: u8.slice(ofsNick + i * STR_LEN, ofsNick + (i + 1) * STR_LEN),
      });
    }
    return out;
  }
  const isPresentMarker = (m) => m !== 0 && m !== SLOT_EMPTY;
  // MergeSingles: present entries first, then empties; returns false (and writes nothing) when there is nothing to write.
  function mergeList(u8, ofs, cap, bodyLen, entries, destInitialized = true) {
    const len = listLength(cap, bodyLen);
    const present = entries.filter((e) => isPresentMarker(e.marker));
    if (present.length === 0) {
      let anyNonZero = false;
      for (let i = ofs; i < ofs + len; i++) if (u8[i]) { anyNonZero = true; break; }
      if (!destInitialized || !anyNonZero) return false;
    }
    const ordered = present.concat(entries.filter((e) => !isPresentMarker(e.marker)));
    u8.fill(0, ofs, ofs + len);
    u8[ofs] = present.length;
    const ofsBody = ofs + 1 + cap + 1, ofsOT = ofsBody + cap * bodyLen, ofsNick = ofsOT + cap * STR_LEN;
    for (let i = 0; i < cap; i++) {
      const e = ordered[i];
      u8[ofs + 1 + i] = e ? (e.marker || SLOT_EMPTY) : SLOT_EMPTY;
      if (!e) continue;
      u8.set(e.body.subarray(0, bodyLen), ofsBody + i * bodyLen);
      u8.set(e.ot, ofsOT + i * STR_LEN);
      u8.set(e.nick, ofsNick + i * STR_LEN);
    }
    u8[ofs + 1 + cap] = SLOT_EMPTY; // cap off the list
    return true;
  }
  const listValid = (u8, ofs, max) => { const c = u8[ofs]; return c <= max && u8[ofs + 1 + c] === 0xFF; }; // SaveUtil.IsListValidG12

  // ---------------------------------------------------------------- shared Save implementation
  function makeSave(cfg) {
    // cfg: { gen, game, version, u8, table, fmt, boxCount, party, boxes, trainer, finalize(u8) , onDex(species) }
    const { gen, fmt, table } = cfg;
    const party = cfg.party, boxes = cfg.boxes;

    function toNeutral(e, isPartyEntry) {
      const b = e.body;
      const g1 = gen === 1;
      const species = g1 ? toNational1(b[0]) : b[0];
      const o = g1 ? { mv: 8, tid: 0xC, exp: 0xE, se: 0x11, dv: 0x1B, pp: 0x1D } : { mv: 2, tid: 6, exp: 8, se: 0xB, dv: 0x15, pp: 0x17 };
      const dv16 = U.u16be(b, o.dv), dvs = dvsFrom16(dv16);
      const statExp = [0, 1, 2, 3, 4].map((i) => U.u16be(b, o.se + i * 2));
      const exp = (b[o.exp] << 16) | (b[o.exp + 1] << 8) | b[o.exp + 2];
      const isEgg = !g1 && e.marker === SLOT_EGG;
      const nickname = decodeStr(table, e.nick);
      const hpd = hpDV(dvs);
      const ivs = [hpd, dvs.atk, dvs.def, dvs.spe, dvs.spc, dvs.spc].map((v) => v * 2 + 1);
      const evs = [0, 1, 2, 3, 4, 4].map((i) => Math.min(255, Math.ceil(Math.sqrt(statExp[i]))));
      const caught = g1 ? 0 : U.u16be(b, 0x1D);
      const rawData = b.slice(0, SIZE[fmt].box);
      if (g1 && isPartyEntry) rawData[3] = b[0x21];       // box level byte mirrors party level
      return {
        species, nickname,
        isNicknamed: isEgg ? false : nickname !== defaultName(species),
        otName: decodeStr(table, e.ot),
        otGender: g1 ? 0 : (caught >> 7) & 1,
        tid: U.u16be(b, o.tid), sid: 0,
        exp, level: U.levelFromExp(species, exp),
        ivs, evs,
        moves: [0, 1, 2, 3].map((i) => b[o.mv + i]),
        ppUps: [0, 1, 2, 3].map((i) => (b[o.pp + i] >> 6) & 3),
        heldItem: g1 ? 0 : U.itemFrom2(b[1]),
        pid: null, nature: null, abilityNum: null,
        gender: genderGB(species, dvs),
        shiny: isShinyGB(dv16),
        friendship: g1 ? null : b[0x1B],
        pokerus: g1 ? null : b[0x1C],
        metLevel: caught ? (caught >> 8) & 0x3F : null,
        metLocation: caught ? caught & 0x7F : null,
        ball: null,
        originVersion: caught ? VER.C : null,
        language: 2,
        isEgg,
        fatefulEncounter: null,
        gen12: { dvs, statExp },
        raw: { format: fmt, data: rawData, ot: e.ot.slice(), nick: e.nick.slice() },
      };
    }

    function fromNeutral(mon) {
      const g1 = gen === 1;
      const species = mon.species | 0;
      const maxSpecies = g1 ? 151 : 251, maxMove = g1 ? 165 : 251;
      if (species < 1 || species > maxSpecies) throw new Error(`Species #${species} doesn't exist in Gen ${gen}`);
      const b = new Uint8Array(SIZE[fmt].box);
      const maxExp = U.expForLevel(species, 100);
      const exp = Math.max(0, Math.min(maxExp, mon.exp | 0));
      const level = U.levelFromExp(species, exp);
      let dvs, statExp;
      if (mon.gen12 && mon.gen12.dvs && mon.gen12.statExp) { dvs = mon.gen12.dvs; statExp = mon.gen12.statExp.slice(0, 5); }
      else {
        const iv = (mon.ivs || [0, 0, 0, 0, 0, 0]).map((v) => Math.max(0, Math.min(15, Math.floor((v | 0) / 2))));
        dvs = { atk: iv[1], def: iv[2], spe: iv[3], spc: iv[4] };
        const ev = mon.evs || [0, 0, 0, 0, 0, 0];
        statExp = [0, 1, 2, 3, 4].map((i) => Math.min(65535, (ev[i] | 0) * (ev[i] | 0)));
      }
      const moves = [0, 1, 2, 3].map((i) => { const m = (mon.moves || [])[i] | 0; return m > maxMove ? 0 : m; });
      const ups = [0, 1, 2, 3].map((i) => ((mon.ppUps || [])[i] | 0) & 3);
      const o = g1 ? { mv: 8, tid: 0xC, exp: 0xE, se: 0x11, dv: 0x1B, pp: 0x1D } : { mv: 2, tid: 6, exp: 8, se: 0xB, dv: 0x15, pp: 0x17 };
      moves.forEach((m, i) => { b[o.mv + i] = m; b[o.pp + i] = m ? ((ups[i] << 6) | Math.min(63, gbPP(gen, m, ups[i]))) : 0; });
      U.w16be(b, o.tid, mon.tid & 0xFFFF);
      b[o.exp] = (exp >> 16) & 255; b[o.exp + 1] = (exp >> 8) & 255; b[o.exp + 2] = exp & 255;
      statExp.forEach((v, i) => U.w16be(b, o.se + i * 2, Math.max(0, Math.min(65535, v | 0))));
      U.w16be(b, o.dv, dvsTo16(dvs));
      const isEgg = !g1 && !!mon.isEgg;
      if (g1) {
        const p = D().species[species].g1;
        b[0] = toInternal1(species);
        U.w16be(b, 1, gbStat(p.hp, hpDV(dvs), statExp[0], level) + 5 + level); // current HP = max HP
        b[3] = level; b[4] = 0;                          // box level, status
        b[5] = p.type1; b[6] = p.type2; b[7] = p.catchRate;
      } else {
        b[0] = species;
        b[1] = U.itemTo2(mon.heldItem | 0);
        const sp = D().species[species];
        b[0x1B] = isEgg ? (sp.hatch || 0) : (mon.friendship == null ? sp.baseFriendship : Math.min(255, mon.friendship | 0));
        b[0x1C] = (mon.pokerus | 0) & 0xFF;
        if (cfg.game === "C") {                          // Crystal caught data: time 0, met level, OT gender, location
          const metLevel = Math.min(63, isEgg ? 1 : level);
          const loc = 0;
          U.w16be(b, 0x1D, (metLevel << 8) | (((mon.otGender | 0) & 1) << 7) | (loc & 0x7F));
        }
        b[0x1F] = level;
      }
      const nick = isEgg ? encodeStr(table, "EGG", MAX_NICK)
        : (mon.isNicknamed && mon.nickname ? encodeStr(table, mon.nickname, MAX_NICK) : defaultNameBytes(table, species));
      return { marker: isEgg ? SLOT_EGG : b[0], body: b, ot: encodeStr(table, mon.otName, MAX_OT), nick };
    }

    function fromRaw(mon) {
      const r = mon.raw;
      const b = new Uint8Array(SIZE[fmt].box);
      b.set(r.data.subarray(0, b.length));
      const ot = new Uint8Array(STR_LEN).fill(TERM); ot.set(r.ot.subarray(0, STR_LEN));
      const nick = new Uint8Array(STR_LEN).fill(TERM); nick.set(r.nick.subarray(0, STR_LEN));
      let marker;
      if (gen === 1) {
        const nat = toNational1(b[0]);
        if (!nat) throw new Error("Raw Gen 1 data has an invalid species");
        b[3] = U.levelFromExp(nat, (b[0xE] << 16) | (b[0xF] << 8) | b[0x10]); // SAV1.WriteSlotStored: Stat_LevelBox = CurrentLevel
        marker = b[0];
      } else {
        if (!b[0] || b[0] > 251) throw new Error("Raw Gen 2 data has an invalid species");
        marker = mon.isEgg ? SLOT_EGG : b[0];
      }
      return { marker, body: b, ot, nick };
    }

    const speciesOf = (e) => (gen === 1 ? toNational1(e.body[0]) : e.body[0]);

    return {
      gen, game: cfg.game, version: cfg.version, format: fmt,
      trainer: cfg.trainer,
      boxCount: cfg.boxCount, boxSlots: 20,
      list() {
        const out = [];
        party.forEach((e, i) => out.push({ where: "party", box: null, slot: i, mon: toNeutral(e, true) }));
        boxes.forEach((bx, bi) => bx.forEach((e, si) => out.push({ where: "box", box: bi, slot: si, mon: toNeutral(e, false) })));
        return out;
      },
      remove({ where, box, slot }) {
        if (where === "party") {
          if (slot < 0 || slot >= party.length) throw new Error("No Pokémon in that party slot");
          if (party.length <= 1) throw new Error("Can't remove the last Pokémon in the party");
          party.splice(slot, 1);
        } else {
          const bx = boxes[box];
          if (!bx || slot < 0 || slot >= bx.length) throw new Error("No Pokémon in that box slot");
          bx.splice(slot, 1); // GB boxes are lists: later entries shift up
        }
      },
      insert(mon) {
        const bi = boxes.findIndex((bx) => bx.length < 20);
        if (bi < 0) throw new Error("PC is full");
        const e = mon.raw && mon.raw.format === fmt && mon.raw.data ? fromRaw(mon) : fromNeutral(mon);
        boxes[bi].push(e);
        if (!(gen === 2 && e.marker === SLOT_EGG)) cfg.onDex(speciesOf(e));
        return { where: "box", box: bi, slot: boxes[bi].length - 1 };
      },
      toBytes() {
        const u8 = cfg.u8.slice();
        cfg.finalize(u8, party, boxes);
        return u8;
      },
    };
  }

  // ================================================================ Gen 1
  const G1 = { OT: 0x2598, DexCaught: 0x25A3, DexSeen: 0x25B6, TID: 0x2605, PikaFriendship: 0x271C, CurrentBoxIndex: 0x284C,
    Starter: 0x29C3, Party: 0x2F2C, CurrentBox: 0x30C0, Checksum: 0x3523 };
  const G1_BOX_LIST = listLength(20, SIZE.pk1.box);   // 0x462
  const g1BoxOfs = (i) => (i < 6 ? 0x4000 + i * G1_BOX_LIST : 0x6000 + (i - 6) * G1_BOX_LIST);
  const gbHint = (hint) => !hint || !hint.system || hint.system === "gb";
  const hintCode = (hint) => String((hint && hint.code) || "").toUpperCase();
  const isGen2Title = (c) => /^POKEMON_(GLD|SLV)|^PM_CRYSTAL/.test(c);
  const isGen1Title = (c) => /^POKEMON (RED|BLUE|YELLOW|GREEN)/.test(c);
  // emulators sometimes append RTC/footer bytes; the SRAM image is the first 32 KB (or 64 KB padded)
  const okLen1 = (n) => n >= 0x8000 && n < 0x8000 + 0x100;
  const okLen2 = (n) => (n >= 0x8000 && n < 0x8000 + 0x100) || (n >= 0x10000 && n < 0x10000 + 0x100);

  PkSave.register({
    id: "gen1", gens: [1],
    detect(u8, hint) {
      try {
        if (!gbHint(hint) || !okLen1(u8.length) || isGen2Title(hintCode(hint))) return null;
        if (listValid(u8, 0x2ED5, 30) && listValid(u8, 0x302D, 30)) return null;   // Japanese layout (PKHeX checks it first)
        if (listValid(u8, G1.Party, 20) && listValid(u8, G1.CurrentBox, 20)) return { game: "RBY", gen: 1 };
      } catch (e) { /* never throw */ }
      return null;
    },
    open(bytes, hint) {
      const u8 = bytes.slice();
      const code = hintCode(hint);
      let version;
      if (/YELLOW/.test(code)) version = VER.YW;
      else if (/BLUE/.test(code)) version = VER.BU;
      else if (/RED/.test(code)) version = VER.RD;
      else { const st = u8[G1.Starter]; version = (st ? st === 0x54 : u8[G1.PikaFriendship] !== 0) ? VER.YW : VER.RB; }

      const BOXES = 12, cap = 20;
      const current = u8[G1.CurrentBoxIndex] & 0x7F;
      const initialized = (u8[G1.CurrentBoxIndex] & 0x80) !== 0;
      const boxes = [];
      for (let i = 0; i < BOXES; i++) boxes.push(initialized && i !== current ? unpackList(u8, g1BoxOfs(i), cap, SIZE.pk1.box) : []);
      if (current < BOXES) boxes[current] = unpackList(u8, G1.CurrentBox, cap, SIZE.pk1.box);
      const party = unpackList(u8, G1.Party, 6, SIZE.pk1.party);

      const setDex = (sp) => {
        if (!sp || sp > 151) return;
        const bit = sp - 1;
        u8[G1.DexCaught + (bit >> 3)] |= 1 << (bit & 7);
        u8[G1.DexSeen + (bit >> 3)] |= 1 << (bit & 7);
      };

      function finalize(out, party, boxes) {
        let boxInit = (out[G1.CurrentBoxIndex] & 0x80) !== 0;
        let cur = out[G1.CurrentBoxIndex] & 0x7F;
        if (!boxInit) {
          const content = boxes.some((bx, i) => i !== cur && bx.some((e) => isPresentMarker(e.marker)));
          if (content) { boxInit = true; out[G1.CurrentBoxIndex] |= 0x80; }
          else { cur = 0; out[G1.CurrentBoxIndex] &= 0x80; }   // CurrentBox = 0
        }
        for (let i = 0; i < BOXES; i++) {
          const ofs = g1BoxOfs(i);
          const written = mergeList(out, ofs, cap, SIZE.pk1.box, boxes[i], boxInit);
          if (i !== cur) continue;
          if (written) out.copyWithin(G1.CurrentBox, ofs, ofs + G1_BOX_LIST);   // mirror current box
          else mergeList(out, G1.CurrentBox, cap, SIZE.pk1.box, boxes[i], boxInit);
        }
        mergeList(out, G1.Party, 6, SIZE.pk1.party, party, true);
        if (boxInit) {                                       // box-bank checksums (whole bank + one per box), as the game keeps them
          for (const bank of [0x4000, 0x6000]) {
            const all = 6 * G1_BOX_LIST;
            let s = 0; for (let i = 0; i < all; i++) s += out[bank + i];
            out[bank + all] = ~s & 0xFF;
            for (let b = 0; b < 6; b++) {
              let t = 0; for (let i = 0; i < G1_BOX_LIST; i++) t += out[bank + b * G1_BOX_LIST + i];
              out[bank + all + 1 + b] = ~t & 0xFF;
            }
          }
        }
        let sum = 0; for (let i = G1.OT; i < G1.Checksum; i++) sum += out[i];
        out[G1.Checksum] = ~sum & 0xFF;                      // main checksum
      }

      return makeSave({
        gen: 1, game: "RBY", version, u8, table: TABLE1, fmt: "pk1", boxCount: BOXES, party, boxes,
        trainer: { name: decodeStr(TABLE1, u8.subarray(G1.OT, G1.OT + MAX_OT)), tid: U.u16be(u8, G1.TID), sid: 0, gender: 0 },
        onDex: setDex, finalize,
      });
    },
  });

  // ================================================================ Gen 2
  const G2_OFS = {
    GS: { Party: 0x288A, DexCaught: 0x2A4C, DexSeen: 0x2A6C, CurrentBoxIndex: 0x2724, CurrentBox: 0x2D6C, Gender: -1,
      ChecksumEnd: 0x2D68, Checksum1: 0x2D69, Checksum2: 0x7E6D },
    C: { Party: 0x2865, DexCaught: 0x2A27, DexSeen: 0x2A47, CurrentBoxIndex: 0x2700, CurrentBox: 0x2D10, Gender: 0x3E3D,
      ChecksumEnd: 0x2B82, Checksum1: 0x2D0D, Checksum2: 0x1F0D },
  };
  const TRAINER1 = 0x2009;
  const G2_BOX_LIST = listLength(20, SIZE.pk2.box);    // 0x44E (+2 padding per box in SRAM)
  const g2BoxOfs = (i) => (i < 7 ? 0x4000 + i * (G2_BOX_LIST + 2) : 0x6000 + (i - 7) * (G2_BOX_LIST + 2));

  PkSave.register({
    id: "gen2", gens: [2],
    detect(u8, hint) {
      try {
        if (!gbHint(hint) || !okLen2(u8.length) || isGen1Title(hintCode(hint))) return null;
        if (listValid(u8, 0x288A, 20) && listValid(u8, 0x2D6C, 20)) return { game: "GS", gen: 2 };
        if (listValid(u8, 0x2865, 20) && listValid(u8, 0x2D10, 20)) return { game: "C", gen: 2 };
      } catch (e) { /* never throw */ }
      return null;   // Japanese / Korean layouts are not supported
    },
    open(bytes, hint, detected) {
      const u8 = bytes.slice();
      const det = detected || this.detect(u8, hint);
      if (!det) throw new Error("Not a supported Gen 2 save");
      const game = det.game, O = G2_OFS[game];
      const code = hintCode(hint);
      const version = game === "C" ? VER.C : /SLV|SILVER/.test(code) ? VER.SI : /GLD|GOLD/.test(code) ? VER.GD : VER.GS;

      const BOXES = 14, cap = 20;
      const boxes = [];   // bank copies are the truth (PKHeX SAV2); the current-box copy is re-synced on write
      for (let i = 0; i < BOXES; i++) boxes.push(unpackList(u8, g2BoxOfs(i), cap, SIZE.pk2.box));
      const party = unpackList(u8, O.Party, 6, SIZE.pk2.party);

      const setDex = (sp) => {
        if (!sp || sp > 251) return;
        const bit = sp - 1;
        u8[O.DexCaught + (bit >> 3)] |= 1 << (bit & 7);
        u8[O.DexSeen + (bit >> 3)] |= 1 << (bit & 7);
        if (sp === 201) {                                    // SAV2.SetUnownFormFlags
          for (let i = 1; i <= 26; i++) u8[O.DexSeen + 0x1F + i] = i;
          if (u8[O.DexSeen + 0x1F + 28] === 0) u8[O.DexSeen + 0x1F + 28] = 1;
        }
      };

      function finalize(out, party, boxes) {
        const cur = out[O.CurrentBoxIndex];
        for (let i = 0; i < BOXES; i++) {
          const ofs = g2BoxOfs(i);
          const written = mergeList(out, ofs, cap, SIZE.pk2.box, boxes[i], true);
          if (written && i === cur) out.copyWithin(O.CurrentBox, ofs, ofs + G2_BOX_LIST);
        }
        mergeList(out, O.Party, 6, SIZE.pk2.party, party, true);
        let sum = 0; for (let i = TRAINER1; i <= O.ChecksumEnd; i++) sum = (sum + out[i]) & 0xFFFF;
        U.w16(out, O.Checksum1, sum);
        U.w16(out, O.Checksum2, sum);
        if (game === "C") out.copyWithin(0x1209, 0x2009, 0x2009 + 0xB7A);   // secondary copy
        else {
          out.copyWithin(0x15C7, 0x2009, 0x222F);
          out.copyWithin(0x3D69, 0x222F, 0x23D9);
          out.copyWithin(0x0C6B, 0x23D9, 0x2856);
          out.copyWithin(0x7E39, 0x2856, 0x288A);
          out.copyWithin(0x10E8, 0x288A, 0x2D69);
        }
      }

      return makeSave({
        gen: 2, game, version, u8, table: TABLE2, fmt: "pk2", boxCount: BOXES, party, boxes,
        trainer: {
          name: decodeStr(TABLE2, u8.subarray(TRAINER1 + 2, TRAINER1 + 2 + MAX_OT)), tid: U.u16be(u8, TRAINER1), sid: 0,
          gender: O.Gender >= 0 ? u8[O.Gender] & 1 : 0,
        },
        onDex: setDex, finalize,
      });
    },
  });
})();
