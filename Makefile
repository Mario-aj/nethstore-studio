# NethStore Estúdio. `make help` lista os alvos.
SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

COMPOSE      := docker compose --project-directory . -f deploy/docker-compose.yml
COMPOSE_TEST := docker compose --project-directory . -f deploy/docker-compose.test.yml --env-file deploy/test.env

GOLANGCI_IMAGE := golangci/golangci-lint:v2.15.0@sha256:fbfcfd12a6f8d7f1b97b3362ca80fc2a244d46863148c73cb88e7793af96c481
GITLEAKS_IMAGE := zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
GOVULNCHECK    := golang.org/x/vuln/cmd/govulncheck@v1.9.0
GOSEC          := github.com/securego/gosec/v2/cmd/gosec@v2.30.0

# Cobertura mínima de 80% (SPEC 15). storage só chega lá com os testes de
# integração, por isso o seu limite é verificado em make test-integration.
COVER_PKGS := auth stamp jobs

.PHONY: help
help: ## Lista os alvos
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- operação -----------------------------------------------------------------

.PHONY: init
init: ## Gera o .env, sobe o Garage e cria bucket e chave da API
	@scripts/init.sh

.PHONY: up
up: ## Constrói e sobe a stack (Caddy, API, Garage)
	$(COMPOSE) up -d --build --wait

.PHONY: down
down: ## Para a stack (os dados ficam nos volumes)
	$(COMPOSE) down

.PHONY: logs
logs: ## Segue os logs
	$(COMPOSE) logs -f --tail=200

.PHONY: ps
ps: ## Estado dos contentores
	$(COMPOSE) ps

.PHONY: secret
secret: ## Gera uma nova chave de acesso (mostrada uma vez) e revoga as sessões
	$(COMPOSE) exec -T api /usr/local/bin/estudio secret rotate

.PHONY: sessions-list
sessions-list: ## Lista as sessões ativas
	$(COMPOSE) exec -T api /usr/local/bin/estudio sessions list

.PHONY: sessions-revoke
sessions-revoke: ## Revoga todas as sessões
	$(COMPOSE) exec -T api /usr/local/bin/estudio sessions revoke-all

.PHONY: ca-export
ca-export: ## Copia o certificado raiz da CA do Caddy para deploy/ca/
	$(COMPOSE) cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/ca/estudio-root.crt
	@echo "Certificado em deploy/ca/estudio-root.crt (instalar no telemóvel, ver docs/INSTALAR-NO-TELEMOVEL.md)"

.PHONY: backup
backup: ## Cópia consistente do SQLite e do Garage em backups/AAAA-MM-DD/
	@COMPOSE="$(COMPOSE)" scripts/backup.sh

.PHONY: restore
restore: ## Restaura um backup: make restore DATE=AAAA-MM-DD
	@COMPOSE="$(COMPOSE)" scripts/restore.sh "$(DATE)"

# --- qualidade ------------------------------------------------------------------

.PHONY: check
check: check-api check-web ## Lint e testes unitários (Go e web)

.PHONY: check-api
check-api: ## gofmt, vet, golangci-lint e testes Go com -race e cobertura
	@cd api && test -z "$$(gofmt -l .)" || { echo "gofmt: ficheiros por formatar:"; gofmt -l .; exit 1; }
	cd api && go vet ./...
	docker run --rm -v "$(CURDIR)/api:/src" -w /src -v estudio-golangci-cache:/root/.cache $(GOLANGCI_IMAGE) golangci-lint run ./...
	cd api && go test -race -count=1 -coverprofile=coverage.out ./...
	@scripts/coverage-gate.sh api/coverage.out $(COVER_PKGS)

.PHONY: check-web
check-web: ## eslint, prettier, tsc e Vitest
	cd web && pnpm install --frozen-lockfile --silent
	cd web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test

.PHONY: test-integration
test-integration: ## Testes de integração Go contra um Garage real
	@COMPOSE_TEST="$(COMPOSE_TEST)" scripts/test-integration.sh

.PHONY: e2e
e2e: ## Playwright contra a stack (make up antes). ATENÇÃO: troca a chave de acesso
	@scripts/e2e.sh

.PHONY: audit
audit: ## govulncheck, gosec, pnpm audit e gitleaks
	cd api && go run $(GOVULNCHECK) ./...
	cd api && go run $(GOSEC) -quiet -severity medium -exclude-generated ./...
	cd web && pnpm audit --audit-level high
	docker run --rm -v "$(CURDIR):/repo" $(GITLEAKS_IMAGE) git --no-banner --redact --config /repo/.gitleaks.toml /repo

.PHONY: security-check
security-check: ## curl contra a stack: cabeçalhos, cookies, 401, 403, 404 do /s3
	@scripts/security-check.sh

# --- desenvolvimento ------------------------------------------------------------

.PHONY: dev-web
dev-web: ## Vite em modo dev com proxy para a stack local (https://localhost)
	cd web && pnpm dev
