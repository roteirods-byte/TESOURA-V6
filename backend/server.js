'use strict';

const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const { saveSnapshot, listSnapshots, loadSnapshot } = require("./modules/_core/archive");

const app = express();
app.disable("x-powered-by");

// ========= PARSERS (UMA ÚNICA VEZ) =========
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Se algum proxy/cliente mandar body vazio, evita quebra
app.use((req, res, next) => {
  if ((req.method === "POST" || req.method === "PUT" || req.method === "PATCH") && (req.body == null)) {
    req.body = {};
  }
  next();
});

// ========= VERSION (pra provar deploy) =========
app.get("/api/version", (req, res) => {
  res.json({
    ok: true,
    marker: "TESOURA-V6_BACKEND_2026-01-23_FIX_A",
    ts: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

// ========= DB =========
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, "db", "tesoura.sqlite");
const db = new Database(DB_PATH);
