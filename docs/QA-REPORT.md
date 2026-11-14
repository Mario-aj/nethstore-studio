# Relatório de QA

Data: 13/11/2026. Stack local em modo `lan` com `LAN_HOST=localhost` (Caddy 2.11.9, Garage 2.5.0, API Go 1.26.11), a partir do commit `c69e911` mais as correções listadas abaixo.

## Resultado

| Verificação | Resultado |
| --- | --- |
| `make check` (gofmt, vet, golangci-lint, `go test -race` com cobertura, eslint, prettier, tsc, Vitest) | Verde. Go: 8 pacotes; web: 11 ficheiros, 119 testes |
| Cobertura mínima de 80 % (SPEC 15) | auth 87,3 %, stamp 95,3 %, jobs 85,4 % (unitários); storage 89,5 % (com integração) |
| `make test-integration` (Garage real) | Verde. Os casos da SPEC 8 passam, mais campo fora da política e assinatura adulterada |
| Fuzz (corpo do lote, descrição, `DecodeConfig`) | 15 a 20 s cada, sem achados |
| `make e2e` (Playwright, 390/834/1440, axe) | 28 passaram, 14 saltados de propósito (testes que só correm num perfil), 0 falhas |
| `make security-check` | 36 ok, 0 falhas (também depois de um `make restore`) |
| `make audit` | govulncheck: nenhuma vulnerabilidade; gosec: 0; gitleaks: nenhum segredo no histórico; `pnpm audit`: 1 baixa e 2 moderadas (ver abaixo) |
| QA manual com a skill `qa-criterios` | 13 critérios: 13 passaram, 0 falharam, 0 não testados. Detalhe em [qa/nethstore-api-2026-11-13-2321.md](qa/nethstore-api-2026-11-13-2321.md) e [qa/nethstore-browser-2026-11-13-2323.md](qa/nethstore-browser-2026-11-13-2323.md) |
| `make backup` e `make restore` | Backup com SQLite íntegro (`pragma integrity_check` = ok); restauro devolveu o estado do backup |
| Revisão visual das capturas contra `docs/design/` | Feita para as 17 telas do app e a landing nas 3 larguras; sem diferenças de cor, tipografia ou texto além das registradas em `DECISOES.md` |

## Marcos (SPEC 18)

| Marco | Estado | Evidência |
| --- | --- | --- |
| M1 Base e infraestrutura | Aceito | `GET https://localhost/api/health` → 200 com TLS interno verificado pela CA exportada; só o Caddy publica 80 e 443; `make check` verde |
| M2 Autenticação | Aceito | Itens 1 a 7, 15 e 16 da SPEC 12.8 com testes automatizados verdes (tabela abaixo) |
| M3 Lotes e uploads | Aceito | Integração contra Garage prova os casos da SPEC 8; itens 8 e 9 verdes |
| M4 Processamento e carimbo | Aceito | Golden tests verdes; lote de 50 imagens sintéticas sem erros (`TestFiftyPhotosBatch`); itens 10 a 12 verdes |
| M5 Aplicação | Aceito | Vitest verde; fluxo completo no Playwright em 390 px; capturas revistas |
| M6 Landing e PWA | Aceito | Playwright nos 3 tamanhos; manifest válido; service worker registado; item 14 verde |
| M7 Endurecimento e QA final | Aceito, com achados moderados explicados abaixo | Este relatório |
| M8 Documentação | Feito | `README.md`, `docs/OPERACAO.md`, `docs/INSTALAR-NO-TELEMOVEL.md` (sem capturas do Android, ver pendências), `docs/DECISOES.md` |

## Lista de verificação de segurança (SPEC 12.8)

| # | Item | Teste automatizado |
| --- | --- | --- |
| 1 | Rotas protegidas → 401 sem cookie | `httpapi.TestEveryProtectedRouteNeedsSession` (percorre a tabela de rotas), `security-check` |
| 2 | Cookie `__Host-`, HttpOnly, Secure, SameSite=Strict | `httpapi.TestCookieFlags`, `security-check` com `ESTUDIO_SECRET` |
| 3 | Origin diferente → 403 | `httpapi.TestOriginAndContentType`, `security-check` |
| 4 | `text/plain` → 415 | `httpapi.TestOriginAndContentType`, `security-check` |
| 5 | 6.ª tentativa no minuto → 429 com `Retry-After` | `auth.TestPerMinuteLimit`, `httpapi.TestLoginRateLimitOverHTTP` |
| 6 | Chave certa continua bloqueada até o fim do prazo | `auth.TestFailureLockout`, `httpapi.TestLoginRateLimitOverHTTP` |
| 7 | JSON > 64 KB → 413 | `httpapi.TestBodyLimit` (inclui corpo chunked), `security-check` |
| 8 | Upload grande, de outro tipo ou com outra chave rejeitado pelo Garage | `storage.TestPostPolicyAgainstGarage` (integração) |
| 9 | GET, PUT, DELETE em `/s3/...` → 404 | `security-check` (também HEAD, `/s3` e outro bucket) |
| 10 | JPEG 20000×20000 recusado sem decodificar | `imaging.TestNormalizeRefusesHugeWithoutDecoding` (alocação < 8 MB) |
| 11 | PNG ou texto com extensão JPEG → `invalid_image` | `imaging.TestNormalizeRejectsNonJPEG`, `jobs.TestInvalidImageFailsPermanently` |
| 12 | Foto pronta sem EXIF | `imaging.TestOutputHasNoEXIF`, `storage.TestBatchProcessedAgainstGarage`, QA C12 |
| 13 | CSP, nosniff, Referrer-Policy, Permissions-Policy, COOP no HTML | e2e `pwa.spec.ts`, `security-check` |
| 14 | Nenhuma requisição externa | e2e (as fixtures falham em qualquer pedido a outro host), QA C6 |
| 15 | Logs sem a chave nem o token | `httpapi.TestFullBatchFlowAndLogsHaveNoSecrets` |
| 16 | `secret rotate` invalida sessões | `auth.TestRotateRevokesSessions`, `httpapi.TestRotateInvalidatesSessionsOverHTTP` |

