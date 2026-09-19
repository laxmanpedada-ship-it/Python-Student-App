# Setting up your Python class app

This gets your app online for free, in about 20 minutes. You'll do two things:
create a free **Firebase** project (this is the "database" that remembers
students, homework and grades), then put the files on **GitHub Pages**
(free website hosting). Do them in this order.

---

## Part 1 — Create your Firebase project (~10 min)

1. Go to https://console.firebase.google.com and sign in with your Google
   account (laxman.pedada@gmail.com works fine).
2. Click **Add project**. Name it something like `srikakulam-pyclass`.
   You can turn off Google Analytics for this project — you don't need it.
3. Once the project opens, click the **</> (Web)** icon to add a web app.
   Give it any nickname, e.g. "PyClass". Click **Register app**.
4. Firebase will show you a code block that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "srikakulam-pyclass.firebaseapp.com",
     projectId: "srikakulam-pyclass",
     storageBucket: "srikakulam-pyclass.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   Copy these six values into `js/firebase-config.js` in this folder,
   replacing the `PASTE_..._HERE` placeholders. Save the file.
5. In the left sidebar, click **Build → Authentication → Get started**.
   - Click **Sign-in method**, enable **Email/Password** (for you, the
     teacher), and enable **Anonymous** (for students — they don't need
     passwords, just a name and class code).
6. In the left sidebar, click **Build → Firestore Database → Create
   database**. Choose a location close to India (e.g. `asia-south1`
   Mumbai), and start in **production mode**.
7. Click the **Rules** tab at the top of the Firestore page. Delete
   everything there and paste in the entire contents of `firestore.rules`
   from this folder. Click **Publish**.
8. Open `js/firebase-config.js` again and change
   `TEACHER_SETUP_CODE` to your own secret word — then open
   `firestore.rules`, find the same word (`venkateswara21`) inside the
   `teachers` section, and change it to match. **These two must be
   identical**, or you won't be able to create your teacher account.
   Re-paste the updated rules into the Firebase Rules tab and Publish again.

That's it for Firebase — it's completely free at this scale (15 students
is far below any free-tier limit).

---

## Part 2 — Put the app online with GitHub Pages (~10 min)

1. Go to https://github.com and create a free account if you don't have
   one.
2. Click the **+** in the top right → **New repository**. Name it
   `pyclass` (any name works), keep it **Public**, and click
   **Create repository**.
3. On the new repository's page, click **uploading an existing file**
   (or drag-and-drop). Upload **every file and folder** from this
   `pyclass` folder, keeping the same names and folder structure
   (`css/`, `js/`, `icons/`, plus the `.html`, `.json`, `.js`, `.rules`,
   `.md` files at the top level). Commit the upload.
4. In the repository, click **Settings → Pages** (left sidebar).
   Under "Build and deployment", set **Source** to "Deploy from a
   branch", branch **main**, folder **/ (root)**. Click **Save**.
5. Wait about a minute, then refresh the page — GitHub will show your
   site's address, something like:
   `https://laxman-pedada.github.io/pyclass/`
   That's the link for your students and for you (as teacher).

---

## Part 3 — Try it yourself

1. Open the link above. Tap **"I am the Teacher"**, then **"First time?
   Create teacher account"**. Enter any email/password you'll remember
   and your secret setup code. This creates your one teacher account.
2. On the dashboard, create a class (e.g. name "Batch 1", code
   `SRIKAKULAM1`) and post one homework assignment.
3. Open the link again in a private/incognito tab (or on your phone),
   tap **"I am a Student"**, enter a test name and the class code you
   just made, and try running and submitting some code.
4. Go back to your teacher tab, refresh, open that homework's
   submissions, and you should see the test submission — give it a
   score and feedback to confirm it saves.

## Giving it to students

- Share the site link with parents over WhatsApp, along with the class
  code (e.g. `SRIKAKULAM1`) and your students' scheduled time.
- On the phone, opening the link and choosing **"Add to Home Screen"**
  from the browser menu puts a proper app icon on the phone that opens
  straight into the class — no browser address bar needed afterward.
- The first time a phone runs code, it downloads the Python engine
  (a few MB) — after that it's cached on the phone and loads fast even
  offline. Submitting homework and seeing grades still needs a working
  mobile data connection.
- A small Bluetooth/USB keyboard paired to the phone works normally
  with the on-screen text box. For projecting onto a wall, an HDMI
  adapter cable for the phone, or a screen-mirroring app/Chromecast/Mi
  TV stick, both work with this site like any other web page.

## If something breaks

Come back and tell me what happened — screenshots of any error help.
Common things:
- "Missing or insufficient permissions" → the Firestore rules weren't
  pasted/published correctly, or the setup codes don't match.
- Site loads but "I am the Teacher" signup fails → double check the
  setup code matches exactly (it's case-sensitive) in both files.
- Nothing loads at all on GitHub Pages → check Settings → Pages shows
  a green "Your site is live at..." message; it can take a minute after
  the first upload.

## Changing lessons or homework later

- To add or edit the quick-reference lessons students see, edit
  `js/lessons.js` (plain text, no coding tools needed) and re-upload
  that one file to GitHub.
- Homework assignments don't need file edits — post them from the
  teacher dashboard any time.
