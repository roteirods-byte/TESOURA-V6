'use strict';

const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const { saveSnapshot, listSnapshots, loadSnapshot } = require("./modules/_core/archive");
const { htmlToPdfBuffer } = require("./modules/_core/pdf");

const app = express();
app.disable("x-powered-by");

// ===== PARSE ÚNICO (SEM DUPLICAR) =====
app.use(cors());
app.use(express.json({ limit: "2mb", strict: false }));
app.use(express.urlencoded({ extended: false, limit: "2mb", parameterLimit: 200000 }));
app.use((req, res, next) => {
  if ((req.method === "POST" || req.method === "PUT" || req.method === "PATCH") && (req.body == null || typeof req.body !== "object")) {
    req.body = {};
  }
  next();
});

// ===== VERSION (obrigatório existir) =====
app.get("/api/version", (req, res) => {
  res.json({
    ok: true,
    marker: "TESOURA-V6_BACKEND_2026-01-23_FIX_DB_SCHEMA",
    now: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 8080;

// ========= DB (CORRETO: usa TESOURA_DB_PATH do service) =========
const DB_PATH =
  process.env.TESOURA_DB_PATH ||
  process.env.SQLITE_PATH ||
  path.join(__dirname, "db", "tesoura.sqlite");

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
function mustBeAllowedPanel(panel) { return ALLOWED_PANELS.has(panel); }
function str(v) { return (v === null || v === undefined) ? "" : String(v); }
function pad2(n){ return String(n).padStart(2, "0"); }

function tableColumns(tableName) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set(rows.map(r => String(r.name)));
  } catch {
    return new Set();
  }
}
function pickCol(colsSet, candidates) {
  for (const c of candidates) if (colsSet.has(c)) return c;
  return null;
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
    const payload = (b.data !== undefined) ? b.data : ((b.payload !== undefined) ? b.payload : null);
    if (!mustBeAllowedPanel(panel)) return res.status(400).json({ ok: false, error: "Painel inválido" });
    if (payload == null) return res.status(400).json({ ok: false, error: "Faltou data" });
    const ref = saveSnapshot(panel, payload);
    res.json({ ok: true, ref });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// ========= PRESENÇA / ESCALAÇÃO =========
function detectJogadoresSchema() {
  const cols = tableColumns("jogadores");
  const idCol = pickCol(cols, ["id"]);
  const apelidoCol = pickCol(cols, ["apelido", "nome"]);
  const posCol = pickCol(cols, ["posicao", "pos", "posição"]);
  const pontosCol = pickCol(cols, ["pontos", "pontuacao", "pontuação"]);
  const ativoCol = pickCol(cols, ["ativo", "is_ativo", "status"]);
  return { idCol, apelidoCol, posCol, pontosCol, ativoCol };
}

function getJogadoresAtivos() {
  const sch = detectJogadoresSchema();
  if (!sch.idCol || !sch.apelidoCol) throw new Error("Tabela jogadores sem colunas mínimas (id + apelido/nome).");

  const selPos = sch.posCol ? sch.posCol : "''";
  const selPontos = sch.pontosCol ? sch.pontosCol : "NULL";

  let where = "1=1";
  if (sch.ativoCol) where = `COALESCE(${sch.ativoCol},1)=1`;

  const sql = `
    SELECT
      ${sch.idCol} AS id,
      ${sch.apelidoCol} AS apelido,
      ${selPos} AS posicao,
      ${selPontos} AS pontos
    FROM jogadores
    WHERE ${where}
    ORDER BY apelido COLLATE NOCASE
  `;
  return db.prepare(sql).all();
}

function detectPresencasSchema() {
  const cols = tableColumns("presencas");
  return {
    idCol: pickCol(cols, ["id"]),
    dataCol: pickCol(cols, ["data_domingo", "data", "domingo"]),
    ordemCol: pickCol(cols, ["ordem", "ord"]),
    apelidoCol: pickCol(cols, ["apelido", "nome"]),
    horaCol: pickCol(cols, ["hora", "horario", "hhmm"]),
    obsCol: pickCol(cols, ["obs", "observacao", "observações", "observacao_texto"]),
    naoJogaCol: pickCol(cols, ["nao_joga", "nao_vai_jogar", "nao_jogar", "naojoga"]),
    saiuCol: pickCol(cols, ["saiu", "saiu_1t", "saiu1t"])
  };
}

function getPresencas(data_domingo) {
  const s = detectPresencasSchema();
  if (!s.dataCol || !s.apelidoCol) throw new Error("Tabela presencas sem colunas mínimas (data_domingo + apelido/nome).");

  const selId = s.idCol ? s.idCol : "NULL";
  const selOrdem = s.ordemCol ? s.ordemCol : "0";
  const selHora = s.horaCol ? s.horaCol : "''";
  const selObs = s.obsCol ? s.obsCol : "''";
  const selNao = s.naoJogaCol ? s.naoJogaCol : "0";
  const selSaiu = s.saiuCol ? s.saiuCol : "0";

  const sql = `
    SELECT
      ${selId} AS id,
      ${selOrdem} AS ordem,
      ${s.apelidoCol} AS apelido,
      ${selHora} AS hora,
      ${selObs} AS obs,
      ${selNao} AS nao_joga,
      ${selSaiu} AS saiu
    FROM presencas
    WHERE ${s.dataCol}=?
    ORDER BY ordem ASC, id ASC
  `;
  return db.prepare(sql).all(data_domingo);
}

function detectEscalacoesSchema() {
  const cols = tableColumns("escalacoes");
  return {
    idCol: pickCol(cols, ["id"]),
    dataCol: pickCol(cols, ["data_domingo", "data", "domingo"]),
    tempoCol: pickCol(cols, ["tempo"]),
    timeCol: pickCol(cols, ["time", "equipe"]),
    apelidoCol: pickCol(cols, ["apelido", "nome"]),
    posCol: pickCol(cols, ["pos", "posicao", "posição"]),
    pontosCol: pickCol(cols, ["pontos", "pontuacao", "pontuação"])
  };
}

function getEscalacao(data_domingo, tempo) {
  const s = detectEscalacoesSchema();
  if (!s.dataCol || !s.tempoCol) return []; // se não existir, não quebra

  const selId = s.idCol ? s.idCol : "NULL";
  const selTime = s.timeCol ? s.timeCol : "''";
  const selApelido = s.apelidoCol ? s.apelidoCol : "''";
  const selPos = s.posCol ? s.posCol : "''";
  const selPontos = s.pontosCol ? s.pontosCol : "NULL";

  const sql = `
    SELECT
      ${selId} AS id,
      ${s.tempoCol} AS tempo,
      ${selTime} AS time,
      ${selApelido} AS apelido,
      ${selPos} AS pos,
      ${selPontos} AS pontos
    FROM escalacoes
    WHERE ${s.dataCol}=? AND ${s.tempoCol}=?
    ORDER BY time ASC, pos ASC, id ASC
  `;
  return db.prepare(sql).all(data_domingo, tempo);
}

function getPagoMap(jogadores) {
  const map = {};
  (jogadores || []).forEach(j => { map[j.apelido] = "red"; });
  return map;
}

function setPresencaChegou(data_domingo, apelido, now_local) {
  const s = detectPresencasSchema();
  if (!s.dataCol || !s.apelidoCol) throw new Error("Tabela presencas incompatível (sem data_domingo/apelido).");

  // pega max ordem
  let maxOrdem = 0;
  if (s.ordemCol) {
    maxOrdem = db.prepare(`SELECT COALESCE(MAX(${s.ordemCol}),0) AS m FROM presencas WHERE ${s.dataCol}=?`).get(data_domingo).m || 0;
  }

  // impede duplicado
  const exists = db.prepare(`SELECT 1 FROM presencas WHERE ${s.dataCol}=? AND ${s.apelidoCol}=?`).get(data_domingo, apelido);
  if (exists) throw new Error("jogador já está na lista");

  // hora HH:MM
  let hhmm = "";
  const m = String(now_local || "").match(/\b(\d{2}):(\d{2})\b/);
  if (m) hhmm = `${m[1]}:${m[2]}`;
  if (!hhmm) {
    const d = new Date();
    hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // monta insert só com colunas que existem
  const cols = [];
  const vals = [];
  const qs = [];

  cols.push(s.dataCol); vals.push(data_domingo); qs.push("?");
  cols.push(s.apelidoCol); vals.push(apelido); qs.push("?");

  if (s.ordemCol) { cols.push(s.ordemCol); vals.push(maxOrdem + 1); qs.push("?"); }
  if (s.horaCol) { cols.push(s.horaCol); vals.push(hhmm); qs.push("?"); }
  if (s.obsCol) { cols.push(s.obsCol); vals.push(""); qs.push("?"); }
  if (s.naoJogaCol) { cols.push(s.naoJogaCol); vals.push(0); qs.push("?"); }
  if (s.saiuCol) { cols.push(s.saiuCol); vals.push(0); qs.push("?"); }

  const sql = `INSERT INTO presencas (${cols.join(",")}) VALUES (${qs.join(",")})`;
  db.prepare(sql).run(...vals);
}

// stubs seguros
function computeEscalacao1T() { return true; }
function computeEscalacao2T() { return true; }

app.get("/api/presenca_escalacao/state", (req, res) => {
  try {
    const data_domingo = str(req.query.data_domingo).trim();
    const now_local = str(req.query.now_local).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });

    const jogadores = getJogadoresAtivos();
    const presencas = getPresencas(data_domingo);
    const escalacao1 = getEscalacao(data_domingo, "1T");
    const escalacao2 = getEscalacao(data_domingo, "2T");
    const pagoMap = getPagoMap(jogadores);

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

app.post("/api/presenca_escalacao/limpar", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });

    const p = detectPresencasSchema();
    const e = detectEscalacoesSchema();
    if (p.dataCol) db.prepare(`DELETE FROM presencas WHERE ${p.dataCol}=?`).run(data_domingo);
    if (e.dataCol) db.prepare(`DELETE FROM escalacoes WHERE ${e.dataCol}=?`).run(data_domingo);

    res.json({ ok: true });
  } catch (er) {
    res.status(400).json({ ok: false, error: String(er.message || er) });
  }
});

app.post("/api/presenca_escalacao/escalar", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const tempo = str(b.tempo).trim();
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

    const e = detectEscalacoesSchema();
    if (e.dataCol && e.tempoCol) db.prepare(`DELETE FROM escalacoes WHERE ${e.dataCol}=? AND ${e.tempoCol}=?`).run(data_domingo, tempo);

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});



// ===== PDF (ARQUIVO REAL GERADO NO SERVIDOR) =====
app.post("/api/pdf/render", async (req, res) => {
  try {
    const b = req.body || {};
    const html = str(b.html).trim();
    let filename = str(b.filename).trim() || "arquivo.pdf";

    if (!filename.toLowerCase().endswith(".pdf")) filename += ".pdf";
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    if (!html) return res.status(400).json({ ok: false, error: "Faltou html" });

    const buf = await htmlToPdfBuffer(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});


app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log("TESOURA API rodando na porta", PORT, "DB:", DB_PATH);
});
