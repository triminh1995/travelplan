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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
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

async function handleApi(req, res, parts) {
  // parts: sau /api
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
      saveData(DB); return sendJson(res, 200, trip);
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
      trip.days[day].push(place); saveData(DB);
      return sendJson(res, 201, place);
    }
    if (req.method === "DELETE" && parts.length === 6) {
      trip.days[day] = trip.days[day].filter(p => p.id !== parts[5]);
      saveData(DB); return sendJson(res, 200, { ok: true });
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
      saveData(DB); return sendJson(res, 200, trip);
    }
    if (req.method === "DELETE") { trip.stay = null; saveData(DB); return sendJson(res, 200, trip); }
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

  if (pathname.startsWith("/api/")) {
    const parts = pathname.split("/").filter(Boolean).slice(1);
    try { await handleApi(req, res, parts); }
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
