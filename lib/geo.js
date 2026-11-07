// Where each ground is, and the pubs, stations and car parks around it, from OpenStreetMap (free, no key).
// Grounds Leeds are likely to visit are built in, so only the pub search goes out to the internet.
// Results are cached for 30 days; a failed search is retried after 10 minutes.
const store = require("./store");

const UA = "ALAW/2.1 (Leeds United fan matchday site; contact via alaw.onrender.com)";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const OVERPASS = (process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter").split(",").map((s) => s.trim()).filter(Boolean);
const FSA = process.env.FSA_URL || "https://api.ratings.food.gov.uk";
const S = { error: null, calls: 0, last: null };

/* UK pubs from the Food Standards Agency hygiene ratings (every licensed pub, bar and club, with location; free, no key) */
const tidy = (s) => { const t = String(s || "").trim(); return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(&'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/'S\b/g, "'s") : t; };
function fsaMap(e, geo) {
  const lat = e.geocode && +e.geocode.latitude, lng = e.geocode && +e.geocode.longitude;
  if (!lat || !lng) return null;
  const name = tidy(e.BusinessName);
  if (!name || /\b(ltd|limited|plc|stadium|football club|cricket|golf|hotel group|students' union|university)\b/i.test(name)) return null;
  return { id: "f" + e.FHRSID, name, lat: +lat.toFixed(6), lng: +lng.toFixed(6), d: dist(geo, { lat, lng }), kind: "pub", address: [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.PostCode].filter(Boolean).map(tidy).join(", ").replace(/,\s*([A-Z0-9]{2,4}\s?[0-9][A-Z]{2})$/i, (m, pc) => ", " + pc.toUpperCase()) };
}
async function searchPubs(g, q) {
  const near = cached(g.key); const geo = near && near.center; if (!geo) return [];
  const url = `${FSA}/Establishments?name=${encodeURIComponent(q)}&latitude=${geo.lat}&longitude=${geo.lng}&maxDistanceLimit=15&businessTypeId=7843&sortOptionKey=distance&pageSize=40&pageNumber=1`;
  const j = await getJSON(url, { headers: { "x-api-version": "2" } }, 15000);
  const L = (j.establishments || []).map((e) => fsaMap(e, geo)).filter(Boolean);
  // remember them so fans can check in and rate them
  const ids = new Set(near.pubs.map((p) => p.id)); const add = L.filter((p) => !ids.has(p.id));
  if (add.length) { near.pubs = [...near.pubs, ...add]; store.put("meta", "near:" + g.key, near); }
  return L;
}
async function fsaPubs(geo) {
  const url = `${FSA}/Establishments?latitude=${geo.lat}&longitude=${geo.lng}&maxDistanceLimit=2&businessTypeId=7843&sortOptionKey=distance&pageSize=300&pageNumber=1`;
  const j = await getJSON(url, { headers: { "x-api-version": "2" } }, 20000);
  const L = (j.establishments || []).map((e) => fsaMap(e, geo)).filter(Boolean);
  return L.sort((a, b) => a.d - b.d).filter((p, i, A) => A.findIndex((y) => y.name === p.name && Math.abs(y.d - p.d) < 150) === i).slice(0, 180);
}

/* Stadium locations (centre of the pitch, near enough for a 1.8 km pub search). Admin can override any of these. */
const KNOWN = [
  ["elland road", 53.7778, -1.5721], ["anfield", 53.4308, -2.9608], ["old trafford", 53.4631, -2.2913], ["etihad", 53.4831, -2.2004],
  ["emirates", 51.5549, -0.1084], ["stamford bridge", 51.4817, -0.191], ["tottenham hotspur stadium", 51.6043, -0.0664], ["london stadium", 51.5386, -0.0166],
  ["villa park", 52.5092, -1.8848], ["st. james' park", 54.9756, -1.6217], ["st james' park", 54.9756, -1.6217], ["st james park", 54.9756, -1.6217],
  ["goodison park", 53.4388, -2.9664], ["hill dickinson", 53.4246, -3.0039], ["everton stadium", 53.4246, -3.0039], ["bramley-moore", 53.4246, -3.0039],
  ["molineux", 52.5902, -2.1304], ["selhurst park", 51.3983, -0.0855], ["american express", 50.8616, -0.0837], ["amex", 50.8616, -0.0837],
  ["gtech community", 51.4907, -0.2886], ["brentford community", 51.4907, -0.2886], ["craven cottage", 51.4749, -0.2217], ["city ground", 52.94, -1.1328],
  ["vitality stadium", 50.7352, -1.8384], ["dean court", 50.7352, -1.8384], ["turf moor", 53.789, -2.2302], ["stadium of light", 54.9146, -1.3884],
  ["kenilworth road", 51.8843, -0.4316], ["bramall lane", 53.3703, -1.4709], ["hillsborough", 53.4114, -1.5006], ["the den", 51.4859, -0.0509],
  ["ashton gate", 51.44, -2.6203], ["riverside stadium", 54.5782, -1.217], ["carrow road", 52.6221, 1.309], ["portman road", 52.055, 1.1448],
  ["king power", 52.6204, -1.1422], ["st. mary's stadium", 50.9058, -1.3911], ["st mary's stadium", 50.9058, -1.3911], ["ewood park", 53.7286, -2.4893],
  ["deepdale", 53.7722, -2.6881], ["bet365 stadium", 52.9884, -2.1754], ["mkm stadium", 53.7462, -0.3678], ["kcom stadium", 53.7462, -0.3678],
  ["the hawthorns", 52.509, -1.9639], ["pride park", 52.915, -1.4472], ["fratton park", 50.7964, -1.0639], ["home park", 50.3881, -4.1508],
  ["loftus road", 51.5093, -0.2322], ["kiyan prince", 51.5093, -0.2322], ["vicarage road", 51.65, -0.4015], ["oakwell", 53.5522, -1.4677],
  ["coventry building society arena", 52.4481, -1.4956], ["cbs arena", 52.4481, -1.4956], ["cardiff city stadium", 51.4728, -3.203],
  ["swansea.com stadium", 51.6428, -3.9351], ["st. andrew's", 52.4757, -1.8682], ["st andrew's", 52.4757, -1.8682], ["the valley", 51.4865, 0.0364],
  ["wembley", 51.556, -0.2796], ["john smith's stadium", 53.6543, -1.7684], ["racecourse ground", 53.0521, -3.0049], ["stok cae ras", 53.0521, -3.0049],
  ["bloomfield road", 53.8046, -3.0482], ["sincil bank", 53.2183, -0.5408], ["new york stadium", 53.4279, -1.362], ["aessea new york", 53.4279, -1.362],
  ["madejski", 51.4222, -0.9827], ["select car leasing", 51.4222, -0.9827], ["kassam", 51.7164, -1.2081], ["the den, london", 51.4859, -0.0509],
  ["university of bradford stadium", 53.8044, -1.7591], ["valley parade", 53.8044, -1.7591], ["eco-power stadium", 53.5103, -1.1138], ["keepmoat", 53.5103, -1.1138],
];
const norm = (s) => String(s || "").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
function known(g) { const n = norm(g.name); const k = KNOWN.find(([name]) => n.includes(name) || (name.length > 8 && name.includes(n) && n.length > 6)); return k ? { lat: k[1], lng: k[2], src: "built-in" } : null; }

const R = 6371000, rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/* one call at a time with a gap, to respect the free services */
let chain = Promise.resolve();
function queued(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1500))); return p; }
async function getJSON(url, opts = {}, ms = 40000) {
  S.calls++;
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms), headers: { "User-Agent": UA, "Accept-Language": "en-GB", accept: "application/json", ...(opts.headers || {}) } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

