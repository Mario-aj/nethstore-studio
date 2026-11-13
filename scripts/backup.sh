#!/usr/bin/env bash
# make backup: cópia consistente do SQLite (VACUUM INTO) e arquivo dos
# volumes do Garage em backups/AAAA-MM-DD/. O Garage para alguns segundos
# durante o arquivo; envios em curso falham e a app tenta de novo.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}
ALPINE=alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
PROJECT=estudio

day=$(date +%F)
dir="backups/$day"
mkdir -p "$dir"
chmod 700 backups "$dir"

echo "SQLite..."
$COMPOSE exec -T api /usr/local/bin/estudio backup >"$dir/estudio.db.tmp"
mv "$dir/estudio.db.tmp" "$dir/estudio.db"

echo "Garage (paragem breve)..."
$COMPOSE stop garage >/dev/null
trap '$COMPOSE start garage >/dev/null' EXIT
for vol in garage-meta garage-data; do
	docker run --rm -v "${PROJECT}_${vol}:/v:ro" -v "$PWD/$dir:/out" "$ALPINE" \
		sh -c "tar czf /out/${vol}.tar.gz -C /v . && chown $(id -u):$(id -g) /out/${vol}.tar.gz"
done
$COMPOSE start garage >/dev/null
trap - EXIT

(cd "$dir" && sha256sum estudio.db garage-meta.tar.gz garage-data.tar.gz >SHA256SUMS)
echo "Backup em $dir:"
ls -lh "$dir"
