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
  return v === null || v === undefined ? "" : String(v);
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function ymd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseYMD(s) {
  // s: YYYY-MM-DD
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

function secondSundayOfMonth(year, month1to12) {
  // month 1..12
  const first = new Date(year, month1to12 - 1, 1);
  first.setHours(0, 0, 0, 0);
  const dow = first.getDay(); // 0 domingo
  const daysToFirstSunday = (7 - dow) % 7;
  const firstSunday = new Date(first);
  firstSunday.setDate(first.getDate() + daysToFirstSunday);
  const second = new Date(firstSunday);
  second.setDate(firstSunday.getDate() + 7);
  second.setHours(0, 0, 0, 0);
  return second;
}

function ensureColumn(db, table, colDef) {
  // colDef: "ordem INTEGER DEFAULT 0"
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch (e) {
    // já existe
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const DB_PATH = process.env.TESOURA_DB_PATH || path.join(__dirname, "db", "tesoura.sqlite");
const db = new Database(DB_PATH);

// ====== SCHEMA ======
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

CREATE TABLE IF NOT EXISTS escalacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_domingo TEXT,
  tempo TEXT,          -- '1T' | '2T'
  time TEXT,           -- 'AMARELO' | 'AZUL'
  pos INTEGER,         -- 1..10
  apelido TEXT
);
`);

ensureColumn(db, "presencas", "ordem INTEGER DEFAULT 0");
ensureColumn(db, "presencas", "nao_joga INTEGER DEFAULT 0");
ensureColumn(db, "presencas", "obs TEXT DEFAULT ''");

db.exec(`
CREATE INDEX IF NOT EXISTS idx_presencas_data ON presencas(data_domingo);
CREATE INDEX IF NOT EXISTS idx_escalacoes_data_tempo ON escalacoes(data_domingo, tempo);
`);

// ====== HELPERS (PRESENÇA/ESCALAÇÃO) ======
function getJogadoresAtivos() {
  return db
    .prepare("SELECT id,apelido,posicao,pontos,created_at FROM jogadores WHERE ativo=1 ORDER BY apelido COLLATE NOCASE")
    .all();
}

function getPresencas(data_domingo) {
  return db
    .prepare("SELECT data_domingo,apelido,hora_chegada,saiu,ordem,nao_joga,obs FROM presencas WHERE data_domingo=? ORDER BY ordem ASC, hora_chegada ASC")
    .all(data_domingo);
}

function getEscalacao(data_domingo, tempo) {
  return db
    .prepare("SELECT data_domingo,tempo,time,pos,apelido FROM escalacoes WHERE data_domingo=? AND tempo=? ORDER BY pos ASC, time ASC")
    .all(data_domingo, tempo);
}

function getPagoMap(jogadores, sundayYmd, nowLocalIso) {
  // Regra:
  // - Até o 2º domingo: P branco
  // - Na segunda após o 2º domingo: se não pagou => P vermelho; se pagou => P verde
  const now = nowLocalIso ? new Date(nowLocalIso) : new Date();
  const sd = parseYMD(sundayYmd) || new Date();
  const mesKey = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}`; // YYYY-MM
  const secondSun = secondSundayOfMonth(sd.getFullYear(), sd.getMonth() + 1);
  const due = new Date(secondSun);
  due.setDate(secondSun.getDate() + 1); // segunda
  due.setHours(0, 0, 0, 0);

  const paidRows = db
    .prepare("SELECT apelido,pago FROM mensalidades WHERE mes=?")
    .all(mesKey);

  const paidMap = {};
  for (const r of paidRows) {
    // última ocorrência prevalece
    paidMap[str(r.apelido).trim()] = Number(r.pago || 0) === 1;
  }

  const out = {};
  for (const j of jogadores) {
    const ap = str(j.apelido).trim();
    if (now < due) {
      out[ap] = "white";
    } else {
      out[ap] = paidMap[ap] ? "green" : "red";
    }
  }
  return out;
}

function countFaltasHistorico(jogadores, maxDomingos = 12) {
  // pega últimos domingos que têm registro de presença
  const doms = db
    .prepare("SELECT DISTINCT data_domingo FROM presencas WHERE data_domingo<>'' ORDER BY data_domingo DESC LIMIT ?")
    .all(maxDomingos)
    .map((r) => r.data_domingo);

  const presentByDom = {};
  for (const d of doms) {
    const aps = db.prepare("SELECT apelido FROM presencas WHERE data_domingo=?").all(d).map((x) => str(x.apelido).trim());
    presentByDom[d] = new Set(aps);
  }

  const faltas = {};
  for (const j of jogadores) {
    const ap = str(j.apelido).trim();
    let miss = 0;
    for (const d of doms) {
      if (!presentByDom[d].has(ap)) miss += 1;
    }
    faltas[ap] = miss;
  }
  return { doms, faltas };
}

function setPresencaChegou(data_domingo, apelido, now_local) {
  const now = now_local ? new Date(now_local) : new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const hora = `${hh}:${mm}:${ss}`;

  // ordem incremental
  const maxOrd = db.prepare("SELECT MAX(ordem) AS m FROM presencas WHERE data_domingo=?").get(data_domingo);
  const nextOrd = Number((maxOrd && maxOrd.m) || 0) + 1;

  db.prepare("DELETE FROM presencas WHERE data_domingo=? AND apelido=?").run(data_domingo, apelido);
  db.prepare(`
    INSERT INTO presencas (data_domingo,apelido,hora_chegada,saiu,ordem,nao_joga,obs)
    VALUES (?,?,?,?,?,?,?)
  `).run(data_domingo, apelido, hora, 0, nextOrd, 0, "");
}

function balanceTeams(selected, pontosMap) {
  // selected: [apelido]
  // retorna { amarelo:[apelido], azul:[apelido] }
  const arr = [...selected].sort((a, b) => (pontosMap[b] || 0) - (pontosMap[a] || 0));
  const A = [], B = [];
  let sumA = 0, sumB = 0;
  for (const ap of arr) {
    if (A.length >= 10) {
      B.push(ap); sumB += (pontosMap[ap] || 0); continue;
    }
    if (B.length >= 10) {
      A.push(ap); sumA += (pontosMap[ap] || 0); continue;
    }
    if (sumA <= sumB) { A.push(ap); sumA += (pontosMap[ap] || 0); }
    else { B.push(ap); sumB += (pontosMap[ap] || 0); }
  }
  return { amarelo: A, azul: B };
}

function writeEscalacao(data_domingo, tempo, teams) {
  // limpa e grava 20 linhas (10 amarelo, 10 azul)
  db.prepare("DELETE FROM escalacoes WHERE data_domingo=? AND tempo=?").run(data_domingo, tempo);

  const ins = db.prepare("INSERT INTO escalacoes (data_domingo,tempo,time,pos,apelido) VALUES (?,?,?,?,?)");
  for (let i = 0; i < 10; i++) {
    ins.run(data_domingo, tempo, "AMARELO", i + 1, teams.amarelo[i] || "");
    ins.run(data_domingo, tempo, "AZUL", i + 1, teams.azul[i] || "");
  }
}

function computeEscalacao1T(data_domingo, now_local) {
  const jogadores = getJogadoresAtivos();
  const pontosMap = {};
  const createdMap = {};
  for (const j of jogadores) {
    const ap = str(j.apelido).trim();
    pontosMap[ap] = Number(j.pontos || 0);
    createdMap[ap] = str(j.created_at || "");
  }

  const presencas = getPresencas(data_domingo).filter((p) => Number(p.nao_joga || 0) !== 1);
  const presentAps = presencas.map((p) => str(p.apelido).trim()).filter(Boolean);

  // domingo anterior
  const sd = parseYMD(data_domingo);
  const prev = new Date(sd);
  prev.setDate(sd.getDate() - 7);
  const prevYmd = ymd(prev);

  const prevSet = new Set(db.prepare("SELECT apelido FROM presencas WHERE data_domingo=?").all(prevYmd).map((r) => str(r.apelido).trim()));

  const { faltas } = countFaltasHistorico(jogadores, 12);

  // inadimplente (vermelho)
  const pagoMap = getPagoMap(jogadores, data_domingo, now_local);
  const inad = (ap) => pagoMap[ap] === "red";

  let selected = [...presentAps];

  if (selected.length > 20) {
    const scored = selected.map((ap) => ({
      ap,
      faltouPrev: prevSet.has(ap) ? 0 : 1,
      inad: inad(ap) ? 1 : 0,
      faltas: faltas[ap] || 0,
    }));

    // quem sai primeiro: faltou prev (1), inad (1), mais faltas (maior)
    scored.sort((x, y) =>
      (y.faltouPrev - x.faltouPrev) ||
      (y.inad - x.inad) ||
      ((y.faltas || 0) - (x.faltas || 0))
    );

    const toDrop = scored.slice(0, scored.length - 20).map((x) => x.ap);
    const dropSet = new Set(toDrop);
    selected = scored.filter((x) => !dropSet.has(x.ap)).map((x) => x.ap);
  }

  const teams = balanceTeams(selected, pontosMap);
  writeEscalacao(data_domingo, "1T", teams);
  return { ok: true };
}

function computeEscalacao2T(data_domingo, now_local) {
  const jogadores = getJogadoresAtivos();
  const pontosMap = {};
  const createdAt = {};
  for (const j of jogadores) {
    const ap = str(j.apelido).trim();
    pontosMap[ap] = Number(j.pontos || 0);
    createdAt[ap] = str(j.created_at || "");
  }

  const presencasAll = getPresencas(data_domingo);
  const presentAps = presencasAll.filter((p) => Number(p.nao_joga || 0) !== 1).map((p) => str(p.apelido).trim()).filter(Boolean);

  const played1 = new Set(getEscalacao(data_domingo, "1T").map((r) => str(r.apelido).trim()).filter(Boolean));

  // domingo anterior
  const sd = parseYMD(data_domingo);
  const prev = new Date(sd);
  prev.setDate(sd.getDate() - 7);
  const prevYmd = ymd(prev);

  const prevSet = new Set(db.prepare("SELECT apelido FROM presencas WHERE data_domingo=?").all(prevYmd).map((r) => str(r.apelido).trim()));

  // jogou os dois tempos no domingo anterior
  const prev1 = new Set(getEscalacao(prevYmd, "1T").map((r) => str(r.apelido).trim()).filter(Boolean));
  const prev2 = new Set(getEscalacao(prevYmd, "2T").map((r) => str(r.apelido).trim()).filter(Boolean));
  const bothPrev = new Set([...prev1].filter((ap) => prev2.has(ap)));

  const { faltas } = countFaltasHistorico(jogadores, 12);

  const pagoMap = getPagoMap(jogadores, data_domingo, now_local);
  const inad = (ap) => pagoMap[ap] === "red";

  const saiuSet = new Set(presencasAll.filter((p) => Number(p.saiu || 0) === 1).map((p) => str(p.apelido).trim()));

  // Score: maior = mais prioridade
  // Prioridade base: não jogou 1T => +1000
  // Penalidades de corte: saiu, faltou domingo anterior, jogou 2 tempos anterior, mais faltas, mais novos
  const scored = presentAps.map((ap) => {
    const notPlayed = played1.has(ap) ? 0 : 1;
    const ageKey = createdAt[ap] || ""; // mais novo => created_at maior
    return {
      ap,
      score:
        (notPlayed ? 1000 : 0) +
        (saiuSet.has(ap) ? -900 : 0) +
        (prevSet.has(ap) ? 0 : -500) +
        (bothPrev.has(ap) ? -350 : 0) +
        (inad(ap) ? -250 : 0) +
        (-(faltas[ap] || 0) * 20) +
        // mais novos saem primeiro => mais novo recebe penalidade maior
        (ageKey ? -(Number(new Date(ageKey).getTime()) || 0) / 1e12 : 0)
    };
  });

  scored.sort((a, b) => (b.score - a.score));

  const selected = scored.slice(0, 20).map((x) => x.ap);

  const teams = balanceTeams(selected, pontosMap);
  writeEscalacao(data_domingo, "2T", teams);
  return { ok: true };
}

// ====== ROUTES ======
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "tesoura-api", db: DB_PATH });
});

app.get("/api/jogadores", (req, res) => {
  const rows = db.prepare("SELECT * FROM jogadores ORDER BY apelido COLLATE NOCASE").all();
  res.json(rows);
});

app.post("/api/jogadores", (req, res) => {
  try {
    const j = req.body || {};
    const apelido = str(j.apelido).trim();
    if (!apelido) return res.status(400).json({ ok: false, error: "Faltou apelido" });

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

app.get("/api/presencas", (req, res) => {
  const data_domingo = req.query.data_domingo || "";
  const rows = db.prepare("SELECT * FROM presencas WHERE data_domingo=? ORDER BY hora_chegada").all(data_domingo);
  res.json(rows);
});

// ====== PRESENÇA / ESCALAÇÃO (V6 API) ======
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
    // Neste painel, tudo já está gravando no SQLite a cada ação.
    // Mantemos o endpoint para o botão SALVAR do layout.
    const b = req.body || {};
    const data_domingo = str(b.data_domingo).trim();
    if (!data_domingo) return res.status(400).json({ ok: false, error: "Faltou data_domingo" });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// ====== SNAPSHOTS (mantidos para outros painéis) ======
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

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`TESOURA API rodando na porta ${PORT}`);
});
