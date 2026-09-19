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
  apiKey: "AIzaSyBsVDwpUFAyKojO5EmJB3ynxu1HcZtpZFg",
  authDomain: "srikakulam-pyclass.firebaseapp.com",
  projectId: "srikakulam-pyclass",
  storageBucket: "srikakulam-pyclass.firebasestorage.app",
  messagingSenderId: "729460955849",
  appId: "1:729460955849:web:f4543c902506d416a58b18"
};

// A secret word only you (the teacher) know. The first time you
// log in with your teacher email, you'll be asked for this code
// to prove you're the teacher. Change this to your own secret
// before you publish the site, then keep it private.
window.TEACHER_SETUP_CODE = "venkateswara21";

// The class code you give to your 15 students. You can create
// more class codes later from the teacher dashboard.
window.DEFAULT_CLASS_CODE = "SRIKAKULAM1";
