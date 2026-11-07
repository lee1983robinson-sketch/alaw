// ALAW: the Leeds United away day hub. No npm packages needed: Node 18+.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./lib/store");
const FX = require("./lib/fixtures");
const GEO = require("./lib/geo");
const LIVE = require("./lib/live");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = (process.env.ADMIN_KEY || "").trim();
const CF_TOKEN = (process.env.CF_ANALYTICS_TOKEN || "").trim();
const PUB = path.join(__dirname, "public");
const VERSION = require("./package.json").version;

/* ---------- small helpers ---------- */
const now = () => Date.now();
const rid = (n = 10) => crypto.randomBytes(n).toString("base64url").slice(0, n);
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const int = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("Too big"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(Object.assign(new Error("Bad JSON"), { code: 400 })); } });
    req.on("error", reject);
  });
}

/* ---------- rate limits (memory) ---------- */
const HITS = new Map();
function limited(key, max, windowMs) {
  const t = now(), arr = (HITS.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) { HITS.set(key, arr); return true; }
  arr.push(t); HITS.set(key, arr); return false;
}
setInterval(() => { const t = now(); for (const [k, v] of HITS) if (!v.length || t - v[v.length - 1] > 3600e3) HITS.delete(k); }, 600e3).unref();

/* ---------- accounts ---------- */
function authUser(req) {
  const h = String(req.headers["x-alaw-auth"] || ""); const [id, key] = h.split(".");
  if (!id || !key) return null;
  const u = store.get("users", id);
  if (!u || u.hash !== sha(key) || u.banned) return null;
  return u;
}
const isAdmin = (req) => ADMIN_KEY.length >= 8 && String(req.headers["x-alaw-admin"] || "") === ADMIN_KEY;
const banned = (uid) => { const u = store.get("users", uid); return !u || !!u.banned; };
const nickOf = (uid) => { const u = store.get("users", uid); return u ? u.nick : "Former fan"; };
const vis = (x) => !!x && !x.hidden && (!x.uid || !banned(x.uid));

/* ---------- stats and badges ---------- */
function statsOf(uid) {
  const fx = new Map(FX.list().map((f) => [f.id, f]));
  const mine = store.all("going").filter((g) => g.uid === uid).map((g) => fx.get(g.fid)).filter(Boolean);
  const past = mine.filter((f) => f.ts < now() - 2 * 3600e3);
  const aways = past.filter((f) => f.isAway), homes = past.filter((f) => !f.isAway);
  const rated = store.all("ratings").filter((r) => r.uid === uid).length;
  const grounds = new Set(aways.map((f) => f.ground));
  const midweek = aways.filter((f) => [2, 3].includes(new Date(f.ts).getUTCDay())).length;
  const posts = store.all("posts").filter((p) => p.uid === uid && !p.hidden);
  const photos = posts.filter((p) => p.kind === "photo").length;
  const pubsAdded = store.all("pubs").filter((p) => p.uid === uid && !p.hidden).length;
  const pubsRated = store.all("pubs").filter((p) => p.votes && p.votes[uid]).length;
  const lifts = store.all("lifts").filter((l) => l.uid === uid).length;
  const u = store.get("users", uid) || {};
  const B = [];
  const add = (id, name, desc, got) => B.push({ id, name, desc, got: !!got });
  add("first", "First away", "Went to an away game", aways.length >= 1);
  add("a10", "Ten aways", "10 away days logged", aways.length >= 10);
  add("a25", "Twenty-five", "25 away days logged", aways.length >= 25);
  add("g10", "Ground hopper", "10 different away grounds", grounds.size >= 10);
  add("mid", "Tuesday nighter", "3 midweek aways", midweek >= 3);
  add("pub", "Pub scout", "Added or rated 5 pubs", pubsAdded + pubsRated >= 5);
  add("drv", "Driver", "Offered a lift", lifts >= 1);
  add("snap", "Snapper", "Shared 10 photos", photos >= 10);
  add("er", "Elland Road regular", "10 home games logged", homes.length >= 10);
  add("rate", "Pundit", "Rated the lads after 5 games", rated >= 5);
  add("og", "Founding fan", "Joined in ALAW's first season", (u.created || now()) < Date.parse("2027-07-01"));
  return {
    games: past.length, aways: aways.length, homes: homes.length, grounds: grounds.size, rated, upcoming: mine.filter((f) => f.ts >= now() - 2 * 3600e3).length,
    photos, pubs: pubsAdded, lifts, badges: B,
    recent: past.sort((a, b) => b.ts - a.ts).slice(0, 12).map((f) => ({ id: f.id, ts: f.ts, home: f.home.name, away: f.away.name, isAway: f.isAway, venue: f.venue.name, score: f.score })),
  };
}
const pubUser = (u) => u && ({ id: u.id, nick: u.nick, from: u.from || "", bio: u.bio || "", since: u.created });

/* ---------- fixtures with counts ---------- */
function goingCount() {
  const c = {}; for (const g of store.all("going")) if (!banned(g.uid)) c[g.fid] = (c[g.fid] || 0) + 1; return c;
}
function fixturesOut(uid) {
  const c = goingCount(); const mine = new Set(uid ? store.all("going").filter((g) => g.uid === uid).map((g) => g.fid) : []);
  return FX.list().map((f) => ({ ...f, going: c[f.id] || 0, mine: mine.has(f.id) }));
}

/* ---------- item views ---------- */
const COLL = { post: "posts", pub: "pubs", meet: "meets", lift: "lifts", ticket: "tickets", club: "branches", lost: "lost", comment: "comments" };
function commentIndex() { const I = {}; for (const c of store.all("comments")) if (vis(c)) (I[c.pid] = I[c.pid] || []).push(c); for (const k in I) I[k].sort((a, b) => a.at - b.at); return I; }
const commentOut = (c, me) => ({ id: c.id, pid: c.pid, uid: c.uid, nick: nickOf(c.uid), text: c.text, at: c.at, mine: !!(me && c.uid === me.id) });
const postOut = (p) => ({ id: p.id, fid: p.fid, kind: p.kind, tag: p.tag || "", uid: p.uid, nick: nickOf(p.uid), text: p.text, img: p.img || null, at: p.at, cheers: (p.cheers || []).length, cheered: false });
function postFor(p, me, CI) {
  const o = postOut(p); o.cheered = !!(me && (p.cheers || []).includes(me.id));
  if (CI) { const L = CI[p.id] || []; o.comments = L.length; o.lastComments = L.slice(-2).map((c) => commentOut(c, me)); }
  return o;
}
function gameLabel(f) { return f ? (f.isAway ? "at " + f.home.name : "v " + f.away.name) : ""; }

