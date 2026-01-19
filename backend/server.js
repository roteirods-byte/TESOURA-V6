const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

// snapshots (tabela files)
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
app.use(express.json({ limit: "5mb" }));

// --- DB (SQLite) ---
const DB_PATH = process.env.TESOURA_DB_PATH || path.join(__dirname, "db", "tesoura.sqlite");
const db = new Database(DB_PATH);

// garante tabela files (para snapshots)
db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel TEXT,
  period_type TEXT,
  period_key TEXT,
  version INTEGER DEFAULT 1,
  data_json TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// helpers
function tableExists(name) {
  try {
    const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!r;
  } catch {
    return false;
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// tenta extrair uma LISTA de dentro do snapshot
function extractList(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;

  // formatos comuns
  if (Array.isArray(obj.lista)) return obj.lista;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.data && Array.isArray(obj.data.lista)) return obj.data.lista;

  // fallback: nenhum formato conhecido
  return [];
}

// pega o ultimo snapshot (files) de um painel
function getLatestSnapshot(panel) {
  if (!tableExists("files")) return null;
  const row = db
    .prepare("SELECT data_json FROM files WHERE panel=? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(panel);
  if (!row || !row.data_json) return null;
  return safeJsonParse(row.data_json);
}

// normaliza jogador no formato que o painel espera
function normalizeJogador(x) {
  const r = x || {};
  return {
    id: r.id ?? null,
    camisa: r.camisa ?? null,
    apelido: r.apelido ?? "",
    nome: r.nome ?? "",
    celular: r.celular ?? "",
    posicao: r.posicao ?? "",
    hab: r.hab ?? r.habilidade ?? null,
    vel: r.vel ?? r.velocidade ?? null,
    mov: r.mov ?? r.movimentacao ?? null,
    pontos: r.pontos ?? 0,
    nascimento: r.nascimento ?? r.data_nasc ?? r.data_nascimento ?? "",
    ativo: r.ativo ?? 1,
    created_at: r.created_at ?? r.criado_em ?? ""
  };
}

// parse nascimento em 2 formatos: YYYY-MM-DD ou DD/MM/YYYY
function getMonthFromDateStr(s) {
  if (!s || typeof s !== "string") return "";
  const t = s.trim();
  // YYYY-MM-DD
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return m1[2];
  // DD/MM/YYYY
  const m2 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return m2[2];
  return "";
}

function getDayFromDateStr(s) {
  if (!s || typeof s !== "string") return "";
  const t = s.trim();
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return m1[3];
  const m2 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return m2[1];
  return "";
}

// --- HEALTH ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "tesoura-api", db: DB_PATH });
});

