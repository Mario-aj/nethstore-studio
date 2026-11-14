# Decisões e diferenças em relação à spec

Este ficheiro registra o que mudou ou foi decidido além do que está em `docs/SPEC.md` (spec técnica) e `docs/FRONTEND-SPEC.md` (spec do frontend). Cada item diz o quê, por quê e onde.

## Decididas com a dona do projeto (sessão de 13/11/2026)

1. **Estilos: CSS Modules com variáveis CSS**, como na SPEC seção 3. Nada de Tailwind nem de Next.js.
2. **Fonte de verdade.** Visual e textos seguem o design (`docs/design/`) e `docs/FRONTEND-SPEC.md`. Comportamento, API, segurança e dados seguem `docs/SPEC.md`. Os tokens usados são os da spec do frontend (conjunto mais completo; `surface-1`, `surface-2`, `error`), não os da SPEC 11.6.
3. **Dois modos de deploy** escolhidos por `DEPLOY_MODE` no `.env`:
   * `lan` (padrão): o que a SPEC descreve. Caddy com `tls internal` para o IP `LAN_HOST`, CA instalada no telemóvel.
   * `public`: domínio (`PUBLIC_DOMAIN`), certificado Let's Encrypt automático do Caddy, HSTS, portas 80 e 443 abertas. Serve para VPS ou para o computador de casa com redirecionamento de portas. O Cloudflare Tunnel fica só documentado em `docs/OPERACAO.md`.
   * Mesmas imagens e mesmo Compose nos dois modos. Instalação por `git clone`, `make init`, `make up`, com as imagens construídas no próprio servidor (sem registry).
4. **Textos que falam de "casa".** `GET /api/config` (pública) devolve o modo. As frases que só fazem sentido na rede de casa têm uma variante neutra para o modo `public` em `web/src/shared/i18n/pt-AO.ts`. O passo 1 de "Instalar" na landing mostra o endereço real (`location.host`), o que fecha o item em aberto da spec do frontend. A instalação da CA fica só em `docs/INSTALAR-NO-TELEMOVEL.md`.
5. **Bloqueio global de login** controlado por `LOGIN_GLOBAL_LOCKOUT`: ligado por padrão no `lan`, desligado por padrão no `public` (na internet, qualquer pessoa conseguiria travar o acesso da dona). O limite por IP e o aviso no log continuam nos dois modos.
6. **"Restam N tentativas".** Limites da SPEC 12.3 mantidos. O erro `401 invalid_secret` traz `remainingAttempts`. A interface mostra "Restam N tentativas" quando N ≤ 3 e a contagem do bloqueio vem do `Retry-After` do `429`.
7. **Carimbo** como na SPEC 9.3 (Work Sans Medium, 3,4 % da largura, `#111111` com troca automática para branco em fundo escuro). Isto resolve o item em aberto da spec do frontend. Ajuste fino em `stamp.Layout` depois de testar com fotos reais.
8. **Fotos reais da loja** só como assets da landing e da Entrada, extraídas do design e convertidas para WebP. Testes e imagens golden usam apenas imagens sintéticas.
9. **Indexação.** A landing (`/`) é indexável. `/entrar`, `/estudio/*` e qualquer outro caminho recebem `X-Robots-Tag: noindex` do Caddy. `robots.txt` bloqueia só `/api` e `/s3`; `sitemap.xml` lista só `/`. `index.html` tem título, descrição e Open Graph com a foto do hero; as URLs absolutas vêm de `APP_ORIGIN` no build da imagem.
10. **QA** com a skill `qa-criterios`, critérios tirados da SPEC 18 e das tabelas de estados da spec do frontend, contra a stack local. Relatório em `docs/QA-REPORT.md`, sem Jira.
11. **Repositório**: a raiz é a própria pasta `nethstore-studio` (a SPEC chama-a `estudio/`). Remoto no GitHub (`Mario-aj/nethstore-studio`) desde 14/11/2026. O CI (`.github/workflows/ci.yml`) corre em cada pull request e em cada push para `main`: `make check`, `make test-integration`, `make e2e` com `make security-check` numa stack descartável, e `make audit`.
12. O ficheiro `docs/NethStore Estúdio especificação do frontend.md` passou a chamar-se `docs/FRONTEND-SPEC.md` (sem espaços nem acentos, mais fácil de referenciar em scripts e links).

