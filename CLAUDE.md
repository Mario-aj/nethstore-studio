# NethStore Estúdio

Carimba preço e tamanhos em grupos de até 50 fotos de roupa. PWA para o telemóvel da dona da loja, servida por um computador de casa (modo `lan`) ou por um servidor com domínio (modo `public`).

Leia antes de mexer:

* `docs/SPEC.md`: spec técnica (arquitetura, API, dados, segurança, marcos).
* `docs/FRONTEND-SPEC.md` e `docs/design/`: visual e textos das telas.
* `docs/DECISOES.md`: tudo o que foi decidido além da spec ou diferente dela. Registre aí qualquer nova diferença.

## Decisões fixas (SPEC 3), não trocar sem perguntar

* Go 1.26, só `net/http` para rotas, `log/slog` em JSON. SQLite em WAL com `modernc.org/sqlite` (sem CGO). Uma conexão de escrita.
* Garage (S3) atrás do Caddy. Upload direto do navegador por POST policy em `/s3/estudio`; download sempre pela API com sessão, nunca URL assinada de leitura.
* Fila na tabela `jobs`, workers no mesmo binário. `disintegration/imaging` + `x/image/font/opentype` para o carimbo.
* Frontend: Vite, React 19, TypeScript estrito, React Router, TanStack Query, **CSS Modules com variáveis CSS** (nada de Tailwind nem Next.js), zod, `vite-plugin-pwa`, Work Sans local. pnpm.
* Docker Compose com imagens fixadas por digest.

## Segurança (SPEC 12), não negociável

* Toda rota da API exige sessão, exceto `GET /api/health`, `GET /api/config` e `POST /api/auth/login`.
* Métodos que alteram estado exigem `Origin == APP_ORIGIN` e `Content-Type: application/json` quando há corpo. Corpo JSON até 64 KB, campos desconhecidos rejeitados.
* Cookie `__Host-sid`, HttpOnly, Secure, SameSite=Strict. No banco só o SHA-256 do token. Chave de acesso só em argon2id.
* Nunca registrar em log: chave, token, cookies, campos da política, assinaturas.
* CSP estrita sem `unsafe-inline` e nenhum pedido a outro domínio.
* Cada item da SPEC 12.8 tem teste automatizado. Mantenha-os verdes.

## Comandos

* `make check`: gofmt, vet, golangci-lint, testes Go com `-race` e cobertura, eslint, prettier, tsc, Vitest.
* `make test-integration`: testes Go contra um Garage real descartável.
* `make init`, `make up`, `make secret`, `make e2e`, `make audit`, `make security-check`.

## Convenções

* Código e commits em inglês. Interface em português de Angola (tratamento por "tu"). Documentação em português do Brasil.
* Um commit por passo lógico. Nunca commitar `.env`, `deploy/ca/` nem fotos reais em testes.
