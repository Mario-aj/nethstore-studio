#!/usr/bin/env bash
# make restore DATE=AAAA-MM-DD: substitui a base de dados e os volumes do
# Garage pelos do backup indicado. Pede confirmação.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}
ALPINE=alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
PROJECT=estudio

day=${1:-}
[[ -n $day ]] || { echo "Uso: make restore DATE=AAAA-MM-DD" >&2; exit 1; }
dir="backups/$day"
[[ -f $dir/estudio.db && -f $dir/garage-meta.tar.gz && -f $dir/garage-data.tar.gz ]] || {
	echo "Backup incompleto ou inexistente em $dir" >&2
	exit 1
}
(cd "$dir" && sha256sum -c --quiet SHA256SUMS)

read -r -p "Isto apaga os dados atuais e restaura $day. Escreve RESTAURAR para continuar: " answer
[[ $answer == RESTAURAR ]] || { echo "Cancelado."; exit 1; }

$COMPOSE stop caddy api garage
docker run --rm -v "${PROJECT}_api-data:/v" -v "$PWD/$dir:/in:ro" "$ALPINE" sh -c \
	'rm -f /v/estudio.db /v/estudio.db-wal /v/estudio.db-shm && cp /in/estudio.db /v/estudio.db && chown 65532:65532 /v/estudio.db'
for vol in garage-meta garage-data; do
	docker run --rm -v "${PROJECT}_${vol}:/v" -v "$PWD/$dir:/in:ro" "$ALPINE" sh -c \
		"find /v -mindepth 1 -delete && tar xzf /in/${vol}.tar.gz -C /v && chown -R 1000:1000 /v"
done
$COMPOSE up -d --wait
echo "Restaurado a partir de $dir."
