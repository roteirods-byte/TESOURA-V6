#!/usr/bin/env bash
set -e

ROOT="${1:-.}"

echo "==============================="
echo "TESOURA V6 - CHECAGEM RESÍDUOS"
echo "==============================="

# termos proibidos (Supabase/Firebase/autotrader etc.)
BAD=$(grep -RIn \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  -E "supabase|firebase|autotrader-producao|SUPABASE_URL|SUPABASE_KEY|createClient\\(" \
  "$ROOT" || true)

if [ -n "$BAD" ]; then
  echo
  echo "ERRO: resíduos encontrados (PROIBIDO no V6):"
  echo "$BAD"
  echo
  exit 1
fi

echo "OK: sem resíduos proibidos."
