#!/usr/bin/env bash
# make reset-data: apaga todos os lotes e fotos (base de dados e volumes do
# Garage), volta a inicializar o Garage vazio e gera uma chave de acesso nova.
# Ficam o .env, a CA do Caddy (volume caddy-data) e a pasta backups/.
# Pede confirmação.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}
ALPINE=alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
PROJECT=${COMPOSE_PROJECT_NAME:-estudio}
ENV_FILE=.env

[[ -f $ENV_FILE ]] || { echo "Falta o $ENV_FILE: corre make init primeiro." >&2; exit 1; }
get_var() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }
S3_ACCESS_KEY_ID=$(get_var S3_ACCESS_KEY_ID)
S3_SECRET_ACCESS_KEY=$(get_var S3_SECRET_ACCESS_KEY)
[[ -n $S3_ACCESS_KEY_ID && -n $S3_SECRET_ACCESS_KEY ]] || {
	echo "O $ENV_FILE não tem a chave S3 da API: corre make init primeiro." >&2
	exit 1
}

cat <<'MSG'
Isto apaga do Estúdio:
  * todos os lotes e fotos (originais, miniaturas e carimbadas);
  * a chave de acesso e as sessões: o telemóvel volta a pedir a chave.

Fica tudo o resto: o .env, o certificado instalado no telemóvel e a pasta backups/.
As fotos já guardadas na galeria do telemóvel não são tocadas.
Para guardar uma cópia antes, cancela e corre make backup.

MSG
answer=
read -r -p "Escreve APAGAR para continuar: " answer || true
[[ $answer == APAGAR ]] || { echo "Cancelado."; exit 1; }

echo "A parar a stack..."
$COMPOSE stop caddy api garage

for vol in api-data garage-meta garage-data; do
	name="${PROJECT}_${vol}"
	# Um volume que nunca foi criado não tem nada para apagar (e o docker run criá-lo-ia).
	docker volume inspect "$name" >/dev/null 2>&1 || continue
	docker run --rm --network none -v "$name:/v" "$ALPINE" find /v -mindepth 1 -delete
	echo "Volume $vol vazio."
done

echo "A inicializar o Garage..."
$COMPOSE up -d --wait garage
S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY \
	COMPOSE="$COMPOSE" deploy/garage-init.sh

echo "A subir a stack..."
$COMPOSE up -d --wait

echo
$COMPOSE exec -T api /usr/local/bin/estudio secret rotate
cat <<'MSG'

Pronto: o Estúdio está vazio. No telemóvel, abre o Estúdio e entra com a chave acima.
MSG
