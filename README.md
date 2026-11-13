# NethStore Estúdio

Carimba preço e tamanhos em grupos de até 50 fotos de roupa, de uma vez. A dona da loja escolhe as fotos no telemóvel, define preço, tamanhos e uma descrição curta, e recebe as fotos prontas para guardar na galeria ou partilhar no Instagram, TikTok e WhatsApp.

* **Frontend**: PWA em React 19 + Vite + TypeScript, CSS Modules (`web/`).
* **API**: Go 1.26, SQLite, fila de processamento no mesmo binário (`api/`).
* **Armazenamento**: Garage (S3 auto-hospedado). O navegador envia as fotos direto por POST assinado.
* **Proxy e TLS**: Caddy.

Tudo corre em Docker Compose num único computador: na rede de casa (modo `lan`) ou num servidor com domínio (modo `public`).

## Subir do zero

Requisitos: Linux (ou macOS) com Docker e Docker Compose v2, `make`, `openssl` e `git`.

```sh
git clone <este repositório> nethstore-studio
cd nethstore-studio

# Rede de casa: IP fixo do computador (reserva DHCP no router)
DEPLOY_MODE=lan LAN_HOST=192.168.1.50 make init
# ou, com domínio na internet:
# DEPLOY_MODE=public PUBLIC_DOMAIN=estudio.exemplo.com ACME_EMAIL=voce@exemplo.com make init

make up         # constrói e sobe Caddy, API e Garage
make secret     # mostra a chave de acesso uma única vez
```

Depois:

* Modo `lan`: `make ca-export` e siga [docs/INSTALAR-NO-TELEMOVEL.md](docs/INSTALAR-NO-TELEMOVEL.md) para instalar o certificado e a PWA no telemóvel.
* Modo `public`: abra `https://<domínio>` no telemóvel e instale a PWA pelo menu do Chrome.

Para experimentar nesta máquina: `DEPLOY_MODE=lan LAN_HOST=localhost make init && make up && make secret` e abra `https://localhost` (aceite o aviso do certificado, ou importe `deploy/ca/estudio-root.crt` no navegador depois de `make ca-export`).

## Comandos

`make help` lista tudo. Os principais:

| Comando | Para quê |
| --- | --- |
| `make init` | Gera o `.env` com segredos aleatórios, sobe o Garage, cria bucket e chave da API |
| `make up` / `make down` / `make logs` | Subir, parar, ver logs |
| `make secret` | Nova chave de acesso (revoga todas as sessões) |
| `make backup` / `make restore DATE=AAAA-MM-DD` | Backup e restauro |
| `make check` | Lint e testes unitários (Go e web) |
| `make test-integration` | Testes Go contra um Garage real |
| `make e2e` | Playwright contra a stack (troca a chave de acesso) |
| `make audit` / `make security-check` | Vulnerabilidades, segredos, cabeçalhos e rotas |

## Desenvolvimento

* API: `cd api && go test -race ./...`.
* Web: `cd web && pnpm install && pnpm dev` (proxy para a stack em `https://localhost`) ou `pnpm dev:mock` (sem backend, com dados simulados).
* Antes de cada commit: `make check`.

## Documentação

* [docs/SPEC.md](docs/SPEC.md): especificação técnica.
* [docs/FRONTEND-SPEC.md](docs/FRONTEND-SPEC.md) e [docs/design/](docs/design/): telas, textos e tokens.
* [docs/DECISOES.md](docs/DECISOES.md): decisões e diferenças em relação à spec.
* [docs/OPERACAO.md](docs/OPERACAO.md): instalação, modos de deploy, backup, atualização, firewall.
* [docs/INSTALAR-NO-TELEMOVEL.md](docs/INSTALAR-NO-TELEMOVEL.md): CA e PWA no Android.
* [docs/QA-REPORT.md](docs/QA-REPORT.md): o que foi testado e o que falta validar no telemóvel.

## Segurança em resumo

* Uma única chave de 32 caracteres (argon2id), sessão de 30 dias em cookie `__Host-` HttpOnly/Secure/SameSite=Strict.
* Limite de tentativas de login por IP; bloqueio global opcional.
* Só as portas 80 e 443 do Caddy ficam expostas. API e Garage numa rede interna sem saída.
* Só `POST /s3/estudio` chega ao Garage, com política assinada que fixa chave, tipo e tamanho.
* CSP estrita, sem recursos externos, fotos sem EXIF depois do processamento.
