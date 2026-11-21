(function () {
  const $ = window.PyClass.qs;
  let db, auth, uid;
  let studentName, classCode;
  let myStudentKey; // stable identity based on name + class code — see studentKey()

  // Turns free text into a URL/doc-id-safe slug: lowercase letters,
  // numbers and single hyphens only.
  function slugify(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // A student's real identity in this app is their name + class code, not
  // the anonymous browser session that happens to be signed in — that
  // session resets any time storage is cleared, a different browser or
  // incognito window is used, or the app is reinstalled, which used to
  // make it look like "the same student" had a brand-new, empty account.
  // Two students sharing the exact same name in the exact same class is
  // the one edge case this doesn't handle; that's expected to be rare in
  // a single small class and is easy to fix with a nickname if it ever
  // happens.
  function studentKey(name, code) {
    return slugify(code) + "__" + slugify(name);
  }
  let currentAssignment = null; // {id, ...} or null when just practicing a lesson
  let lastAssignments = []; // most recent fetch from the server, unfiltered
  let submittedAssignmentIds = new Set(); // assignment ids this student already turned in
  let lastSubmissionByAssignment = {}; // assignmentId -> that student's most recent submission's code, so reopening a submitted assignment continues from what they last turned in, not a blank starter

  // Live-listener unsubscribe functions, so homework and grades appear the
  // moment the teacher posts or grades them — no refresh or re-login needed.
  let assignmentsUnsub = null;
  let submissionsUnsub = null;

  let hintsShown = 0; // how many hints of the current assignment are revealed

  // ---------------------------------------------------------------------
  // Connection awareness (offline mode)
  // ---------------------------------------------------------------------
  // Two different signals, because each one alone can be wrong:
  //  - navigator.onLine is the browser's guess: false when the device has no
  //    network at all. But it says "true" when you're on wifi with no
  //    internet behind it, which is common.
  //  - fromCache on a Firestore snapshot is the truth: "this data came from
  //    the device's saved copy because the server didn't answer."
  let browserOnline = navigator.onLine;
  let serverUnreachable = false; // Firestore has been answering from its saved copy for a while
  let unreachableTimer = null;

  function isOffline() { return !browserOnline || serverUnreachable; }

  function updateConnBanner() {
    const box = $("#connBanner");
    if (!box) return;
    box.textContent = window.t("bannerOffline");
    box.style.display = isOffline() ? "" : "none";
  }

  // Called with every Firestore snapshot. Right after the app opens,
  // Firestore shows its saved copy first and the fresh server copy a moment
  // later, so one fromCache snapshot is normal. We only declare the server
  // unreachable if it keeps answering from the saved copy for 6 seconds.
  function noteSnapshotSource(fromCache) {
    if (!fromCache) {
      clearTimeout(unreachableTimer);
      unreachableTimer = null;
      if (serverUnreachable) {
        serverUnreachable = false;
        updateConnBanner();
        renderVisibleAssignments();
      }
      return;
    }
    if (!unreachableTimer && !serverUnreachable) {
      unreachableTimer = setTimeout(function () {
        unreachableTimer = null;
        serverUnreachable = true;
        updateConnBanner();
        renderVisibleAssignments();
      }, 6000);
    }
  }

  // Sign-in state. Firebase signs each device in anonymously; the saved
  // sign-in survives restarts, so this works offline after the first visit.
  let authWaiters = [];
  function waitForAuth(ms) {
    if (uid) return Promise.resolve(true);
    return new Promise(function (resolve) {
      const t = setTimeout(function () { resolve(false); }, ms);
      authWaiters.push(function () { clearTimeout(t); resolve(true); });
    });
  }

  // Hints for whichever homework is currently open, in the active
  // language. Returns [] for lessons (they have no hints) or if the
  // teacher didn't add any.
  function currentHints() {
    if (!currentAssignment) return [];
    const arr = pick(currentAssignment.hints_en, currentAssignment.hints_te);
    return Array.isArray(arr) ? arr : [];
  }

  // Reveals one more hint each click, so kids are nudged rather than
  // handed the whole answer at once.
  function renderHints() {
    const hints = currentHints();
    const box = $("#hintsBox");
    const btn = $("#hintBtn");
    const list = $("#hintList");
    if (!hints.length) {
      box.style.display = "none";
      return;
    }
    box.style.display = "";
    if (hintsShown > 0) {
      list.style.display = "";
      list.innerHTML = hints.slice(0, hintsShown).map(function (h, i) {
        return "<div style='margin-bottom:4px;'><strong>" + window.t("hint") + " " + (i + 1) + ":</strong> " + escapeHtml(h) + "</div>";
      }).join("");
    } else {
      list.style.display = "none";
      list.innerHTML = "";
    }
    if (hintsShown >= hints.length) {
      btn.style.display = "none";
    } else {
      btn.style.display = "";
      btn.textContent = hintsShown === 0 ? window.t("showHint") : window.t("showNextHint");
    }
  }

  function showDashError(e) {
    console.error(e);
    const box = $("#appError");
    if (!box) return;
    box.textContent = String(e.message || e);
    box.style.display = "";
  }

  function stopAllListeners() {
    if (assignmentsUnsub) { assignmentsUnsub(); assignmentsUnsub = null; }
    if (submissionsUnsub) { submissionsUnsub(); submissionsUnsub = null; }
  }

  function lang() { return window.getLang(); }
  function pick(en, te) { return lang() === "te" && te ? te : en; }

  function showJoin() {
    $("#joinScreen").style.display = "";
    $("#appScreen").style.display = "none";
  }
  function showApp() {
    $("#joinScreen").style.display = "none";
    $("#appScreen").style.display = "";
    $("#welcomeText").textContent = window.t("welcomeBack") + ", " + studentName + " (" + classCode + ")";
    updateConnBanner();
    refreshOfflineStatus();
    // On a normal (non-mobile-data) connection, quietly save the Python
    // engine now so it's already on the device when the signal drops.
    window.PyClass.prefetchEngineQuietly();
  }

  // Starts the two live listeners (homework + my submissions). They need a
  // signed-in user, so this runs once sign-in has finished.
  function startLiveData() {
    if (!myStudentKey || !classCode) return;
    loadAssignments();
    loadMySubmissions();
  }

  // Shows what is saved on this device for offline use, and the button to
  // save the rest.
  async function refreshOfflineStatus() {
    const box = $("#offlineBox");
    if (!box) return;
    const st = await window.PyClass.offlineStatus();
    if (!st.supported) { box.style.display = "none"; return; }
    const libsReady = Object.keys(st.libs).every(function (k) { return st.libs[k]; });
    const key = st.engine && libsReady ? "offlineAllReady" : (st.engine ? "offlineEngineOnly" : "offlineNotReady");
    $("#offlineStatus").textContent = window.t(key);
    $("#offlineBtn").style.display = st.engine && libsReady ? "none" : "";
  }

  async function getReadyForOffline() {
    const btn = $("#offlineBtn");
    const prog = $("#offlineProgress");
    prog.style.display = "";
    if (!navigator.onLine) { prog.textContent = window.t("offlineFailed"); return; }
    btn.disabled = true;
    try {
      await window.PyClass.prepareOffline(function (p) {
        prog.textContent = p.step === "engine"
          ? window.t("offlineSavingEngine")
          : window.t("offlineSavingLib") + p.name;
      });
      prog.textContent = window.t("offlineDone");
    } catch (e) {
      console.error(e);
      prog.textContent = window.t("offlineFailed");
    }
    btn.disabled = false;
    refreshOfflineStatus();
  }

  function clearSavedIdentity() {
    try {
      localStorage.removeItem("pyclass_name");
      localStorage.removeItem("pyclass_class");
    } catch (e) {}
  }

  // A student's identity is their name + class code (see studentKey()),
  // so siblings sharing a phone are already kept separate by name. This
  // just clears what's saved on THIS device so the join screen comes back
  // up empty instead of auto-filling the previous sibling's name.
  //
  // It deliberately does NOT sign the device out any more. Firestore keeps
  // each device's unsent (queued) submissions under the signed-in user's
  // id; signing out and getting a brand-new anonymous id would orphan any
  // homework still waiting to be sent, and signing back in needs internet.
  // The anonymous id only labels the device (studentUid, "for
  // troubleshooting only"); ownership comes from studentKey, so keeping it
  // is safe.
  function switchStudent() {
    stopAllListeners();
    clearSavedIdentity();
    studentName = null; classCode = null; currentAssignment = null;
    myStudentKey = undefined;
    hintsShown = 0;
    lastAssignments = []; submittedAssignmentIds = new Set(); lastSubmissionByAssignment = {};
    $("#nameInput").value = "";
    $("#codeInput").value = "";
    $("#pinInput").value = "";
    $("#code").value = "";
    $("#output").textContent = "—";
    $("#changeNoteWrap").style.display = "none";
    $("#submitBtn").style.display = "none";
    showJoin();
  }

  function renderLessons() {
    const wrap = $("#lessonList");
    wrap.innerHTML = "";
    window.LESSONS.forEach(function (l) {
      const div = document.createElement("div");
      div.className = "lesson-item";
      div.innerHTML =
        "<div><strong>" + pick(l.title_en, l.title_te) + "</strong><div class='meta'>" +
        pick(l.body_en, l.body_te) + "</div></div><div>➜</div>";
      div.addEventListener("click", function () {
        currentAssignment = null;
        $("#code").value = l.starter;
        $("#editingLabel").textContent = pick(l.title_en, l.title_te);
        $("#editingLabel").className = "badge";
        $("#submitBtn").style.display = "none";
        $("#changeNoteWrap").style.display = "none";
        hintsShown = 0;
        renderHints();
      });
      wrap.appendChild(div);
    });
  }

  function renderAssignments(assignments) {
    const wrap = $("#assignmentList");
    wrap.innerHTML = "";
    if (!assignments.length) {
      // "No homework" and "I can't reach the server, so I don't know" look
      // the same on screen (an empty list) but mean different things. Never
      // tell a student nothing was posted when we simply couldn't check.
      const msg = $("#noAssignments");
      const key = isOffline() ? "noHomeworkOffline" : "noAssignments";
      msg.setAttribute("data-t", key); // so the language toggle re-translates the right message
      msg.textContent = window.t(key);
      msg.style.display = "";
      return;
    }
    $("#noAssignments").style.display = "none";
    assignments.forEach(function (a) {
      const isResubmit = submittedAssignmentIds.has(a.id);
      const div = document.createElement("div");
      div.className = "lesson-item";
      const dueText = a.dueDate ? (window.t("due") + ": " + window.PyClass.fmtDueDate(a.dueDate)) : "";
      const submittedTag = isResubmit ? " <span class='badge green' style='font-size:11px;'>" + window.t("submittedTag") + "</span>" : "";
      div.innerHTML =
        "<div><strong>" + pick(a.title_en, a.title_te) + submittedTag + "</strong><div class='meta'>" +
        window.fmtOrBlank(a.createdAt) + (dueText ? " · " + dueText : "") + "</div></div><div>➜</div>";
      div.addEventListener("click", function () {
        currentAssignment = a;
        // Reopening an already-submitted assignment continues from that
        // last submission's code, not a blank starter — so a resubmit is
        // an actual edit, the same way a real commit history works.
        const priorCode = lastSubmissionByAssignment[a.id];
        $("#code").value = isResubmit && priorCode != null ? priorCode : (a.starterCode || "");
        $("#editingLabel").textContent = "📝 " + pick(a.title_en, a.title_te);
        $("#editingLabel").className = "badge green";
        $("#submitBtn").style.display = "";
        $("#changeNoteWrap").style.display = "";
        $("#changeNote").value = "";
        // Resubmitting (this assignment already has a submission from this
        // student) gets a different prompt than a first attempt — see
        // submittedAssignmentIds, kept up to date by loadMySubmissions().
        $("#changeNoteLabel").textContent = window.t(isResubmit ? "changeNoteLabelAgain" : "changeNoteLabelFirst");
        const instr = pick(a.instructions_en, a.instructions_te);
        if (instr) {
          $("#pyStatus").style.display = "";
          $("#pyStatus").textContent = instr;
        }
        hintsShown = 0;
        renderHints();
      });
      wrap.appendChild(div);
    });
  }

  window.fmtOrBlank = function (ts) {
    if (!ts) return "";
    return window.PyClass.fmtDate(ts);
  };

  // Shows every posted assignment, submitted or not — a submitted one
  // stays clickable so a student can reopen and resubmit it (see the
  // "Submitted" tag added in renderAssignments and the isResubmit branch
  // in its click handler above).
  function renderVisibleAssignments() {
    renderAssignments(lastAssignments);
  }

  function loadAssignments() {
    if (assignmentsUnsub) assignmentsUnsub();
    // includeMetadataChanges: also notify us when only the *source* of the
    // data changes (saved copy <-> server), not just when the data itself
    // changes. That's how we notice the connection dropping or returning.
    assignmentsUnsub = db.collection("assignments")
      .where("classCode", "==", classCode)
      .orderBy("createdAt", "desc")
      .onSnapshot({ includeMetadataChanges: true }, function (snap) {
        noteSnapshotSource(snap.metadata.fromCache);
        lastAssignments = [];
        snap.forEach(function (doc) { lastAssignments.push(Object.assign({ id: doc.id }, doc.data({ serverTimestamps: "estimate" }))); });
        renderVisibleAssignments();
      }, showDashError);
  }

  function loadMySubmissions() {
    if (submissionsUnsub) submissionsUnsub();
    const wrap = $("#mySubmissions");
    submissionsUnsub = db.collection("submissions")
      .where("studentKey", "==", myStudentKey)
      .orderBy("submittedAt", "desc")
      .limit(20)
      .onSnapshot({ includeMetadataChanges: true }, function (snap) {
        noteSnapshotSource(snap.metadata.fromCache);
        submittedAssignmentIds = new Set();
        lastSubmissionByAssignment = {};
        wrap.innerHTML = "";
        if (snap.empty) {
          wrap.innerHTML = '<div class="empty">—</div>';
        } else {
          snap.forEach(function (doc) {
            // A submission that is still waiting to reach the server has no
            // server timestamp yet. "estimate" fills in this device's clock
            // for now, instead of showing the date as 1/1/1970.
            const s = doc.data({ serverTimestamps: "estimate" });
            // true while this document exists only on this device.
            const waiting = doc.metadata.hasPendingWrites;
            if (s.assignmentId) {
              submittedAssignmentIds.add(s.assignmentId);
              // Query is ordered submittedAt desc, so the first submission
              // seen per assignment here is that assignment's most recent
              // one — exactly the code a resubmit should continue from.
              if (!(s.assignmentId in lastSubmissionByAssignment)) {
                lastSubmissionByAssignment[s.assignmentId] = s.code || "";
              }
            }
            const row = document.createElement("div");
            row.className = "submission-row";
            const graded = typeof s.score === "number";
            row.innerHTML =
              "<div class='row-head'><strong>" + (s.assignmentTitle || "") + "</strong>" +
              "<span class='badge " + (graded ? "green" : "pending") + "'>" +
              (waiting ? window.t("pendingTag") : (graded ? window.t("score") + ": " + s.score + "/10" : window.t("notGradedYet"))) +
              "</span></div>" +
              "<div class='meta' style='color:#6b5f56;font-size:12px;margin-top:4px;'>" + window.PyClass.fmtDate(s.submittedAt) + "</div>" +
              (s.feedback ? "<div style='margin-top:6px;font-size:13.5px;'><strong>" + window.t("feedback") + ":</strong> " + escapeHtml(s.feedback) + "</div>" : "");
            wrap.appendChild(row);
          });
        }
        renderVisibleAssignments();
      }, showDashError);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Starts Firebase and signs the device in, WITHOUT making the rest of the
  // page wait for it. (Before, the whole page waited here, so on a device
  // with no signal even the lessons and the code editor never appeared.)
  // A device that has signed in before is recognised from its saved
  // sign-in even with no internet; only a brand-new device needs a signal.
  function startAuth() {
    if (typeof firebase === "undefined") {
      // The Firebase library isn't on this device and can't be downloaded
      // right now. Everything drawn so far (lessons, editor) still works;
      // anything that needs the server explains itself when used.
      console.warn("Firebase library not loaded (no connection and not saved yet).");
      return;
    }
    const f = window.PyClass.initFirebase({ offlineData: true });
    db = f.db; auth = f.auth;
    auth.onAuthStateChanged(function (user) {
      if (user) {
        uid = user.uid;
        authWaiters.splice(0).forEach(function (fn) { fn(); });
        startLiveData(); // no-op until a student has joined
      } else {
        uid = null;
        stopAllListeners();
        signInAnonymouslyWithRetry();
      }
    });
  }

  function signInAnonymouslyWithRetry() {
    auth.signInAnonymously().catch(function (e) {
      console.warn("Sign-in failed (probably no connection yet):", e && e.code);
      // Try again the moment the browser says the connection is back.
      window.addEventListener("online", function retry() {
        window.removeEventListener("online", retry);
        signInAnonymouslyWithRetry();
      });
    });
  }

  function loadSavedIdentity() {
    try {
      studentName = localStorage.getItem("pyclass_name");
      classCode = localStorage.getItem("pyclass_class");
    } catch (e) {}
  }
  function saveIdentity() {
    try {
      localStorage.setItem("pyclass_name", studentName);
      localStorage.setItem("pyclass_class", classCode);
    } catch (e) {}
  }

  // A simple one-way scramble of the PIN so the actual PIN is never stored
  // or sent anywhere in readable form — only this scrambled version lives
  // in Firestore. Mixing in the student's key means two students who pick
  // the same PIN don't end up with identical-looking stored values.
  async function hashPin(key, pin) {
    const bytes = new TextEncoder().encode(key + ":" + pin);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  async function doJoin() {
    const name = $("#nameInput").value.trim();
    const code = $("#codeInput").value.trim().toUpperCase();
    const pin = $("#pinInput").value.trim();
    $("#joinError").style.display = "none";
    if (!name || !code || !pin) {
      $("#joinError").textContent = window.t("yourName") + " + " + window.t("classCode") + " + " + window.t("yourPin");
      $("#joinError").style.display = "";
      return;
    }
    if (pin.length < 4) {
      $("#joinError").textContent = window.t("yourPin");
      $("#joinError").style.display = "";
      return;
    }

    const key = studentKey(name, code);
    const btn = $("#joinBtn");
    btn.disabled = true;
    try {
      // The first join has to talk to the server (it's where the PIN is
      // checked), so wait for the sign-in to finish first.
      if (!(await waitForAuth(8000))) {
        const err = new Error("Not signed in yet");
        err.code = "NO_AUTH";
        throw err;
      }
      const pinHash = await hashPin(key, pin);
      const docRef = db.collection("students").doc(key);

      // Prefer the server. If it can't be reached, fall back to this
      // device's saved copy of the student's record, which exists if this
      // student has joined on this device before. A name that has never
      // been seen here can't be checked offline, and can't be claimed
      // offline either (two kids could claim the same name).
      let snap, fromServer = false;
      if (navigator.onLine) {
        try { snap = await docRef.get(); fromServer = true; }
        catch (e1) { if (e1.code !== "unavailable") throw e1; }
      }
      if (!snap) snap = await docRef.get({ source: "cache" }); // throws "unavailable" if never saved here

      if (snap.exists && snap.data().passwordHash && snap.data().passwordHash !== pinHash) {
        // This name + class code was already claimed with a different PIN.
        $("#joinError").textContent = window.t("wrongPin");
        $("#joinError").style.display = "";
        btn.disabled = false;
        return;
      }
      const write = docRef.set({
        name: name,
        classCode: code,
        passwordHash: pinHash,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      // A write's promise only finishes when the SERVER confirms. Offline
      // that could be hours, so only wait for it when we know we're online;
      // otherwise it simply queues and sends itself later.
      if (fromServer) await write; else write.catch(function (e2) { console.warn(e2); });
    } catch (e) {
      console.error(e);
      const noConnection = e.code === "NO_AUTH" || e.code === "unavailable" || !navigator.onLine;
      $("#joinError").textContent = noConnection ? window.t("joinNeedsInternet") : String(e.message || e);
      $("#joinError").style.display = "";
      btn.disabled = false;
      return;
    }
    btn.disabled = false;

    studentName = name; classCode = code;
    myStudentKey = key;
    saveIdentity();
    showApp();
    startLiveData();
  }

  async function runCode() {
    const btn = $("#runBtn");
    const out = $("#output");
    btn.disabled = true;
    const origLabel = btn.innerHTML;
    btn.innerHTML = "<span class='spinner'></span> " + window.t("running");
    if (!window.PyClass.__pyReady) {
      $("#pyStatus").style.display = "";
      $("#pyStatus").textContent = window.t("loadingPython");
    }
    const result = await window.PyClass.runPython($("#code").value, function (status) {
      $("#pyStatus").style.display = "";
      if (status.indexOf("installing:") === 0) {
        $("#pyStatus").textContent = "Adding the '" + status.slice(11) + "' library, please wait...";
      } else {
        $("#pyStatus").textContent = window.t("running");
      }
    });
    window.PyClass.__pyReady = true;
    $("#pyStatus").style.display = "none";
    out.textContent = result.output;
    out.className = "output" + (result.ok ? "" : " error");
    btn.disabled = false;
    btn.innerHTML = origLabel;
    return result;
  }

  async function submitHomework() {
    if (!currentAssignment) return;
    // Every submission needs a one-sentence note on what the student did —
    // this becomes the actual commit message when the code is mirrored to
    // GitHub (see the "commitToGitHub" Cloud Function), so a real sentence
    // here is what turns that history into something worth reading later.
    const changeNote = $("#changeNote").value.trim();
    if (changeNote.length < 10) {
      $("#submitMsg").className = "notice error";
      $("#submitMsg").textContent = window.t("changeNoteTooShort");
      $("#submitMsg").style.display = "";
      $("#changeNote").focus();
      return;
    }
    function showSubmitMsg(cls, text) {
      $("#submitMsg").className = cls;
      $("#submitMsg").textContent = text;
      $("#submitMsg").style.display = "";
    }
    // A device that has never signed in (it has never been online) has
    // nobody to save the homework under yet.
    if (!uid) { showSubmitMsg("notice error", window.t("joinNeedsInternet")); return; }

    // Take what the student wrote and which homework it is NOW, before the
    // run (which can take a few seconds) in case they tap something else.
    const assignment = currentAssignment;
    const codeText = $("#code").value;
    const btn = $("#submitBtn");
    btn.disabled = true;
    const result = await runCode();
    try {
      const ref = db.collection("submissions").doc();
      // set() returns a promise that only finishes when the SERVER has
      // confirmed the write. Offline, that could be hours, so we do NOT
      // wait for it. Firestore has already saved the submission on this
      // device (and will send it by itself when the connection returns), so
      // the student can be told right away. The promise is used afterwards,
      // to upgrade the message or to report a rejection.
      const confirmed = ref.set({
        assignmentId: assignment.id,
        assignmentTitle: pick(assignment.title_en, assignment.title_te),
        classCode: classCode,
        studentKey: myStudentKey,
        studentUid: uid, // the device's anonymous session id, kept for troubleshooting only
        studentName: studentName,
        code: codeText,
        changeNote: changeNote,
        output: result.engineUnavailable ? "(Not run: Python was not available on the student's device.)" : result.output,
        ok: result.ok,
        score: null,
        feedback: null,
        submittedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (isOffline()) {
        // If this browser can't keep unsent data across a page close (e.g. a
        // private window), say so, instead of promising something untrue.
        showSubmitMsg("notice", window.t(window.PyClass.offlineDataState() === "off" ? "submittedOfflineKeepOpen" : "submittedOffline"));
      } else {
        showSubmitMsg("notice", window.t("submitted"));
      }
      $("#changeNote").value = "";
      confirmed.then(function () {
        showSubmitMsg("notice", window.t("submitted")); // the server has it now
      }).catch(function (e) {
        // The server looked at the queued submission and refused it (for
        // example, the security rules). Firestore then removes it from the
        // list, so the student must be told rather than left thinking it sent.
        console.error(e);
        showSubmitMsg("notice error", window.t("submitFailedLater") + String(e.message || e));
      });
    } catch (e) {
      console.error(e);
      showSubmitMsg("notice error", String(e.message || e));
    }
    btn.disabled = false;
  }

  // Tab key inserts spaces instead of moving focus, since indentation
  // matters in Python.
  function setupEditorTabKey() {
    const ta = $("#code");
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + "    " + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 4;
      }
    });
  }

  async function init() {
    window.applyStrings();
    document.getElementById("langBtn").addEventListener("click", function () {
      window.setLang(window.getLang() === "en" ? "te" : "en");
      window.applyStrings();
      if (window.LESSONS) renderLessons();
      renderHints();
      updateConnBanner();
      refreshOfflineStatus();
      renderVisibleAssignments();
    });
    window.addEventListener("online", function () {
      browserOnline = true;
      updateConnBanner();
      refreshOfflineStatus();
    });
    window.addEventListener("offline", function () {
      browserOnline = false;
      updateConnBanner();
      renderVisibleAssignments();
    });
    window.PyClass.registerServiceWorker();
    setupEditorTabKey();

    $("#joinBtn").addEventListener("click", doJoin);
    $("#runBtn").addEventListener("click", runCode);
    $("#resetBtn").addEventListener("click", function () {
      if (currentAssignment) $("#code").value = currentAssignment.starterCode || "";
    });
    $("#submitBtn").addEventListener("click", submitHomework);
    $("#switchStudentBtn").addEventListener("click", switchStudent);
    $("#hintBtn").addEventListener("click", function () {
      hintsShown += 1;
      renderHints();
    });

    $("#offlineBtn").addEventListener("click", getReadyForOffline);

    // Draw everything that needs no network FIRST, so the page is usable
    // immediately, even on a device with no signal at all.
    loadSavedIdentity();
    renderLessons();

    if (studentName && classCode) {
      $("#nameInput").value = studentName;
      $("#codeInput").value = classCode;
      myStudentKey = studentKey(studentName, classCode);
      showApp();
    } else {
      showJoin();
    }

    // Then sign in, in the background. Once signed in, startLiveData()
    // (called from the sign-in listener) starts homework and grades.
    startAuth();
  }

  init();
})();
