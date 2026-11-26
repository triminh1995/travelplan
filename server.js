// Travel Plan — server doc lap (Node.js thuan, khong phu thuoc goi ngoai)
// Phuc vu public/ + API REST, du lieu luu tai data/trips.json
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "trips.json");
const JOURNAL_FILE = path.join(DATA_DIR, "journal.json");

/* ============ Dang nhap Google (OAuth 2.0, Node thuan) ============
   Cau hinh bang bien moi truong: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
   BASE_URL (tuy chon), SESSION_SECRET (tuy chon). Chua cau hinh khoa thi
   tinh nang dang nhap tat, app van chay binh thuong. */
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const AUTH_CONFIGURED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const SESSION_SECRET = process.env.SESSION_SECRET || GOOGLE_CLIENT_SECRET || crypto.randomBytes(32).toString("hex");

function baseUrl(req) {
  const env = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return proto + "://" + host;
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyPayload(raw) {
  if (!raw || typeof raw !== "string") return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const body = raw.slice(0, dot), sig = raw.slice(dot + 1);
  const expect = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function cookieStr(name, value, maxAgeSec, secure) {
  const parts = [name + "=" + encodeURIComponent(value), "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAgeSec != null) parts.push("Max-Age=" + maxAgeSec);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
function currentUser(req) {
  const p = verifyPayload(parseCookies(req).tp_session);
  if (!p || !p.sub) return null;
  return { sub: p.sub, email: p.email || "", name: p.name || "", picture: p.picture || "" };
}
function callerKey(req, res) {
  const u = currentUser(req);
  if (u) return "u:" + u.sub;
  let g = parseCookies(req).tp_guest;
  if (!g) {
    g = uid() + uid();
    if (res) { try { res.setHeader("Set-Cookie", cookieStr("tp_guest", g, 365 * 24 * 3600, baseUrl(req).startsWith("https://"))); } catch {} }
  }
  return "g:" + g;
}

async function handleAuth(req, res, pathname) {
  const secure = baseUrl(req).startsWith("https://");
  if (pathname === "/auth/google") {
    if (!AUTH_CONFIGURED) { res.writeHead(302, { Location: "/?authmsg=unconfigured" }); return res.end(); }
    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: baseUrl(req) + "/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      state, access_type: "online", prompt: "select_account"
    });
    res.writeHead(302, {
      Location: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
      "Set-Cookie": cookieStr("tp_state", signPayload({ s: state, exp: Date.now() + 10 * 60 * 1000 }), 600, secure)
    });
    return res.end();
  }
  if (pathname === "/auth/google/callback") {
    const fail = () => { res.writeHead(302, { Location: "/?authmsg=error" }); res.end(); };
    if (!AUTH_CONFIGURED) return fail();
    const u = new URL(req.url, "http://localhost");
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    const saved = verifyPayload(parseCookies(req).tp_state);
    if (!code || !state || !saved || saved.s !== state) return fail();
    try {
      const tr = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: baseUrl(req) + "/auth/google/callback", grant_type: "authorization_code"
        }),
        signal: AbortSignal.timeout(15000)
      });
      const tj = await tr.json().catch(() => ({}));
      if (!tj.access_token) return fail();
      const ur = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: "Bearer " + tj.access_token },
        signal: AbortSignal.timeout(15000)
      });
      const ui = await ur.json().catch(() => ({}));
      if (!ui.sub) return fail();
      const session = signPayload({
        sub: ui.sub, email: ui.email || "", name: ui.name || "", picture: ui.picture || "",
        exp: Date.now() + 30 * 24 * 3600 * 1000
      });
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": [cookieStr("tp_session", session, 30 * 24 * 3600, secure), cookieStr("tp_state", "", 0, secure)]
      });
      return res.end();
    } catch { return fail(); }
  }
  if (pathname === "/auth/logout") {
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": [cookieStr("tp_session", "", 0, secure), cookieStr("tp_state", "", 0, secure)]
    });
    return res.end();
  }
  res.writeHead(404); return res.end("Not found");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const uid = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

function defaultPrep() {
  const mk = (name, highlight, items) => ({ id: uid(), name, highlight: !!highlight, items: items.map(t => ({ id: uid(), text: t, done: false })) });
  return [
    mk("Giấy tờ quan trọng", true, ["Hộ chiếu còn hạn ít nhất 6 tháng", "CCCD / bằng lái xe", "Vé máy bay (lưu điện thoại + in dự phòng)", "Xác nhận đặt phòng", "Bảo hiểm du lịch", "Ảnh thẻ dự phòng"]),
    mk("Tiền và thẻ", false, ["Tiền mặt của nước sắp đến", "Thẻ tín dụng / ghi nợ quốc tế", "Ít tiền lẻ cho xe và ăn vặt"]),
    mk("Quần áo", false, ["Quần áo đủ theo số ngày", "Áo khoác nhẹ", "Đồ ngủ", "Giày đi bộ thoải mái", "Đồ bơi (nếu đi biển)"]),
    mk("Đồ điện tử", false, ["Điện thoại + dây sạc", "Sạc dự phòng", "Tai nghe", "Ổ cắm chuyển đổi (khi đi nước ngoài)", "Máy ảnh"]),
    mk("Vệ sinh và thuốc", false, ["Bàn chải, kem đánh răng", "Kem chống nắng", "Thuốc cảm, đau đầu, say xe", "Khăn giấy ướt", "Băng cá nhân"]),
    mk("Khác", false, ["Ô / dù nhỏ", "Túi đựng đồ bẩn", "Bình nước cá nhân"])
  ];
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.trips)) return j;
  } catch {}
  return { trips: [] };
}
function saveData(d) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 1));
}
let DB = loadData();

/* ============ Nhat ky theo tai khoan: data/journal.json { [googleSub]: [entry] } ============ */
function loadJournal() {
  try {
    const j = JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8"));
    if (j && typeof j === "object" && !Array.isArray(j)) return j;
  } catch {}
  return {};
}
function saveJournal(j) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(j, null, 1));
}
let JOURNAL = loadJournal();

