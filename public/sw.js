// Service worker cua Travel Plan: chi ho tro cai dat nhu app.
// Khong cache trang/API de ban moi luon duoc nap truc tiep (cap nhat bang vuot xuong).
const CACHE = "tp-icons-v1";
const ICONS = ["/icons/icon-192.png", "/icons/icon-512.png", "/apple-touch-icon.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ICONS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (ICONS.includes(u.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
  // Moi request con lai: de trinh duyet tu xu ly (luon lay ban moi tu may chu)
});