/* ---------- notifications ---------- */
function notify(uid, item) {
  if (!uid || (item.from && item.from === uid) || banned(uid)) return;
  const u = store.get("users", uid); if (!u) return;
  if (item.from && (u.blocked || []).includes(item.from)) return;
  const n = store.get("notes", uid) || { uid, items: [], seen: 0 };
  // collapse repeat cheers on the same post
  if (item.type === "cheer") n.items = n.items.filter((x) => !(x.type === "cheer" && x.pid === item.pid && x.from === item.from));
  n.items.push({ ...item, at: now() }); if (n.items.length > 60) n.items = n.items.slice(-60);
  store.put("notes", uid, n);
}

/* ---------- check-ins ---------- */
const CHECK_MS = 3 * 3600e3;
function hereAt(pid) { return store.all("checkins").filter((c) => c.pid === pid && c.at > now() - CHECK_MS && !banned(c.uid)); }
function pubOut(p, me) {
  const v = Object.values(p.votes || {}); const up = v.filter((x) => x > 0).length;
  const tags = Object.entries(p.tags || {}).map(([t, us]) => ({ t, n: us.length, mine: !!(me && us.includes(me.id)) })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const H = hereAt(p.id);
  return { id: p.id, ground: p.ground, name: p.name, address: p.address || "", walk: p.walk ?? null, d: p.d ?? null, lat: p.lat ?? null, lng: p.lng ?? null, kind: p.kind || "pub", source: p.source || "fan", note: p.note || "", uid: p.uid || null, nick: p.uid ? nickOf(p.uid) : "", at: p.at || 0, up, votes: v.length, score: v.length ? Math.round((up / v.length) * 100) : null, myVote: me && p.votes ? p.votes[me.id] || 0 : 0, tags, here: H.length, hereNicks: H.slice(-6).map((c) => nickOf(c.uid)), imHere: !!(me && H.some((c) => c.uid === me.id)) };
}
function ensurePub(id) {
  let x = store.get("pubs", id); if (x) return x;
  if (!/^o[nwr]\d+$/.test(id)) return null;
  const o = GEO.findOsmPub(id); if (!o) return null;
  return store.put("pubs", id, { id, ground: o.ground, name: o.name, lat: o.lat, lng: o.lng, d: o.d, walk: Math.max(1, Math.round(o.d / 80)), kind: o.kind, source: "osm", tags: {}, votes: {}, at: now() });
}
const meetLive = (m) => !m.expires || m.expires > now();
const meetOut = (m, me) => ({ id: m.id, fid: m.fid, kind: m.kind || "meet", lat: m.lat ?? null, lng: m.lng ?? null, pin: !!m.pin, expires: m.expires || null, place: m.place || "", first: !!m.first, uid: m.uid, nick: nickOf(m.uid), title: m.title, where: m.where, time: m.time, details: m.details, at: m.at, count: (m.joined || []).filter((u) => !banned(u)).length, joined: !!(me && (m.joined || []).includes(me.id)), who: (m.joined || []).filter((u) => !banned(u)).slice(0, 12).map(nickOf) });
const liftOut = (l) => ({ id: l.id, fid: l.fid, uid: l.uid, nick: nickOf(l.uid), from: l.from, depart: l.depart, back: l.back, seats: l.seats, cost: l.cost, notes: l.notes, closed: !!l.closed, at: l.at, given: store.all("lifts").filter((x) => x.uid === l.uid).length });
const ticketOut = (t) => ({ id: t.id, fid: t.fid, uid: t.uid, nick: nickOf(t.uid), kind: t.kind, qty: t.qty, area: t.area, notes: t.notes, closed: !!t.closed, at: t.at });

const TIP_TAGS = ["Trains", "Driving & parking", "Buses & park and ride", "At the ground", "Food & drink"];
const TAGS = ["Away-friendly", "Home fans only", "Gets rammed", "Great pre-match", "Shows early game", "Food", "Beer garden", "Near station", "Cheap pints", "Family friendly"];

function groundsList() {
  const G = new Map();
  for (const f of FX.list()) {
    const g = G.get(f.ground) || { key: f.ground, name: f.venue.name || f.home.name, city: f.venue.city, club: f.home.name, next: null, pubs: 0, isHome: !f.isAway };
    if (f.ts > now() - 3 * 3600e3 && (!g.next || f.ts < g.next.ts)) g.next = { id: f.id, ts: f.ts };
    G.set(f.ground, g);
  }
  for (const g of G.values()) { const n = GEO.cached(g.key); if (n) { g.pubs = n.pubs.length; g.center = n.center; } }
  for (const p of store.all("pubs")) if (vis(p) && p.source !== "osm") { const g = G.get(p.ground); if (g) g.pubs++; }
  return [...G.values()].sort((a, b) => (a.next ? a.next.ts : 9e15) - (b.next ? b.next.ts : 9e15));
}
function pubsFor(ground, me) {
  const near = GEO.cached(ground), saved = store.all("pubs").filter((p) => p.ground === ground);
  const byId = new Map(saved.map((p) => [p.id, p]));
  const out = [];
  for (const o of (near && near.pubs) || []) { const p = byId.get(o.id); if (p && !vis(p)) continue; out.push(pubOut(p || { ...o, ground, walk: Math.max(1, Math.round(o.d / 80)), source: "osm" }, me)); byId.delete(o.id); }
  for (const p of byId.values()) if (vis(p)) out.push(pubOut(p, me));
  const score = (p) => p.here * 1000 + (p.score != null ? p.score + p.votes * 2 : -1);
  return out.sort((a, b) => score(b) - score(a) || (a.d ?? 9e9) - (b.d ?? 9e9));
}
function mapFor(ground) { const n = GEO.cached(ground); return n ? { center: n.center, stations: n.stations, parking: n.parking } : null; }

function fixtureDetail(f, me) {
  const c = goingCount();
  const going = store.all("going").filter((g) => g.fid === f.id && !banned(g.uid));
  const posts = store.all("posts").filter((p) => p.fid === f.id && vis(p)).sort((a, b) => a.at - b.at);
  const CI = commentIndex();
  return {
    fixture: { ...f, going: c[f.id] || 0, mine: !!(me && going.some((g) => g.uid === me.id)) },
    who: going.sort((a, b) => b.at - a.at).slice(0, 40).map((g) => ({ id: g.uid, nick: nickOf(g.uid) })),
    chat: posts.filter((p) => p.kind === "chat").slice(-120).map((p) => postFor(p, me)),
    tips: posts.filter((p) => p.kind === "tip").reverse().slice(0, 40).map((p) => postFor(p, me)),
    photos: posts.filter((p) => p.kind === "photo").reverse().slice(0, 120).map((p) => postFor(p, me, CI)),
    posts: posts.filter((p) => p.kind === "post" || p.kind === "photo").reverse().slice(0, 30).map((p) => postFor(p, me, CI)),
    meets: store.all("meets").filter((m) => m.fid === f.id && vis(m) && m.kind !== "watch" && meetLive(m)).sort((a, b) => String(a.time).localeCompare(String(b.time))).map((m) => meetOut(m, me)),
    watch: store.all("meets").filter((m) => m.fid === f.id && vis(m) && m.kind === "watch").sort((a, b) => (b.joined || []).length - (a.joined || []).length).map((m) => meetOut(m, me)),
    lifts: store.all("lifts").filter((l) => l.fid === f.id && vis(l)).sort((a, b) => a.closed - b.closed || b.at - a.at).map(liftOut),
    tickets: store.all("tickets").filter((t) => t.fid === f.id && vis(t)).sort((a, b) => a.closed - b.closed || b.at - a.at).map(ticketOut),
    pubs: pubsFor(f.ground, me), map: mapFor(f.ground), tagList: TAGS, tipTags: TIP_TAGS,
  };
}

/* ---------- fan player ratings ---------- */
const rateOpen = (f) => f.ts < now() - 105 * 60e3 && f.ts > now() - 10 * 864e5;
function rateSummary(f, sq, me) {
  const R = store.all("ratings").filter((r) => r.fid === f.id && !banned(r.uid));
  const players = (sq && (sq.played || (sq.xi ? [...sq.xi, ...(sq.subs || [])] : null))) || [];
  const sum = {}, motm = {};
  for (const r of R) { for (const [pid, v] of Object.entries(r.r || {})) { const o = (sum[pid] = sum[pid] || { t: 0, n: 0 }); o.t += v; o.n++; } if (r.motm) motm[r.motm] = (motm[r.motm] || 0) + 1; }
  const mine = me ? store.get("ratings", `${f.id}:${me.id}`) : null;
  const out = players.map((p) => ({ id: p.id, name: p.name, pos: p.pos || "", min: p.min, sub: !!p.sub, stat: p.stat ?? null, avg: sum[p.id] ? +(sum[p.id].t / sum[p.id].n).toFixed(1) : null, n: sum[p.id] ? sum[p.id].n : 0, motm: motm[p.id] || 0 }));
  const top = [...out].sort((a, b) => b.motm - a.motm)[0];
  return { open: rateOpen(f), final: !!(sq && sq.played), voters: R.length, players: out, mine: mine ? { r: mine.r, motm: mine.motm } : null, motm: top && top.motm ? { id: top.id, name: top.name, votes: top.motm } : null };
}
function lastRateable() {
  const f = FX.list().filter((x) => rateOpen(x)).sort((a, b) => b.ts - a.ts)[0];
  if (!f) return null;
  const v = store.all("ratings").filter((r) => r.fid === f.id).length;
  return { id: f.id, ts: f.ts, home: f.home.name, away: f.away.name, isAway: f.isAway, score: f.score, voters: v };
}

/* ---------- polls ---------- */
function pollOut(pl, me) {
  const counts = pl.options.map((_, i) => Object.values(pl.votes || {}).filter((v) => v === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  return { id: pl.id, q: pl.q, options: pl.options, counts, total, mine: me && pl.votes && pl.votes[me.id] != null ? pl.votes[me.id] : null, closed: !!pl.closed, at: pl.at };
}

/* ---------- DMs ---------- */
const convId = (a, b) => [a, b].sort().join("|");
const blockedBetween = (a, b) => { const A = store.get("users", a), B = store.get("users", b); return !!((A && (A.blocked || []).includes(b)) || (B && (B.blocked || []).includes(a))); };

/* ---------- reports ---------- */
function findItem(type, id) {
  if (type === "user") return store.get("users", id);
  const c = COLL[type]; return c ? store.get(c, id) : null;
}
function previewOf(type, x) {
  if (!x) return "(deleted)";
  if (type === "user") return `User ${x.nick}${x.bio ? ": " + x.bio : ""}`;
  if (type === "post") return (x.kind === "photo" ? "[photo] " : "") + (x.text || "");
  if (type === "pub") return `${x.name} — ${x.address || ""} ${x.note || ""}`;
  if (type === "meet") return `${x.title} @ ${x.where} ${x.details || ""}`;
  if (type === "lift") return `Lift from ${x.from}: ${x.notes || ""}`;
  if (type === "ticket") return `${x.kind} ${x.qty}: ${x.area || ""} ${x.notes || ""}`;
  if (type === "club") return `${x.name} (${x.area}) ${x.contact || ""} ${x.notes || ""}`;
  if (type === "lost") return `${x.kind}: ${x.what} @ ${x.where || ""}`;
  if (type === "comment") return `Comment: ${x.text}`;
  return "";
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname, M = req.method;
  const me = authUser(req);
  const need = () => { if (!me) { send(res, 401, { error: "Join ALAW first (it takes 10 seconds)." }); return false; } return true; };
  const body = M === "POST" ? await readBody(req, p === "/api/photo" ? 1.6 * 1024 * 1024 : 64 * 1024) : {};
  const slow = (k, max, ms) => { if (limited(`${k}:${me ? me.id : ipOf(req)}`, max, ms)) { send(res, 429, { error: "Slow down a bit and try again in a minute." }); return true; } return false; };
  let m;

  if (p === "/api/boot") {
    FX.refresh();
    return send(res, 200, { fixtures: fixturesOut(me && me.id), me: me ? { ...pubUser(me), blocked: me.blocked || [] } : null, fans: store.all("users").filter((u) => !u.banned).length, tags: TAGS, version: VERSION });
  }
  if (p === "/api/status") return send(res, 200, { ok: true, version: VERSION, store: store.status(), fixtures: FX.status(), admin: ADMIN_KEY.length >= 8 });

  /* accounts */
  if (p === "/api/me/create" && M === "POST") {
    if (limited("create:" + ipOf(req), 5, 3600e3)) return send(res, 429, { error: "Too many new accounts from here. Try later." });
    const nick = clean(body.nick, 20).replace(/\s+/g, " ");
    if (!/^[A-Za-z0-9 _.\-']{3,20}$/.test(nick)) return send(res, 400, { error: "Nickname: 3 to 20 letters or numbers." });
    if (store.all("users").some((u) => u.nick.toLowerCase() === nick.toLowerCase())) return send(res, 409, { error: "That nickname's taken. Try another." });
    if (!body.rules) return send(res, 400, { error: "Please agree to the house rules." });
    const id = rid(8), key = rid(24);
    store.put("users", id, { id, nick, from: clean(body.from, 30), bio: "", hash: sha(key), created: now(), blocked: [] });
    return send(res, 200, { id, key, nick });
  }
  if (p === "/api/me" && M === "GET") { if (!need()) return; return send(res, 200, { me: { ...pubUser(me), blocked: me.blocked || [], blockedList: (me.blocked || []).map((id) => ({ id, nick: nickOf(id) })) }, stats: statsOf(me.id) }); }
  if (p === "/api/me/update" && M === "POST") {
    if (!need()) return;
    me.from = clean(body.from, 30); me.bio = clean(body.bio, 160); store.put("users", me.id, me);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/block" && M === "POST") {
    if (!need()) return; const uid = String(body.uid || ""); if (!store.get("users", uid) || uid === me.id) return send(res, 400, { error: "No such fan." });
    me.blocked = (me.blocked || []).filter((x) => x !== uid); if (body.on) me.blocked.push(uid); store.put("users", me.id, me);
    return send(res, 200, { blocked: me.blocked });
  }
  if ((m = p.match(/^\/api\/u\/([\w-]+)$/))) {
    const u = store.get("users", m[1]); if (!u || u.banned) return send(res, 404, { error: "Fan not found." });
    return send(res, 200, { user: pubUser(u), stats: statsOf(u.id) });
  }

  /* fixtures */
  if ((m = p.match(/^\/api\/f\/([\w-]+)$/))) {
    const f = FX.byId(m[1]); if (!f) return send(res, 404, { error: "Fixture not found." });
    const gi = groundsList().find((g) => g.key === f.ground);
    const [sq, inj, lv] = await Promise.all([FX.squad(f).catch(() => null), LIVE.injuries(f).catch(() => null), LIVE.live(f).catch(() => null), gi && !GEO.cached(f.ground) ? Promise.race([GEO.nearby(gi), new Promise((r) => setTimeout(r, 9000))]).catch(() => null) : null]);
    const D = fixtureDetail(f, me); D.squad = sq; D.injuries = inj; D.live = lv; D.rate = rateSummary(f, sq, me);
    return send(res, 200, D);
  }
  if ((m = p.match(/^\/api\/chat\/([\w-]+)$/))) {
    const since = +url.searchParams.get("since") || 0;
    const list = store.all("posts").filter((x) => x.fid === m[1] && x.kind === "chat" && x.at > since && vis(x)).sort((a, b) => a.at - b.at).slice(-120).map((x) => postFor(x, me));
    return send(res, 200, { chat: list });
  }
  if ((m = p.match(/^\/api\/live\/([\w-]+)$/))) { const f = FX.byId(m[1]); if (!f) return send(res, 404, { error: "Fixture not found." }); return send(res, 200, { live: await LIVE.live(f).catch(() => null) }); }
  if (p === "/api/going" && M === "POST") {
    if (!need()) return; const f = FX.byId(String(body.fid || "")); if (!f) return send(res, 404, { error: "Fixture not found." });
    const k = `${f.id}:${me.id}`; if (body.on) store.put("going", k, { fid: f.id, uid: me.id, at: now() }); else store.del("going", k);
    return send(res, 200, { ok: true, going: goingCount()[f.id] || 0 });
  }

  /* posts: chat and travel tips */
  if (p === "/api/post" && M === "POST") {
    if (!need()) return; if (slow("post", 12, 60e3)) return;
    const kind = ["tip", "post"].includes(body.kind) ? body.kind : "chat";
    let fid = String(body.fid || ""); if (kind === "post" && !fid) fid = "general";
    if (fid !== "lounge" && fid !== "general" && !FX.byId(fid)) return send(res, 404, { error: "Fixture not found." });
    const text = clean(body.text, kind === "chat" ? 280 : 1000);
    if (!text) return send(res, 400, { error: "Say something first." });
    const tag = kind === "tip" && TIP_TAGS.includes(body.tag) ? body.tag : "";
    const id = rid(10); const post = store.put("posts", id, { id, fid, kind, tag, uid: me.id, text, at: now(), cheers: [] });
    return send(res, 200, { post: { ...postFor(post, me, {}), game: gameLabel(FX.byId(fid)) } });
  }
  if (p === "/api/photo" && M === "POST") {
    if (!need()) return; if (slow("photo", 20, 3600e3)) return;
    const fid = String(body.fid || "") || "general"; if (fid !== "general" && !FX.byId(fid)) return send(res, 404, { error: "Fixture not found." });
    const mt = String(body.data || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/); if (!mt) return send(res, 400, { error: "That photo didn't come through. Try again." });
    const buf = Buffer.from(mt[1], "base64"); if (buf.length < 2000 || buf.length > 900 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) return send(res, 400, { error: "That photo didn't come through. Try again." });
    const img = rid(14);
    try { await store.putImg(img, buf); } catch (e) { return send(res, 500, { error: "Couldn't save the photo. Try again." }); }
    const id = rid(10); const post = store.put("posts", id, { id, fid, kind: "photo", uid: me.id, text: clean(body.caption, 1000), img, at: now(), cheers: [] });
    return send(res, 200, { post: { ...postFor(post, me, {}), game: gameLabel(FX.byId(fid)) } });
  }
  if (p === "/api/cheer" && M === "POST") {
    if (!need()) return; const x = store.get("posts", String(body.id || "")); if (!vis(x)) return send(res, 404, { error: "Gone." });
    const had = (x.cheers || []).includes(me.id);
    x.cheers = (x.cheers || []).filter((u) => u !== me.id); if (body.on) x.cheers.push(me.id); store.put("posts", x.id, x);
    if (body.on && !had && x.kind !== "chat") notify(x.uid, { type: "cheer", from: me.id, pid: x.id, text: (x.text || "your photo").slice(0, 60) });
    return send(res, 200, { cheers: x.cheers.length });
  }
  if (p === "/api/feed") {
    const before = +url.searchParams.get("before") || 9e15;
    const fx = new Map(FX.list().map((f) => [f.id, f])); const CI = commentIndex();
    const list = store.all("posts").filter((x) => ["post", "photo", "tip"].includes(x.kind) && x.at < before && vis(x)).sort((a, b) => b.at - a.at).slice(0, 15)
      .map((x) => ({ ...postFor(x, me, CI), game: gameLabel(fx.get(x.fid)) }));
    const first = before >= 9e15;
    const out = { feed: list, more: list.length === 15 };
    if (first) {
      out.polls = store.all("polls").filter((x) => !x.closed).sort((a, b) => b.at - a.at).slice(0, 2).map((x) => pollOut(x, me));
      out.rate = lastRateable(); out.table = await LIVE.table().catch(() => null);
      const nx = FX.list().find((f) => f.ts > now() - 165 * 60e3); out.live = nx && LIVE.inWindow(nx) ? { fid: nx.id, ...(await LIVE.live(nx).catch(() => null) || {}) } : null;
      const t = now(); const recent = new Map(); for (const c of store.all("checkins")) if (c.at > t - CHECK_MS && !banned(c.uid)) recent.set(c.pid, (recent.get(c.pid) || 0) + 1);
      out.hot = [...recent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pid, n]) => { const pb = store.get("pubs", pid); return pb ? { id: pid, name: pb.name, ground: pb.ground, n } : null; }).filter(Boolean);
    }
    return send(res, 200, out);
  }
  if (p === "/api/lounge") {
    const lounge = store.all("posts").filter((x) => x.fid === "lounge" && vis(x)).sort((a, b) => a.at - b.at).slice(-80).map((x) => postFor(x, me));
    return send(res, 200, { lounge });
  }
  if (p === "/api/gallery") {
    const before = +url.searchParams.get("before") || 9e15, fid = url.searchParams.get("fid") || "";
    const fx = new Map(FX.list().map((f) => [f.id, f])); const CI = commentIndex();
    const all = store.all("posts").filter((x) => x.kind === "photo" && vis(x));
    const list = all.filter((x) => x.at < before && (!fid || x.fid === fid)).sort((a, b) => b.at - a.at).slice(0, 60).map((x) => ({ ...postFor(x, me, CI), game: gameLabel(fx.get(x.fid)) }));
    const games = [...new Set(all.map((x) => x.fid))].map((id) => fx.get(id)).filter(Boolean).sort((a, b) => b.ts - a.ts).slice(0, 12).map((f) => ({ id: f.id, label: gameLabel(f), ts: f.ts }));
    return send(res, 200, { photos: list, more: list.length === 60, games, total: all.length });
  }
  if ((m = p.match(/^\/api\/post\/([\w-]+)$/))) {
    const x = store.get("posts", m[1]); if (!vis(x)) return send(res, 404, { error: "That post's gone." });
    const CI = commentIndex();
    return send(res, 200, { post: { ...postFor(x, me, CI), game: gameLabel(FX.byId(x.fid)) }, comments: (CI[x.id] || []).filter((c) => !(me && (me.blocked || []).includes(c.uid))).map((c) => commentOut(c, me)) });
  }
  if (p === "/api/comment" && M === "POST") {
    if (!need()) return; if (slow("comment", 15, 60e3)) return;
    const x = store.get("posts", String(body.pid || "")); if (!vis(x)) return send(res, 404, { error: "That post's gone." });
    const text = clean(body.text, 500); if (!text) return send(res, 400, { error: "Say something first." });
    const id = rid(10); const c = store.put("comments", id, { id, pid: x.id, uid: me.id, text, at: now() });
    notify(x.uid, { type: "comment", from: me.id, pid: x.id, text: text.slice(0, 80) });
    for (const uid of new Set(store.all("comments").filter((y) => y.pid === x.id).map((y) => y.uid))) if (uid !== x.uid) notify(uid, { type: "reply", from: me.id, pid: x.id, text: text.slice(0, 80) });
    return send(res, 200, { comment: commentOut(c, me) });
  }
  if (p === "/api/notes") {
    if (!need()) return; const n = store.get("notes", me.id) || { items: [], seen: 0 };
    const items = n.items.filter((x) => !banned(x.from)).slice().reverse().map((x) => ({ ...x, nick: x.from ? nickOf(x.from) : "", unread: x.at > (n.seen || 0) }));
    if (M === "POST") { n.seen = now(); n.uid = me.id; store.put("notes", me.id, n); }
    return send(res, 200, { notes: items, unread: items.filter((x) => x.unread).length });
  }

  /* pubs */
  if (p === "/api/grounds") return send(res, 200, { grounds: groundsList() });
  if ((m = p.match(/^\/api\/g\/([\w-]+)$/))) {
    const g = groundsList().find((x) => x.key === m[1]); if (!g) return send(res, 404, { error: "Ground not found." });
    if (!GEO.cached(g.key)) await Promise.race([GEO.nearby(g), new Promise((r) => setTimeout(r, 9000))]).catch(() => null);
    const meets = g.next ? store.all("meets").filter((x) => x.fid === g.next.id && vis(x) && meetLive(x) && x.lat != null).map((x) => meetOut(x, me)) : [];
    return send(res, 200, { ground: { ...g, center: (GEO.cached(g.key) || {}).center || null }, pubs: pubsFor(g.key, me), map: mapFor(g.key), meets, tagList: TAGS });
  }
  if (p === "/api/pub" && M === "POST") {
    if (!need()) return; if (slow("pub", 10, 3600e3)) return;
    const ground = String(body.ground || ""); if (!groundsList().some((g) => g.key === ground)) return send(res, 404, { error: "Ground not found." });
    const name = clean(body.name, 60); if (name.length < 2) return send(res, 400, { error: "What's the pub called?" });
    if (store.all("pubs").some((x) => x.ground === ground && !x.hidden && x.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: "That pub's already listed. Rate it instead." });
    const tags = {}; for (const t of [].concat(body.tags || [])) if (TAGS.includes(t)) tags[t] = [me.id];
    const id = rid(10);
    const pub = store.put("pubs", id, { id, ground, name, address: clean(body.address, 120), walk: int(body.walk, 0, 120, null), note: clean(body.note, 240), tags, votes: { [me.id]: 1 }, uid: me.id, at: now() });
    return send(res, 200, { pub: pubOut(pub, me) });
  }
  if (p === "/api/pub/vote" && M === "POST") {
    if (!need()) return; const x = ensurePub(String(body.id || "")); if (!vis(x)) return send(res, 404, { error: "Gone." });
    x.votes = x.votes || {}; const v = +body.v; if (v === 1 || v === -1) x.votes[me.id] = v; else delete x.votes[me.id];
    store.put("pubs", x.id, x); return send(res, 200, { pub: pubOut(x, me) });
  }
  if (p === "/api/pub/tag" && M === "POST") {
    if (!need()) return; const x = ensurePub(String(body.id || "")); if (!vis(x) || !TAGS.includes(body.tag)) return send(res, 400, { error: "Can't tag that." });
    x.tags = x.tags || {}; const L = (x.tags[body.tag] || []).filter((u) => u !== me.id); if (body.on) L.push(me.id); x.tags[body.tag] = L;
    store.put("pubs", x.id, x); return send(res, 200, { pub: pubOut(x, me) });
  }

  if (p === "/api/checkin" && M === "POST") {
    if (!need()) return; if (slow("checkin", 20, 3600e3)) return;
    for (const c of store.all("checkins")) if (c.uid === me.id) store.del("checkins", `${c.pid}:${me.id}`);
    if (!body.on) return send(res, 200, { ok: true });
    const x = ensurePub(String(body.id || "")); if (!vis(x)) return send(res, 404, { error: "Gone." });
    store.put("checkins", `${x.id}:${me.id}`, { pid: x.id, ground: x.ground, uid: me.id, at: now() });
    return send(res, 200, { pub: pubOut(x, me) });
  }

  /* meet-ups, lifts, tickets */
  if (p === "/api/meet" && M === "POST") {
    if (!need()) return; if (slow("meet", 6, 3600e3)) return;
    const f = FX.byId(String(body.fid || "")); if (!f) return send(res, 404, { error: "Fixture not found." });
    const kind = body.kind === "watch" ? "watch" : "meet";
    const title = clean(body.title, 60) || (kind === "watch" ? clean(body.where, 60) : ""), where = clean(body.where, 80);
    if (!title || !where) return send(res, 400, { error: kind === "watch" ? "Add the pub or venue." : "Add what it is and where." });
    const lat = +body.lat, lng = +body.lng, hasPin = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    const pin = !!body.pin && hasPin;
    const id = rid(10); const x = store.put("meets", id, { id, fid: f.id, kind, place: clean(body.place, 50), first: !!body.first, uid: me.id, title, where, time: clean(body.time, 5), details: clean(body.details, 300), joined: [me.id], at: now(),
      lat: hasPin ? +lat.toFixed(5) : null, lng: hasPin ? +lng.toFixed(5) : null, pin, expires: pin ? now() + 4 * 3600e3 : null });
    return send(res, 200, { meet: meetOut(x, me) });
  }
  if (p === "/api/meet/join" && M === "POST") {
    if (!need()) return; const x = store.get("meets", String(body.id || "")); if (!vis(x)) return send(res, 404, { error: "Gone." });
    const was = (x.joined || []).includes(me.id);
    x.joined = (x.joined || []).filter((u) => u !== me.id); if (body.on) x.joined.push(me.id); store.put("meets", x.id, x);
    if (body.on && !was) notify(x.uid, { type: "join", from: me.id, fid: x.fid, text: x.title.slice(0, 60) });
    return send(res, 200, { meet: meetOut(x, me) });
  }
  if (p === "/api/lift" && M === "POST") {
    if (!need()) return; if (slow("lift", 6, 3600e3)) return;
    const f = FX.byId(String(body.fid || "")); if (!f) return send(res, 404, { error: "Fixture not found." });
    const from = clean(body.from, 40); if (!from) return send(res, 400, { error: "Where are you setting off from?" });
    if (!body.share) return send(res, 400, { error: "Please confirm it's petrol money only." });
    const id = rid(10); const x = store.put("lifts", id, { id, fid: f.id, uid: me.id, from, depart: clean(body.depart, 5), back: clean(body.back, 5), seats: int(body.seats, 1, 7, 1), cost: int(body.cost, 0, 60, 0), notes: clean(body.notes, 240), closed: false, at: now() });
    return send(res, 200, { lift: liftOut(x) });
  }
  if (p === "/api/ticket" && M === "POST") {
    if (!need()) return; if (slow("ticket", 6, 3600e3)) return;
    const f = FX.byId(String(body.fid || "")); if (!f) return send(res, 404, { error: "Fixture not found." });
    if (!body.official) return send(res, 400, { error: "Please confirm it goes through the club's official ticket transfer." });
    const id = rid(10); const x = store.put("tickets", id, { id, fid: f.id, uid: me.id, kind: body.kind === "wanted" ? "wanted" : "spare", qty: int(body.qty, 1, 6, 1), area: clean(body.area, 60), notes: clean(body.notes, 240), closed: false, at: now() });
    return send(res, 200, { ticket: ticketOut(x) });
  }
  if (p === "/api/close" && M === "POST") {
    if (!need()) return; const c = { lift: "lifts", ticket: "tickets", lost: "lost" }[body.type]; const x = c && store.get(c, String(body.id || ""));
    if (!x || x.uid !== me.id) return send(res, 403, { error: "Not yours." });
    x.closed = !!body.on; store.put(c, x.id, x); return send(res, 200, { ok: true });
  }
  if (p === "/api/delete" && M === "POST") {
    const c = COLL[body.type]; const x = c && store.get(c, String(body.id || ""));
    if (!x) return send(res, 404, { error: "Gone." });
    if (!(me && x.uid === me.id) && !isAdmin(req)) return send(res, 403, { error: "Not yours." });
    if (x.img) store.delImg(x.img);
    if (c === "posts") for (const cm of store.all("comments")) if (cm.pid === x.id) store.del("comments", cm.id);
    store.del(c, x.id); return send(res, 200, { ok: true });
  }

  /* fan player ratings */
  if (p === "/api/rate" && M === "POST") {
    if (!need()) return; const f = FX.byId(String(body.fid || "")); if (!f) return send(res, 404, { error: "Fixture not found." });
    if (!rateOpen(f)) return send(res, 400, { error: "Ratings open after the final whistle." });
    const sq = await FX.squad(f).catch(() => null); const ids = new Set(((sq && (sq.played || [...(sq.xi || []), ...(sq.subs || [])])) || []).map((x) => String(x.id)));
    const r = {}; for (const [pid, v] of Object.entries(body.r || {})) { const n = int(v, 1, 10, 0); if (ids.has(String(pid)) && n) r[pid] = n; }
    if (!Object.keys(r).length) return send(res, 400, { error: "Rate at least one player." });
    const motm = ids.has(String(body.motm)) ? String(body.motm) : null;
    store.put("ratings", `${f.id}:${me.id}`, { fid: f.id, uid: me.id, r, motm, at: now() });
    return send(res, 200, { rate: rateSummary(f, sq, me) });
  }

  /* polls */
  if (p === "/api/poll/vote" && M === "POST") {
    if (!need()) return; const pl = store.get("polls", String(body.id || "")); if (!pl || pl.closed) return send(res, 400, { error: "That poll's closed." });
    const i = int(body.opt, 0, pl.options.length - 1, -1); if (i < 0) return send(res, 400, { error: "Pick an option." });
    pl.votes = pl.votes || {}; pl.votes[me.id] = i; store.put("polls", pl.id, pl); return send(res, 200, { poll: pollOut(pl, me) });
  }

  /* supporters' clubs */
  if (p === "/api/clubs") return send(res, 200, { clubs: store.all("branches").filter(vis).sort((a, b) => (a.country || "").localeCompare(b.country || "") || a.area.localeCompare(b.area)).map((c) => ({ id: c.id, name: c.name, area: c.area, country: c.country || "", contact: c.contact || "", coach: !!c.coach, notes: c.notes || "", uid: c.uid, nick: nickOf(c.uid) })) });
  if (p === "/api/club" && M === "POST") {
    if (!need()) return; if (slow("club", 5, 3600e3)) return;
    const name = clean(body.name, 60), area = clean(body.area, 40); if (!name || !area) return send(res, 400, { error: "Add the branch name and area." });
    if (store.all("branches").some((c) => !c.hidden && c.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: "That branch is already listed." });
    const contact = clean(body.contact, 120); if (/(\+?\d[\d\s]{8,})/.test(contact)) return send(res, 400, { error: "Please use the branch's public page or email, not a phone number." });
    const id = rid(10); store.put("branches", id, { id, name, area, country: clean(body.country, 30) || "England", contact, coach: !!body.coach, notes: clean(body.notes, 240), uid: me.id, at: now() });
    return send(res, 200, { ok: true });
  }

  /* lost and found */
  if (p === "/api/lost" && M === "GET") {
    const fx = new Map(FX.list().map((f) => [f.id, f]));
    return send(res, 200, { lost: store.all("lost").filter((x) => vis(x) && x.at > now() - 60 * 864e5).sort((a, b) => a.closed - b.closed || b.at - a.at).map((x) => { const f = fx.get(x.fid); return { id: x.id, kind: x.kind, what: x.what, where: x.where, fid: x.fid, game: f ? (f.isAway ? "at " + f.home.name : "v " + f.away.name) : "", uid: x.uid, nick: nickOf(x.uid), closed: !!x.closed, at: x.at }; }) });
  }
  if (p === "/api/lost" && M === "POST") {
    if (!need()) return; if (slow("lost", 6, 3600e3)) return;
    const what = clean(body.what, 80); if (!what) return send(res, 400, { error: "What was it?" });
    const id = rid(10); store.put("lost", id, { id, kind: body.kind === "found" ? "found" : "lost", what, where: clean(body.where, 80), fid: FX.byId(String(body.fid || "")) ? String(body.fid) : null, uid: me.id, closed: false, at: now() });
    return send(res, 200, { ok: true });
  }

  /* reports */
  if (p === "/api/report" && M === "POST") {
    if (!need()) return; if (slow("report", 20, 3600e3)) return;
    const type = String(body.type || ""), id = String(body.id || ""); const x = findItem(type, id);
    if (!x) return send(res, 404, { error: "Gone." });
    const rk = `${type}:${id}`; const r = store.get("reports", rk) || { id: rk, type, target: id, by: [], reasons: [], at: now(), status: "open" };
    if (!r.by.includes(me.id)) { r.by.push(me.id); r.reasons.push(clean(body.reason, 140) || "No reason given"); }
    r.status = "open"; r.last = now(); store.put("reports", rk, r);
    if (type !== "user" && r.by.length >= 3 && !x.hidden) { x.hidden = true; x.autoHidden = true; store.put(COLL[type], x.id, x); }
    return send(res, 200, { ok: true });
  }

  /* direct messages */
  if (p === "/api/inbox") {
    if (!need()) return;
    const list = store.all("dms").filter((c) => c.a === me.id || c.b === me.id).map((c) => {
      const other = c.a === me.id ? c.b : c.a; const last = c.msgs[c.msgs.length - 1] || {};
      return { uid: other, nick: nickOf(other), last: last.t || "", at: last.at || 0, unread: !!(last.f && last.f !== me.id && ((c.seen || {})[me.id] || 0) < last.at) };
    }).filter((x) => !banned(x.uid) && !(me.blocked || []).includes(x.uid)).sort((a, b) => b.at - a.at);
    return send(res, 200, { inbox: list, unread: list.filter((x) => x.unread).length });
  }
  if ((m = p.match(/^\/api\/dm\/([\w-]+)$/)) && M === "GET") {
    if (!need()) return; const other = store.get("users", m[1]); if (!other || other.banned) return send(res, 404, { error: "Fan not found." });
    const c = store.get("dms", convId(me.id, other.id));
    if (c) { c.seen = c.seen || {}; c.seen[me.id] = now(); store.put("dms", c.id, c); }
    return send(res, 200, { with: pubUser(other), msgs: c ? c.msgs.map((x) => ({ mine: x.f === me.id, t: x.t, at: x.at })) : [], blocked: blockedBetween(me.id, other.id) });
  }
  if (p === "/api/dm" && M === "POST") {
    if (!need()) return; if (slow("dm", 30, 600e3)) return;
    const other = store.get("users", String(body.to || "")); if (!other || other.banned || other.id === me.id) return send(res, 404, { error: "Fan not found." });
    if (blockedBetween(me.id, other.id)) return send(res, 403, { error: "You can't message this fan." });
    const t = clean(body.text, 500); if (!t) return send(res, 400, { error: "Say something first." });
    const id = convId(me.id, other.id); const c = store.get("dms", id) || { id, a: me.id, b: other.id, msgs: [], seen: {} };
    c.msgs.push({ f: me.id, t, at: now() }); if (c.msgs.length > 200) c.msgs = c.msgs.slice(-200); c.seen = c.seen || {}; c.seen[me.id] = now();
    store.put("dms", id, c); return send(res, 200, { ok: true });
  }

  /* admin */
  if (p.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return send(res, 403, { error: "Admin key wrong." });
    if (p === "/api/admin/overview") {
      const reps = store.all("reports").filter((r) => r.status === "open").sort((a, b) => (b.last || b.at) - (a.last || a.at)).map((r) => {
        const x = findItem(r.type, r.target);
        return { ...r, count: r.by.length, preview: previewOf(r.type, x), img: x && x.img ? x.img : null, uid: r.type === "user" ? r.target : x && x.uid, nick: r.type === "user" ? (x && x.nick) : x && nickOf(x.uid), hidden: !!(x && x.hidden), banned: !!(x && (r.type === "user" ? x.banned : banned(x.uid))) };
      });
      const manual = FX.list().filter((f) => f.source === "manual");
      const polls = store.all("polls").sort((a, b) => b.at - a.at).slice(0, 10).map((x) => pollOut(x, null));
      const grounds = groundsList().map((g) => ({ key: g.key, name: g.name, pubs: g.pubs, located: !!GEO.cached(g.key) }));
      return send(res, 200, { reports: reps, counts: store.status().counts, fixtures: FX.status(), manual, polls, grounds, geo: GEO.status() });
    }
    if (p === "/api/admin/act" && M === "POST") {
      const { type, id, action } = body;
      if (action === "dismiss") { const r = store.get("reports", `${type}:${id}`); if (r) { r.status = "done"; store.put("reports", r.id, r); } return send(res, 200, { ok: true }); }
      if (action === "ban" || action === "unban") {
        const uid = String(body.uid || ""); const u = store.get("users", uid); if (!u) return send(res, 404, { error: "No user." });
        u.banned = action === "ban"; store.put("users", uid, u); return send(res, 200, { ok: true });
      }
      const c = COLL[type]; const x = c && store.get(c, String(id || "")); if (!x) return send(res, 404, { error: "Gone." });
      if (action === "hide" || action === "unhide") { x.hidden = action === "hide"; store.put(c, x.id, x); }
      if (action === "delete") { if (x.img) store.delImg(x.img); store.del(c, x.id); }
      const r = store.get("reports", `${type}:${id}`); if (r) { r.status = "done"; store.put("reports", r.id, r); }
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/fixture" && M === "POST") {
      if (body.remove) { FX.removeManual(String(body.remove)); return send(res, 200, { ok: true }); }
      const f = FX.addManual({ opponent: clean(body.opponent, 40), home: !!body.home, date: body.date, venue: clean(body.venue, 60), city: clean(body.city, 40), league: clean(body.league, 40) });
      return f ? send(res, 200, { fixture: f }) : send(res, 400, { error: "Need an opponent and a date." });
    }
    if (p === "/api/admin/poll" && M === "POST") {
      if (body.close) { const pl = store.get("polls", String(body.close)); if (pl) { pl.closed = true; store.put("polls", pl.id, pl); } return send(res, 200, { ok: true }); }
      const q = clean(body.q, 120), options = [].concat(body.options || []).map((o) => clean(o, 50)).filter(Boolean).slice(0, 6);
      if (!q || options.length < 2) return send(res, 400, { error: "Need a question and at least 2 options." });
      const id = rid(8); store.put("polls", id, { id, q, options, votes: {}, at: now() }); return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/ground" && M === "POST") {
      const g = groundsList().find((x) => x.key === String(body.key || "")); if (!g) return send(res, 404, { error: "Ground not found." });
      const mm = String(body.coords || "").match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/); if (!mm) return send(res, 400, { error: "Paste coordinates like 53.7778, -1.5721" });
      GEO.setGeo(g.key, +mm[1], +mm[2]); const n = await GEO.nearby(g); return send(res, 200, { ok: true, pubs: n ? n.pubs.length : 0 });
    }
    if (p === "/api/admin/refresh" && M === "POST") { await FX.refresh(true); return send(res, 200, { fixtures: FX.status() }); }
  }
  return send(res, 404, { error: "Not found" });
}

/* ---------- static files ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
let INDEX = null;
function indexHtml() {
  if (INDEX) return INDEX;
  let h = fs.readFileSync(path.join(PUB, "index.html"), "utf8").replace(/__VERSION__/g, VERSION);
  if (CF_TOKEN) h = h.replace("</body>", `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${CF_TOKEN.replace(/[^\w-]/g, "")}"}'></script></body>`);
  return (INDEX = h);
}
const SEC = {
  "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(self), microphone=(), camera=()",
  "content-security-policy": "default-src 'self'; img-src 'self' data: blob: https://*.basemaps.cartocdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'",
};
async function serveStatic(req, res, url) {
  let m;
  if ((m = url.pathname.match(/^\/img\/([\w-]{14})\.jpg$/))) {
    const buf = await store.getImg(m[1]);
    if (!buf) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable", ...SEC }); return res.end(buf);
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.join(PUB, rel);
  if (rel && file.startsWith(PUB + path.sep) && rel !== "index.html" && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": rel === "sw.js" ? "no-cache" : "public, max-age=3600", ...SEC });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache", ...SEC });
  res.end(indexHtml());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.code || 500, { error: e.code === 413 ? "That's too big." : e.code === 400 ? "Bad request." : "Something went wrong." });
    if (!e.code) console.error(e);
  }
});

store.init().then(() => {
  FX.refresh(true);
  setInterval(() => FX.refresh(), 30 * 60e3).unref();
  const warm = async () => { for (const g of groundsList().filter((x) => x.next).slice(0, 8)) { if (!GEO.cached(g.key)) await GEO.nearby(g).catch(() => null); } };
  setTimeout(warm, 20e3); setInterval(warm, 6 * 3600e3).unref();
  setInterval(() => { const t = now(); for (const c of store.all("checkins")) if (c.at < t - CHECK_MS) store.del("checkins", `${c.pid}:${c.uid}`); }, 30 * 60e3).unref();
  server.listen(PORT, () => console.log(`ALAW ${VERSION} on port ${PORT} (store: ${store.status().mode}, fixtures key: ${FX.status().hasKey ? "yes" : "no"})`));
});
