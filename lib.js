// Pocket Shelf — shared storage + ROM helpers (everything stays on this device)
const DB_NAME = "pocket-shelf";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id" });
      if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms", { keyPath: "id" });
      if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const Store = {
  allGames: () => tx("games", "readonly", s => reqP(s.getAll())),
  getGame: (id) => tx("games", "readonly", s => reqP(s.get(id))),
  putGame: (g) => tx("games", "readwrite", s => reqP(s.put(g))),
  getRom: (id) => tx("roms", "readonly", s => reqP(s.get(id))),
  putRom: (r) => tx("roms", "readwrite", s => reqP(s.put(r))),
  getSave: (id) => tx("saves", "readonly", s => reqP(s.get(id))),
  putSave: (v) => tx("saves", "readwrite", s => reqP(s.put(v))),
  async deleteGame(id) {
    await tx("games", "readwrite", s => reqP(s.delete(id)));
    await tx("roms", "readwrite", s => reqP(s.delete(id)));
    await tx("saves", "readwrite", s => reqP(s.delete(id)));
  }
};

// ---------- ROM identification ----------
const SYSTEMS = {
  gba: { label: "GBA", exts: ["gba"], core: "mgba" },
  gb:  { label: "GB",  exts: ["gb", "gbc", "sgb"], core: "mgba" },
  nds: { label: "DS",  exts: ["nds"], core: "melonds" }
};
const ALL_EXTS = Object.values(SYSTEMS).flatMap(s => s.exts);

// Friendly names + a colour for well-known titles (matched on header codes, region-agnostic)
const KNOWN = {
  // GBA game codes (first 3 chars)
  AXV: ["Pokémon Ruby", "#c8323c"], AXP: ["Pokémon Sapphire", "#2f5fc4"],
  BPE: ["Pokémon Emerald", "#1f9a5a"], BPR: ["Pokémon FireRed", "#e0552b"],
  BPG: ["Pokémon LeafGreen", "#5aa832"],
  // DS game codes
  ADA: ["Pokémon Diamond", "#5b7fd6"], APA: ["Pokémon Pearl", "#d67fa8"],
  CPU: ["Pokémon Platinum", "#8a8f99"], IPK: ["Pokémon HeartGold", "#d4a62a"],
  IPG: ["Pokémon SoulSilver", "#9aa6b8"], IRB: ["Pokémon Black", "#3a3a40"],
  IRA: ["Pokémon White", "#c9ccd2"], IRE: ["Pokémon Black 2", "#2c3a55"],
  IRD: ["Pokémon White 2", "#d8c9b0"]
};
const KNOWN_GB = [
  [/POKEMON RED/, "Pokémon Red", "#d23a3a"], [/POKEMON BLUE/, "Pokémon Blue", "#3a62d2"],
  [/POKEMON GREEN/, "Pokémon Green", "#3aa04a"], [/POKEMON YELLOW/, "Pokémon Yellow", "#e6c229"],
  [/POKEMON_GLD/, "Pokémon Gold", "#c9a227"], [/POKEMON_SLV/, "Pokémon Silver", "#a3adbd"],
  [/PM_CRYSTAL/, "Pokémon Crystal", "#5ec6d8"]
];
const SYSTEM_COLORS = { gba: "#6b4fd8", gb: "#7a8f3a", nds: "#3f7fbf" };

function ascii(bytes, start, len) {
  let s = "";
  for (let i = start; i < start + len && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    s += (c >= 32 && c < 127) ? String.fromCharCode(c) : "";
  }
  return s.trim();
}

function prettyFileName(name) {
  return name.replace(/\.[^.]+$/, "")
    .replace(/[\[(][^\])]*[\])]/g, "")
    .replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim() || name;
}

function identify(fileName, bytes) {
  const ext = fileName.split(".").pop().toLowerCase();
  const system = Object.keys(SYSTEMS).find(k => SYSTEMS[k].exts.includes(ext));
  if (!system) return null;
  let title = prettyFileName(fileName), color = SYSTEM_COLORS[system], code = "";
  if (system === "gba") {
    code = ascii(bytes, 0xAC, 4);
    const k = KNOWN[code.slice(0, 3)];
    if (k) { title = k[0]; color = k[1]; }
  } else if (system === "nds") {
    code = ascii(bytes, 0x0C, 4);
    const k = KNOWN[code.slice(0, 3)];
    if (k) { title = k[0]; color = k[1]; }
  } else if (system === "gb") {
    const h = ascii(bytes, 0x134, 16).toUpperCase();
    code = h;
    const k = KNOWN_GB.find(([re]) => re.test(h));
    if (k) { title = k[1]; color = k[2]; }
  }
  return { system, ext, title, color, code };
}

// ---------- minimal .zip reader (stored + deflate) ----------
async function unzipFirstRom(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This zip file looks damaged.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const ext = name.split(".").pop().toLowerCase();
    if (!ALL_EXTS.includes(ext) || name.endsWith("/")) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser can't unzip files — please extract the ROM first.");
      const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(ds).arrayBuffer());
    } else throw new Error("Unsupported zip compression — please extract the ROM first.");
    return { name: name.split("/").pop(), data };
  }
  throw new Error("No GBA / GB / DS ROM found inside this zip.");
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "game";
}

// Imports one File; returns the saved game record
async function importRomFile(file) {
  let name = file.name;
  let data = new Uint8Array(await file.arrayBuffer());
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "zip") {
    const r = await unzipFirstRom(data.buffer);
    name = r.name; data = r.data;
  } else if (ext === "7z" || ext === "rar") {
    throw new Error(`${file.name}: please extract .${ext} files first, then add the ROM inside.`);
  }
  const info = identify(name, data);
  if (!info) throw new Error(`${file.name}: not a GBA, GB/GBC or DS ROM.`);
  const id = uid();
  const game = {
    id, title: info.title, system: info.system, ext: info.ext, color: info.color, code: info.code,
    fileName: name, size: data.length, added: Date.now(), lastPlayed: 0, playSeconds: 0,
    core: SYSTEMS[info.system].core,
    // stable in-emulator file name → this is what keys the save file + save states
    emuName: `${slug(info.title)}-${id}.${info.ext}`
  };
  await Store.putRom({ id, data: new Blob([data]) });
  await Store.putGame(game);
  return game;
}

function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; }
function fmtAgo(t) {
  if (!t) return "Never played";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 7) return Math.floor(s / 86400) + " d ago";
  return new Date(t).toLocaleDateString();
}
function fmtPlay(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m played` : `${m}m played`;
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("Offline cache unavailable:", e));
  }
}
