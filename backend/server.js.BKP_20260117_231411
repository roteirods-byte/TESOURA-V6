const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const { saveSnapshot, listSnapshots, loadSnapshot } = require("./modules/_core/archive");

const ALLOWED_PANELS = new Set([
  "jogadores",
  "presenca_escalacao",
  "controle_geral",
  "mensalidade",
  "caixa",
  "gols"
]);

function mustBeAllowedPanel(panel) {
  return ALLOWED_PANELS.has(panel);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// --- DB (SQLite) ---
const DB_PATH =
  process.env.TESOURA_DB_PATH || path.join(__dirname, "db", "tesoura.sqlite");
const db = new Database(DB_PATH);

// --- cria tabelas mínimas ---
db.exec(`
CREATE TABLE IF NOT EXISTS jogadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camisa INTEGER,
  nome TEXT,
  apelido TEXT UNIQUE,
  celular TEXT,
  posicao TEXT,
  habilidade INTEGER,
  velocidade INTEGER,
  movimentacao INTEGER,
  data_nasc TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS presencas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_domingo TEXT,
  apelido TEXT,
  hora_chegada TEXT,
  saiu INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mensalidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mes TEXT,
  apelido TEXT,
  pago INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS caixa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT,
  tipo TEXT,
  descricao TEXT,
  valor REAL,
  origem TEXT
);

CREATE TABLE IF NOT EXISTS gols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ano TEXT,
  apelido TEXT,
  gols INTEGER DEFAULT 0
);
`);

// --- HEALTH ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "tesoura-api", db: DB_PATH });
});

// --- JOGADORES (contrato fixo) ---
app.get("/api/jogadores", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM jogadores ORDER BY apelido COLLATE NOCASE")
    .all();
  res.json(rows);
});

app.post("/api/jogadores", (req, res) => {
  const j = req.body || {};
  const stmt = db.prepare(`
    INSERT INTO jogadores (camisa,nome,apelido,celular,posicao,habilidade,velocidade,movimentacao,data_nasc,atualizado_em)
    VALUES (@camisa,@nome,@apelido,@celular,@posicao,@habilidade,@velocidade,@movimentacao,@data_nasc,datetime('now'))
  `);

  try {
    const info = stmt.run({
      camisa: j.camisa ?? null,
      nome: j.nome ?? "",
      apelido: j.apelido ?? "",
      celular: j.celular ?? "",
      posicao: j.posicao ?? "",
      habilidade: j.habilidade ?? null,
      velocidade: j.velocidade ?? null,
      movimentacao: j.movimentacao ?? null,
      data_nasc: j.data_nasc ?? ""
    });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// --- PRESENÇAS (base) ---
app.get("/api/presencas", (req, res) => {
  const data_domingo = req.query.data_domingo || "";
  const rows = db
    .prepare("SELECT * FROM presencas WHERE data_domingo=? ORDER BY hora_chegada")
    .all(data_domingo);
  res.json(rows);
});
// --- HISTÓRICO (por painel) ---
// Salvar snapshot do estado atual (JSON)
app.post("/api/:panel/salvar", (req, res) => {
  const panel = String(req.params.panel || "").trim();
  if (!mustBeAllowedPanel(panel)) {
    return res.status(400).json({ ok: false, error: "Painel inválido" });
  }
  const payload = req.body || {};
  const out = saveSnapshot(panel, payload);
  res.json({ ok: true, ref: out.ref });
});

// Listar snapshots anteriores (para o filtro do painel)
app.get("/api/:panel/historico", (req, res) => {
  const panel = String(req.params.panel || "").trim();
  if (!mustBeAllowedPanel(panel)) {
    return res.status(400).json({ ok: false, error: "Painel inválido" });
  }
  const items = listSnapshots(panel);
  res.json({ ok: true, items });
});

// Carregar snapshot anterior (por ref)
app.get("/api/:panel/carregar", (req, res) => {
  const panel = String(req.params.panel || "").trim();
  const ref = String(req.query.ref || "").trim();
  if (!mustBeAllowedPanel(panel)) {
    return res.status(400).json({ ok: false, error: "Painel inválido" });
  }
  if (!ref) {
    return res.status(400).json({ ok: false, error: "Faltou ref" });
  }
  const data = loadSnapshot(panel, ref);
  if (!data) return res.status(404).json({ ok: false, error: "Não encontrado" });
  res.json({ ok: true, data });
});

// --- start ---
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TESOURA API rodando na porta ${PORT}`);
});
