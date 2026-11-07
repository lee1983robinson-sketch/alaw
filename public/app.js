/* ALAW app: one page, hash routes, no frameworks. */
(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
const H = 3600e3, NOW = () => Date.now();

let AUTH = LS.get("alawAuth"), ADMIN = LS.get("alawAdmin");
let BOOT = { fixtures: [], me: null, fans: 0, tags: [] }, ME = null, UNREAD = 0;
let FD = null; // current fixture detail
let TIMER = null, LTIMER = null, NOTES = 0, ATTACH = null, MAP = null, GAL = [], VIEWSRC = [];
const APP = $("#app"), NAV = $("#nav");

/* ---------- api ---------- */
async function api(path, body) {
  const headers = { "content-type": "application/json" };
  if (AUTH) headers["x-alaw-auth"] = AUTH;
  if (ADMIN) headers["x-alaw-admin"] = ADMIN;
  let r;
  try { r = await fetch("/api" + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error("No signal? Check your connection and try again."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Something went wrong."), { status: r.status });
  return j;
}

/* ---------- small bits ---------- */
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
const TZ = { timeZone: "Europe/London" };
const fmtDay = (ts) => new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...TZ });
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...TZ });
const wk = (ts) => new Date(ts).toLocaleDateString("en-GB", { weekday: "short", ...TZ });
const dm = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...TZ });
function until(ts) {
  const d = Math.round((new Date(new Date(ts).toLocaleDateString("en-CA", TZ)) - new Date(new Date().toLocaleDateString("en-CA", TZ))) / 864e5);
  if (ts < NOW() && ts > NOW() - 2.5 * H) return "On now";
  if (d === 0) return "Today"; if (d === 1) return "Tomorrow"; if (d > 1 && d < 14) return `In ${d} days`; if (d >= 14) return `In ${Math.round(d / 7)} weeks`; return "";
}
function ago(ts) { const s = (NOW() - ts) / 1000; if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; if (s < 7 * 86400) return Math.floor(s / 86400) + "d"; return dm(ts); }
const COLORS = ["#FFCD00", "#7FA7FF", "#7BD88F", "#FF9F7A", "#C9A7FF", "#6FD3E0", "#F7A8C8"];
function av(nick, cls = "") { let h = 0; for (const c of String(nick)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `<span class="av ${cls}" aria-hidden="true" style="background:${COLORS[h % COLORS.length]}">${esc(String(nick || "?").trim().charAt(0).toUpperCase())}</span>`; }
const short = (n) => String(n || "").replace(/^Leeds United$/, "Leeds").replace(/ FC$| AFC$/, "");
const opp = (f) => (f.isAway ? f.home.name : f.away.name);
const past = (f) => f.ts < NOW() - 2 * H;
function titleOf(f) { return f.isAway ? `Leeds <span class="muted">at</span> <span class="y">${esc(short(f.home.name))}</span>` : `Leeds <span class="muted">v</span> <span class="y">${esc(short(f.away.name))}</span>`; }
function resultOf(f) {
  if (!f.score) return "";
  const [h, a] = f.score, us = f.isAway ? a : h, them = f.isAway ? h : a;
  const r = us > them ? "W" : us < them ? "L" : "D";
  return `<span class="chip ${r === "W" ? "good" : r === "L" ? "bad" : ""}">${r} ${us}-${them}</span>`;
}
const isBlocked = (uid) => !!(ME && (ME.blocked || []).includes(uid));

const I = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  home: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pint: '<path d="M6 4h10v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M16 8h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><path d="M6 8h10"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-4M15 21l2-4"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="16" r="1.5"/><circle cx="16.5" cy="16" r="1.5"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V5H3z"/><path d="M14 5v11"/>',
  medal: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5L7 22l5-3 5 3-1.5-7.5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
};
const ic = (n, s = 20, extra = "") => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${I[n]}</svg>`;

/* ---------- nav and shell ---------- */
function nav(on) {
  const L = [["", "home", "Feed"], ["games", "cal", "Games"], ["pubs", "pint", "Pubs"], ["photos", "cam", "Photos"], ["me", "user", ME ? "Me" : "Join"]];
  NAV.innerHTML = L.map(([r, i, t]) => `<a href="#/${r}" class="${on === r ? "on" : ""}" ${on === r ? 'aria-current="page"' : ""}>${ic(i, 22)}${t}${r === "me" && (UNREAD || NOTES) ? '<span class="dot" aria-label="New activity"></span>' : ""}</a>`).join("");
}
function topbar() {
  return `<header class="row" style="justify-content:space-between;margin-bottom:14px">
    <a href="#/" class="mark" style="text-decoration:none">ALAW<small>All Leeds Aren't We</small></a>
    <div class="row" style="gap:8px">
      <a href="#/notes" class="ibtn" aria-label="Notifications${NOTES ? ", new" : ""}">${ic("bell")}${NOTES ? '<span class="dot"></span>' : ""}</a>
      <a href="#/inbox" class="ibtn" aria-label="Messages${UNREAD ? ", new" : ""}">${ic("chat")}${UNREAD ? '<span class="dot"></span>' : ""}</a>
    </div></header>`;
}
function backBtn(href, label = "Back") { return `<a href="${href}" class="ibtn" aria-label="${esc(label)}">${ic("back")}</a>`; }
const needJoin = () => { if (ME) return false; toast("Join ALAW first. It takes 10 seconds."); location.hash = "#/me"; return true; };

/* ---------- sheets ---------- */
function sheet(html) {
  closeSheet();
  const bg = document.createElement("div"); bg.className = "sheet-bg"; bg.id = "sheet";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) closeSheet(); });
  document.body.appendChild(bg);
  const f = bg.querySelector("input,textarea,button"); if (f) f.focus();
}
function closeSheet() { const s = $("#sheet"); if (s) s.remove(); const v = $("#viewer"); if (v) v.remove(); }

/* ---------- boot ---------- */
async function boot() {
  try { BOOT = await api("/boot"); ME = BOOT.me; }
  catch (e) { APP.innerHTML = `<div class="empty">Couldn't load ALAW. ${esc(e.message)}<br><br><button class="btn y" onclick="location.reload()">Try again</button></div>`; return; }
  if (AUTH && !ME) { /* key no longer valid */ }
  checkInbox(); setInterval(checkInbox, 60e3);
  route();
}
async function checkInbox() {
  if (!ME) return;
  try { const [a, b] = await Promise.all([api("/inbox"), api("/notes")]); const was = UNREAD + "|" + NOTES; UNREAD = a.unread; NOTES = location.hash.startsWith("#/notes") ? 0 : b.unread; if (was !== UNREAD + "|" + NOTES) { nav(curNav); const tb = document.querySelector("header .row"); if (tb && document.querySelector("header .mark")) tb.outerHTML = topbar().match(/<div class="row" style="gap:8px">[\s\S]*?<\/div>/)[0]; } } catch (e) {}
}
async function refreshBoot() { try { BOOT = await api("/boot"); ME = BOOT.me; } catch (e) {} }

let curNav = "";
function route() {
  clearInterval(TIMER); TIMER = null; clearInterval(LTIMER); LTIMER = null; closeSheet(); if (MAP) { try { MAP.remove(); } catch (e) {} MAP = null; }
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const [a, b, c] = parts;
  curNav = { "": "", games: "games", aways: "games", f: "games", clubs: "", lost: "", pubs: "pubs", g: "pubs", inbox: "inbox", dm: "inbox", me: "me", u: "", lounge: "", admin: "me", rules: "me", photos: "photos", notes: "", p: "" }[a] ?? "";
  nav(curNav);
  window.scrollTo(0, 0);
  const R = { "": pHome, games: pAways, aways: pAways, clubs: pClubs, lost: pLost, f: pFixture, pubs: pPubs, g: pGround, inbox: pInbox, dm: pDM, me: pMe, u: pUser, lounge: pLounge, rules: pRules, admin: pAdmin, photos: pGallery, notes: pNotes, p: pPost };
  (R[a] || pHome)(b, c);
}
window.addEventListener("hashchange", route);

