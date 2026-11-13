#!/usr/bin/env bash
# make security-check: verificações com curl contra a stack em execução
# (SPEC 15): cabeçalhos, cookies, 401, 403, 415, 404 do /s3, redirecionamento
# HTTP e portas publicadas. Se ESTUDIO_SECRET estiver definido, faz login e
# confere os atributos do cookie.
set -uo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose --project-directory . -f deploy/docker-compose.yml}

BASE=${BASE_URL:-$(grep -E '^APP_ORIGIN=' .env | cut -d= -f2-)}
host=${BASE#https://}
CURL=(curl -sS --max-time 10)
if [[ -f deploy/ca/estudio-root.crt ]]; then
	CURL+=(--cacert deploy/ca/estudio-root.crt)
else
	CURL+=(-k)
fi

pass=0
fail=0
ok() { echo "  ok    $1"; pass=$((pass + 1)); }
ko() { echo "  FALHA $1"; fail=$((fail + 1)); }
expect_status() { # desc expected curl-args...
	local desc=$1 want=$2
	shift 2
	local got
	got=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$@")
	if [[ $got == "$want" ]]; then ok "$desc ($got)"; else ko "$desc: esperado $want, veio $got"; fi
}

echo "Alvo: $BASE"
echo "Cabeçalhos do HTML"
headers=$("${CURL[@]}" -D - -o /dev/null "$BASE/")
check_header() {
	if grep -qi "^$1: $2" <<<"$headers"; then ok "$1"; else ko "$1 ausente ou diferente"; fi
}
check_header "Content-Security-Policy" "default-src 'self'; script-src 'self'; style-src 'self'"
check_header "X-Content-Type-Options" "nosniff"
check_header "Referrer-Policy" "no-referrer"
check_header "Permissions-Policy" "camera=()"
check_header "Cross-Origin-Opener-Policy" "same-origin"
check_header "Cross-Origin-Resource-Policy" "same-origin"
if grep -qi "^server:" <<<"$headers"; then ko "cabeçalho Server exposto"; else ok "sem cabeçalho Server"; fi
if grep -qi "unsafe-inline" <<<"$headers"; then ko "CSP com unsafe-inline"; else ok "CSP sem unsafe-inline"; fi
if grep -qi "^x-robots-tag" <<<"$headers"; then ko "landing com noindex"; else ok "landing indexável"; fi
if "${CURL[@]}" -D - -o /dev/null "$BASE/entrar" | grep -qi "^x-robots-tag: noindex"; then ok "/entrar com noindex"; else ko "/entrar sem noindex"; fi

echo "API"
expect_status "GET /api/health" 200 "$BASE/api/health"
expect_status "GET /api/auth/me sem sessão" 401 "$BASE/api/auth/me"
expect_status "GET /api/batches sem sessão" 401 "$BASE/api/batches"
expect_status "GET /api/photos/{id}/stamped sem sessão" 401 "$BASE/api/photos/01933f6e-0000-7000-8000-000000000000/stamped"
expect_status "POST com Origin de outro domínio" 403 -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}' "$BASE/api/auth/login"
expect_status "POST sem Origin" 403 -X POST -H "Content-Type: application/json" -d '{}' "$BASE/api/auth/login"
expect_status "POST com text/plain" 415 -X POST -H "Origin: $BASE" -H "Content-Type: text/plain" -d 'x' "$BASE/api/auth/login"
big=$(head -c 70000 /dev/zero | tr '\0' 'a')
expect_status "corpo acima de 64 KB" 413 -X POST -H "Origin: $BASE" -H "Content-Type: application/json" --data-binary "{\"secret\":\"$big\"}" "$BASE/api/auth/login"
api_cc=$("${CURL[@]}" -D - -o /dev/null "$BASE/api/health" | grep -i "^cache-control:" | tr -d '\r')
[[ $api_cc == *no-store* ]] && ok "API com Cache-Control: no-store" || ko "API sem no-store ($api_cc)"

echo "/s3 (só POST /s3/estudio chega ao Garage)"
for m in GET PUT DELETE HEAD; do
	expect_status "$m /s3/estudio" 404 -X "$m" "$BASE/s3/estudio"
	expect_status "$m /s3/estudio/originals/x.jpg" 404 -X "$m" "$BASE/s3/estudio/originals/x.jpg"
done
expect_status "GET /s3" 404 "$BASE/s3"
expect_status "POST /s3/outro-bucket" 404 -X POST "$BASE/s3/outro-bucket"
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST -F "key=originals/x.jpg" -F "file=@/dev/null" "$BASE/s3/estudio")
[[ $code == 4* ]] && ok "POST /s3/estudio sem política rejeitado pelo Garage ($code)" || ko "POST sem política: $code"

echo "Transporte e portas"
redir=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "http://$host/estudio")
[[ $redir == 30[18]\ https://* ]] && ok "HTTP redireciona para HTTPS ($redir)" || ko "HTTP sem redirecionamento ($redir)"
published=$($COMPOSE ps --format '{{.Service}} {{.Publishers}}' 2>/dev/null)
others=$(awk '$1 != "caddy" && $0 ~ /PublishedPort:[1-9]/' <<<"$published")
[[ -z $others ]] && ok "só o Caddy publica portas" || ko "outros serviços publicam portas: $others"
for port in 3900 3901 3903 8080; do
	if curl -s --max-time 2 "http://127.0.0.1:$port" >/dev/null 2>&1; then ko "porta $port acessível"; else ok "porta $port fechada"; fi
done

if [[ -n ${ESTUDIO_SECRET:-} ]]; then
	echo "Cookie de sessão"
	cookie=$("${CURL[@]}" -D - -o /dev/null -X POST -H "Origin: $BASE" -H "Content-Type: application/json" \
		-d "{\"secret\":\"$ESTUDIO_SECRET\"}" "$BASE/api/auth/login" | grep -i '^set-cookie:' | tr -d '\r')
	for attr in "__Host-sid=" "HttpOnly" "Secure" "SameSite=Strict" "Path=/"; do
		[[ $cookie == *"$attr"* ]] && ok "cookie com $attr" || ko "cookie sem $attr"
	done
	[[ $cookie != *Domain=* ]] && ok "cookie sem Domain" || ko "cookie com Domain"
else
	echo "Cookie de sessão: não verificado (defina ESTUDIO_SECRET para incluir)"
fi

echo
echo "$pass ok, $fail falhas"
[[ $fail -eq 0 ]]
