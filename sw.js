// Caches the app shell so the site opens instantly and works even with a
// weak signal. Pyodide (the Python engine) and Firebase load from their
// CDNs and are cached the first time each is used, so a student only
// downloads them once even on a slow mobile connection.
const CACHE_NAME = "pyclass-shell-v3";
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

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  const url = new URL(req.url);
  const isCdn = url.hostname.includes("jsdelivr.net") || url.hostname.includes("googleapis.com");
  const isShell = url.origin === self.location.origin;

  if (!isCdn && !isShell) return; // let everything else (Firestore/Auth calls) pass through untouched

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        // Cache-first for CDN libraries (they're versioned in the URL, so
        // this is always safe); refresh app-shell files in the background.
        if (isShell) {
          fetch(req).then(function (fresh) {
            if (fresh && fresh.ok) caches.open(CACHE_NAME).then(function (c) { c.put(req, fresh); });
          }).catch(function () {});
        }
        return cached;
      }
      return fetch(req).then(function (fresh) {
        if (fresh && fresh.ok && (isCdn || isShell)) {
          const clone = fresh.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, clone); });
        }
        return fresh;
      }).catch(function () {
        return cached;
      });
    })
  );
});
