import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyApDC5gx8U4uzyHa9AFPkF_qFTbYG-rHA4",
  authDomain: "autotrader-producao.firebaseapp.com",
  projectId: "autotrader-producao",
  storageBucket: "autotrader-producao.firebasestorage.app",
  messagingSenderId: "988675605286",
  appId: "1:988675605286:web:63811665d23185031ef7e7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// disponibiliza TUDO no root (sem "fs")
window.__TESOURA_FIREBASE__ = { app, auth, db, doc, setDoc, getDoc, serverTimestamp };

signInAnonymously(auth).catch((e) => console.error("AUTH anon fail:", e));
onAuthStateChanged(auth, (user) => console.log("AUTH user:", user ? user.uid : null));