/* ---------- home: the feed ---------- */
function goingBtn(f, big) {
  const p = past(f), on = f.mine;
  const label = p ? (on ? "You went" : "I went") : on ? "You're going" : "I'm going";
  return `<button class="btn ${on ? "on" : "y"} ${big ? "big" : ""}" data-act="going" data-fid="${esc(f.id)}" data-on="${on ? 0 : 1}" aria-pressed="${on}">${on ? ic("check", 18) : ""}${label}</button>`;
}
function gameOptions(sel) {
  const up = BOOT.fixtures.filter((f) => f.ts > NOW() - 3 * H).slice(0, 3), rec = BOOT.fixtures.filter((f) => f.ts <= NOW() - 3 * H).slice(-2).reverse();
  return `<option value="">No game</option>${[...up, ...rec].map((f) => `<option value="${esc(f.id)}" ${sel === f.id ? "selected" : ""}>${f.isAway ? "at " + esc(short(f.home.name)) : "v " + esc(short(f.away.name))} · ${dm(f.ts)}</option>`).join("")}`;
}
function pHome() {
  const up = BOOT.fixtures.filter((f) => f.ts > NOW() - 3 * H);
  const nx = up[0], other = nx ? up.find((f) => f.isAway !== nx.isAway) : null;
  const soon = nx && nx.ts - NOW() < 2 * 864e5 ? nx.id : "";
  ATTACH = null;
  APP.innerHTML = `${topbar()}
  <div class="col" style="gap:16px">
    ${ME ? "" : `<section class="hero">
      <div class="h1" style="font-size:34px">Every Leeds matchday.<br><span class="y">One place.</span></div>
      <p style="margin:0;line-height:1.5" class="soft">The feed, pubs near every ground, who's drinking where, lifts, spare tickets, meet-ups, live scores and the photos. Built by a Leeds fan, for Leeds fans.</p>
      <a href="#/me" class="btn y big">Join free · no email needed</a>
      <span class="tiny soft">${BOOT.fans ? `${BOOT.fans} Leeds fan${BOOT.fans === 1 ? "" : "s"} on board` : "Be one of the first on board"}</span>
    </section>`}
    <div id="live"></div>
    ${nx ? nextCard(nx) : `<div class="empty">Fixtures will show here as soon as they're out.</div>`}
    ${other ? `<a href="#/f/${esc(other.id)}" class="card row" style="color:var(--text)">
      <div class="date"><span>${wk(other.ts)}</span><b>${fmtTime(other.ts)}</b></div>
      <div class="grow"><div class="kicker">Next ${other.isAway ? "away" : "home"} · ${fmtDay(other.ts)}</div><div style="font-weight:700">${other.isAway ? "at " + esc(short(other.home.name)) : "Leeds v " + esc(short(other.away.name))}</div><div class="tiny muted">${other.going} going · ${other.isAway ? "map, pubs, lifts, tickets" : "pre-match pubs, meet-ups"}</div></div>
    </a>` : ""}
    <div id="extras" class="col" style="gap:16px"></div>
    <div class="tabs" aria-label="Quick links">${[["#/lounge", "chat", "The Lounge"], ["#/photos", "cam", "Gallery"], ["#/clubs", "user", "Supporters' clubs"], ["#/lost", "pin", "Lost & found"], ["#/rules", "shield", "House rules"]].map(([h, i, t]) => `<a class="tab" href="${h}" style="gap:6px">${ic(i, 16, 'style="color:var(--yellow)"')}${t}</a>`).join("")}</div>
    ${ME ? `<form data-form="newpost" class="card col" style="gap:10px">
      <div class="row" style="align-items:flex-start">${av(ME.nick)}<label class="sr" for="np">Write a post</label><textarea class="f grow" id="np" name="text" maxlength="1000" placeholder="What's happening, ${esc(ME.nick)}?" style="min-height:52px"></textarea></div>
      <div id="npPrev"></div>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <label class="btn" for="npImg" style="cursor:pointer">${ic("cam", 18)}Photo</label><input id="npImg" type="file" accept="image/*" class="sr" data-attach="1">
        <select class="f" name="fid" style="width:auto;flex:1;min-width:130px;min-height:44px" aria-label="Which game is this about?">${gameOptions(soon)}</select>
        <button class="btn y">Post</button>
      </div></form>` : ""}
    <div id="feed" class="col" style="gap:14px"><div class="spin">Loading the feed…</div></div>
    <div id="feedmore"></div>
  </div>`;
  loadFeed(true);
}
function nextCard(f) {
  return `<section class="fxcard" aria-label="Next game">
    <div class="in">
      <div class="kicker">Next game · ${f.isAway ? "away" : "Elland Road"} · ${esc(until(f.ts))} · ${fmtDay(f.ts)} ${fmtTime(f.ts)}</div>
      <a href="#/f/${esc(f.id)}" style="color:var(--text)"><div class="h1" style="font-size:36px">${titleOf(f)}</div></a>
      <div class="soft small">${esc([f.venue.name, f.venue.city].filter(Boolean).join(", "))}${f.league ? " · " + esc(f.league) : ""}</div>
      <div class="row" style="margin-top:4px">
        <div class="grow small soft"><b style="color:var(--text);font-size:16px">${f.going}</b> fan${f.going === 1 ? "" : "s"} going</div>
        ${goingBtn(f)}
      </div>
    </div>
    <a href="#/f/${esc(f.id)}/map" class="board row" style="border-radius:0;color:var(--text)">${ic("pin", 18, 'style="color:var(--yellow)"')}<span class="grow">Map · pubs · who's drinking where</span><span class="y" style="font-weight:700">Open</span></a>
  </section>`;
}
function liveHtml(f, L, link) {
  if (!L || !L.status || L.status === "NS") return "";
  const live = !["FT", "AET", "PEN"].includes(L.status);
  const sc = L.score || [0, 0];
  const goals = (L.events || []).filter((e) => ["goal", "og", "red"].includes(e.type));
  const tag = live ? `<span class="chip bad"><span class="pulse" aria-hidden="true"></span> ${L.status === "HT" ? "Half time" : "Live " + (L.elapsed || "") + "'"}</span>` : `<span class="chip">Full time</span>`;
  return `<${link ? `a href="#/f/${esc(f.id)}"` : "section"} class="card col live" style="gap:8px;color:var(--text)" aria-live="polite">
    <div class="row">${tag}<span class="grow tiny muted">${esc(f.league || "")}</span></div>
    <div class="row" style="justify-content:space-between;gap:8px"><b class="grow" style="font-size:17px">${esc(short(f.home.name))}</b><span class="score" style="font-size:40px;line-height:1">${sc[0]} - ${sc[1]}</span><b class="grow" style="font-size:17px;text-align:right">${esc(short(f.away.name))}</b></div>
    ${goals.length ? `<div class="col tiny" style="gap:3px">${goals.map((e) => `<div class="row" style="gap:6px;justify-content:${e.leeds === !f.isAway ? "flex-start" : "flex-end"}"><span class="${e.leeds ? "y" : "soft"}" style="font-weight:700">${e.min}${e.extra ? "+" + e.extra : ""}'</span><span>${e.type === "red" ? "Red card" : e.type === "og" ? "Own goal" : "Goal"} · ${esc(e.player)}</span></div>`).join("")}</div>` : ""}
  </${link ? "a" : "section"}>`;
}
async function loadFeed(first) {
  const el = $("#feed"); if (!el) return;
  const last = el.querySelector("article.post:last-of-type");
  const before = first ? "" : `?before=${last ? last.dataset.at : ""}`;
  try {
    const j = await api("/feed" + before);
    if (first) {
      drawExtras(j);
      if (j.live && j.live.fid) {
        const f = BOOT.fixtures.find((x) => x.id === j.live.fid);
        const draw = (L) => { const b = $("#live"); if (b && f) b.innerHTML = liveHtml(f, L, true); };
        draw(j.live);
        if (f) LTIMER = setInterval(async () => { try { const r = await api("/live/" + enc(f.id)); draw(r.live); } catch (e) {} }, 60e3);
      }
    }
    const L = j.feed.filter((p) => !isBlocked(p.uid));
    if (first) el.innerHTML = L.length ? L.map(postCard).join("") : `<div class="empty">The feed's quiet. Be the first to post: a photo from the ground, a pub tip, or your prediction.</div>`;
    else el.insertAdjacentHTML("beforeend", L.map(postCard).join(""));
    const m = $("#feedmore"); if (m) m.innerHTML = j.more ? `<button class="btn block" data-act="feedmore">Load more</button>` : "";
  } catch (e) { if (first) el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; else toast(e.message); }
}
function postCard(p) {
  return `<article class="card col post" style="gap:10px" id="post-${esc(p.id)}" data-at="${p.at}">
    <div class="row">${av(p.nick)}<div class="grow"><a href="#/u/${esc(p.uid)}" style="color:var(--text);font-weight:700">${esc(p.nick)}</a>
      <div class="tiny muted">${ago(p.at)}${p.game ? ` · <a href="#/f/${esc(p.fid)}">${esc(p.game)}</a>` : ""}${p.kind === "tip" ? ` · Tip${p.tag ? ": " + esc(p.tag) : ""}` : ""}</div></div>
      <button class="opt" data-act="opt" data-type="post" data-id="${esc(p.id)}" data-uid="${esc(p.uid)}" aria-label="Post options">•••</button></div>
    ${p.text ? `<div class="ptext">${esc(p.text)}</div>` : ""}
    ${p.img ? `<a class="pimg" href="#/p/${esc(p.id)}" aria-label="Open photo"><img src="/img/${esc(p.img)}.jpg" alt="${esc(p.text || "Photo by " + p.nick)}" loading="lazy"></a>` : ""}
    <div class="row" style="gap:8px">${cheerBtn(p)}<a class="chip" style="min-height:32px" href="#/p/${esc(p.id)}">Comment${p.comments ? " · " + p.comments : ""}</a><button class="chip" style="min-height:32px" data-act="sharepost" data-id="${esc(p.id)}">Share</button></div>
    ${(p.lastComments || []).length ? `<div class="col" style="gap:6px;border-top:1px solid var(--line);padding-top:10px">${p.comments > 2 ? `<a href="#/p/${esc(p.id)}" class="tiny">View all ${p.comments} comments</a>` : ""}${p.lastComments.filter((c) => !isBlocked(c.uid)).map((c) => `<div class="small" style="line-height:1.4"><a href="#/u/${esc(c.uid)}" style="color:var(--text);font-weight:700">${esc(c.nick)}</a> <span class="soft">${esc(c.text)}</span></div>`).join("")}</div>` : ""}
  </article>`;
}
function drawExtras(j) {
  const el = $("#extras"); if (!el) return;
  const r = j.rate, t = j.table;
  const form = (s) => String(s || "").slice(-5).split("").map((c) => `<span class="chip ${c === "W" ? "good" : c === "L" ? "bad" : ""}" style="padding:3px 7px">${c}</span>`).join("");
  el.innerHTML = `${t ? `<div class="card row" style="gap:12px"><div class="date" style="width:58px"><span>${esc((t.league || "").replace("Premier League", "Prem"))}</span><b>${t.rank}${["th", "st", "nd", "rd"][(t.rank % 100 > 10 && t.rank % 100 < 14) ? 0 : t.rank % 10 < 4 ? t.rank % 10 : 0]}</b></div><div class="grow"><div style="font-weight:700">Leeds · ${t.points} pts from ${t.played}</div><div class="tiny muted">W${t.w} D${t.d} L${t.l} · GD ${t.gd > 0 ? "+" : ""}${t.gd}</div></div><div class="chips" aria-label="Last five results">${form(t.form)}</div></div>` : ""}
    ${(j.hot || []).length ? `<section class="card col" style="gap:8px"><div class="kicker"><span class="pulse" aria-hidden="true"></span> Where the Leeds are drinking now</div>${j.hot.map((h) => `<a href="#/g/${esc(h.ground)}" class="row" style="color:var(--text)"><span class="grow" style="font-weight:600">${esc(h.name)}</span><span class="chip warn">${h.n} here</span></a>`).join("")}</section>` : ""}
    ${r ? `<a href="#/f/${esc(r.id)}/rate" class="hero" style="color:var(--text);padding:16px;flex-direction:row;align-items:center;gap:12px">
      ${ic("medal", 30, 'style="color:var(--yellow);flex-shrink:0"')}<div class="grow"><div class="kicker" style="color:var(--soft)">Player ratings are open</div><div style="font-weight:800;font-size:17px">Rate the lads: ${r.isAway ? esc(short(r.home)) + " v Leeds" : "Leeds v " + esc(short(r.away))}${r.score ? ` ${r.score[0]}-${r.score[1]}` : ""}</div><div class="tiny soft">${r.voters} fan${r.voters === 1 ? " has" : "s have"} rated so far</div></div><span class="y" style="font-weight:700">Rate</span></a>` : ""}
    ${(j.polls || []).map(pollHtml).join("")}`;
}
function pollHtml(pl) {
  const voted = pl.mine != null || pl.closed;
  return `<section class="card col" id="poll-${esc(pl.id)}"><div class="kicker">Fan poll · ${pl.total} vote${pl.total === 1 ? "" : "s"}</div><div style="font-weight:700;font-size:17px">${esc(pl.q)}</div>
    ${pl.options.map((o, i) => { const pc = pl.total ? Math.round((pl.counts[i] / pl.total) * 100) : 0; return voted
      ? `<div style="position:relative;border-radius:12px;background:var(--bg2);overflow:hidden;min-height:44px;display:flex;align-items:center;padding:0 12px"><span style="position:absolute;inset:0;width:${pc}%;background:${pl.mine === i ? "rgba(255,205,0,.28)" : "var(--card2)"};transition:width .6s"></span><span class="grow" style="position:relative;font-weight:${pl.mine === i ? 700 : 500}">${esc(o)}</span><b style="position:relative">${pc}%</b></div>`
      : `<button class="btn block" style="justify-content:flex-start" data-act="pollvote" data-id="${esc(pl.id)}" data-i="${i}">${esc(o)}</button>`; }).join("")}</section>`;
}
const cheerBtn = (p) => `<button class="chip ${p.cheered ? "mine" : ""}" style="min-height:32px" data-act="cheer" data-id="${esc(p.id)}" data-on="${p.cheered ? 0 : 1}" aria-pressed="${p.cheered}" aria-label="Marching on together, ${p.cheers}">MOT · ${p.cheers}</button>`;

/* ---------- single post with comments ---------- */
async function pPost(id) {
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/post/" + enc(id)); } catch (e) { APP.innerHTML = `<div class="col">${backBtn("javascript:history.back()")}<div class="empty">${esc(e.message)}</div></div>`; return; }
  APP.innerHTML = `<div class="col" style="gap:14px">${backBtn("javascript:history.back()")}
    ${postCard({ ...j.post, lastComments: [] })}
    <h2 class="h2" style="font-size:20px">Comments${j.comments.length ? " · " + j.comments.length : ""}</h2>
    <div id="clist" class="col" style="gap:10px">${j.comments.map(commentHtml).join("") || `<div class="empty" id="cEmpty">No comments yet. Get it going.</div>`}</div>
    ${ME ? `<form data-form="comment" class="compose"><input type="hidden" name="pid" value="${esc(id)}"><label class="sr" for="cText">Write a comment</label><textarea class="f grow" id="cText" name="text" maxlength="500" rows="1" placeholder="Write a comment…" required></textarea><button class="ibtn" style="background:var(--yellow);border-color:var(--yellow);color:#0B1426" aria-label="Send">${ic("send", 18)}</button></form>` : `<a class="btn y" href="#/me">Join to comment</a>`}
  </div>`;
}
const commentHtml = (c) => `<div class="msg" id="c-${esc(c.id)}">${av(c.nick)}<div class="bub" style="max-width:86%"><div class="who"><a href="#/u/${esc(c.uid)}">${esc(c.nick)}</a><span class="muted" style="font-weight:400">${ago(c.at)}</span><button class="opt" data-act="opt" data-type="comment" data-id="${esc(c.id)}" data-uid="${esc(c.uid)}" aria-label="Comment options">•••</button></div>${esc(c.text)}</div></div>`;

/* ---------- notifications ---------- */
async function pNotes() {
  if (!ME) { location.hash = "#/me"; return; }
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/notes", {}); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  NOTES = 0; nav(curNav);
  const say = (n) => n.type === "cheer" ? `gave your post a MOT: “${esc(n.text)}”` : n.type === "comment" ? `commented: “${esc(n.text)}”` : n.type === "reply" ? `also commented: “${esc(n.text)}”` : n.type === "join" ? `is coming to your meet-up: ${esc(n.text)}` : esc(n.text || "");
  APP.innerHTML = `<div class="col" style="gap:14px">${backBtn("#/")}<h1 class="h1">Notifications</h1>
    ${j.notes.map((n) => `<a href="${n.pid ? "#/p/" + esc(n.pid) : n.fid ? "#/f/" + esc(n.fid) + "/meet" : "#/"}" class="card row" style="color:var(--text);${n.unread ? "border-color:var(--yellow)" : ""}">${av(n.nick)}<div class="grow small" style="line-height:1.4"><b>${esc(n.nick)}</b> ${say(n)}<div class="tiny muted">${ago(n.at)}</div></div></a>`).join("") || `<div class="empty">Nothing yet. Post something and the MOTs will roll in.</div>`}</div>`;
}

