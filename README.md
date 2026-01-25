# TESOURA V6 (GitHub)

Projeto com **frontend estático** (HTML) + **backend Node/Express** (SQLite).

## Pastas
- `frontend/` = painéis (HTML)
- `backend/` = API (Node + SQLite)

## API (rotas principais)
- `GET  /api/health`
- `GET  /api/version`
- `GET  /api/jogadores`
- `POST /api/jogadores`
- `PUT  /api/jogadores/:apelido`
- `DELETE /api/jogadores/:apelido`
- `GET  /api/presenca_escalacao/state?data_domingo=YYYY-MM-DD`
- `POST /api/presenca_escalacao/chegou`
- `POST /api/presenca_escalacao/toggle_nao_joga`
- `POST /api/presenca_escalacao/toggle_saiu`
- `POST /api/presenca_escalacao/remover`
- `POST /api/presenca_escalacao/limpar`
- `POST /api/presenca_escalacao/escalar`
- `POST /api/presenca_escalacao/desfazer`
- `POST /api/presenca_escalacao/salvar`

## Rodar local (rápido)
### 1) Backend
```bash
cd backend
npm i
# usa sqlite local em backend/tesoura.db
node server.js
```

### 2) Frontend
Abra `frontend/index.html` no navegador.

> Observação: em produção, o ideal é servir o `frontend/` via Nginx/Apache e manter o backend rodando com systemd.

## Variáveis de ambiente (produção)
- `PORT` (padrão 8080)
- `TESOURA_DB_PATH` (ex.: `/home/roteiro_ds/tesoura_api/tesoura.db`)
