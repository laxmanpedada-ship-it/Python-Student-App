// Shared helpers: Firebase init + Pyodide (Python-in-the-browser) loader +
// the "get ready for offline" tools.
// Loaded on every page before the page's own script.

window.PyClass = (function () {
  let fbApp, fbAuth, fbDb;
  let pyodideInstance = null;
  let pyodideLoading = null;
  let offlineDataState = "unknown"; // "on" | "off" | "unknown" (still starting)

  // Where Pyodide's files live on the CDN. The version is part of the URL,
  // so a cached copy of these files can never go out of date.
  const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";

  // Python libraries students can use WITHOUT internet, once downloaded.
  // These are all pre-built for the browser by the Pyodide project. To add
  // more (e.g. "pandas"), add the name here, then check the size with the
  // "Get ready for offline" button on good wifi before planning a class
  // around it. Libraries NOT on this list only work while online.
  const OFFLINE_LIBRARIES = ["numpy", "matplotlib"];

  // Must match LIB_CACHE in sw.js (the service worker stores the files here).
  const LIB_CACHE_NAME = "pyclass-libs-v1";

  // opts.offlineData = true turns on Firestore's offline storage (students
  // only). Firestore then keeps a copy of everything it has read in the
  // browser's IndexedDB database, serves it when there's no signal, and
  // queues any writes until the connection returns. The teacher pages
  // don't use it: you have a stable connection, and a queued teacher write
  // that quietly waits for a signal would be more confusing than helpful.
  function initFirebase(opts) {
    if (fbApp) return { app: fbApp, auth: fbAuth, db: fbDb };
    fbApp = firebase.initializeApp(window.FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    if (opts && opts.offlineData) {
      // Must run before any other Firestore call. synchronizeTabs lets two
      // open tabs of the app share one offline database.
      fbDb.enablePersistence({ synchronizeTabs: true }).then(function () {
        offlineDataState = "on";
      }).catch(function (err) {
        // "unimplemented": this browser/mode has no IndexedDB (some private
        // windows). "failed-precondition": an older tab owns the database.
        // Either way the app keeps working, just without offline storage:
        // unsent homework would then live only in memory, so the student is
        // told to keep the page open (see submitHomework in student.js).
        offlineDataState = "off";
        console.warn("Offline data storage is not available here:", err && err.code);
      });
    }
    return { app: fbApp, auth: fbAuth, db: fbDb };
  }

  function engineUnavailableError() {
    const err = new Error("Could not load Python.");
    err.code = "ENGINE_UNAVAILABLE";
    return err;
  }

  // Loads Pyodide once per page load. Subsequent calls reuse the same
  // instance. The service worker (sw.js) saves the downloaded files, so
  // after the first successful load Python also works with no internet.
  function loadPyodideOnce(onProgress) {
    if (pyodideInstance) return Promise.resolve(pyodideInstance);
    if (pyodideLoading) return pyodideLoading;
    pyodideLoading = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = PYODIDE_BASE + "pyodide.js";
      // Ask for the file in "CORS mode". Without this the browser fetches
      // it as an "opaque" response that the service worker can't save, so
      // Python could never load offline.
      script.crossOrigin = "anonymous";
      script.onload = async function () {
        try {
          if (onProgress) onProgress();
          pyodideInstance = await window.loadPyodide({ indexURL: PYODIDE_BASE });
          resolve(pyodideInstance);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = function () {
        script.remove(); // so a retry can add a fresh <script>
        reject(engineUnavailableError());
      };
      document.head.appendChild(script);
    });
    // If loading fails (no signal, say), forget the failed promise. Without
    // this, every later attempt would just replay the same old failure, even
    // after the connection came back, until the page was reloaded.
    pyodideLoading.catch(function () { pyodideLoading = null; });
    return pyodideLoading;
  }

  // Runs student code, capturing print() output and errors as text,
  // without ever throwing back into the caller. If the code imports a
  // library that isn't loaded yet (e.g. "import numpy"), this tries to
  // fetch it automatically (from Pyodide's own package set, then from
  // PyPI via micropip) and re-runs the code once. Libraries already saved
  // on the device by "Get ready for offline" load from the saved copy, so
  // this works with no internet too.
  async function runPython(code, onStatus) {
    let pyodide;
    try {
      pyodide = await loadPyodideOnce();
    } catch (e) {
      // Python itself isn't on this device and we can't download it now.
      return { ok: false, engineUnavailable: true, output: window.t("pythonUnavailable") };
    }

    // Charts (matplotlib) are drawn into this box, emptied before each run.
    const plotEl = document.getElementById("plotArea");
    if (plotEl) {
      plotEl.innerHTML = "";
      document.pyodideMplTarget = plotEl;
    }

    async function attempt() {
      let output = "";
      pyodide.setStdout({ batched: function (s) { output += s + "\n"; } });
      pyodide.setStderr({ batched: function (s) { output += s + "\n"; } });
      try {
        await pyodide.runPythonAsync(code);
        return { ok: true, output: output || "(no output — try using print())" };
      } catch (err) {
        return { ok: false, output: output, errorText: String(err.message || err) };
      }
    }

    let result = await attempt();
    if (result.ok) return result;

    const match = result.errorText.match(/ModuleNotFoundError: No module named '([^']+)'/);
    if (match) {
      const moduleName = match[1];
      let installed = false;
      if (onStatus) onStatus("installing:" + moduleName);
      try {
        // Most common libraries (numpy, pandas, matplotlib, etc.) ship as
        // pre-built Pyodide packages — try that first.
        await pyodide.loadPackage(moduleName);
        installed = true;
      } catch (e1) {
        try {
          // Fall back to micropip for pure-Python packages from PyPI.
          if (!pyodide.loadedPackages || !pyodide.loadedPackages.micropip) {
            await pyodide.loadPackage("micropip");
          }
          const micropip = pyodide.pyimport("micropip");
          await micropip.install(moduleName);
          installed = true;
        } catch (e2) {
          installed = false;
        }
      }
      if (installed) {
        if (onStatus) onStatus("retrying");
        const retry = await attempt();
        if (retry.ok) return retry;
        return { ok: false, output: retry.output + "\n" + retry.errorText };
      }
      // The real reason matters: "no signal" and "this library doesn't exist
      // for browsers" need different advice, and blaming the library when
      // the problem is the connection would send students down a dead end.
      if (!navigator.onLine) {
        return { ok: false, output: result.output + "\n" + result.errorText + "\n\n" + window.t("libNeedsInternet") };
      }
      return {
        ok: false,
        output: result.output + "\n" + result.errorText +
          "\n\n(Tried to automatically add the '" + moduleName + "' library but it isn't available for Python running in a browser. Try a different library, or ask your teacher.)"
      };
    }

    return { ok: false, output: result.output + "\n" + result.errorText };
  }

  // ---------------------------------------------------------------------
  // Offline readiness
  // ---------------------------------------------------------------------

  // Reports what is REALLY saved on this device right now by looking inside
  // the service worker's cache, rather than trusting a "done" flag that
  // could be wrong (browsers can delete cached files when storage runs low).
  // Returns { supported, engine: true/false, libs: { numpy: true, ... } }.
  async function offlineStatus() {
    const out = { supported: typeof caches !== "undefined", engine: false, libs: {} };
    OFFLINE_LIBRARIES.forEach(function (name) { out.libs[name] = false; });
    if (!out.supported) return out;
    try {
      const cache = await caches.open(LIB_CACHE_NAME);
      const urls = (await cache.keys()).map(function (r) { return r.url; })
        .filter(function (u) { return u.indexOf(PYODIDE_BASE) === 0; });
      // Pyodide's core is five files (pyodide.js, pyodide.asm.js,
      // pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json). Counting
      // them, rather than naming each, keeps this check honest even if a
      // future Pyodide version renames one.
      out.engine = urls.length >= 4;
      OFFLINE_LIBRARIES.forEach(function (name) {
        // A library file is named like "numpy-1.26.4-cp312-...whl".
        out.libs[name] = urls.some(function (u) { return u.indexOf(PYODIDE_BASE + name + "-") === 0; });
      });
    } catch (e) { /* leave everything false */ }
    return out;
  }

  // Downloads the Python engine and the offline libraries. Run it once, on
  // good wifi. Every file passes through the service worker, which keeps a
  // copy. onProgress({step:"engine"} | {step:"lib", name}) updates the UI.
  async function prepareOffline(onProgress) {
    if (onProgress) onProgress({ step: "engine" });
    const pyodide = await loadPyodideOnce(); // throws if there's no connection
    for (let i = 0; i < OFFLINE_LIBRARIES.length; i++) {
      if (onProgress) onProgress({ step: "lib", name: OFFLINE_LIBRARIES[i] });
      await pyodide.loadPackage(OFFLINE_LIBRARIES[i]);
    }
    return offlineStatus();
  }

  // Phones on mobile data cost real money in a village. Chrome on Android
  // tells us when the connection is "cellular" or the user turned on Data
  // Saver; in that case we never download in the background.
  function isMeteredConnection() {
    const c = navigator.connection;
    return !!(c && (c.saveData || c.type === "cellular"));
  }

  // Quietly warms up the Python engine (not the libraries) shortly after a
  // student opens the app on a normal connection, so Python is already
  // saved by the time they first need it offline.
  async function prefetchEngineQuietly() {
    if (!navigator.onLine || isMeteredConnection()) return;
    const status = await offlineStatus();
    if (status.engine) return;
    const start = function () { loadPyodideOnce().catch(function () {}); };
    if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 8000 });
    else setTimeout(start, 3000);
  }

  // Translates text into another language using MyMemory's free public
  // API (no key needed for a classroom's low volume, unlike Google's
  // official Translate API which requires a billed account). Returns the
  // translated string, or null if translation isn't possible right now
  // (offline, blocked, rate-limited, or text too long) — callers should
  // treat null as "couldn't auto-translate, let the teacher type it".
  async function translateText(text, targetLang, sourceLang) {
    sourceLang = sourceLang || "en";
    const trimmed = String(text || "").trim();
    if (!trimmed) return "";
    // The free anonymous tier caps requests at a few hundred characters;
    // skip anything longer rather than send a request that will just
    // fail — the teacher can translate long text by hand instead.
    if (trimmed.length > 480) return null;
    try {
      // The "de" (developer email) param raises MyMemory's free daily
      // quota from ~500 words to ~5,000 words per IP. It's only ever
      // sent to MyMemory's own translation endpoint, never anywhere else.
      const url = "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(trimmed) + "&langpair=" + sourceLang + "|" + targetLang +
        "&de=" + encodeURIComponent("laxman.pedada@gmail.com");
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const translated = data && data.responseData && data.responseData.translatedText;
      if (!translated) return null;
      // MyMemory sometimes reports a problem (rate limit, bad language
      // pair) as ordinary 200 text instead of an HTTP error — catch the
      // common cases so we don't show that text as if it were Telugu.
      if (/^(MYMEMORY WARNING|INVALID |PLEASE SELECT)/i.test(translated)) return null;
      return translated;
    } catch (e) {
      return null; // offline, blocked, or unreachable — fail quietly
    }
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fmtDate(ts) {
    try {
      const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString();
    } catch (e) { return ""; }
  }

  // Formats a plain "YYYY-MM-DD" due-date string (from a <input type="date">)
  // as a readable local date, e.g. "10/25/2026". Deliberately NOT reusing
  // fmtDate here: new Date("2026-10-25") parses as UTC midnight, and
  // converting that to a negative-offset timezone (like US Eastern) rolls
  // it back to the previous evening — a due date would silently show the
  // wrong day. Appending a local time-of-day avoids that.
  function fmtDueDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString();
    } catch (e) { return dateStr; }
  }

  return {
    initFirebase: initFirebase,
    loadPyodideOnce: loadPyodideOnce,
    runPython: runPython,
    offlineStatus: offlineStatus,
    prepareOffline: prepareOffline,
    prefetchEngineQuietly: prefetchEngineQuietly,
    OFFLINE_LIBRARIES: OFFLINE_LIBRARIES,
    offlineDataState: function () { return offlineDataState; },
    translateText: translateText,
    registerServiceWorker: registerServiceWorker,
    qs: qs,
    qsa: qsa,
    fmtDate: fmtDate,
    fmtDueDate: fmtDueDate
  };
})();