## O que falhou e foi corrigido

1. **"Repetir" depois de uma falha de envio não chegava a "Prontas".** O polling parava porque a última resposta, anterior ao reenvio, dizia `finished: true`. A página agora consulta o lote de novo quando os envios terminam. Coberto pelo e2e "a failed upload is repeated with Repetir".
2. **O teste e2e da PWA não registava o service worker.** O Chromium recusa o service worker numa origem com a CA interna, mesmo com `ignoreHTTPSErrors`. O Playwright agora arranca com `--ignore-certificate-errors`. No telemóvel, com a CA instalada, isto não se aplica.
3. **Localizador ambíguo no e2e.** O título "Prontas" também casava com "JÁ PRONTAS · N"; passou a `exact: true`.
4. **`govulncheck` com 20 vulnerabilidades da biblioteca padrão** no Go 1.26.3 da máquina. O toolchain ficou fixado em `go1.26.11` no `go.mod`; a imagem Docker já usava 1.26.11.
5. **golangci-lint e gosec** apontaram `errcheck`, `errorlint`, `noctx` e G115/G304/G704. Corrigidos no código; ficaram duas anotações `#nosec` justificadas (URL de loopback do `healthcheck` e valores falsos no utilitário de testes).
6. **gitleaks** apontava a chave de exemplo pública da SPEC 7.2, usada em testes e no modo mock. Ela foi posta na allowlist em `.gitleaks.toml`, só esse valor.
7. **`make backup`** gravava os `.tar.gz` com dono root; agora ficam com o utilizador que corre o comando.

## Achados de severidade média (explicados)

`pnpm audit` (nenhum alto ou crítico):

| Pacote | Severidade | Por onde entra | Avaliação |
| --- | --- | --- | --- |
| `glob` (GHSA-3g3m-2fjr-6pw4) | moderada | `vite-plugin-pwa` → `workbox-build` | Só no build, com caminhos do próprio repositório. Nada chega ao navegador nem ao servidor |
| `minimatch` (GHSA-g3hv-75wg-m249) | moderada | `eslint` | Só no lint, com padrões do próprio repositório |
| `deepmerge` (GHSA-gcqx-w48m-w2h4) | baixa | `workbox-build` → plugin do Rollup | Só no build, sem versão corrigida publicada |

Revisitar quando o `vite-plugin-pwa` e o `eslint` atualizarem as dependências.

## Limitações desta rodada

* **Modo `public` não foi exercido ao vivo**: não há domínio para o Let's Encrypt. O `Caddyfile.public` é validado pelo `caddy validate`, e o comportamento da API no modo `public` (bloqueio global desligado, `/api/config`) tem testes unitários.
* **Cloudflare Tunnel**: só documentado em `docs/OPERACAO.md`, não testado.
* **Teste de 50 fotos**: corre nos testes Go com imagens de 300×400 (rápido com `-race`). O e2e usa 12 imagens; a integração usa 4 de 1200×1600.
* **Cobertura do web** está em cerca de 60 %; a SPEC não define mínimo para o web.

## Validar no telemóvel real (SPEC 20)

Validado no telemóvel pelo dono do projeto em 14/11/2026: tudo conforme. A loja usa o Estúdio desde esse dia. Lista do que foi confirmado:

* O Chrome do Android aceita a CA local e trata `https://LAN_HOST` como contexto seguro: instalação da PWA, área de transferência ("Colar"), Wake Lock e partilha.
* Limite de quantidade e tamanho no `navigator.share` com 10 fotos de cerca de 600 KB (a app partilha em grupos de 10).
* O Chrome pede permissão para vários downloads seguidos; depois de aceitar, as fotos aparecem na galeria.
* `capture="environment"` abre a câmara traseira.
* Tempo real de envio de 50 fotos pela rede de casa.
* Legibilidade do carimbo em fotos reais claras e escuras (ajustar `stamp.Layout` se preciso).
* Ícone maskable e ecrã de arranque da PWA no lançador do Android.

Fica por fazer só a parte de documentação: as capturas de ecrã do passo a passo da CA em `docs/INSTALAR-NO-TELEMOVEL.md` (o guia descreve o caminho em texto).
