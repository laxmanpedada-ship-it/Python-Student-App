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

  // Live-listener unsubscribe functions, so homework and grades appear the
  // moment the teacher posts or grades them — no refresh or re-login needed.
  let assignmentsUnsub = null;
  let submissionsUnsub = null;

  let hintsShown = 0; // how many hints of the current assignment are revealed

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
  async function switchStudent() {
    stopAllListeners();
    clearSavedIdentity();
    studentName = null; classCode = null; currentAssignment = null;
    myStudentKey = undefined;
    hintsShown = 0;
    lastAssignments = []; submittedAssignmentIds = new Set();
    $("#nameInput").value = "";
    $("#codeInput").value = "";
    $("#pinInput").value = "";
    $("#code").value = "";
    $("#output").textContent = "—";
    showJoin();
    try {
      // The auth listener below picks up the sign-out and automatically
      // signs back in anonymously with a fresh id.
      await auth.signOut();
    } catch (e) { console.error(e); }
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
      $("#noAssignments").style.display = "";
      return;
    }
    $("#noAssignments").style.display = "none";
    assignments.forEach(function (a) {
      const div = document.createElement("div");
      div.className = "lesson-item";
      const dueText = a.dueDate ? (window.t("due") + ": " + window.PyClass.fmtDueDate(a.dueDate)) : "";
      div.innerHTML =
        "<div><strong>" + pick(a.title_en, a.title_te) + "</strong><div class='meta'>" +
        window.fmtOrBlank(a.createdAt) + (dueText ? " · " + dueText : "") + "</div></div><div>➜</div>";
      div.addEventListener("click", function () {
        currentAssignment = a;
        $("#code").value = a.starterCode || "";
        $("#editingLabel").textContent = "📝 " + pick(a.title_en, a.title_te);
        $("#editingLabel").className = "badge green";
        $("#submitBtn").style.display = "";
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

  // Shows only homework this student hasn't turned in yet.
  function renderVisibleAssignments() {
    const visible = lastAssignments.filter(function (a) {
      return !submittedAssignmentIds.has(a.id);
    });
    renderAssignments(visible);
  }

  function loadAssignments() {
    if (assignmentsUnsub) assignmentsUnsub();
    assignmentsUnsub = db.collection("assignments")
      .where("classCode", "==", classCode)
      .orderBy("createdAt", "desc")
      .onSnapshot(function (snap) {
        lastAssignments = [];
        snap.forEach(function (doc) { lastAssignments.push(Object.assign({ id: doc.id }, doc.data())); });
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
      .onSnapshot(function (snap) {
        submittedAssignmentIds = new Set();
        wrap.innerHTML = "";
        if (snap.empty) {
          wrap.innerHTML = '<div class="empty">—</div>';
        } else {
          snap.forEach(function (doc) {
            const s = doc.data();
            if (s.assignmentId) submittedAssignmentIds.add(s.assignmentId);
            const row = document.createElement("div");
            row.className = "submission-row";
            const graded = typeof s.score === "number";
            row.innerHTML =
              "<div class='row-head'><strong>" + (s.assignmentTitle || "") + "</strong>" +
              "<span class='badge " + (graded ? "green" : "pending") + "'>" +
              (graded ? window.t("score") + ": " + s.score + "/10" : window.t("notGradedYet")) +
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

  async function ensureAuth() {
    const f = window.PyClass.initFirebase();
    db = f.db; auth = f.auth;
    return new Promise(function (resolve) {
      auth.onAuthStateChanged(function (user) {
        if (user) { uid = user.uid; resolve(); }
        else {
          stopAllListeners();
          auth.signInAnonymously().catch(function (e) { console.error(e); });
        }
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
      const pinHash = await hashPin(key, pin);
      const docRef = db.collection("students").doc(key);
      const snap = await docRef.get();
      if (snap.exists && snap.data().passwordHash && snap.data().passwordHash !== pinHash) {
        // This name + class code was already claimed with a different PIN.
        $("#joinError").textContent = window.t("wrongPin");
        $("#joinError").style.display = "";
        btn.disabled = false;
        return;
      }
      await docRef.set({
        name: name,
        classCode: code,
        passwordHash: pinHash,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error(e);
      $("#joinError").textContent = String(e.message || e);
      $("#joinError").style.display = "";
      btn.disabled = false;
      return;
    }
    btn.disabled = false;

    studentName = name; classCode = code;
    myStudentKey = key;
    saveIdentity();
    showApp();
    loadAssignments();
    loadMySubmissions();
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
    const btn = $("#submitBtn");
    btn.disabled = true;
    const result = await runCode();
    try {
      await db.collection("submissions").add({
        assignmentId: currentAssignment.id,
        assignmentTitle: pick(currentAssignment.title_en, currentAssignment.title_te),
        classCode: classCode,
        studentKey: myStudentKey,
        studentUid: uid, // the device's anonymous session id, kept for troubleshooting only
        studentName: studentName,
        code: $("#code").value,
        output: result.output,
        ok: result.ok,
        score: null,
        feedback: null,
        submittedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      $("#submitMsg").className = "notice";
      $("#submitMsg").textContent = window.t("submitted");
      $("#submitMsg").style.display = "";
      loadMySubmissions();
    } catch (e) {
      console.error(e);
      $("#submitMsg").className = "notice error";
      $("#submitMsg").textContent = String(e.message || e);
      $("#submitMsg").style.display = "";
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

    await ensureAuth();
    loadSavedIdentity();
    renderLessons();

    if (studentName && classCode) {
      $("#nameInput").value = studentName;
      $("#codeInput").value = classCode;
      myStudentKey = studentKey(studentName, classCode);
      showApp();
      loadAssignments();
      loadMySubmissions();
    } else {
      showJoin();
    }
  }

  init();
})();
