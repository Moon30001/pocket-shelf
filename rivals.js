// Pocket Shelf — "Hero vs Rival": two players on the same journey (FireRed / LeafGreen / Emerald and hacks built on them,
// e.g. Silver Rival). One player is the Hero, the other the Rival. Rules:
//   • Every battle gives EXP: wild Pokémon, trainers and battling each other. (The old no-wild-EXP rule is kept below but switched off.)
//   • You can only challenge the other player when you both have the same number of gym badges.
// Players meet through "Play together" (ghosts.js), walk up to each other and pick Battle. The versus battle runs in
// Pocket Shelf (the games are paused), both phones simulate it from the same seed, and each player's winnings
// (EXP + EVs) are written into their own game's party.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Teams: Heroes battle Rivals (several players can be on each team). Co-op players just play together, no battles.
  const ROLES = { hero: { label: "Hero", icon: "🦸", plural: "Heroes" }, rival: { label: "Rival", icon: "😈", plural: "Rivals" }, coop: { label: "Co-op", icon: "🤝", plural: "Co-op players" } };
  const canFight = (a, b) => (a === "hero" && b === "rival") || (a === "rival" && b === "hero");
  function teamText(mine, theirs, name) {
    if (!theirs) return `${esc(name)} hasn't picked a side yet. They open <b>Auto → Hero vs Rival</b> and choose one.`;
    if (mine === "coop" || theirs === "coop") return `${mine === "coop" ? "You're" : esc(name) + " is"} playing Co-op, so there's no battling. To battle, pick Hero or Rival in <b>Auto → Hero vs Rival</b>.`;
    return `You're both ${ROLES[mine].plural}, so you're teammates. Challenge someone on the other team.`;
  }
  const ROM = 0x08000000;
  const TYPE_NAMES = ["Normal", "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel", "???", "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark"];
  const BADGE_FLAG = { FRLG: { flags: 0x0EE0, first: 0x820 }, E: { flags: 0x1270, first: 0x867 } };

  let ctx = null, mem = null, tables = null, cfg = { role: null, rules: false }, statuses = new Map(), lockTimer = null;

  // ---------------- settings (per game) ----------------
  const journey = () => window.PocketJourney && PocketJourney.status(ctx.getGame().id);   // { region, current, total } or null
  const cfgKey = () => journey() ? "ps_rivals_journey" : "ps_rivals_" + ctx.getGame().id;  // one side for the whole journey
  function loadCfg() { try { cfg = Object.assign({ role: null, rules: false }, JSON.parse(localStorage.getItem(cfgKey()) || "{}")); } catch (e) {} cfg.rules = false; }   // every battle gives EXP (the no-wild-EXP rule was retired)
  function saveCfg() { try { localStorage.setItem(cfgKey(), JSON.stringify(cfg)); } catch (e) {} updateBtn(); }
  const toast = (t, ms = 3500) => { try { EJS_emulator.displayMessage(t, ms); } catch (e) {} };
  const gm = () => window.EJS_emulator && EJS_emulator.gameManager;
  const G = () => window.PocketGhosts;

  // ---------------- ROM tables ----------------
  // Every table is found by its contents (not a fixed address), so hacks that moved or edited them still work.
  function romTables(rom, prof) {
    const find = (pat, back, step = 4) => { // first match of a byte pattern → table start
      outer: for (let i = 0; i < rom.length - pat.length; i += step) {
        for (let k = 0; k < pat.length; k++) if (rom[i + k] !== pat[k]) continue outer;
        return ROM + i - back;
      }
      return null;
    };
    const b = (a) => rom[a - ROM], h = (a) => b(a) | (b(a + 1) << 8), w = (a) => (b(a) | (b(a + 1) << 8) | (b(a + 2) << 16) | (b(a + 3) << 24)) >>> 0;
    const base = find([45, 49, 49, 45, 65, 65, 12, 3], 28);             // Bulbasaur is entry 1 of the base stats table
    const moves = find([0, 40, 0, 100, 35, 0], 12) || (prof.rom && prof.rom.battleMoves); // Pound is entry 1 of the moves table
    if (!base || !moves) return null;
    // items: entry 1 is MASTER BALL (44-byte entries)
    const items = find([0xC7, 0xBB, 0xCD, 0xCE, 0xBF, 0xCC, 0x00, 0xBC, 0xBB, 0xC6, 0xC6, 0xFF], 44);
    // level-up learnsets: a pointer table; Bulbasaur's list starts Tackle@1, Growl@4, Leech Seed@7, Vine Whip@10
    let learn = null;
    const bulbaSet = find([0x21, 0x02, 0x2D, 0x08, 0x49, 0x0E, 0x16, 0x14], 0, 2);
    if (bulbaSet) {
      const p = [bulbaSet & 255, (bulbaSet >> 8) & 255, (bulbaSet >> 16) & 255, bulbaSet >>> 24];
      const at = find(p, 0);
      if (at) learn = w(at + 4) === bulbaSet ? at : at - 4;               // entry 0 (no species) may also point at Bulbasaur's list
    }
    // evolutions: 5 × 8 bytes per species; Bulbasaur → Ivysaur at Lv 16
    const evos = find([4, 0, 16, 0, 2, 0, 0, 0], 40);
    const G3 = () => PkSave.codecs.find(c => c.id === "gen3")._internal;
    return {
      species(internal) {
        const a = base + internal * 28, ev = b(a + 10) | (b(a + 11) << 8);
        return { base: [0, 1, 2, 3, 4, 5].map(i => b(a + i)), types: [b(a + 6), b(a + 7)], expYield: b(a + 9),
          evYield: [0, 1, 2, 3, 4, 5].map(i => (ev >> (i * 2)) & 3), growth: b(a + 19), abilities: [b(a + 22), b(a + 23)] };
      },
      move(id) {
        const a = moves + id * 12, pr = b(a + 7);
        return { id, effect: b(a), power: b(a + 1), type: b(a + 2), acc: b(a + 3), pp: b(a + 4), chance: b(a + 5), prio: pr > 127 ? pr - 256 : pr,
          contact: (b(a + 8) & 1) === 1, name: (PkData.moves && PkData.moves[id]) || ("Move " + id) };
      },
      item(id) {
        if (!id) return null;
        if (!items) return { id, name: (PkData.items3 && PkData.items3[id]) || "Item", eff: 0, param: 0 };
        const a = items + id * 44;
        let name = ""; try { name = G3().getString(rom, a - ROM, 14, 2); } catch (e) {}
        const known = PkData.items3 && PkData.items3[id];                 // nicer capitalisation when the hack kept the name
        if (known && known.toUpperCase().replace(/[^A-Z]/g, "") === name.toUpperCase().replace(/[^A-Z]/g, "")) name = known;
        return { id, name: name || known || "Item", eff: b(a + 18), param: b(a + 19) };
      },
      learnset(internal) {
        if (!learn) return [];
        const out = []; let a = w(learn + internal * 4);
        if (a < ROM || a >= ROM + rom.length) return [];
        for (let k = 0; k < 64; k++, a += 2) { const v = h(a); if (v === 0xFFFF) break; out.push({ level: v >> 9, move: v & 0x1FF }); }
        return out;
      },
      evolutions(internal) {
        if (!evos) return [];
        const out = [];
        for (let k = 0; k < 5; k++) { const a = evos + internal * 40 + k * 8, method = h(a); if (method) out.push({ method, param: h(a + 2), target: h(a + 4) }); }
        return out;
      },
      has: { items: !!items, learn: !!learn, evos: !!evos },
    };
  }

  // ---------------- party structs in RAM ----------------
  const I = () => PkSave.codecs.find(c => c.id === "gen3")._internal;
  const u16 = (d, o) => d[o] | (d[o + 1] << 8);
  const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const w16 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >> 8) & 255; };
  const w32 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; };
  function boxChecksum(dec) { let c = 0; for (let i = 0x20; i < 0x50; i += 2) c = (c + u16(dec, i)) & 0xFFFF; return c; }

  function readSlot(i) { return mem.reader.bytes(mem.ram.party + i * 100, 100); }
  function writeSlot(i, raw) { const a = mem.ram.party + i * 100; for (let k = 0; k < 100; k++) mem.reader.w8(a + k, raw[k]); }
  // decrypted 80-byte box + the party-only tail → one easy object
  function parseRaw(raw) {
    const dec = I().decrypt3(raw.slice(0, 80));
    if (!dec || (dec[0x13] & 2) === 0) return null;
    const iv32 = u32(dec, 0x48);
    if ((iv32 >>> 30) & 1) return null;                                           // eggs don't battle
    if (boxChecksum(dec) !== u16(dec, 0x1C)) return null;
    return { raw, dec, pid: u32(dec, 0), internal: u16(dec, 0x20), exp: u32(dec, 0x24),
      moves: [0, 1, 2, 3].map(k => u16(dec, 0x2C + k * 2)), pp: [0, 1, 2, 3].map(k => dec[0x34 + k]),
      evs: [0, 1, 2, 3, 4, 5].map(k => dec[0x38 + k]), ivs: [0, 5, 10, 15, 20, 25].map(s => (iv32 >>> s) & 31),
      level: raw[0x54], hp: u16(raw, 0x56), stats: [0, 1, 2, 3, 4, 5].map(k => u16(raw, 0x58 + k * 2)) };
  }
  function packRaw(m) {   // m.dec edited → re-checksum, encrypt, combine with party tail
    w16(m.dec, 0x1C, boxChecksum(m.dec));
    const out = m.raw.slice(0, 100);
    out.set(I().encrypt3(m.dec), 0);
    return out;
  }
  function readParty() {
    const out = [];
    for (let i = 0; i < mem.partyCount(); i++) { const m = parseRaw(readSlot(i)); if (m) { m.slot = i; out.push(m); } }
    return out;
  }

  // Gen 3 stat formulas (stats order: HP, Atk, Def, Spe, SpA, SpD)
  function calcStats(internal, level, ivs, evs, pid) {
    const sp = tables.species(internal), n = pid % 25, up = Math.floor(n / 5) + 1, down = (n % 5) + 1;
    return [0, 1, 2, 3, 4, 5].map(i => {          // nature order (Atk, Def, Spe, SpA, SpD) matches stat indexes 1–5
      const core = Math.floor((2 * sp.base[i] + ivs[i] + Math.floor(evs[i] / 4)) * level / 100);
      if (i === 0) return I().toNational(internal) === 292 ? 1 : core + level + 10;
      let v = core + 5;
      if (up !== down) { if (i === up) v = Math.floor(v * 110 / 100); if (i === down) v = Math.floor(v * 90 / 100); }
      return v;
    });
  }
  function levelForExp(growth, exp) {
    const t = PkData.expTable[growth]; let L = 1;
    while (L < 100 && exp >= t[L]) L++;
    return L;
  }

  // Add EXP/EVs to the party member with this personality value, recompute level + stats. Returns a summary or null.
  function applyGain(g) {
    const party = readParty(), m = party.find(p => p.pid === g.pid);
    if (!m) return null;
    const sp = tables.species(m.internal), t = PkData.expTable[sp.growth];
    const exp = Math.min(t[99], m.exp + g.exp);
    const evs = m.evs.slice(); let total = evs.reduce((a, b) => a + b, 0);
    g.evs.forEach((v, i) => { const add = Math.max(0, Math.min(v, 255 - evs[i], 510 - total)); evs[i] += add; total += add; });
    const level = levelForExp(sp.growth, exp), stats = calcStats(m.internal, level, m.ivs, evs, m.pid);
    w32(m.dec, 0x24, exp); evs.forEach((v, i) => m.dec[0x38 + i] = v);
    const raw = packRaw(m);
    raw[0x54] = level;
    const hp = m.hp === 0 ? 0 : Math.max(1, m.hp + stats[0] - m.stats[0]);
    w16(raw, 0x56, Math.min(hp, stats[0]));
    stats.forEach((v, i) => w16(raw, 0x58 + i * 2, v));
    writeSlot(m.slot, raw);
    return { pid: g.pid, name: g.name, exp: g.exp, from: m.level, to: level };
  }

  // ---------------- badges ----------------
  function badgeCount() {
    if (!mem) return 0;
    const fam = mem.profile.family, f = BADGE_FLAG[fam === "E" ? "E" : "FRLG"], sb1 = mem.reader.u32(mem.ram.sb1Ptr);
    let n = 0;
    for (let k = 0; k < 8; k++) { const flag = f.first + k; if (mem.reader.u8(sb1 + f.flags + (flag >> 3)) & (1 << (flag & 7))) n++; }
    return n;
  }

  // ---------------- Rival rules: wild battles give nothing ----------------
  let wild = null, wasBattle = false;
  function lockTick() {
    if (!mem || !cfg.rules || !tables || battle) return;
    const inB = mem.inBattle();
    if (inB && !wasBattle) {
      wild = mem.isTrainerBattle() || (mem.reader.u32(mem.ram.battleTypeFlags) & 0x02) ? null : readParty();   // link/trainer battles count
    }
    wasBattle = inB;
    if (!inB && wild && mem.inOverworld()) {
      let undone = 0;
      for (const now of readParty()) {
        const before = wild.find(w => w.pid === now.pid);
        if (!before) continue;                                                     // newly caught: leave it alone
        const grew = now.exp !== before.exp || now.level !== before.level || now.internal !== before.internal || now.evs.some((v, i) => v !== before.evs[i]);
        if (!grew) continue;
        const keepPP = now.moves.every((mv, i) => mv === before.moves[i]);
        const back = { raw: before.raw.slice(0, 100), dec: before.dec.slice(0, 80) };
        if (keepPP) for (let k = 0; k < 4; k++) back.dec[0x34 + k] = now.dec[0x34 + k];      // PP used in the battle stays used
        back.dec[0x22] = now.dec[0x22]; back.dec[0x23] = now.dec[0x23];                       // held item (berries eaten etc.)
        const raw = packRaw(back);
        w32(raw, 0x50, u32(now.raw, 0x50));                                                    // status stays
        w16(raw, 0x56, Math.min(now.hp, before.stats[0]));                                     // damage taken stays
        writeSlot(now.slot, raw);
        undone++;
      }
      wild = null;
      if (undone) toast("Rival rules: wild Pokémon give no EXP. Your team is back to how it was.", 5000);
    }
  }

  // ---------------- versus battle engine (pure + seeded, so both phones get the same result) ----------------
  // Gen 3 rules: moves, abilities and held items. Held items work in versus battles but are never used up in your game.
  const CHART = (() => {
    const m = {}, set = (a, list, x) => list.forEach(d => m[a * 18 + d] = x);
    const [NOR, FIG, FLY, POI, GRO, ROC, BUG, GHO, STE, , FIR, WAT, GRA, ELE, PSY, ICE, DRA, DAR] = [...Array(18).keys()];
    set(NOR, [ROC, STE], .5); set(NOR, [GHO], 0);
    set(FIR, [FIR, WAT, ROC, DRA], .5); set(FIR, [GRA, ICE, BUG, STE], 2);
    set(WAT, [WAT, GRA, DRA], .5); set(WAT, [FIR, GRO, ROC], 2);
    set(ELE, [ELE, GRA, DRA], .5); set(ELE, [WAT, FLY], 2); set(ELE, [GRO], 0);
    set(GRA, [FIR, GRA, POI, FLY, BUG, DRA, STE], .5); set(GRA, [WAT, GRO, ROC], 2);
    set(ICE, [WAT, ICE, FIR, STE], .5); set(ICE, [GRA, GRO, FLY, DRA], 2);
    set(FIG, [POI, FLY, PSY, BUG], .5); set(FIG, [NOR, ICE, ROC, DAR, STE], 2); set(FIG, [GHO], 0);
    set(POI, [POI, GRO, ROC, GHO], .5); set(POI, [GRA], 2); set(POI, [STE], 0);
    set(GRO, [GRA, BUG], .5); set(GRO, [FIR, ELE, POI, ROC, STE], 2); set(GRO, [FLY], 0);
    set(FLY, [ELE, ROC, STE], .5); set(FLY, [GRA, FIG, BUG], 2);
    set(PSY, [PSY, STE], .5); set(PSY, [FIG, POI], 2); set(PSY, [DAR], 0);
    set(BUG, [FIR, FIG, POI, FLY, GHO, STE], .5); set(BUG, [GRA, PSY, DAR], 2);
    set(ROC, [FIG, GRO, STE], .5); set(ROC, [FIR, ICE, FLY, BUG], 2);
    set(GHO, [DAR, STE], .5); set(GHO, [PSY, GHO], 2); set(GHO, [NOR], 0);
    set(DRA, [STE], .5); set(DRA, [DRA], 2);
    set(DAR, [FIG, DAR, STE], .5); set(DAR, [PSY, GHO], 2);
    set(STE, [FIR, WAT, ELE, STE], .5); set(STE, [ICE, ROC], 2);
    return (a, defTypes) => [...new Set(defTypes)].reduce((x, d) => x * (m[a * 18 + d] ?? 1), 1);
  })();
  const STRUGGLE = { id: 165, name: "Struggle", effect: 48, power: 50, type: 9, acc: 0, pp: 1, chance: 0, prio: 0, contact: true };
  const ACC_MUL = [33, 36, 43, 50, 60, 75, 100, 133, 166, 200, 233, 266, 300];
  const CRIT = [16, 8, 4, 3, 2];
  const stageMul = (s) => s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
  const STAT_NAMES = ["Attack", "Defense", "Speed", "Sp. Atk", "Sp. Def", "accuracy", "evasiveness"];
  const SOUND = new Set([45, 46, 47, 48, 103, 173, 195, 215, 253, 304, 319, 320]);
  // ability ids (Gen 3)
  const A = { DRIZZLE: 2, SPEED_BOOST: 3, BATTLE_ARMOR: 4, STURDY: 5, DAMP: 6, LIMBER: 7, SAND_VEIL: 8, STATIC: 9, VOLT_ABSORB: 10, WATER_ABSORB: 11,
    CLOUD_NINE: 13, COMPOUND_EYES: 14, INSOMNIA: 15, COLOR_CHANGE: 16, IMMUNITY: 17, FLASH_FIRE: 18, SHIELD_DUST: 19, INTIMIDATE: 22, SHADOW_TAG: 23,
    ROUGH_SKIN: 24, WONDER_GUARD: 25, LEVITATE: 26, EFFECT_SPORE: 27, SYNCHRONIZE: 28, CLEAR_BODY: 29, NATURAL_CURE: 30, SERENE_GRACE: 32, SWIFT_SWIM: 33,
    CHLOROPHYLL: 34, TRACE: 36, HUGE_POWER: 37, POISON_POINT: 38, INNER_FOCUS: 39, MAGMA_ARMOR: 40, WATER_VEIL: 41, MAGNET_PULL: 42, SOUNDPROOF: 43,
    RAIN_DISH: 44, SAND_STREAM: 45, PRESSURE: 46, THICK_FAT: 47, EARLY_BIRD: 48, FLAME_BODY: 49, KEEN_EYE: 51, HYPER_CUTTER: 52, TRUANT: 54, HUSTLE: 55,
    SHED_SKIN: 61, GUTS: 62, MARVEL_SCALE: 63, LIQUID_OOZE: 64, OVERGROW: 65, BLAZE: 66, TORRENT: 67, SWARM: 68, ROCK_HEAD: 69, DROUGHT: 70,
    ARENA_TRAP: 71, VITAL_SPIRIT: 72, WHITE_SMOKE: 73, PURE_POWER: 74, SHELL_ARMOR: 75, AIR_LOCK: 77 };
  // held item effects (Gen 3 hold effect ids, read from the ROM's item table)
  const H_ = { RESTORE_HP: 1, CURE_PAR: 2, CURE_SLP: 3, CURE_PSN: 4, CURE_BRN: 5, CURE_FRZ: 6, RESTORE_PP: 7, CURE_STATUS: 9, CONFUSE_FIRST: 10, CONFUSE_LAST: 14,
    PINCH_FIRST: 15, PINCH_LAST: 19, CRIT_UP: 20, RANDOM_UP: 21, EVASION_UP: 22, WHITE_HERB: 23, QUICK_CLAW: 26, CHOICE_BAND: 29, KINGS_ROCK: 30,
    BUG_POWER: 31, SOUL_DEW: 34, DEEP_SEA_TOOTH: 35, DEEP_SEA_SCALE: 36, FOCUS_BAND: 39, SCOPE_LENS: 41, STEEL_POWER: 42, LEFTOVERS: 43, LIGHT_BALL: 45,
    SHELL_BELL: 62, LUCKY_PUNCH: 63, METAL_POWDER: 64, THICK_CLUB: 65, STICK: 66 };
  const POWER_ITEM_TYPE = { 31: 6, 42: 8, 46: 4, 47: 5, 48: 12, 49: 17, 50: 1, 51: 13, 52: 11, 53: 2, 54: 3, 55: 15, 56: 7, 57: 14, 58: 10, 59: 16, 60: 0 };
  const abilityName = (id) => (PkData.abilities && PkData.abilities[id]) || "its ability";

  function rng32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function newBattle(parties, names, seed) {
    const S = {
      rnd: rng32(seed), step: 0, phase: "turn", over: false, winner: null, need: [true, true], log: [], kos: [], weather: null,
      sides: parties.map((p, si) => ({ name: names[si], active: 0, mons: p.map(m => ({ ...m, ab: m.ability || 0, typesNow: m.types.slice(), hp: m.stats[0], pp: m.moves.map(mv => mv.pp),
        stages: [0, 0, 0, 0, 0, 0, 0], status: null, sleep: 0, seen: {}, itemUsed: false, critUp: 0 })) })),
    };
    S.log = [];
    say(S, `${names[0]} sent out ${act(S, 0).name}! ${names[1]} sent out ${act(S, 1).name}!`);
    meet(S);
    const first = effSpe(S, act(S, 1)) > effSpe(S, act(S, 0)) ? 1 : 0;
    entry(S, first); entry(S, 1 - first);
    return S;
  }
  const act = (S, si) => S.sides[si].mons[S.sides[si].active];
  const R = (S, n) => Math.floor(S.rnd() * n);
  const holds = (m, eff) => m.item && m.item.eff === eff && !m.itemUsed;
  function meet(S) { [0, 1].forEach(si => { act(S, 1 - si).seen[S.sides[si].active] = true; }); }   // who fought whom (for EXP sharing)
  function say(S, text) { S.log.push({ text, view: [0, 1].map(si => { const m = act(S, si); return { i: S.sides[si].active, hp: m.hp, status: m.status }; }) }); }
  function weather(S) { return [0, 1].some(si => [A.CLOUD_NINE, A.AIR_LOCK].includes(act(S, si).ab)) ? null : S.weather && S.weather.type; }
  function setWeather(S, type, turns, why) {
    if (S.weather && S.weather.type === type) { if (!why) say(S, "But it failed!"); return; }
    S.weather = { type, turns };
    say(S, (why ? why + " " : "") + { rain: "It started to rain!", sun: "The sunlight turned harsh!", sand: "A sandstorm brewed!", hail: "It started to hail!" }[type]);
  }
  function effSpe(S, m) {
    let v = Math.floor(m.stats[3] * stageMul(m.stages[2]));
    const w = weather(S);
    if ((m.ab === A.SWIFT_SWIM && w === "rain") || (m.ab === A.CHLOROPHYLL && w === "sun")) v *= 2;
    if (m.status === "par") v = Math.floor(v / 4);
    return v;
  }
  function entry(S, si) {           // abilities that act when a Pokémon comes in
    const m = act(S, si), foe = act(S, 1 - si);
    if (m.hp <= 0) return;
    if (m.ab === A.TRACE && foe.ab && foe.ab !== A.TRACE) { m.ab = foe.ab; say(S, `${m.name} traced ${foe.name}'s ${abilityName(foe.ab)}!`); }
    if (m.ab === A.INTIMIDATE && foe.hp > 0) { say(S, `${m.name}'s Intimidate cuts ${foe.name}'s Attack!`); lower(S, foe, 0, -1, true); }
    if (m.ab === A.DRIZZLE) setWeather(S, "rain", Infinity, `${m.name}'s Drizzle:`);
    if (m.ab === A.DROUGHT) setWeather(S, "sun", Infinity, `${m.name}'s Drought:`);
    if (m.ab === A.SAND_STREAM) setWeather(S, "sand", Infinity, `${m.name}'s Sand Stream:`);
  }
  // stat change; byFoe = caused by the other side (abilities can block it)
  function lower(S, m, k, by, byFoe) {
    if (by < 0 && byFoe) {
      if (m.ab === A.CLEAR_BODY || m.ab === A.WHITE_SMOKE) return say(S, `${m.name}'s ${abilityName(m.ab)} prevents stat loss!`);
      if (m.ab === A.HYPER_CUTTER && k === 0) return say(S, `${m.name}'s Hyper Cutter prevents Attack loss!`);
      if (m.ab === A.KEEN_EYE && k === 5) return say(S, `${m.name}'s Keen Eye prevents accuracy loss!`);
    }
    const old = m.stages[k]; m.stages[k] = Math.max(-6, Math.min(6, old + by));
    if (old === m.stages[k]) return say(S, `${m.name}'s ${STAT_NAMES[k]} won't go any ${by > 0 ? "higher" : "lower"}!`);
    say(S, `${m.name}'s ${STAT_NAMES[k]} ${by > 0 ? "rose" : "fell"}${Math.abs(by) > 1 ? " sharply" : ""}!`);
    if (by < 0 && holds(m, H_.WHITE_HERB)) { m.stages = m.stages.map(s => Math.max(0, s)); m.itemUsed = true; say(S, `${m.name}'s White Herb restored its stats!`); }
  }
  const STATUS_TEXT = { psn: "was poisoned", brn: "was burned", frz: "was frozen solid", par: "is paralyzed", slp: "fell asleep" };
  function canStatus(S, m, s) {
    if (m.status || m.hp <= 0) return false;
    const t = m.typesNow;
    if (s === "psn" && (t.includes(3) || t.includes(8) || m.ab === A.IMMUNITY)) return false;
    if (s === "brn" && (t.includes(10) || m.ab === A.WATER_VEIL)) return false;
    if (s === "frz" && (t.includes(15) || m.ab === A.MAGMA_ARMOR || weather(S) === "sun")) return false;
    if (s === "par" && m.ab === A.LIMBER) return false;
    if (s === "slp" && (m.ab === A.INSOMNIA || m.ab === A.VITAL_SPIRIT)) return false;
    return true;
  }
  function inflict(S, m, s, src) {
    if (!canStatus(S, m, s)) return false;
    m.status = s; if (s === "slp") m.sleep = 2 + R(S, 4);
    say(S, `${m.name} ${STATUS_TEXT[s]}!`);
    if (src && src !== m && m.ab === A.SYNCHRONIZE && ["psn", "brn", "par"].includes(s) && canStatus(S, src, s)) { say(S, `${m.name}'s Synchronize!`); inflict(S, src, s, null); }
    berryCheck(S, m);
    return true;
  }
  // berries and other one-use items
  function berryCheck(S, m) {
    if (!m.item || m.itemUsed || m.hp <= 0) return;
    const e = m.item.eff, nm = m.item.name, max = m.stats[0];
    const cure = { [H_.CURE_PAR]: "par", [H_.CURE_SLP]: "slp", [H_.CURE_PSN]: "psn", [H_.CURE_BRN]: "brn", [H_.CURE_FRZ]: "frz" }[e];
    if (m.status && (cure === m.status || e === H_.CURE_STATUS)) { m.status = null; m.itemUsed = true; return say(S, `${m.name}'s ${nm} cured it!`); }
    if (e === H_.RESTORE_HP && m.hp <= max / 2) { m.hp = Math.min(max, m.hp + m.item.param); m.itemUsed = true; return say(S, `${m.name}'s ${nm} restored its HP!`); }
    if (e >= H_.CONFUSE_FIRST && e <= H_.CONFUSE_LAST && m.hp <= max / 2) { m.hp = Math.min(max, m.hp + Math.max(1, Math.floor(max / 8))); m.itemUsed = true; return say(S, `${m.name}'s ${nm} restored its HP!`); }
    const pinch = m.hp <= max / Math.max(1, m.item.param || 4);
    if (e >= H_.PINCH_FIRST && e <= H_.PINCH_LAST && pinch) { m.itemUsed = true; say(S, `${m.name} ate its ${nm}!`); return lower(S, m, e - H_.PINCH_FIRST, 1, false); }
    if (e === H_.CRIT_UP && pinch) { m.itemUsed = true; m.critUp = 2; return say(S, `${m.name} ate its ${nm} and is getting pumped!`); }
    if (e === H_.RANDOM_UP && pinch) { m.itemUsed = true; say(S, `${m.name} ate its ${nm}!`); return lower(S, m, R(S, 5), 2, false); }
  }
  function canSwitch(S, si) {
    const me = act(S, si), foe = act(S, 1 - si);
    if (foe.hp <= 0) return true;
    if (foe.ab === A.SHADOW_TAG) return false;
    if (foe.ab === A.ARENA_TRAP && !me.typesNow.includes(2) && me.ab !== A.LEVITATE) return false;
    if (foe.ab === A.MAGNET_PULL && me.typesNow.includes(8)) return false;
    return true;
  }
  function switchOut(S, si) {
    const m = act(S, si);
    if (m.ab === A.NATURAL_CURE && m.status) m.status = null;
    m.stages = [0, 0, 0, 0, 0, 0, 0]; m.flinch = false; m.choice = null; m.ab = m.ability || 0; m.typesNow = m.types.slice(); m.flash = false; m.loaf = false;
  }

  function damage(S, a, d, mv, crit) {
    const phys = mv.type < 9, w = weather(S);
    let as = a.stages[phys ? 0 : 3], ds = d.stages[phys ? 1 : 4];
    if (crit) { as = Math.max(0, as); ds = Math.min(0, ds); }
    let atk = Math.floor(a.stats[phys ? 1 : 4] * stageMul(as)), def = Math.floor(d.stats[phys ? 2 : 5] * stageMul(ds));
    const item = (m, eff) => m.item && m.item.eff === eff;
    if (phys) {
      if (a.ab === A.HUGE_POWER || a.ab === A.PURE_POWER) atk *= 2;
      if (a.ab === A.HUSTLE) atk = Math.floor(atk * 1.5);
      if (a.ab === A.GUTS && a.status) atk = Math.floor(atk * 1.5);
      if (item(a, H_.CHOICE_BAND)) atk = Math.floor(atk * 1.5);
      if (item(a, H_.THICK_CLUB) && (a.nat === 104 || a.nat === 105)) atk *= 2;
      if (d.ab === A.MARVEL_SCALE && d.status) def = Math.floor(def * 1.5);
      if (item(d, H_.METAL_POWDER) && d.nat === 132) def *= 2;
    } else {
      if (item(a, H_.LIGHT_BALL) && a.nat === 25) atk *= 2;
      if (item(a, H_.DEEP_SEA_TOOTH) && a.nat === 366) atk *= 2;
      if (item(a, H_.SOUL_DEW) && (a.nat === 380 || a.nat === 381)) atk = Math.floor(atk * 1.5);
      if (item(d, H_.DEEP_SEA_SCALE) && d.nat === 366) def *= 2;
      if (item(d, H_.SOUL_DEW) && (d.nat === 380 || d.nat === 381)) def = Math.floor(def * 1.5);
    }
    if (d.ab === A.THICK_FAT && (mv.type === 10 || mv.type === 15)) atk = Math.floor(atk / 2);
    if (mv.effect === 7) def = Math.max(1, Math.floor(def / 2));
    let power = mv.power === 1 ? 60 : mv.power;
    if (a.item && POWER_ITEM_TYPE[a.item.eff] === mv.type) power = Math.floor(power * (100 + (a.item.param || 10)) / 100);
    const pinchAb = { [A.OVERGROW]: 12, [A.BLAZE]: 10, [A.TORRENT]: 11, [A.SWARM]: 6 }[a.ab];
    if (pinchAb === mv.type && a.hp <= Math.floor(a.stats[0] / 3)) power = Math.floor(power * 1.5);
    if (a.flash && mv.type === 10) power = Math.floor(power * 1.5);
    let dmg = Math.floor(Math.floor(Math.floor(2 * a.level / 5 + 2) * power * atk / Math.max(1, def)) / 50);
    if (phys && a.status === "brn" && a.ab !== A.GUTS) dmg = Math.floor(dmg / 2);
    if (w === "rain") { if (mv.type === 11) dmg = Math.floor(dmg * 1.5); if (mv.type === 10) dmg = Math.floor(dmg / 2); }
    if (w === "sun") { if (mv.type === 10) dmg = Math.floor(dmg * 1.5); if (mv.type === 11) dmg = Math.floor(dmg / 2); }
    dmg += 2;
    if (crit) dmg *= 2;
    if (mv.type !== 9 && a.typesNow.includes(mv.type)) dmg = Math.floor(dmg * 15 / 10);
    const eff = mv.type === 9 ? 1 : CHART(mv.type, d.typesNow);
    dmg = Math.floor(dmg * eff);
    dmg = Math.floor(dmg * (85 + R(S, 16)) / 100);
    return { dmg: eff > 0 ? Math.max(1, dmg) : 0, eff };
  }

  // Abilities that make the target immune to a move. Returns true if the move was absorbed.
  function absorbed(S, a, d, mv) {
    if (mv.type === 13 && d.ab === A.VOLT_ABSORB || mv.type === 11 && d.ab === A.WATER_ABSORB) {
      if (d.hp < d.stats[0]) { d.hp = Math.min(d.stats[0], d.hp + Math.floor(d.stats[0] / 4)); say(S, `${d.name}'s ${abilityName(d.ab)} restored its HP!`); }
      else say(S, `${d.name}'s ${abilityName(d.ab)} made ${mv.name} useless!`);
      return true;
    }
    if (mv.type === 10 && d.ab === A.FLASH_FIRE && d.status !== "frz") { d.flash = true; say(S, `${d.name}'s Flash Fire raised its Fire power!`); return true; }
    if (mv.type === 4 && d.ab === A.LEVITATE && mv.power > 0) { say(S, `${d.name} makes Ground moves miss with Levitate!`); return true; }
    if (SOUND.has(mv.id) && d.ab === A.SOUNDPROOF) { say(S, `${d.name}'s Soundproof blocks ${mv.name}!`); return true; }
    return false;
  }

  function useMove(S, si, mv, movedFirst, slot) {
    const a = act(S, si), d = act(S, 1 - si), ef = mv.effect;
    if (a.ab === A.TRUANT && a.loaf) { a.loaf = false; return say(S, `${a.name} is loafing around!`); }
    if (a.status === "slp") { a.sleep -= a.ab === A.EARLY_BIRD ? 2 : 1; if (a.sleep > 0) return say(S, `${a.name} is fast asleep.`); a.status = null; say(S, `${a.name} woke up!`); }
    if (a.status === "frz") { if (R(S, 5) === 0) { a.status = null; say(S, `${a.name} thawed out!`); } else return say(S, `${a.name} is frozen solid!`); }
    if (a.status === "par" && R(S, 4) === 0) return say(S, `${a.name} is paralyzed! It can't move!`);
    if (a.flinch) { a.flinch = false; return say(S, `${a.name} flinched!`); }
    if (a.ab === A.TRUANT) a.loaf = true;
    // PP (Pressure costs one more)
    if (slot >= 0) {
      a.pp[slot] = Math.max(0, a.pp[slot] - (d.ab === A.PRESSURE ? 2 : 1));
      if (a.pp[slot] === 0 && holds(a, H_.RESTORE_PP)) { a.pp[slot] = Math.min(mv.pp, a.item.param || 10); a.itemUsed = true; say(S, `${a.name}'s ${a.item.name} restored ${mv.name}'s PP!`); }
      if (holds(a, H_.CHOICE_BAND)) a.choice = slot;
    }
    say(S, `${a.name} used ${mv.name}!`);
    const selfMove = [10, 11, 12, 13, 14, 15, 16, 50, 51, 52, 53, 54, 55, 56, 32, 37, 115, 136, 137, 164].includes(ef);
    if (ef === 7 && [a, d].some(m => m.ab === A.DAMP)) return say(S, `${[a, d].find(m => m.ab === A.DAMP).name}'s Damp prevents ${mv.name}!`);
    // accuracy
    if (!selfMove && mv.acc && ef !== 38) {
      const stage = Math.max(-6, Math.min(6, a.stages[5] - d.stages[6]));
      let acc = mv.acc * ACC_MUL[stage + 6] / 100;
      if (a.ab === A.COMPOUND_EYES) acc = acc * 130 / 100;
      if (a.ab === A.HUSTLE && mv.type < 9) acc = acc * 80 / 100;
      if (d.ab === A.SAND_VEIL && weather(S) === "sand") acc = acc * 80 / 100;
      if (d.item && d.item.eff === H_.EVASION_UP) acc = acc * (100 - (d.item.param || 10)) / 100;
      if (R(S, 100) >= acc) { say(S, `${a.name}'s attack missed!`); if (ef === 7) { a.hp = 0; say(S, `${a.name} fainted!`); } return; }
    }
    if (!selfMove && absorbed(S, a, d, mv)) return;
    const typeEff = mv.type === 9 ? 1 : CHART(mv.type, d.typesNow);
    // status-only moves
    if (mv.power === 0) {
      const up = { 10: 0, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6 }, up2 = { 50: 0, 51: 1, 52: 2, 53: 3, 54: 4, 55: 5, 56: 6 };
      const dn = { 18: 0, 19: 1, 20: 2, 21: 3, 22: 4, 23: 5, 24: 6 }, dn2 = { 58: 0, 59: 1, 60: 2, 61: 3, 62: 4, 63: 5, 64: 6 };
      if (ef in up) return lower(S, a, up[ef], 1, false);
      if (ef in up2) return lower(S, a, up2[ef], 2, false);
      if (ef in dn) return lower(S, d, dn[ef], -1, true);
      if (ef in dn2) return lower(S, d, dn2[ef], -2, true);
      if (ef === 32) { if (a.hp === a.stats[0]) return say(S, `${a.name}'s HP is full!`); a.hp = Math.min(a.stats[0], a.hp + Math.floor(a.stats[0] / 2)); return say(S, `${a.name} regained health!`); }
      if (ef === 37) { if (a.ab === A.INSOMNIA || a.ab === A.VITAL_SPIRIT) return say(S, "But it failed!"); a.hp = a.stats[0]; a.status = "slp"; a.sleep = 3; return say(S, `${a.name} slept and became healthy!`); }
      const wx = { 136: "rain", 137: "sun", 115: "sand", 164: "hail" }[ef];
      if (wx) return setWeather(S, wx, 5);
      const st = { 1: "slp", 66: "psn", 33: "psn", 67: "par", 167: "brn" }[ef];
      if (st) { if (typeEff === 0 || !inflict(S, d, st, a)) say(S, "But it failed!"); return; }
      return say(S, "But nothing happened. (This move doesn't work in versus battles yet.)");
    }
    if (typeEff === 0) return say(S, `It doesn't affect ${d.name}…`);
    if (d.ab === A.WONDER_GUARD && typeEff <= 1 && mv.type !== 9) return say(S, `${d.name} avoided damage with Wonder Guard!`);
    if (ef === 8 && d.status !== "slp") return say(S, `${d.name} wasn't affected!`);
    const fixed = { 40: Math.max(1, Math.floor(d.hp / 2)), 41: 40, 130: 20, 87: a.level }[ef];
    let total = 0, eff = 1, hits = 1, n = 0;
    const hurt = (amount) => {   // apply damage to the target, with Focus Band
      let dealt = Math.min(d.hp, amount);
      if (dealt >= d.hp && d.item && d.item.eff === H_.FOCUS_BAND && R(S, 100) < (d.item.param || 10)) { dealt = d.hp - 1; d.hung = true; }
      d.hp -= dealt; total += dealt;
    };
    if (ef === 38) {
      if (d.ab === A.STURDY) return say(S, `${d.name} was protected by Sturdy!`);
      if (a.level < d.level || R(S, 100) >= 30 + a.level - d.level) return say(S, `${a.name}'s attack missed!`);
      hurt(d.hp); if (d.hp <= 0) say(S, "It's a one-hit KO!");
    } else if (fixed !== undefined) hurt(fixed);
    else {
      hits = ef === 29 ? [2, 2, 2, 3, 3, 3, 4, 5][R(S, 8)] : ef === 44 ? 2 : 1;
      const noCrit = d.ab === A.BATTLE_ARMOR || d.ab === A.SHELL_ARMOR;
      for (; n < hits && d.hp > 0; n++) {
        let stage = (ef === 43 ? 1 : 0) + a.critUp + (a.item && a.item.eff === H_.SCOPE_LENS ? 1 : 0)
          + (a.item && a.item.eff === H_.LUCKY_PUNCH && a.nat === 113 ? 2 : 0) + (a.item && a.item.eff === H_.STICK && a.nat === 83 ? 2 : 0);
        const crit = !noCrit && R(S, CRIT[Math.min(4, stage)]) === 0;
        const r = damage(S, a, d, mv, crit); eff = r.eff;
        hurt(r.dmg);
        if (crit) say(S, "A critical hit!");
      }
      if (hits > 1) say(S, `Hit ${n} time(s)!`);
    }
    if (eff > 1) say(S, "It's super effective!"); else if (eff < 1) say(S, "It's not very effective…");
    else say(S, `${d.name} took ${total} damage.`);
    if (d.hung) { d.hung = false; say(S, `${d.name} hung on using its ${d.item.name}!`); }
    // after the hit
    if (ef === 3 || ef === 8) {
      const hgain = Math.max(1, Math.floor(total / 2));
      if (d.ab === A.LIQUID_OOZE) { a.hp = Math.max(0, a.hp - hgain); say(S, `${a.name} sucked up the liquid ooze!`); }
      else { a.hp = Math.min(a.stats[0], a.hp + hgain); say(S, `${d.name} had its energy drained!`); }
    }
    if (ef === 48 && total && a.ab !== A.ROCK_HEAD) { a.hp = Math.max(0, a.hp - Math.max(1, Math.floor(total / 4))); say(S, `${a.name} is hit with recoil!`); }
    if (ef === 7) a.hp = 0;
    if (total && a.hp > 0 && a.item && a.item.eff === H_.SHELL_BELL) { const h = Math.max(1, Math.floor(total / (a.item.param || 8))); if (a.hp < a.stats[0]) { a.hp = Math.min(a.stats[0], a.hp + h); say(S, `${a.name} restored a little HP using its Shell Bell!`); } }
    if (total && d.hp > 0 && d.ab === A.COLOR_CHANGE && mv.type !== 9 && !d.typesNow.every(t => t === mv.type)) { d.typesNow = [mv.type, mv.type]; say(S, `${d.name}'s Color Change made it the ${TYPE_NAMES[mv.type]} type!`); }
    // contact abilities
    if (total && mv.contact && a.hp > 0) {
      if (d.ab === A.ROUGH_SKIN) { a.hp = Math.max(0, a.hp - Math.max(1, Math.floor(a.stats[0] / 16))); say(S, `${a.name} was hurt by ${d.name}'s Rough Skin!`); }
      const cs = { [A.STATIC]: "par", [A.FLAME_BODY]: "brn", [A.POISON_POINT]: "psn" }[d.ab];
      if (cs && R(S, 3) === 0 && canStatus(S, a, cs)) { say(S, `${d.name}'s ${abilityName(d.ab)}!`); inflict(S, a, cs, d); }
      if (d.ab === A.EFFECT_SPORE && R(S, 10) === 0) { const es = ["psn", "par", "slp"][R(S, 3)]; if (canStatus(S, a, es)) { say(S, `${d.name}'s Effect Spore!`); inflict(S, a, es, d); } }
    }
    // side effects of the move
    const chance = Math.min(100, (mv.chance || 0) * (a.ab === A.SERENE_GRACE ? 2 : 1));
    if (d.hp > 0 && chance && d.ab !== A.SHIELD_DUST && R(S, 100) < chance) {
      const st = { 2: "psn", 4: "brn", 5: "frz", 6: "par" }[ef];
      if (st) inflict(S, d, st, a);
      if (ef === 31 && movedFirst && d.ab !== A.INNER_FOCUS) d.flinch = true;
    }
    if (ef !== 31 && total && d.hp > 0 && movedFirst && a.item && a.item.eff === H_.KINGS_ROCK && d.ab !== A.INNER_FOCUS && R(S, 100) < (a.item.param || 10)) d.flinch = true;
    berryCheck(S, d); berryCheck(S, a);
    if (d.hp <= 0) say(S, `${d.name} fainted!`);
    if (a.hp <= 0) say(S, `${a.name} fainted!`);
  }

  function anyLeft(side) { return side.mons.some(m => m.hp > 0); }
  function moveFor(S, si, a) {
    const m = act(S, si);
    if (a.move === -1) return { mv: STRUGGLE, slot: -1 };
    const slot = m.choice != null && m.pp[m.choice] > 0 ? m.choice : a.move;   // Choice Band locks the first move
    return { mv: m.moves[slot], slot };
  }

  // Apply one step: acts[si] for every side in S.need. Mutates S.
  function resolve(S, acts) {
    S.log = [];
    const need = S.need;
    if (S.phase === "turn") {
      for (const si of [0, 1]) if (acts[si].forfeit) { S.over = true; S.winner = 1 - si; say(S, `${S.sides[si].name} gave up!`); return finish(S); }
      const swOrder = [0, 1].filter(si => acts[si].sw != null);
      for (const si of swOrder) {
        if (!canSwitch(S, si)) { say(S, `${act(S, si).name} can't escape!`); acts[si] = { move: firstUsable(act(S, si)) }; continue; }
        const side = S.sides[si], old = act(S, si); switchOut(S, si);
        side.active = acts[si].sw; say(S, `${side.name} withdrew ${old.name} and sent out ${act(S, si).name}!`); meet(S); entry(S, si);
      }
      const movers = [0, 1].filter(si => acts[si].move != null).map(si => ({ si, ...moveFor(S, si, acts[si]), quick: false }));
      movers.forEach(x => { const m = act(S, x.si); x.quick = !!(m.item && m.item.eff === H_.QUICK_CLAW && R(S, 100) < (m.item.param || 20)); x.spe = effSpe(S, m); });
      const tie = R(S, 2);
      movers.sort((x, y) => (y.mv.prio - x.mv.prio) || ((y.quick ? 1 : 0) - (x.quick ? 1 : 0)) || (y.spe - x.spe) || (tie ? 1 : -1));
      movers.forEach((x, k) => {
        if (act(S, x.si).hp <= 0 || act(S, 1 - x.si).hp <= 0) return;
        useMove(S, x.si, x.mv, k === 0, x.slot);
      });
      [0, 1].forEach(si => act(S, si).flinch = false);
      endOfTurn(S);
    } else { // replacements after a faint
      for (const si of [0, 1]) if (need[si]) {
        if (acts[si].forfeit) { S.over = true; S.winner = 1 - si; say(S, `${S.sides[si].name} gave up!`); return finish(S); }
        switchOut(S, si); S.sides[si].active = acts[si].rep; say(S, `${S.sides[si].name} sent out ${act(S, si).name}!`);
      }
      meet(S);
      for (const si of [0, 1]) if (need[si]) entry(S, si);
    }
    // faints
    S.need = [false, false];
    for (const si of [0, 1]) {
      const m = act(S, si);
      if (m.hp <= 0 && !m.counted) { m.counted = true; m.status = null; S.kos.push({ side: si, idx: S.sides[si].active, seen: Object.keys(m.seen).map(Number) }); }
    }
    const left = [0, 1].map(si => anyLeft(S.sides[si]));
    if (!left[0] || !left[1]) { S.over = true; S.winner = left[0] ? 0 : left[1] ? 1 : null; return finish(S); }
    for (const si of [0, 1]) if (act(S, si).hp <= 0) S.need[si] = true;
    S.phase = S.need[0] || S.need[1] ? "rep" : "turn";
    if (S.phase === "turn") S.need = [true, true];
    S.step++;
  }
  function firstUsable(m) { const i = m.pp.findIndex(p => p > 0); return i < 0 ? -1 : i; }
  function endOfTurn(S) {
    const w = weather(S);
    if (S.weather) {
      if (S.weather.turns !== Infinity && --S.weather.turns <= 0) { say(S, { rain: "The rain stopped.", sun: "The sunlight faded.", sand: "The sandstorm subsided.", hail: "The hail stopped." }[S.weather.type]); S.weather = null; }
      else if (w === "sand" || w === "hail") {
        for (const si of [0, 1]) {
          const m = act(S, si), t = m.typesNow;
          if (m.hp <= 0) continue;
          if (w === "sand" && (t.includes(4) || t.includes(5) || t.includes(8) || m.ab === A.SAND_VEIL)) continue;
          if (w === "hail" && t.includes(15)) continue;
          m.hp = Math.max(0, m.hp - Math.max(1, Math.floor(m.stats[0] / 16))); say(S, `${m.name} is buffeted by the ${w === "sand" ? "sandstorm" : "hail"}!`);
          if (m.hp <= 0) say(S, `${m.name} fainted!`);
        }
      }
    }
    for (const si of [0, 1]) {
      const m = act(S, si);
      if (m.hp <= 0) continue;
      if (m.ab === A.RAIN_DISH && w === "rain" && m.hp < m.stats[0]) { m.hp = Math.min(m.stats[0], m.hp + Math.max(1, Math.floor(m.stats[0] / 16))); say(S, `${m.name}'s Rain Dish restored its HP!`); }
      if (m.item && m.item.eff === H_.LEFTOVERS && m.hp < m.stats[0]) { m.hp = Math.min(m.stats[0], m.hp + Math.max(1, Math.floor(m.stats[0] / 16))); say(S, `${m.name} restored a little HP using its Leftovers!`); }
      if (m.status === "psn" || m.status === "brn") { m.hp = Math.max(0, m.hp - Math.max(1, Math.floor(m.stats[0] / 8))); say(S, `${m.name} is hurt by its ${m.status === "psn" ? "poison" : "burn"}!`); if (m.hp <= 0) { say(S, `${m.name} fainted!`); continue; } }
      if (m.ab === A.SHED_SKIN && m.status && R(S, 3) === 0) { m.status = null; say(S, `${m.name} shed its skin and cured its status!`); }
      if (m.ab === A.SPEED_BOOST && m.stages[2] < 6) { m.stages[2]++; say(S, `${m.name}'s Speed Boost raised its Speed!`); }
      berryCheck(S, m);
    }
  }
  function finish(S) { S.need = [false, false]; S.step++; say(S, S.winner == null ? "It's a draw!" : `${S.sides[S.winner].name} won the battle!`); }

  // What side `si` earned: Gen 3 trainer-battle EXP shared among Pokémon that fought each KO'd foe, plus that foe's EVs.
  function gainsFor(S, si) {
    const mine = S.sides[si].mons, out = new Map();
    for (const k of S.kos) {
      if (k.side === si) continue;
      const foe = S.sides[k.side].mons[k.idx], share = k.seen.filter(i => mine[i] && mine[i].hp > 0);
      if (!share.length) continue;
      const exp = Math.max(1, Math.floor(Math.floor(Math.floor(foe.expYield * foe.level / 7) / share.length) * 3 / 2));
      for (const i of share) {
        const g = out.get(i) || { pid: mine[i].pid, name: mine[i].name, exp: 0, evs: [0, 0, 0, 0, 0, 0] };
        g.exp += exp; foe.evYield.forEach((v, j) => g.evs[j] += v);
        out.set(i, g);
      }
    }
    return [...out.values()];
  }
  function stateHash(S) {
    let h = 2166136261; const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619); };
    for (const s of S.sides) { mix(s.active); for (const m of s.mons) { mix(m.hp); m.pp.forEach(mix); m.stages.forEach(mix); mix(m.status ? m.status.charCodeAt(0) : 0); mix(m.itemUsed ? 1 : 0); } }
    return (h >>> 0).toString(36) + S.step;
  }

  // ---------------- battle data for my party ----------------
  function myBattleParty() {
    return readParty().slice(0, 6).map(m => {
      const n = I().toNeutral(m.dec), nat = I().toNational(m.internal), sp = tables.species(m.internal);
      const name = (n.isNicknamed && n.nickname) || ((PkData.species[nat] || {}).name) || "???";
      const calc = calcStats(m.internal, m.level, m.ivs, m.evs, m.pid);
      const abil = sp.abilities[(u32(m.dec, 0x48) >>> 31) && sp.abilities[1] ? 1 : 0] || 0;
      return { pid: m.pid, name, nat, level: m.level, stats: m.stats.map((v, i) => v || calc[i]),
        types: sp.types, expYield: sp.expYield, evYield: sp.evYield, ability: abil, item: tables.item(u16(m.dec, 0x22)),
        moves: m.moves.filter(Boolean).map(id => tables.move(id)) };
    }).filter(m => m.moves.length);
  }

  // ---------------- networking (through Play together) ----------------
  let battle = null; // { id, foeId, foeName, me: 0|1, S, acts: {}, myAct }
  function send(msg) { G() && G().send(msg); }
  function myId() { return G() && G().me() && G().me().id; }
  function onMsg(msg) {
    if (msg.t === "rv-status") {
      statuses.set(msg.id, { ...msg, seen: Date.now() });
      if (isHost()) shareStarters();
      return;
    }
    if (msg.t === "rv-starters") { starterIdx = msg.on && msg.map && msg.map[myId()] != null ? msg.map[myId()] : null; starterOn = !!msg.on; return;
    }
    if (!msg.t || !msg.t.startsWith("rv-") || msg.to !== myId()) return;
    if (msg.t === "rv-ch") return challenged(msg);
    if (msg.t === "rv-ans") return answered(msg);
    if (!battle || msg.bid !== battle.id) return;
    if (msg.t === "rv-act") { battle.acts[msg.step] = battle.acts[msg.step] || {}; battle.acts[msg.step][1 - battle.me] = msg.act; if (msg.h && msg.h !== battle.hashes[msg.step]) battle.desync = true; tryResolve(); }
    if (msg.t === "rv-bye") endBattle(`${battle.foeName} left the battle. No EXP this time.`, false);
  }
  function sendStatus() {
    if (!G() || !G().connected() || !cfg.role) return;
    const jn = journey();
    send({ t: "rv-status", id: myId(), name: G().me().name, role: cfg.role, badges: badgeCount(), region: jn ? jn.region : null });
  }

  async function ready() {
    if (!mem || !mem.supported) mem = await ctx.getMem();
    if (!mem || !mem.supported) throw new Error((mem && mem.reason) || "This game isn't supported.");
    if (!tables) tables = romTables(mem.rom, mem.profile);
    if (!tables) throw new Error("Couldn't find this game's Pokémon data. Hero vs Rival works with FireRed, LeafGreen, Emerald and hacks that keep their data layout.");
  }

  async function challenge(foeId, foeName) {
    try { await ready(); } catch (e) { return info("Hero vs Rival", e.message); }
    if (!cfg.role) return openMenu();
    const st = statuses.get(foeId);
    if (!st || !st.role || !canFight(cfg.role, st.role)) return info("Can't battle", teamText(cfg.role, st && st.role, foeName));
    const myRegion = journey() ? journey().region : null;
    if (myRegion != null && st.region != null && st.region !== myRegion) return info("Different regions", `You're in region ${myRegion + 1} and ${esc(foeName)} is in region ${st.region + 1}. ${st.region < myRegion ? "They need to beat their Champion and catch up." : "Beat your Champion to catch up."}`);
    const mine = badgeCount();
    if (st.badges !== mine) return info("Not yet!", badgeText(mine, st.badges, foeName));
    if (!mem.inOverworld()) return info("Not now", "Close any menus first, then try again.");
    const party = myBattleParty();
    if (!party.length) return info("No Pokémon", "You need at least one Pokémon that can battle.");
    const bid = "b" + Math.random().toString(36).slice(2, 9);
    pending = { bid, foeId, foeName, party };
    send({ t: "rv-ch", from: myId(), fromName: G().me().name, to: foeId, bid, badges: mine, role: cfg.role, region: myRegion, party });
    sheet(`<h3>Challenged ${esc(foeName)}!</h3><div class="sub">Waiting for them to accept…</div><div class="actions"><button class="btn ghost full" data-r="close">Cancel</button></div>`, () => { pending = null; closeSheet(); });
  }
  function badgeText(mine, theirs, name) {
    return mine > theirs
      ? `You have ${mine} badge${mine === 1 ? "" : "s"} and ${esc(name)} has ${theirs}. They need to catch up before you can battle.`
      : `${esc(name)} has ${theirs} badge${theirs === 1 ? "" : "s"} and you have ${mine}. Earn ${theirs - mine} more to challenge them.`;
  }
  let pending = null;
  async function challenged(msg) {
    const no = (reason) => send({ t: "rv-ans", from: myId(), to: msg.from, bid: msg.bid, yes: false, reason });
    try { await ready(); } catch (e) { return no("Their game isn't supported."); }
    if (battle) return no("They're already battling.");
    if (!cfg.role) return no("They haven't picked Hero or Rival yet.");
    if (!canFight(cfg.role, msg.role)) return no(cfg.role === "coop" ? "They're playing Co-op." : "You're on the same team.");
    const myRegion = journey() ? journey().region : null;
    if (myRegion != null && msg.region != null && msg.region !== myRegion) return no(`You're in different regions of your journey (you: ${msg.region + 1}, them: ${myRegion + 1}).`);
    const mine = badgeCount();
    if (mine !== msg.badges) { no(`Badges don't match: you have ${msg.badges}, they have ${mine}.`); return info("Challenge blocked", badgeText(mine, msg.badges, msg.fromName)); }
    sheet(`<h3>${ROLES[msg.role].icon} ${esc(msg.fromName)} challenges you!</h3><div class="sub">Both of you have ${mine} badge${mine === 1 ? "" : "s"}. Pokémon start at full health and nothing is lost. Each knock-out earns EXP.</div>
      <div class="actions"><button class="btn ghost" data-r="no">Not now</button><button class="btn primary" data-r="yes">Battle!</button></div>`, (a) => {
      closeSheet();
      if (a !== "yes") return no("They said not now.");
      if (!mem.inOverworld()) { no("They were busy in a menu."); return info("Not now", "Close any menus in your game first, then ask them to challenge you again."); }
      const party = myBattleParty();
      if (!party.length) return no("They have no Pokémon that can battle.");
      const seed = (Math.random() * 4294967296) >>> 0;
      send({ t: "rv-ans", from: myId(), to: msg.from, bid: msg.bid, yes: true, party, seed });
      startBattle({ bid: msg.bid, foeId: msg.from, foeName: msg.fromName, me: 1, parties: [msg.party, party], names: [msg.fromName, G().me().name], seed });
    });
  }
  function answered(msg) {
    if (!pending || pending.bid !== msg.bid) return;
    const p = pending; pending = null;
    if (!msg.yes) return info("No battle", esc(msg.reason || "They said no."));
    closeSheet();
    startBattle({ bid: p.bid, foeId: p.foeId, foeName: p.foeName, me: 0, parties: [p.party, msg.party], names: [G().me().name, p.foeName], seed: msg.seed });
  }

  // ---------------- battle screen ----------------
  function startBattle(o) {
    const S = newBattle(o.parties, o.names, o.seed);
    battle = { id: o.bid, foeId: o.foeId, foeName: o.foeName, me: o.me, S, acts: {}, hashes: {}, sent: -1, desync: false };
    battle.hashes[S.step] = stateHash(S);
    try { gm().toggleMainLoop(0); } catch (e) {}
    battle.watch = setInterval(() => {
      const o2 = G() && G().others().get(battle.foeId);
      if (!o2 || !G().connected()) endBattle(`Lost the connection to ${battle.foeName}. No EXP this time.`, false);
    }, 3000);
    screen(); play(S.log);
  }
  function tryResolve() {
    const b = battle; if (!b || b.busy) return;
    const S = b.S, got = b.acts[S.step] || {};
    if (S.over) return;
    if ([0, 1].some(si => S.need[si] && !got[si])) return render();
    resolve(S, got);
    b.hashes[S.step] = stateHash(S);
    play(S.log);
  }
  function choose(a) {
    const b = battle, S = b.S;
    if (!b || S.over || !S.need[b.me] || b.sent === S.step || b.busy) return;
    b.sent = S.step;
    (b.acts[S.step] = b.acts[S.step] || {})[b.me] = a;
    send({ t: "rv-act", from: myId(), to: b.foeId, bid: b.id, step: S.step, act: a, h: b.hashes[S.step] });
    tryResolve();
  }
  function play(log) {
    const b = battle; b.busy = true; render();
    let i = 0;
    const next = () => {
      if (!battle || battle !== b) return;
      if (i >= log.length) { b.busy = false; if (b.S.over) return done(); render(); return tryResolve(); }
      render(log[i]); i++; setTimeout(next, 900);
    };
    next();
  }
  function hpBar(m, view, mine) {
    const hp = view ? view.hp : m.hp, pct = Math.max(0, hp / m.stats[0]), col = pct > .5 ? "#51cf66" : pct > .2 ? "#fcc419" : "#ff6b6b";
    const status = view ? view.status : m.status;
    return `<div class="rv-mon"><div class="rv-name">${esc(m.name)} <small>Lv${m.level}</small> ${status ? `<span class="rv-st">${status.toUpperCase()}</span>` : ""}</div>
      <div class="rv-hp"><i style="width:${pct * 100}%;background:${col}"></i></div><small>${Math.max(0, hp)}/${m.stats[0]} HP${mine ? ` · ${esc(abilityName(m.ab))}${m.item ? ` · ${esc(m.item.name)}` : ""}` : ""}</small></div>`;
  }
  function screen() {
    let el = $("#rvBattle");
    if (!el) { el = document.createElement("div"); el.id = "rvBattle"; document.body.appendChild(el); }
    el.hidden = false;
    el.onclick = (e) => {
      const t = e.target.closest("[data-v]"); if (!t || t.disabled) return;
      const v = t.dataset.v, n = +t.dataset.n;
      if (v === "move") choose({ move: n });
      if (v === "struggle") choose({ move: -1 });
      if (v === "sw") choose({ sw: n });
      if (v === "rep") choose({ rep: n });
      if (v === "swmenu") { battle.swMenu = !battle.swMenu; render(); }
      if (v === "give") { if (confirmGive()) choose({ forfeit: true }); }
    };
  }
  let giveArmed = 0;
  function confirmGive() { if (Date.now() - giveArmed < 3000) return true; giveArmed = Date.now(); toast("Tap Give up again to forfeit."); return false; }
  function render(line) {
    const b = battle; if (!b) return;
    const S = b.S, me = b.me, el = $("#rvBattle");
    const view = line ? line.view : null;
    const mySide = S.sides[me], foeSide = S.sides[1 - me];
    const myMon = mySide.mons[view ? view[me].i : mySide.active], foeMon = foeSide.mons[view ? view[1 - me].i : foeSide.active];
    const balls = (side) => side.mons.map(m => `<i class="${m.hp > 0 ? "" : "out"}"></i>`).join("");
    let controls = "";
    const myTurn = !b.busy && !S.over && S.need[me] && b.sent !== S.step;
    if (b.busy || S.over) controls = "";
    else if (!myTurn) controls = `<div class="rv-wait">Waiting for ${esc(b.foeName)}…</div>`;
    else if (S.phase === "rep") {
      controls = `<div class="rv-sub">Choose your next Pokémon</div><div class="rv-grid">${mySide.mons.map((m, i) => `<button data-v="rep" data-n="${i}" ${m.hp > 0 ? "" : "disabled"}>${esc(m.name)}<small>${m.hp}/${m.stats[0]}</small></button>`).join("")}</div>
        <button class="rv-give" data-v="give">Give up</button>`;
    } else if (b.swMenu) {
      controls = `<div class="rv-sub">Switch to…</div><div class="rv-grid">${mySide.mons.map((m, i) => `<button data-v="sw" data-n="${i}" ${m.hp > 0 && i !== mySide.active ? "" : "disabled"}>${esc(m.name)}<small>${m.hp}/${m.stats[0]}</small></button>`).join("")}</div>
        <button class="rv-give" data-v="swmenu">Back</button>`;
    } else {
      const m = act(S, me), noPP = m.pp.every(p => p <= 0);
      controls = `<div class="rv-grid">${noPP ? `<button data-v="struggle">Struggle</button>` : m.moves.map((mv, i) => `<button data-v="move" data-n="${i}" ${m.pp[i] > 0 && (m.choice == null || m.pp[m.choice] <= 0 || m.choice === i) ? "" : "disabled"}>${esc(mv.name)}<small>${TYPE_NAMES[mv.type] || ""} · ${m.pp[i]}/${mv.pp}</small></button>`).join("")}</div>
        ${m.choice != null && m.pp[m.choice] > 0 ? `<div class="rv-sub">Locked into ${esc(m.moves[m.choice].name)} by ${esc(m.item.name)}</div>` : ""}
        <div class="rv-row"><button class="rv-give" data-v="swmenu" ${canSwitch(S, me) ? "" : "disabled"}>${canSwitch(S, me) ? "Switch" : "Can't switch"}</button><button class="rv-give" data-v="give">Give up</button></div>`;
    }
    const text = line ? line.text : S.over ? (S.winner == null ? "It's a draw!" : S.winner === me ? "You won!" : `${b.foeName} won.`) : (myTurn ? `What will ${act(S, me).name} do?` : "");
    el.innerHTML = `<div class="rv-box">
      <div class="rv-top"><b>${ROLES[(statuses.get(b.foeId) || {}).role]?.icon || ""} ${esc(b.foeName)}</b><span class="rv-balls">${balls(foeSide)}</span></div>
      ${hpBar(foeMon, view && view[1 - me])}
      <div class="rv-vs">VS</div>
      ${hpBar(myMon, view && view[me], true)}
      <div class="rv-top"><b>${ROLES[cfg.role]?.icon || ""} You</b><span class="rv-balls">${balls(mySide)}</span></div>
      <div class="rv-log">${esc(text)}</div>
      ${b.desync ? `<div class="rv-sub" style="color:#ff6b6b">Your phones disagree about this battle. EXP won't be given for it.</div>` : ""}
      <div class="rv-ctl">${controls}</div></div>`;
  }
  async function done() {
    const b = battle, S = b.S;
    const gains = b.desync ? [] : gainsFor(S, b.me);
    const results = [];
    try { for (const g of gains) { const r = applyGain(g); if (r) results.push(r); } } catch (e) { console.warn(e); }
    const won = S.winner === b.me;
    endBattle(null, true, true);                                   // keep the game paused while moves and evolutions happen
    await ask(`<h3>${won ? "You won! 🏆" : S.winner == null ? "A draw" : `${esc(b.foeName)} won`}</h3>
      <div class="sub">${results.length ? "Your Pokémon grew from this battle:" : "No EXP this time. Knock out your rival's Pokémon to earn it."}</div>
      ${results.map(r => `<div class="row"><span class="k">${esc(r.name)}</span> <span class="d">+${r.exp} EXP${r.to > r.from ? ` · Lv ${r.from} → ${r.to}` : ""}</span></div>`).join("")}`,
      [["ok", "Continue", "primary full"]]);
    const notes = [];
    for (const r of results) { if (r.to > r.from) { try { await grow(r, notes); } catch (e) { console.warn("Growing after battle failed:", e); } } }
    try { gm().toggleMainLoop(1); } catch (e) {}
    if (results.length) await ask(`<h3>All done</h3>${notes.map(n => `<div class="row"><span class="d">${esc(n)}</span></div>`).join("")}
      <p class="d" style="margin-top:10px"><b>Save in your game</b> (Start → Save) to keep everything from this battle.</p>`, [["ok", "Back to the game", "primary full"]]);
    closeSheet();
  }
  function endBattle(message, finished, keepPaused) {
    if (!battle) return;
    if (!finished) try { send({ t: "rv-bye", from: myId(), to: battle.foeId, bid: battle.id }); } catch (e) {}
    clearInterval(battle.watch); battle = null;
    const el = $("#rvBattle"); if (el) el.hidden = true;
    if (!keepPaused) try { gm().toggleMainLoop(1); } catch (e) {}
    if (message) info("Battle over", esc(message));
  }
  function ask(html, options) {   // options: [value, label, classes]
    return new Promise((res) => sheet(`${html}<div class="actions">${options.map(([v, l, c]) => `<button class="btn ${c || "ghost"}" data-r="${esc(v)}">${esc(l)}</button>`).join("")}</div>`, (a) => res(a), true));
  }

  // ---------------- growing after a versus battle: new moves + evolution (like a level-up in the game) ----------------
  const byPid = (pid) => readParty().find(p => p.pid === pid);
  const monName = (m) => { const n = I().toNeutral(m.dec); return (n.isNicknamed && n.nickname) || ((PkData.species[I().toNational(m.internal)] || {}).name) || "???"; };
  function teach(pid, moveId, slot) {
    const m = byPid(pid); if (!m) return;
    w16(m.dec, 0x2C + slot * 2, moveId);
    m.dec[0x34 + slot] = tables.move(moveId).pp;
    m.dec[0x28] &= ~(3 << (slot * 2));                              // PP Ups belonged to the old move
    writeSlot(m.slot, packRaw(m));
  }
  async function learnMoves(pid, internal, from, to, notes) {
    for (const e of tables.learnset(internal).filter(e => e.level > from && e.level <= to)) {
      const m = byPid(pid); if (!m) return;
      if (m.moves.includes(e.move)) continue;
      const mv = tables.move(e.move), name = monName(m);
      const empty = m.moves.indexOf(0);
      if (empty >= 0) { teach(pid, e.move, empty); notes.push(`${name} learned ${mv.name}!`); continue; }
      const pick = await ask(`<h3>${esc(name)} wants to learn ${esc(mv.name)}</h3>
        <div class="sub">${esc(TYPE_NAMES[mv.type] || "")}${mv.power > 1 ? ` · Power ${mv.power}` : ""}${mv.acc ? ` · Accuracy ${mv.acc}` : ""} · PP ${mv.pp}<br>But ${esc(name)} already knows four moves. Forget one to make room?</div>`,
        m.moves.map((id, i) => [String(i), `Forget ${tables.move(id).name}`, "ghost"]).concat([["no", `Don't learn ${mv.name}`, "ghost full"]]));
      if (pick === "no") { notes.push(`${name} did not learn ${mv.name}.`); continue; }
      const old = tables.move(m.moves[+pick]).name;
      teach(pid, e.move, +pick); notes.push(`${name} forgot ${old} and learned ${mv.name}!`);
    }
  }
  function evolutionFor(m) {
    const held = tables.item(u16(m.dec, 0x22));
    if (held && held.eff === 38) return null;                       // Everstone
    for (const e of tables.evolutions(m.internal)) {
      const lv = m.level >= e.param, atk = m.stats[1], def = m.stats[2], split = (m.pid >>> 16) % 10;
      const ok = { 1: m.dec[0x29] >= 220, 4: lv, 8: lv && atk > def, 9: lv && atk === def, 10: lv && atk < def, 11: lv && split <= 4, 12: lv && split > 4, 13: lv }[e.method];
      if (ok && e.target) return e.target;
    }
    return null;
  }
  function evolve(pid, target) {
    const m = byPid(pid); if (!m) return;
    const before = I().toNational(m.internal), n = I().toNeutral(m.dec), nat = I().toNational(target);
    w16(m.dec, 0x20, target);
    if (!n.isNicknamed) { const nm = (PkData.species[nat] || {}).name; if (nm) I().setString(m.dec, 0x08, 10, nm.toUpperCase().replace("’", "'"), m.dec[0x12]); }
    const stats = calcStats(target, m.level, m.ivs, m.evs, m.pid), raw = packRaw(m);
    const hp = m.hp === 0 ? 0 : Math.max(1, m.hp + stats[0] - m.stats[0]);
    w16(raw, 0x56, Math.min(hp, stats[0])); stats.forEach((v, i) => w16(raw, 0x58 + i * 2, v));
    writeSlot(m.slot, raw);
    markDex(nat, before);
  }
  // Register the evolution in the Pokédex. The game keeps "seen" in three places and wipes the flag if they disagree,
  // so only write when the Pokémon it evolved from reads back correctly from all three.
  function markDex(nat, known) {
    const rd = mem.reader, fam = mem.profile.family === "E" ? "E" : "FRLG";
    const sb1 = rd.u32(mem.ram.sb1Ptr), sb2 = rd.u32(mem.ram.sb2Ptr);
    const seen = [sb2 + 0x5C, sb1 + (fam === "E" ? 0x988 : 0x5F8), sb1 + (fam === "E" ? 0x3B24 : 0x3A18)], owned = sb2 + 0x28;
    const bit = (base, n) => (rd.u8(base + ((n - 1) >> 3)) >> ((n - 1) & 7)) & 1;
    if (!(bit(owned, known) && seen.every(a => bit(a, known)))) return;
    for (const a of [owned, ...seen]) { const at = a + ((nat - 1) >> 3); rd.w8(at, rd.u8(at) | (1 << ((nat - 1) & 7))); }
  }
  async function grow(r, notes) {
    const m0 = byPid(r.pid); if (!m0) return;
    await learnMoves(r.pid, m0.internal, r.from, r.to, notes);
    const m = byPid(r.pid), target = m && evolutionFor(m);
    if (!target) return;
    const oldName = monName(m), newName = (PkData.species[I().toNational(target)] || {}).name || "???";
    const go = await ask(`<h3>What? ${esc(oldName)} is evolving!</h3><div class="sub">It can become ${esc(newName)}.</div>`, [["stop", "Stop it", "ghost"], ["go", "Let it evolve", "primary"]]);
    if (go !== "go") { notes.push(`${oldName} didn't evolve.`); return; }
    evolve(r.pid, target);
    notes.push(`${oldName} evolved into ${newName}!`);
    await learnMoves(r.pid, target, m.level - 1, m.level, notes);    // moves the new form learns at this level
  }

  // ---------------- 🎲 random starters (host decides, everyone gets a different one) ----------------
  // Starter trios by National Dex number: grass, fire, water. The trio is the one your game handed you.
  const TRIOS = [[1, 4, 7], [152, 155, 158], [252, 255, 258]];
  let starterOn = false, starterIdx = null, starterOrder = [], starterPerm = null, lastCount = null, swapTimer = null;
  try { starterOn = localStorage.getItem("ps_rand_starters") === "1"; } catch (e) {}
  const isHost = () => !!(G() && G().isHost && G().isHost());
  function starterName() {
    let nat = null;
    try { const m = mem && readParty()[0], n = m && I().toNational(m.internal), trio = TRIOS.find(t => t.includes(n)); if (trio) nat = trio[starterIdx]; } catch (e) {}
    return nat ? (PkData.species[nat] || {}).name : ["the grass starter", "the fire starter", "the water starter"][starterIdx];
  }
  function shareStarters() {
    if (!isHost() || !G().connected()) return;
    if (!starterPerm) { starterPerm = [0, 1, 2]; for (let i = 2; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [starterPerm[i], starterPerm[j]] = [starterPerm[j], starterPerm[i]]; } }
    const ids = [myId(), ...[...statuses.keys()]].filter(Boolean);
    for (const id of ids) if (!starterOrder.includes(id)) starterOrder.push(id);
    const map = {}; starterOrder.forEach((id, k) => map[id] = starterPerm[k % 3]);
    starterIdx = starterOn ? map[myId()] : null;
    send({ t: "rv-starters", on: starterOn, map });
  }
  // Watch the party: the moment it goes from 0 to 1 Pokémon (you just got your starter), swap it for your assigned one.
  function starterTick() {
    if (!mem || !tables || battle) return;
    // only count changes that happen while walking around (getting a starter in a lab), never loading a save from the title screen
    if (!mem.inOverworld()) { lastCount = null; return; }
    let n; try { n = mem.partyCount(); } catch (e) { return; }
    if (lastCount === 0 && n === 1 && starterOn && starterIdx != null) {
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => { try { swapStarter(); } catch (e) { console.warn("Starter swap failed:", e); } }, 1200);   // let the game finish writing it
    }
    lastCount = n;
  }
  function swapStarter() {
    const m = readParty()[0]; if (!m || m.level > 10) return;
    const nat = I().toNational(m.internal), trio = TRIOS.find(t => t.includes(nat));
    if (!trio || trio[starterIdx] === nat) return;
    const want = trio[starterIdx], internal = I().toInternal(want), n = I().toNeutral(m.dec);
    w16(m.dec, 0x20, internal);
    if (!n.isNicknamed) { const nm = (PkData.species[want] || {}).name; if (nm) I().setString(m.dec, 0x08, 10, nm.toUpperCase(), m.dec[0x12]); }
    // the moves it would know at this level
    const known = [];
    for (const e of tables.learnset(internal)) if (e.level <= m.level) { const i = known.indexOf(e.move); if (i >= 0) known.splice(i, 1); known.push(e.move); }
    const moves = known.slice(-4);
    for (let k = 0; k < 4; k++) { w16(m.dec, 0x2C + k * 2, moves[k] || 0); m.dec[0x34 + k] = moves[k] ? tables.move(moves[k]).pp : 0; }
    m.dec[0x28] = 0;
    const stats = calcStats(internal, m.level, m.ivs, m.evs, m.pid), raw = packRaw(m);
    w16(raw, 0x56, stats[0]); stats.forEach((v, i) => w16(raw, 0x58 + i * 2, v));
    writeSlot(m.slot, raw);
    markDex(want, nat);
    toast(`🎲 Random starters: you got ${(PkData.species[want] || {}).name}!`, 6000);
  }

  // ---------------- menu ----------------
  function sheet(html, onAction, modal) {
    let s = $("#rivalSheet");
    if (!s) { s = document.createElement("div"); s.id = "rivalSheet"; s.className = "switcher"; s.innerHTML = `<div class="sheet"></div>`; document.body.appendChild(s); s.addEventListener("click", (e) => { if (e.target === s && !s.dataset.modal) closeSheet(); }); }
    const box = s.querySelector(".sheet");
    if (modal) s.dataset.modal = "1"; else delete s.dataset.modal;
    box.innerHTML = html;
    box.onclick = (e) => { const a = e.target.closest("[data-r]"); if (a) onAction(a.dataset.r, a); };
    s.classList.add("open");
  }
  function closeSheet() { const s = $("#rivalSheet"); if (s) s.classList.remove("open"); }
  function info(title, html) { sheet(`<h3>${esc(title)}</h3><div class="sub">${html}</div><div class="actions"><button class="btn ghost full" data-r="close">OK</button></div>`, () => closeSheet()); }

  async function openMenu() {
    try { await ready(); } catch (e) { return info("Hero vs Rival", esc(e.message)); }
    const others = [...statuses.values()].filter(s => Date.now() - s.seen < 10000);
    const together = G() && G().connected();
    sheet(`<h3>⚔ Hero vs Rival</h3>
      <div class="sub">Pick a team. Heroes battle Rivals whenever they meet, and several players can be on each team. Co-op is just playing together, with no battles.</div>
      <div class="actions" style="grid-template-columns:1fr 1fr 1fr">
        ${Object.entries(ROLES).map(([k, r]) => `<button class="btn ${cfg.role === k ? "primary" : "ghost"}" data-r="role-${k}">${r.icon} ${r.label}</button>`).join("")}
      </div>
      ${together ? `<label class="row" style="display:flex;gap:10px;align-items:flex-start;margin-top:12px"><input type="checkbox" id="rvStarters" ${starterOn ? "checked" : ""} ${isHost() ? "" : "disabled"} style="margin-top:3px">
        <span><span class="k">🎲 Random starters</span><br><span class="d">${isHost() ? "Everyone gets a different starter when they receive one (for example one Totodile, one Cyndaquil, one Chikorita). Turn this on before anyone gets their starter." : "The host decides."}${starterIdx != null ? ` <b>Yours: ${esc(starterName())}</b>` : ""}</span></span></label>` : ""}
      ${journey() ? `<div class="row" style="margin-top:12px"><span class="k">Journey</span> <span class="d">Region ${journey().region + 1} of ${journey().total}</span></div>` : ""}
      <div class="row" style="${journey() ? "" : "margin-top:12px"}"><span class="k">Your badges</span> <span class="d">${badgeCount()} / 8</span></div>
      ${others.map(s => `<div class="row"><span class="k">${ROLES[s.role]?.icon || ""} ${esc(s.name)}</span> <span class="d">${ROLES[s.role]?.label || "?"} · ${s.region != null ? `region ${s.region + 1} · ` : ""}${s.badges} badge${s.badges === 1 ? "" : "s"}</span></div>`).join("")}
      <p class="d" style="margin-top:10px">${together ? "" : "<b>To meet up:</b> open <b>Auto → Play together</b> and connect. "}To battle, walk up to a player on the other team, face them and tap <b>Interact → ⚔ Battle</b>. You can only battle when you both have the same number of badges.</p>
      <div class="actions"><button class="btn ghost full" data-r="close">Done</button></div>`, (a) => {
      if (a.startsWith("role-")) {
        cfg.role = a.slice(5); saveCfg(); sendStatus(); return openMenu();
      }
      if (a === "close") closeSheet();
    });
    if ($("#rvStarters")) $("#rvStarters").onchange = (e) => { starterOn = e.target.checked; try { localStorage.setItem("ps_rand_starters", starterOn ? "1" : ""); } catch (er) {} shareStarters(); openMenu(); };
  }
  function updateBtn() {
    const b = $("#rivalBtn"); if (!b) return;
    b.textContent = cfg.role ? `${ROLES[cfg.role].icon} Rivals` : "⚔ Rivals";
  }

  function css() {
    const s = document.createElement("style");
    s.textContent = `#rvBattle{position:fixed;inset:0;z-index:39;background:rgba(8,8,12,.94);display:flex;align-items:center;justify-content:center;padding:10px;color:#fff;font-family:system-ui,sans-serif}
#rvBattle[hidden]{display:none}.rv-box{width:min(560px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:8px}
.rv-top{display:flex;justify-content:space-between;align-items:center;font-size:14px}.rv-balls i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff6b6b;margin-left:3px;border:1px solid #fff}.rv-balls i.out{background:#555}
.rv-mon{background:#1c1c24;border-radius:12px;padding:10px}.rv-name{font-weight:650}.rv-name small{color:#aaa;font-weight:400}.rv-st{font-size:10px;background:#7048e8;border-radius:4px;padding:1px 4px;margin-left:4px}
.rv-hp{height:8px;background:#333;border-radius:4px;overflow:hidden;margin:6px 0 2px}.rv-hp i{display:block;height:100%;transition:width .5s}
.rv-vs{text-align:center;color:#ffcb3d;font-weight:800;letter-spacing:.2em;font-size:12px}
.rv-log{min-height:44px;background:#fff;color:#111;border-radius:10px;padding:10px 12px;font-size:15px}
.rv-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}.rv-grid button{background:#2a2a36;color:#fff;border:1px solid #3a3a48;border-radius:10px;padding:10px 6px;font-size:14px;display:flex;flex-direction:column;gap:2px}
.rv-grid button small{color:#aaa;font-size:11px}.rv-grid button:disabled{opacity:.35}.rv-row{display:flex;gap:6px;margin-top:6px}
.rv-give{flex:1;background:transparent;color:#ccc;border:1px solid #444;border-radius:10px;padding:8px;margin-top:6px;width:100%}.rv-wait,.rv-sub{color:#aaa;font-size:13px;text-align:center;padding:6px}`;
    document.head.appendChild(s);
  }

  window.PocketRivals = {
    init(c) {
      ctx = c; loadCfg(); css();
      if (G() && G().on) G().on(onMsg);
      setInterval(sendStatus, 3000);
      // Rival rules watcher (needs the game's memory; keeps trying until the game is past the title screen)
      const boot = async () => {
        if (!cfg.rules && !(G() && G().connected())) return;
        try { await ready(); } catch (e) { return; }
        if (!lockTimer) lockTimer = setInterval(() => { if (cfg.rules) lockTick(); starterTick(); if (isHost() && Date.now() % 5000 < 300) shareStarters(); }, 300);
      };
      setInterval(boot, 5000); boot();
    },
    open: openMenu,
    challenge,
    // one line for the Auto menu
    label: () => cfg.role ? `${cfg.role === "coop" ? "You're playing 🤝 Co-op" : `You're a ${ROLES[cfg.role].icon} ${ROLES[cfg.role].label}`}${cfg.rules ? " · wild Pokémon give no EXP" : ""}` : "Pick a team: Hero, Rival or Co-op",
    _engine: { onMsg: (m) => onMsg(m), grow: (r, n) => grow(r, n), evolutionFor: (m) => evolutionFor(m), myBattleParty: () => myBattleParty(), romTables, newBattle, resolve, gainsFor, calcStats: (...a) => calcStats(...a), levelForExp, stateHash, CHART, setTables: (t) => tables = t, applyGain: (g) => applyGain(g), setMem: (m) => mem = m, lockTick: () => lockTick(), setCfg: (c) => cfg = c, readParty: () => readParty() },
  };
})();
