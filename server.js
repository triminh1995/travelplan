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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
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
async function wikiGeoPlaces(lang, lat, lon) {
  try {
    const j = await wikiApi(lang, { action: "query", generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: "10000", ggslimit: "50", ...PAGE_PROPS, exintro: "0", exsentences: "3" });
    return j.query && j.query.pages ? Object.values(j.query.pages) : [];
  } catch { return []; }
}
async function wikiCategoryPlaces(enTitle) {
  try {
    const j = await wikiApi("en", { action: "query", generator: "categorymembers", gcmtitle: `Category:Tourist attractions in ${enTitle}`, gcmtype: "page", gcmlimit: "50", ...PAGE_PROPS, exintro: "0", exsentences: "3" });
    return j.query && j.query.pages ? Object.values(j.query.pages) : [];
  } catch { return []; }
}

const guideInflight = new Map();
async function buildWikiGuide(cityName, country) {
  // Uu tien Wikipedia tieng Viet (gioi thieu tieng Viet), du phong tieng Anh
  let cityPage = await wikiResolveCity("vi", cityName);
  let cityLang = "vi";
  if (!cityPage) { cityPage = await wikiResolveCity("en", cityName); cityLang = "en"; }
  if (!cityPage) return null;
  const enPage = cityLang === "en" ? cityPage : await wikiResolveCity("en", cityName);
  const coords = (cityPage.coordinates && cityPage.coordinates[0]) || (enPage && enPage.coordinates && enPage.coordinates[0]) || null;

  const cityTitleN = norm(cityPage.title);
  const seen = new Set();
  const rawPlaces = [];
  const pushAll = (arr) => { for (const p of arr || []) { const tn = norm(p && p.title); if (tn && !seen.has(tn) && isPlacePage(p, cityTitleN)) { seen.add(tn); rawPlaces.push(p); } } };
  const [catPlaces, geoPlaces] = await Promise.all([
    enPage && enPage.title ? wikiCategoryPlaces(enPage.title) : Promise.resolve([]),
    coords ? wikiGeoPlaces(cityLang, coords.lat, coords.lon) : Promise.resolve([])
  ]);
  pushAll(catPlaces);
  pushAll(geoPlaces);
  if (coords && rawPlaces.length < 5 && cityLang !== "en") pushAll(await wikiGeoPlaces("en", coords.lat, coords.lon));
  rawPlaces.sort((a, b) => (pageImg(b) ? 1 : 0) - (pageImg(a) ? 1 : 0));
  const picked = rawPlaces.slice(0, 8);
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

async function handleApi(req, res, parts, query) {
  // parts: sau /api
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
      if (!trip) return sendJson(res, 404, { error: "Không tìm thấy chuyến đi" });
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

  if (parts.length === 1) {
    if (req.method === "GET") {
      return sendJson(res, 200, DB.trips.map(t => ({
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
        createdAt: new Date().toISOString(), days: {}, stay: null, prep: defaultPrep()
      };
      DB.trips.unshift(trip); saveData(DB);
      return sendJson(res, 201, trip);
    }
  }

  const trip = findTrip(parts[1]);
  if (!trip) return sendJson(res, 404, { error: "Không tìm thấy chuyến đi" });

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
        id: uid(), name: String(b.name).slice(0, 120), desc: String(b.desc || "").slice(0, 600),
        go: String(b.go || "").slice(0, 600), dur: String(b.dur || "").slice(0, 60),
        image: b.image || null, steps: Array.isArray(b.steps) ? b.steps.slice(0, 8).map(s => String(s).slice(0, 300)) : [],
        nearby: b.nearby && typeof b.nearby === "object" ? b.nearby : { food: [], play: [], shop: [] },
        custom: !!b.custom
      };
      trip.days[day].push(place); saveData(DB); syncJournalForTrip(trip);
      return sendJson(res, 201, place);
    }
    if (req.method === "DELETE" && parts.length === 6) {
      trip.days[day] = trip.days[day].filter(p => p.id !== parts[5]);
      saveData(DB); syncJournalForTrip(trip); return sendJson(res, 200, { ok: true });
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
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback cho cac duong dan khong phai file
      if (path.extname(rel)) { res.writeHead(404); return res.end("Not found"); }
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, b2) => {
        if (e2) { res.writeHead(500); return res.end("Error"); }
        res.writeHead(200, { "Content-Type": MIME[".html"] }); res.end(b2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`Travel Plan dang chay tai http://localhost:${PORT}`));
