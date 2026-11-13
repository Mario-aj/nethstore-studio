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
11. **Repositório**: a raiz é a própria pasta `nethstore-studio` (a SPEC chama-a `estudio/`). Sem remoto. Há um workflow de CI em `.github/workflows/ci.yml` pronto para quando existir.
12. O ficheiro `docs/NethStore Estúdio especificação do frontend.md` passou a chamar-se `docs/FRONTEND-SPEC.md` (sem espaços nem acentos, mais fácil de referenciar em scripts e links).

## Acréscimos ao contrato da API

* `GET /api/config` (pública): `{ "deployMode": "lan" | "public" }`. Não expõe mais nada.
* `401 invalid_secret`: `{ "error": { "code": "invalid_secret", "message": "...", "remainingAttempts": 2 } }`.
* `429 too_many_attempts`: além do cabeçalho `Retry-After`, o corpo traz `retryAfterSeconds` (o mesmo valor), para a interface não depender de ler cabeçalhos.
* `POST /api/photos/{id}/upload-failed`: a app avisa que desistiu de enviar uma foto (3 tentativas esgotadas, ou a página recarregou e o ficheiro já não está em memória). A foto passa de `awaiting_upload` para `failed` com `failedStep = upload` e `errorCode = upload_failed`. `204`. Sem isto o lote nunca ficaria `finished` até o zelador agir (24 h). `upload-slot` volta a aceitar a foto, como a SPEC já previa.
* `GET /api/batches/{id}` também traz `photoCount`. `steps.ready` não traz `done`/`total`.
* `GET /api/batches?limit=10` devolve `{ "batches": [ { "id", "seq", "priceKz", "sizes", "description", "stampLine1", "stampLine2", "photoCount", "stampedCount", "failedCount", "finished", "createdAt" } ] }`.
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
* **Log do `/api/health`** a cada 10 s (health check do contêiner) vai em nível `debug`, para não encher o log.