/* ============ Cam nang du phong: tu lap tu Wikipedia, luu dem tai data/guide-cache.json ============ */
const GUIDE_CACHE_FILE = path.join(DATA_DIR, "guide-cache.json");
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").trim();
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

let BUNDLED = null;
function bundledGuides() {
  if (!BUNDLED) {
    try { BUNDLED = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data", "guides.json"), "utf8")).cities || {}; }
    catch { BUNDLED = {}; }
  }
  return BUNDLED;
}
function loadGuideCache() {
  try { const j = JSON.parse(fs.readFileSync(GUIDE_CACHE_FILE, "utf8")); if (j && j.cities) return j; } catch {}
  return { cities: {} };
}
function saveGuideCache(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GUIDE_CACHE_FILE, JSON.stringify(c, null, 1));
}
function findGuideIn(book, cityName) {
  const n = norm(cityName);
  for (const k in book) if (norm(book[k].name) === n) return book[k];
  return null;
}

const WIKI_UA = { headers: { "User-Agent": "TravelPlanApp/1.0 (personal travel app)", "Accept": "application/json" } };
async function wikiApi(lang, params) {
  const url = `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ format: "json", ...params })}`;
  const r = await fetch(url, { ...WIKI_UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Wikipedia " + r.status);
  return r.json();
}
const PAGE_PROPS = { prop: "extracts|pageimages|coordinates", explaintext: "1", exintro: "1", piprop: "original|thumbnail", pithumbsize: "1000" };
function pageImg(p) { return (p.original && p.original.source) || (p.thumbnail && p.thumbnail.source) || null; }
function trimSentences(text, maxSent, maxLen) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  let out = clean.split(/(?<=[.!?])\s+/).slice(0, maxSent).join(" ");
  if (out.length > maxLen) out = out.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  return out;
}
const PLACE_BLOCK = ["railway station", "train station", " station", "airport", "san bay", "list of", "danh sach", "district", " ward", "commune", "province", "quan ", "phuong ", "thi tran", "river", "song ", "canal", "kenh ", "school", "truong ", "hospital", "benh vien", "university", "dai hoc", "stadium", "san van dong", "cemetery", "nghia trang", "power station", "nha may"];
function isPlacePage(p, cityTitleN) {
  if (!p || !p.title) return false;
  const tn = norm(p.title);
  if (tn === cityTitleN) return false;
  if (PLACE_BLOCK.some(b => tn.includes(norm(b)))) return false;
  if (!p.extract || p.extract.replace(/\s+/g, " ").trim().length < 50) return false;
  return true;
}
async function wikiResolveCity(lang, name) {
  try {
    const j = await wikiApi(lang, { action: "query", generator: "search", gsrsearch: name, gsrnamespace: "0", gsrlimit: "1", ...PAGE_PROPS });
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    return pages[0] || null;
  } catch { return null; }
}
async function wikiPageByTitle(lang, title) {
  try {
    const j = await wikiApi(lang, { action: "query", titles: title, ...PAGE_PROPS });
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    return pages[0] && !pages[0].missing ? pages[0] : null;
  } catch { return null; }
}
async function wikiEnTitle(page) {
  try {
    const j = await wikiApi("vi", { action: "query", pageids: String(page.pageid), prop: "langlinks", lllang: "en", lllimit: "1" });
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    const ll = pages[0] && pages[0].langlinks && pages[0].langlinks[0];
    return ll ? ll["*"] : null;
  } catch { return null; }
}
async function wikiGeoPlaces(lang, lat, lon, radius) {
  try {
    const j = await wikiApi(lang, { action: "query", generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: String(radius || 10000), ggslimit: "50", ...PAGE_PROPS, exintro: "0", exsentences: "3" });
    return j.query && j.query.pages ? Object.values(j.query.pages) : [];
  } catch { return []; }
}
async function wikiCategoryPlaces(enTitle) {
  try {
    const j = await wikiApi("en", { action: "query", generator: "categorymembers", gcmtitle: `Category:Tourist attractions in ${enTitle}`, gcmtype: "page", gcmlimit: "50", ...PAGE_PROPS, exintro: "0", exsentences: "3" });
    return j.query && j.query.pages ? Object.values(j.query.pages) : [];
  } catch { return []; }
}

async function wikiDataPlace(name) {
  // Du phong cuoi: tim o Wikidata theo ten (uu tien nhan tieng Viet), lay toa do + ten bai tieng Anh
  try {
    const sUrl = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: "json", action: "wbsearchentities", search: name, language: "vi", type: "item", limit: "5" })}`;
    const sr = await fetch(sUrl, { ...WIKI_UA, signal: AbortSignal.timeout(15000) });
    if (!sr.ok) return null;
    const sj = await sr.json();
    const ids = (sj.search || []).map(e => e.id).filter(Boolean);
    if (!ids.length) return null;
    const eUrl = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: "json", action: "wbgetentities", ids: ids.join("|"), props: "claims|sitelinks", sitefilter: "enwiki" })}`;
    const er = await fetch(eUrl, { ...WIKI_UA, signal: AbortSignal.timeout(15000) });
    if (!er.ok) return null;
    const ej = await er.json();
    for (const id of ids) {
      const ent = ej.entities && ej.entities[id];
      const p625 = ent && ent.claims && ent.claims.P625 && ent.claims.P625[0];
      const v = p625 && p625.mainsnak && p625.mainsnak.datavalue && p625.mainsnak.datavalue.value;
      if (v && typeof v.latitude === "number" && typeof v.longitude === "number") {
        const enTitle = ent.sitelinks && ent.sitelinks.enwiki ? ent.sitelinks.enwiki.title : null;
        return { lat: v.latitude, lon: v.longitude, enTitle };
      }
    }
    return null;
  } catch { return null; }
}
const guideInflight = new Map();
async function wikiCategoryPlacesDeep(enTitle) {
  try {
    const j = await wikiApi("en", { action: "query", list: "categorymembers", cmtitle: `Category:Tourist attractions in ${enTitle}`, cmtype: "subcat", cmlimit: "10" });
    const subs = (j.query && j.query.categorymembers) || [];
    let out = [];
    for (const sc of subs.slice(0, 6)) {
      const jj = await wikiApi("en", { action: "query", generator: "categorymembers", gcmtitle: sc.title, gcmtype: "page", gcmlimit: "50", ...PAGE_PROPS, exintro: "0", exsentences: "3" });
      if (jj.query && jj.query.pages) out = out.concat(Object.values(jj.query.pages));
    }
    return out;
  } catch { return []; }
}
async function buildWikiGuide(cityName, country) {
  // Uu tien Wikipedia tieng Viet (gioi thieu tieng Viet), du phong tieng Anh
  let cityPage = await wikiResolveCity("vi", cityName);
  let cityLang = "vi";
  if (!cityPage) { cityPage = await wikiResolveCity("en", cityName); cityLang = "en"; }
  if (!cityPage) return null;
  let enPage = cityLang === "en" ? cityPage : await wikiResolveCity("en", cityName);
  let coords = (cityPage.coordinates && cityPage.coordinates[0]) || (enPage && enPage.coordinates && enPage.coordinates[0]) || null;
  if (cityLang === "vi" && (!enPage || !coords)) {
    // Ten tieng Viet khong tim truc tiep duoc bai tieng Anh: di qua lien ket ngon ngu cua bai tieng Viet
    const enTitle = await wikiEnTitle(cityPage);
    if (enTitle) {
      const ep = await wikiPageByTitle("en", enTitle);
      if (ep) { enPage = ep; if (!coords && ep.coordinates && ep.coordinates[0]) coords = ep.coordinates[0]; }
    }
  }
  if (!coords) {
    const wd = await wikiDataPlace(cityName);
    if (wd) {
      coords = { lat: wd.lat, lon: wd.lon };
      if (wd.enTitle && (!enPage || !(enPage.coordinates && enPage.coordinates[0]))) {
        const ep = await wikiPageByTitle("en", wd.enTitle);
        if (ep) enPage = ep;
      }
    }
  }
  if (!coords && country) {
    // Ten thanh pho trung ten nguoi/trang dinh huong (vd "Livingstone"): thu lai kem quoc gia de lay dung bai viet thanh pho
    const q = await wikiResolveCity("en", `${cityName}, ${country}`) || await wikiResolveCity("en", `${cityName} ${country}`);
    if (q && q.coordinates && q.coordinates[0]) { cityPage = q; cityLang = "en"; enPage = q; coords = q.coordinates[0]; }
  }

  const cityTitleN = norm(cityPage.title);
  const enTitleN = enPage && enPage.title ? norm(enPage.title) : "";
  const seen = new Set();
  const rawPlaces = [];
  const pushAll = (arr) => { for (const p of arr || []) { const tn = norm(p && p.title); if (!tn || tn === enTitleN || seen.has(tn) || !isPlacePage(p, cityTitleN)) continue; const pc = p.coordinates && p.coordinates[0]; if (pc) { const dup = rawPlaces.some(q => { const qc = q.coordinates && q.coordinates[0]; return qc && Math.abs(qc.lat - pc.lat) < 0.0025 && Math.abs(qc.lon - pc.lon) < 0.0025; }); if (dup) continue; } seen.add(tn); rawPlaces.push(p); } };
  const [catPlaces, geoPlaces, geoEn] = await Promise.all([
    enPage && enPage.title ? wikiCategoryPlaces(enPage.title) : Promise.resolve([]),
    coords ? wikiGeoPlaces(cityLang, coords.lat, coords.lon) : Promise.resolve([]),
    coords ? wikiGeoPlaces("en", coords.lat, coords.lon) : Promise.resolve([])
  ]);
  pushAll(catPlaces);
  pushAll(geoPlaces);
  pushAll(geoEn);
  if (coords && rawPlaces.length < 8) {
    const wide = await Promise.all([wikiGeoPlaces(cityLang, coords.lat, coords.lon, 20000), wikiGeoPlaces("en", coords.lat, coords.lon, 20000)]);
    pushAll(wide[0]); pushAll(wide[1]);
  }
  if (enPage && enPage.title && rawPlaces.length < 8) pushAll(await wikiCategoryPlacesDeep(enPage.title));
  rawPlaces.sort((a, b) => (pageImg(b) ? 1 : 0) - (pageImg(a) ? 1 : 0));
  const picked = rawPlaces.slice(0, 12);
  if (!picked.length) return null;

  const city = String(cityName).trim();
  const places = picked.map((p, i) => {
    const name = String(p.title).replace(/\s*\([^)]*\)\s*$/, "").trim() || p.title;
    return {
      id: "w" + i + "-" + slugify(p.title).slice(0, 40),
      name, desc: trimSentences(p.extract, 2, 300),
      go: `Điểm tham quan tại ${city}. Bạn mở Google Maps tìm "${name}" để xem đường đi và phương tiện phù hợp nhất từ nơi lưu trú của mình.`,
      dur: "Linh hoạt",
      steps: [`Tham quan, chụp ảnh và đọc thông tin giới thiệu tại ${name}.`, "Ghép các điểm tham quan gần nhau trong cùng một buổi để tiết kiệm thời gian di chuyển."],
      image: pageImg(p), nearby: { food: [], play: [], shop: [] }
    };
  });
  // Lap anh cho dia diem con thieu: dung anh bai viet thanh pho, roi den anh dia diem dau tien co anh
  const cityImg = pageImg(cityPage);
  places.forEach(p => { if (!p.image) p.image = cityImg || (places.find(q => q.image) || {}).image || null; });
  const days = [];
  for (let i = 0; i < places.length; i += 3) days.push(places.slice(i, i + 3).map(p => p.id));
  return {
    // Anh bia: lay anh dia danh noi tieng thu thap duoc trong dung thanh pho,
    // chi du phong bang anh bai viet thanh pho (co the la anh cap tinh/khu vuc)
    key: "wiki-" + slugify(city), name: city, country: country || "", hero: (places[0] && places[0].image) || pageImg(cityPage),
    intro: trimSentences(cityPage.extract, 3, 460) || `${city} — cẩm nang được tổng hợp tự động từ Wikipedia.`,
    bestTime: `Cẩm nang của ${city} được tổng hợp tự động từ Wikipedia nên chưa có gợi ý thời điểm riêng — bạn xem dự báo thời tiết tại địa phương trước chuyến đi để chọn những ngày đẹp nhé.`,
    transportTips: `Thông tin di chuyển chi tiết tại ${city} chưa có sẵn trong cẩm nang tự động này; bạn dùng Google Maps để tra tuyến xe buýt/tàu và thời gian di chuyển giữa các điểm tham quan.`,
    places, suggestedDays: days, auto: true
  };
}
async function resolveGuide(cityName, country) {
  const bundled = findGuideIn(bundledGuides(), cityName);
  if (bundled) return bundled;
  const cache = loadGuideCache();
  const hit = findGuideIn(cache.cities, cityName);
  if (hit) return hit;
  const nk = norm(cityName);
  if (guideInflight.has(nk)) return guideInflight.get(nk);
  const job = (async () => {
    try {
      const g = await buildWikiGuide(cityName, country);
      if (g) { const c2 = loadGuideCache(); c2.cities[g.key] = g; saveGuideCache(c2); }
      return g;
    } finally { guideInflight.delete(nk); }
  })();
  guideInflight.set(nk, job);
  return job;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
const findTrip = (id) => DB.trips.find(t => t.id === id);

// Snapshot Nhat ky cua mot chuyen; keep = muc cu (giu id, va giu savedAt neu co)
function buildSnapshot(trip, keep) {
  const bgGuide = findGuideIn(bundledGuides(), trip.city);
  const firstPlaceImg = Object.values(trip.days || {}).flat().find(p => p && p.image);
  return {
    id: keep && keep.id ? keep.id : uid(), tripId: trip.id, city: trip.city, country: trip.country || "",
    hero: (bgGuide && bgGuide.hero) || (firstPlaceImg && firstPlaceImg.image) || null,
    start: trip.startDate, end: trip.endDate, days: trip.days || {}, stay: trip.stay || null,
    placeCount: Object.values(trip.days || {}).reduce((a, d) => a + d.length, 0),
    savedAt: keep && keep.savedAt ? keep.savedAt : new Date().toISOString()
  };
}
// Thanh pho da luu Nhat ky thi moi thay doi lich trinh tu dong cap nhat snapshot, khong can bam Luu lai
function syncJournalForTrip(trip) {
  if (!trip) return;
  let changed = false;
  for (const sub of Object.keys(JOURNAL)) {
    const arr = JOURNAL[sub];
    if (!Array.isArray(arr)) continue;
    const ix = arr.findIndex(e => e.tripId === trip.id);
    if (ix >= 0) { arr[ix] = buildSnapshot(trip, arr[ix]); changed = true; }
  }
  if (changed) saveJournal(JOURNAL);
}


/* ============ Phat am tieng Lao qua Microsoft Edge TTS (Node thuan) ============
   Google Translate TTS khong co giong Lao (tl=lo tra HTTP 400) nen rieng
   tieng Lao di qua Edge TTS (giong lo-LA-KeomanyNeural). Cac ngon ngu khac
   van dung Google nhu cu. */
const tls = require("tls");
const net = require("net");
// ============================================================================
// Edge TTS cho tieng Lao (lo-LA) — Node thuan 0 dependency (tls/net/crypto).
// Dung lam nguon phat am du phong khi Google Translate TTS khong co giong Lao
// (tl=lo bi Google tra HTTP 400).
//
// Cach dung trong server.js:
//   const { edgeTtsMp3 } = require('./edge-tts-lao'); // hoac dan thang vao server.js
//   const mp3 = await edgeTtsMp3('ສະບາຍດີ', 'lo-LA-KeomanyNeural'); // Buffer MP3 24kHz 48kbps mono
// Giong: 'lo-LA-KeomanyNeural' (nu) | 'lo-LA-ChanthavongNeural' (nam)
//
// Ghi chu ky thuat:
// - Token Sec-MS-GEC v2: Microsoft da bo SHA-256 chuan, chuyen sang ham bam tuy
//   bien (port trung thuc tu edge_tts/drm.py cua rany2/edge-tts; da doi chieu
//   trung khop test vector). Kem query Sec-MS-GEC-Version = '2-143.0.3650.75'.
// - Neu handshake bi 403 kem header Date, ham tu lech dong ho theo gio may chu
//   Microsoft va thu lai 1 lan (giong co che cua edge-tts).
// - Neu env co https_proxy (moi truong test noi bo) thi tu khoi tao CONNECT;
//   tren Render khong co bien nay nen ket noi thang.
// ============================================================================

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const GEC_VERSION = '2-143.0.3650.75';

const SHA256_INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
const SHA256_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];
const SHA256_SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564];
const SHA256_ROUND_CONSTANTS = [0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2];
const SHA256_BLOCK_CONSTANTS = SHA256_ROUND_CONSTANTS.slice();
SHA256_BLOCK_CONSTANTS[14] = 0xC9DC06A7;
const SHA256_ADJUSTMENT = 0xC9DC06A7;
const SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0;
const CS64_COEFFICIENTS = [[0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038], [0xC89C5933, 0xB328CBDF], [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C], [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB], [0x06064CF3, 0xFA51A3DA], [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61], [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167]];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xF2F90B1A;
const CS64_ADJUSTMENT1 = 0x0B1A0000;

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = x => ((x << 16) | (x >>> 16)) >>> 0;
const sigma0 = x => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
const sigma1 = x => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;
const bigSigma0 = x => (rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)) >>> 0;
const bigSigma1 = x => (rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)) >>> 0;