## Acréscimos ao contrato da API

* `GET /api/config` (pública): `{ "deployMode": "lan" | "public" }`. Não expõe mais nada.
* `401 invalid_secret`: `{ "error": { "code": "invalid_secret", "message": "...", "remainingAttempts": 2 } }`.
* `429 too_many_attempts`: além do cabeçalho `Retry-After`, o corpo traz `retryAfterSeconds` (o mesmo valor), para a interface não depender de ler cabeçalhos.
* `POST /api/photos/{id}/upload-failed`: a app avisa que desistiu de enviar uma foto (3 tentativas esgotadas, ou a página recarregou e o ficheiro já não está em memória). A foto passa de `awaiting_upload` para `failed` com `failedStep = upload` e `errorCode = upload_failed`. `204`. Sem isto o lote nunca ficaria `finished` até o zelador agir (24 h). `upload-slot` volta a aceitar a foto, como a SPEC já previa.
* `GET /api/batches/{id}` também traz `photoCount`. `steps.ready` não traz `done`/`total`.
* `GET /api/batches?limit=10&before=<seq>` devolve `{ "batches": [ { "id", "seq", "priceKz", "sizes", "description", "stampLine1", "stampLine2", "photoCount", "stampedCount", "failedCount", "finished", "createdAt", "coverPhotoId" } ], "nextBefore": 12 }`, do mais novo para o mais velho. `limit` vai de 1 a 50 (padrão 10). `before` (opcional) é o `seq` a partir do qual a página começa, exclusivo. `nextBefore` é o `before` da página seguinte, ou `null` na última. `coverPhotoId` é a primeira foto carimbada pela posição (a capa na lista de lotes), ou `null` se nenhuma ficou pronta. Acrescentado em 14/11/2026 para a tela Lotes.
* Estado da etapa `ready`: `completed` quando nada está em andamento e há ao menos uma foto pronta; `error` quando nada está em andamento e nenhuma ficou pronta; `pending` no resto.

### Códigos de erro da API

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `invalid_json` | Corpo que não é JSON válido ou tem campos desconhecidos |
| 400 | `invalid_format` | Chave sem 32 caracteres base62 |
| 400 | `invalid_price` | `priceKz` fora de 1 a 9 999 999 |
| 400 | `invalid_sizes` | Tamanhos vazios, repetidos ou desconhecidos |
| 400 | `invalid_description` | Descrição com mais de 24 caracteres ou caracteres proibidos |
| 400 | `invalid_photo_count` | `photoCount` fora de 1 a 50 |
| 400 | `invalid_id` | ID do caminho não é UUID |
| 400 | `invalid_limit` | `limit` da lista de lotes fora de 1 a 50 |
| 400 | `invalid_before` | `before` da lista de lotes não é um inteiro positivo |
| 401 | `unauthenticated` | Sem sessão válida |
| 401 | `invalid_secret` | Chave errada |
| 403 | `forbidden_origin` | `Origin` diferente de `APP_ORIGIN` |
| 404 | `not_found` | Lote, foto ou rota inexistente |
| 404 | `not_ready` | Foto ainda sem carimbo |
| 405 | `method_not_allowed` | Método não suportado na rota |
| 409 | `object_missing` | Confirmação de envio sem objeto no armazenamento |
| 409 | `invalid_object_size` | Objeto enviado fora dos limites de tamanho |
| 409 | `invalid_state` | Ação incompatível com o estado da foto |
| 413 | `payload_too_large` | Corpo acima de 64 KB |
| 415 | `unsupported_media_type` | Método que altera estado sem `Content-Type: application/json` |
| 429 | `too_many_attempts` | Limite de tentativas de login |
| 429 | `too_many_open_batches` | Já há 5 lotes com fotos por enviar |
| 500 | `internal` | Erro inesperado (detalhe só no log, com `request_id`) |
| 503 | `storage_unavailable` | Armazenamento fora do ar |

