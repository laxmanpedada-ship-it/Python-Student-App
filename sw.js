// PyClass service worker: lets the app open and run with no connection.
//
// A service worker is a small script that sits between the page and the
// network. Every request the page makes passes through the "fetch" handler
// at the bottom, which decides: answer from a cache, or go to the network.
//
// We keep TWO caches because their contents have different lifetimes:
//
//   SHELL_CACHE  our own files (HTML, JS, CSS). Versioned: change the
//                number below whenever you edit ANY app file, so every
//                device throws away its old copies and fetches the new ones.
//
//   LIB_CACHE    big third-party files from the jsDelivr CDN (Firebase,
//                Pyodide = Python-in-the-browser, Python libraries). Their
//                URLs contain their own version numbers, so a cached copy
//                can never go stale, and they total tens of MB, so we must
//                NOT delete them every time the app shell is updated.
//
// IMPORTANT: js/common.js reads LIB_CACHE by name to show the "ready for
// offline" status. If you rename it here, rename it there too.
const SHELL_CACHE = "pyclass-shell-v12";
const LIB_CACHE = "pyclass-libs-v1";
const CDN_HOST = "cdn.jsdelivr.net";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./student.html",
  "./teacher.html",
  "./manifest.json",
  "./css/style.css",
  "./js/common.js",
  "./js/strings.js",
  "./js/lessons.js",
  "./js/student.js",
  "./js/teacher.js",
  "./js/firebase-config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Small files the app can't start without. We fetch them at install time so
// the very first offline visit already works. (Pyodide is far bigger, so it
// is downloaded separately, by the app, only when a student asks for it.)
// If you change the Firebase version in the HTML files, change it here too.
const CDN_PRECACHE = [
  "https://cdn.jsdelivr.net/npm/firebase@10.12.2/firebase-app-compat.js",
  "https://cdn.jsdelivr.net/npm/firebase@10.12.2/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/firebase@10.12.2/firebase-firestore-compat.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    // Installation is all-or-nothing: if this promise rejects, the new
    // service worker is discarded. So only our OWN files (reliable, same
    // server) are allowed to fail the install.
    const shell = await caches.open(SHELL_CACHE);
    // cache:"reload" skips the browser's ordinary HTTP cache. GitHub Pages
    // tells browsers to keep files for ~10 minutes, and without this we
    // could save a stale copy of a file we just updated.
    await shell.addAll(SHELL_FILES.map(function (u) { return new Request(u, { cache: "reload" }); }));

    // The CDN files are best-effort: a slow CDN must not block the install.
    const libs = await caches.open(LIB_CACHE);
    await Promise.all(CDN_PRECACHE.map(async function (u) {
      try {
        if (!(await libs.match(u))) await libs.add(u);
      } catch (e) { /* the runtime handler below will cache it on first use */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== SHELL_CACHE && k !== LIB_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Strategy for CDN files: CACHE FIRST. If we have it, use it (instant, works
// offline). If not, fetch it and keep a copy.
async function cdnCacheFirst(req) {
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Store only readable (CORS) successes. A file loaded by a plain <script>
  // with no `crossorigin` attribute comes back "opaque": the page can run
  // it, but its status is hidden, res.ok is false, and we'd silently never
  // cache it. That was why Firebase didn't work offline before.
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Strategy for our own files: STALE-WHILE-REVALIDATE. Answer instantly from
// the cache (even with no signal), and meanwhile fetch a fresh copy so the
// NEXT visit gets any update. Side effect to expect: after you publish a
// change, a device needs two visits to show it (the first visit shows the
// old copy, while the new one downloads).
function shellStaleWhileRevalidate(event) {
  const req = event.request;
  return caches.open(SHELL_CACHE).then(function (cache) {
    // ignoreSearch: "student.html?x=1" should still find "student.html".
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      const refresh = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () { return null; }); // offline: keep what we have
      if (hit) {
        event.waitUntil(refresh); // let the background refresh finish
        return hit;
      }
      return refresh.then(function (res) { return res || Response.error(); });
    });
  });
}

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // The Cache API can only store GET requests. Firebase's own traffic
  // (sign-in, saving homework) uses POST and must NEVER be touched here.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isCdn = url.hostname === CDN_HOST;
  const isShell = url.origin === self.location.origin;

  // Everything else, including Firestore's live connection to
  // *.googleapis.com, passes straight through. (Before, we also matched
  // googleapis.com, which risked caching Firestore's streaming requests.)
  if (!isCdn && !isShell) return;

  event.respondWith(isCdn ? cdnCacheFirst(req) : shellStaleWhileRevalidate(event));
});
