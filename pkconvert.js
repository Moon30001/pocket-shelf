// Pocket Shelf — moves a Pokémon (NeutralMon) between generations 1–5.
// Rules: newer games accept anything older; older games only accept what exists in them.
(function () {
  const PkSave = globalThis.PkSave;
  const D = () => globalThis.PkData;
  const U = () => PkSave.util;
  const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Uint8Array ? Array.from(v) : v)));

  // Gen 3+ version ids that each target generation understands as an origin game
  const VALID_ORIGIN = {
    3: [1, 2, 3, 4, 5, 15],
    4: [1, 2, 3, 4, 5, 15, 7, 8, 10, 11, 12],
    5: [1, 2, 3, 4, 5, 15, 7, 8, 10, 11, 12, 20, 21, 22, 23],
  };
  // Where a Pokémon arriving from an older generation is recorded as "met"
  const ARRIVAL_LOCATION = { 3: 254, 4: 55, 5: 30001 };   // gen3: in-game trade · gen4: Pal Park · gen5: Poké Transfer
  const MAX_BALL = { 3: 12, 4: 24, 5: 25 };

  // Trade evolutions (species → [needed held item (national id) or 0, result species])
  const TRADE_EVO = {
    64: [0, 65], 67: [0, 68], 75: [0, 76], 93: [0, 94],                 // Kadabra, Machoke, Graveler, Haunter
    61: [221, 186], 79: [221, 199], 95: [233, 208], 123: [233, 212],     // Poliwhirl/Slowpoke + King's Rock, Onix/Scyther + Metal Coat
    117: [235, 230], 137: [252, 233],                                    // Seadra + Dragon Scale, Porygon + Up-Grade
    366: [226, 367],                                                     // Clamperl + Deep Sea Tooth (Huntail)
    112: [322, 464], 125: [323, 466], 126: [324, 467], 233: [325, 474], 356: [326, 477],
    525: [0, 526], 533: [0, 534], 588: [0, 589], 616: [0, 617],          // Boldore, Gurdurr, Karrablast*, Shelmet*
  };
  const CLAMPERL_SCALE = [227, 368];                                     // Clamperl + Deep Sea Scale → Gorebyss

  function why(mon, gen) {
    const d = D();
    if (mon.isEgg) return "Eggs can't be moved yet.";
    if (mon.species > d.maxSpecies[gen]) return `${d.species[mon.species].name} doesn't exist in Gen ${gen} games.`;
    return null;
  }

  // Random PID with the requested traits (nature, gender, ability bit, shininess) for gen 3/4 rules
  function makePid({ species, tid, sid, nature, gender, abilityBit, shiny }) {
    const d = D();
    const ratio = d.species[species].gender;
    for (let i = 0; i < 400000; i++) {
      let pid = (Math.random() * 0x100000000) >>> 0;
      if (shiny) { // force shiny: make the high half xor to < 8
        const low = pid & 0xFFFF;
        const high = (tid ^ sid ^ low ^ (Math.random() * 8 | 0)) & 0xFFFF;
        pid = ((high << 16) | low) >>> 0;
      }
      if (nature != null && pid % 25 !== nature) continue;
      if (abilityBit != null && (pid & 1) !== abilityBit) continue;
      if (gender != null && ratio !== 255 && ratio !== 254 && ratio !== 0 && (((pid & 0xFF) < ratio) ? 1 : 0) !== gender) continue;
      if (!shiny && U().isShiny(pid, tid, sid)) continue;
      return pid;
    }
    return (Math.random() * 0x100000000) >>> 0;
  }

  function abilityCount(species, gen) {
    const a = D().species[species][gen === 3 ? "ab3" : gen === 4 ? "ab4" : "ab5"];
    return a && a[1] && a[1] !== a[0] ? 2 : 1;
  }

  /**
   * Convert `mon` (from a save of generation `fromGen`) for a save of generation `toGen`.
   * Returns { ok, mon, notes[] } or { ok:false, reason }.
   */
  function convert(srcMon, fromGen, toGen, opts = {}) {
    const blocked = why(srcMon, toGen);
    if (blocked) return { ok: false, reason: blocked };
    const d = D(), u = U();
    const m = clone(srcMon);
    const notes = [];
    if (srcMon.raw && srcMon.raw.data) m.raw = { ...srcMon.raw, data: new Uint8Array(srcMon.raw.data), ot: srcMon.raw.ot && new Uint8Array(srcMon.raw.ot), nick: srcMon.raw.nick && new Uint8Array(srcMon.raw.nick) };
    const sameGen = fromGen === toGen;
    if (!sameGen) m.raw = null;                      // re-encode for the new format

    // Gen 1 and Gen 2 share a family; Gen 3, 4 and 5 share PID-based structures.
    const old = (g) => g <= 2;

    // ---- moves ----
    if (!sameGen) {
      const maxMove = d.maxMove[toGen];
      const kept = [], ups = [];
      m.moves.forEach((mv, i) => {
        if (!mv) return;
        if (mv <= maxMove) { kept.push(mv); ups.push(m.ppUps ? m.ppUps[i] || 0 : 0); }
        else notes.push(`Forgets ${d.moves[mv]} (not in Gen ${toGen}).`);
      });
      if (!kept.length) { kept.push(33); ups.push(0); notes.push("Knows Tackle so it has at least one move."); }
      while (kept.length < 4) { kept.push(0); ups.push(0); }
      m.moves = kept; m.ppUps = ups;
    }

    // ---- held item ----
    if (!sameGen && m.heldItem) {
      const keep = toGen === 1 ? 0 : toGen === 2 ? u.itemFrom2(u.itemTo2(m.heldItem)) : toGen === 3 ? u.itemFrom3(u.itemTo3(m.heldItem)) : (m.heldItem <= d.maxItem[toGen] ? m.heldItem : 0);
      if (keep !== m.heldItem) { notes.push(`Its ${d.items[m.heldItem]} stays behind (not in Gen ${toGen}).`); m.heldItem = 0; }
    }

    // ---- old → new (Gen 1/2 → Gen 3+) ----
    if (old(fromGen) && !old(toGen)) {
      m.sid = 0;
      const nature = Math.floor(Math.random() * 25);
      const abilityNum = abilityCount(m.species, toGen) === 2 ? (Math.random() < 0.5 ? 0 : 1) : 0;
      m.pid = makePid({ species: m.species, tid: m.tid, sid: 0, nature, gender: m.gender === 2 ? null : m.gender, abilityBit: abilityNum, shiny: !!m.shiny });
      m.nature = nature; m.abilityNum = abilityNum;
      m.gender = u.genderFromPid(m.species, m.pid);
      m.friendship = m.friendship == null ? (d.species[m.species].baseFriendship || 70) : m.friendship;
      m.ball = 4; m.metLevel = m.level; m.metLocation = ARRIVAL_LOCATION[toGen];
      m.language = m.language || 2; m.fatefulEncounter = false; m.pokerus = m.pokerus || 0;
      m.originVersion = null;
      m.gen12 = null;
      if (m.isNicknamed && m.nickname === m.nickname.toUpperCase()) { /* keep as is */ }
    }

    // ---- new → old (Gen 3+ → Gen 1/2) ----
    if (!old(fromGen) && old(toGen)) {
      const dv = (iv) => Math.min(15, iv >> 1);
      const atk = dv(m.ivs[1]), def = dv(m.ivs[2]), spe = dv(m.ivs[3]), spc = dv(Math.max(m.ivs[4], m.ivs[5]));
      m.gen12 = { dvs: { atk, def, spe, spc }, statExp: [m.evs[0], m.evs[1], m.evs[2], m.evs[3], Math.max(m.evs[4], m.evs[5])].map(e => Math.min(65535, e * e)) };
      const hpDv = ((atk & 1) << 3) | ((def & 1) << 2) | ((spe & 1) << 1) | (spc & 1);
      m.ivs = [hpDv, atk, def, spe, spc, spc].map(v => v * 2 + 1);
      m.evs = m.gen12.statExp.map(s => Math.min(255, Math.ceil(Math.sqrt(s)))); m.evs = [m.evs[0], m.evs[1], m.evs[2], m.evs[3], m.evs[4], m.evs[4]];
      const wasShiny = m.shiny;
      m.shiny = def === 10 && spe === 10 && spc === 10 && [2, 3, 6, 7, 10, 11, 14, 15].includes(atk);
      if (wasShiny !== m.shiny) notes.push(wasShiny ? "Won't be shiny in Gen 1/2 (shininess works differently there)." : "Becomes shiny in Gen 2 because of how Gen 2 decides shininess.");
      const ratio = d.species[m.species].gender;
      const g2gender = ratio === 255 ? 2 : ratio === 254 ? 1 : ratio === 0 ? 0 : ((atk << 4) | 0xF) <= ratio ? 1 : 0;
      if (toGen === 2 && m.gender !== g2gender && m.gender !== 2) notes.push("Gender may change (Gen 2 sets gender from its stats).");
      m.gender = g2gender;
      m.pid = null; m.nature = null; m.abilityNum = null; m.sid = 0;
      if (toGen === 1) { m.friendship = null; m.pokerus = null; }
      m.ball = null; m.metLocation = 0; m.metLevel = toGen === 2 ? Math.min(63, m.level) : null; m.originVersion = null;
      notes.push("Nature and ability don't exist in Gen 1/2.");
    }

    // ---- Gen 1 ↔ Gen 2 (like the real Time Capsule) ----
    if (old(fromGen) && old(toGen) && !sameGen) {
      if (toGen === 2) { m.friendship = m.friendship == null ? (d.species[m.species].baseFriendship || 70) : m.friendship; m.pokerus = m.pokerus || 0; m.metLevel = 0; m.metLocation = 0; }
      else { m.friendship = null; m.pokerus = null; m.metLevel = null; }
    }

    // ---- within Gen 3–5 ----
    if (!old(fromGen) && !old(toGen) && !sameGen) {
      // Nature: Gen 3/4 read it from the PID. Gen 5 stores it separately.
      if (toGen <= 4 && m.nature != null && m.pid % 25 !== m.nature || (toGen <= 4 && m.abilityNum === 2)) {
        const abilityBit = m.abilityNum === 2 ? 0 : (abilityCount(m.species, toGen) === 2 ? (m.abilityNum || 0) : 0);
        if (m.abilityNum === 2) notes.push("Its Hidden Ability becomes a regular ability (Gen 3/4 have none).");
        m.pid = makePid({ species: m.species, tid: m.tid, sid: m.sid, nature: m.nature, gender: m.gender === 2 ? null : m.gender, abilityBit, shiny: !!m.shiny });
        m.abilityNum = abilityBit;
      }
      if (toGen <= 4) m.nature = m.pid % 25;
      if (toGen === 3 || toGen === 4) { const n = abilityCount(m.species, toGen); if (m.abilityNum > n - 1) m.abilityNum = 0; }
      if (m.ball > MAX_BALL[toGen]) { notes.push("Its special Poké Ball becomes a regular Poké Ball."); m.ball = 4; }
      if (fromGen < toGen) { m.metLocation = ARRIVAL_LOCATION[toGen]; m.metLevel = m.level; }
      else { m.metLocation = ARRIVAL_LOCATION[toGen]; }
      m.gender = u.genderFromPid(m.species, m.pid);
    }
    if (!old(toGen) && (m.originVersion == null || !VALID_ORIGIN[toGen].includes(m.originVersion))) m.originVersion = opts.targetVersion || null;

    // ---- trade evolution (only for real trades) ----
    if (opts.trade) {
      let evo = TRADE_EVO[m.species];
      if (m.species === 366 && m.heldItem === CLAMPERL_SCALE[0]) evo = CLAMPERL_SCALE;
      if (m.species === 588 || m.species === 616) evo = (opts.partnerSpecies === (m.species === 588 ? 616 : 588)) ? TRADE_EVO[m.species] : null;
      if (evo && (!evo[0] || m.heldItem === evo[0]) && evo[1] <= d.maxSpecies[toGen] && m.heldItem !== 229 /* Everstone */) {
        const before = d.species[m.species].name;
        if (evo[0]) m.heldItem = 0;
        m.species = evo[1]; m.raw = null;
        notes.push(`${before} evolved into ${d.species[m.species].name}!`);
      }
    }
    m.level = u.levelFromExp(m.species, m.exp);
    return { ok: true, mon: m, notes };
  }

  PkSave.convert = convert;
  PkSave.canGo = (mon, toGen) => !why(mon, toGen);
  PkSave.blockedReason = why;
})();
