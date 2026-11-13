#!/usr/bin/env bash
# make init: gera o .env (segredos aleatórios), sobe o Garage e inicializa-o.
# Variáveis opcionais: DEPLOY_MODE, LAN_HOST, PUBLIC_DOMAIN, ACME_EMAIL.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}
ENV_FILE=.env

if [[ ! -f $ENV_FILE ]]; then
	cp .env.example "$ENV_FILE"
	echo "Criado $ENV_FILE a partir de .env.example."
fi
chmod 600 "$ENV_FILE"

get_var() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }
set_var() {
	local key=$1 val=$2 tmp
	tmp=$(mktemp)
	if grep -qE "^$key=" "$ENV_FILE"; then
		awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" >"$tmp"
	else
		cat "$ENV_FILE" >"$tmp"
		echo "$key=$val" >>"$tmp"
	fi
	cat "$tmp" >"$ENV_FILE"
	rm -f "$tmp"
}
rand_hex() { openssl rand -hex "$1"; }

mode=${DEPLOY_MODE:-$(get_var DEPLOY_MODE)}
mode=${mode:-lan}
case $mode in
lan)
	host=${LAN_HOST:-$(get_var LAN_HOST)}
	if [[ -z $host || $host == 192.168.1.50 && -z ${LAN_HOST:-} ]]; then
		detected=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' || true)
		host=${detected:-$host}
	fi
	[[ -n $host ]] || { echo "Defina LAN_HOST (IP fixo do computador)." >&2; exit 1; }
	set_var DEPLOY_MODE lan
	set_var LAN_HOST "$host"
	set_var APP_ORIGIN "https://$host"
	;;
public)
	domain=${PUBLIC_DOMAIN:-$(get_var PUBLIC_DOMAIN)}
	email=${ACME_EMAIL:-$(get_var ACME_EMAIL)}
	[[ -n $domain ]] || { echo "Defina PUBLIC_DOMAIN para o modo public." >&2; exit 1; }
	set_var DEPLOY_MODE public
	set_var PUBLIC_DOMAIN "$domain"
	[[ -n $email ]] && set_var ACME_EMAIL "$email"
	set_var APP_ORIGIN "https://$domain"
	;;
*)
	echo "DEPLOY_MODE deve ser lan ou public." >&2
	exit 1
	;;
esac

[[ -n $(get_var GARAGE_RPC_SECRET) ]] || set_var GARAGE_RPC_SECRET "$(rand_hex 32)"
[[ -n $(get_var GARAGE_ADMIN_TOKEN) ]] || set_var GARAGE_ADMIN_TOKEN "$(rand_hex 32)"
[[ -n $(get_var S3_ACCESS_KEY_ID) ]] || set_var S3_ACCESS_KEY_ID "GK$(rand_hex 12)"
[[ -n $(get_var S3_SECRET_ACCESS_KEY) ]] || set_var S3_SECRET_ACCESS_KEY "$(rand_hex 32)"

echo "Modo $(get_var DEPLOY_MODE), origem $(get_var APP_ORIGIN)."

$COMPOSE up -d --wait garage
S3_ACCESS_KEY_ID=$(get_var S3_ACCESS_KEY_ID) S3_SECRET_ACCESS_KEY=$(get_var S3_SECRET_ACCESS_KEY) \
	COMPOSE="$COMPOSE" deploy/garage-init.sh

cat <<MSG

Pronto. Próximos passos:
  make up       constrói e sobe a stack
  make secret   gera a chave de acesso (mostrada uma única vez)
MSG
