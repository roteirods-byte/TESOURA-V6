#!/usr/bin/env bash
set -e

echo "=== 1) ATUALIZAR DO GITHUB ==="
git pull --rebase origin main

echo
echo "=== 2) INSTALAR BACKEND ==="
cd backend
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo
echo "=== 3) REINICIAR API ==="
sudo systemctl restart tesoura-api.service
sleep 1

echo
echo "=== 4) TESTE LOCAL/OFICIAL ==="
curl -sS http://127.0.0.1:8080/api/health ; echo
curl -sS https://tesoura.duckdns.org/api/health ; echo

echo
echo "OK"
