'use strict';

const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const { saveSnapshot, listSnapshots, loadSnapshot } = require("./modules/_core/archive");

const app = express();

// ===== PARSE GARANTIDO (JSON + FORM) =====
app.disable("x-powered-by");

// evita 400 por body vazio / limite de parametros
app.use(express.json({ limit: "2mb", strict: false }));

app.use(express.urlencoded({
  extended: false,
  limit: "2mb",
  parameterLimit: 200000
}));

// fallback: se chegar JSON sem parser (proxy estranho), tenta ler como texto
app.use((req, res, next) => {
  if ((req.method === "POST" || req.method === "PUT") && req.body === undefined) req.body = {};
  next();
});


// ========= PARSERS (OBRIGATÓRIO vir ANTES DAS ROTAS) =========
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/api/version", (req, res) => {
  res.json({
    ok: true,
    marker: "TESOURA-V6_BACKEND_2026-01-23_A",
    now: new Date().toISOString()
  });
});

app.get("/api/version", (req, res) => {
  res.json({
    ok: true,
    app: "TESOURA-V6",
    ts: new Date().toISOString()
  });
});

// Se algum proxy/cliente mandar body vazio, evita quebra
app.use((req, res, next) => {
  if ((req.method === "POST" || req.method === "PUT" || req.method === "PATCH") && req.body == null) {
    req.body = {};
  }
  next();
});

const PORT = process.env.PORT || 3000;

// ========= DB =========
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, "db", "tesoura.sqlite");
const db = new Database(DB_PATH);

// ========= HELPERS =========
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

