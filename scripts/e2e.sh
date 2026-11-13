#!/usr/bin/env bash
# make e2e: Playwright contra a stack em execução (make up antes).
# ATENÇÃO: gera uma chave de acesso nova (a anterior deixa de funcionar).
# Use só em desenvolvimento.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}

base=${E2E_BASE_URL:-$(grep -E '^APP_ORIGIN=' .env | cut -d= -f2-)}
secret=$($COMPOSE exec -T api /usr/local/bin/estudio secret rotate | awk 'NF==1 && length($1)==32 {print $1}')
[[ ${#secret} -eq 32 ]] || { echo "não consegui gerar a chave de teste" >&2; exit 1; }

mkdir -p artifacts/screens
cd web
status=0
E2E_BASE_URL=$base E2E_SECRET=$secret pnpm e2e "$@" || status=$?
echo
echo "A chave de acesso foi trocada pelos testes. Gere a definitiva com: make secret"
exit $status
