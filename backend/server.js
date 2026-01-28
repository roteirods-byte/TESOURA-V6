'use strict';
function dbPrepareAll(db, sql, paramsList = []) {
  const stmt = db.prepare(sql);
  const out = [];
  for (const params of paramsList) out.push(stmt.all(params));
  return out;
}

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const { saveSnapshot, listSnapshots, loadSnapshot } = require("./modules/_core/archive");

/**
 * TESOURA V6 — Backend estável (GitHub-first)
 * Foco: Jogadores + Presença/Escalação
 * - Não depende de schema antigo: cria/migra colunas na inicialização
 * - Rotas compatíveis com os paineis em /frontend/panels
 */

const PORT = Number(process.env.PORT || 8080);
const DB_CANDIDATES = [
  process.env.TESOURA_DB_PATH,
  "/home/roteiro_ds/tesoura_api/tesoura.db",
  path.resolve(__dirname, "tesoura.db"),
].filter(Boolean);

function pickExistingDbPath(candidates) {
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch (_) {}
  }
  return candidates[0] || path.resolve(__dirname, "tesoura.db");
}

const DB_PATH = pickExistingDbPath(DB_CANDIDATES);

const app = express();
app.disable("x-powered-by");

// CORS + body
app.use(cors());
app.use(express.json({ limit: "2mb", strict: false }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

// DB
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// -------------------- utils --------------------
function str(x) { return (x == null) ? "" : String(x); }
function int(x, def = 0) {
  const n = Number.parseInt(String(x), 10);
  return Number.isFinite(n) ? n : def;
}
function nowISO() { return new Date().toISOString(); }
function pad2(n) { return String(n).padStart(2, "0"); }

// ----- schema helpers -----
function tableColumns(table) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map(r => String(r.name)));
  } catch {
    return new Set();
  }
}
function tableExists(table) {
  const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!r;
}
function addColumnIfMissing(table, col, typeSql) {
  const cols = tableColumns(table);
  if (!cols.has(col)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${typeSql}`).run();
  }
}

function ensureSchema() {
  // jogadores
  db.exec(`
    CREATE TABLE IF NOT EXISTS jogadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camisa TEXT,
      apelido TEXT,
      nome TEXT,
      nascimento TEXT,
      celular TEXT,
      posicao TEXT,
      hab INTEGER,
      vel INTEGER,
      mov INTEGER,
      pontos INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  // garante colunas (caso tabela antiga exista com nomes diferentes)
  addColumnIfMissing("jogadores", "camisa", "TEXT");
  addColumnIfMissing("jogadores", "apelido", "TEXT");
  addColumnIfMissing("jogadores", "nome", "TEXT");
  addColumnIfMissing("jogadores", "nascimento", "TEXT");
  addColumnIfMissing("jogadores", "celular", "TEXT");
  addColumnIfMissing("jogadores", "posicao", "TEXT");
  addColumnIfMissing("jogadores", "hab", "INTEGER");
  addColumnIfMissing("jogadores", "vel", "INTEGER");
  addColumnIfMissing("jogadores", "mov", "INTEGER");
  addColumnIfMissing("jogadores", "pontos", "INTEGER DEFAULT 0");
  addColumnIfMissing("jogadores", "ativo", "INTEGER DEFAULT 1");
  addColumnIfMissing("jogadores", "created_at", "TEXT");
  addColumnIfMissing("jogadores", "updated_at", "TEXT");

  // presencas
  db.exec(`
    CREATE TABLE IF NOT EXISTS presencas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_domingo TEXT NOT NULL,
      ordem INTEGER,
      apelido TEXT NOT NULL,
      hora TEXT,
      obs TEXT,
      nao_joga INTEGER DEFAULT 0,
      saiu INTEGER DEFAULT 0
    );
  `);
  addColumnIfMissing("presencas", "data_domingo", "TEXT");
  addColumnIfMissing("presencas", "ordem", "INTEGER");
  addColumnIfMissing("presencas", "apelido", "TEXT");
  addColumnIfMissing("presencas", "hora", "TEXT");
  addColumnIfMissing("presencas", "obs", "TEXT");
  addColumnIfMissing("presencas", "nao_joga", "INTEGER DEFAULT 0");
  addColumnIfMissing("presencas", "saiu", "INTEGER DEFAULT 0");

  // escalacoes
  db.exec(`
    CREATE TABLE IF NOT EXISTS escalacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_domingo TEXT NOT NULL,
      tempo TEXT NOT NULL,
      pos INTEGER NOT NULL,
      apelido TEXT NOT NULL,
      time TEXT,
      created_at TEXT
    );
  `);
  addColumnIfMissing("escalacoes", "data_domingo", "TEXT");
  addColumnIfMissing("escalacoes", "tempo", "TEXT");
  addColumnIfMissing("escalacoes", "pos", "INTEGER");
  addColumnIfMissing("escalacoes", "apelido", "TEXT");
  addColumnIfMissing("escalacoes", "time", "TEXT");
  addColumnIfMissing("escalacoes", "created_at", "TEXT");

  // índices (idempotente)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_presencas_data ON presencas(data_domingo);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_escalacoes_data ON escalacoes(data_domingo, tempo);`);
}
ensureSchema();

// -------------------- VERSION --------------------
function readVersionTxt() {
  try {
    const p = path.resolve(__dirname, "..", "frontend", "version.txt");
    return fs.readFileSync(p, "utf-8").trim();
  } catch {
    return "";
  }
}
app.get("/api/version", (req, res) => {
  res.json({ ok: true, version: readVersionTxt(), time: nowISO() });
});

// -------------------- ARQUIVOS (snapshots) --------------------
app.get("/api/arquivo/listar", (req, res) => {
  try {
    const list = listSnapshots(db);
    res.json({ ok: true, list });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/arquivo/carregar", (req, res) => {
  try {
    const id = str(req.query.id).trim();
    if (!id) return res.status(400).json({ ok: false, error: "Faltou id" });
    const data = loadSnapshot(db, id);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/arquivo/salvar", (req, res) => {
  try {
    const b = req.body || {};
    const panel = str(b.panel).trim() || "desconhecido";
    const payload = b.payload || {};
    const id = saveSnapshot(db, panel, payload);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// -------------------- JOGADORES --------------------
function normalizeApelido(a) {
  return str(a).trim();
}
function getJogadores(onlyAtivos = true) {
  const cols = tableColumns("jogadores");

  // Compat: nomes de colunas variam em bancos antigos
  const posCol = cols.has("posicao") ? "posicao" : (cols.has("pos") ? "pos" : null);
  const habCol = cols.has("hab") ? "hab" : (cols.has("habilidade") ? "habilidade" : null);
  const velCol = cols.has("vel") ? "vel" : (cols.has("velocidade") ? "velocidade" : null);
  const movCol = cols.has("mov") ? "mov" : (cols.has("movimentacao") ? "movimentacao" : null);
  const pontosCol = cols.has("pontos") ? "pontos" : null;

  const where = onlyAtivos ? "WHERE COALESCE(ativo,1)=1" : "";

  const sql = `
    SELECT
      id,
      COALESCE(camisa,'') AS camisa,
      COALESCE(apelido,'') AS apelido,
      COALESCE(nome,'') AS nome,
      COALESCE(nascimento,'') AS nascimento,
      COALESCE(celular,'') AS celular,
      ${posCol ? `COALESCE(${posCol},'')` : "''"} AS posicao,
      ${habCol ? `COALESCE(${habCol},0)` : "0"} AS hab,
      ${velCol ? `COALESCE(${velCol},0)` : "0"} AS vel,
      ${movCol ? `COALESCE(${movCol},0)` : "0"} AS mov,
      ${pontosCol ? `COALESCE(${pontosCol},0)` : "0"} AS pontos,
      COALESCE(ativo,1) AS ativo
    FROM jogadores
    ${where}
    ORDER BY LOWER(apelido) ASC, id ASC
  `;

  return dbPrepareAll(sql, {});
}


app.get("/api/jogadores", (req, res) => {
  try {
    const all = str(req.query.all).trim() === "1";
    const jogadores = getJogadores(!all);
    res.json({ ok: true, jogadores });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/jogadores", (req, res) => {
  try {
    const b = req.body || {};
    const apelido = normalizeApelido(b.apelido);
    if (!apelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });

    // impede duplicado
    const exists = db.prepare("SELECT 1 FROM jogadores WHERE LOWER(apelido)=LOWER(?) LIMIT 1").get(apelido);
    if (exists) return res.status(400).json({ ok: false, error: "apelido já existe" });

    const now = nowISO();
    db.prepare(`
      INSERT INTO jogadores (camisa, apelido, nome, nascimento, celular, posicao, hab, vel, mov, pontos, ativo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      str(b.camisa).trim(),
      apelido,
      str(b.nome).trim(),
      str(b.nascimento).trim(),
      str(b.celular).trim(),
      str(b.posicao).trim(),
      int(b.hab, 0),
      int(b.vel, 0),
      int(b.mov, 0),
      int(b.pontos, 0),
      now,
      now
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.put("/api/jogadores/:apelido", (req, res) => {
  try {
    const oldApelido = normalizeApelido(req.params.apelido);
    const b = req.body || {};
    if (!oldApelido) return res.status(400).json({ ok: false, error: "Faltou apelido (url)" });

    const newApelido = normalizeApelido(b.apelido || oldApelido);
    if (!newApelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });

    // se mudou apelido, valida duplicado
    if (newApelido.toLowerCase() !== oldApelido.toLowerCase()) {
      const dup = db.prepare("SELECT 1 FROM jogadores WHERE LOWER(apelido)=LOWER(?) LIMIT 1").get(newApelido);
      if (dup) return res.status(400).json({ ok: false, error: "apelido já existe" });
    }

    const now = nowISO();
    const r = db.prepare(`
      UPDATE jogadores
         SET camisa=?,
             apelido=?,
             nome=?,
             nascimento=?,
             celular=?,
             posicao=?,
             hab=?,
             vel=?,
             mov=?,
             pontos=?,
             updated_at=?
       WHERE LOWER(apelido)=LOWER(?)
    `).run(
      str(b.camisa).trim(),
      newApelido,
      str(b.nome).trim(),
      str(b.nascimento).trim(),
      str(b.celular).trim(),
      str(b.posicao).trim(),
      int(b.hab, 0),
      int(b.vel, 0),
      int(b.mov, 0),
      int(b.pontos, 0),
      now,
      oldApelido
    );

    if (r.changes === 0) return res.status(404).json({ ok: false, error: "jogador não encontrado" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.delete("/api/jogadores/:apelido", (req, res) => {
  try {
    const apelido = normalizeApelido(req.params.apelido);
    if (!apelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });

    // soft delete (mais seguro)
    const r = db.prepare("UPDATE jogadores SET ativo=0, updated_at=? WHERE LOWER(apelido)=LOWER(?)").run(nowISO(), apelido);
    if (r.changes === 0) return res.status(404).json({ ok: false, error: "jogador não encontrado" });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// -------------------- PRESENÇA / ESCALAÇÃO --------------------
function getPresencas(data_domingo) {
  return db.prepare(`
    SELECT id, COALESCE(ordem,0) AS ordem, apelido,
           COALESCE(hora,'') AS hora,
           COALESCE(obs,'') AS obs,
           COALESCE(nao_joga,0) AS nao_joga,
           COALESCE(saiu,0) AS saiu
      FROM presencas
     WHERE data_domingo=?
     ORDER BY COALESCE(ordem,0) ASC, id ASC
  `).all(data_domingo);
}

function resequencePresencas(data_domingo) {
  const rows = db.prepare(`SELECT id FROM presencas WHERE data_domingo=? ORDER BY COALESCE(ordem,0) ASC, id ASC`).all(data_domingo);
  const upd = db.prepare(`UPDATE presencas SET ordem=? WHERE id=?`);
  const tx = db.transaction(() => {
    rows.forEach((r, i) => upd.run(i + 1, r.id));
  });
  tx();
}

function setPresencaChegou(data_domingo, apelido, now_local) {
  // impede duplicado
  const exists = db.prepare(`SELECT 1 FROM presencas WHERE data_domingo=? AND apelido=?`).get(data_domingo, apelido);
  if (exists) throw new Error("jogador já está na lista");

  // ordem (último + 1)
  const max = db.prepare(`SELECT MAX(COALESCE(ordem,0)) AS m FROM presencas WHERE data_domingo=?`).get(data_domingo);
  const maxOrdem = int(max && max.m, 0);

  // hora HH:MM
  let hhmm = "";
  const m = str(now_local).match(/\b(\d{2}):(\d{2})\b/);
  if (m) hhmm = `${m[1]}:${m[2]}`;
  if (!hhmm) {
    const d = new Date();
    hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  db.prepare(`
    INSERT INTO presencas (data_domingo, ordem, apelido, hora, obs, nao_joga, saiu)
    VALUES (?, ?, ?, ?, '', 0, 0)
  `).run(data_domingo, maxOrdem + 1, apelido, hhmm);
}

function getEscalacao(data_domingo, tempo) {
  return db.prepare(`
    SELECT id, pos, apelido, COALESCE(time,'') AS time
      FROM escalacoes
     WHERE data_domingo=? AND tempo=?
     ORDER BY pos ASC, id ASC
  `).all(data_domingo, tempo);
}

function computeEscalacao(data_domingo, tempo) {
  // candidatos elegíveis (nao_joga=0)
  const pres = getPresencas(data_domingo);

  const elegiveis = pres.filter(p => !p.nao_joga);
  const apelidos1T = new Set(getEscalacao(data_domingo, "1T").map(x => x.apelido));

  let candidatos = elegiveis;

  if (tempo === "2T") {
    // prioridade: quem NÃO jogou 1T
    const a = elegiveis.filter(p => !apelidos1T.has(p.apelido) && !p.saiu);
    const b = elegiveis.filter(p => apelidos1T.has(p.apelido) && !p.saiu);
    candidatos = a.concat(b);
  }

  const escolhidos = candidatos.slice(0, 20).map(x => x.apelido);

  const del = db.prepare(`DELETE FROM escalacoes WHERE data_domingo=? AND tempo=?`);
  const ins = db.prepare(`INSERT INTO escalacoes (data_domingo, tempo, pos, apelido, time, created_at) VALUES (?, ?, ?, ?, '', ?)`);
  const tx = db.transaction(() => {
    del.run(data_domingo, tempo);
    escolhidos.forEach((apelido, i) => ins.run(data_domingo, tempo, i + 1, apelido, nowISO()));
  });
  tx();
}

app.get("/api/presenca_escalacao/state", (req, res) => {
  try {
    const data_domingo = str(req.query.data_domingo).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });

    const jogadores = getJogadores(true);
    const presencas = getPresencas(data_domingo);
    const escalacao1 = getEscalacao(data_domingo, "1T");
    const escalacao2 = getEscalacao(data_domingo, "2T");

    // pagoMap (placeholder seguro): todos como pago=1
    const pagoMap = {};
    jogadores.forEach(j => { pagoMap[j.apelido] = 1; });

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
    if (!data_domingo || !apelido) return res.status(400).json({ ok: false, error: "Faltou data_domingo/apelido" });

    const row = db.prepare(`SELECT id, COALESCE(nao_joga,0) AS nao_joga FROM presencas WHERE data_domingo=? AND apelido=?`).get(data_domingo, apelido);
    if (!row) return res.status(404).json({ ok: false, error: "presença não encontrada" });

    const novo = row.nao_joga ? 0 : 1;
    db.prepare(`UPDATE presencas SET nao_joga=? WHERE id=?`).run(novo, row.id);

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
    if (!data_domingo || !apelido) return res.status(400).json({ ok: false, error: "Faltou data_domingo/apelido" });

    const row = db.prepare(`SELECT id, COALESCE(saiu,0) AS saiu FROM presencas WHERE data_domingo=? AND apelido=?`).get(data_domingo, apelido);
    if (!row) return res.status(404).json({ ok: false, error: "presença não encontrada" });

    const novo = row.saiu ? 0 : 1;
    db.prepare(`UPDATE presencas SET saiu=? WHERE id=?`).run(novo, row.id);

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

    db.prepare(`DELETE FROM presencas WHERE data_domingo=? AND apelido=?`).run(data_domingo, apelido);
    resequencePresencas(data_domingo);

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

    db.prepare(`DELETE FROM presencas WHERE data_domingo=?`).run(data_domingo);
    db.prepare(`DELETE FROM escalacoes WHERE data_domingo=?`).run(data_domingo);

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/presenca_escalacao/escalar", (req, res) => {
  try {
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    const tempo = str(b.tempo).trim();
    if (!data_domingo || (tempo !== "1T" && tempo !== "2T")) {
      return res.status(400).json({ ok: false, error: "Faltou data_domingo/tempo" });
    }

    computeEscalacao(data_domingo, tempo);
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
    if (!data_domingo || (tempo !== "1T" && tempo !== "2T")) {
      return res.status(400).json({ ok: false, error: "Faltou data_domingo/tempo" });
    }

    db.prepare(`DELETE FROM escalacoes WHERE data_domingo=? AND tempo=?`).run(data_domingo, tempo);
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

    const payload = {
      data_domingo,
      jogadores: getJogadores(true),
      presencas: getPresencas(data_domingo),
      escalacao1: getEscalacao(data_domingo, "1T"),
      escalacao2: getEscalacao(data_domingo, "2T"),
      saved_at: nowISO(),
    };

    const id = saveSnapshot(db, "presenca_escalacao", payload);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// alias simples (compatibilidade antiga)
app.get("/api/presenca", (req, res) => {
  // antigo: /api/presenca?data_domingo=YYYY-MM-DD -> redireciona
  const data_domingo = str(req.query.data_domingo).trim();
  const qs = data_domingo ? `?data_domingo=${encodeURIComponent(data_domingo)}` : "";
  res.redirect(302, `/api/presenca_escalacao/state${qs}`);
});

// -------------------- HEALTH --------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log("TESOURA API rodando na porta", PORT, "DB:", DB_PATH);
});