function pad2(n){ return String(n).padStart(2, "0"); }
function ymd(d){
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

// ========= STATIC (frontend) =========
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use("/", express.static(FRONTEND_DIR));

// ========= ROTAS DE ARQUIVO (snapshots) =========
app.get("/api/arquivo/listar", (req, res) => {
  try {
    const panel = str(req.query.panel).trim();
    if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
    const items = listSnapshots(panel);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/arquivo/carregar", (req, res) => {
  try {
    const panel = str(req.query.panel).trim();
    const ref = str(req.query.ref).trim();
    if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
    if (!ref) return res.status(400).json({ ok: false, error: "Faltou ref" });
    const data = loadSnapshot(panel, ref);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/arquivo/salvar", (req, res) => {
  try {
    const b = req.body || {};
    const panel = str(b.panel).trim();
    const payload = b.data ?? b.payload ?? null;
    if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
    if (payload == null) return res.status(400).json({ ok: false, error: "Faltou data" });
    const ref = saveSnapshot(panel, payload);
    res.json({ ok: true, ref });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// ========= PRESENÇA / ESCALAÇÃO (API) =========
// Observação: mantém seus endpoints exatamente no padrão que o frontend chama.

function parseYMD(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0,0,0,0);
  return d;
}

function getJogadoresAtivos() {
  // ajuste se seu schema for diferente
  const rows = db.prepare(`
    SELECT id, apelido, ativo
    FROM jogadores
    WHERE COALESCE(ativo,1)=1
    ORDER BY apelido COLLATE NOCASE
  `).all();
  return rows;
}

function getPresencas(data_domingo) {
  const rows = db.prepare(`
    SELECT id, ordem, apelido, hora, obs, nao_joga, saiu
    FROM presencas
    WHERE data_domingo=?
    ORDER BY ordem ASC, id ASC
  `).all(data_domingo);
  return rows;
}

function getEscalacao(data_domingo, tempo) {
  const rows = db.prepare(`
    SELECT id, tempo, time, apelido, pos, pontos
    FROM escalacoes
    WHERE data_domingo=? AND tempo=?
    ORDER BY time ASC, pos ASC, id ASC
  `).all(data_domingo, tempo);
  return rows;
}

function getPagoMap(jogadores, data_domingo, now_local) {
  // placeholder seguro: não quebra o painel
  // (se você já tiver a regra de inadimplência, a gente refina depois)
  const map = {};
  (jogadores || []).forEach(j => { map[j.apelido] = 0; });
  return map;
}

function setPresencaChegou(data_domingo, apelido, now_local) {
  // garante ordem sequencial
  const maxOrdem = db.prepare(`SELECT COALESCE(MAX(ordem),0) AS m FROM presencas WHERE data_domingo=?`).get(data_domingo).m || 0;

  // impede duplicado
  const exists = db.prepare(`SELECT 1 FROM presencas WHERE data_domingo=? AND apelido=?`).get(data_domingo, apelido);
  if (exists) throw new Error("jogador já está na lista");

  // hora HH:MM (usa now_local se vier, senão hora atual)
  let hhmm = "";
  const m = String(now_local || "").match(/\b(\d{2}):(\d{2})\b/);
  if (m) hhmm = `${m[1]}:${m[2]}`;
  if (!hhmm) {
    const d = new Date();
    hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  db.prepare(`
    INSERT INTO presencas (data_domingo, ordem, apelido, hora, obs, nao_joga, saiu)
    VALUES (?,?,?,?,?,?,?)
  `).run(data_domingo, maxOrdem + 1, apelido, hhmm, "", 0, 0);
}

// stubs: você já tem suas funções reais no seu server antigo.
// Mantive seguro para não quebrar.
function computeEscalacao1T(data_domingo, now_local) {
  // TODO: sua regra real
  // por enquanto só garante que não explode
  return true;
}
function computeEscalacao2T(data_domingo, now_local) {
  // TODO: sua regra real
  return true;
}

app.get("/api/presenca_escalacao/state", (req, res) => {
  try {
    const data_domingo = str(req.query.data_domingo).trim();
    const now_local = str(req.query.now_local).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });

    const jogadores = getJogadoresAtivos();
    const presencas = getPresencas(data_domingo);
    const escalacao1 = getEscalacao(data_domingo, "1T");
    const escalacao2 = getEscalacao(data_domingo, "2T");
    const pagoMap = getPagoMap(jogadores, data_domingo, now_local);

    res.json({ ok: true, jogadores, presencas, escalacao1, escalacao2, pagoMap });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/chegou", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const apelido = str(b.apelido).trim();
    const now_local = str(b.now_local).trim();
    if (!data_domingo || !apelido) return res.status(400).json({ ok: false, error: "Faltou data_domingo/apelido" });

    setPresencaChegou(data_domingo, apelido, now_local);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/toggle_nao_joga", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const apelido = str(b.apelido).trim();
    const nao_joga = Number(b.nao_joga || 0) === 1 ? 1 : 0;
    if (!data_domingo || !apelido) return res.status(400).json({ ok: false, error: "Faltou data_domingo/apelido" });

    db.prepare("UPDATE presencas SET nao_joga=? WHERE data_domingo=? AND apelido=?").run(nao_joga, data_domingo, apelido);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/toggle_saiu", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const apelido = str(b.apelido).trim();
    const saiu = Number(b.saiu || 0) === 1 ? 1 : 0;
    if (!data_domingo || !apelido) return res.status(400).json({ ok: false, error: "Faltou data_domingo/apelido" });

    db.prepare("UPDATE presencas SET saiu=? WHERE data_domingo=? AND apelido=?").run(saiu, data_domingo, apelido);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/remover", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const apelido = str(b.apelido).trim();
    if (!data_domingo || !apelido) return res.status(400).json({ ok: false, error: "Faltou data_domingo/apelido" });

    db.prepare("DELETE FROM presencas WHERE data_domingo=? AND apelido=?").run(data_domingo, apelido);

    // renumera ORDEM após excluir (corrige seu item 7)
    const rows = db.prepare("SELECT id FROM presencas WHERE data_domingo=? ORDER BY ordem ASC, id ASC").all(data_domingo);
    const up = db.prepare("UPDATE presencas SET ordem=? WHERE id=?");
    let i = 1;
    for (const r of rows) up.run(i++, r.id);

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/limpar", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });

    db.prepare("DELETE FROM presencas WHERE data_domingo=?").run(data_domingo);
    db.prepare("DELETE FROM escalacoes WHERE data_domingo=?").run(data_domingo);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/escalar", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const tempo = str(b.tempo).trim(); // '1T'|'2T'
    const now_local = str(b.now_local).trim();
    if (!data_domingo || (tempo !== "1T" && tempo !== "2T")) return res.status(400).json({ ok: false, error: "Faltou data_domingo/tempo" });

    if (tempo === "1T") computeEscalacao1T(data_domingo, now_local);
    else computeEscalacao2T(data_domingo, now_local);

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/desfazer", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const tempo = str(b.tempo).trim();
    if (!data_domingo || (tempo !== "1T" && tempo !== "2T")) return res.status(400).json({ ok: false, error: "Faltou data_domingo/tempo" });

    db.prepare("DELETE FROM escalacoes WHERE data_domingo=? AND tempo=?").run(data_domingo, tempo);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/salvar", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// ========= HEALTH =========
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log("TESOURA backend OK na porta", PORT, "DB:", DB_PATH);
});
