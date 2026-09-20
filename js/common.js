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
  // without ever throwing back into the caller. If the code imports a
  // library that isn't loaded yet (e.g. "import numpy"), this tries to
  // fetch it automatically (from Pyodide's own package set, then from
  // PyPI via micropip) and re-runs the code once, so a student never has
  // to know libraries need installing at all.
  async function runPython(code, onStatus) {
    const pyodide = await loadPyodideOnce();

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
      return {
        ok: false,
        output: result.output + "\n" + result.errorText +
          "\n\n(Tried to automatically add the '" + moduleName + "' library but it isn't available for Python running in a browser. Try a different library, or ask your teacher.)"
      };
    }

    return { ok: false, output: result.output + "\n" + result.errorText };
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
