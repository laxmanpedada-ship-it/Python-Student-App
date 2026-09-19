// Shared helpers: Firebase init + Pyodide (Python-in-the-browser) loader.
// Loaded on every page before the page's own script.

window.PyClass = (function () {
  let fbApp, fbAuth, fbDb;
  let pyodideInstance = null;
  let pyodideLoading = null;

  function initFirebase() {
    if (fbApp) return { app: fbApp, auth: fbAuth, db: fbDb };
    fbApp = firebase.initializeApp(window.FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    return { app: fbApp, auth: fbAuth, db: fbDb };
  }

  // Loads Pyodide once per page load. Subsequent calls reuse the same
  // instance. The service worker caches the downloaded files so repeat
  // visits (and repeat students on the same phone) don't re-download
  // several MB over mobile data.
  function loadPyodideOnce(onProgress) {
    if (pyodideInstance) return Promise.resolve(pyodideInstance);
    if (pyodideLoading) return pyodideLoading;
    pyodideLoading = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
      script.onload = async function () {
        try {
          if (onProgress) onProgress();
          pyodideInstance = await window.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/"
          });
          resolve(pyodideInstance);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = function () { reject(new Error("Could not load Python. Check your internet connection.")); };
      document.head.appendChild(script);
    });
    return pyodideLoading;
  }

  // Runs student code, capturing print() output and errors as text,
  // without ever throwing back into the caller.
  async function runPython(code) {
    const pyodide = await loadPyodideOnce();
    let output = "";
    pyodide.setStdout({ batched: function (s) { output += s + "\n"; } });
    pyodide.setStderr({ batched: function (s) { output += s + "\n"; } });
    try {
      await pyodide.runPythonAsync(code);
      return { ok: true, output: output || "(no output — try using print())" };
    } catch (err) {
      return { ok: false, output: output + "\n" + String(err.message || err) };
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

  return {
    initFirebase: initFirebase,
    loadPyodideOnce: loadPyodideOnce,
    runPython: runPython,
    registerServiceWorker: registerServiceWorker,
    qs: qs,
    qsa: qsa,
    fmtDate: fmtDate
  };
})();
