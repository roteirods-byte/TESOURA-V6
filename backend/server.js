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

  if (Array.isArray(obj.lista)) return obj.lista;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.data && Array.isArray(obj.data.lista)) return obj.data.lista;

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
    apelido: String(r.apelido ?? "").trim(),
    nome: String(r.nome ?? "").trim(),
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
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return m1[2];
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

// ---- JOGADORES via SNAPSHOT (resolve erro 500) ----
function loadJogadoresRaw() {
  const snap = getLatestSnapshot("jogadores");
  const list = extractList(snap);
  return Array.isArray(list) ? list : [];
}

function ensureIds(listNorm) {
  let maxId = 0;
  for (const it of listNorm) {
    const idNum = Number(it.id);
    if (Number.isFinite(idNum) && idNum > maxId) maxId = idNum;
  }
  for (const it of listNorm) {
    if (it.id === null || it.id === undefined || it.id === "") {
      maxId += 1;
      it.id = maxId;
    }
  }
  return listNorm;
}

function loadJogadoresNormalized() {
  const list = loadJogadoresRaw().map(normalizeJogador);
  return ensureIds(list);
}

function saveJogadores(listNorm, createdBy = "system") {
  // salva como snapshot (formato padrão)
  return saveSnapshot("jogadores", { lista: listNorm, meta: { created_by: createdBy } });
}

// --- HEALTH ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "tesoura-api", db: DB_PATH });
});

// --- JOGADORES (GET) ---
app.get("/api/jogadores", (req, res) => {
  try {
    const list = loadJogadoresNormalized();
    res.json(list);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/jogadores/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const list = loadJogadoresNormalized();
    const it = list.find(x => Number(x.id) === id);
    if (!it) return res.status(404).json({ ok: false, error: "Não encontrado" });
    res.json(it);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- JOGADORES (POST/PUT/DELETE) ---
app.post("/api/jogadores", (req, res) => {
  try {
    const j = normalizeJogador(req.body || {});
    if (!j.apelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });

    const list = loadJogadoresNormalized();

    const exists = list.some(x => String(x.apelido).toLowerCase() === String(j.apelido).toLowerCase());
    if (exists) return res.status(400).json({ ok: false, error: "Apelido já existe" });

    // id novo
    let maxId = 0;
    for (const it of list) maxId = Math.max(maxId, Number(it.id) || 0);
    j.id = maxId + 1;

    list.push(j);
    const out = saveJogadores(list, "ui");
    res.json({ ok: true, id: j.id, ref: out.ref });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.put("/api/jogadores/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const patch = normalizeJogador(req.body || {});
    const list = loadJogadoresNormalized();
    const idx = list.findIndex(x => Number(x.id) === id);
    if (idx < 0) return res.status(404).json({ ok: false, error: "Não encontrado" });

    // se mudar apelido, valida duplicidade
    if (patch.apelido) {
      const dup = list.some((x, i) =>
        i !== idx && String(x.apelido).toLowerCase() === String(patch.apelido).toLowerCase()
      );
      if (dup) return res.status(400).json({ ok: false, error: "Apelido já existe" });
    }

    list[idx] = { ...list[idx], ...patch, id };
    const out = saveJogadores(list, "ui");
    res.json({ ok: true, ref: out.ref });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// compat: DELETE /api/jogadores/:id  (ou ?id=)
app.delete("/api/jogadores/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const list = loadJogadoresNormalized();
    const next = list.filter(x => Number(x.id) !== id);
    if (next.length === list.length) return res.status(404).json({ ok: false, error: "Não encontrado" });
    const out = saveJogadores(next, "ui");
    res.json({ ok: true, ref: out.ref });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.delete("/api/jogadores", (req, res) => {
  try {
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Faltou id" });
    const list = loadJogadoresNormalized();
    const next = list.filter(x => Number(x.id) !== id);
    if (next.length === list.length) return res.status(404).json({ ok: false, error: "Não encontrado" });
    const out = saveJogadores(next, "ui");
    res.json({ ok: true, ref: out.ref });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- ANIVERSARIANTES DO MES (usa a lista de jogadores) ---
app.get("/api/aniversariantes", (req, res) => {
  try {
    const now = new Date();
    const mes = String(req.query.mes || (now.getMonth() + 1)).padStart(2, "0");

    const jogadores = loadJogadoresNormalized();

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
