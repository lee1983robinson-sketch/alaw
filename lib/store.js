// Permanent storage for ALAW.
// Uses Upstash Redis when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (the same database
// StatsPack uses is fine: everything here is kept under "alaw:" so the two never mix).
// Without them it falls back to local files, which Render's free plan wipes on every update.
// Records are mirrored in memory, so reads cost nothing; photos are fetched on demand and cached.
const fs = require("fs");
const path = require("path");

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
const TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const DIR = path.join(__dirname, "..", "cache");
const FILE = path.join(DIR, "db.json");
const IMG_DIR = path.join(DIR, "img");
const COLLECTIONS = ["users", "going", "posts", "pubs", "meets", "lifts", "tickets", "dms", "reports", "meta", "ratings", "polls", "branches", "lost", "comments", "checkins", "notes"];
const DB = Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
const S = { mode: URL_ && TOKEN ? "upstash" : "file", ready: false, error: null, writes: 0 };

async function cmd(args) {
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j.result;
}
const key = (c) => `alaw:${c}`;

async function init() {
  if (S.mode === "upstash") {
    try {
      for (const c of COLLECTIONS) {
        const flat = (await cmd(["HGETALL", key(c)])) || [];
        for (let i = 0; i < flat.length; i += 2) { try { DB[c][flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip bad row */ } }
      }
      S.ready = true;
      console.log(`[store] Upstash connected: ${COLLECTIONS.map((c) => `${Object.keys(DB[c]).length} ${c}`).join(", ")}`);
    } catch (e) { S.error = e.message; console.warn("[store] Upstash failed, using local file:", e.message); S.mode = "file"; }
  }
  if (S.mode === "file") {
    try { const j = JSON.parse(fs.readFileSync(FILE, "utf8")); for (const c of COLLECTIONS) Object.assign(DB[c], j[c] || {}); } catch (e) { /* new file */ }
    S.ready = true;
  }
}
let fileTimer = null;
function saveFile() { clearTimeout(fileTimer); fileTimer = setTimeout(() => { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(DB)); } catch (e) {} }, 500); }

const get = (c, id) => DB[c][id] || null;
const all = (c) => Object.values(DB[c]);
function put(c, id, obj) {
  DB[c][id] = obj; S.writes++;
  if (S.mode === "upstash") cmd(["HSET", key(c), id, JSON.stringify(obj)]).catch((e) => { S.error = e.message; console.warn("[store] write failed:", e.message); });
  else saveFile();
  return obj;
}
function del(c, id) {
  delete DB[c][id];
  if (S.mode === "upstash") cmd(["HDEL", key(c), id]).catch(() => {}); else saveFile();
}

/* ---- photos: stored one per key, base64 JPEG, cached in memory (about 40 MB) ---- */
const IMG = new Map(); let imgBytes = 0; const IMG_CAP = 40 * 1024 * 1024;
function remember(id, buf) {
  if (IMG.has(id)) return; IMG.set(id, buf); imgBytes += buf.length;
  while (imgBytes > IMG_CAP && IMG.size) { const [k, v] = IMG.entries().next().value; IMG.delete(k); imgBytes -= v.length; }
}
async function putImg(id, buf) {
  if (S.mode === "upstash") await cmd(["SET", `alaw:img:${id}`, buf.toString("base64")]);
  else { fs.mkdirSync(IMG_DIR, { recursive: true }); fs.writeFileSync(path.join(IMG_DIR, id + ".jpg"), buf); }
  remember(id, buf);
}
async function getImg(id) {
  if (IMG.has(id)) { const b = IMG.get(id); IMG.delete(id); IMG.set(id, b); return b; }
  let buf = null;
  try {
    if (S.mode === "upstash") { const s = await cmd(["GET", `alaw:img:${id}`]); if (s) buf = Buffer.from(s, "base64"); }
    else buf = fs.readFileSync(path.join(IMG_DIR, id + ".jpg"));
  } catch (e) { buf = null; }
  if (buf) remember(id, buf);
  return buf;
}
function delImg(id) {
  IMG.delete(id);
  if (S.mode === "upstash") cmd(["DEL", `alaw:img:${id}`]).catch(() => {}); else { try { fs.unlinkSync(path.join(IMG_DIR, id + ".jpg")); } catch (e) {} }
}

const status = () => ({ mode: S.mode, ready: S.ready, error: S.error, writes: S.writes, imgCacheMB: +(imgBytes / 1048576).toFixed(1), counts: Object.fromEntries(COLLECTIONS.map((c) => [c, Object.keys(DB[c]).length])) });

module.exports = { init, get, all, put, del, putImg, getImg, delImg, status };
