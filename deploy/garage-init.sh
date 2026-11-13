#!/usr/bin/env bash
# Inicializa o Garage de nó único de forma idempotente (SPEC 13):
# layout, bucket "estudio", importação da chave S3 da API e permissões.
# Uso: COMPOSE="docker compose --project-directory . -f deploy/docker-compose.yml" deploy/garage-init.sh
set -euo pipefail

COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}
BUCKET=${S3_BUCKET:-estudio}
KEY_NAME=estudio-api
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID em falta}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY em falta}"

garage() { $COMPOSE exec -T -e RUST_LOG=warn garage /garage "$@"; }

echo "A aguardar o Garage..."
for _ in $(seq 1 30); do
	if garage status >/dev/null 2>&1; then break; fi
	sleep 1
done
garage status >/dev/null

if garage layout show 2>/dev/null | grep -qE 'Current cluster layout version: [1-9]'; then
	echo "Layout já aplicado."
else
	NODE_ID=$(garage node id -q 2>/dev/null | cut -d@ -f1)
	[[ -n "$NODE_ID" ]] || { echo "não consegui ler o ID do nó" >&2; exit 1; }
	garage layout assign -z casa -c 100G "$NODE_ID" >/dev/null
	garage layout apply --version 1 >/dev/null
	echo "Layout aplicado ao nó ${NODE_ID:0:16}."
fi

if garage bucket info "$BUCKET" >/dev/null 2>&1; then
	echo "Bucket $BUCKET já existe."
else
	garage bucket create "$BUCKET" >/dev/null
	echo "Bucket $BUCKET criado."
fi

if garage key info "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
	echo "Chave da API já existe."
else
	garage key import --yes -n "$KEY_NAME" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
	echo "Chave da API importada."
fi

# Só leitura e escrita no bucket da app; nunca --owner.
garage bucket allow --read --write "$BUCKET" --key "$S3_ACCESS_KEY_ID" >/dev/null
echo "Permissões de leitura e escrita aplicadas em $BUCKET."
