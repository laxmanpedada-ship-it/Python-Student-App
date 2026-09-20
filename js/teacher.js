(function () {
  const $ = window.PyClass.qs;
  let db, auth, uid;
  let mode = "login"; // or "signup"
  let classes = [];
  let assignments = [];
  let currentAssignmentId = null;
  let editingAssignmentId = null; // set while the create-homework form is editing an existing assignment instead of making a new one

  // Live-listener unsubscribe functions. Firestore streams changes to us
  // as they happen, so the dashboard updates itself the moment a student
  // submits or you post new homework — no refresh needed. Each listener
  // has to be torn down and replaced when what it's watching changes
  // (e.g. switching which homework's submissions you're viewing).
  let classesUnsub = null;
  let assignmentsUnsub = null;
  let submissionsUnsub = null;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showAuth() {
    $("#authScreen").style.display = "";
    $("#dashScreen").style.display = "none";
    $("#logoutBtn").style.display = "none";
  }
  function showDash() {
    $("#authScreen").style.display = "none";
    $("#dashScreen").style.display = "";
    $("#logoutBtn").style.display = "";
  }

  function showDashError(e) {
    console.error(e);
    const box = $("#dashError");
    if (!box) return;
    box.textContent = String(e.message || e);
    box.style.display = "";
  }

  function setMode(m) {
    mode = m;
    $("#setupCodeWrap").style.display = m === "signup" ? "" : "none";
    $("#authSubmit").textContent = m === "signup" ? window.t("signUp") : window.t("login");
    $("#tabLogin").className = "btn " + (m === "login" ? "" : "secondary");
    $("#tabSignup").className = "btn " + (m === "signup" ? "" : "secondary");
  }

  async function doAuth() {
    const email = $("#emailInput").value.trim();
    const pass = $("#passInput").value;
    $("#authError").style.display = "none";
    if (!email || !pass) return;
    try {
      if (mode === "signup") {
        const code = $("#setupCodeInput").value.trim();
        if (code !== window.TEACHER_SETUP_CODE) {
          throw new Error("Incorrect setup code.");
        }
        let cred;
        let isNewAccount = true;
        try {
          cred = await auth.createUserWithEmailAndPassword(email, pass);
        } catch (e) {
          if (e.code === "auth/email-already-in-use") {
            cred = await auth.signInWithEmailAndPassword(email, pass);
            isNewAccount = false;
          } else { throw e; }
        }
        // Only write the teacher record for a genuinely new account.
        // Re-writing it on every login attempt with an existing account
        // is blocked by the security rules (teacher records can't be
        // edited once created) and would show a confusing error.
        const alreadyTeacher = !isNewAccount && (await isTeacher(cred.user.uid));
        if (!alreadyTeacher) {
          await db.collection("teachers").doc(cred.user.uid).set({
            email: email,
            setupCode: code,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      } else {
        await auth.signInWithEmailAndPassword(email, pass);
      }
    } catch (e) {
      $("#authError").textContent = String(e.message || e);
      $("#authError").style.display = "";
    }
  }

  async function isTeacher(u) {
    const doc = await db.collection("teachers").doc(u).get();
    return doc.exists;
  }

  function renderClassList() {
    const wrap = $("#classList");
    if (!classes.length) { wrap.innerHTML = '<div class="empty">—</div>'; }
    else {
      wrap.innerHTML = classes.map(function (c) {
        return "<div class='lesson-item'><div><strong>" + escapeHtml(c.name || c.id) +
          "</strong><div class='meta'>" + c.id + "</div></div></div>";
      }).join("");
    }
    const select = $("#assignClassSelect");
    const prevVal = select.value;
    select.innerHTML = classes.map(function (c) {
      return "<option value='" + c.id + "'>" + escapeHtml(c.name || c.id) + " (" + c.id + ")</option>";
    }).join("") || "<option value='" + window.DEFAULT_CLASS_CODE + "'>" + window.DEFAULT_CLASS_CODE + "</option>";
    if (prevVal && classes.some(function (c) { return c.id === prevVal; })) select.value = prevVal;
  }

  function loadClasses() {
    if (classesUnsub) classesUnsub();
    classesUnsub = db.collection("classes").where("teacherUid", "==", uid)
      .onSnapshot(function (snap) {
        classes = [];
        snap.forEach(function (doc) { classes.push(Object.assign({ id: doc.id }, doc.data())); });
        renderClassList();
      }, showDashError);
  }

  async function addClass() {
    const name = $("#newClassName").value.trim();
    const code = $("#newClassCode").value.trim().toUpperCase();
    if (!code) return;
    await db.collection("classes").doc(code).set({
      name: name || code,
      teacherUid: uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    $("#newClassName").value = ""; $("#newClassCode").value = "";
    // No manual reload needed — the live listener above picks this up.
  }

  function renderAssignmentPicker() {
    const picker = $("#assignmentPicker");
    const prevVal = picker.value;
    picker.innerHTML = assignments.map(function (a) {
      return "<option value='" + a.id + "'>" + escapeHtml(a.title_en) + " — " + a.classCode + "</option>";
    }).join("");
    if (!assignments.length) {
      currentAssignmentId = null;
      if (submissionsUnsub) { submissionsUnsub(); submissionsUnsub = null; }
      $("#submissionsList").innerHTML = '<div class="empty">' + window.t("noSubmissions") + '</div>';
      return;
    }
    const toSelect = assignments.some(function (a) { return a.id === prevVal; }) ? prevVal : assignments[0].id;
    picker.value = toSelect;
    if (toSelect !== currentAssignmentId) {
      currentAssignmentId = toSelect;
      loadSubmissions(toSelect);
    }
  }

  function loadAssignments() {
    if (assignmentsUnsub) assignmentsUnsub();
    assignmentsUnsub = db.collection("assignments").where("teacherUid", "==", uid).orderBy("createdAt", "desc")
      .onSnapshot(function (snap) {
        assignments = [];
        snap.forEach(function (doc) { assignments.push(Object.assign({ id: doc.id }, doc.data())); });
        renderAssignmentPicker();
        renderHomeworkList();
      }, showDashError);
  }

  // Lists every homework this teacher has posted, each with Edit/Delete
  // controls — this is the fix for "posted a homework with a typo and had
  // no way to correct it besides posting a new one and ignoring the old."
  function renderHomeworkList() {
    const wrap = $("#homeworkList");
    if (!wrap) return;
    if (!assignments.length) {
      wrap.innerHTML = '<div class="empty">' + window.t("noHomeworkYet") + '</div>';
      return;
    }
    wrap.innerHTML = "";
    assignments.forEach(function (a) {
      const row = document.createElement("div");
      row.className = "lesson-item";
      const dueText = a.dueDate ? (window.t("due") + ": " + window.PyClass.fmtDueDate(a.dueDate)) : "";
      row.innerHTML =
        "<div style='flex:1;'><strong>" + escapeHtml(a.title_en) + "</strong>" +
        "<div class='meta'>" + escapeHtml(a.classCode) + (dueText ? " · " + escapeHtml(dueText) : "") + "</div></div>" +
        "<div style='display:flex;gap:6px;flex-wrap:wrap;'>" +
        "<button type='button' class='btn secondary editHomeworkBtn' style='padding:6px 12px;font-size:13px;'>" + window.t("edit") + "</button>" +
        "<button type='button' class='btn secondary deleteHomeworkBtn' style='padding:6px 12px;font-size:13px;'>" + window.t("delete") + "</button>" +
        "</div>";
      row.querySelector(".editHomeworkBtn").addEventListener("click", function () { startEditAssignment(a); });
      row.querySelector(".deleteHomeworkBtn").addEventListener("click", function () { deleteAssignment(a); });
      wrap.appendChild(row);
    });
  }

  // Clears the create-homework form back to a blank "new homework" state,
  // whether that's after a successful post, a successful save, or the
  // teacher clicking Cancel out of an edit.
  function resetAssignmentForm() {
    editingAssignmentId = null;
    $("#titleEn").value = ""; $("#titleTe").value = "";
    $("#instrEn").value = ""; $("#instrTe").value = "";
    $("#hintsEn").value = ""; $("#hintsTe").value = "";
    $("#dueDate").value = "";
    $("#starterCode").value = "";
    $("#editingBanner").style.display = "none";
    $("#postBtn").textContent = window.t("post");
  }

  // Loads an existing assignment's fields into the create-homework form so
  // editing reuses the same UI instead of a separate edit screen. The form
  // now targets an update (see postAssignment) until saved or cancelled.
  function startEditAssignment(a) {
    editingAssignmentId = a.id;
    $("#assignClassSelect").value = a.classCode;
    $("#titleEn").value = a.title_en || "";
    $("#titleTe").value = a.title_te || "";
    $("#instrEn").value = a.instructions_en || "";
    $("#instrTe").value = a.instructions_te || "";
    $("#hintsEn").value = (a.hints_en || []).join("\n");
    $("#hintsTe").value = (a.hints_te || []).join("\n");
    $("#dueDate").value = a.dueDate || "";
    $("#starterCode").value = a.starterCode || "";
    $("#editingBannerText").textContent = window.t("editingLabel") + " " + a.title_en;
    $("#editingBanner").style.display = "flex";
    $("#postBtn").textContent = window.t("saveChanges");
    $("#editingBanner").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function deleteAssignment(a) {
    if (!window.confirm(window.t("confirmDeleteHomework"))) return;
    try {
      await db.collection("assignments").doc(a.id).delete();
      // Submissions for a deleted assignment are left as-is — they're a
      // graded record of the student's work, not something deleting the
      // assignment should also erase.
      if (editingAssignmentId === a.id) resetAssignmentForm();
    } catch (e) {
      showDashError(e);
    }
  }

  // Turns a textarea's raw text into a clean array of hints, one per
  // non-empty line, in the order the teacher typed them.
  function parseHints(text) {
    return String(text || "")
      .split("\n")
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; });
  }

  function isBlank(v) { return !v || !v.trim(); }

  // Fills a Telugu field from its English counterpart, similar to Google
  // Translate. Two modes:
  //  - force=false (auto, on blur): only fires when the Telugu field is
  //    still empty, so it never overwrites a teacher's own typing.
  //  - force=true (manual button click): the teacher explicitly asked
  //    for a (re)translation, so it overwrites whatever's currently in
  //    the Telugu field — used as the retry path when auto-translate
  //    didn't fire or failed (offline, quota, etc).
  // Either way, after the network round-trip it re-checks the English
  // text hasn't changed since the request started, so a slow response
  // never lands on top of newer typing.
  async function translateField(enId, teId, force) {
    const enEl = $(enId), teEl = $(teId);
    const text = enEl.value.trim();
    if (!text) return;
    if (!force && !isBlank(teEl.value)) return;
    const original = text;
    const prevPlaceholder = teEl.placeholder;
    teEl.placeholder = window.t("translating");
    const translated = await window.PyClass.translateText(text, "te");
    teEl.placeholder = prevPlaceholder;
    if (translated && enEl.value.trim() === original && (force || isBlank(teEl.value))) {
      teEl.value = translated;
    }
    return translated;
  }

  // Same idea as translateField, but for the hints textarea, which holds
  // one hint per line — each line is translated separately so the Telugu
  // hints line up with the English ones in the same order.
  async function translateHints(force) {
    const enEl = $("#hintsEn"), teEl = $("#hintsTe");
    const lines = parseHints(enEl.value);
    if (!lines.length) return;
    if (!force && !isBlank(teEl.value)) return;
    const original = enEl.value;
    const prevPlaceholder = teEl.placeholder;
    teEl.placeholder = window.t("translating");
    const translatedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const t = await window.PyClass.translateText(lines[i], "te");
      // If one line fails to translate, fall back to the English line
      // rather than dropping it — keeps the hint count matching.
      translatedLines.push(t || lines[i]);
    }
    teEl.placeholder = prevPlaceholder;
    if (enEl.value === original && (force || isBlank(teEl.value))) {
      teEl.value = translatedLines.join("\n");
    }
  }

  // Wires a manual "Translate to Telugu" button: disables itself and
  // shows a busy label while the request is in flight, always forces an
  // overwrite (that's the point of clicking it), and re-enables itself
  // afterwards no matter how the translation turned out.
  function wireTranslateButton(btnId, runFn) {
    const btn = $(btnId);
    btn.addEventListener("click", async function () {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = window.t("translating");
      try {
        await runFn();
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  async function postAssignment() {
    $("#assignError").style.display = "none";
    const classCode = $("#assignClassSelect").value;
    const title_en = $("#titleEn").value.trim();
    if (!classCode || !title_en) {
      $("#assignError").textContent = window.t("title");
      $("#assignError").style.display = "";
      return;
    }
    const data = {
      classCode: classCode,
      title_en: title_en,
      title_te: $("#titleTe").value.trim(),
      instructions_en: $("#instrEn").value.trim(),
      instructions_te: $("#instrTe").value.trim(),
      hints_en: parseHints($("#hintsEn").value),
      hints_te: parseHints($("#hintsTe").value),
      dueDate: $("#dueDate").value || null, // "YYYY-MM-DD" from the date input, or null if left blank
      starterCode: $("#starterCode").value
    };
    try {
      if (editingAssignmentId) {
        // Editing: update in place, leaving teacherUid and createdAt
        // untouched so ownership and its position in the list don't change.
        await db.collection("assignments").doc(editingAssignmentId).update(data);
      } else {
        await db.collection("assignments").add(Object.assign({
          teacherUid: uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, data));
      }
      resetAssignmentForm();
      // No manual reload needed — the live listener above picks this up.
    } catch (e) {
      $("#assignError").textContent = String(e.message || e);
      $("#assignError").style.display = "";
    }
  }

  function renderSubmissionRow(doc) {
    const s = doc.data();
    const graded = typeof s.score === "number";
    const row = document.createElement("div");
    row.className = "submission-row";
    row.dataset.id = doc.id;
    row.innerHTML =
      "<div class='row-head'><strong>" + escapeHtml(s.studentName) + "</strong>" +
      "<span class='badge " + (graded ? "green" : "pending") + "'>" +
      (graded ? window.t("score") + ": " + s.score + "/10" : window.t("notGradedYet")) + "</span></div>" +
      "<div class='meta' style='color:#6b5f56;font-size:12px;margin-top:2px;'>" + window.PyClass.fmtDate(s.submittedAt) + "</div>" +
      "<details style='margin-top:8px;'><summary>" + window.t("viewCode") + "</summary>" +
      "<pre>" + escapeHtml(s.code) + "</pre>" +
      "<div style='font-size:12px;color:#6b5f56;margin-bottom:4px;'>" + window.t("output") + ":</div>" +
      "<pre>" + escapeHtml(s.output) + "</pre></details>" +
      "<label>" + window.t("giveScore") + "</label>" +
      "<input type='number' min='0' max='10' class='scoreInput' value='" + (s.score != null ? s.score : "") + "' />" +
      "<label>" + window.t("giveFeedback") + "</label>" +
      "<textarea rows='2' class='feedbackInput'>" + escapeHtml(s.feedback || "") + "</textarea>" +
      "<button class='btn secondary saveGradeBtn' style='margin-top:8px;'>" + window.t("saveGrade") + "</button>" +
      "<span class='gradeMsg' style='display:none;margin-left:8px;font-size:13px;color:#2E7D32;'>" + window.t("graded") + "</span>";
    row.querySelector(".saveGradeBtn").addEventListener("click", async function () {
      const scoreVal = row.querySelector(".scoreInput").value;
      const feedbackVal = row.querySelector(".feedbackInput").value;
      await db.collection("submissions").doc(doc.id).update({
        score: scoreVal === "" ? null : Number(scoreVal),
        feedback: feedbackVal,
        gradedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      const msg = row.querySelector(".gradeMsg");
      msg.style.display = "";
      setTimeout(function () { msg.style.display = "none"; }, 2000);
    });
    return row;
  }

  // If you're actively typing in a row (a score or feedback box) when a
  // live update comes in — say, another student submits at that exact
  // moment — we leave that one row alone instead of rebuilding it, so
  // your unsaved typing doesn't get wiped out. Every other row still
  // updates normally.
  function getFocusedRowId(wrap) {
    const active = document.activeElement;
    if (!active || !wrap.contains(active)) return null;
    const row = active.closest ? active.closest(".submission-row") : null;
    return row ? row.dataset.id : null;
  }

  function loadSubmissions(assignmentId) {
    if (submissionsUnsub) submissionsUnsub();
    const wrap = $("#submissionsList");
    submissionsUnsub = db.collection("submissions")
      .where("assignmentId", "==", assignmentId)
      .orderBy("submittedAt", "desc")
      .onSnapshot(function (snap) {
        if (snap.empty) {
          wrap.innerHTML = '<div class="empty">' + window.t("noSubmissions") + '</div>';
          return;
        }
        const skipId = getFocusedRowId(wrap);
        const frag = document.createDocumentFragment();
        snap.forEach(function (doc) {
          if (doc.id === skipId) {
            const existing = wrap.querySelector('[data-id="' + doc.id + '"]');
            if (existing) { frag.appendChild(existing); return; }
          }
          frag.appendChild(renderSubmissionRow(doc));
        });
        wrap.innerHTML = "";
        wrap.appendChild(frag);
      }, showDashError);
  }

  function stopAllListeners() {
    if (classesUnsub) { classesUnsub(); classesUnsub = null; }
    if (assignmentsUnsub) { assignmentsUnsub(); assignmentsUnsub = null; }
    if (submissionsUnsub) { submissionsUnsub(); submissionsUnsub = null; }
    currentAssignmentId = null;
  }

  function afterLogin() {
    showDash();
    loadClasses();
    loadAssignments();
  }

  function ensureAuth() {
    const f = window.PyClass.initFirebase();
    db = f.db; auth = f.auth;
    auth.onAuthStateChanged(async function (user) {
      if (user) {
        try {
          const ok = await isTeacher(user.uid);
          if (ok) { uid = user.uid; afterLogin(); }
          else { showAuth(); }
        } catch (e) {
          console.error(e);
          showAuth();
          $("#authError").textContent = String(e.message || e);
          $("#authError").style.display = "";
        }
      } else {
        stopAllListeners();
        showAuth();
      }
    });
  }

  function init() {
    window.applyStrings();
    window.PyClass.registerServiceWorker();

    $("#tabLogin").addEventListener("click", function () { setMode("login"); });
    $("#tabSignup").addEventListener("click", function () { setMode("signup"); });
    $("#authSubmit").addEventListener("click", doAuth);
    $("#addClassBtn").addEventListener("click", addClass);
    $("#titleEn").addEventListener("blur", function () { translateField("#titleEn", "#titleTe", false); });
    $("#instrEn").addEventListener("blur", function () { translateField("#instrEn", "#instrTe", false); });
    $("#hintsEn").addEventListener("blur", function () { translateHints(false); });
    wireTranslateButton("#translateTitleBtn", function () { return translateField("#titleEn", "#titleTe", true); });
    wireTranslateButton("#translateInstrBtn", function () { return translateField("#instrEn", "#instrTe", true); });
    wireTranslateButton("#translateHintsBtn", function () { return translateHints(true); });
    $("#cancelEditBtn").addEventListener("click", resetAssignmentForm);
    $("#postBtn").addEventListener("click", postAssignment);
    $("#assignmentPicker").addEventListener("change", function (e) {
      currentAssignmentId = e.target.value;
      loadSubmissions(currentAssignmentId);
    });
    $("#logoutBtn").addEventListener("click", function () { auth.signOut(); });

    setMode("login");
    ensureAuth();
  }

  init();
})();