// --- JOGADORES: PRIORIDADE = snapshot files, fallback = tabela jogadores ---
app.get("/api/jogadores", (req, res) => {
  try {
    const snap = getLatestSnapshot("jogadores");
    const list = extractList(snap);

    if (list.length > 0) {
      return res.json(list.map(normalizeJogador));
    }

    // fallback antigo
    if (tableExists("jogadores")) {
      const rows = db.prepare("SELECT * FROM jogadores ORDER BY apelido COLLATE NOCASE").all();
      return res.json(rows.map(normalizeJogador));
    }

    return res.json([]);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- JOGADORES CRUD (para bater com o frontend) ---
db.exec(`
CREATE TABLE IF NOT EXISTS jogadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camisa TEXT,
  apelido TEXT,
  nome TEXT,
  celular TEXT,
  posicao TEXT,
  hab INTEGER,
  vel INTEGER,
  mov INTEGER,
  pontos INTEGER DEFAULT 0,
  nascimento TEXT,
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
`);

function normBodyJogador(b) {
  const x = b || {};
  return {
    camisa: (x.camisa ?? null),
    apelido: String(x.apelido || "").trim(),
    nome: String(x.nome || "").trim(),
    celular: String(x.celular || "").trim(),
    posicao: String(x.posicao || "").trim(),
    hab: (x.hab ?? x.habilidade ?? null),
    vel: (x.vel ?? x.velocidade ?? null),
    mov: (x.mov ?? x.movimentacao ?? null),
    pontos: Number.isFinite(+x.pontos) ? +x.pontos : 0,
    nascimento: String(x.nascimento || x.data_nasc || x.data_nascimento || "").trim(),
    ativo: (x.ativo === 0 || x.ativo === false) ? 0 : 1,
  };
}

function apelidoConflita(apelido, ignoreId) {
  if (!apelido) return false;
  const row = db.prepare(
    "SELECT id FROM jogadores WHERE LOWER(apelido)=LOWER(?) AND id<>? LIMIT 1"
  ).get(apelido, Number(ignoreId || 0));
  return !!row;
}

app.get("/api/jogadores/:id", (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const row = db.prepare("SELECT * FROM jogadores WHERE id=?").get(id);
    if (!row) return res.status(404).json({ ok:false, error:"Não encontrado" });
    res.json(normalizeJogador(row));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.post("/api/jogadores", (req, res) => {
  try {
    const j = normBodyJogador(req.body);
    if (!j.apelido) return res.status(400).json({ ok:false, error:"Faltou apelido" });
    if (apelidoConflita(j.apelido, 0)) return res.status(409).json({ ok:false, error:"Apelido já existe" });

    const st = db.prepare(`
      INSERT INTO jogadores (camisa, apelido, nome, celular, posicao, hab, vel, mov, pontos, nascimento, ativo)
      VALUES (@camisa, @apelido, @nome, @celular, @posicao, @hab, @vel, @mov, @pontos, @nascimento, @ativo)
    `);
    const out = st.run(j);
    res.json({ ok:true, id: out.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.put("/api/jogadores/:id", (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const exists = db.prepare("SELECT id FROM jogadores WHERE id=?").get(id);
    if (!exists) return res.status(404).json({ ok:false, error:"Não encontrado" });

    const j = normBodyJogador(req.body);
    if (!j.apelido) return res.status(400).json({ ok:false, error:"Faltou apelido" });
    if (apelidoConflita(j.apelido, id)) return res.status(409).json({ ok:false, error:"Apelido já existe" });

    db.prepare(`
      UPDATE jogadores SET
        camisa=@camisa, apelido=@apelido, nome=@nome, celular=@celular, posicao=@posicao,
        hab=@hab, vel=@vel, mov=@mov, pontos=@pontos, nascimento=@nascimento, ativo=@ativo,
        updated_at=datetime('now')
      WHERE id=@id
    `).run({ ...j, id });

    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

app.delete("/api/jogadores/:id", (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    db.prepare("DELETE FROM jogadores WHERE id=?").run(id);
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

// fallback do frontend: DELETE /api/jogadores?id=123
app.delete("/api/jogadores", (req, res) => {
  try {
    const id = Number(req.query.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:"Faltou id" });
    db.prepare("DELETE FROM jogadores WHERE id=?").run(id);
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

// --- ANIVERSARIANTES DO MES (usa a lista de jogadores) ---
app.get("/api/aniversariantes", (req, res) => {
  try {
    const now = new Date();
    const mes = String(req.query.mes || (now.getMonth() + 1)).padStart(2, "0");

    // pega jogadores do snapshot (ou fallback)
    const snap = getLatestSnapshot("jogadores");
    const list = extractList(snap);
    const jogadores = (list.length > 0)
      ? list.map(normalizeJogador)
      : (tableExists("jogadores") ? db.prepare("SELECT * FROM jogadores").all().map(normalizeJogador) : []);

    const out = jogadores
      .filter(j => getMonthFromDateStr(j.nascimento) === mes)
      .sort((a,b) => {
        const da = getDayFromDateStr(a.nascimento) || "99";
        const dbb = getDayFromDateStr(b.nascimento) || "99";
        if (da !== dbb) return da.localeCompare(dbb);
        return String(a.apelido||"").localeCompare(String(b.apelido||""), "pt-BR");
      })
      .map(j => ({ apelido: j.apelido, nome: j.nome, nascimento: j.nascimento }));

    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- OUTROS PAINEIS (lê snapshots) ---
function endpointFromSnapshot(panel) {
  return (req, res) => {
    try {
      const snap = getLatestSnapshot(panel);
      const list = extractList(snap);
      res.json(list);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  };
}

app.get("/api/gols", endpointFromSnapshot("gols"));
app.get("/api/mensalidades", endpointFromSnapshot("mensalidade"));
app.get("/api/caixa", endpointFromSnapshot("caixa"));

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