function sha256Rounds(state, words, firstRound) {
  const K = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = firstRound; i < 64; i++) {
    const t1 = (h + bigSigma1(e) + ((e & f) ^ (~e & g)) + K[i] + words[i]) >>> 0;
    const t2 = (bigSigma0(a) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0;
    d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}
function expandSchedule(words, firstWord) {
  for (let i = firstWord; i < 64; i++) {
    words[i] = (sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0;
  }
}
function sha256Init(data7) {
  const words = new Array(64).fill(0);
  words[14] = data7.readUIntBE(0, 3);
  words[15] = data7.readUInt32BE(3);
  for (let index = 16; index < 30; index++) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) value += index === 16 ? (sigma1(words[index - 2]) ^ SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[index - 2]);
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) value += index === 29 ? (sigma0(words[index - 15]) ^ SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[index - 15]);
    words[index] = value >>> 0;
  }
  words[30] = (sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) >>> 0;
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((v, i) => (v + working[i]) >>> 0);
}
function sha256Digest(data) {
  const length = 57 + data.length;
  const padZeros = (((55 - length) % 64) + 64) % 64;
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(BigInt(length) * 8n);
  const padded = Buffer.concat([data.slice(7), Buffer.from([0x80]), Buffer.alloc(padZeros), lenBuf]);
  let state = sha256Init(data.slice(0, 7));
  for (let off = 0; off < padded.length; off += 64) {
    const words = new Array(64).fill(0);
    for (let i = 0; i < 16; i++) words[i] = padded.readUInt32BE(off + i * 4);
    expandSchedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((v, i) => (v + working[i]) >>> 0);
  }
  const out = Buffer.alloc(32);
  state.forEach((v, i) => out.writeUInt32BE(v, i * 4));
  return out;
}
function wordsLe4Even(buf) {
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  const words = [];
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i));
  if (words.length % 2) words.push(0);
  return words;
}
function cs64Digest(data, digest) {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const fA = Math.imul(keyA, CS64_FACTOR) >>> 0;
  const fB = Math.imul(keyB, CS64_FACTOR) >>> 0;
  const terms = CS64_COEFFICIENTS.map(([coef], i) => Math.imul(coef, i % 2 === 0 ? fA : fB) >>> 0);
  const offsets = CS64_COEFFICIENTS.map(([, off]) => off);
  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, index) => {
    const even = index % 2 === 0;
    let term = Math.imul(word, even ? keyA : keyB);
    let offset = Math.imul(rol16(word), even ? 0xEF0569FB : 0xC31713DB);
    if (index === 0) { term += Math.imul(CS64_ADJUSTMENT0, fA); offset += CS64_ADJUSTMENT1; }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index], y = terms[index + 1];
    let t = rol16((offsets[index] + x) >>> 0);
    let q = Math.imul(t, 0x76F50F34) >>> 0;
    swapAcc += (Math.imul(rol16(q), 0xC3EFEA97) + q) >>> 0;
    t = rol16((offsets[index + 1] + y) >>> 0);
    q = Math.imul(t, 0x1881CE3C) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35BD1EC9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (Math.imul(state, keyA) + x) >>> 0;
    state = Math.imul(rol16(state), 0xCF98B111) >>> 0;
    state = Math.imul(rol16(state), 0x87085B9F) >>> 0;
    state = Math.imul(rol16(state), 0x12CEB96D) >>> 0;
    state = Math.imul(rol16(state), 0x257E1D83) >>> 0;
    acc = (acc + state) >>> 0;
    t = (Math.imul(state, keyB) + y) >>> 0;
    t = Math.imul(rol16(t), 0xA27416F5) >>> 0;
    t = Math.imul(rol16(t), 0xD38396FF) >>> 0;
    state = Math.imul(rol16(Math.imul(rol16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0;
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}
function generateSecMsGecV2(unixSeconds) {
  let ticks = BigInt(Math.floor(unixSeconds)) + 11644473600n;
  ticks -= ticks % 300n;
  ticks *= 10000000n;
  const data = Buffer.from(ticks.toString() + TRUSTED_CLIENT_TOKEN, 'ascii');
  const digest = sha256Digest(data);
  const [a, b] = cs64Digest(data, digest);
  const cs = Buffer.alloc(8);
  cs.writeUInt32LE(a, 0);
  cs.writeUInt32LE(b, 4);
  return cs.toString('hex').toUpperCase() + '-' + digest.toString('hex').toUpperCase();
}

// ---- WebSocket client toi thieu (RFC 6455) ----
function proxyFromEnv() {
  const raw = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY;
  if (!raw) return null;
  try {
    const p = new URL(raw);
    return { host: p.hostname, port: p.port ? Number(p.port) : 3128, auth: p.username ? Buffer.from(decodeURIComponent(p.username) + ':' + decodeURIComponent(p.password || '')).toString('base64') : null };
  } catch { return null; }
}
function openTlsSocket(hostname, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proxy = proxyFromEnv();
    const timer = setTimeout(() => reject(new Error('timeout mo TLS')), timeoutMs);
    function wrap(rawSocket) {
      const s = tls.connect({ socket: rawSocket, servername: hostname });
      s.once('secureConnect', () => { clearTimeout(timer); resolve(s); });
      s.once('error', e => { clearTimeout(timer); reject(e); });
    }
    if (!proxy) { wrap(net.connect(port, hostname)); return; }
    const raw = net.connect(proxy.port, proxy.host);
    let buf = Buffer.alloc(0);
    raw.once('connect', () => {
      const lines = [`CONNECT ${hostname}:${port} HTTP/1.1`, `Host: ${hostname}:${port}`];
      if (proxy.auth) lines.push('Proxy-Authorization: Basic ' + proxy.auth);
      lines.push('', '');
      raw.write(lines.join('\r\n'));
    });
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const head = buf.slice(0, idx).toString('latin1');
      raw.removeListener('data', onData);
      if (!/ 200 /.test(head.split('\r\n')[0] + ' ')) { clearTimeout(timer); reject(new Error('CONNECT proxy that bai: ' + head.split('\r\n')[0])); return; }
      const rest = buf.slice(idx + 4);
      if (rest.length) raw.unshift(rest);
      wrap(raw);
    };
    raw.on('data', onData);
    raw.once('error', e => { clearTimeout(timer); reject(e); });
  });
}
async function wsConnect(urlStr, headers, timeoutMs) {
  const u = new URL(urlStr);
  const port = u.port ? Number(u.port) : 443;
  const socket = await openTlsSocket(u.hostname, port, timeoutMs);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; try { socket.destroy(); } catch {} reject(new Error('timeout handshake WS')); } }, timeoutMs);
    let buffer = Buffer.alloc(0);
    let handshaked = false;
    const listeners = { message: [], close: [], error: [] };
    let fragOpcode = null;
    let fragChunks = [];
    function sendFrame(opcode, payload) {
      const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
      const mask = crypto.randomBytes(4);
      let header;
      if (data.length < 126) { header = Buffer.alloc(2); header[1] = 0x80 | data.length; }
      else if (data.length < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
      else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
      header[0] = 0x80 | opcode;
      const masked = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
      socket.write(Buffer.concat([header, mask, masked]));
    }
    function processFrames() {
      for (;;) {
        if (buffer.length < 2) return;
        const b0 = buffer[0], b1 = buffer[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let off = 2;
        if (len === 126) { if (buffer.length < off + 2) return; len = buffer.readUInt16BE(off); off += 2; }
        else if (len === 127) { if (buffer.length < off + 8) return; len = Number(buffer.readBigUInt64BE(off)); off += 8; }
        let maskKey = null;
        if (masked) { if (buffer.length < off + 4) return; maskKey = buffer.slice(off, off + 4); off += 4; }
        if (buffer.length < off + len) return;
        let payload = buffer.slice(off, off + len);
        if (maskKey) { const p = Buffer.alloc(len); for (let i = 0; i < len; i++) p[i] = payload[i] ^ maskKey[i % 4]; payload = p; }
        buffer = buffer.slice(off + len);
        if (opcode === 9) { sendFrame(10, payload); continue; }
        if (opcode === 8) { for (const fn of listeners.close) fn(payload); continue; }
        if (opcode === 0) {
          fragChunks.push(payload);
          if (fin) { const full = Buffer.concat(fragChunks); const op = fragOpcode; fragChunks = []; fragOpcode = null; for (const fn of listeners.message) fn(op, full); }
          continue;
        }
        if (!fin) { fragOpcode = opcode; fragChunks = [payload]; continue; }
        for (const fn of listeners.message) fn(opcode, payload);
      }
    }
    const lines = [
      `GET ${u.pathname + u.search} HTTP/1.1`,
      `Host: ${u.hostname}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
      'Sec-WebSocket-Version: 13',
    ];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    lines.push('', '');
    socket.write(lines.join('\r\n'));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshaked) {
        const idx = buffer.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buffer.slice(0, idx).toString('latin1');
        buffer = buffer.slice(idx + 4);
        if (!head.split('\r\n')[0].includes('101')) {
          if (!settled) { settled = true; clearTimeout(timer); const err = new Error('Handshake that bai: ' + head.split('\r\n')[0]); err.headers = head; reject(err); }
          return;
        }
        handshaked = true;
        if (!settled) {
          settled = true; clearTimeout(timer);
          resolve({
            sendText: s => sendFrame(1, s),
            close: () => { try { sendFrame(8, Buffer.alloc(0)); } catch {} try { socket.end(); } catch {} },
            onMessage: fn => listeners.message.push(fn),
            onClose: fn => listeners.close.push(fn),
            onError: fn => listeners.error.push(fn),
          });
        }
      }
      processFrames();
    });
    socket.on('error', err => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      for (const fn of listeners.error) fn(err);
    });
    socket.on('close', () => { for (const fn of listeners.close) fn(Buffer.alloc(0)); });
  });
}

// ---- Tong hop Edge TTS ----
function edgeDateStr(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = n => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}
const escXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function edgeTtsOnce(text, voice, skewSec) {
  const nowSec = Date.now() / 1000 + (skewSec || 0);
  const url = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
    + '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN
    + '&Sec-MS-GEC=' + generateSecMsGecV2(nowSec)
    + '&Sec-MS-GEC-Version=' + GEC_VERSION
    + '&ConnectionId=' + crypto.randomBytes(16).toString('hex');
  const ws = await wsConnect(url, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Cookie': 'muid=' + crypto.randomBytes(16).toString('hex').toUpperCase() + ';',
  }, 20000);
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout 30s cho turn.end')), 30000);
    ws.onMessage((opcode, payload) => {
      if (opcode === 1) {
        if (payload.toString('utf8').includes('Path:turn.end')) { clearTimeout(timer); resolve(); }
      } else if (opcode === 2) {
        const hlen = payload.readUInt16BE(0);
        const header = payload.slice(2, 2 + hlen).toString('utf8');
        if (header.includes('Path:audio')) chunks.push(payload.slice(2 + hlen));
      }
    });
    ws.onError(e => { clearTimeout(timer); reject(e); });
  });
  const cfg = JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } });
  ws.sendText('X-Timestamp:' + edgeDateStr(new Date()) + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' + cfg);
  const locale = voice.slice(0, 5);
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + locale + "'><voice name='" + voice + "'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + escXml(text) + '</prosody></voice></speak>';
  ws.sendText('X-RequestId:' + crypto.randomBytes(16).toString('hex') + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + edgeDateStr(new Date()) + '\r\nPath:ssml\r\n\r\n' + ssml);
  try { await done; } finally { ws.close(); }
  const mp3 = Buffer.concat(chunks);
  if (!mp3.length) throw new Error('Edge TTS tra ve 0 byte audio');
  return mp3;
}

// Ham chinh: tra ve Buffer MP3 cho text Lao. voice mac dinh la giong nu Keomany.
async function edgeTtsMp3(text, voice = 'lo-LA-KeomanyNeural') {
  try {
    return await edgeTtsOnce(text, voice, 0);
  } catch (e) {
    // Thu lai 1 lan voi dong ho lech theo header Date cua Microsoft (neu co)
    const m = /Date:\s*([^\r\n]+)/i.exec((e && e.headers) || '');
    if (m) {
      const serverSec = Date.parse(m[1]) / 1000;
      if (Number.isFinite(serverSec)) return await edgeTtsOnce(text, voice, serverSec - Date.now() / 1000);
    }
    throw e;
  }
}

async function handleApi(req, res, parts, query) {
  // parts: sau /api
  if (parts[0] === "app-version" && req.method === "GET") {
    try { const st = fs.statSync(path.join(PUBLIC_DIR, "index.html")); return sendJson(res, 200, { v: String(Math.round(st.mtimeMs)) + "-" + st.size }); }
    catch { return sendJson(res, 200, { v: "0" }); }
  }
  if (parts[0] === "tts" && req.method === "GET") {
    const tl = (query.get("tl") || "en").trim();
    const q = (query.get("q") || "").trim().slice(0, 200);
    if (!q || !/^[a-zA-Z-]{2,12}$/.test(tl)) return sendJson(res, 400, { error: "Thieu tham so TTS" });
    try {
      if (!global.__ttsCache) global.__ttsCache = new Map();
      const cache = global.__ttsCache;
      const key = tl + "|" + q;
      if (cache.has(key)) { res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" }); return res.end(cache.get(key)); }
      if (tl === "lo") {
        try {
          const ebuf = await edgeTtsMp3(q, "lo-LA-KeomanyNeural");
          if (ebuf && ebuf.length) { if (cache.size > 300) cache.clear(); cache.set(key, ebuf); res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" }); return res.end(ebuf); }
        } catch {}
      }
      const u = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" + encodeURIComponent(tl) + "&q=" + encodeURIComponent(q);
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" } });
      if (!r.ok) return sendJson(res, 502, { error: "TTS loi " + r.status });
      const buf = Buffer.from(await r.arrayBuffer());
      if (cache.size > 300) cache.clear();
      cache.set(key, buf);
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" });
      return res.end(buf);
    } catch { return sendJson(res, 502, { error: "TTS khong phan hoi" }); }
  }
  if (parts[0] === "guide-cache" && req.method === "GET") {
    return sendJson(res, 200, loadGuideCache());
  }
  if (parts[0] === "guide" && req.method === "GET") {
    const city = (query.get("city") || "").trim();
    if (!city) return sendJson(res, 400, { error: "Thiếu tên thành phố" });
    const g = await resolveGuide(city, (query.get("country") || "").trim());
    if (!g) return sendJson(res, 404, { error: "Chưa tìm được cẩm nang cho thành phố này" });
    return sendJson(res, 200, g);
  }
  if (parts[0] === "me" && req.method === "GET") {
    return sendJson(res, 200, { user: currentUser(req), authConfigured: AUTH_CONFIGURED });
  }

  // /api/journal — chi danh cho tai khoan dang dang nhap, key theo Google sub
  if (parts[0] === "journal") {
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { error: "Bạn cần đăng nhập để dùng Nhật ký" });
    if (!Array.isArray(JOURNAL[user.sub])) JOURNAL[user.sub] = [];
    const mine = JOURNAL[user.sub];
    if (req.method === "GET" && parts.length === 1) return sendJson(res, 200, mine);
    if (req.method === "POST" && parts.length === 1) {
      const b = await readBody(req);
      const trip = findTrip(b.tripId);
      if (!trip || trip.owner !== "u:" + user.sub) return sendJson(res, 404, { error: "Không tìm thấy chuyến đi" });
      const ix = mine.findIndex(e => e.tripId === trip.id);
      const snap = buildSnapshot(trip, ix >= 0 ? { id: mine[ix].id } : null);
      if (ix >= 0) mine[ix] = snap; else mine.unshift(snap);
      saveJournal(JOURNAL);
      return sendJson(res, 200, snap);
    }
    if (req.method === "DELETE" && parts.length === 2) {
      const ix = mine.findIndex(e => e.id === parts[1]);
      if (ix < 0) return sendJson(res, 404, { error: "Không tìm thấy mục nhật ký" });
      mine.splice(ix, 1); saveJournal(JOURNAL);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "not found" });
  }

  if (parts[0] !== "trips") return sendJson(res, 404, { error: "not found" });

  const ownerKey = callerKey(req, res);
  if (ownerKey.startsWith("u:")) {
    const guestId = parseCookies(req).tp_guest;
    let claimed = false;
    for (const t of DB.trips) {
      if (!t.owner || (guestId && t.owner === "g:" + guestId)) { t.owner = ownerKey; claimed = true; }
    }
    if (claimed) saveData(DB);
  }

  if (parts.length === 1) {
    if (req.method === "GET") {
      return sendJson(res, 200, DB.trips.filter(t => t.owner === ownerKey).map(t => ({
        id: t.id, city: t.city, country: t.country, guideKey: t.guideKey,
        startDate: t.startDate, endDate: t.endDate, createdAt: t.createdAt,
        placeCount: Object.values(t.days || {}).reduce((a, d) => a + d.length, 0)
      })));
    }
    if (req.method === "POST") {
      const b = await readBody(req);
      if (!b.city || !b.startDate || !b.endDate) return sendJson(res, 400, { error: "Thiếu thành phố hoặc ngày đi/ngày về" });
      if (b.endDate < b.startDate) return sendJson(res, 400, { error: "Ngày về phải sau ngày đi" });
      const trip = {
        id: uid(), city: String(b.city).slice(0, 80), country: String(b.country || "").slice(0, 60),
        guideKey: b.guideKey || null, startDate: b.startDate, endDate: b.endDate,
        createdAt: new Date().toISOString(), days: {}, stay: null, prep: defaultPrep(), owner: ownerKey
      };
      DB.trips.unshift(trip); saveData(DB);
      return sendJson(res, 201, trip);
    }
  }

  const trip = findTrip(parts[1]);
  if (!trip || trip.owner !== ownerKey) return sendJson(res, 404, { error: "Không tìm thấy chuyến đi" });

  if (parts.length === 2) {
    if (req.method === "GET") return sendJson(res, 200, trip);
    if (req.method === "PUT") {
      const b = await readBody(req);
      if (b.startDate && b.endDate) {
        if (b.endDate < b.startDate) return sendJson(res, 400, { error: "Ngày về phải sau ngày đi" });
        trip.startDate = b.startDate; trip.endDate = b.endDate;
      }
      saveData(DB); syncJournalForTrip(trip); return sendJson(res, 200, trip);
    }
    if (req.method === "DELETE") {
      DB.trips = DB.trips.filter(t => t.id !== trip.id); saveData(DB);
      return sendJson(res, 200, { ok: true });
    }
  }

  // /api/trips/:id/days/:day/places[/:placeId]
  if (parts[2] === "days" && parts[4] === "places") {
    const day = String(parseInt(parts[3], 10));
    if (!trip.days[day]) trip.days[day] = [];
    if (req.method === "POST" && parts.length === 5) {
      const b = await readBody(req);
      if (!b.name) return sendJson(res, 400, { error: "Thiếu tên địa điểm" });
      const place = {
        id: (typeof b.id === "string" && b.id) ? b.id.slice(0, 80) : uid(), name: String(b.name).slice(0, 120), desc: String(b.desc || "").slice(0, 600),
        go: String(b.go || "").slice(0, 600), dur: String(b.dur || "").slice(0, 60),
        image: b.image || null, steps: Array.isArray(b.steps) ? b.steps.slice(0, 8).map(s => String(s).slice(0, 300)) : [],
        nearby: b.nearby && typeof b.nearby === "object" ? b.nearby : { food: [], play: [], shop: [] },
        transit: String(b.transit || "").slice(0, 900), tips: String(b.tips || "").slice(0, 900),
        custom: !!b.custom
      };
      trip.days[day].push(place); saveData(DB); syncJournalForTrip(trip);
      return sendJson(res, 201, place);
    }
    if (req.method === "DELETE" && parts.length === 6) {
      trip.days[day] = trip.days[day].filter(p => p.id !== parts[5]);
      saveData(DB); syncJournalForTrip(trip); return sendJson(res, 200, { ok: true });
    }
    if (req.method === "PUT" && parts.length === 6) {
      const b = await readBody(req);
      const place = trip.days[day].find(p => p.id === parts[5]);
      if (!place) return sendJson(res, 404, { error: "Không tìm thấy địa điểm" });
      if (typeof b.visited === "boolean") place.visited = b.visited;
      saveData(DB); syncJournalForTrip(trip);
      return sendJson(res, 200, place);
    }
  }

  // /api/trips/:id/stay
  if (parts[2] === "stay" && parts.length === 3) {
    if (req.method === "PUT") {
      const b = await readBody(req);
      trip.stay = b && b.name ? {
        name: String(b.name).slice(0, 120), address: String(b.address || "").slice(0, 200),
        checkin: String(b.checkin || ""), checkout: String(b.checkout || ""), note: String(b.note || "").slice(0, 300)
      } : null;
      saveData(DB); syncJournalForTrip(trip); return sendJson(res, 200, trip);
    }
    if (req.method === "DELETE") { trip.stay = null; saveData(DB); syncJournalForTrip(trip); return sendJson(res, 200, trip); }
  }

  // /api/trips/:id/prep/...
  if (parts[2] === "prep") {
    if (parts[3] === "groups" && parts.length === 4 && req.method === "POST") {
      const b = await readBody(req);
      if (!b.name) return sendJson(res, 400, { error: "Thiếu tên nhóm" });
      const g = { id: uid(), name: String(b.name).slice(0, 60), highlight: false, items: [] };
      trip.prep.push(g); saveData(DB); return sendJson(res, 201, g);
    }
    const gi = trip.prep.findIndex(g => g.id === parts[4]);
    if (parts[3] === "groups" && gi >= 0) {
      const group = trip.prep[gi];
      if (parts.length === 5 && req.method === "DELETE") {
        trip.prep.splice(gi, 1); saveData(DB); return sendJson(res, 200, { ok: true });
      }
      if (parts[5] === "items" && parts.length === 6 && req.method === "POST") {
        const b = await readBody(req);
        if (!b.text) return sendJson(res, 400, { error: "Thiếu nội dung" });
        const item = { id: uid(), text: String(b.text).slice(0, 200), done: false };
        group.items.push(item); saveData(DB); return sendJson(res, 201, item);
      }
      if (parts[5] === "items" && parts.length === 7) {
        const item = group.items.find(i => i.id === parts[6]);
        if (!item) return sendJson(res, 404, { error: "Không tìm thấy mục" });
        if (req.method === "PUT") {
          const b = await readBody(req);
          if (typeof b.done === "boolean") item.done = b.done;
          if (b.text) item.text = String(b.text).slice(0, 200);
          saveData(DB); return sendJson(res, 200, item);
        }
        if (req.method === "DELETE") {
          group.items = group.items.filter(i => i.id !== item.id);
          saveData(DB); return sendJson(res, 200, { ok: true });
        }
      }
    }
  }

  return sendJson(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(u.pathname);

  if (pathname.startsWith("/auth/")) {
    try { await handleAuth(req, res, pathname); }
    catch { if (!res.headersSent) { res.writeHead(302, { Location: "/?authmsg=error" }); } res.end(); }
    return;
  }

  if (pathname.startsWith("/api/")) {
    const parts = pathname.split("/").filter(Boolean).slice(1);
    try { await handleApi(req, res, parts, u.searchParams); }
    catch (e) { sendJson(res, 500, { error: String(e && e.message || e) }); }
    return;
  }

  // File tinh
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(filePath, (serr, st) => {
    if (serr || !st.isFile()) {
      // SPA fallback cho cac duong dan khong phai file
      if (path.extname(rel)) { res.writeHead(404); return res.end("Not found"); }
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, b2) => {
        if (e2) { res.writeHead(500); return res.end("Error"); }
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0" }); res.end(b2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".html") {
      const ims = req.headers["if-modified-since"];
      if (ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000)) { res.writeHead(304, { "Cache-Control": "no-cache" }); return res.end(); }
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(500); return res.end("Error"); }
      const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
      if (ext === ".html") { headers["Cache-Control"] = "no-store, no-cache, must-revalidate"; headers["Pragma"] = "no-cache"; headers["Expires"] = "0"; }
      else { headers["Cache-Control"] = "no-cache"; headers["Last-Modified"] = st.mtime.toUTCString(); }
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
});

server.listen(PORT, () => console.log(`Travel Plan dang chay tai http://localhost:${PORT}`));
