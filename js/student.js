(function () {
  const $ = window.PyClass.qs;
  let db, auth, uid;
  let studentName, classCode;
  let currentAssignment = null; // {id, ...} or null when just practicing a lesson
  let lastAssignments = []; // most recent fetch from the server, unfiltered
  let submittedAssignmentIds = new Set(); // assignment ids this student already turned in

  // Live-listener unsubscribe functions, so homework and grades appear the
  // moment the teacher posts or grades them — no refresh or re-login needed.
  let assignmentsUnsub = null;
  let submissionsUnsub = null;

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

  // Switching students needs a genuinely fresh identity, not just a new
  // display name — otherwise two siblings sharing a phone would share the
  // same anonymous account, and their homework submissions would get
  // mixed together under one student record. Signing out and back in
  // anonymously gets a brand-new id.
  async function switchStudent() {
    stopAllListeners();
    clearSavedIdentity();
    studentName = null; classCode = null; currentAssignment = null;
    lastAssignments = []; submittedAssignmentIds = new Set();
    $("#nameInput").value = "";
    $("#codeInput").value = "";
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
      div.innerHTML =
        "<div><strong>" + pick(a.title_en, a.title_te) + "</strong><div class='meta'>" +
        window.fmtOrBlank(a.createdAt) + "</div></div><div>➜</div>";
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
      .where("studentUid", "==", uid)
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

  async function doJoin() {
    const name = $("#nameInput").value.trim();
    const code = $("#codeInput").value.trim().toUpperCase();
    $("#joinError").style.display = "none";
    if (!name || !code) {
      $("#joinError").textContent = window.t("yourName") + " + " + window.t("classCode");
      $("#joinError").style.display = "";
      return;
    }
    studentName = name; classCode = code;
    saveIdentity();
    try {
      await db.collection("students").doc(uid).set({
        name: studentName,
        classCode: classCode,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { console.error(e); }
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
        studentUid: uid,
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

    await ensureAuth();
    loadSavedIdentity();
    renderLessons();

    if (studentName && classCode) {
      $("#nameInput").value = studentName;
      $("#codeInput").value = classCode;
      showApp();
      loadAssignments();
      loadMySubmissions();
    } else {
      showJoin();
    }
  }

  init();
})();