/* ---------- gallery ---------- */
let GALFID = "";
async function pGallery(fid) {
  GALFID = fid || "";
  APP.innerHTML = `${topbar()}<div class="spin">Loading photos…</div>`;
  let j; try { j = await api("/gallery" + (GALFID ? "?fid=" + enc(GALFID) : "")); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  GAL = j.photos.filter((p) => !isBlocked(p.uid));
  APP.innerHTML = `${topbar()}<div class="col" style="gap:14px">
    <div><div class="kicker">${j.total} photo${j.total === 1 ? "" : "s"} from Leeds fans</div><h1 class="h1">Gallery</h1></div>
    ${ME ? `<label class="btn y big block" for="galUp" style="cursor:pointer">${ic("cam")}Add photos</label><input id="galUp" type="file" accept="image/*" multiple class="sr" data-upload="${esc(GALFID || "general")}">` : `<a class="btn y block" href="#/me">Join to add photos</a>`}
    ${j.games.length ? `<div class="tabs"><a class="tab ${GALFID ? "" : "on"}" href="#/photos">All</a>${j.games.map((g) => `<a class="tab ${GALFID === g.id ? "on" : ""}" href="#/photos/${esc(g.id)}">${esc(short(g.label))}</a>`).join("")}</div>` : ""}
    <div id="gal" class="grid3">${galHtml(GAL, 0)}</div>
    ${!GAL.length ? `<div class="empty">No photos yet. The ground, the pub, the train, the away end: get them up.</div>` : ""}
    <div id="galmore">${j.more ? `<button class="btn block" data-act="galmore">Load more</button>` : ""}</div>
  </div>`;
}
const galHtml = (L, off) => L.map((p, i) => `<button class="ph" data-act="view" data-src="gal" data-i="${off + i}" aria-label="Photo by ${esc(p.nick)}"><img src="/img/${esc(p.img)}.jpg" alt="" loading="lazy"></button>`).join("");

/* ---------- aways list ---------- */
function pAways(filter) {
  const mode = filter === "away" || filter === "home" ? filter : "all";
  const L = BOOT.fixtures.filter((f) => mode === "all" || (mode === "away") === f.isAway);
  const up = L.filter((f) => !past(f)), done = L.filter(past).reverse();
  const row = (f) => `<a href="#/f/${esc(f.id)}" class="fxrow" style="color:var(--text)">
    <div class="date"><span>${wk(f.ts)}</span><b>${fmtTime(f.ts)}</b></div>
    <div class="grow"><div style="font-weight:700">${f.isAway ? "at " + esc(short(f.home.name)) : "v " + esc(short(f.away.name)) + " (H)"}</div>
    <div class="tiny muted">${fmtDay(f.ts)} · ${esc(f.venue.name || "")}${f.going ? ` · ${f.going} going` : ""}</div></div>
    ${f.score ? resultOf(f) : f.mine ? '<span class="chip good">Going</span>' : ""}
  </a>`;
  APP.innerHTML = `<div class="col" style="gap:16px">
    <div><div class="kicker">${BOOT.fixtures[0] ? "This season" : ""}</div><h1 class="h1">${mode === "away" ? "Away days" : mode === "home" ? "Elland Road" : "Fixtures"}</h1></div>
    <div class="pill" role="tablist" style="grid-template-columns:repeat(3,minmax(0,1fr))">${[["all", "All"], ["home", "Home"], ["away", "Away"]].map(([k, t]) => `<button role="tab" aria-selected="${mode === k}" class="${mode === k ? "on" : ""}" onclick="location.hash='#/games/${k}'">${t}</button>`).join("")}</div>
    ${up.length ? `<section><h2 class="h2">Coming up</h2>${up.map(row).join("")}</section>` : `<div class="empty">No upcoming fixtures loaded yet.</div>`}
    ${done.length ? `<section><h2 class="h2">Been there</h2><p class="note">Open the ones you went to and tap "I went". They count towards your games, away days and badges.</p>${done.map(row).join("")}</section>` : ""}
  </div>`;
}

/* ---------- fixture page ---------- */
const TABS = [["info", "Info"], ["map", "Map & pubs"], ["chat", "Chat"], ["rate", "Ratings"], ["meet", "Meet-ups"], ["watch", "Watch elsewhere"], ["lifts", "Lifts"], ["tickets", "Tickets"], ["photos", "Photos"]];
async function pFixture(id, tab = "info") {
  if (!FD || FD.fixture.id !== id) { APP.innerHTML = `<div class="spin">Loading the game…</div>`; }
  try { FD = await api("/f/" + enc(id)); } catch (e) { APP.innerHTML = `<div class="col">${backBtn("#/games")}<div class="empty">${esc(e.message)}</div></div>`; return; }
  if (tab === "pubs") tab = "map";
  drawFixture(tab);
  if (tab === "chat") startChat(id);
  const f = FD.fixture;
  if (FD.live || (f.ts - NOW() < 15 * 60e3 && NOW() - f.ts < 165 * 60e3)) {
    clearInterval(LTIMER);
    LTIMER = setInterval(async () => { try { const r = await api("/live/" + enc(f.id)); FD.live = r.live; const b = $("#livebox"); if (b) b.innerHTML = liveHtml(f, r.live, false); } catch (e) {} }, 60e3);
  }
}
function drawFixture(tab) {
  const D = FD, f = D.fixture;
  const showRate = D.rate && (D.rate.open || D.rate.voters);
  const counts = { rate: D.rate ? D.rate.voters : 0, watch: D.watch.length, chat: D.chat.length, map: D.pubs.reduce((a, p) => a + p.here, 0) ? D.pubs.reduce((a, p) => a + p.here, 0) + " here" : D.pubs.length, meet: D.meets.length, lifts: D.lifts.filter((l) => !l.closed).length, tickets: D.tickets.filter((t) => !t.closed).length, photos: D.photos.length };
  APP.innerHTML = `<div class="col" style="gap:16px">
    <div class="row" style="justify-content:space-between">${backBtn("#/games", "Back to fixtures")}<button class="ibtn" data-act="share" aria-label="Share this game">${ic("share")}</button></div>
    <div class="col" style="gap:8px">
      <div class="kicker">${esc(f.league || "")}${f.league ? " · " : ""}${fmtDay(f.ts)} ${fmtTime(f.ts)}${until(f.ts) ? " · " + esc(until(f.ts)) : ""}</div>
      <h1 class="h1" style="font-size:42px">${titleOf(f)}</h1>
      <div class="soft small row" style="gap:6px">${ic("pin", 16)}${esc([f.venue.name, f.venue.city].filter(Boolean).join(", ") || "Venue to be confirmed")} ${f.score && !(D.live && !["FT", "AET", "PEN", "NS"].includes(D.live.status)) ? resultOf(f) : ""}</div>
    </div>
    <div id="livebox">${liveHtml(f, D.live, false)}</div>
    <div class="stats">
      <div class="stat"><b>${f.going}</b><span>${past(f) ? "went" : "going"}</span></div>
      <div class="stat"><b>${D.meets.length}</b><span>meet-ups</span></div>
      <div class="stat"><b>${D.photos.length}</b><span>photos</span></div>
    </div>
    ${goingBtn(f, true)}
    <div class="tabs" role="tablist" aria-label="Away day sections">${TABS.filter(([k]) => k !== "rate" || showRate).map(([k, t]) => `<a role="tab" aria-selected="${tab === k}" class="tab ${tab === k ? "on" : ""}" href="#/f/${esc(f.id)}/${k}">${t}${counts[k] ? ` · ${counts[k]}` : ""}</a>`).join("")}</div>
    <div id="tab" class="col">${(TABV[tab] || TABV.info)(D)}</div>
  </div>`;
  if (tab === "chat") { const c = $("#chatlist"); if (c) window.scrollTo(0, document.body.scrollHeight); }
  if (tab === "map") drawMap("map", D.map, D.pubs, D.meets).catch(() => {});
}
const TABV = {
  info(D) {
    const f = D.fixture, q = enc([f.venue.name, f.venue.city].filter(Boolean).join(" "));
    return `<div class="board col" style="gap:0">
      <a class="row" style="padding:8px 0;color:var(--text);border-bottom:1px solid var(--line)" href="https://www.nationalrail.co.uk/" target="_blank" rel="noopener">${ic("train", 18, 'style="color:var(--yellow)"')}<span class="grow">Plan the train</span><span class="y">National Rail</span></a>
      <a class="row" style="padding:8px 0;color:var(--text)" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ic("pin", 18, 'style="color:var(--yellow)"')}<span class="grow">The ground on a map</span><span class="y">Maps</span></a>
    </div>
    ${teamNews(D)}
    <section class="col"><h2 class="h2">${f.isAway ? "Travel tips" : "Matchday tips"}</h2>
      ${D.tips.filter((p) => !isBlocked(p.uid)).map((p) => `<div class="card col" style="gap:6px"><div class="row">${av(p.nick)}<div class="grow"><a href="#/u/${esc(p.uid)}" style="color:var(--text);font-weight:600">${esc(p.nick)}</a><div class="tiny muted">${p.tag ? `<span class="chip" style="padding:2px 8px;margin-right:4px">${esc(p.tag)}</span>` : ""}${ago(p.at)}</div></div><button class="opt" data-act="opt" data-type="post" data-id="${esc(p.id)}" data-uid="${esc(p.uid)}" aria-label="Options">•••</button></div><div style="line-height:1.45;white-space:pre-wrap">${esc(p.text)}</div><div>${cheerBtn(p)}</div></div>`).join("") || `<div class="empty">No tips yet. ${f.isAway ? "Trains, parking, police escorts, where the away end queue is" : "Parking, park and ride, food, getting in quickly"}: share what you know.</div>`}
      <form data-form="tip" class="col" style="gap:8px"><input type="hidden" name="fid" value="${esc(f.id)}"><label class="sr" for="tipText">Add a travel tip</label><select class="f" name="tag" aria-label="Tip type"><option value="">Type of tip (optional)</option>${(D.tipTags || []).map((t) => `<option>${esc(t)}</option>`).join("")}</select><textarea class="f" id="tipText" name="text" maxlength="400" placeholder="${f.isAway ? "Trains, parking, the walk to the ground, the away end queue…" : "Parking, park and ride, best chippy, which turnstiles are quickest…"}" required></textarea><button class="btn y">Post tip</button></form>
    </section>
    <section class="col"><h2 class="h2">${past(f) ? "Who went" : "Who's going"}</h2>
      ${D.who.length ? `<div class="chips">${D.who.map((w) => `<a class="chip" href="#/u/${esc(w.id)}">${esc(w.nick)}</a>`).join("")}${f.going > D.who.length ? `<span class="chip">+${f.going - D.who.length} more</span>` : ""}</div>` : `<div class="empty">Nobody's said yet. Tap "${past(f) ? "I went" : "I'm going"}" above.</div>`}
    </section>`;
  },
  chat(D) {
    return `<div id="chatlist" class="col" style="gap:10px">${chatHtml(D.chat)}</div>
    <p class="note">Banter, not abuse. Tap ••• on a message to report it or block someone.</p>
    ${composer(D.fixture.id)}`;
  },
  map(D) { return mapBlock(D.map, D.fixture.id) + pubsHtml(D.pubs, D.fixture.ground, D.fixture.venue.name || short(D.fixture.home.name)); },
  meet(D) {
    const f = D.fixture;
    return `${D.meets.map((m) => `<article class="card col" style="gap:10px">
      <div class="row"><div class="date"><span>${wk(f.ts)}</span><b>${esc(m.time || "—")}</b></div>
      <div class="grow"><div style="font-weight:700">${esc(m.title)}</div><div class="tiny muted">${esc(m.where)} · by <a href="#/u/${esc(m.uid)}">${esc(m.nick)}</a></div>${m.first ? '<span class="chip good" style="margin-top:4px">First-timers welcome</span>' : ""}</div>
      <button class="opt" data-act="opt" data-type="meet" data-id="${esc(m.id)}" data-uid="${esc(m.uid)}" aria-label="Options">•••</button></div>
      ${m.details ? `<div class="soft small" style="white-space:pre-wrap;line-height:1.45">${esc(m.details)}</div>` : ""}
      ${m.lat != null ? `<div class="row" style="flex-wrap:wrap">${m.pin ? `<span class="chip warn">Live pin · ${Math.max(0, Math.round((m.expires - NOW()) / 6e4))} mins left</span>` : '<span class="chip">On the map</span>'}<a class="btn" href="${dirUrl(m.lat, m.lng)}" target="_blank" rel="noopener">${ic("pin", 16)}Walk there</a><a class="btn" href="#/f/${esc(f.id)}/map">See map</a></div>` : ""}
      <div class="row"><span class="grow small soft">${m.count} going${m.who.length ? ": " + m.who.map(esc).join(", ") : ""}</span><button class="btn ${m.joined ? "on" : "y"}" data-act="meetjoin" data-id="${esc(m.id)}" data-on="${m.joined ? 0 : 1}" aria-pressed="${m.joined}">${m.joined ? ic("check", 16) + "In" : "Count me in"}</button></div>
    </article>`).join("") || `<div class="empty">No meet-ups yet. ${D.fixture.isAway ? "Supporters' coach, pints before, a group on the 10:12?" : "Pints before, a first-timers' meet, a group walking up from town?"} Set one up.</div>`}
    <div class="row" style="gap:8px"><button class="btn dash big grow" data-act="show" data-target="meetForm">Set up a meet-up</button><button class="btn y big" data-act="droppin" data-fid="${esc(f.id)}">${ic("pin", 18)}Drop a pin</button></div>
    <form id="meetForm" data-form="meet" class="card col" hidden><input type="hidden" name="fid" value="${esc(f.id)}">
      <div><label class="l" for="mt">What is it?</label><input class="f" id="mt" name="title" maxlength="60" placeholder="Pints before the game" required></div>
      <div><label class="l" for="mw">Where?</label><input class="f" id="mw" name="where" maxlength="80" placeholder="Pub, station or car park" required></div>
      <div><label class="l" for="mtm">Time</label><input class="f" id="mtm" name="time" type="time"></div>
      <div><label class="l" for="md">Details</label><textarea class="f" id="md" name="details" maxlength="300" placeholder="Wear something yellow, I'm by the bar"></textarea></div>
      <label class="check"><input type="checkbox" name="first"> First-timers welcome (great for fans going on their own)</label>
      <label class="check"><input type="checkbox" name="useloc"> I'm there now: put my current spot on the map so people get walking directions</label>
      <p class="note">Meet in public places. Never share your home address.</p>
      <button class="btn y">Post meet-up</button></form>`;
  },
  watch(D) {
    const f = D.fixture;
    return `<p class="note">No ticket? Abroad? Find Leeds fans watching together, wherever you are.</p>
    ${D.watch.map((m) => `<article class="card col" style="gap:10px">
      <div class="row">${ic("pint", 26, 'style="color:var(--yellow);flex-shrink:0"')}<div class="grow"><div style="font-weight:700">${esc(m.where)}</div><div class="tiny muted">${esc(m.place || "")}${m.time ? " · from " + esc(m.time) : ""} · by <a href="#/u/${esc(m.uid)}">${esc(m.nick)}</a></div></div>
      <button class="opt" data-act="opt" data-type="meet" data-id="${esc(m.id)}" data-uid="${esc(m.uid)}" aria-label="Options">•••</button></div>
      ${m.details ? `<div class="soft small" style="white-space:pre-wrap;line-height:1.45">${esc(m.details)}</div>` : ""}
      <div class="row"><span class="grow small soft">${m.count} Leeds fan${m.count === 1 ? "" : "s"} going</span><button class="btn ${m.joined ? "on" : "y"}" data-act="meetjoin" data-id="${esc(m.id)}" data-on="${m.joined ? 0 : 1}" aria-pressed="${m.joined}">${m.joined ? ic("check", 16) + "I'll be there" : "I'll be there"}</button></div>
    </article>`).join("") || `<div class="empty">Nobody's posted a place yet. Watching in a pub, a club or a supporters' branch? Add it so other fans can join you.</div>`}
    <button class="btn dash big block" data-act="show" data-target="watchForm">Add a place showing the game</button>
    <form id="watchForm" data-form="meet" class="card col" hidden><input type="hidden" name="fid" value="${esc(f.id)}"><input type="hidden" name="kind" value="watch">
      <div><label class="l" for="ww">Pub or venue</label><input class="f" id="ww" name="where" maxlength="80" placeholder="The Peacock" required></div>
      <div><label class="l" for="wp">Town or country</label><input class="f" id="wp" name="place" maxlength="50" placeholder="Leeds · Dublin · Benidorm"></div>
      <div><label class="l" for="wt">Meeting from (time)</label><input class="f" id="wt" name="time" type="time"></div>
      <div><label class="l" for="wd">Details</label><textarea class="f" id="wd" name="details" maxlength="300" placeholder="Big screen, sound on, Leeds bar"></textarea></div>
      <button class="btn y">Add place</button></form>`;
  },
  rate(D) { return rateHtml(D); },
  lifts(D) {
    return `${D.lifts.map((l) => `<article class="card col" style="gap:10px;${l.closed ? "opacity:.6" : ""}">
      <div class="row">${av(l.nick)}<div class="grow"><a href="#/u/${esc(l.uid)}" style="color:var(--text);font-weight:700">${esc(l.nick)}</a><div class="tiny muted">${l.given} lift${l.given === 1 ? "" : "s"} offered on ALAW</div></div>
      <span class="score">${l.closed ? "Full" : `${l.seats} seat${l.seats === 1 ? "" : "s"}`}</span>
      <button class="opt" data-act="opt" data-type="lift" data-id="${esc(l.id)}" data-uid="${esc(l.uid)}" aria-label="Options">•••</button></div>
      <div class="board row"><span class="y" style="font-weight:700">${esc(l.depart || "TBC")}</span><span class="grow">${esc(l.from)} → ground</span><span class="soft">${l.back ? "Back " + esc(l.back) : ""}</span></div>
      ${l.notes ? `<div class="soft small" style="white-space:pre-wrap">${esc(l.notes)}</div>` : ""}
      <div class="row"><span class="grow small soft">${l.cost ? `£${l.cost} each towards petrol` : "No charge"}</span>
      ${ME && l.uid === ME.id ? `<button class="btn" data-act="close" data-type="lift" data-id="${esc(l.id)}" data-on="${l.closed ? 0 : 1}">${l.closed ? "Reopen" : "Mark full"}</button>` : l.closed ? "" : `<a class="btn y" href="#/dm/${esc(l.uid)}">Ask for a seat</a>`}</div>
    </article>`).join("") || `<div class="empty">No lifts offered yet. Got room in the car? Offer it and split the petrol.</div>`}
    <button class="btn dash big block" data-act="show" data-target="liftForm">I've got room in my car</button>
    <form id="liftForm" data-form="lift" class="card col" hidden><input type="hidden" name="fid" value="${esc(D.fixture.id)}">
      <div><label class="l" for="lf">Setting off from (town or area, not your address)</label><input class="f" id="lf" name="from" maxlength="40" placeholder="Wakefield" required></div>
      <div class="row"><div class="grow"><label class="l" for="ld">Leaving</label><input class="f" id="ld" name="depart" type="time"></div><div class="grow"><label class="l" for="lb">Back by</label><input class="f" id="lb" name="back" type="time"></div></div>
      <div class="row"><div class="grow"><label class="l" for="ls">Seats</label><select class="f" id="ls" name="seats">${[1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join("")}</select></div><div class="grow"><label class="l" for="lc">£ each for petrol</label><input class="f" id="lc" name="cost" type="number" min="0" max="60" inputmode="numeric" placeholder="0"></div></div>
      <div><label class="l" for="ln">Anything else</label><textarea class="f" id="ln" name="notes" maxlength="240" placeholder="Can pick up near the M62"></textarea></div>
      <label class="check"><input type="checkbox" name="share" required> It's petrol money only. I'm not making a profit, and I'm insured to drive.</label>
      <button class="btn y">Offer lift</button></form>`;
  },
  tickets(D) {
    return `<div class="rule">${ic("shield", 16, 'style="vertical-align:-3px"')} Tickets only change hands through Leeds United's official ticket transfer or exchange. No money changes hands on ALAW, and no touting.</div>
    ${D.tickets.map((t) => `<article class="card col" style="gap:10px;${t.closed ? "opacity:.6" : ""}">
      <div class="row"><div class="grow"><div class="h2" style="font-size:22px">${t.kind === "wanted" ? "Wanted" : "Spare"}: ${t.qty} ticket${t.qty === 1 ? "" : "s"}</div><div class="small soft">${esc(t.area || "Away end")}</div></div>
      ${t.closed ? '<span class="chip">Sorted</span>' : `<span class="chip ${t.kind === "wanted" ? "warn" : "good"}">${t.kind === "wanted" ? "Looking" : "Available"}</span>`}
      <button class="opt" data-act="opt" data-type="ticket" data-id="${esc(t.id)}" data-uid="${esc(t.uid)}" aria-label="Options">•••</button></div>
      ${t.notes ? `<div class="soft small" style="white-space:pre-wrap">${esc(t.notes)}</div>` : ""}
      <div class="row"><span class="grow tiny muted">by <a href="#/u/${esc(t.uid)}">${esc(t.nick)}</a> · ${ago(t.at)}</span>
      ${ME && t.uid === ME.id ? `<button class="btn" data-act="close" data-type="ticket" data-id="${esc(t.id)}" data-on="${t.closed ? 0 : 1}">${t.closed ? "Reopen" : "Mark sorted"}</button>` : t.closed ? "" : `<a class="btn y" href="#/dm/${esc(t.uid)}">Message</a>`}</div>
    </article>`).join("") || `<div class="empty">No spare or wanted tickets posted for this one yet.</div>`}
    <button class="btn dash big block" data-act="show" data-target="tkForm">Post a spare or wanted ticket</button>
    <form id="tkForm" data-form="ticket" class="card col" hidden><input type="hidden" name="fid" value="${esc(D.fixture.id)}">
      <div class="row"><div class="grow"><label class="l" for="tk">I've got</label><select class="f" id="tk" name="kind"><option value="spare">A spare</option><option value="wanted">I want one</option></select></div><div class="grow"><label class="l" for="tq">How many</label><select class="f" id="tq" name="qty">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select></div></div>
      <div><label class="l" for="ta">Area or ticket type</label><input class="f" id="ta" name="area" maxlength="60" placeholder="Away end, adult"></div>
      <div><label class="l" for="tn">Notes</label><textarea class="f" id="tn" name="notes" maxlength="240" placeholder="Mate can't make it. Needs a member with away points."></textarea></div>
      <label class="check"><input type="checkbox" name="official" required> It'll be passed on through the club's official ticket transfer or exchange, not sold privately.</label>
      <button class="btn y">Post</button></form>`;
  },
  photos(D) {
    const L = D.photos.filter((p) => !isBlocked(p.uid));
    return `<label class="btn y big block" for="up">${ic("cam")}Add your photos</label>
    <input id="up" type="file" accept="image/*" multiple class="sr" data-upload="${esc(D.fixture.id)}">
    <p class="note">Location data is stripped from photos. Please don't post other fans' faces without asking.</p>
    ${L.length ? `<div class="grid3">${L.map((p, i) => `<button class="ph" data-act="view" data-src="fd" data-i="${i}" aria-label="Open photo by ${esc(p.nick)}"><img src="/img/${esc(p.img)}.jpg" alt="" loading="lazy"></button>`).join("")}</div>` : `<div class="empty">No photos yet. The away end, the pub, the train: get them up.</div>`}`;
  },
};
function teamNews(D) {
  const sq = D.squad, inj = D.injuries || [], f = D.fixture;
  const P = (x) => `<span class="chip" style="min-height:30px">${x.num != null ? `<b class="y">${esc(x.num)}</b>` : ""}${esc(x.name)}</span>`;
  const out = inj.filter((x) => x.out), doubt = inj.filter((x) => !x.out);
  const upcoming = !past(f) && f.ts - NOW() < 4 * 864e5;
  if (!(sq && sq.xi) && !inj.length && !upcoming) return "";
  return `<section class="card col"><h2 class="h2">Team news${sq && sq.formation ? ` · <span class="y">${esc(sq.formation)}</span>` : ""}</h2>
    ${sq && sq.xi ? `<div class="kicker">Starting XI</div><div class="chips">${sq.xi.map(P).join("")}</div>${(sq.subs || []).length ? `<div class="kicker">Subs</div><div class="chips">${sq.subs.map(P).join("")}</div>` : ""}` : upcoming ? `<div class="small soft">The line-up drops here about an hour before kick-off.</div>` : ""}
    ${out.length ? `<div class="kicker">Out</div><div class="col" style="gap:4px">${out.map((x) => `<div class="small"><span class="chip bad" style="padding:2px 8px">Out</span> <b>${esc(x.name)}</b> <span class="muted">${esc(x.reason)}</span></div>`).join("")}</div>` : ""}
    ${doubt.length ? `<div class="kicker">Doubtful</div><div class="col" style="gap:4px">${doubt.map((x) => `<div class="small"><span class="chip warn" style="padding:2px 8px">Doubt</span> <b>${esc(x.name)}</b> <span class="muted">${esc(x.reason)}</span></div>`).join("")}</div>` : ""}
    ${upcoming && !inj.length && !(sq && sq.xi) ? `<div class="tiny muted">No injury news reported yet.</div>` : ""}
  </section>`;
}
function rateHtml(D) {
  const R = D.rate, f = D.fixture;
  if (!R) return `<div class="empty">Ratings open at the final whistle.</div>`;
  if (!R.players.length) return `<div class="empty">${R.open ? "The player list will appear here shortly after full time. Check back in a bit." : "Ratings open at the final whistle."}</div>`;
  const results = R.voters ? `<section class="col"><h2 class="h2">Fans' ratings · ${R.voters} vote${R.voters === 1 ? "" : "s"}</h2>
    ${R.motm ? `<div class="hero" style="padding:14px;flex-direction:row;align-items:center;gap:12px">${ic("medal", 28, 'style="color:var(--yellow)"')}<div><div class="kicker" style="color:var(--soft)">Fans' man of the match</div><div style="font-weight:800;font-size:18px">${esc(R.motm.name)}</div><div class="tiny soft">${R.motm.votes} vote${R.motm.votes === 1 ? "" : "s"}</div></div></div>` : ""}
    ${[...R.players].filter((p) => p.avg != null).sort((a, b) => b.avg - a.avg).map((p) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="grow"><b>${esc(p.name)}</b> <span class="tiny muted">${esc(p.pos)}${p.min ? " · " + p.min + "'" : ""}</span>
      <span style="display:block;height:6px;border-radius:3px;background:var(--card2);margin-top:6px"><span style="display:block;height:6px;border-radius:3px;width:${p.avg * 10}%;background:var(--yellow)"></span></span></span>
      <span class="score" style="width:48px;text-align:right">${p.avg.toFixed(1)}</span>${p.stat != null ? `<span class="tiny muted" style="width:52px;text-align:right">stats ${p.stat}</span>` : ""}</div>`).join("")}
  </section>` : "";
  if (!R.open) return results || `<div class="empty">Ratings have closed for this one.</div>`;
  if (!ME) return `${results}<div class="empty">Join ALAW to rate the lads.<br><br><a class="btn y" href="#/me">Join free</a></div>`;
  const mine = (R.mine && R.mine.r) || {};
  return `<form data-form="rate" class="card col"><input type="hidden" name="fid" value="${esc(f.id)}">
    <div class="h2" style="font-size:22px">${R.mine ? "Your ratings" : "Rate the lads"}</div><p class="note">Out of 10. Skip anyone you didn't see. Pick your man of the match.</p>
    ${R.players.map((p) => `<div class="row" style="gap:8px"><div class="grow"><div style="font-weight:600">${esc(p.name)}</div><div class="tiny muted">${esc(p.pos)}${p.sub ? " · sub" : ""}${p.min ? " · " + p.min + " mins" : ""}</div></div>
      <label class="sr" for="r${esc(p.id)}">Rating for ${esc(p.name)}</label><select class="f" id="r${esc(p.id)}" name="r:${esc(p.id)}" style="width:78px"><option value="">–</option>${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option ${+mine[p.id] === n ? "selected" : ""}>${n}</option>`).join("")}</select>
      <label class="chip" style="min-height:44px;cursor:pointer"><input type="radio" name="motm" value="${esc(p.id)}" ${R.mine && String(R.mine.motm) === String(p.id) ? "checked" : ""} style="accent-color:var(--yellow)"> MOTM</label></div>`).join("")}
    <button class="btn y big">${R.mine ? "Update ratings" : "Submit ratings"}</button></form>${results}`;
}
function chatHtml(list) {
  const L = list.filter((p) => !isBlocked(p.uid));
  if (!L.length) return `<div class="empty" id="chatEmpty">No chat yet. Get it started.</div>`;
  return L.map(msgHtml).join("");
}
function msgHtml(p) {
  const mine = ME && p.uid === ME.id;
  return `<div class="msg ${mine ? "me" : ""}" data-at="${p.at}">${mine ? "" : av(p.nick)}<div class="bub"><div class="who">${mine ? "You" : `<a href="#/u/${esc(p.uid)}">${esc(p.nick)}</a>`}<span class="muted" style="font-weight:400">${ago(p.at)}</span><button class="opt" data-act="opt" data-type="post" data-id="${esc(p.id)}" data-uid="${esc(p.uid)}" aria-label="Message options">•••</button></div>${esc(p.text)}</div></div>`;
}
function composer(fid) {
  return `<form data-form="chat" class="compose"><input type="hidden" name="fid" value="${esc(fid)}"><label class="sr" for="chatText">Message</label><textarea class="f grow" id="chatText" name="text" maxlength="280" rows="1" placeholder="${ME ? "Say something…" : "Join to chat"}" required></textarea><button class="ibtn" style="background:var(--yellow);border-color:var(--yellow);color:#0B1426" aria-label="Send">${ic("send", 18)}</button></form>`;
}
function startChat(fid) {
  clearInterval(TIMER);
  TIMER = setInterval(async () => {
    const box = $("#chatlist"); if (!box) return clearInterval(TIMER);
    const last = [...box.querySelectorAll(".msg")].pop(); const since = last ? +last.dataset.at : 0;
    try {
      const j = await api(`/chat/${enc(fid)}?since=${since}`);
      const add = j.chat.filter((p) => !isBlocked(p.uid) && !box.querySelector(`[data-at="${p.at}"]`));
      if (add.length) { const e = $("#chatEmpty"); if (e) e.remove(); const near = window.innerHeight + window.scrollY > document.body.scrollHeight - 200; box.insertAdjacentHTML("beforeend", add.map(msgHtml).join("")); if (near) window.scrollTo(0, document.body.scrollHeight); }
    } catch (e) {}
  }, 7000);
}

/* ---------- pubs and the map ---------- */
const dirUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
const km = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
function mapBlock(M, fid) {
  if (!M || !M.center) return `<div class="empty">Finding the pubs, stations and car parks around the ground… check back in a minute.</div>`;
  const st = (M.stations || []).slice(0, 3), pk = (M.parking || []).slice(0, 3);
  return `<div id="map" class="map" role="region" aria-label="Map of the ground with pubs, stations, car parks and meet-up pins"><div class="spin">Loading map…</div></div>
    <div class="chips tiny" aria-hidden="true"><span class="chip"><i class="lg" style="background:#fff"></i>Ground</span><span class="chip"><i class="lg" style="background:var(--blue2)"></i>Pub</span><span class="chip"><i class="lg" style="background:var(--yellow)"></i>Leeds here now</span><span class="chip"><i class="lg" style="background:#7BD88F"></i>Station</span><span class="chip"><i class="lg" style="background:#C9A7FF"></i>Parking</span><span class="chip"><i class="lg" style="background:#FF8F80"></i>Meet-up</span></div>
    ${fid ? `<button class="btn y big block" data-act="droppin" data-fid="${esc(fid)}">${ic("pin", 18)}Drop a pin: Leeds fans here, come find us</button>` : ""}
    ${st.length || pk.length ? `<section class="board col" style="gap:0">${st.map((x) => `<a class="row" style="padding:8px 0;color:var(--text);border-bottom:1px solid var(--line)" href="${dirUrl(x.lat, x.lng)}" target="_blank" rel="noopener">${ic("train", 18, 'style="color:#7BD88F"')}<span class="grow">${esc(x.name)}</span><span class="soft">${km(x.d)}</span></a>`).join("")}${pk.map((x) => `<a class="row" style="padding:8px 0;color:var(--text);border-bottom:1px solid var(--line)" href="${dirUrl(x.lat, x.lng)}" target="_blank" rel="noopener">${ic("car", 18, 'style="color:#C9A7FF"')}<span class="grow">${esc(x.name)}</span><span class="soft">${km(x.d)}</span></a>`).join("")}</section>` : ""}
    <h2 class="h2" style="margin-top:4px">Pubs near the ground</h2>`;
}
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, no) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/vendor/leaflet.css"; document.head.appendChild(l);
    const sc = document.createElement("script"); sc.src = "/vendor/leaflet.js"; sc.onload = ok; sc.onerror = () => no(new Error("The map didn't load.")); document.head.appendChild(sc);
  });
}
async function drawMap(elId, M, pubs, meets) {
  const el = document.getElementById(elId); if (!el || !M || !M.center) return;
  try { await loadLeaflet(); } catch (e) { el.innerHTML = `<div class="spin">${esc(e.message)}</div>`; return; }
  if (!document.body.contains(el)) return;
  if (MAP) { try { MAP.remove(); } catch (e) {} }
  el.innerHTML = "";
  const L = window.L;
  MAP = L.map(el, { zoomControl: true, scrollWheelZoom: false, tap: true }).setView([M.center.lat, M.center.lng], 15);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>' }).addTo(MAP);
  const icon = (cls, html, size = 30) => L.divIcon({ className: "", html: `<div class="mk ${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
  const pts = [[M.center.lat, M.center.lng]];
  L.marker([M.center.lat, M.center.lng], { icon: icon("ground", ic("shield", 18), 38), zIndexOffset: 500, title: "The ground" }).addTo(MAP).bindPopup("<b>The ground</b>");
  (pubs || []).filter((p) => p.lat != null).forEach((p, i) => {
    const hot = p.here > 0;
    L.marker([p.lat, p.lng], { icon: icon(hot ? "hot" : "pub", hot ? String(p.here) : String(i + 1)), zIndexOffset: hot ? 400 : 0, title: p.name }).addTo(MAP)
      .bindPopup(`<b>${esc(p.name)}</b><br>${p.walk != null ? p.walk + " min walk" : ""}${hot ? ` · <b style="color:#FFCD00">${p.here} Leeds here</b>` : ""}${p.score != null ? ` · ${p.score}% would go back` : ""}<br><a href="#pub-${esc(p.id)}" data-act="pubfocus" data-id="${esc(p.id)}">Details</a> · <a href="${dirUrl(p.lat, p.lng)}" target="_blank" rel="noopener">Walk there</a>`);
    if (p.d != null && p.d < 900) pts.push([p.lat, p.lng]);
  });
  (M.stations || []).forEach((x) => L.marker([x.lat, x.lng], { icon: icon("station", ic("train", 16)), title: x.name }).addTo(MAP).bindPopup(`<b>${esc(x.name)}</b><br>${km(x.d)} from the ground<br><a href="${dirUrl(x.lat, x.lng)}" target="_blank" rel="noopener">Directions</a>`));
  (M.parking || []).forEach((x) => L.marker([x.lat, x.lng], { icon: icon("park", "P", 26), title: x.name }).addTo(MAP).bindPopup(`<b>${esc(x.name)}</b><br>${km(x.d)} from the ground`));
  (meets || []).filter((m) => m.lat != null).forEach((m) => { L.marker([m.lat, m.lng], { icon: icon("meet", ic("pin", 16), 34), zIndexOffset: 600, title: m.title }).addTo(MAP).bindPopup(`<b>${esc(m.title)}</b><br>${esc(m.nick)} · ${m.count} going${m.time ? " · " + esc(m.time) : ""}<br><a href="${dirUrl(m.lat, m.lng)}" target="_blank" rel="noopener">Walk there</a>`); pts.push([m.lat, m.lng]); });
  if (pts.length > 1) MAP.fitBounds(pts, { padding: [28, 28], maxZoom: 16 });
  setTimeout(() => MAP && MAP.invalidateSize(), 150);
}
function pubCard(p, i) {
  const homeOnly = p.tags.some((t) => t.t === "Home fans only") && !p.tags.some((t) => t.t === "Away-friendly");
  return `<article class="card col" style="gap:10px" id="pub-${esc(p.id)}">
    <div class="row" style="align-items:flex-start">
      <span class="av" style="background:${p.here ? "var(--yellow)" : homeOnly ? "var(--bad)" : "var(--blue2)"};color:${p.here ? "#0B1426" : "#fff"}">${i + 1}</span>
      <div class="grow"><div style="font-weight:700;font-size:16px">${esc(p.name)}</div><div class="tiny muted">${[p.walk != null ? p.walk + " min walk" : "", p.d != null ? km(p.d) : "", p.address || ""].filter(Boolean).map(esc).join(" · ")}</div></div>
      ${p.score != null ? `<span class="score">${p.score}%</span>` : ""}
      ${p.uid ? `<button class="opt" data-act="opt" data-type="pub" data-id="${esc(p.id)}" data-uid="${esc(p.uid)}" aria-label="Options">•••</button>` : ""}
    </div>
    ${p.here ? `<div class="chip warn" style="align-self:flex-start"><span class="pulse" aria-hidden="true"></span> ${p.here} Leeds fan${p.here === 1 ? "" : "s"} here now${p.hereNicks.length ? ": " + p.hereNicks.map(esc).join(", ") : ""}</div>` : ""}
    <div class="chips">${p.tags.map((t) => `<button class="chip ${t.t === "Away-friendly" ? "good" : t.t === "Home fans only" ? "bad" : t.t === "Gets rammed" ? "warn" : ""} ${t.mine ? "mine" : ""}" data-act="pubtag" data-id="${esc(p.id)}" data-tag="${esc(t.t)}" data-on="${t.mine ? 0 : 1}" aria-pressed="${t.mine}">${esc(t.t)} · ${t.n}</button>`).join("")}<button class="chip" data-act="tagsheet" data-id="${esc(p.id)}">+ Tag</button></div>
    ${p.note ? `<p class="soft small" style="margin:0;line-height:1.45">“${esc(p.note)}” — <a href="#/u/${esc(p.uid)}">${esc(p.nick)}</a></p>` : ""}
    ${p.votes ? `<div class="tiny muted">${p.score}% of ${p.votes} fan${p.votes === 1 ? "" : "s"} would go back</div>` : ""}
    <div class="row" style="flex-wrap:wrap;gap:8px">
      <button class="btn ${p.imHere ? "on" : "y"}" data-act="checkin" data-id="${esc(p.id)}" data-on="${p.imHere ? 0 : 1}" aria-pressed="${p.imHere}">${p.imHere ? ic("check", 16) + "You're here" : "I'm here"}</button>
      <button class="btn ${p.myVote === 1 ? "on" : ""}" data-act="pubvote" data-id="${esc(p.id)}" data-v="${p.myVote === 1 ? 0 : 1}" aria-pressed="${p.myVote === 1}">Would go back</button>
      <button class="btn ${p.myVote === -1 ? "on" : ""}" data-act="pubvote" data-id="${esc(p.id)}" data-v="${p.myVote === -1 ? 0 : -1}" aria-pressed="${p.myVote === -1}">Wouldn't</button>
      <a class="btn" href="${p.lat != null ? dirUrl(p.lat, p.lng) : `https://www.google.com/maps/search/?api=1&query=${enc(p.name + " " + (p.address || ""))}`}" target="_blank" rel="noopener">${ic("pin", 16)}Walk there</a>
    </div>
  </article>`;
}
function pubsHtml(pubs, ground, gname) {
  const tags = BOOT.tags || [];
  const L = pubs.filter((p) => !p.uid || !isBlocked(p.uid));
  const first = L.slice(0, 10), rest = L.slice(10);
  return `${first.map(pubCard).join("") || `<div class="empty">No pubs found for ${esc(gname || "this ground")} yet. Know a good one, or one to avoid? Add it.</div>`}
  ${rest.length ? `<div id="morePubs" class="col" hidden>${rest.map((p, i) => pubCard(p, i + 10)).join("")}</div><button class="btn block" data-act="morepubs">Show ${rest.length} more pubs</button>` : ""}
  <button class="btn dash big block" data-act="show" data-target="pubForm">Pub missing? Add it</button>
  <form id="pubForm" data-form="pub" class="card col" hidden><input type="hidden" name="ground" value="${esc(ground)}">
    <div><label class="l" for="pn">Pub name</label><input class="f" id="pn" name="name" maxlength="60" required></div>
    <div><label class="l" for="pa">Street or postcode</label><input class="f" id="pa" name="address" maxlength="120"></div>
    <div><label class="l" for="pw">Minutes' walk to the ground</label><input class="f" id="pw" name="walk" type="number" min="0" max="120" inputmode="numeric"></div>
    <fieldset style="border:0;padding:0;margin:0"><legend class="l">Tags</legend><div class="chips">${tags.map((t) => `<label class="chip" style="min-height:32px"><input type="checkbox" name="tags" value="${esc(t)}" style="accent-color:var(--yellow)"> ${esc(t)}</label>`).join("")}</div></fieldset>
    <div><label class="l" for="pnote">Your verdict</label><textarea class="f" id="pnote" name="note" maxlength="240" placeholder="Bouncers sound, cheap pints, sing your heart out"></textarea></div>
    <button class="btn y">Add pub</button></form>`;
}
async function pPubs() {
  APP.innerHTML = `<div class="spin">Loading grounds…</div>`;
  let j; try { j = await api("/grounds"); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const G = j.grounds.filter((g) => g.key !== "elland-road" || true);
  APP.innerHTML = `${topbar()}<div class="col" style="gap:16px"><div><div class="kicker">Every ground Leeds play at this season</div><h1 class="h1">Pubs near the ground</h1></div>
    ${G.map((g) => `<a href="#/g/${esc(g.key)}" class="card row" style="color:var(--text)">
      <span class="ibtn" style="background:var(--card2)">${ic("pint")}</span>
      <div class="grow"><div style="font-weight:700">${esc(g.name || g.club)}</div><div class="tiny muted">${esc(short(g.club))}${g.city ? " · " + esc(g.city) : ""}${g.next ? " · next: " + fmtDay(g.next.ts) : ""}</div></div>
      <span class="small ${g.pubs ? "y" : "muted"}" style="font-weight:600">${g.pubs ? g.pubs + " pub" + (g.pubs === 1 ? "" : "s") : "Open"}</span></a>`).join("") || `<div class="empty">Grounds appear here once fixtures are loaded.</div>`}
  </div>`;
}
let GD = null;
async function pGround(key) {
  APP.innerHTML = `<div class="spin">Loading pubs…</div>`;
  try { GD = await api("/g/" + enc(key)); } catch (e) { APP.innerHTML = `<div class="col">${backBtn("#/pubs")}<div class="empty">${esc(e.message)}</div></div>`; return; }
  drawGround();
}
function drawGround() {
  const g = GD.ground;
  APP.innerHTML = `<div class="col" style="gap:16px">${backBtn("#/pubs", "Back to grounds")}
    <div><div class="kicker">${esc(short(g.club))}${g.city ? " · " + esc(g.city) : ""}</div><h1 class="h1">${esc(g.name || g.club)}</h1></div>
    ${g.next ? `<a class="btn y" href="#/f/${esc(g.next.id)}">Next game here: ${fmtDay(g.next.ts)}</a>` : ""}
    <div id="tab" class="col">${mapBlock(GD.map, g.next ? g.next.id : "")}${pubsHtml(GD.pubs, g.key, g.name)}</div></div>`;
  drawMap("map", GD.map, GD.pubs, GD.meets).catch(() => {});
}

/* ---------- lounge ---------- */
async function pLounge() {
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/feed"); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  APP.innerHTML = `<div class="col" style="gap:16px">${backBtn("#/")}<div><div class="kicker">All Leeds</div><h1 class="h1">The Lounge</h1></div>
    <div id="chatlist" class="col" style="gap:10px">${chatHtml(j.lounge)}</div>
    <p class="note">Banter, not abuse. Tap ••• to report a message or block someone.</p>${composer("lounge")}</div>`;
  window.scrollTo(0, document.body.scrollHeight);
  startChat("lounge");
}

/* ---------- me, join, profiles ---------- */
async function pMe() {
  if (!ME) return drawJoin();
  APP.innerHTML = `<div class="spin">Loading your profile…</div>`;
  let j; try { j = await api("/me"); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  ME = j.me;
  APP.innerHTML = profileHtml(j.me, j.stats, true);
}
function drawJoin() {
  APP.innerHTML = `<div class="col" style="gap:18px">
    <div class="mark">ALAW<small>All Leeds Aren't We</small></div>
    <h1 class="h1">Join the<br><span class="y">Leeds end</span></h1>
    <p class="soft" style="margin:0;line-height:1.5">Every Leeds matchday, home and away. Pick a nickname. No email, no phone number, no password to remember. You'll get a recovery code to keep you logged in on other phones.</p>
    <form data-form="join" class="col">
      <div><label class="l" for="jn">Nickname</label><input class="f" id="jn" name="nick" minlength="3" maxlength="20" autocomplete="nickname" placeholder="e.g. TomLUFC" required></div>
      <div><label class="l" for="jf">Where you travel from (optional)</label><input class="f" id="jf" name="from" maxlength="30" placeholder="Wakefield"></div>
      <label class="check"><input type="checkbox" name="rules" required> I'm 18 or over and I'll stick to the <a href="#/rules">house rules</a>.</label>
      <button class="btn y big">Join ALAW</button>
    </form>
    <details class="card"><summary style="cursor:pointer;font-weight:600;min-height:28px">Already joined on another phone?</summary>
      <form data-form="login" class="col" style="margin-top:12px"><label class="l" for="rc">Paste your recovery code</label><input class="f" id="rc" name="code" autocomplete="off" required><button class="btn y">Log in</button></form>
    </details>
  </div>`;
}
function profileHtml(u, s, own) {
  return `<div class="col" style="gap:20px">
    ${own ? "" : backBtn("javascript:history.back()")}
    <div class="row" style="gap:14px">${av(u.nick, "lg")}<div class="grow"><div class="h1" style="font-size:32px">${esc(u.nick)}</div><div class="small soft">${u.from ? "Travels from " + esc(u.from) + " · " : ""}On ALAW since ${dm(u.since)}</div></div></div>
    ${u.bio ? `<p style="margin:0;line-height:1.5" class="soft">${esc(u.bio)}</p>` : ""}
    <div class="stats"><div class="stat"><b class="y">${s.games}</b><span>games</span></div><div class="stat"><b>${s.aways}</b><span>away days</span></div><div class="stat"><b>${s.grounds}</b><span>away grounds</span></div></div>
    ${own ? "" : `<div class="row"><a class="btn y grow" href="#/dm/${esc(u.id)}">Message</a><button class="btn" data-act="opt" data-type="user" data-id="${esc(u.id)}" data-uid="${esc(u.id)}">More</button></div>`}
    <section class="col"><h2 class="h2">Badges</h2><div class="badges">${s.badges.map((b) => `<div class="badge ${b.got ? "" : "off"}">${ic(b.got ? "medal" : "lock", 26, `style="color:${b.got ? "var(--yellow)" : "var(--muted)"};flex-shrink:0"`)}<div><b>${esc(b.name)}</b><span class="tiny muted">${esc(b.desc)}</span></div></div>`).join("")}</div></section>
    <section class="col"><h2 class="h2">Recent games</h2>${s.recent.length ? s.recent.map((r) => `<a href="#/f/${esc(r.id)}" class="fxrow" style="color:var(--text)"><span class="kicker" style="width:52px">${dm(r.ts)}</span><span class="grow" style="font-weight:600">${r.isAway ? "at " + esc(short(r.home)) : "v " + esc(short(r.away)) + " (H)"}</span><span class="tiny muted">${esc(r.venue || "")}</span></a>`).join("") : `<div class="empty">${own ? 'No games logged yet. Open a past fixture under Games and tap "I went".' : "No games logged yet."}</div>`}</section>
    ${own ? `
    <section class="col"><h2 class="h2">Your details</h2>
      <form data-form="profile" class="col"><div><label class="l" for="pf">Travels from</label><input class="f" id="pf" name="from" maxlength="30" value="${esc(u.from)}"></div>
      <div><label class="l" for="pb">About you</label><textarea class="f" id="pb" name="bio" maxlength="160" placeholder="Away since '98. Never missed a Tuesday night.">${esc(u.bio)}</textarea></div><button class="btn y">Save</button></form>
    </section>
    <section class="card col"><h2 class="h2" style="font-size:20px">Your recovery code</h2><p class="note">This is your login. Save it somewhere safe (notes app or a screenshot) to log in on another phone. Never share it with anyone.</p>
      <button class="btn" data-act="showcode">Show my code</button><div id="codebox"></div></section>
    ${(u.blockedList || []).length ? `<section class="col"><h2 class="h2" style="font-size:20px">Blocked</h2><div class="chips">${u.blockedList.map((b) => `<button class="chip" style="min-height:40px" data-act="unblock" data-uid="${esc(b.id)}">Unblock ${esc(b.nick)}</button>`).join("")}</div></section>` : ""}
    <div class="row" style="flex-wrap:wrap"><a class="btn" href="#/rules">House rules</a><button class="btn" data-act="logout">Log out</button>${ADMIN ? '<a class="btn" href="#/admin">Admin</a>' : ""}</div>` : ""}
  </div>`;
}
async function pUser(id) {
  if (ME && id === ME.id) { location.hash = "#/me"; return; }
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  try { const j = await api("/u/" + enc(id)); APP.innerHTML = profileHtml(j.user, j.stats, false); }
  catch (e) { APP.innerHTML = `<div class="col">${backBtn("#/")}<div class="empty">${esc(e.message)}</div></div>`; }
}

/* ---------- inbox ---------- */
async function pInbox() {
  if (!ME) { APP.innerHTML = `<div class="col" style="gap:16px"><h1 class="h1">Inbox</h1><div class="empty">Join ALAW to message other fans about lifts, tickets and meet-ups.<br><br><a class="btn y" href="#/me">Join free</a></div></div>`; return; }
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/inbox"); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  UNREAD = j.unread; nav("inbox");
  APP.innerHTML = `<div class="col" style="gap:16px"><h1 class="h1">Inbox</h1>
    ${j.inbox.map((c) => `<a href="#/dm/${esc(c.uid)}" class="card row" style="color:var(--text)">${av(c.nick)}<div class="grow"><div style="font-weight:${c.unread ? 800 : 600}">${esc(c.nick)}</div><div class="tiny ${c.unread ? "soft" : "muted"}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last)}</div></div><span class="tiny muted">${ago(c.at)}</span>${c.unread ? '<span class="dot" style="position:static" aria-label="Unread"></span>' : ""}</a>`).join("") || `<div class="empty">No messages yet. Message a driver for a lift, or a fan with a spare ticket.</div>`}
    <p class="note">Keep chats about lifts and tickets on here until you're happy. Never send money for tickets, and meet in public.</p></div>`;
}
async function pDM(uid) {
  if (!ME) { location.hash = "#/me"; return; }
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/dm/" + enc(uid)); } catch (e) { APP.innerHTML = `<div class="col">${backBtn("#/inbox")}<div class="empty">${esc(e.message)}</div></div>`; return; }
  const draw = (J) => J.msgs.map((m) => `<div class="msg ${m.mine ? "me" : ""}" data-at="${m.at}">${m.mine ? "" : av(J.with.nick)}<div class="bub">${esc(m.t)}<div class="tiny muted" style="margin-top:3px">${ago(m.at)}</div></div></div>`).join("");
  APP.innerHTML = `<div class="col" style="gap:14px">
    <div class="row">${backBtn("#/inbox", "Back to inbox")}<a href="#/u/${esc(uid)}" class="grow row" style="color:var(--text)">${av(j.with.nick)}<b>${esc(j.with.nick)}</b></a><button class="opt" data-act="opt" data-type="user" data-id="${esc(uid)}" data-uid="${esc(uid)}" aria-label="Options">•••</button></div>
    <div id="dmlist" class="col" style="gap:10px">${draw(j) || `<div class="empty">Say hello. Sorting a lift or a ticket? Agree the details here.</div>`}</div>
    ${j.blocked ? `<div class="empty">You can't message each other.</div>` : `<form data-form="dm" class="compose"><input type="hidden" name="to" value="${esc(uid)}"><label class="sr" for="dmText">Message</label><textarea class="f grow" id="dmText" name="text" maxlength="500" rows="1" placeholder="Message…" required></textarea><button class="ibtn" style="background:var(--yellow);border-color:var(--yellow);color:#0B1426" aria-label="Send">${ic("send", 18)}</button></form>`}
  </div>`;
  window.scrollTo(0, document.body.scrollHeight);
  TIMER = setInterval(async () => {
    const box = $("#dmlist"); if (!box) return clearInterval(TIMER);
    try { const J = await api("/dm/" + enc(uid)); if (J.msgs.length !== box.querySelectorAll(".msg").length) { box.innerHTML = draw(J); window.scrollTo(0, document.body.scrollHeight); } } catch (e) {}
  }, 6000);
}

/* ---------- supporters' clubs ---------- */
async function pClubs() {
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/clubs"); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  APP.innerHTML = `<div class="col" style="gap:16px">${backBtn("#/")}<div><div class="kicker">Leeds all over</div><h1 class="h1">Supporters' clubs</h1></div>
    <p class="note">Branches and their coaches, added by fans. Contact them through their own pages.</p>
    ${j.clubs.map((c) => `<article class="card col" style="gap:8px"><div class="row"><div class="grow"><div style="font-weight:700">${esc(c.name)}</div><div class="tiny muted">${esc(c.area)}${c.country ? " · " + esc(c.country) : ""}</div></div>${c.coach ? '<span class="chip good">Runs a coach</span>' : ""}<button class="opt" data-act="opt" data-type="club" data-id="${esc(c.id)}" data-uid="${esc(c.uid)}" aria-label="Options">•••</button></div>
      ${c.notes ? `<div class="soft small" style="line-height:1.45">${esc(c.notes)}</div>` : ""}
      ${c.contact ? (/^https?:\/\//.test(c.contact) ? `<a href="${esc(c.contact)}" target="_blank" rel="noopener nofollow" class="small">${esc(c.contact.replace(/^https?:\/\//, "").slice(0, 50))}</a>` : `<div class="small soft">${esc(c.contact)}</div>`) : ""}
    </article>`).join("") || `<div class="empty">No branches listed yet. Run or belong to one? Add it.</div>`}
    <button class="btn dash big block" data-act="show" data-target="clubForm">Add a branch</button>
    <form id="clubForm" data-form="club" class="card col" hidden>
      <div><label class="l" for="cn">Branch name</label><input class="f" id="cn" name="name" maxlength="60" required></div>
      <div class="row"><div class="grow"><label class="l" for="ca">Town or area</label><input class="f" id="ca" name="area" maxlength="40" required></div><div class="grow"><label class="l" for="cc">Country</label><input class="f" id="cc" name="country" maxlength="30" placeholder="England"></div></div>
      <div><label class="l" for="ct">Public contact (Facebook page, website or branch email)</label><input class="f" id="ct" name="contact" maxlength="120"></div>
      <div><label class="l" for="cno">About</label><textarea class="f" id="cno" name="notes" maxlength="240" placeholder="Coach to every away, leaves the Crown at 8"></textarea></div>
      <label class="check"><input type="checkbox" name="coach"> Runs coaches to games</label>
      <button class="btn y">Add branch</button></form></div>`;
}

/* ---------- lost and found ---------- */
async function pLost() {
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/lost"); } catch (e) { APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const recent = BOOT.fixtures.filter((f) => f.ts < NOW() + 864e5 && f.ts > NOW() - 30 * 864e5).reverse();
  APP.innerHTML = `<div class="col" style="gap:16px">${backBtn("#/")}<div><div class="kicker">Leeds fans look after their own</div><h1 class="h1">Lost &amp; found</h1></div>
    ${j.lost.filter((x) => !isBlocked(x.uid)).map((x) => `<article class="card col" style="gap:8px;${x.closed ? "opacity:.6" : ""}"><div class="row"><span class="chip ${x.kind === "found" ? "good" : "warn"}">${x.kind === "found" ? "Found" : "Lost"}</span><div class="grow" style="font-weight:700">${esc(x.what)}</div>${x.closed ? '<span class="chip">Reunited</span>' : ""}<button class="opt" data-act="opt" data-type="lost" data-id="${esc(x.id)}" data-uid="${esc(x.uid)}" aria-label="Options">•••</button></div>
      <div class="tiny muted">${esc(x.where || "")}${x.game ? " · " + esc(x.game) : ""} · ${ago(x.at)} · <a href="#/u/${esc(x.uid)}">${esc(x.nick)}</a></div>
      <div class="row">${ME && x.uid === ME.id ? `<button class="btn" data-act="close" data-type="lost" data-id="${esc(x.id)}" data-on="${x.closed ? 0 : 1}">${x.closed ? "Reopen" : "Mark reunited"}</button>` : x.closed ? "" : `<a class="btn y" href="#/dm/${esc(x.uid)}">${x.kind === "found" ? "That's mine" : "I've got it"}</a>`}</div></article>`).join("") || `<div class="empty">Nothing lost or found right now.</div>`}
    <button class="btn dash big block" data-act="show" data-target="lostForm">Post something lost or found</button>
    <form id="lostForm" data-form="lost" class="card col" hidden>
      <div><label class="l" for="lk">I've…</label><select class="f" id="lk" name="kind"><option value="lost">Lost something</option><option value="found">Found something</option></select></div>
      <div><label class="l" for="lw">What is it?</label><input class="f" id="lw" name="what" maxlength="80" placeholder="Yellow bucket hat" required></div>
      <div><label class="l" for="lwh">Where?</label><input class="f" id="lwh" name="where" maxlength="80" placeholder="Train back from Sunderland, coach C"></div>
      <div><label class="l" for="lg">Which game?</label><select class="f" id="lg" name="fid"><option value="">Not at a game</option>${recent.map((f) => `<option value="${esc(f.id)}">${fmtDay(f.ts)} · ${f.isAway ? "at " + esc(short(f.home.name)) : "v " + esc(short(f.away.name))}</option>`).join("")}</select></div>
      <p class="note">Don't post bank cards or ID details. Describe them and sort it by message.</p>
      <button class="btn y">Post</button></form></div>`;
}

/* ---------- rules ---------- */
function pRules() {
  APP.innerHTML = `<div class="col" style="gap:16px;line-height:1.55">${backBtn("javascript:history.back()")}
    <h1 class="h1">House rules</h1>
    <p class="soft" style="margin:0">ALAW is for Leeds fans to sort matchdays together, home and away. Keep it Leeds, keep it fun, look after each other.</p>
    <div class="card col" style="gap:8px">
      <b>Banter, not abuse.</b><span class="soft small">Wind up rival fans all you like. No racism, homophobia, sexism, threats, or anything about tragedies. Instant ban.</span>
      <b>No personal details.</b><span class="soft small">Don't post anyone's address, phone number, workplace or photos of them without asking. Keep your own private too.</span>
      <b>Tickets: official transfer only.</b><span class="soft small">In the UK, selling a football ticket without the club's permission is a criminal offence. ALAW is a noticeboard: tickets go through Leeds United's official transfer or exchange. Never send money to someone you've met online for a ticket.</span>
      <b>Lifts: petrol money only.</b><span class="soft small">Drivers share costs, they don't make a profit. Drive legally and insured. Passengers: tell someone who you're travelling with.</span>
      <b>Meet in public.</b><span class="soft small">Pubs, stations, coach pick-ups. Never invite strangers to your home.</span>
      <b>18 and over.</b><span class="soft small">ALAW is for adults only.</span>
    </div>
    <h2 class="h2">If something's wrong</h2>
    <p class="soft small" style="margin:0">Tap ••• on any post, pub, lift, ticket or profile to report it or block the person. Anything reported by three fans is hidden straight away until we've checked it. If someone's in danger, call 999.</p>
    <h2 class="h2">Your data</h2>
    <p class="soft small" style="margin:0">We store your nickname, what you post, and which games you've said you're going to. No email or phone number. Location data is removed from photos before upload. Delete anything you've posted from its ••• menu.</p>
    <p class="note">ALAW is an independent fan site. It isn't run by or connected to Leeds United Football Club.</p>
  </div>`;
}

/* ---------- admin ---------- */
async function pAdmin() {
  if (!ADMIN) {
    APP.innerHTML = `<div class="col" style="gap:16px"><h1 class="h1">Admin</h1><form data-form="adminkey" class="col"><label class="l" for="ak">Admin key</label><input class="f" id="ak" name="key" type="password" autocomplete="off" required><button class="btn y">Unlock</button></form></div>`;
    return;
  }
  APP.innerHTML = `<div class="spin">Loading…</div>`;
  let j; try { j = await api("/admin/overview"); } catch (e) { if (e.status === 403) { ADMIN = null; LS.set("alawAdmin", null); return pAdmin(); } APP.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const F = j.fixtures;
  APP.innerHTML = `<div class="col" style="gap:16px"><h1 class="h1">Admin</h1>
    <div class="stats">${Object.entries(j.counts).filter(([k]) => k !== "meta").map(([k, v]) => `<div class="stat"><b>${v}</b><span>${esc(k)}</span></div>`).join("")}</div>
    <section class="col"><h2 class="h2">Reports · ${j.reports.length}</h2>
    ${j.reports.map((r) => `<div class="card col" style="gap:8px">
      <div class="row"><span class="chip ${r.count >= 3 ? "bad" : "warn"}">${esc(r.type)} · ${r.count} report${r.count === 1 ? "" : "s"}</span><span class="grow tiny muted">${ago(r.last || r.at)} · by ${esc(r.nick || "?")}${r.hidden ? " · hidden" : ""}${r.banned ? " · banned" : ""}</span></div>
      ${r.img ? `<img src="/img/${esc(r.img)}.jpg" alt="Reported photo" style="max-height:200px;border-radius:10px;object-fit:contain">` : ""}
      <div style="white-space:pre-wrap">${esc(r.preview)}</div>
      <div class="tiny muted">Reasons: ${r.reasons.map(esc).join(" · ")}</div>
      <div class="row" style="flex-wrap:wrap">
        ${r.type !== "user" ? `<button class="btn" data-act="adm" data-a="${r.hidden ? "unhide" : "hide"}" data-type="${esc(r.type)}" data-id="${esc(r.target)}">${r.hidden ? "Unhide" : "Hide"}</button><button class="btn" data-act="adm" data-a="delete" data-type="${esc(r.type)}" data-id="${esc(r.target)}">Delete</button>` : ""}
        ${r.uid ? `<button class="btn" data-act="adm" data-a="${r.banned ? "unban" : "ban"}" data-uid="${esc(r.uid)}" data-type="${esc(r.type)}" data-id="${esc(r.target)}">${r.banned ? "Unban" : "Ban"} ${esc(r.nick || "")}</button>` : ""}
        <button class="btn" data-act="adm" data-a="dismiss" data-type="${esc(r.type)}" data-id="${esc(r.target)}">Dismiss</button>
      </div></div>`).join("") || `<div class="empty">Nothing reported. Lovely.</div>`}</section>
    <section class="card col"><h2 class="h2" style="font-size:20px">Fixtures</h2>
      <div class="small soft">${F.hasKey ? "API key set" : "No API key: add fixtures by hand below"} · ${F.count} fixtures · season ${F.season}${F.error ? ` · <span style="color:var(--bad)">${esc(F.error)}</span>` : ""}</div>
      ${F.hasKey ? '<button class="btn" data-act="admrefresh">Refresh fixtures now</button>' : ""}
      <form data-form="admfix" class="col"><div class="row"><div class="grow"><label class="l" for="ao">Opponent</label><input class="f" id="ao" name="opponent" required></div><div class="grow"><label class="l" for="adt">Kick-off</label><input class="f" id="adt" name="date" type="datetime-local" required></div></div>
      <div class="row"><div class="grow"><label class="l" for="av">Ground</label><input class="f" id="av" name="venue"></div><div class="grow"><label class="l" for="ac">City</label><input class="f" id="ac" name="city"></div></div>
      <div><label class="l" for="al">Competition</label><input class="f" id="al" name="league"></div>
      <label class="check"><input type="checkbox" name="home"> Home game</label><button class="btn y">Add fixture</button></form>
      ${j.manual.map((f) => `<div class="row small"><span class="grow">${fmtDay(f.ts)} · ${esc(f.isAway ? "at " + f.home.name : "v " + f.away.name)}</span><button class="btn" data-act="admrmfix" data-id="${esc(f.id)}">Remove</button></div>`).join("")}
    </section>
    <section class="card col"><h2 class="h2" style="font-size:20px">Ground location</h2>
      <p class="note">Pubs and stations are found automatically around each ground. If one's in the wrong place, open Google Maps, press and hold on the stadium, copy the numbers (like 53.7778, -1.5721) and paste them here.</p>
      <div class="small soft">${(j.grounds || []).map((g) => `${esc(g.name)}: ${g.located ? g.pubs + " pubs" : "not found yet"}`).join(" · ")}${j.geo && j.geo.error ? ` · <span style="color:var(--bad)">${esc(j.geo.error)}</span>` : ""}</div>
      <form data-form="admground" class="col"><div><label class="l" for="gk">Ground</label><select class="f" id="gk" name="key">${(j.grounds || []).map((g) => `<option value="${esc(g.key)}">${esc(g.name)}</option>`).join("")}</select></div>
      <div><label class="l" for="gc">Coordinates</label><input class="f" id="gc" name="coords" placeholder="53.7778, -1.5721" required></div><button class="btn y">Save location</button></form>
    </section>
    <section class="card col"><h2 class="h2" style="font-size:20px">Fan polls</h2>
      <form data-form="admpoll" class="col"><div><label class="l" for="pq">Question</label><input class="f" id="pq" name="q" maxlength="120" placeholder="Who's been our player of the month?" required></div>
      <div><label class="l" for="po">Options (one per line, 2 to 6)</label><textarea class="f" id="po" name="options" required></textarea></div><button class="btn y">Start poll</button></form>
      ${(j.polls || []).map((pl) => `<div class="row small"><span class="grow">${esc(pl.q)} · ${pl.total} votes${pl.closed ? " · closed" : ""}</span>${pl.closed ? "" : `<button class="btn" data-act="admclosepoll" data-id="${esc(pl.id)}">Close</button>`}</div>`).join("")}
    </section>
    <button class="btn" data-act="admlogout">Lock admin</button></div>`;
}

/* ---------- options menu ---------- */
function optSheet(d) {
  const own = ME && d.uid === ME.id, labels = { post: "post", pub: "pub", meet: "meet-up", lift: "lift", ticket: "ticket", user: "profile", club: "branch", lost: "post", comment: "comment" };
  sheet(`<h2 class="h2" style="font-size:20px">Options</h2>
    ${own && d.type !== "user" ? `<button class="btn" data-act="del" data-type="${esc(d.type)}" data-id="${esc(d.id)}">Delete my ${labels[d.type]}</button>` : ""}
    ${!own && d.type !== "user" ? `<a class="btn" href="#/u/${esc(d.uid)}">View profile</a><a class="btn" href="#/dm/${esc(d.uid)}">Message</a>` : ""}
    ${!own ? `<button class="btn" data-act="reportsheet" data-type="${esc(d.type)}" data-id="${esc(d.id)}">Report this ${labels[d.type]}</button>
    <button class="btn" data-act="block" data-uid="${esc(d.uid)}" data-on="${isBlocked(d.uid) ? 0 : 1}">${isBlocked(d.uid) ? "Unblock" : "Block"} this fan</button>` : ""}
    ${ADMIN && d.type !== "user" && !own ? `<button class="btn" data-act="del" data-type="${esc(d.type)}" data-id="${esc(d.id)}">Admin: delete</button>` : ""}
    <button class="btn" data-act="close-sheet">Cancel</button>`);
}

/* ---------- photo upload and viewer ---------- */
async function shrink(file) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) { src = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Can't read that photo.")); i.src = URL.createObjectURL(file); }); }
  const W = src.width, Hh = src.height, s = Math.min(1, 1280 / Math.max(W, Hh));
  const c = document.createElement("canvas"); c.width = Math.round(W * s); c.height = Math.round(Hh * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  let q = 0.8, d = c.toDataURL("image/jpeg", q);
  while (d.length > 1.15e6 && q > 0.4) { q -= 0.1; d = c.toDataURL("image/jpeg", q); }
  return d;
}
async function upload(fid, files) {
  if (needJoin()) return;
  const list = [...files].slice(0, 6); if (!list.length) return;
  let datas = [];
  try { for (const f of list) datas.push(await shrink(f)); } catch (e) { toast(e.message); return; }
  sheet(`<h2 class="h2" style="font-size:20px">Post ${datas.length} photo${datas.length === 1 ? "" : "s"}</h2>
    <div class="grid3">${datas.map((d) => `<div class="ph"><img src="${d}" alt=""></div>`).join("")}</div>
    <label class="l" for="cap">Caption (optional)</label><input class="f" id="cap" maxlength="300" placeholder="Away end bouncing">
    <button class="btn y big" id="doUp">Post</button><button class="btn" data-act="close-sheet">Cancel</button>`);
  $("#doUp").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Uploading…";
    const cap = $("#cap").value; let ok = 0;
    for (const d of datas) { try { await api("/photo", { fid, caption: cap, data: d }); ok++; } catch (er) { toast(er.message); break; } }
    closeSheet(); if (ok) toast(`${ok} photo${ok === 1 ? "" : "s"} posted. MOT!`);
    if (location.hash.startsWith("#/photos")) pGallery(GALFID); else pFixture(fid, "photos");
  };
}
function viewer(i, src) {
  if (src) VIEWSRC = src === "gal" ? GAL : FD ? FD.photos.filter((p) => !isBlocked(p.uid)) : [];
  const L = VIEWSRC; const p = L[i]; if (!p) return;
  closeSheet();
  const v = document.createElement("div"); v.className = "viewer"; v.id = "viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-label", "Photo");
  v.innerHTML = `<div class="row" style="padding:10px 12px;justify-content:space-between"><button class="ibtn" data-act="close-sheet" aria-label="Close">${ic("x")}</button><span class="tiny muted">${i + 1} of ${L.length}</span><button class="opt" data-act="opt" data-type="post" data-id="${esc(p.id)}" data-uid="${esc(p.uid)}" aria-label="Options">•••</button></div>
    <img src="/img/${esc(p.img)}.jpg" alt="${esc(p.text || "Photo by " + p.nick)}">
    <div class="bar2"><div class="row">${av(p.nick)}<div class="grow"><a href="#/u/${esc(p.uid)}" style="color:var(--text);font-weight:600">${esc(p.nick)}</a><div class="tiny muted">${ago(p.at)}</div></div>${cheerBtn(p)}</div>
    ${p.text ? `<div style="line-height:1.45">${esc(p.text)}</div>` : ""}
    <a class="btn" href="#/p/${esc(p.id)}">Comments${p.comments ? " · " + p.comments : ""}</a>
    <div class="row"><button class="btn grow" data-act="view" data-i="${i - 1}" ${i ? "" : "disabled"}>Previous</button><button class="btn grow" data-act="view" data-i="${i + 1}" ${i < L.length - 1 ? "" : "disabled"}>Next</button></div></div>`;
  document.body.appendChild(v);
}

/* ---------- actions ---------- */
const ACT = {
  async pollvote(d) {
    if (needJoin()) return;
    const j = await api("/poll/vote", { id: d.id, opt: +d.i }); const el = document.getElementById("poll-" + d.id); if (el) el.outerHTML = pollHtml(j.poll);
  },
  async admclosepoll(d) { await api("/admin/poll", { close: d.id }); pAdmin(); },
  async going(d) {
    if (needJoin()) return;
    const j = await api("/going", { fid: d.fid, on: d.on === "1" });
    const f = BOOT.fixtures.find((x) => x.id === d.fid); if (f) { f.mine = d.on === "1"; f.going = j.going; }
    if (FD && FD.fixture.id === d.fid) { FD.fixture.mine = d.on === "1"; FD.fixture.going = j.going; }
    const wasPast = f ? past(f) : false;
    toast(d.on === "1" ? (wasPast ? "Logged. That's another away day." : "Marching on together. You're down.") : "Taken you off.");
    reDraw();
  },
  async share() {
    const f = FD && FD.fixture; const title = f ? `Leeds ${f.isAway ? "at " + short(f.home.name) : "v " + short(f.away.name)} · ALAW` : "ALAW";
    const data = { title, text: "Who's going, pubs, meet-ups, lifts and spare tickets for this one:", url: location.href };
    if (navigator.share) { try { await navigator.share(data); } catch (e) {} } else { try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch (e) { toast(location.href); } }
  },
  async cheer(d, el) {
    if (needJoin()) return;
    const j = await api("/cheer", { id: d.id, on: d.on === "1" });
    const on = d.on === "1"; el.dataset.on = on ? "0" : "1"; el.classList.toggle("mine", on); el.setAttribute("aria-pressed", on); el.textContent = `MOT · ${j.cheers}`;
    if (FD) for (const k of ["chat", "tips", "photos"]) for (const p of FD[k]) if (p.id === d.id) { p.cheers = j.cheers; p.cheered = on; }
  },
  opt(d) { optSheet(d); },
  reportsheet(d) {
    if (needJoin()) return;
    sheet(`<h2 class="h2" style="font-size:20px">Report</h2><p class="note">Tell us what's wrong. Three reports and it's hidden straight away.</p>
      <div class="chips">${["Abuse or hate", "Personal details", "Ticket touting", "Spam or scam", "Something else"].map((r) => `<button class="chip" data-act="report" data-type="${esc(d.type)}" data-id="${esc(d.id)}" data-r="${esc(r)}" style="min-height:40px">${esc(r)}</button>`).join("")}</div>
      <button class="btn" data-act="close-sheet">Cancel</button>`);
  },
  async report(d) { await api("/report", { type: d.type, id: d.id, reason: d.r }); closeSheet(); toast("Thanks. We'll take a look."); },
  async block(d) {
    if (needJoin()) return;
    const j = await api("/block", { uid: d.uid, on: d.on === "1" }); ME.blocked = j.blocked; closeSheet();
    toast(d.on === "1" ? "Blocked. You won't see their posts." : "Unblocked."); reDraw();
  },
  async unblock(d) { const j = await api("/block", { uid: d.uid, on: false }); ME.blocked = j.blocked; toast("Unblocked."); pMe(); },
  async del(d) {
    if (!confirmInSheet(d)) return;
  },
  async delyes(d) { await api("/delete", { type: d.type, id: d.id }); closeSheet(); toast("Deleted."); if (d.type === "club") pClubs(); else if (d.type === "lost") pLost(); else reload(); },
  show(d, el) { const f = document.getElementById(d.target); if (!f) return; if (needJoin()) return; f.hidden = !f.hidden; el.hidden = true; const i = f.querySelector("input:not([type=hidden]),textarea"); if (i) i.focus(); },
  async pubvote(d) { if (needJoin()) return; const j = await api("/pub/vote", { id: d.id, v: +d.v }); swapPub(j.pub); },
  async pubtag(d) { if (needJoin()) return; const j = await api("/pub/tag", { id: d.id, tag: d.tag, on: d.on === "1" }); swapPub(j.pub); closeSheet(); },
  tagsheet(d) {
    if (needJoin()) return;
    const p = curPubs().find((x) => x.id === d.id); if (!p) return;
    sheet(`<h2 class="h2" style="font-size:20px">Tag ${esc(p.name)}</h2><p class="note">Tap the ones that are true today.</p><div class="chips">${(BOOT.tags || []).map((t) => { const m = p.tags.find((x) => x.t === t); const on = !!(m && m.mine); return `<button class="chip ${on ? "mine" : ""}" style="min-height:40px" data-act="pubtag" data-id="${esc(p.id)}" data-tag="${esc(t)}" data-on="${on ? 0 : 1}" aria-pressed="${on}">${esc(t)}</button>`; }).join("")}</div><button class="btn" data-act="close-sheet">Done</button>`);
  },
  async meetjoin(d) { if (needJoin()) return; const j = await api("/meet/join", { id: d.id, on: d.on === "1" }); const i = FD.meets.findIndex((m) => m.id === d.id); if (i >= 0) FD.meets[i] = j.meet; reDraw(); },
  async close(d) { await api("/close", { type: d.type, id: d.id, on: d.on === "1" }); toast(d.on === "1" ? "Marked. Nice one." : "Reopened."); if (d.type === "lost") pLost(); else reload(); },
  view(d) { viewer(+d.i, d.src); },
  async feedmore() { await loadFeed(false); },
  async galmore() {
    const last = GAL[GAL.length - 1]; if (!last) return;
    const j = await api(`/gallery?before=${last.at}${GALFID ? "&fid=" + enc(GALFID) : ""}`);
    const add = j.photos.filter((p) => !isBlocked(p.uid)); const off = GAL.length; GAL.push(...add);
    $("#gal").insertAdjacentHTML("beforeend", galHtml(add, off)); $("#galmore").innerHTML = j.more ? `<button class="btn block" data-act="galmore">Load more</button>` : "";
  },
  async sharepost(d) {
    const url = location.origin + "/#/p/" + d.id;
    if (navigator.share) { try { await navigator.share({ title: "ALAW", text: "Look at this on ALAW, the Leeds matchday hub:", url }); } catch (e) {} }
    else { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch (e) { toast(url); } }
  },
  async checkin(d) {
    if (needJoin()) return;
    const j = await api("/checkin", { id: d.id, on: d.on === "1" });
    for (const L of [FD && FD.pubs, GD && GD.pubs]) if (L) for (const p of L) if (p.imHere && p.id !== d.id) { p.imHere = false; p.here = Math.max(0, p.here - 1); p.hereNicks = p.hereNicks.filter((n) => n !== ME.nick); }
    if (j.pub) swapPub(j.pub); else { const p = curPubs().find((x) => x.id === d.id); if (p) { p.imHere = false; p.here = Math.max(0, p.here - 1); p.hereNicks = p.hereNicks.filter((n) => n !== ME.nick); } reDraw(); }
    toast(d.on === "1" ? "Checked in. Leeds fans can see you're here for the next 3 hours." : "Checked out.");
  },
  unattach() { ATTACH = null; const pv = $("#npPrev"); if (pv) pv.innerHTML = ""; },
  pubfocus(d) { closeSheet(); if (MAP) MAP.closePopup(); const el = document.getElementById("pub-" + d.id) || (() => { const m = $("#morePubs"); if (m) { m.hidden = false; const b = m.nextElementSibling; if (b) b.remove(); } return document.getElementById("pub-" + d.id); })(); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } },
  morepubs(d, el) { const m = $("#morePubs"); if (m) m.hidden = false; el.remove(); },
  async droppin(d) {
    if (needJoin()) return;
    if (!navigator.geolocation) { toast("Your phone can't share location here."); return; }
    toast("Finding you…");
    const pos = await getPos();
    sheet(`<h2 class="h2" style="font-size:20px">Drop a pin</h2>
      <p class="note">Other Leeds fans will see this spot on the map with walking directions. It disappears after 4 hours. Pin a pub, a station or a meeting point, never your home.</p>
      <form data-form="pin" class="col"><input type="hidden" name="fid" value="${esc(d.fid)}"><input type="hidden" name="lat" value="${pos.lat}"><input type="hidden" name="lng" value="${pos.lng}">
      <div><label class="l" for="pt">What's happening?</label><input class="f" id="pt" name="title" maxlength="60" value="Leeds fans here, come join us" required></div>
      <div><label class="l" for="pw2">Where is it?</label><input class="f" id="pw2" name="where" maxlength="80" placeholder="Beer garden at the back of the Peacock" required></div>
      <button class="btn y big">Drop the pin</button><button type="button" class="btn" data-act="close-sheet">Cancel</button></form>`);
  },
  "close-sheet"() { closeSheet(); },
  showcode() { $("#codebox").innerHTML = `<div class="code" id="code">${esc(AUTH)}</div><button class="btn" data-act="copycode">Copy code</button>`; },
  async copycode() { try { await navigator.clipboard.writeText(AUTH); toast("Copied. Keep it somewhere safe."); } catch (e) { toast("Press and hold the code to copy it."); } },
  logout() {
    sheet(`<h2 class="h2" style="font-size:20px">Log out?</h2><p class="note">Make sure you've saved your recovery code first, or you won't be able to get back into this account.</p><button class="btn y" data-act="logoutyes">Log out</button><button class="btn" data-act="close-sheet">Cancel</button>`);
  },
  async logoutyes() { AUTH = null; LS.set("alawAuth", null); ME = null; closeSheet(); await refreshBoot(); location.hash = "#/"; route(); },
  async adm(d) { await api("/admin/act", { type: d.type, id: d.id, action: d.a, uid: d.uid }); toast("Done."); pAdmin(); },
  async admrefresh() { const j = await api("/admin/refresh", {}); toast(j.fixtures.error || `${j.fixtures.count} fixtures`); await refreshBoot(); pAdmin(); },
  async admrmfix(d) { await api("/admin/fixture", { remove: d.id }); await refreshBoot(); pAdmin(); },
  admlogout() { ADMIN = null; LS.set("alawAdmin", null); location.hash = "#/me"; },
};
function confirmInSheet(d) {
  sheet(`<h2 class="h2" style="font-size:20px">Delete this?</h2><p class="note">It can't be undone.</p><button class="btn y" data-act="delyes" data-type="${esc(d.type)}" data-id="${esc(d.id)}">Delete</button><button class="btn" data-act="close-sheet">Cancel</button>`);
  return false;
}
const curPubs = () => (location.hash.startsWith("#/g/") ? (GD && GD.pubs) || [] : (FD && FD.pubs) || []);
function swapPub(p) {
  const L = curPubs(); const i = L.findIndex((x) => x.id === p.id); if (i >= 0) L[i] = p;
  reDraw();
}
function reDraw() {
  const [a, , c] = location.hash.replace(/^#\/?/, "").split("/");
  const y = window.scrollY;
  if (a === "f" && FD) drawFixture(c || "info"); else if (a === "g" && GD) drawGround(); else if (a === "" || !a) pHome(); else route();
  window.scrollTo(0, y);
}
function reload() {
  const [a, b, c] = location.hash.replace(/^#\/?/, "").split("/");
  const y = window.scrollY;
  if (a === "f") pFixture(decodeURIComponent(b), c || "info").then(() => window.scrollTo(0, y));
  else if (a === "g") pGround(decodeURIComponent(b)).then(() => window.scrollTo(0, y));
  else route();
}

/* ---------- forms ---------- */
function getPos() {
  return new Promise((ok, no) => navigator.geolocation.getCurrentPosition((p) => ok({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }), (e) => no(new Error(e.code === 1 ? "Location is blocked. Allow it in your browser settings to drop a pin." : "Couldn't find your location. Try again outside.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }));
}
const FORM = {
  async newpost(v, form) {
    if (needJoin()) return;
    const text = String(v.text || "").trim(); if (!text && !ATTACH) throw new Error("Write something or add a photo.");
    const j = ATTACH ? await api("/photo", { fid: v.fid, caption: text, data: ATTACH }) : await api("/post", { kind: "post", fid: v.fid, text });
    ATTACH = null; form.reset(); $("#npPrev").innerHTML = "";
    const el = $("#feed"); const e = el && el.querySelector(".empty"); if (e) e.remove();
    if (el) el.insertAdjacentHTML("afterbegin", postCard({ ...j.post, comments: 0, lastComments: [] }));
    toast("Posted. MOT!");
  },
  async comment(v, form) {
    const j = await api("/comment", { pid: v.pid, text: v.text });
    form.reset(); const e = $("#cEmpty"); if (e) e.remove(); $("#clist").insertAdjacentHTML("beforeend", commentHtml(j.comment)); window.scrollTo(0, document.body.scrollHeight);
  },
  async pin(v) {
    await api("/meet", { fid: v.fid, title: v.title, where: v.where, lat: v.lat, lng: v.lng, pin: true, time: fmtTime(NOW()) });
    closeSheet(); toast("Pin dropped. Fans can find you for the next 4 hours.");
    location.hash = `#/f/${v.fid}/map`; if (location.hash === `#/f/${v.fid}/map`) pFixture(v.fid, "map");
  },
  async rate(v) {
    if (needJoin()) return;
    const r = {}; for (const [k, val] of Object.entries(v)) if (k.startsWith("r:") && val) r[k.slice(2)] = +val;
    const j = await api("/rate", { fid: v.fid, r, motm: v.motm }); FD.rate = j.rate; toast("Ratings in. MOT!"); reDraw();
  },
  async club(v) { if (needJoin()) return; await api("/club", { ...v, coach: !!v.coach }); toast("Branch added. Cheers."); pClubs(); },
  async lost(v) { if (needJoin()) return; await api("/lost", v); toast("Posted. Fingers crossed."); pLost(); },
  async admground(v) { const j = await api("/admin/ground", v); toast(`Saved. Found ${j.pubs} pubs.`); pAdmin(); },
  async admpoll(v) { await api("/admin/poll", { q: v.q, options: String(v.options || "").split("\n") }); toast("Poll live."); pAdmin(); },
  async join(v) {
    const j = await api("/me/create", { nick: v.nick, from: v.from, rules: !!v.rules });
    AUTH = `${j.id}.${j.key}`; LS.set("alawAuth", AUTH);
    await refreshBoot();
    sheet(`<h2 class="h2">Welcome, ${esc(j.nick)}</h2><p class="soft" style="margin:0;line-height:1.5">This is your recovery code. It's your login: save it in your notes or take a screenshot. You'll need it to log in on another phone.</p>
      <div class="code">${esc(AUTH)}</div><button class="btn" data-act="copycode">Copy code</button>
      <a class="btn y big" href="#/" onclick="document.getElementById('sheet').remove()">I've saved it, take me in</a>`);
  },
  async login(v) {
    const code = String(v.code || "").trim(); const old = AUTH; AUTH = code;
    try { await api("/me"); LS.set("alawAuth", code); await refreshBoot(); toast("Welcome back."); location.hash = "#/"; }
    catch (e) { AUTH = old; throw new Error("That code didn't work. Check you copied all of it."); }
  },
  async chat(v, form) {
    if (needJoin()) return;
    const j = await api("/post", { fid: v.fid, kind: "chat", text: v.text });
    form.reset(); const box = $("#chatlist"); const e = $("#chatEmpty"); if (e) e.remove();
    if (box) { box.insertAdjacentHTML("beforeend", msgHtml(j.post)); window.scrollTo(0, document.body.scrollHeight); }
  },
  async tip(v) { if (needJoin()) return; await api("/post", { fid: v.fid, kind: "tip", text: v.text }); toast("Tip posted. Cheers."); reload(); },
  async pub(v) { if (needJoin()) return; await api("/pub", { ...v, tags: v.tags || [] }); toast("Pub added."); reload(); },
  async meet(v) {
    if (needJoin()) return;
    let loc = {}; if (v.useloc) { toast("Finding you…"); loc = await getPos(); }
    await api("/meet", { ...v, ...loc, first: !!v.first }); toast(v.kind === "watch" ? "Added. See you there." : "Meet-up posted."); reload();
  },
  async lift(v) { if (needJoin()) return; await api("/lift", { ...v, share: !!v.share }); toast("Lift offered. Legend."); reload(); },
  async ticket(v) { if (needJoin()) return; await api("/ticket", { ...v, official: !!v.official }); toast("Posted."); reload(); },
  async profile(v) { await api("/me/update", v); toast("Saved."); pMe(); },
  async dm(v, form) { await api("/dm", { to: v.to, text: v.text }); form.reset(); const box = $("#dmlist"); if (box) { const e = box.querySelector(".empty"); if (e) e.remove(); box.insertAdjacentHTML("beforeend", `<div class="msg me" data-at="${Date.now()}"><div class="bub">${esc(v.text)}<div class="tiny muted" style="margin-top:3px">now</div></div></div>`); window.scrollTo(0, document.body.scrollHeight); } },
  async adminkey(v) { ADMIN = v.key; LS.set("alawAdmin", ADMIN); pAdmin(); },
  async admfix(v) { await api("/admin/fixture", { opponent: v.opponent, date: new Date(v.date).toISOString(), venue: v.venue, city: v.city, league: v.league, home: !!v.home }); toast("Fixture added."); await refreshBoot(); pAdmin(); },
};

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  e.preventDefault();
  if (el.dataset.busy) return; el.dataset.busy = "1";
  try { await fn({ ...el.dataset }, el); } catch (er) { toast(er.message); } finally { delete el.dataset.busy; }
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]"); if (!form) return;
  e.preventDefault();
  const fn = FORM[form.dataset.form]; if (!fn) return;
  const fd = new FormData(form), v = {};
  for (const [k, val] of fd.entries()) { if (k === "tags") (v.tags = v.tags || []).push(val); else v[k] = val; }
  const btn = form.querySelector("button:not([type=button])"); if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try { await fn(v, form); } catch (er) { toast(er.message); } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && e.target.matches(".compose textarea")) { e.preventDefault(); e.target.form.requestSubmit(); }
  if (e.key === "Escape") closeSheet();
});
document.addEventListener("change", async (e) => {
  const ds = e.target.dataset || {};
  if (ds.upload) { upload(ds.upload, e.target.files); e.target.value = ""; }
  if (ds.attach) {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { ATTACH = await shrink(f); } catch (er) { toast(er.message); return; }
    const pv = $("#npPrev"); if (pv) pv.innerHTML = `<div style="position:relative"><img src="${ATTACH}" alt="Photo to post" style="width:100%;max-height:260px;object-fit:cover;border-radius:12px"><button type="button" class="ibtn" data-act="unattach" aria-label="Remove photo" style="position:absolute;top:8px;right:8px">${ic("x")}</button></div>`;
  }
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
boot();
})();
