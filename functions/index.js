/**
 * commitToGitHub
 * ------------------------------------------------------------
 * Fires automatically every time a student submits homework (any new
 * document in Firestore's "submissions" collection). It mirrors that
 * submission into a GitHub repo as a real commit, using the student's
 * own "what did I change?" note as the commit message.
 *
 * Nothing about the student-facing app changes because of this file —
 * students still just tap Submit. This runs in the background, using
 * one shared GitHub credential (see GITHUB_TOKEN below), never a
 * credential a student has access to.
 *
 * SETUP — do this once, before deploying:
 *   1. Create a private GitHub repo for submissions, e.g. "pyclass-submissions".
 *   2. Edit GITHUB_OWNER and GITHUB_REPO below to match it.
 *   3. Generate a fine-grained GitHub Personal Access Token scoped to ONLY
 *      that repo, with ONLY the "Contents" permission (read/write).
 *   4. Store it as a Firebase secret (run this once from a terminal):
 *        firebase functions:secrets:set GITHUB_TOKEN
 *      (paste the token when prompted — it is never written to a file
 *      or committed anywhere, same idea as service-account.json in
 *      pyclass-backup/.)
 *   5. Deploy:
 *        cd functions && npm install
 *        firebase deploy --only functions
 *   6. IMPORTANT: Cloud Functions that call an outside API (GitHub, in
 *      this case) require Firebase's "Blaze" (pay-as-you-go) plan, not
 *      the free "Spark" plan — the free plan blocks all outbound network
 *      calls except to Google's own services. For a class of 12 students
 *      submitting homework, actual usage is far below any billing
 *      threshold, but the Blaze plan does need to be turned on in the
 *      Firebase console first, or every commit attempt will fail.
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

// ------------------------------------------------------------
// EDIT THESE TWO to match the private repo you created in step 1 above.
// ------------------------------------------------------------
const GITHUB_OWNER = "laxmanpedada-ship-it";
const GITHUB_REPO = "Pyclass-Submissions";
const GITHUB_BRANCH = "main";

const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

// Turns free text into a path-safe slug — same idea as slugify() in
// js/student.js, kept separate here since this function doesn't share
// code with the browser app.
function slugify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function githubRequest(path, token, options) {
  const res = await fetch("https://api.github.com" + path, Object.assign({
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  }, options));
  return res;
}

// Looks up the current file's sha, which GitHub's API requires when
// OVERWRITING an existing file (this is how the app does "overwrite on
// resubmit" rather than creating a new file each time). Returns null if
// the file doesn't exist yet (first-ever submission for this assignment).
async function getExistingSha(filePath, token) {
  const res = await githubRequest(
    "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + filePath + "?ref=" + GITHUB_BRANCH,
    token,
    { method: "GET" }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GitHub GET failed: " + res.status + " " + await res.text());
  const json = await res.json();
  return json.sha;
}

async function commitFile(filePath, contentText, commitMessage, token) {
  const sha = await getExistingSha(filePath, token);
  const body = {
    message: commitMessage,
    content: Buffer.from(contentText, "utf8").toString("base64"),
    branch: GITHUB_BRANCH,
    committer: { name: "PyClass Bot", email: "pyclass-bot@users.noreply.github.com" }
  };
  if (sha) body.sha = sha; // present = overwrite; absent = create new file

  const res = await githubRequest(
    "/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + filePath,
    token,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error("GitHub PUT failed: " + res.status + " " + await res.text());
  return res.json();
}

exports.commitToGitHub = onDocumentCreated(
  { document: "submissions/{submissionId}", secrets: [GITHUB_TOKEN] },
  async (event) => {
    const submission = event.data.data();
    const { classCode, studentKey, assignmentId, studentName, code, changeNote } = submission;

    if (!classCode || !studentKey || !assignmentId || typeof code !== "string") {
      logger.warn("Skipping commit — submission is missing a required field", { id: event.params.submissionId });
      return;
    }

    const filePath =
      "submissions/" + slugify(classCode) + "/" + slugify(studentKey) + "/" + slugify(assignmentId) + ".py";

    const commitMessage =
      (studentName || studentKey) + ": " + (changeNote && changeNote.trim() ? changeNote.trim() : "Submitted homework");

    try {
      await commitFile(filePath, code, commitMessage, GITHUB_TOKEN.value());
      logger.info("Committed " + filePath, { message: commitMessage });
    } catch (err) {
      // Logged, not thrown: a GitHub hiccup should never be able to make
      // the student's actual submission (already safely in Firestore)
      // look like it failed. The teacher can re-run this function's logic
      // by hand later if a commit needs retrying — Firestore is always
      // the source of truth, GitHub is a mirror of it.
      logger.error("GitHub commit failed for " + filePath, err);
    }
  }
);