### Códigos de erro por foto (`errorCode`)

| `errorCode` | Etapa | Significado |
| --- | --- | --- |
| `upload_failed` | upload | A app desistiu de enviar (tentativas esgotadas ou ficheiro perdido) |
| `upload_expired` | upload | Ficou mais de 24 h à espera de envio (zelador) |
| `invalid_image` | prepare | Não é JPEG, ou dimensões fora dos limites |
| `processing_failed` | prepare ou stamp | Erro transitório que esgotou as 3 tentativas |

## Diferenças técnicas

* **Miniatura carimbada.** A SPEC gera a miniatura na etapa `prepare`, ou seja, sem carimbo. As telas Processamento ("Já prontas") e Pronto mostram miniaturas carimbadas. A etapa `stamp` volta a gravar a miniatura, agora a partir da imagem carimbada, na mesma chave `thumbs/`.
* **Perda de ligação durante o envio.** Erros de rede (sem resposta) pausam a fila inteira e tentam de novo a cada 8 s, sem gastar as 3 tentativas da foto. Só respostas de erro do armazenamento ou da API contam como tentativa. Isto reproduz o estado "Sem ligação" do design.
* **Partilhar em grupos de 10.** `navigator.share` exige um toque por chamada. Com mais de 10 fotos, depois de partilhar o primeiro grupo o botão passa a "Partilhar as próximas N".
* **Tentativas de processamento.** "Até 3 tentativas, espera de 5 s, 30 s e 2 min" foi lido como 1 execução mais 3 novas tentativas, uma para cada espera. Depois disso a foto fica `failed` com `processing_failed`.
* **Tentativas de login recusadas pelo limite não são gravadas** em `login_attempts`. Se fossem, quem insiste durante o bloqueio estenderia o bloqueio para sempre. As tentativas avaliadas (certas e erradas) são todas gravadas.
* **Coluna nova `batches.originals_purged_at`** (migração `0002`). O zelador marca o lote depois de apagar originais e miniaturas, para não listar os mesmos prefixos todos os dias. A rota `/thumb` usa a foto carimbada quando a miniatura já foi apagada.
* **Rede interna.** API e Garage ficam numa rede Docker `internal: true` (sem saída para a internet). Só o Caddy está também na rede `edge` e publica portas.
* **IP real do cliente.** A API resolve o nome do contêiner do Caddy (`TRUSTED_PROXY_HOST=caddy`) e só então lê o último valor de `X-Forwarded-For`.
* **Comandos extra no binário**: `estudio healthcheck` (a imagem distroless não tem curl) e `estudio backup` (cópia consistente com `VACUUM INTO` para a saída padrão, usada por `make backup`).
* **Toolchain Go fixado em 1.26.11** (`toolchain` no `go.mod`): o 1.26.3 da máquina tinha vulnerabilidades conhecidas na biblioteca padrão, que o `govulncheck` apontava.
* **Política POST pelo SDK.** O `PresignPostObject` do `aws-sdk-go-v2` funcionou contra o Garage 2.5.0, então não há assinador próprio. Os nomes `x-amz-*` vão em minúsculas nos campos, como no exemplo da SPEC.
* **Garage 2.5.0** (última 2.x estável em 13/11/2026). A chave S3 da API é gerada pelo `make init` e importada com `garage key import`, o que torna o `garage-init.sh` idempotente sem precisar ler segredos da saída do Garage.
* **`make reset-data` (pedido de 14/11/2026, fora da SPEC 13).** Apaga todos os lotes e fotos de uma vez: esvazia os volumes `api-data`, `garage-meta` e `garage-data`, volta a correr o `garage-init.sh` (só o `make up` não recria layout, bucket nem chave) e gera uma chave de acesso nova, porque a antiga vivia na base apagada. Mantém o `.env`, a CA do Caddy e os backups. Pede `APAGAR`, como o `make restore` pede `RESTAURAR`.
* **Log do `/api/health`** a cada 10 s (health check do contêiner) vai em nível `debug`, para não encher o log.

