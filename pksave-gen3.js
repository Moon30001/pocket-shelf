// Pocket Shelf save engine — Gen 3 (GBA) codec: Ruby/Sapphire, Emerald, FireRed/LeafGreen (128 KB flash saves).
// Logic ported from PKHeX (https://github.com/kwsch/PKHeX, GPL-3.0): SAV3.cs, SAV3BlockDetection.cs, SaveUtil.cs (IsG3 /
// GetVersionG3SAV), SaveBlock3Large*/Small*, PK3.cs, PokeCrypto.cs (Decrypt3/Encrypt3), StringConverter3.cs,
// SpeciesConverter.cs (Gen 3 internal species ids), SpeciesName.cs (default names). Same licence as this app.
(function () {
  const PkSave = globalThis.PkSave;
  const H = PkSave.util;

  // ---------- save layout (SAV3) ----------
  const SIZE_SAVE = 0x20000;
  const SIZE_SECTOR = 0x1000;
  const SIZE_SECTOR_USED = 0xF80;
  const COUNT_MAIN = 14;
  const SIZE_MAIN = COUNT_MAIN * SIZE_SECTOR;
  const COUNT_EXTRA = 4;
  const SIGNATURE = 0x08012025;
  const SIZE_STORED = 80, SIZE_PARTY = 100;
  const BOX_COUNT = 14, BOX_SLOTS = 30;
  // Large-block party offsets (SaveBlock3LargeRS/E/FRLG)
  const PARTY = { RS: { count: 0x234, data: 0x238 }, E: { count: 0x234, data: 0x238 }, FRLG: { count: 0x034, data: 0x038 } };
  const HINT_VERSION = { AXV: 2, AXP: 1, BPE: 3, BPR: 4, BPG: 5 }; // PKHeX GameVersion: S=1 R=2 E=3 FR=4 LG=5
  const GAME_FROM_HINT = { AXV: 'RS', AXP: 'RS', BPE: 'E', BPR: 'FRLG', BPG: 'FRLG' };
  const DEFAULT_VERSION = { RS: 2, E: 3, FRLG: 4 };
  const GEN3_VERSIONS = new Set([1, 2, 3, 4, 5, 15]); // S R E FR LG CXD

  // All 14 sector ids present in a slot? (SAV3.IsAllMainSectorsPresent). Returns sector-0 offset or -1.
  function allMainSectorsPresent(u8, slot) {
    const start = SIZE_MAIN * slot;
    let bits = 0, sector0 = -1;
    for (let ofs = start; ofs < start + SIZE_MAIN; ofs += SIZE_SECTOR) {
      const id = H.u16(u8, ofs + 0xFF4);
      if (id >= COUNT_MAIN) return -1;
      bits |= 1 << id;
      if (id === 0) sector0 = ofs;
    }
    return bits === 0x3FFF ? sector0 : -1;
  }
  // SAV3BlockDetection.CompareFooters (save counter at 0xFFC)
  function compareCounters(c1, c2) {
    if (c1 === 0xFFFFFFFF && c2 !== 0xFFFFFFFE) return 1;
    if (c2 === 0xFFFFFFFF && c1 !== 0xFFFFFFFE) return 0;
    if (c1 > c2) return 0;
    if (c1 < c2) return 1;
    return 0; // same -> first
  }
  function activeSlot(u8) {
    const s0 = allMainSectorsPresent(u8, 0), s1 = allMainSectorsPresent(u8, 1);
    if (s0 < 0) return s1 >= 0 ? 1 : 0;
    if (s1 < 0) return 0;
    return compareCounters(H.u32(u8, s0 + 0xFFC), H.u32(u8, s1 + 0xFFC));
  }
  // Checksums.CheckSum32 folded to 16 bits
  function checksum32(u8, ofs, len) {
    let chk = 0;
    for (let i = 0; i < len; i += 4) chk = (chk + H.u32(u8, ofs + i)) >>> 0;
    return (chk + (chk >>> 16)) & 0xFFFF;
  }
  // SaveUtil.GetVersionG3SAV on the small block
  function gameFromSmall(u8, small) {
    const v = H.u32(u8, small + 0xAC);
    if (v === 1) return 'FRLG';
    if (v === 0) return 'RS';
    for (let i = small + 0x890; i < small + 0xF2C; i++) if (u8[i] !== 0) return 'E';
    return 'RS';
  }
  function hasSignature(u8, slot) {
    const start = SIZE_MAIN * slot;
    for (let ofs = start; ofs < start + SIZE_MAIN; ofs += SIZE_SECTOR) if (H.u32(u8, ofs + 0xFF8) !== SIGNATURE) return false;
    return true;
  }

  // ---------- species (SpeciesConverter) ----------
  const N2I = [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 28, 28, 31, 31,
    112, 112, 112, 28, 28, 21, 21, 77, 77, 77, 11, 11, 11, 77, 77, 77, 39, 39, 52, 21, 15, 15, 20, 52, 78, 78, 78, 49, 49, 28,
    28, 42, 42, 73, 73, 48, 51, 51, 12, 12, -7, -7, 17, 17, -3, 26, 26, -19, 4, 4, 4, 13, 13, 25, 25, 45, 43, 11, 11, -16,
    -16, -15, -15, -25, -25, 43, 43, 43, 43, -21, -21, 34, -35, 24, 24, 6, 6, 12, 53, 17, 0, -15, -15, -22, -22, -22, 7, 7, 7, 12,
    -45, 24, 24, 24, 24, 24, 24, 24, 24, 24, 27, 27, 22, 22, 22, 24, 24];
  const I2N = [-25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25,
    -25, -11, -11, -11, -28, -28, -21, -21, 19, -31, -31, -28, -28, 7, 7, -15, -15, 35, 25, 25, -21, 3, -20, 16, 16, 45, 15, 15,
    21, 21, -12, -12, -4, -4, -4, -39, -39, -28, -28, -17, -17, 22, 22, 22, -13, -13, 15, 15, -11, -11, -52, -26, -26, -42, -42, -52,
    -49, -49, -25, -25, 0, -6, -6, -48, -77, -77, -77, -51, -51, -12, -77, -77, -77, -7, -7, -7, -17, -24, -24, -43, -45, -12, -78,
    -78, -78, -34, -73, -73, -43, -43, -43, -43, -112, -112, -112, -24, -24, -24, -24, -24, -24, -24, -24, -24, -22, -22, -22, -27,
    -27, -24, -24, -53];
  const toInternal = (n) => { const s = n - 252; return (s >= 0 && s < N2I.length) ? n + N2I[s] : n; };
  const toNational = (r) => { if (r < 252) return r; const s = r - 277; return (s >= 0 && s < I2N.length) ? r + I2N[s] : 0; };

  // ---------- charset (StringConverter3) ----------
  const T = '￿'; // terminator / invalid placeholder
  const HGM = '⑭', HGF = '⑮';
  const G3_EN = (' ÀÁÂÇÈÉÊËÌこÎÏÒÓÔ' + 'ŒÙÚÛÑßàáねçèéêëìま' + 'îïòóôœùúûñºª⑩&+あ' + 'ぃぅぇぉゃ=;がぎぐげござじずぜ' +
    'ぞだぢづでどばびぶべぼぱぴぷぺぽ' + 'っ¿¡⒆⒇オカキクケÍ%()セソ' + 'タチツテトナニヌâノハヒフヘホí' + 'ミムメモヤユヨラリ↑↓←＋ヲンァ' +
    'ィゥェォ⒅<>ガギグゲゴザジズゼ' + 'ゾダヂヅデドバビブベボパピプペポ' + 'ッ0123456789!?.-･' + '⑬“”‘\'' + HGM + HGF + '$,⑧/ABCDE' +
    'FGHIJKLMNOPQRSTU' + 'VWXYZabcdefghijk' + 'lmnopqrstuvwxyz►' + ':ÄÖÜäöü').split('');
  const G3_JP = ('　あいうえおかきくけこさしすせそ' + 'たちつてとなにぬねのはひふへほま' + 'みむめもやゆよらりるれろわをんぁ' +
    'ぃぅぇぉゃゅょがぎぐげござじずぜ' + 'ぞだぢづでどばびぶべぼぱぴぷぺぽ' + 'っアイウエオカキクケコサシスセソ' + 'タチツテトナニヌネノハヒフヘホマ' +
    'ミムメモヤユヨラリルレロワヲンァ' + 'ィゥェォャュョガギグゲゴザジズゼ' + 'ゾダヂヅデドバビブベボパピプペポ' + 'ッ０１２３４５６７８９！？。ー・' +
    '…『』「」♂♀円．×／ＡＢＣＤＥ' + 'ＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵ' + 'ＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋ' + 'ｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ►' +
    '：ÄÖÜäöü↑↓←→＋').split('');
  while (G3_EN.length < 256) G3_EN.push(T);
  while (G3_JP.length < 256) G3_JP.push(T);
  const quoteLeft = (lang) => (lang === 2 || lang === 4 || lang === 7) ? '“' : lang === 3 ? '«' : lang === 5 ? '„' : '『';
  const quoteRight = (lang) => (lang === 2 || lang === 4 || lang === 7) ? '”' : lang === 3 ? '»' : lang === 5 ? '“' : '』';
  function getString(u8, ofs, len, lang) {
    const table = lang === 1 ? G3_JP : G3_EN;
    let s = '';
    for (let i = 0; i < len; i++) {
      const v = u8[ofs + i];
      if (v === 0xFF) break;
      let c = v === 0xB1 ? quoteLeft(lang) : v === 0xB2 ? quoteRight(lang) : table[v];
      if (c === T) break;
      if (c === HGM) c = '♂'; else if (c === HGF) c = '♀';
      s += c;
    }
    return s;
  }
  function remapChar(c, lang) {
    switch (c) {
      case '’': return 0xB4;
      case '“': return lang !== 5 ? 0xB1 : 0xB2;
      case '”': case '»': case '』': return 0xB2;
      case '«': case '„': case '『': return 0xB1;
      default: return 0xFF;
    }
  }
  // Writes a string with 0xFF padding (game style). Unencodable characters are dropped.
  function setString(u8, ofs, len, str, lang) {
    const jp = lang === 1, table = jp ? G3_JP : G3_EN;
    const out = [];
    for (const ch0 of String(str || '')) {
      if (out.length >= len) break;
      let ch = ch0;
      if (!jp) ch = ch === '♂' ? HGM : ch === '♀' ? HGF : ch;
      let b = ch === '“' ? -1 : table.indexOf(ch);
      if (b < 0 || b === 0xFF) b = remapChar(ch, lang);
      if (b === 0xFF) continue;
      out.push(b);
    }
    for (let i = 0; i < len; i++) u8[ofs + i] = i < out.length ? out[i] : 0xFF;
  }
  // SpeciesName.GetSpeciesName1234 (English data only): uppercase, Farfetch'd with a straight apostrophe
  function defaultName(species) {
    const sp = globalThis.PkData.species[species];
    if (!sp) return '';
    return sp.name.toUpperCase().replace('’', '\'');
  }

  // ---------- PK3 crypto (PokeCrypto) ----------
  const BLOCK_POSITION = [
    0, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 1, 0, 2, 3, 1, 0, 3, 2,
    2, 0, 1, 3, 3, 0, 1, 2, 2, 0, 3, 1, 3, 0, 2, 1, 1, 2, 0, 3, 1, 3, 0, 2, 2, 1, 0, 3, 3, 1, 0, 2,
    2, 3, 0, 1, 3, 2, 0, 1, 1, 2, 3, 0, 1, 3, 2, 0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 3, 2, 1, 0];
  function cryptArray(d, seed) {
    for (let i = 32; i < 80; i += 4) H.w32(d, i, (H.u32(d, i) ^ seed) >>> 0);
  }
  function decrypt3(enc) { // returns new decrypted 80-byte array
    const d = enc.slice(0, SIZE_STORED);
    const pid = H.u32(d, 0), seed = (pid ^ H.u32(d, 4)) >>> 0, sv = pid % 24;
    cryptArray(d, seed);
    const src = d.slice(32, 80);
    for (let i = 0; i < 4; i++) d.set(src.subarray(BLOCK_POSITION[sv * 4 + i] * 12, BLOCK_POSITION[sv * 4 + i] * 12 + 12), 32 + i * 12);
    return d;
  }
  function encrypt3(dec) { // returns new encrypted 80-byte array
    const d = dec.slice(0, SIZE_STORED);
    const pid = H.u32(d, 0), seed = (pid ^ H.u32(d, 4)) >>> 0, sv = pid % 24;
    const src = dec.slice(32, 80);
    for (let i = 0; i < 4; i++) d.set(src.subarray(i * 12, i * 12 + 12), 32 + BLOCK_POSITION[sv * 4 + i] * 12);
    cryptArray(d, seed);
    return d;
  }
  const calcChecksum = (d) => { let c = 0; for (let i = 0x20; i < SIZE_STORED; i += 2) c = (c + H.u16(d, i)) & 0xFFFF; return c; };
  function refreshChecksum(d) { d[0x13] &= ~1; H.w16(d, 0x1C, calcChecksum(d)); } // PK3.RefreshChecksum (clears bad-egg flag)
  const isPresent = (u8, ofs) => (u8[ofs + 0x13] & 0xFB) === 2; // EntityDetection.IsPresentGBA

  // ---------- PK3 <-> NeutralMon ----------
  function toNeutral(d) {
    const pid = H.u32(d, 0), tid = H.u16(d, 4), sid = H.u16(d, 6);
    const lang = d[0x12];
    const species = toNational(H.u16(d, 0x20));
    const exp = H.u32(d, 0x24);
    const iv32 = H.u32(d, 0x48);
    const origins = H.u16(d, 0x46);
    const rib0 = H.u32(d, 0x4C);
    const isEgg = ((iv32 >>> 30) & 1) === 1;
    const nickname = getString(d, 0x08, 10, lang);
    const ppByte = d[0x28];
    const sp = globalThis.PkData.species[species];
    return {
      species, nickname,
      isNicknamed: isEgg ? false : nickname !== defaultName(species),
      otName: getString(d, 0x14, 7, lang), otGender: (origins >>> 15) & 1, tid, sid,
      exp, level: sp ? H.levelFromExp(species, exp) : 1,
      ivs: [0, 5, 10, 15, 20, 25].map((s) => (iv32 >>> s) & 31),
      evs: [0, 1, 2, 3, 4, 5].map((i) => d[0x38 + i]),
      moves: [0, 1, 2, 3].map((i) => H.u16(d, 0x2C + i * 2)),
      ppUps: [0, 1, 2, 3].map((i) => (ppByte >>> (i * 2)) & 3),
      heldItem: H.itemFrom3(H.u16(d, 0x22)),
      pid, nature: pid % 25, abilityNum: iv32 >>> 31,
      gender: sp ? H.genderFromPid(species, pid) : 2,
      shiny: H.isShiny(pid, tid, sid),
      friendship: d[0x29], pokerus: d[0x44],
      metLevel: origins & 0x7F, metLocation: d[0x45], ball: (origins >>> 11) & 0xF, originVersion: (origins >>> 7) & 0xF,
      language: lang, isEgg, fatefulEncounter: (rib0 >>> 31) === 1,
      gen12: null,
      raw: { format: 'pk3', data: d.slice(0, SIZE_STORED) },
    };
  }

  function fromNeutral(m, saveVersion) {
    const d = new Uint8Array(SIZE_STORED);
    const species = m.species | 0;
    const sp = globalThis.PkData.species[species];
    if (!sp || species < 1 || species > 386) throw new Error('Species ' + species + " can't exist in Gen 3");
    const pid = m.pid >>> 0;
    H.w32(d, 0, pid); H.w16(d, 4, m.tid & 0xFFFF); H.w16(d, 6, m.sid & 0xFFFF);
    let lang = m.language | 0;
    if (lang < 1 || lang > 7 || lang === 6) lang = 2;
    const isEgg = !!m.isEgg;
    if (isEgg) lang = 1; // PK3.IsEgg setter: egg name "タマゴ" with Japanese language
    d[0x12] = lang;
    d[0x13] = 2 | (isEgg ? 4 : 0); // FlagHasSpecies (+ FlagIsEgg)
    const nick = isEgg ? 'タマゴ' : (m.isNicknamed && m.nickname ? m.nickname : defaultName(species));
    setString(d, 0x08, 10, nick, lang);
    setString(d, 0x14, 7, m.otName || '', lang);
    H.w16(d, 0x20, toInternal(species));
    H.w16(d, 0x22, H.itemTo3(m.heldItem || 0));
    let exp = m.exp != null ? m.exp >>> 0 : H.expForLevel(species, m.level || 1);
    exp = Math.min(exp, H.expForLevel(species, 100));
    H.w32(d, 0x24, exp);
    const moves = (m.moves || []).concat([0, 0, 0, 0]).slice(0, 4).map((x) => (x > 0 && x <= 354) ? x : 0);
    const ups = (m.ppUps || []).concat([0, 0, 0, 0]).slice(0, 4).map((x) => Math.max(0, Math.min(3, x | 0)));
    let ppb = 0;
    for (let i = 0; i < 4; i++) {
      H.w16(d, 0x2C + i * 2, moves[i]);
      const u = moves[i] ? ups[i] : 0;
      ppb |= u << (i * 2);
      d[0x34 + i] = moves[i] ? H.ppWithUps(3, moves[i], u) : 0;
    }
    d[0x28] = ppb;
    d[0x29] = m.friendship != null ? m.friendship & 0xFF : (sp.baseFriendship != null ? sp.baseFriendship : 70);
    const evs = (m.evs || []).concat([0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 6; i++) d[0x38 + i] = Math.max(0, Math.min(255, evs[i] | 0));
    d[0x44] = (m.pokerus || 0) & 0xFF;
    d[0x45] = (m.metLocation || 0) & 0xFF;
    let ver = m.originVersion | 0;
    if (!GEN3_VERSIONS.has(ver)) ver = saveVersion;
    const origins = (Math.min(100, m.metLevel | 0) & 0x7F) | ((ver & 0xF) << 7) | (((m.ball != null ? m.ball : 4) & 0xF) << 11) | ((m.otGender & 1) << 15);
    H.w16(d, 0x46, origins);
    const ivs = (m.ivs || []).concat([0, 0, 0, 0, 0, 0]);
    let iv32 = 0;
    for (let i = 0; i < 6; i++) iv32 |= Math.max(0, Math.min(31, ivs[i] | 0)) << (i * 5);
    const ab = sp.ab3 || [0, 0];
    const hasTwo = ab[1] && ab[1] !== ab[0];
    const abilityBit = (hasTwo && m.abilityNum === 1) ? 1 : 0;
    iv32 = (iv32 | (isEgg ? 0x40000000 : 0) | (abilityBit ? 0x80000000 : 0)) >>> 0;
    H.w32(d, 0x48, iv32);
    H.w32(d, 0x4C, m.fatefulEncounter ? 0x80000000 : 0);
    refreshChecksum(d);
    return d;
  }

  // ---------- Save object ----------
  function readBuffers(u8, slot) {
    const small = new Uint8Array(SIZE_SECTOR_USED), large = new Uint8Array(4 * SIZE_SECTOR_USED), storage = new Uint8Array(9 * SIZE_SECTOR_USED);
    const chunk = (id) => id >= 5 ? [storage, (id - 5) * SIZE_SECTOR_USED] : id >= 1 ? [large, (id - 1) * SIZE_SECTOR_USED] : [small, 0];
    const start = slot * SIZE_MAIN;
    for (let ofs = start; ofs < start + SIZE_MAIN; ofs += SIZE_SECTOR) {
      const [buf, o] = chunk(H.u16(u8, ofs + 0xFF4));
      buf.set(u8.subarray(ofs, ofs + SIZE_SECTOR_USED), o);
    }
    return { small, large, storage, chunk };
  }

  class Save3 {
    constructor(u8, hint, detected) {
      this.data = u8.slice();
      this.gen = 3;
      this.game = detected.game;
      const code = (hint && hint.code || '').toUpperCase().slice(0, 3);
      this.version = (GAME_FROM_HINT[code] === this.game) ? HINT_VERSION[code] : (this.game === 'E' ? 3 : null);
      this.slot = activeSlot(this.data);
      const b = readBuffers(this.data, this.slot);
      this.small = b.small; this.large = b.large; this.storage = b.storage; this._chunk = b.chunk;
      this.party = PARTY[this.game];
      this.boxCount = BOX_COUNT; this.boxSlots = BOX_SLOTS;
      const s = this.small;
      // SAV3 ctor: JPN games leave the last 2 OT bytes as zero. Gen 3 JPN saves share the INT party/PC layout, so only
      // the trainer-name charset/length differs (5 chars, Japanese table).
      this.japanese = H.u16(s, 6) === 0;
      this.trainer = { name: this.japanese ? getString(s, 0, 5, 1) : getString(s, 0, 7, 2), tid: H.u16(s, 0x0A), sid: H.u16(s, 0x0C), gender: s[8] };
    }
    get partyCount() { return Math.min(6, this.large[this.party.count]); }
    _partyOfs(i) { return this.party.data + i * SIZE_PARTY; }
    _boxOfs(box, slot) { return 4 + SIZE_STORED * (box * BOX_SLOTS + slot); }
    list() {
      const out = [];
      for (let i = 0; i < this.partyCount; i++) {
        const o = this._partyOfs(i);
        out.push({ where: 'party', box: null, slot: i, mon: toNeutral(decrypt3(this.large.subarray(o, o + SIZE_STORED))) });
      }
      for (let b = 0; b < BOX_COUNT; b++) for (let s = 0; s < BOX_SLOTS; s++) {
        const o = this._boxOfs(b, s);
        if (!isPresent(this.storage, o)) continue;
        out.push({ where: 'box', box: b, slot: s, mon: toNeutral(decrypt3(this.storage.subarray(o, o + SIZE_STORED))) });
      }
      return out;
    }
    remove({ where, box, slot }) {
      if (where === 'party') {
        const n = this.partyCount;
        if (slot < 0 || slot >= n) throw new Error('No Pokémon in party slot ' + slot);
        if (n <= 1) throw new Error("Can't remove the last Pokémon in the party");
        const L = this.large;
        for (let i = slot; i < n - 1; i++) L.copyWithin(this._partyOfs(i), this._partyOfs(i + 1), this._partyOfs(i + 2));
        L.fill(0, this._partyOfs(n - 1), this._partyOfs(n));
        L[this.party.count] = n - 1;
        return;
      }
      if (where === 'box') {
        if (!(box >= 0 && box < BOX_COUNT && slot >= 0 && slot < BOX_SLOTS)) throw new Error('Bad box slot');
        const o = this._boxOfs(box, slot);
        this.storage.fill(0, o, o + SIZE_STORED);
        return;
      }
      throw new Error('Unknown location ' + where);
    }
    insert(mon) {
      let loc = null;
      for (let b = 0; b < BOX_COUNT && !loc; b++) for (let s = 0; s < BOX_SLOTS; s++) {
        if (!isPresent(this.storage, this._boxOfs(b, s))) { loc = { where: 'box', box: b, slot: s }; break; }
      }
      if (!loc) throw new Error('PC is full');
      let dec;
      if (mon.raw && mon.raw.format === 'pk3' && mon.raw.data && mon.raw.data.length >= SIZE_STORED) {
        dec = new Uint8Array(mon.raw.data).slice(0, SIZE_STORED);
        refreshChecksum(dec);
      } else {
        dec = fromNeutral(mon, this.version || DEFAULT_VERSION[this.game]);
      }
      this.storage.set(encrypt3(dec), this._boxOfs(loc.box, loc.slot));
      return loc;
    }
    toBytes() {
      const u8 = this.data.slice();
      // SAV3.WriteSectors into the active slot, keeping each sector's id/signature/save index
      const start = this.slot * SIZE_MAIN;
      for (let ofs = start; ofs < start + SIZE_MAIN; ofs += SIZE_SECTOR) {
        const [buf, o] = this._chunk(H.u16(u8, ofs + 0xFF4));
        u8.set(buf.subarray(o, o + SIZE_SECTOR_USED), ofs);
        H.w16(u8, ofs + 0xFF6, checksum32(u8, ofs, SIZE_SECTOR_USED));
      }
      // SAV3.SetChecksums: extra sectors (HoF, e-Reader, battle video), checksum at 0xFF4 when initialized
      for (let i = 0; i < COUNT_EXTRA; i++) {
        const ofs = 0x1C000 + i * SIZE_SECTOR;
        let init = false;
        for (let k = ofs; k < ofs + SIZE_SECTOR; k++) if (u8[k] !== 0 && u8[k] !== 0xFF) { init = true; break; }
        if (init) H.w16(u8, ofs + 0xFF4, checksum32(u8, ofs, SIZE_SECTOR_USED));
      }
      return u8;
    }
  }

  PkSave.register({
    id: 'gen3', gens: [3],
    detect(u8, hint) {
      try {
        if (!u8 || u8.length !== SIZE_SAVE) return null;
        if (hint && hint.system && hint.system !== 'gba') return null;
        // SaveUtil.IsG3: a slot with all 14 sector ids present. PKHeX reads the game type from the first such slot;
        // we read it from the ACTIVE slot (same result on real saves, robust if the older slot is blank/stale).
        if (allMainSectorsPresent(u8, 0) < 0 && allMainSectorsPresent(u8, 1) < 0) return null;
        const act = activeSlot(u8), s0 = allMainSectorsPresent(u8, act);
        if (s0 < 0 || !hasSignature(u8, act)) return null;
        const game = gameFromSmall(u8, s0);
        return { game, gen: 3 };
      } catch (e) { return null; }
    },
    open(u8, hint, detected) {
      return new Save3(u8, hint || {}, detected || this.detect(u8, hint));
    },
    // exposed for tests / other codecs
    _internal: { decrypt3, encrypt3, toNeutral, fromNeutral, toInternal, toNational, getString, setString },
  });
})();
