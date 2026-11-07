// Live score and events during Leeds games, injury news before them, and the league table.
// Every call is cached on the server, so a thousand fans watching costs the same as one.
const store = require("./store");
const FX = require("./fixtures");

const LIVE = new Map(); // fid -> { at, data }
const LIVE_STATUS = ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];
const inWindow = (f) => { const t = Date.now(); return t > f.ts - 15 * 60e3 && t < f.ts + 165 * 60e3; };

async function live(f) {
  if (!f || !f.id.startsWith("af") || !FX.hasKey()) return null;
  const c = LIVE.get(f.id);
  if (!inWindow(f)) return c ? c.data : null;
  if (c && Date.now() - c.at < 55e3) return c.data;
  LIVE.set(f.id, { at: Date.now(), data: c ? c.data : null });
  try {
    const r = (await FX.af(`fixtures?id=${f.id.slice(2)}`))[0]; if (!r) return c ? c.data : null;
    const st = r.fixture.status || {}, g = r.goals || {};
    const ev = (r.events || []).map((e) => ({
      min: (e.time && e.time.elapsed) || 0, extra: (e.time && e.time.extra) || null, leeds: !!(e.team && e.team.id === FX.TEAM),
      type: e.type === "Goal" ? (e.detail === "Missed Penalty" ? "miss" : e.detail === "Own Goal" ? "og" : "goal") : e.type === "Card" ? (/Red/.test(e.detail) ? "red" : "yellow") : e.type === "subst" ? "sub" : e.type === "Var" ? "var" : "other",
      player: (e.player && e.player.name) || "", assist: (e.assist && e.assist.name) || "", detail: e.detail || "",
    })).filter((e) => e.type !== "other");
    const data = { status: st.short || "NS", elapsed: st.elapsed || null, score: g.home == null ? null : [g.home, g.away], events: ev, at: Date.now() };
    LIVE.set(f.id, { at: Date.now(), data });
    // keep the stored fixture's status and score up to date
    const M = store.get("meta", "fixtures");
    if (M && M.list) { const x = M.list.find((y) => y.id === f.id); if (x && (x.status !== data.status || JSON.stringify(x.score) !== JSON.stringify(data.score))) { x.status = data.status; x.score = data.score; store.put("meta", "fixtures", M); } }
    return data;
  } catch (e) { return c ? c.data : null; }
}
const isLive = (d) => !!(d && LIVE_STATUS.includes(d.status));

async function injuries(f) {
  if (!f || !f.id.startsWith("af") || !FX.hasKey()) return null;
  const k = "inj:" + f.id, have = store.get("meta", k);
  const t = Date.now();
  if (f.ts - t > 4 * 864e5 || t > f.ts + 3 * 3600e3) return have ? have.list : null;
  if (have && t - have.at < 6 * 3600e3) return have.list;
  try {
    const L = (await FX.af(`injuries?fixture=${f.id.slice(2)}`)).filter((x) => x.team && x.team.id === FX.TEAM)
      .map((x) => ({ name: x.player.name, out: x.player.type !== "Questionable", reason: x.player.reason || "" }));
    store.put("meta", k, { at: t, list: L }); return L;
  } catch (e) { return have ? have.list : null; }
}

async function table() {
  if (!FX.hasKey()) return null;
  const have = store.get("meta", "table");
  if (have && Date.now() - have.at < 6 * 3600e3) return have;
  try {
    const r = (await FX.af(`standings?team=${FX.TEAM}&season=${FX.seasonNow()}`))[0];
    const lg = r && r.league; if (!lg) return have || null;
    const rows = (lg.standings || []).flat(); const me = rows.find((x) => x.team && x.team.id === FX.TEAM); if (!me) return have || null;
    const out = { at: Date.now(), league: lg.name, rank: me.rank, points: me.points, played: me.all.played, gd: me.goalsDiff, form: me.form || "", w: me.all.win, d: me.all.draw, l: me.all.lose };
    store.put("meta", "table", out); return out;
  } catch (e) { return have || null; }
}

module.exports = { live, isLive, injuries, table, inWindow };
