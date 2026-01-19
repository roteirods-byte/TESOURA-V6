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
  "gols",
]);

function mustBeAllowedPanel(panel) {
  return ALLOWED_PANELS.has(panel);
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toIntOrZero(v) {
  const n = toIntOrNull(v);
  return n === null ? 0 : n;
}

function str(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// --- DB (SQLite) ---
const DB_PATH = process.env.TESOURA_DB_PATH || path.join(__dirname, "db", "tesoura.sqlite");
const db = new Database(DB_PATH);

// --- ESQUEMA CANÔNICO (NÃO DESTRÓI DADOS) ---
db.exec(`
CREATE TABLE IF NOT EXISTS jogadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apelido TEXT UNIQUE NOT NULL,
  nome TEXT DEFAULT "",
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  camisa INTEGER,
  celular TEXT DEFAULT '',
  posicao TEXT DEFAULT '',
  hab INTEGER,
  vel INTEGER,
  mov INTEGER,
  pontos INTEGER DEFAULT 0,
  nascimento TEXT DEFAULT ''
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

// --- JOGADORES (CONTRATO FIXO + COMPAT) ---
app.get("/api/jogadores", (req, res) => {
  const rows = db.prepare("SELECT * FROM jogadores ORDER BY apelido COLLATE NOCASE").all();
  res.json(rows);
});

// Salvar (cria ou atualiza por apelido)
app.post("/api/jogadores", (req, res) => {
  try {
    const j = req.body || {};

    const apelido = str(j.apelido).trim();
    if (!apelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });

    // Compat: aceita nomes antigos e do front
    const nome = str(pick(j, ["nome"])).trim();
    const camisa = toIntOrNull(pick(j, ["camisa"]));
    const celular = str(pick(j, ["celular"])).trim();
    const posicao = str(pick(j, ["posicao"])).trim();

    const hab = toIntOrNull(pick(j, ["hab", "habilidade"]));
    const vel = toIntOrNull(pick(j, ["vel", "velocidade"]));
    const mov = toIntOrNull(pick(j, ["mov", "movimentacao"]));
    const pontos = toIntOrZero(pick(j, ["pontos", "ponto"]));

    const nascimento = str(pick(j, ["nascimento", "data_nasc", "nasc"])).trim();

    const exists = db.prepare("SELECT id FROM jogadores WHERE apelido=?").get(apelido);

    if (exists) {
      db.prepare(`
        UPDATE jogadores
           SET camisa=@camisa,
               nome=@nome,
               celular=@celular,
               posicao=@posicao,
               hab=@hab,
               vel=@vel,
               mov=@mov,
               pontos=@pontos,
               nascimento=@nascimento
         WHERE apelido=@apelido
      `).run({ apelido, camisa, nome, celular, posicao, hab, vel, mov, pontos, nascimento });

      return res.json({ ok: true, mode: "update", apelido });
    }

    const info = db.prepare(`
      INSERT INTO jogadores (apelido,nome,camisa,celular,posicao,hab,vel,mov,pontos,nascimento,ativo,created_at)
      VALUES (@apelido,@nome,@camisa,@celular,@posicao,@hab,@vel,@mov,@pontos,@nascimento,1,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).run({ apelido, nome, camisa, celular, posicao, hab, vel, mov, pontos, nascimento });

    return res.json({ ok: true, mode: "insert", id: info.lastInsertRowid, apelido });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// Excluir por apelido (se o painel usar)
app.delete("/api/jogadores/:apelido", (req, res) => {
  try {
    const apelido = str(req.params.apelido).trim();
    if (!apelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });
    const info = db.prepare("DELETE FROM jogadores WHERE apelido=?").run(apelido);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// --- PRESENÇAS (base) ---
app.get("/api/presencas", (req, res) => {
  const data_domingo = req.query.data_domingo || "";
  const rows = db.prepare("SELECT * FROM presencas WHERE data_domingo=? ORDER BY hora_chegada").all(data_domingo);
  res.json(rows);
});

// --- HISTÓRICO (por painel) ---
app.post("/api/:panel/salvar", (req, res) => {
  const panel = String(req.params.panel || "").trim();
  if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
  const payload = req.body || {};
  const out = saveSnapshot(panel, payload);
  res.json({ ok: true, ref: out.ref });
});

app.get("/api/:panel/historico", (req, res) => {
  const panel = String(req.params.panel || "").trim();
  if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
  const items = listSnapshots(panel);
  res.json({ ok: true, items });
});

app.get("/api/:panel/carregar", (req, res) => {
  const panel = String(req.params.panel || "").trim();
  const ref = String(req.query.ref || "").trim();
  if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
  if (!ref) return res.status(400).json({ ok: false, error: "Faltou ref" });
  const data = loadSnapshot(panel, ref);
  if (!data) return res.status(404).json({ ok: false, error: "Não encontrado" });
  res.json({ ok: true, data });
});

// --- start ---
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TESOURA API rodando na porta ${PORT}`);
});
