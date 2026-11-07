// Where each ground is, and the pubs, stations and car parks around it, from OpenStreetMap (free, no key).
// Looked up once per ground and cached for 30 days, so the free services are barely touched.
const store = require("./store");

const UA = "ALAW/2.0 (Leeds United fan matchday site)";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const S = { error: null, calls: 0 };

const R = 6371000, rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/* one call at a time with a gap, to respect the free services */
let chain = Promise.resolve();
function queued(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1200))); return p; }
async function getJSON(url, opts = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    S.calls++;
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "en-GB", ...(opts.headers || {}) } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

const TRIED = new Map(), INFLIGHT = new Map();
async function geocode(g) {
  const have = store.get("meta", "geo:" + g.key); if (have) return have;
  if (Date.now() - (TRIED.get("g" + g.key) || 0) < 6 * 3600e3) return null;
  TRIED.set("g" + g.key, Date.now());
  const qs = [[g.name, g.city, "United Kingdom"], [g.name, g.city], [g.club + " stadium", g.city]].map((x) => x.filter(Boolean).join(", "));
  for (const q of qs) {
    try {
      const j = await queued(() => getJSON(`${NOMINATIM}/search?format=json&limit=1&q=${encodeURIComponent(q)}`));
      if (j && j[0]) { const geo = { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6), src: "osm", at: Date.now() }; store.put("meta", "geo:" + g.key, geo); return geo; }
    } catch (e) { S.error = "geocode: " + e.message; }
  }
  return null;
}
function setGeo(key, lat, lng) { const geo = { lat: +lat, lng: +lng, src: "admin", at: Date.now() }; store.put("meta", "geo:" + key, geo); store.del("meta", "near:" + key); TRIED.delete("n" + key); return geo; }

function place(el, center) {
  const lat = el.lat ?? (el.center && el.center.lat), lng = el.lon ?? (el.center && el.center.lon);
  if (lat == null || lng == null) return null;
  const t = el.tags || {};
  return { id: "o" + el.type[0] + el.id, name: t.name || "", lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), d: dist(center, { lat, lng }), kind: t.amenity === "bar" ? "bar" : t.amenity || t.railway || "" };
}
async function nearby(g) {
  const key = "near:" + g.key, have = store.get("meta", key);
  if (have && Date.now() - have.at < 30 * 864e5) return have;
  if (INFLIGHT.has(g.key)) return INFLIGHT.get(g.key);
  if (Date.now() - (TRIED.get("n" + g.key) || 0) < 3 * 3600e3) return have || null;
  TRIED.set("n" + g.key, Date.now());
  const job = (async () => {
    const geo = await geocode(g); if (!geo) return have || null;
    const q = `[out:json][timeout:25];(nwr["amenity"~"^(pub|bar)$"](around:1800,${geo.lat},${geo.lng});nwr["railway"="station"](around:4000,${geo.lat},${geo.lng});nwr["amenity"="parking"]["name"](around:1500,${geo.lat},${geo.lng}););out center tags 300;`;
    try {
      const j = await queued(() => getJSON(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" } }));
      const els = (j.elements || []).map((e) => ({ e, p: place(e, geo) })).filter((x) => x.p && x.p.name);
      const pick = (f, n) => els.filter((x) => f(x.e.tags || {})).map((x) => x.p).sort((a, b) => a.d - b.d).filter((p, i, A) => A.findIndex((y) => y.name === p.name) === i).slice(0, n);
      const out = {
        at: Date.now(), ground: g.key, center: geo,
        pubs: pick((t) => t.amenity === "pub" || t.amenity === "bar", 30),
        stations: pick((t) => t.railway === "station", 4),
        parking: pick((t) => t.amenity === "parking", 6),
      };
      store.put("meta", key, out); S.error = null; return out;
    } catch (e) { S.error = "overpass: " + e.message; return have || null; }
  })();
  INFLIGHT.set(g.key, job);
  try { return await job; } finally { INFLIGHT.delete(g.key); }
}
const cached = (key) => store.get("meta", "near:" + key) || null;
function findOsmPub(id) {
  for (const m of store.all("meta")) if (m && m.pubs && m.center) { const p = m.pubs.find((x) => x.id === id); if (p) return { ...p, ground: m.ground }; }
  return null;
}
const status = () => ({ error: S.error, calls: S.calls });

module.exports = { nearby, cached, geocode, setGeo, findOsmPub, dist, status };