const TRIED = new Map(), INFLIGHT = new Map();
const RETRY = 10 * 60e3;
const NEAR_V = 3; // bump to throw away older, smaller pub lists
async function geocode(g) {
  const have = store.get("meta", "geo:" + g.key); if (have) return have;
  const k = known(g); if (k) { const geo = { ...k, at: Date.now() }; store.put("meta", "geo:" + g.key, geo); return geo; }
  if (Date.now() - (TRIED.get("g" + g.key) || 0) < RETRY) return null;
  TRIED.set("g" + g.key, Date.now());
  const qs = [[g.name, g.city, "United Kingdom"], [g.name, g.city], [g.club + " stadium", g.city]].map((x) => x.filter(Boolean).join(", "));
  for (const q of qs) {
    try {
      const j = await queued(() => getJSON(`${NOMINATIM}/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {}, 15000));
      if (j && j[0]) { const geo = { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6), src: "osm", at: Date.now() }; store.put("meta", "geo:" + g.key, geo); return geo; }
    } catch (e) { S.error = `find ${g.name}: ${e.message}`; }
  }
  if (!S.error) S.error = `couldn't find ${g.name} on the map: set it in Admin`;
  return null;
}
function setGeo(key, lat, lng) { const geo = { lat: +lat, lng: +lng, src: "admin", at: Date.now() }; store.put("meta", "geo:" + key, geo); store.del("meta", "near:" + key); TRIED.delete("n" + key); return geo; }

function place(el, center) {
  const lat = el.lat ?? (el.center && el.center.lat), lng = el.lon ?? (el.center && el.center.lon);
  if (lat == null || lng == null) return null;
  const t = el.tags || {};
  return { id: "o" + el.type[0] + el.id, name: t.name || "", lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), d: dist(center, { lat, lng }), kind: t.amenity === "bar" ? "bar" : t.amenity || t.railway || "" };
}
async function overpass(q) {
  let err = null;
  for (const url of OVERPASS) {
    try {
      const j = await queued(() => getJSON(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" } }));
      if (j && Array.isArray(j.elements) && !(j.remark && /timed out|runtime error/i.test(j.remark) && !j.elements.length)) return j;
      err = new Error(j && j.remark ? j.remark.slice(0, 80) : "empty answer");
    } catch (e) { err = e; }
  }
  throw err || new Error("no map server answered");
}
async function nearby(g, force) {
  const key = "near:" + g.key, have = store.get("meta", key);
  if (!force && have && have.v === NEAR_V && have.pubs && have.pubs.length && Date.now() - have.at < 30 * 864e5) return have;
  if (INFLIGHT.has(g.key)) return INFLIGHT.get(g.key);
  if (!force && Date.now() - (TRIED.get("n" + g.key) || 0) < RETRY) return have || null;
  TRIED.set("n" + g.key, Date.now());
  const job = (async () => {
    const geo = await geocode(g); if (!geo) return have || null;
    const out = { v: NEAR_V, at: Date.now(), ground: g.key, center: geo, pubs: [], stations: (have && have.stations) || [], parking: (have && have.parking) || [], src: [] };
    const errs = [];
    // 1. pubs from the Food Standards Agency (UK)
    try { out.pubs = await fsaPubs(geo); if (out.pubs.length) out.src.push("FSA"); } catch (e) { errs.push("FSA " + e.message); }
    // 2. stations and car parks (and pubs, if the FSA had none) from OpenStreetMap
    const q = `[out:json][timeout:25];(${out.pubs.length ? "" : `nwr["amenity"~"^(pub|bar)$"](around:1800,${geo.lat},${geo.lng});`}nwr["railway"="station"](around:4000,${geo.lat},${geo.lng});nwr["amenity"="parking"]["name"](around:1500,${geo.lat},${geo.lng}););out center tags 300;`;
    try {
      const j = await overpass(q);
      const els = (j.elements || []).map((e) => ({ e, p: place(e, geo) })).filter((x) => x.p && x.p.name);
      const pick = (f, n) => els.filter((x) => f(x.e.tags || {})).map((x) => x.p).sort((a, b) => a.d - b.d).filter((p, i, A) => A.findIndex((y) => y.name === p.name) === i).slice(0, n);
      if (!out.pubs.length) out.pubs = pick((t) => t.amenity === "pub" || t.amenity === "bar", 30);
      out.stations = pick((t) => t.railway === "station", 4); out.parking = pick((t) => t.amenity === "parking", 6); out.src.push("OSM");
    } catch (e) { errs.push("OSM " + e.message); }
    if (!out.pubs.length) out.at = 0; // try again soon
    store.put("meta", key, out);
    S.error = errs.length ? `${g.name}: ${errs.join("; ")}` : null; S.last = `${g.name}: ${out.pubs.length} pubs (${out.src.join("+") || "none"})`;
    console.log(`[map] ${S.last}, ${out.stations.length} stations, ${out.parking.length} car parks${errs.length ? " · problems: " + errs.join("; ") : ""}`);
    return out;
  })();
  INFLIGHT.set(g.key, job);
  try { return await job; } finally { INFLIGHT.delete(g.key); }
}
const cached = (key) => store.get("meta", "near:" + key) || null;
const fresh = (key) => { const n = cached(key); return !!(n && n.v === NEAR_V && n.pubs && n.pubs.length && Date.now() - n.at < 30 * 864e5); };
function findPlace(id) {
  for (const m of store.all("meta")) if (m && m.pubs && m.center) { const p = m.pubs.find((x) => x.id === id); if (p) return { ...p, ground: m.ground }; }
  return null;
}
const status = () => ({ error: S.error, calls: S.calls, last: S.last, servers: OVERPASS.length });

module.exports = { nearby, cached, geocode, setGeo, findOsmPub: findPlace, dist, status, known, searchPubs, fresh };
