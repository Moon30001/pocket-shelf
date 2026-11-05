// Pocket Shelf save engine — Gen 4 (D/P/Pt/HG/SS) + Gen 5 (B/W/B2/W2) codec.
// Ported from PKHeX (https://github.com/kwsch/PKHeX, GPL-3.0, by Kaphotics & contributors):
// SAV4*/SAV5*, SAV4BlockDetection, BlockInfo4, BlockInfoNDS, SaveBlockAccessor5*, PK4/PK5/G4PKM,
// PokeCrypto (Decrypt45/Encrypt45), StringConverter4/4Util/5, SaveUtil (IsG4*/IsG5*).
(function () {
  'use strict';
  // Gen 4 international glyph table (PKHeX StringConverter4Util.TableINT, 0x000-0x1EC). 0xFFFF = unused glyph.
  const G4TABLE = "\uffff\u3000\u3041\u3042\u3043\u3044\u3045\u3046\u3047\u3048\u3049\u304a\u304b\u304c\u304d\u304e\u304f\u3050\u3051\u3052\u3053\u3054\u3055\u3056\u3057\u3058\u3059\u305a\u305b\u305c\u305d\u305e\u305f\u3060\u3061\u3062\u3063\u3064\u3065\u3066\u3067\u3068\u3069\u306a\u306b\u306c\u306d\u306e\u306f\u3070\u3071\u3072\u3073\u3074\u3075\u3076\u3077\u3078\u3079\u307a\u307b\u307c\u307d\u307e\u307f\u3080\u3081\u3082\u3083\u3084\u3085\u3086\u3087\u3088\u3089\u308a\u308b\u308c\u308d\u308f\u3092\u3093\u30a1\u30a2\u30a3\u30a4\u30a5\u30a6\u30a7\u30a8\u30a9\u30aa\u30ab\u30ac\u30ad\u30ae\u30af\u30b0\u30b1\u30b2\u30b3\u30b4\u30b5\u30b6\u30b7\u30b8\u30b9\u30ba\u30bb\u30bc\u30bd\u30be\u30bf\u30c0\u30c1\u30c2\u30c3\u30c4\u30c5\u30c6\u30c7\u30c8\u30c9\u30ca\u30cb\u30cc\u30cd\u30ce\u30cf\u30d0\u30d1\u30d2\u30d3\u30d4\u30d5\u30d6\u30d7\u30d8\u30d9\u30da\u30db\u30dc\u30dd\u30de\u30df\u30e0\u30e1\u30e2\u30e3\u30e4\u30e5\u30e6\u30e7\u30e8\u30e9\u30ea\u30eb\u30ec\u30ed\u30ef\u30f2\u30f3\uff10\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff21\uff22\uff23\uff24\uff25\uff26\uff27\uff28\uff29\uff2a\uff2b\uff2c\uff2d\uff2e\uff2f\uff30\uff31\uff32\uff33\uff34\uff35\uff36\uff37\uff38\uff39\uff3a\uff41\uff42\uff43\uff44\uff45\uff46\uff47\uff48\uff49\uff4a\uff4b\uff4c\uff4d\uff4e\uff4f\uff50\uff51\uff52\uff53\uff54\uff55\uff56\uff57\uff58\uff59\uff5a\uffff\uff01\uff1f\u3001\u3002\u2026\u30fb\uff0f\u300c\u300d\u300e\u300f\uff08\uff09\u2642\u2640\uff0b\u30fc\u00d7\u00f7\uff1d\uff5e\uff1a\uff1b\uff0e\uff0c\u2660\u2663\u2665\u2666\u2605\u25ce\u25cb\u25a1\u25b3\u25c7\uff20\u266a\uff05\u2600\u2601\u2602\u2603\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u5186\u2648\u2649\u264a\u264b\u264c\u264d\u264e\u264f\u2190\u2191\u2193\u2192\u25ba\uff060123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u2467\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u2468\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff\u0152\u0153\u015e\u015f\u00aa\u00ba\u2469\u246a\u246b$\u00a1\u00bf!?,.\u246c\uff65/\u2018\u0027\u201c\u201d\u201e\u00ab\u00bb()\u246d\u246e+-*#=&~:;\u246f\u2470\u2471\u2472\u2473\u2474\u2475\u2476\u2477\u2478@\u2479%\u247a\u247b\u247c\u247d\u247e\u247f\u2480\u2481\u2482\u2483\u2484 \u2485\u2486\u2487\u2488\u2489\u248a\u248b\u248c\u248d\u00b0_\uff3f\u248e\u248f";
  const H = globalThis.PkSave.util;
  const u16 = H.u16, u32 = H.u32, w16 = H.w16, w32 = H.w32, crc = H.crc16ccitt;
  const PD = () => globalThis.PkData;

  // ---------------- PKM crypto (PKHeX PokeCrypto: Decrypt45 / Encrypt45) ----------------
  const BLOCK_POS = [
    0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
    2, 0, 1, 3, 3, 0, 1, 2, 2, 0, 3, 1, 3, 0, 2, 1, 1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2,
    2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0,
    0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
  ];
  const BLOCK_POS_INV = [0, 1, 2, 4, 3, 5, 6, 7, 12, 18, 13, 19, 8, 10, 14, 20, 16, 22, 9, 11, 15, 21, 17, 23, 0, 1, 2, 4, 3, 5, 6, 7];
  const SIZE_STORED = 136, BLOCK = 32;

  function cryptArray(d, start, end, seed) {        // LCRNG xor stream over u16s
    seed >>>= 0;
    for (let i = start; i < end; i += 2) {
      seed = (Math.imul(0x41C64E6D, seed) + 0x6073) >>> 0;
      const x = seed >>> 16;
      d[i] ^= x & 0xFF; d[i + 1] ^= x >>> 8;
    }
  }
  function shuffle(d, sv) {                          // out block i = in block BLOCK_POS[sv*4+i]
    if (sv === 0) return;
    const src = d.slice(8, SIZE_STORED);
    for (let i = 0; i < 4; i++) d.set(src.subarray(BLOCK_POS[sv * 4 + i] * BLOCK, BLOCK_POS[sv * 4 + i] * BLOCK + BLOCK), 8 + i * BLOCK);
  }
  function decrypt45(enc) {                          // returns a new decrypted array (same length)
    const d = enc.slice();
    const pv = u32(d, 0), chk = u16(d, 6), sv = (pv >>> 13) & 31;
    cryptArray(d, 8, SIZE_STORED, chk);
    if (d.length > SIZE_STORED) cryptArray(d, SIZE_STORED, d.length, pv);
    shuffle(d, sv);
    return d;
  }
  function encrypt45(dec) {
    const d = dec.slice();
    const pv = u32(d, 0), chk = u16(d, 6), sv = BLOCK_POS_INV[(pv >>> 13) & 31];
    shuffle(d, sv);
    cryptArray(d, 8, SIZE_STORED, chk);
    if (d.length > SIZE_STORED) cryptArray(d, SIZE_STORED, d.length, pv);
    return d;
  }
  function pkChecksum(d) { let c = 0; for (let i = 8; i < SIZE_STORED; i += 2) c = (c + u16(d, i)) & 0xFFFF; return c; }
  function refreshChecksum(d) { w16(d, 6, pkChecksum(d)); }
  const isZero = (b, o, n) => { for (let i = 0; i < n; i++) if (b[o + i]) return false; return true; };

  // ---------------- Strings ----------------
  // Gen 4: 16-bit glyph table (PKHeX StringConverter4Util.TableINT, international part only).
  const G4REV = new Map();
  for (let i = G4TABLE.length - 1; i >= 0; i--) { const c = G4TABLE.charCodeAt(i); if (c !== 0xFFFF) G4REV.set(c, i); }
  const HGM = 0x246D, HGF = 0x246E;                  // half-width gender glyphs as Gen5 code points
  const normGender = (c) => c === HGM ? 0x2642 : c === HGF ? 0x2640 : c;
  const isFullWidth = (s) => { for (const ch of s) { const c = ch.charCodeAt(0); if ((c >> 12) === 0 || (c >> 12) === 0xE) continue; if (c === 0x2640 || c === 0x2642) continue; return true; } return false; };
  const unNormGender = (c) => c === 0x2642 ? HGM : c === 0x2640 ? HGF : c;

  function getString4(b, o, len) {
    let s = '';
    for (let i = 0; i < len; i += 2) {
      const v = u16(b, o + i);
      if (v === 0xFFFF || v === 0) break;
      const c = v < G4TABLE.length ? G4TABLE.charCodeAt(v) : 0xFFFF;   // Korean range unsupported (intl only)
      s += String.fromCharCode(normGender(c));
    }
    return s;
  }
  function setString4(b, o, len, str, maxLen) {      // StringConverterOption.None semantics on a fresh buffer
    const chars = Array.from(String(str || '')).slice(0, maxLen);
    const half = !isFullWidth(chars.join(''));
    chars.forEach((ch, i) => {
      let c = ch.charCodeAt(0);
      if (half) c = unNormGender(c);
      let v = G4REV.get(c);
      if (v === undefined) v = c === 0x2019 ? 0x1B3 : 0x1AC;          // ’ -> ', else '?'
      w16(b, o + i * 2, v);
    });
    if (chars.length * 2 < len) w16(b, o + chars.length * 2, 0xFFFF);
  }
  function getString5(b, o, len) {
    let s = '';
    for (let i = 0; i < len; i += 2) { const v = u16(b, o + i); if (v === 0xFFFF || v === 0) break; s += String.fromCharCode(normGender(v)); }
    return s;
  }
  function setString5(b, o, len, str, maxLen) {
    const chars = Array.from(String(str || '')).filter(ch => ch.length === 1).slice(0, maxLen); // BMP only
    const half = !isFullWidth(chars.join(''));
    chars.forEach((ch, i) => { let c = ch.charCodeAt(0); if (half) c = unNormGender(c); w16(b, o + i * 2, c); });
    if (chars.length * 2 < len) w16(b, o + chars.length * 2, 0xFFFF);
  }

  // ---------------- PK4 / PK5 <-> NeutralMon ----------------
  function toNeutral(d, gen) {
    const pid = u32(d, 0), species = u16(d, 8), tid = u16(d, 0x0C), sid = u16(d, 0x0E), exp = u32(d, 0x10);
    const iv32 = u32(d, 0x38);
    const str = gen === 4 ? getString4 : getString5;
    let metLocation, ball, nature, abilityNum;
    if (gen === 4) {
      const ext = u16(d, 0x46);
      metLocation = ext !== 0 ? ext : u16(d, 0x80);
      ball = Math.max(d[0x86], d[0x83]);
      nature = pid % 25;
      abilityNum = pid & 1;
    } else {
      metLocation = u16(d, 0x80);
      ball = d[0x83];
      nature = d[0x41];
      abilityNum = (d[0x42] & 1) ? 2 : ((pid >>> 16) & 1);
    }
    return {
      species, nickname: str(d, 0x48, 22), isNicknamed: ((iv32 >>> 31) & 1) === 1,
      otName: str(d, 0x68, 16), otGender: d[0x84] >> 7, tid, sid,
      exp, level: H.levelFromExp(species, exp),
      ivs: [0, 5, 10, 15, 20, 25].map(s => (iv32 >>> s) & 31),
      evs: [0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D].map(o => d[o]),
      moves: [0, 1, 2, 3].map(i => u16(d, 0x28 + i * 2)),
      ppUps: [0, 1, 2, 3].map(i => d[0x34 + i]),
      heldItem: u16(d, 0x0A),
      pid, nature, abilityNum,
      gender: (d[0x40] >> 1) & 3,
      shiny: H.isShiny(pid, tid, sid),
      friendship: d[0x14], pokerus: d[0x82],
      metLevel: d[0x84] & 0x7F, metLocation, ball,
      originVersion: d[0x5F], language: d[0x17],
      isEgg: ((iv32 >>> 30) & 1) === 1,
      fatefulEncounter: (d[0x40] & 1) === 1,
      gen12: null,
      raw: { format: gen === 4 ? 'pk4' : 'pk5', data: d.slice(0, SIZE_STORED) },
    };
  }

  const VALID_ORIGIN = {
    4: new Set([1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 15]),
    5: new Set([1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 15, 20, 21, 22, 23]),
  };

  function fromNeutral(m, gen, sav) {
    const d = new Uint8Array(SIZE_STORED);
    const P = PD();
    const species = m.species | 0;
    const sp = P.species[species] || P.species[0] || {};
    const pid = (m.pid == null ? 0 : m.pid) >>> 0;
    w32(d, 0, pid);
    w16(d, 0x08, species);
    w16(d, 0x0A, m.heldItem | 0);
    w16(d, 0x0C, m.tid | 0); w16(d, 0x0E, m.sid | 0);
    w32(d, 0x10, m.exp >>> 0);
    d[0x14] = m.friendship != null ? m.friendship : (sp.baseFriendship != null ? sp.baseFriendship : 70);
    // ability
    let ability = 0;
    if (gen === 4) {
      const ab = sp.ab4 || [0, 0];
      ability = ab[pid & 1] || ab[0] || 0;
    } else {
      const ab = sp.ab5 || [0, 0, 0];
      const slot = m.abilityNum === 2 ? 2 : (m.abilityNum === 0 || m.abilityNum === 1) ? m.abilityNum : ((pid >>> 16) & 1);
      ability = ab[slot] || ab[0] || 0;
    }
    d[0x15] = ability;
    d[0x17] = m.language || sav.trainer.language || 2;
    (m.evs || []).slice(0, 6).forEach((v, i) => { d[0x18 + i] = Math.max(0, Math.min(255, v | 0)); });
    const moves = (m.moves || [0, 0, 0, 0]), ups = (m.ppUps || [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const mv = moves[i] | 0, up = Math.max(0, Math.min(3, ups[i] | 0));
      w16(d, 0x28 + i * 2, mv);
      d[0x30 + i] = mv ? H.ppWithUps(gen, mv, up) : 0;
      d[0x34 + i] = mv ? up : 0;
    }
    const ivs = m.ivs || [0, 0, 0, 0, 0, 0];
    let iv32 = 0;
    for (let i = 0; i < 6; i++) iv32 |= (Math.max(0, Math.min(31, ivs[i] | 0)) << (i * 5));
    if (m.isEgg) iv32 |= 1 << 30;
    if (m.isNicknamed) iv32 |= 1 << 31;
    w32(d, 0x38, iv32 >>> 0);
    const gender = m.gender != null ? m.gender : H.genderFromPid(species, pid);
    d[0x40] = (m.fatefulEncounter ? 1 : 0) | ((gender & 3) << 1);
    if (gen === 5) {
      d[0x41] = m.nature != null ? m.nature : pid % 25;
      d[0x42] = m.abilityNum === 2 ? 1 : 0;
    }
    // names
    const setStr = gen === 4 ? setString4 : setString5;
    let nick = m.isNicknamed ? m.nickname : (gen === 4 ? String(sp.name || '').toUpperCase() : String(sp.name || ''));
    setStr(d, 0x48, 22, nick, 10);
    const ver = VALID_ORIGIN[gen].has(m.originVersion) ? m.originVersion : sav.defaultVersion;
    d[0x5F] = ver;
    setStr(d, 0x68, 16, m.otName, 7);
    // met date = today (as Pal Park / Poké Transfer do)
    const now = new Date();
    d[0x7B] = now.getFullYear() - 2000; d[0x7C] = now.getMonth() + 1; d[0x7D] = now.getDate();
    const loc = (m.metLocation | 0) & 0xFFFF;
    if (gen === 4) {
      // PKHeX G4PKM.MetLocation setter
      const ptHGSS = ver === 7 || ver === 8 || ver === 12;
      if (loc === 0) { /* both 0 */ }
      else if ((loc > 111 && loc < 2000) || (loc > 2010 && loc < 3000)) { w16(d, 0x80, 3002); w16(d, 0x46, loc); }
      else { w16(d, 0x80, loc); w16(d, 0x46, ptHGSS ? loc : 0); }
    } else {
      w16(d, 0x80, loc);
    }
    d[0x82] = m.pokerus | 0;
    const ball = m.ball | 0;
    if (gen === 4) {
      // PKHeX G4PKM.Ball setter: D/P/Pt ball clamped to Cherish, HG/SS ball only for HG/SS-created non-event mons
      d[0x83] = ball >= 0 && ball <= 16 ? ball : 4;
      const hgssMade = (ver === 7 || ver === 8) && !m.fatefulEncounter;
      d[0x86] = hgssMade ? (ball >= 0 && ball <= 24 ? ball : 4) : 0;
    } else {
      d[0x83] = ball >= 0 && ball <= 25 ? ball : 4;
    }
    d[0x84] = (Math.max(0, Math.min(100, m.metLevel | 0)) & 0x7F) | ((m.otGender & 1) << 7);
    return d;
  }

  // ---------------- Save object (shared) ----------------
  class SaveBase {
    list() {
      const out = [];
      const pc = this.partyCount();
      for (let i = 0; i < pc; i++) {
        const d = decrypt45(this.buf.slice(this.partyOff(i), this.partyOff(i) + SIZE_STORED));
        if (u16(d, 8) === 0) continue;
        out.push({ where: 'party', box: null, slot: i, mon: toNeutral(d, this.gen) });
      }
      for (let b = 0; b < this.boxCount; b++) for (let s = 0; s < this.boxSlots; s++) {
        const d = this.readBox(b, s);
        if (d) out.push({ where: 'box', box: b, slot: s, mon: toNeutral(d, this.gen) });
      }
      return out;
    }
    readBox(b, s) {
      const o = this.boxOff(b, s);
      if (isZero(this.buf, o, SIZE_STORED)) return null;
      const d = decrypt45(this.buf.slice(o, o + SIZE_STORED));
      return u16(d, 8) === 0 ? null : d;
    }
    remove({ where, box, slot }) {
      if (where === 'party') {
        const pc = this.partyCount();
        if (!(slot >= 0 && slot < pc)) throw new Error('No Pokémon in that party slot');
        if (pc <= 1) throw new Error("Can't remove the last Pokémon in the party");
        // Encrypted structs are position-independent: slide the raw bytes up.
        for (let i = slot + 1; i < pc; i++) this.buf.copyWithin(this.partyOff(i - 1), this.partyOff(i), this.partyOff(i) + this.partySize);
        this.buf.fill(0, this.partyOff(pc - 1), this.partyOff(pc - 1) + this.partySize);
        this.setPartyCount(pc - 1);
        return;
      }
      if (where === 'box') {
        if (!(box >= 0 && box < this.boxCount && slot >= 0 && slot < this.boxSlots)) throw new Error('Bad box slot');
        const o = this.boxOff(box, slot);
        this.buf.fill(0, o, o + SIZE_STORED);
        return;
      }
      throw new Error('Unknown location: ' + where);
    }
    insert(mon) {
      for (let b = 0; b < this.boxCount; b++) for (let s = 0; s < this.boxSlots; s++) {
        if (this.readBox(b, s)) continue;
        let d;
        if (mon && mon.raw && mon.raw.format === this.format && mon.raw.data && mon.raw.data.length >= SIZE_STORED) {
          d = new Uint8Array(mon.raw.data.slice(0, SIZE_STORED));
        } else {
          d = fromNeutral(mon, this.gen, this);
        }
        this.prepareStored(d);
        refreshChecksum(d);
        this.buf.set(encrypt45(d), this.boxOff(b, s));
        return { where: 'box', box: b, slot: s };
      }
      throw new Error('PC is full');
    }
    prepareStored(d) { }
  }

  // ---------------- Gen 4 (PKHeX SAV4 / SAV4DP / SAV4Pt / SAV4HGSS / SAV4BlockDetection / BlockInfo4) ----------------
  const PARTITION = 0x40000;
  const MAGIC_INTL = 0x20060623, MAGIC_KOREAN = 0x20070903;
  const G4 = {
    DP: { gSize: 0xC100, sSize: 0x121E0, sStart: 0xC100, footer: 0x14, trainer1: 0x64, party: 0x98, hgss: false,
      extra: [[0, 0x20000, 0x2AC0]] },
    Pt: { gSize: 0xCF2C, sSize: 0x121E4, sStart: 0xCF2C, footer: 0x14, trainer1: 0x68, party: 0xA0, hgss: false,
      extra: [[0, 0x20000, 0x2AC0], [1, 0x23000, 0x0BB0], [2, 0x24000, 0x1D60], [3, 0x26000, 0x1D60], [4, 0x28000, 0x1D60], [5, 0x2A000, 0x1D60]] },
    HGSS: { gSize: 0xF628, sSize: 0x12310, sStart: 0xF628 + 0xD8, footer: 0x10, trainer1: 0x64, party: 0x98, hgss: true,
      extra: [[0, 0x23000, 0x2AC0], [1, 0x26000, 0x0BB0], [2, 0x27000, 0x1D60], [3, 0x29000, 0x1D60], [4, 0x2B000, 0x1D60], [5, 0x2D000, 0x1D60]] },
  };
  const HINT_VERSION = { ADAE: 10, APAE: 11, CPUE: 12, IPKE: 7, IPGE: 8, IRBO: 21, IRAO: 20, IREO: 23, IRDO: 22 };
  const hintCode = (hint) => (hint && typeof hint.code === 'string') ? hint.code.trim().toUpperCase() : '';
  const hintIsAsian = (hint) => { const c = hintCode(hint); return c.length === 4 && (c[3] === 'J' || c[3] === 'K'); };

  function compareCounters(c1, c2) {
    if (c1 === 0xFFFFFFFF && c2 !== 0xFFFFFFFE) return 1;
    if (c2 === 0xFFFFFFFF && c1 !== 0xFFFFFFFE) return 0;
    if (c1 > c2) return 0;
    if (c1 < c2) return 1;
    return 2;
  }
  function compareFooters(b, o1, o2) {
    const r1 = compareCounters(u32(b, o1), u32(b, o2));
    if (r1 !== 2) return r1;
    return compareCounters(u32(b, o1 + 4), u32(b, o2 + 4)) === 1 ? 1 : 0;
  }
  const activeBlock4 = (b, begin, length) => { const o = begin + length - 0x14; return compareFooters(b, o, o + PARTITION); };

  function isValidGeneralFooter2(b, length) {     // SaveUtil.IsValidGeneralFooter2 (checks the second partition)
    const end = PARTITION + length;
    if (u32(b, end - 0xC) !== length) return false;
    const sdk = u32(b, end - 0x8);
    return sdk === MAGIC_INTL || sdk === MAGIC_KOREAN;
  }

  class Save4 extends SaveBase {
    constructor(u8, hint, game) {
      super();
      const L = this.L = G4[game];
      this.buf = new Uint8Array(u8);
      this.gen = 4; this.game = game; this.format = 'pk4';
      this.boxCount = 18; this.boxSlots = 30; this.partySize = 236;
      this.gbo = activeBlock4(this.buf, 0, L.gSize) === 0 ? 0 : PARTITION;
      this.sbo = (activeBlock4(this.buf, L.sStart, L.sSize) === 0 ? 0 : PARTITION) + L.sStart;
      this.gboBackup = this.gbo === 0 ? PARTITION : 0;
      this.sboBackup = (this.sbo - L.sStart === 0 ? PARTITION : 0) + L.sStart;
      const t = this.gbo + L.trainer1;
      this.trainer = { name: getString4(this.buf, t, 16), tid: u16(this.buf, t + 0x10), sid: u16(this.buf, t + 0x12), gender: this.buf[t + 0x18], language: this.buf[t + 0x19] };
      let version = HINT_VERSION[hintCode(hint)];
      if (version != null && !((game === 'DP' && (version === 10 || version === 11)) || (game === 'Pt' && version === 12) || (game === 'HGSS' && (version === 7 || version === 8)))) version = undefined;
      if (version == null && game === 'Pt') version = 12;
      if (version == null && game === 'HGSS') { const rc = this.buf[t + 0x1C]; if (rc === 7 || rc === 8) version = rc; }
      this.version = version != null ? version : null;
      this.defaultVersion = version != null ? version : (game === 'DP' ? 10 : game === 'Pt' ? 12 : 7);
    }
    partyCount() { return this.buf[this.gbo + this.L.party - 4]; }
    setPartyCount(n) { this.buf[this.gbo + this.L.party - 4] = n; }
    partyOff(i) { return this.gbo + this.L.party + 236 * i; }
    boxOff(b, s) { return this.sbo + (this.L.hgss ? b * 0x1000 : 4 + b * 0xFF0) + s * SIZE_STORED; }
    prepareStored(d) { if (this.L.hgss) d[0x87] = 0; }        // SAV4HGSS.SetPKM: WalkingMood = 0 in boxes
    blockChecksum(o, size) { w16(this.buf, o + size - 2, crc(this.buf, o, size - this.L.footer)); }
    toBytes() {
      const L = this.L, b = this.buf;
      if (L.hgss) w32(b, this.sbo + 18 * 0x1000 + 4, 0x3FFFF);  // FlagsBoxContentChanged = all (SAV4HGSS.GetFinalData)
      // SAV4.SetChecksums
      this.blockChecksum(this.gbo, L.gSize);
      this.blockChecksum(this.sbo, L.sSize);
      if (u32(b, this.gboBackup + L.gSize - 8) !== 0xFFFFFFFF) this.blockChecksum(this.gboBackup, L.gSize);
      if (u32(b, this.sboBackup + L.sSize - 8) !== 0xFFFFFFFF) this.blockChecksum(this.sboBackup, L.sSize);
      for (const base of [0, PARTITION]) for (const [id, off, len] of L.extra) {   // BlockInfo4.SetChecksum
        const o = base + off, foot = o + len - 0x10;
        const init = id === 0 ? u32(b, foot + 4) !== 0xFFFFFFFF : u32(b, o) !== 0xFFFFFFFF;
        if (init) w16(b, foot + 14, crc(b, o, len - 2));
      }
      return b.slice();
    }
  }

  const gen4 = {
    id: 'gen4', gens: [4],
    detect(u8, hint) {
      try {
        if (!u8 || u8.length !== 0x80000) return null;
        if (hint && hint.system && hint.system !== 'nds') return null;
        if (hintIsAsian(hint)) return null;
        let game = null;
        if (isValidGeneralFooter2(u8, G4.DP.gSize)) game = 'DP';
        else if (isValidGeneralFooter2(u8, G4.Pt.gSize)) game = 'Pt';
        else if (isValidGeneralFooter2(u8, G4.HGSS.gSize)) game = 'HGSS';
        if (!game) return null;
        const L = G4[game];
        if (u32(u8, PARTITION + L.gSize - 8) === MAGIC_KOREAN) return null;        // Korean layout
        const gbo = activeBlock4(u8, 0, L.gSize) === 0 ? 0 : PARTITION;
        const lang = u8[gbo + L.trainer1 + 0x19];
        if (lang === 1 || lang === 8) return null;                                  // Japanese / Korean
        return { game, gen: 4 };
      } catch (e) { return null; }
    },
    open(u8, hint, detected) {
      const d = detected || gen4.detect(u8, hint);
      if (!d) throw new Error('Not a supported Gen 4 save');
      return new Save4(u8, hint, d.game);
    },
  };

  // ---------------- Gen 5 (PKHeX SAV5 / SAV5BW / SAV5B2W2 / SaveBlockAccessor5* / BlockInfoNDS) ----------------
  // Block tables: [offset, length, checksumOffset, checksumMirror]
  const BW_BLOCKS = [
    [0x00000, 0x03E0, 0x003E2, 0x23F00], [0x18400, 0x09C0, 0x18DC2, 0x23F32], [0x18E00, 0x0534, 0x19336, 0x23F34],
    [0x19400, 0x0068, 0x1946A, 0x23F36], [0x19500, 0x009C, 0x1959E, 0x23F38], [0x19600, 0x1338, 0x1A93A, 0x23F3A],
    [0x1AA00, 0x07C4, 0x1B1C6, 0x23F3C], [0x1B200, 0x0D54, 0x1BF56, 0x23F3E], [0x1C000, 0x002C, 0x1C02E, 0x23F40],
    [0x1C100, 0x0658, 0x1C75A, 0x23F42], [0x1C800, 0x0A94, 0x1D296, 0x23F44], [0x1D300, 0x01AC, 0x1D4AE, 0x23F46],
    [0x1D500, 0x03EC, 0x1D8EE, 0x23F48], [0x1D900, 0x005C, 0x1D95E, 0x23F4A], [0x1DA00, 0x01E0, 0x1DBE2, 0x23F4C],
    [0x1DC00, 0x00A8, 0x1DCAA, 0x23F4E], [0x1DD00, 0x0460, 0x1E162, 0x23F50], [0x1E200, 0x1400, 0x1F602, 0x23F52],
    [0x1F700, 0x02A4, 0x1F9A6, 0x23F54], [0x1FA00, 0x02DC, 0x1FCDE, 0x23F56], [0x1FD00, 0x034C, 0x2004E, 0x23F58],
    [0x20100, 0x03EC, 0x204EE, 0x23F5A], [0x20500, 0x00F8, 0x205FA, 0x23F5C], [0x20600, 0x02FC, 0x208FE, 0x23F5E],
    [0x20900, 0x0094, 0x20996, 0x23F60], [0x20A00, 0x035C, 0x20D5E, 0x23F62], [0x20E00, 0x01CC, 0x20FCE, 0x23F64],
    [0x21000, 0x0168, 0x2116A, 0x23F66], [0x21200, 0x00EC, 0x212EE, 0x23F68], [0x21300, 0x01B0, 0x214B2, 0x23F6A],
    [0x21500, 0x001C, 0x2151E, 0x23F6C], [0x21600, 0x04D4, 0x21AD6, 0x23F6E], [0x21B00, 0x0034, 0x21B36, 0x23F70],
    [0x21C00, 0x003C, 0x21C3E, 0x23F72], [0x21D00, 0x01AC, 0x21EAE, 0x23F74], [0x21F00, 0x0B90, 0x22A92, 0x23F76],
    [0x22B00, 0x009C, 0x22B9E, 0x23F78], [0x22C00, 0x0850, 0x23452, 0x23F7A], [0x23500, 0x0028, 0x2352A, 0x23F7C],
    [0x23600, 0x0284, 0x23886, 0x23F7E], [0x23900, 0x0010, 0x23912, 0x23F80], [0x23A00, 0x005C, 0x23A5E, 0x23F82],
    [0x23B00, 0x016C, 0x23C6E, 0x23F84], [0x23D00, 0x0040, 0x23D42, 0x23F86], [0x23E00, 0x00FC, 0x23EFE, 0x23F88],
    [0x23F00, 0x008C, 0x23F9A, 0x23F9A],
  ];
  const B2W2_BLOCKS = [
    [0x00000, 0x03E0, 0x003E2, 0x25F00], [0x18400, 0x09EC, 0x18DEE, 0x25F32], [0x18E00, 0x0534, 0x19336, 0x25F34],
    [0x19400, 0x00B0, 0x194B2, 0x25F36], [0x19500, 0x00A8, 0x195AA, 0x25F38], [0x19600, 0x1338, 0x1A93A, 0x25F3A],
    [0x1AA00, 0x07C4, 0x1B1C6, 0x25F3C], [0x1B200, 0x0D54, 0x1BF56, 0x25F3E], [0x1C000, 0x0094, 0x1C096, 0x25F40],
    [0x1C100, 0x0658, 0x1C75A, 0x25F42], [0x1C800, 0x0A94, 0x1D296, 0x25F44], [0x1D300, 0x01AC, 0x1D4AE, 0x25F46],
    [0x1D500, 0x03EC, 0x1D8EE, 0x25F48], [0x1D900, 0x005C, 0x1D95E, 0x25F4A], [0x1DA00, 0x01E0, 0x1DBE2, 0x25F4C],
    [0x1DC00, 0x00A8, 0x1DCAA, 0x25F4E], [0x1DD00, 0x0460, 0x1E162, 0x25F50], [0x1E200, 0x1400, 0x1F602, 0x25F52],
    [0x1F700, 0x02A4, 0x1F9A6, 0x25F54], [0x1FA00, 0x00E0, 0x1FAE2, 0x25F56], [0x1FB00, 0x034C, 0x1FE4E, 0x25F58],
    [0x1FF00, 0x04E0, 0x203E2, 0x25F5A], [0x20400, 0x00F8, 0x204FA, 0x25F5C], [0x20500, 0x02FC, 0x207FE, 0x25F5E],
    [0x20800, 0x0094, 0x20896, 0x25F60], [0x20900, 0x035C, 0x20C5E, 0x25F62], [0x20D00, 0x01D4, 0x20ED6, 0x25F64],
    [0x20F00, 0x01E0, 0x210E2, 0x25F66], [0x21100, 0x00F0, 0x211F2, 0x25F68], [0x21200, 0x01B4, 0x213B6, 0x25F6A],
    [0x21400, 0x04DC, 0x218DE, 0x25F6C], [0x21900, 0x0034, 0x21936, 0x25F6E], [0x21A00, 0x003C, 0x21A3E, 0x25F70],
    [0x21B00, 0x01AC, 0x21CAE, 0x25F72], [0x21D00, 0x0B90, 0x22892, 0x25F74], [0x22900, 0x00AC, 0x229AE, 0x25F76],
    [0x22A00, 0x0850, 0x23252, 0x25F78], [0x23300, 0x0284, 0x23586, 0x25F7A], [0x23600, 0x0010, 0x23612, 0x25F7C],
    [0x23700, 0x00A8, 0x237AA, 0x25F7E], [0x23800, 0x016C, 0x2396E, 0x25F80], [0x23A00, 0x0080, 0x23A82, 0x25F82],
    [0x23B00, 0x00FC, 0x23BFE, 0x25F84], [0x23C00, 0x16A8, 0x252AA, 0x25F86], [0x25300, 0x0498, 0x2579A, 0x25F88],
    [0x25800, 0x0060, 0x25862, 0x25F8A], [0x25900, 0x00FC, 0x259FE, 0x25F8C], [0x25A00, 0x03E4, 0x25DE6, 0x25F8E],
    [0x25E00, 0x00F0, 0x25EF2, 0x25F90], [0x25F00, 0x0094, 0x25FA2, 0x25FA2],
  ];
  // The 24 box blocks (ids 1..24) follow the same pattern in both games; insert them after "Box Names".
  function withBoxes(list, mirrorBase) {
    const boxes = [];
    for (let i = 0; i < 24; i++) boxes.push([0x400 + i * 0x1000, 0x0FF0, 0x13F2 + i * 0x1000, mirrorBase + 2 + i * 2]);
    return [list[0], ...boxes, ...list.slice(1)];
  }
  const G5 = {
    BW: { size: 0x24000, info: 0x8C, blocks: withBoxes(BW_BLOCKS, 0x23F00) },
    B2W2: { size: 0x26000, info: 0x94, blocks: withBoxes(B2W2_BLOCKS, 0x25F00) },
  };
  function isValidFooter5(b, mainSize, infoLength) {   // SaveUtil.IsValidFooter5
    const o = mainSize - 0x100;
    return u16(b, o + infoLength + 0x10 - 2) === crc(b, o, infoLength);
  }
  const PARTY5 = 0x18E00, BOX5 = 0x400, TRAINER5 = 0x19400;

  class Save5 extends SaveBase {
    constructor(u8, hint, game) {
      super();
      this.L = G5[game];
      this.buf = new Uint8Array(u8);
      this.gen = 5; this.game = game; this.format = 'pk5';
      this.boxCount = 24; this.boxSlots = 30; this.partySize = 220;
      const t = TRAINER5, b = this.buf;
      this.trainer = { name: getString5(b, t + 4, 16), tid: u16(b, t + 0x14), sid: u16(b, t + 0x16), gender: b[t + 0x21], language: b[t + 0x1E] };
      let version = HINT_VERSION[hintCode(hint)];
      const okFor = (v) => game === 'BW' ? (v === 20 || v === 21) : (v === 22 || v === 23);
      if (version != null && !okFor(version)) version = undefined;
      if (version == null && okFor(b[t + 0x1F])) version = b[t + 0x1F];
      this.version = version != null ? version : null;
      this.defaultVersion = version != null ? version : (game === 'BW' ? 21 : 23);
    }
    partyCount() { return this.buf[PARTY5 + 4]; }
    setPartyCount(n) { this.buf[PARTY5 + 4] = n; }
    partyOff(i) { return PARTY5 + 8 + 220 * i; }
    boxOff(b, s) { return BOX5 + SIZE_STORED * b * 30 + b * 0x10 + s * SIZE_STORED; }
    toBytes() {
      const b = this.buf;
      for (const [off, len, chk, mir] of this.L.blocks) { const c = crc(b, off, len); w16(b, chk, c); w16(b, mir, c); }
      return b.slice();
    }
  }

  const gen5 = {
    id: 'gen5', gens: [5],
    detect(u8, hint) {
      try {
        if (!u8 || u8.length !== 0x80000) return null;
        if (hint && hint.system && hint.system !== 'nds') return null;
        if (hintIsAsian(hint)) return null;
        let game = null;
        if (isValidFooter5(u8, G5.BW.size, G5.BW.info)) game = 'BW';
        else if (isValidFooter5(u8, G5.B2W2.size, G5.B2W2.info)) game = 'B2W2';
        if (!game) return null;
        const lang = u8[TRAINER5 + 0x1E];
        if (lang === 1 || lang === 8) return null;                                  // Japanese / Korean
        return { game, gen: 5 };
      } catch (e) { return null; }
    },
    open(u8, hint, detected) {
      const d = detected || gen5.detect(u8, hint);
      if (!d) throw new Error('Not a supported Gen 5 save');
      return new Save5(u8, hint, d.game);
    },
  };

  globalThis.PkSave.register(gen4);
  globalThis.PkSave.register(gen5);
  // exposed for tests / other codecs
  gen4._internal = gen5._internal = { decrypt45, encrypt45, getString4, setString4, getString5, setString5, toNeutral, fromNeutral };
})();
