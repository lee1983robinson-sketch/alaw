// Leeds United fixtures from API-Football (one small call every few hours), plus any added by hand in Admin.
// Kept in storage so they survive restarts; nothing is invented when there is no data.
const store = require("./store");

const BASE = process.env.AF_BASE || "https://v3.football.api-sports.io";
const KEY = (process.env.API_FOOTBALL_KEY || "").trim();
const TEAM = +(process.env.LEEDS_TEAM_ID || 63);
const EVERY = 4 * 3600 * 1000;
const S = { last: 0, error: null, calls: 0 };

const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const seasonNow = (d = new Date()) => (d.getUTCMonth() >= 5 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);

function shape(f) {
  const fx = f.fixture || {}, t = f.teams || {}, g = f.goals || {}, lg = f.league || {}, v = fx.venue || {};
  const isAway = t.away && t.away.id === TEAM;
  return {
    id: "af" + fx.id, date: fx.date, ts: (fx.timestamp || 0) * 1000,
    home: { id: t.home && t.home.id, name: t.home && t.home.name }, away: { id: t.away && t.away.id, name: t.away && t.away.name },
    venue: { name: v.name || "", city: v.city || "" }, ground: v.id ? "v" + v.id : slug(v.name || (isAway ? t.home && t.home.name : "elland-road")),
    league: lg.name || "", round: lg.round || "", status: (fx.status && fx.status.short) || "NS",
    score: g.home == null ? null : [g.home, g.away], isAway, leeds: isAway ? "away" : "home", source: "api",
  };
}

async function refresh(force) {
  if (!KEY) return;
  if (!force && Date.now() - S.last < EVERY) return;
  S.last = Date.now();
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${BASE}/fixtures?team=${TEAM}&season=${seasonNow()}`, { signal: ctrl.signal, headers: { "x-apisports-key": KEY, accept: "application/json" } });
    clearTimeout(tm); S.calls++;
    const j = await res.json();
    const errs = j.errors && Object.values(j.errors).join("; ");
    if (errs) throw new Error(errs);
    const list = (j.response || []).map(shape).sort((a, b) => a.ts - b.ts);
    if (list.length) { store.put("meta", "fixtures", { at: Date.now(), season: seasonNow(), list }); S.error = null; }
    else S.error = "No fixtures returned";
  } catch (e) { S.error = e.message; console.warn("[fixtures]", e.message); }
}

function list() {
  const api = (store.get("meta", "fixtures") || {}).list || [];
  const manual = (store.get("meta", "manual") || {}).list || [];
  const out = [...api, ...manual.filter((m) => !api.some((a) => Math.abs(a.ts - m.ts) < 6 * 3600e3 && a.ground === m.ground))];
  return out.sort((a, b) => a.ts - b.ts);
}
const byId = (id) => list().find((f) => f.id === id) || null;

function addManual({ opponent, home, date, venue, city, league }) {
  const ts = Date.parse(date); if (!opponent || !ts) return null;
  const isAway = !home;
  const f = {
    id: "m" + ts.toString(36) + slug(opponent).slice(0, 8), date: new Date(ts).toISOString(), ts,
    home: { name: isAway ? opponent : "Leeds United" }, away: { name: isAway ? "Leeds United" : opponent },
    venue: { name: venue || (isAway ? "" : "Elland Road"), city: city || (isAway ? "" : "Leeds") },
    ground: slug(venue || (isAway ? opponent : "elland-road")), league: league || "", round: "", status: "NS", score: null,
    isAway, leeds: isAway ? "away" : "home", source: "manual",
  };
  const m = store.get("meta", "manual") || { list: [] }; m.list = [...m.list.filter((x) => x.id !== f.id), f];
  store.put("meta", "manual", m); return f;
}
function removeManual(id) { const m = store.get("meta", "manual") || { list: [] }; m.list = m.list.filter((x) => x.id !== id); store.put("meta", "manual", m); }

/* ---- team news and who played (two tiny calls per game, only when someone looks) ---- */
const SQ_TRY = new Map();
async function af(pathq) {
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${BASE}/${pathq}`, { signal: ctrl.signal, headers: { "x-apisports-key": KEY, accept: "application/json" } });
    S.calls++; const j = await res.json(); return j.response || [];
  } finally { clearTimeout(tm); }
}
const FINISHED = ["FT", "AET", "PEN"];
async function squad(f) {
  if (!f || !f.id.startsWith("af")) return null;
  const k = "lu:" + f.id, have = store.get("meta", k);
  if (have && have.played) return have;
  const t = Date.now(), soon = f.ts - t < 80 * 60e3, over = t > f.ts + 115 * 60e3;
  if (!KEY || !soon) return have || null;
  if (t - (SQ_TRY.get(f.id) || 0) < (over ? 20 : 8) * 60e3) return have || null;
  SQ_TRY.set(f.id, t);
  const n = f.id.slice(2), out = have ? { ...have } : { fid: f.id };
  try {
    if (!out.xi) {
      const L = (await af(`fixtures/lineups?fixture=${n}`)).find((x) => x.team && x.team.id === TEAM);
      if (L && L.startXI && L.startXI.length) {
        const P = (x) => ({ id: x.player.id, name: x.player.name, num: x.player.number, pos: x.player.pos });
        out.xi = L.startXI.map(P); out.subs = (L.substitutes || []).map(P); out.formation = L.formation || ""; out.coach = (L.coach && L.coach.name) || "";
      }
    }
    if (over && (FINISHED.includes(f.status) || t > f.ts + 3 * 3600e3)) {
      const T = (await af(`fixtures/players?fixture=${n}`)).find((x) => x.team && x.team.id === TEAM);
      if (T && T.players && T.players.length) {
        out.played = T.players.map((p) => { const g = (p.statistics && p.statistics[0] && p.statistics[0].games) || {}; return { id: p.player.id, name: p.player.name, pos: g.position || "", min: g.minutes || 0, sub: !!g.substitute, stat: g.rating ? +(+g.rating).toFixed(1) : null }; })
          .filter((p) => p.min > 0).sort((a, b) => a.sub - b.sub || "GDMF".indexOf(a.pos) - "GDMF".indexOf(b.pos));
      }
    }
    if (out.xi || out.played) store.put("meta", k, out);
  } catch (e) { S.error = "squad: " + e.message; }
  return out.xi || out.played ? out : null;
}

const status = () => ({ hasKey: !!KEY, team: TEAM, season: seasonNow(), lastTry: S.last, calls: S.calls, error: S.error, count: list().length, savedAt: (store.get("meta", "fixtures") || {}).at || null });

module.exports = { refresh, list, byId, addManual, removeManual, status, slug, squad, FINISHED };
