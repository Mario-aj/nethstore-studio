#!/usr/bin/env bash
# Sobe um Garage descartável, inicializa-o e corre os testes Go com a tag
# integration. Derruba tudo no fim, mesmo com falhas.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_TEST=${COMPOSE_TEST:-docker compose --project-directory . -f deploy/docker-compose.test.yml --env-file deploy/test.env}

cleanup() { $COMPOSE_TEST down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

$COMPOSE_TEST up -d --wait garage
set -a
# shellcheck disable=SC1091
source deploy/test.env
set +a
COMPOSE="$COMPOSE_TEST" deploy/garage-init.sh

cd api
S3_TEST_ENDPOINT=http://127.0.0.1:39000 go test -race -count=1 -tags=integration \
	-coverpkg=./internal/... -coverprofile=coverage.integration.out ./...
cd ..
scripts/coverage-gate.sh api/coverage.integration.out auth stamp storage jobs
