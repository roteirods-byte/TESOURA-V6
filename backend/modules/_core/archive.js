const fs = require("fs");
const path = require("path");

// Pasta de arquivos arquivados (interno)
const ARCHIVE_DIR = process.env.TESOURA_ARCHIVE_DIR || path.join(__dirname, "..", "..", "archive");

// garante pasta
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function panelDir(panel) {
  const dir = path.join(ARCHIVE_DIR, panel);
  ensureDir(dir);
  return dir;
}

// salva “estado” do painel como JSON (para histórico)
function saveSnapshot(panel, snapshotObj) {
  const dir = panelDir(panel);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); // 2026-01-14T23-06-00-000Z
  const file = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshotObj, null, 2), "utf-8");
  return { ok: true, ref: path.basename(file, ".json"), file };
}

// lista arquivos do histórico
function listSnapshots(panel) {
  const dir = panelDir(panel);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().reverse();
  return files.map(f => ({
    ref: f.replace(".json", ""),
    file: f
  }));
}

// lê snapshot por ref
function loadSnapshot(panel, ref) {
  const dir = panelDir(panel);
  const file = path.join(dir, `${ref}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

module.exports = { saveSnapshot, listSnapshots, loadSnapshot, ARCHIVE_DIR };