## Frontend

## Versões

- TypeScript 6.0.3 (o typescript-eslint 8.72 aceita até `<6.1`; o TS 7 ficou de fora por isso).
- Vite 8, React 19.3, React Router 8, TanStack Query 5, zod 4, vite-plugin-pwa 2, Vitest 5, MSW 3 (a opção chama-se `onUnhandledFrame`, não `onUnhandledRequest`), Playwright 1.65, ESLint 10.
- `tsconfig.app.json` (código), `tsconfig.test.json` (testes, com tipos de Node) e `tsconfig.node.json` (configs e e2e). `tsc -b` cobre os três.

### Visual e textos

- As fotos do design são 5: vestido preto de bolinhas, conjunto laranja, conjunto azul e branco, vestido bege e blusa magenta. A blusa lilás e o vestido com faixa vinho da faixa "Como funciona" não estão no export, então a 6.ª foto da faixa repete o conjunto laranja.
- `pnpm assets` extrai as fotos de `docs/design/*.html` (WebP 480/800/1200 em `src/assets/photos`), gera `public/og-image.jpg` (1200x630) e os ícones da PWA (`public/icons`, `public/favicon.svg`). Os ficheiros gerados ficam no repositório.
- O carimbo desenhado por cima das fotos na landing usa Work Sans 500 (a fonte real do carimbo, SPEC 9.3) em vez do Arial bold do canvas.
- A landing tem um menu suspenso com os 3 links atrás do botão de menu (o design só mostra o botão). "Entrar" e "Entrar no estúdio" levam a `/entrar`.
- O comparador Depois/Antes usa um `<input type="range">` invisível por cima da foto: arrasta com o dedo e funciona com as setas do teclado.
- Passo 1 de "Instalar": "O endereço é o do computador onde o Estúdio corre: {host}." No modo `public`: "O endereço do Estúdio é {host}."
- Frases com variante para o modo `public` (`deployText` em `pt-AO.ts`): nota do hero, título e texto do passo 1 de Instalar, "A confirmar…" da Entrada, aviso "fora de alcance" da Entrada, mensagem "Podes bloquear o telemóvel…" e aviso "Perdeste a ligação…" do Processamento.
- Em ecrãs largos as telas do app ficam numa coluna centrada de 560 px.

### Comportamento

