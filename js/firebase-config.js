// ============================================================
// FIREBASE CONFIGURATION
// ------------------------------------------------------------
// Replace the values below with the ones from YOUR Firebase
// project. Step-by-step instructions are in SETUP.md.
// This file is safe to be public - these are not secret keys,
// they just tell the app which Firebase project to talk to.
// Access is controlled separately by firestore.rules.
// ============================================================
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_AUTH_DOMAIN_HERE",
  projectId: "PASTE_PROJECT_ID_HERE",
  storageBucket: "PASTE_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_SENDER_ID_HERE",
  appId: "PASTE_APP_ID_HERE"
};

// A secret word only you (the teacher) know. The first time you
// log in with your teacher email, you'll be asked for this code
// to prove you're the teacher. Change this to your own secret
// before you publish the site, then keep it private.
window.TEACHER_SETUP_CODE = "venkateswara21";

// The class code you give to your 15 students. You can create
// more class codes later from the teacher dashboard.
window.DEFAULT_CLASS_CODE = "SRIKAKULAM1";