- Entrada, "Muitas tentativas": a chave escrita fica no campo (bloqueado), para poder entrar logo que a contagem acaba. O design mostra 0/32.
- Fotos e preço: os tamanhos também são obrigatórios para "Processar" (a API exige 1 a 6). Sem tamanhos o rodapé mostra "falta o tamanho" em coral.
- **Descrição padrão "Veste" (pedido de 14/11/2026).** Num lote novo o campo Descrição já vem com "Veste", a peça mais comum. Continua opcional: apagar o texto manda o lote sem descrição, e o carimbo fica só com os tamanhos. O valor está em `t.create.descriptionDefault`.
- O rótulo PREÇO fica coral e aparece "Escreve o preço para processar." assim que há fotos e o preço está vazio (estado "Preço em falta").
- A faixa de miniaturas rola na horizontal com todas as fotos (design) em vez do "+N na última" da SPEC.
- "Ver todas" usa o hash `#todas`, para o botão voltar do Android fechar a grelha.
- Processamento: as etapas são calculadas no cliente a partir do estado de cada foto, com as mesmas regras da API (SPEC 7.3 e DECISOES). O cliente junta o que o gestor de envio já sabe (uma foto enviada antes do próximo polling, ou que falhou no envio) ao estado do servidor.
- No estado "Uma foto falhou" a etapa "Pronto para guardar" aparece pendente (0/N) até a utilizadora escolher "Seguir com N" ou "Repetir", como no design, embora a API a dê como `completed`.
- A miniatura usa `?v=s` (carimbada) ou `?v=p` (falhou no carimbo) no URL para o browser não reaproveitar uma miniatura antiga em cache depois de "Repetir" (a API manda `max-age=3600`). **A API tem de ignorar a query string nessas rotas.**
- Uma foto que o browser não consegue decodificar falha logo no envio, sem gastar as 3 tentativas.
- Depois de recarregar a página, as fotos ainda em `awaiting_upload` sem ficheiro em memória são reportadas com `upload-failed` e aparece "Escolher de novo": os ficheiros escolhidos são atribuídos às fotos em falta pela ordem das posições.
- "Ligação de volta" aparece 5 s depois de a ligação voltar. "Saíste do app durante o envio" aparece ao voltar se a página ficou oculta durante o envio.
- Partilhar: grupos de 10; o grupo seguinte é descarregado antes do toque, porque `navigator.share` tem de correr logo a seguir a ele.
- Guardar todas: downloads em sequência com 350 ms de intervalo, nome tirado do `Content-Disposition`.
- **Guardar no iPhone e no iPad (pedido de 14/11/2026, fora da SPEC, que só previa Android).** No iOS cada `<a download>` abre um ecrã de pré-visualização separado e o ficheiro vai para Ficheiros, não para Fotos. Por isso, em iOS (qualquer browser, detetado pelo user agent, iPad incluído) e com `navigator.canShare` a aceitar ficheiros, "Guardar todas na galeria" usa a folha de partilha: as fotos são todas descarregadas ao abrir a tela ("A preparar N de M") e um toque abre a folha com todas, onde se escolhe "Guardar imagens". Se `canShare` recusar o lote inteiro, o mesmo toque envia as 10 primeiras. Se a folha falhar com mais de 10 fotos, a app passa a grupos de 10 ("Guardar as próximas N"). No Android e no computador continua o download em sequência.
- **Pré-visualização (pedido de 14/11/2026, não está no design).** Tocar numa miniatura da tela Pronto abre um visualizador de ecrã inteiro (`<dialog>` modal) com a foto carimbada em tamanho real, contador "N de M", setas, teclas ← → e Esc. O deslize é o scroll horizontal nativo com `scroll-snap` obrigatório e `scroll-snap-stop: always` (uma foto por gesto, com a inércia do sistema). Só a foto atual e as vizinhas carregam a imagem completa; por baixo aparece a miniatura já em cache. A foto aberta fica no URL (`?foto=<número>`), para o botão voltar do Android fechar o visualizador. O rodapé tem "Guardar" (só aquela foto, pelo mesmo caminho do "Guardar todas") e "Partilhar" (quando o browser partilha ficheiros).
- **Apagar lote (pedido de 14/11/2026, não está no design).** A tela Pronto tem "Apagar lote" em texto coral, discreto, no fim da página e fora do rodapé. Abre uma folha "Apagar este lote?" que diz quantas fotos saem do Estúdio e que as já guardadas na galeria ficam lá; "Cancelar" vem primeiro e recebe o foco. "Apagar" chama `DELETE /api/batches/{id}` (SPEC 7.3, já existia), troca a entrada do histórico por `/estudio` e mostra "Lote apagado." até se escolherem fotos. Um `404 not_found` conta como apagado. O botão fica desativado enquanto "Guardar todas" está a descarregar fotos. Só existe na tela Pronto: a app não tem lista de lotes antigos, e esses continuam a sair pela retenção ou pelo `make reset-data`.
- **Atualizações da app (pedido de 14/11/2026).** O browser só procura um `sw.js` novo em navegações, e a app instalada é uma página única que fica aberta dias. Por isso a app regista o service worker ela mesma (`src/app/serviceWorkerUpdates.ts`, `updateViaCache: 'none'`, sem o `useRegisterSW` do plugin) e chama `registration.update()` ao arrancar, sempre que volta ao ecrã (`visibilitychange`), quando a rede volta (`online`) e a cada 15 min enquanto está visível. No `updatefound`, quando o worker novo fica `installed` com outro a controlar a página, aparece "Nova versão disponível" com "Atualizar": a app manda `SKIP_WAITING` e recarrega no `controllerchange`. Uma versão que já estava à espera quando a app arranca é aplicada logo, porque ainda não há nada no ecrã para perder. O aviso não aparece durante um envio de fotos (recarregar perderia os ficheiros em memória) e "Agora não" só vale até a app sair do ecrã e voltar. Não há atualização totalmente automática a meio da sessão, para não apagar fotos escolhidas ou preço escrito.
- Qualquer `401 unauthenticated` numa rota protegida volta a consultar `me`, e a guarda de rota manda para `/entrar?next=…`.

### Contrato da API assumido

- POST sem corpo (`logout`, `uploaded`, `upload-slot`, `upload-failed`, `retry`) vai sem `Content-Type`.
- `upload-slot` devolve `{ url, fields, expiresAt }`. O `url` começa por `/`.
- O gestor de envio trata `409 invalid_state` em `uploaded` ou `upload-slot` como "a foto já passou do envio".

### Build, dev e testes

- `VITE_APP_ORIGIN` (sem barra no fim) entra no build: canonical, Open Graph, `robots.txt` e `sitemap.xml` (gerados pelo plugin `estudio-seo` no `vite.config.ts`). Na imagem: `VITE_APP_ORIGIN=$APP_ORIGIN pnpm build`. Sem a variável vale `https://localhost`.
- `pnpm dev` faz proxy de `/api` e `/s3` para `https://localhost` (mude com `ESTUDIO_DEV_TARGET`) e reescreve o `Origin`.
- `pnpm dev:mock` corre sem backend: MSW num service worker servido só em modo mock (nunca vai para `dist`). Cenários com `?cenario=`: `desligado`, `errada`, `bloqueada`, `verificar`, `publico`, `enviar`, `sem-ligacao`, `aplicar`, `erro`. A chave aceita é a do exemplo da SPEC 7.2.
- E2E (`pnpm e2e`): precisa de `E2E_SECRET` (chave da stack de teste) e, opcionalmente, `E2E_BASE_URL` (padrão `https://localhost`). O setup global entra uma vez pela tela e guarda a sessão em `tests/e2e/.auth/` (ignorado no git), para gastar só uma tentativa de login. "Chave errada, depois certa" corre só no perfil de 390 px. Os service workers ficam bloqueados (o da PWA esconderia os pedidos `/s3` do `page.route`), exceto em `pwa.spec.ts`.
- A falha forçada do teste "Repetir" responde `403` ao envio de uma foto 3 vezes. Um `abort` contaria como perda de ligação e pausaria a fila em vez de falhar.
- `E2E_MOCK=1 E2E_BASE_URL=http://localhost:5173 E2E_SECRET=k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E pnpm e2e` corre a suíte contra o `dev:mock` (os testes que dependem da stack real são saltados).
- Capturas: `artifacts/screens/<perfil>/<tela>.png` na raiz do repositório.
- A primeira vez: `pnpm exec playwright install chromium`.

### Correções feitas na integração

- Depois de "Repetir" uma foto que falhou no envio, o polling já tinha parado (a última resposta dizia `finished: true`). A página agora consulta o lote de novo quando os envios terminam, e o polling volta até o servidor acabar. O e2e "a failed upload is repeated with Repetir" cobre o caso.
- O Chromium do Playwright recusa registar o service worker numa origem com certificado da CA interna mesmo com `ignoreHTTPSErrors`; o `playwright.config.ts` passa `--ignore-certificate-errors`.
