# NethStore Estúdio: especificação técnica v1

Este documento descreve tudo o que é preciso para construir o NethStore Estúdio do zero: arquitetura, contratos da API, modelo de dados, processamento das fotos, frontend, segurança, testes e o plano de execução. Foi escrito para ser entregue a um agente (Claude Code) que vai implementar, testar e fazer o QA sozinho, marco a marco.

Idioma do código e dos commits: inglês. Idioma da interface: português de Angola. Idioma desta spec e da documentação do repositório: português do Brasil.


## 0. Como usar este documento

* Leia o documento inteiro antes de escrever código.
* A seção 3 lista decisões fixas. Não troque nenhuma sem perguntar.
* Siga os marcos da seção 18 na ordem. Cada marco só termina quando os critérios de aceite passam e os testes estão verdes.
* Faça um commit por passo lógico, com mensagem clara. Nunca faça commit de segredos.
* Quando algo nesta spec não funcionar na prática (por exemplo, uma flag mudou numa versão nova de uma ferramenta), resolva da forma mais próxima do que está escrito e registre a diferença em `docs/DECISOES.md`.
* Itens que só dá para validar no telemóvel real ficam na seção 20. Não os marque como feitos: liste no relatório de QA.


## 1. Contexto e objetivo

A NethStore vende roupa feminina online (clientes de 18 a 50 anos) pelo Instagram, Facebook e TikTok. A dona compra fardos de roupa, veste cada peça numa manequim e fotografa. Um fardo rende cerca de 120 peças e uma compra tem de 2 a 4 fardos, então são de 240 a 480 fotos por compra.

Hoje ela edita foto a foto para escrever no canto da imagem a descrição, os tamanhos e o preço. O Estúdio automatiza isso:

1. Ela entra com uma chave de acesso.
2. Escolhe um grupo de fotos com o mesmo preço.
3. Define o preço, os tamanhos e uma descrição curta opcional.
4. O sistema envia, prepara e carimba todas as fotos do grupo.
5. Ela guarda na galeria ou partilha direto nas redes.

Tudo roda num computador da casa, acessado pelo telemóvel dela (Android, Chrome) pela rede local. Não há custo de hospedagem, fila ou armazenamento em nuvem.

Utilizadora única. Usa só o telemóvel, muitas vezes com uma mão.


## 2. Escopo do MVP

Dentro:

* Landing pública (sem dados da loja) em 390, 834 e 1440 px.
* Login por chave secreta de 32 caracteres, sessão de 30 dias.
* Criar lote: fotos + preço + tamanhos + descrição opcional.
* Upload direto para o armazenamento S3 local com POST assinado (presigned POST policy).
* Processamento em fila: validar, normalizar, gerar miniatura, aplicar carimbo.
* Tela de processamento com as quatro etapas e o estado por foto.
* Tela de resultado: ver, guardar na galeria, partilhar, repetir falhas.
* PWA instalável no Android.
* CLI de administração: gerar ou trocar a chave, revogar sessões.
* Retenção automática e backup manual.

Fora (não implementar agora):

* IA de qualquer tipo (descrição automática, agrupamento por semelhança).
* Disparo pelo WhatsApp. O modelo de dados deve permitir isso no futuro, mas nada de código agora.
* Vários utilizadores, perfis ou permissões.
* Acesso fora da rede de casa.
* iOS e HEIC. O cliente converte tudo para JPEG antes de enviar.


## 3. Decisões fixas

| Tema | Decisão |
| --- | --- |
| Backend | Go 1.26 ou mais recente, só `net/http` da biblioteca padrão para rotas, `log/slog` para logs |
| Banco | SQLite em modo WAL com `modernc.org/sqlite` (sem CGO) |
| Armazenamento | Garage (S3 compatível, auto hospedado) num contêiner |
| Cliente S3 no Go | `aws-sdk-go-v2` com endpoint próprio e endereçamento por caminho (path style) |
| Upload | POST assinado (POST policy SigV4) direto do navegador para o Garage, passando pelo Caddy no mesmo domínio |
| Download | Sempre pela API, com sessão. Nunca URL assinada de leitura |
| Fila | Tabela `jobs` no SQLite, workers dentro do mesmo binário da API |
| Imagem | `github.com/disintegration/imaging` para decodificar com orientação EXIF e redimensionar, `golang.org/x/image/font/opentype` para o texto |
| Proxy e TLS | Caddy com CA interna (`tls internal`) e certificado para o IP fixo do computador |
| Frontend | Vite, React 19, TypeScript estrito, React Router, TanStack Query, CSS Modules com variáveis CSS, `vite-plugin-pwa` |
| Validação no cliente | `zod` para validar respostas da API |
| Fonte | Work Sans hospedada localmente (`@fontsource/work-sans`), nada de Google Fonts em produção |
| Gerenciador de pacotes web | pnpm |
| Testes Go | `go test` com `-race`, testes de integração contra Garage real em contêiner, fuzz nos parsers |
| Testes web | Vitest, Testing Library, MSW, Playwright, `@axe-core/playwright` |
| Orquestração | Docker Compose, imagens fixadas por digest |

Sobre o armazenamento: o plano inicial era MinIO, mas a edição comunitária deixou de publicar imagens Docker e binários em outubro de 2025, e o repositório foi arquivado em 2026. O Garage cobre o que precisamos: API S3, PostObject com política (inclusive `content-length-range`) e é leve para um único nó.


## 4. Arquitetura

```
Telemóvel (Chrome / PWA)
        |
        |  HTTPS na rede de casa, CA local instalada no telemóvel
        v
+----------------------------------------------------------+
| Caddy  :443                                              |
|   /                  -> ficheiros estáticos (web/dist)   |
|   /api/*             -> api:8080                         |
|   POST /s3/estudio   -> garage:3900 (só este método)     |
|   qualquer outro /s3 -> 404                              |
+----------------------------------------------------------+
        |                         |
        v                         v
+-------------------+     +------------------+
| api (Go)          |---->| garage (S3)      |
|  HTTP + workers   |     |  volume de dados |
|  SQLite (volume)  |     +------------------+
+-------------------+
```

Só a porta 443 do Caddy fica exposta na rede. A porta 80 pode existir apenas para redirecionar para 443. API e Garage não publicam portas para fora da rede do Compose.

Fluxo de um lote:

1. App chama `POST /api/batches` com preço, tamanhos, descrição e quantidade de fotos. A API cria o lote, as linhas das fotos e devolve uma POST policy por foto.
2. App redimensiona cada foto num Web Worker (lado maior até 1600 px, JPEG) e envia um `multipart/form-data` para `/s3/estudio` com os campos da policy.
3. O Caddy repassa só esse POST ao Garage. O Garage valida assinatura, chave, tipo e tamanho.
4. App chama `POST /api/photos/{id}/uploaded`.
5. A API confirma o objeto com `HeadObject`, valida o tamanho e enfileira um job `process`.
6. Um worker baixa o original, valida, normaliza, gera miniatura, aplica o carimbo e grava o resultado.
7. App consulta `GET /api/batches/{id}` a cada segundo até o lote terminar.
8. App baixa miniaturas e fotos prontas por `GET /api/photos/{id}/thumb` e `/stamped`.

Por que o upload passa pelo mesmo domínio: na POST policy a assinatura cobre o documento da política, não a URL. Então o Caddy pode remover o prefixo `/s3` sem quebrar nada, o navegador fica no mesmo domínio (sem CORS) e o resto da API S3 do Garage nunca fica acessível na rede.


## 5. Rede, TLS e instalação no telemóvel

* O computador precisa de IP fixo na rede (reserva DHCP no router). Esse IP vai em `LAN_HOST`, por exemplo `192.168.1.50`.
* O Caddy emite o certificado com a CA interna dele para o IP. Como o navegador não envia SNI quando acede por IP, configure `default_sni {$LAN_HOST}` nas opções globais.
* `make ca-export` copia o certificado raiz da CA do Caddy para `deploy/ca/estudio-root.crt`.
* No Android: Definições, Segurança, Encriptação e credenciais, Instalar certificado, Certificado CA. O Android mostra o aviso de rede monitorizada, o que é esperado.
* Com a CA instalada, a origem `https://LAN_HOST` vira contexto seguro: instalação como PWA, Web Share com ficheiros, área de transferência e Wake Lock funcionam.
* Documente o passo a passo com capturas de ecrã em `docs/INSTALAR-NO-TELEMOVEL.md`.

Exemplo de Caddyfile (ajuste a sintaxe à versão fixada):

```
{
	default_sni {$LAN_HOST}
}

https://{$LAN_HOST} {
	tls internal
	encode zstd gzip

	header {
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), screen-wake-lock=(self)"
		Cross-Origin-Opener-Policy "same-origin"
		Cross-Origin-Resource-Policy "same-origin"
		-Server
	}

	@s3upload {
		method POST
		path /s3/estudio
	}
	handle @s3upload {
		request_body {
			max_size 16MB
		}
		uri strip_prefix /s3
		reverse_proxy garage:3900
	}
	handle /s3/* {
		respond 404
	}

	handle /api/* {
		request_body {
			max_size 64KB
		}
		reverse_proxy api:8080
	}

	handle {
		root * /srv/web
		@immutable path /assets/*
		header @immutable Cache-Control "public, max-age=31536000, immutable"
		@nocache path /index.html /sw.js /manifest.webmanifest
		header @nocache Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}

http://{$LAN_HOST} {
	redir https://{$LAN_HOST}{uri} permanent
}
```

Não configure `trusted_proxies` no Caddy: todos os aparelhos da casa estão em faixas privadas, e confiar nelas deixaria qualquer um forjar o `X-Forwarded-For` e fugir do limite de tentativas. Sem essa opção, o Caddy descarta o cabeçalho que vem do cliente e grava o IP real. A API lê o `X-Forwarded-For` apenas quando a conexão vem do contêiner do Caddy e usa o último valor da lista.

A ordem dos blocos `handle` precisa garantir que só `POST /s3/estudio` chega ao Garage. O item 9 da seção 12.8 testa isso.


## 6. Modelo de dados

Datas em texto RFC 3339 UTC. IDs de lote e foto em UUIDv7. Migrações em SQL embutidas no binário (`embed`), aplicadas em ordem no arranque, com tabela `schema_migrations`.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE auth_secret (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  hash        TEXT NOT NULL,          -- argon2id em formato PHC
  created_at  TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash   BLOB PRIMARY KEY,      -- SHA-256 do token, nunca o token
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ip       TEXT NOT NULL,
  at       TEXT NOT NULL,
  success  INTEGER NOT NULL CHECK (success IN (0, 1))
);
CREATE INDEX login_attempts_ip_at ON login_attempts (ip, at);
CREATE INDEX login_attempts_at ON login_attempts (at);

CREATE TABLE batches (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL UNIQUE,
  price_kz     INTEGER NOT NULL CHECK (price_kz BETWEEN 1 AND 9999999),
  sizes        TEXT NOT NULL,          -- JSON, ordem canónica
  description  TEXT,
  stamp_line1  TEXT NOT NULL,
  stamp_line2  TEXT NOT NULL,
  photo_count  INTEGER NOT NULL CHECK (photo_count BETWEEN 1 AND 50),
  created_at   TEXT NOT NULL
);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('awaiting_upload', 'uploaded', 'prepared', 'stamped', 'failed')),
  failed_step   TEXT CHECK (failed_step IN ('upload', 'prepare', 'stamp')),
  error_code    TEXT,
  original_key  TEXT NOT NULL,
  thumb_key     TEXT,
  stamped_key   TEXT,
  bytes         INTEGER,
  width         INTEGER,
  height        INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (batch_id, position)
);
CREATE INDEX photos_batch ON photos (batch_id);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id    TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('process')),
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   TEXT NOT NULL,
  locked_at   TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX jobs_ready ON jobs (status, run_after);
```

Chaves no armazenamento, sempre geradas pelo servidor:

* `originals/{batchId}/{photoId}.jpg`
* `thumbs/{batchId}/{photoId}.jpg`
* `stamped/{batchId}/{photoId}.jpg`

Use um pool de conexões com `SetMaxOpenConns(1)` para escrita, ou serialize as escritas de outra forma. Leituras podem usar um segundo pool.


## 7. API

Base `/api`. JSON em camelCase. Respostas da API com `Cache-Control: no-store`, exceto imagens.

Erros sempre neste formato, com códigos estáveis que o frontend traduz para português de Angola:

```json
{ "error": { "code": "invalid_price", "message": "price must be between 1 and 9999999" } }
```

Regras gerais:

* Toda rota exige sessão válida no cookie, exceto `GET /api/health` e `POST /api/auth/login`. Sem sessão: `401 unauthenticated`.
* Todo método que altera estado, inclusive o login, exige o cabeçalho `Origin` igual a `APP_ORIGIN` e `Content-Type: application/json` quando há corpo. Senão: `403 forbidden_origin` ou `415 unsupported_media_type`.
* Corpo JSON limitado a 64 KB com `http.MaxBytesReader`. Campos desconhecidos são rejeitados (`DisallowUnknownFields`).
* IDs nos caminhos são validados como UUID antes de qualquer consulta.

### 7.1 Saúde

`GET /api/health` (pública)

```json
{ "status": "ok" }
```

Não expõe versão, caminhos nem estado interno. A tela de entrada usa esta rota para mostrar "Computador ligado".

### 7.2 Autenticação

`POST /api/auth/login`

```json
{ "secret": "k7Qm2xVb9Lp4TzR8nWc1Hs6YdJ3fGa5E" }
```

* `204` com `Set-Cookie` em caso de sucesso.
* `400 invalid_format` se não tiver exatamente 32 caracteres do alfabeto base62.
* `401 invalid_secret` se a chave não confere.
* `429 too_many_attempts` com `Retry-After` em segundos.

`POST /api/auth/logout` apaga a sessão atual e o cookie. `204`.

`GET /api/auth/me`

```json
{ "authenticated": true, "expiresAt": "2026-12-13T19:00:00Z" }
```

### 7.3 Lotes

`POST /api/batches`

```json
{ "priceKz": 10000, "sizes": ["L", "M"], "description": "Veste", "photoCount": 12 }
```

Validação:

* `priceKz`: inteiro de 1 a 9 999 999.
* `sizes`: de 1 a 6 itens, sem repetição, só `XS`, `S`, `M`, `L`, `XL`, `2XL`. O servidor guarda em ordem canónica.
* `description`: opcional. Aplicar normalização NFC, remover espaços nas pontas e colapsar espaços internos. Vazia vira ausente. Até 24 caracteres. Só letras, números, espaço e `. , ' ( ) & +`. Rejeitar caracteres de controlo e a barra `/` (é o separador do carimbo).
* `photoCount`: de 1 a 50.
* No máximo 5 lotes com fotos ainda por enviar ao mesmo tempo (`429 too_many_open_batches`).

Resposta `201`:

```json
{
  "id": "01933f6e-...",
  "seq": 7,
  "stampLine1": "Veste/ M e L",
  "stampLine2": "10.000 kz",
  "photos": [
    {
      "id": "01933f6e-...",
      "position": 1,
      "upload": {
        "url": "/s3/estudio",
        "fields": {
          "key": "originals/01933f6e.../01933f6e....jpg",
          "Content-Type": "image/jpeg",
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": "GK.../20261113/garage/s3/aws4_request",
          "x-amz-date": "20261113T190000Z",
          "policy": "eyJl...",
          "x-amz-signature": "a1b2..."
        },
        "expiresAt": "2026-11-13T19:15:00Z"
      }
    }
  ]
}
```

`GET /api/batches?limit=10` lista os lotes recentes com contagens resumidas, do mais novo para o mais velho.

`GET /api/batches/{id}`

```json
{
  "id": "01933f6e-...",
  "seq": 7,
  "priceKz": 10000,
  "sizes": ["M", "L"],
  "description": "Veste",
  "stampLine1": "Veste/ M e L",
  "stampLine2": "10.000 kz",
  "createdAt": "2026-11-13T19:00:00Z",
  "steps": {
    "upload":  { "state": "completed", "done": 12, "total": 12 },
    "prepare": { "state": "completed", "done": 12, "total": 12 },
    "stamp":   { "state": "loading",   "done": 7,  "total": 12 },
    "ready":   { "state": "pending" }
  },
  "failedCount": 1,
  "finished": false,
  "photos": [
    { "id": "01933f6e-...", "position": 1, "status": "stamped", "failedStep": null, "errorCode": null }
  ]
}
```

Regras das etapas (`state` é `pending`, `loading`, `completed` ou `error`):

* `done` conta as fotos que passaram da etapa. `total` é o total de fotos do lote.
* `pending` quando nenhuma foto chegou à etapa e a anterior ainda não terminou.
* `loading` enquanto houver ao menos uma foto a caminho ou dentro da etapa.
* `completed` quando toda foto passou da etapa ou falhou numa etapa anterior.
* `error` quando a etapa terminou e houve falhas nela.
* `ready` fica `completed` quando nenhuma foto está em andamento e ao menos uma está pronta. `finished` fica `true` quando nenhuma foto está em andamento.

`DELETE /api/batches/{id}` apaga o lote, as linhas e os objetos no armazenamento. `204`.

### 7.4 Fotos

`POST /api/photos/{id}/uploaded`: a app confirma o envio. A API faz `HeadObject`, confere que o objeto existe, que o tamanho está dentro dos limites e que o estado era `awaiting_upload`. Muda para `uploaded` e enfileira `process`. `202`. Se o objeto não existir: `409 object_missing`.

`POST /api/photos/{id}/upload-slot`: nova POST policy para uma foto ainda em `awaiting_upload` ou que falhou no envio. Volta o estado para `awaiting_upload`. `200` com o mesmo formato de `upload` acima.

`POST /api/photos/{id}/retry`: para uma foto que falhou em `prepare` ou `stamp`, enfileira de novo. `202`.

`GET /api/photos/{id}/thumb`: miniatura JPEG. `Cache-Control: private, max-age=3600`.

`GET /api/photos/{id}/stamped`: foto pronta. `Content-Type: image/jpeg`, `Content-Disposition: attachment; filename="nethstore-007-003.jpg"` (lote 7, foto 3). `Cache-Control: private, max-age=3600`. `404` se não estiver pronta.

As duas rotas de imagem fazem streaming do Garage para o cliente, sem carregar o ficheiro inteiro em memória.


## 8. Upload com POST policy

* Gere a política no servidor, uma por foto, válida por 15 minutos.
* Condições obrigatórias: `{"bucket": "estudio"}`, `{"key": "<chave exata>"}`, `{"Content-Type": "image/jpeg"}`, `["content-length-range", 1024, MAX_UPLOAD_BYTES]`, `{"x-amz-algorithm": "AWS4-HMAC-SHA256"}`, `{"x-amz-credential": "..."}`, `{"x-amz-date": "..."}`.
* O Garage rejeita qualquer campo do formulário que não esteja na política. Envie só os campos listados e o `file` por último.
* Região de assinatura: a mesma de `s3_region` no Garage (`garage`).
* Prefira o `PresignPostObject` do cliente de presign do `aws-sdk-go-v2`. Se não estiver disponível na versão fixada ou falhar contra o Garage, implemente o assinador em `internal/storage/postpolicy.go` (documento da política em base64 e assinatura HMAC SHA-256 com a chave derivada SigV4), com testes unitários usando os vetores de exemplo da AWS.
* O teste de integração precisa provar, contra um Garage real: upload válido aceito; tamanho acima do limite rejeitado; `Content-Type` diferente rejeitado; chave diferente da política rejeitada; política expirada rejeitada; GET, PUT e DELETE em `/s3/...` pelo Caddy devolvem 404.


## 9. Processamento das fotos e carimbo

### 9.1 Validação e normalização

Etapa `prepare`:

1. Baixar o original para memória (limite `MAX_UPLOAD_BYTES`).
2. `image.DecodeConfig` antes de decodificar: formato JPEG, lados entre 200 e 8000 px, até 40 megapixels. Fora disso: falha permanente `invalid_image`.
3. Decodificar com `imaging.Decode(r, imaging.AutoOrientation(true))`.
4. Se o lado maior passar de 1600 px, reduzir para 1600 com filtro Lanczos. Nunca ampliar.
5. Gerar miniatura com lado maior de 480 px, JPEG qualidade 80, gravar em `thumbs/`.
6. Estado `prepared`.

Etapa `stamp`:

1. Aplicar o carimbo sobre a imagem normalizada.
2. Codificar JPEG qualidade 90, sem metadados (a recodificação descarta EXIF, incluindo GPS).
3. Gravar em `stamped/`, estado `stamped`.

As duas etapas rodam no mesmo job, mas o estado da foto é atualizado entre elas para a UI mostrar o progresso real.

### 9.2 Texto do carimbo

Implementar o mesmo algoritmo no Go (`internal/stamp/text.go`) e no TypeScript (`web/src/shared/lib/stamp.ts`). Os dois lados usam o mesmo ficheiro de vetores de teste (`testdata/stamp-text.json`, apêndice A).

* Tamanhos em ordem canónica `XS, S, M, L, XL, 2XL`.
* Um tamanho: `M`. Dois: `M e L`. Três ou mais: `S, M e L`.
* Linha 1: `{descrição}/ {tamanhos}` quando há descrição. Só `{tamanhos}` quando não há.
* Linha 2: preço com ponto nos milhares e ` kz` minúsculo: `10.000 kz`, `999 kz`, `1.250.000 kz`.

### 9.3 Desenho do carimbo

O carimbo reproduz o que a loja já usa: canto superior esquerdo, duas linhas, sem fundo.

* Fonte: Work Sans Medium (500), ficheiro TTF embutido no binário (`assets/fonts`, licença OFL junto).
* Tamanho da fonte: 3,4% da largura da imagem, nas duas linhas.
* Margem esquerda: 3% da largura. Topo da primeira linha: 7% da altura.
* Entrelinha: 1,25 vezes o tamanho da fonte.
* Cor: `#111111`. Contraste automático: calcular a luminância média da área do texto; se for menor que 0,45, usar `#FFFFFF`.
* Texto com antialiasing. Se a linha 1 passar de 90% da largura, reduzir a fonte das duas linhas até caber.
* Todos esses números ficam numa struct `stamp.Layout` com valores padrão, para ajuste fino depois.

Testes de imagem de referência (golden): fundos sintéticos claro e escuro em 1200x1600 e 1600x1200, comparados com PNGs em `testdata/golden` com tolerância por pixel. A flag `-update` regenera as referências. Não coloque fotos reais da loja no repositório.


## 10. Fila e workers

* `WORKERS` goroutines (padrão 2). Cada uma busca trabalho quando é avisada por um canal ao enfileirar e também a cada 1 segundo.
* Reserva atómica de um job:

```sql
UPDATE jobs
   SET status = 'running', locked_at = :now, attempts = attempts + 1
 WHERE id = (SELECT id FROM jobs
              WHERE status = 'queued' AND run_after <= :now
              ORDER BY id LIMIT 1)
RETURNING id, photo_id, attempts;
```

* Tempo máximo por job: 60 s (contexto com prazo). Pânico é recuperado e conta como falha.
* Erros transitórios (armazenamento indisponível, timeout): até 3 tentativas, espera de 5 s, 30 s e 2 min. Erros permanentes (imagem inválida): sem nova tentativa, foto `failed` com `failed_step` e `error_code`.
* Ao arrancar e a cada minuto: jobs `running` com `locked_at` de mais de 3 minutos voltam para `queued`.
* O processamento é idempotente: chaves determinísticas, gravar de novo sobrescreve.
* Encerramento gracioso: ao receber SIGTERM, parar de buscar jobs, esperar os que estão a correr até 30 s e só depois fechar o banco.

Zelador diário (`janitor`):

* Apagar originais e miniaturas com mais de `RETENTION_ORIGINALS_DAYS` dias (padrão 30).
* Apagar lotes inteiros com mais de `RETENTION_BATCHES_DAYS` dias (padrão 90).
* Fotos em `awaiting_upload` há mais de 24 h viram `failed` na etapa `upload`.
* Apagar sessões expiradas e tentativas de login com mais de 7 dias.


## 11. Frontend

### 11.1 Rotas

| Rota | Tela | Acesso |
| --- | --- | --- |
| `/` | Landing | pública |
| `/entrar` | Entrada (login) | pública |
| `/estudio` | Fotos e preço | protegida |
| `/estudio/lotes/:id` | Processamento e Pronto | protegida |
| `*` | Página não encontrada | pública |

A proteção usa a query `me`. Em `401`, redirecionar para `/entrar?next=...`, aceitando em `next` só caminhos internos que começam por `/estudio`.

### 11.2 Organização

```
web/src/
  app/            rotas, providers, layout
  features/
    landing/
    auth/
    batch/        criar lote, upload, processamento, resultado
  shared/
    api/          cliente fetch, esquemas zod, erros
    lib/          stamp.ts, format.ts, resize.worker.ts
    ui/           Button, Field, Sheet, ProgressRing, StepItem, PhotoTile, Banner
    styles/       tokens.css, base.css
```

Lógica de negócio fora dos componentes. Componentes só de apresentação em `shared/ui`.

### 11.3 Telas e comportamentos

O visual segue o design gerado a partir do prompt de design (direção C, Vitrine). Coloque as exportações em `docs/design/`. Se a pasta estiver vazia, siga os tokens da seção 11.6.

Entrada:

* Campo da chave com `type="password"`, `autocomplete="current-password"` (o gestor de senhas do Chrome pode guardar), `maxlength=32`, contador `0/32`, botão mostrar e botão "Colar" (`navigator.clipboard.readText`, com o colar nativo como alternativa).
* Botão "Entrar" ativo só com 32 caracteres.
* Indicador "Computador ligado" ou "Computador desligado" consultando `/api/health` a cada 10 s.
* Mensagens de erro por código: formato, chave errada, muitas tentativas (com tempo de espera), sem ligação.

Fotos e preço:

* Dois inputs de ficheiro: galeria (`accept="image/*" multiple`) e câmara (`capture="environment"`).
* Grelha de miniaturas locais com `URL.createObjectURL` (revogar ao desmontar), contador, "+N" na última, remover foto.
* Preço com `inputmode="numeric"`, formatação com pontos ao digitar, guardado como inteiro.
* Tamanhos num campo seletor que abre uma folha inferior (`<dialog>` com `showModal()`) com caixas de seleção de XS a 2XL e botão "Aplicar". O campo mostra o texto gerado ("M e L").
* Descrição opcional com contador `0/24`.
* Rodapé fixo com a pré-visualização do carimbo e o botão "Processar N fotos", ativo só com fotos e preço válidos.

Processamento e Pronto:

* Anel de progresso, as quatro etapas com estado, faixa "Já prontas" e lista de falhas com "Repetir".
* Durante o envio: Wake Lock de ecrã ligado, aviso "Não feches o app enquanto as fotos sobem." Se a página ficar oculta durante o envio, mostrar um aviso ao voltar.
* Depois do envio: "Podes bloquear o telemóvel, o computador continua."
* Polling de `GET /api/batches/{id}` a cada 1 s enquanto `finished` for `false`.
* Pronto: grelha das fotos com carimbo, "Guardar todas na galeria" (downloads em sequência por `<a download>` com blobs da API), "Partilhar" (`navigator.share({ files })` em grupos de até 10, só se `navigator.canShare` aceitar) e "Novo grupo".

### 11.4 Upload no cliente

* Um gestor de upload fora da árvore de componentes (store simples com `useSyncExternalStore`), para a navegação não cancelar envios.
* Redimensionamento num Web Worker: `createImageBitmap(file, { imageOrientation: "from-image" })`, `OffscreenCanvas`, lado maior até 1600 px, `convertToBlob({ type: "image/jpeg", quality: 0.88 })`. Isto também remove EXIF e GPS antes de sair do telemóvel.
* Até 3 envios em paralelo, com progresso por `XMLHttpRequest.upload.onprogress`.
* Até 3 tentativas por foto com espera crescente. Se falhar, pedir nova política em `upload-slot` antes de tentar outra vez.
* Se a página recarregar a meio, as fotos ainda não enviadas aparecem como falhadas na etapa de envio, com a opção de escolher de novo.

### 11.5 PWA

* `vite-plugin-pwa` com `generateSW`. Pré cache só do shell da aplicação.
* Nenhuma resposta de `/api` ou `/s3` vai para cache. `navigateFallback` exclui esses caminhos.
* Manifest: `name` "NethStore Estúdio", `short_name` "Estúdio", `start_url` "/estudio", `scope` "/", `display` "standalone", `background_color` e `theme_color` `#0E0D0C`, ícones 192 e 512 px normais e `maskable`.
* Aviso "Nova versão disponível" com botão "Atualizar" quando houver service worker novo.

### 11.6 Tokens da direção C (Vitrine)

```css
:root {
  --color-bg: #0E0D0C;
  --color-surface: #181715;
  --color-raised: #211F1C;
  --color-line: #2C2925;
  --color-line-strong: #3A3631;
  --color-text: #F3EEE6;
  --color-text-soft: #CFC7BC;
  --color-text-muted: #A39A8E;
  --color-accent: #D8B77A;
  --color-on-accent: #1A1610;
  --color-accent-soft: #2A2418;
  --color-accent-text: #E7CC98;
  --color-success: #5BC48A;
  --color-success-soft: #15291D;
  --color-success-text: #7FD6A4;
  --color-danger: #F07A6A;
  --color-danger-soft: #2E1714;
  --color-danger-text: #F49A8D;

  --font-sans: "Work Sans", system-ui, sans-serif;
  --radius-field: 16px;
  --radius-card: 22px;
  --radius-photo: 16px;
  --radius-pill: 999px;
  --space-unit: 4px;
}
```

Tipografia: títulos peso 300 com tracking de menos 0,03 em; rótulos 11 px peso 500 em maiúsculas com tracking de 0,2 em; preço peso 500 em `--color-accent` com algarismos tabulares. Título do hero da landing: 54 px no telemóvel, 80 px no tablet, 92 px no desktop.

Regras visuais: nada de gradientes decorativos, glassmorphism, emoji ou sombras grandes. O único gradiente permitido é o escurecimento sobre fotos para dar leitura ao texto. Alvos de toque de no mínimo 44 px. Contraste AA.

### 11.7 Textos da interface

Português de Angola, tratamento por "tu": telemóvel, carregar, guardar, partilhar, "A processar". Todos os textos ficam em `web/src/shared/i18n/pt-AO.ts`, inclusive a tradução de cada código de erro da API.


## 12. Segurança

### 12.1 O que proteger e de quem

| Ativo | Ameaça | Controle principal |
| --- | --- | --- |
| Fotos e lotes | Outra pessoa na mesma rede (visitas, vizinhos no Wi-Fi) | Tudo exige sessão; só a porta 443 exposta; Garage sem acesso direto |
| Chave de acesso | Força bruta, vazamento em logs | 32 caracteres aleatórios (cerca de 190 bits), hash argon2id, limite de tentativas, nunca registrada |
| Sessão | Roubo de cookie, CSRF | Cookie `__Host-` HttpOnly, Secure, SameSite Strict, token guardado só como hash, verificação de `Origin` |
| Servidor | Ficheiro malicioso, bomba de descompressão | Só JPEG, limites de tamanho e de pixels antes de decodificar, prazo por job, recuperação de pânico |
| Disponibilidade | Uploads gigantes, muitos pedidos | Limites no Caddy e na política, `MaxBytesReader`, máximo de fotos e de lotes abertos |
| Navegador | XSS | React sem `dangerouslySetInnerHTML`, CSP estrita sem `unsafe-inline`, sem recursos externos |
| Telemóvel perdido | Acesso com sessão ativa | `estudio sessions revoke-all` e `estudio secret rotate` |
| Repositório | Segredos commitados | `.env` gerado e ignorado, varredura com gitleaks |
| Dependências | Vulnerabilidades conhecidas | Versões fixadas, govulncheck, auditoria do pnpm, imagens por digest |

### 12.2 Chave de acesso

* Gerada só pela CLI: `estudio secret rotate`. 32 caracteres base62 de `crypto/rand` com amostragem por rejeição (sem viés de módulo).
* Mostrada uma única vez no terminal. Nunca gravada em ficheiro nem em log.
* Guardada como argon2id (memória 64 MB, 1 iteração, paralelismo 4, sal de 16 bytes), em formato PHC.
* Comparação em tempo constante.
* Trocar a chave revoga todas as sessões.

### 12.3 Limite de tentativas

* Por IP: 5 tentativas por minuto. Depois de 10 falhas em 15 minutos, bloqueio de 15 minutos para esse IP.
* Global: mais de 30 falhas numa hora bloqueia o login por 1 hora e grava um aviso no log.
* Toda tentativa fica em `login_attempts` com IP, data e resultado. Nunca com a chave tentada.
* Resposta `429` com `Retry-After`.

### 12.4 Sessão

* Token de 32 bytes de `crypto/rand`, codificado em base64url. No banco, só o SHA-256 dele.
* Cookie `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sem `Domain`, `Max-Age` de 30 dias.
* Validade absoluta de 30 dias desde o login. `last_seen_at` atualizado no máximo uma vez por minuto.
* Novo token a cada login (sem fixação de sessão). Logout apaga a linha.
* CLI: `estudio sessions list` e `estudio sessions revoke-all`.

### 12.5 Pedidos HTTP

* Servidor com `ReadHeaderTimeout` 5 s, `ReadTimeout` 15 s, `WriteTimeout` 60 s, `IdleTimeout` 120 s, `MaxHeaderBytes` 16 KB.
* Verificação de `Origin` e de `Content-Type` em todo método que altera estado.
* Rotas com ID validam UUID antes de tocar no banco. Nenhum caminho de ficheiro vem do cliente.
* Mensagens de erro sem detalhes internos. O detalhe vai para o log com um `request_id`.

### 12.6 Armazenamento

* Bucket privado. Nenhuma política pública, nenhum site estático no Garage.
* A API usa uma chave do Garage com leitura e escrita só no bucket `estudio`. A chave de administração do Garage fica fora da API.
* Portas S3 (3900), RPC (3901) e administração (3903) do Garage não são publicadas.
* O Caddy só repassa `POST /s3/estudio`.

### 12.7 Contêineres e segredos

* Imagens fixadas por digest. Processos sem root, sistema de ficheiros só de leitura onde der (`read_only: true` com `tmpfs` para `/tmp`), `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`.
* `make init` gera `.env` com valores aleatórios (segredo RPC e token de administração do Garage) e cria a chave S3 da API. `.env` e `deploy/ca/` estão no `.gitignore`. O repositório traz só `.env.example`.
* Logs em JSON com `slog`. Proibido registrar: chave de acesso, token de sessão, cookies, campos da política, assinaturas.

### 12.8 Lista de verificação de segurança (vira teste automatizado)

1. Toda rota protegida devolve 401 sem cookie (teste que percorre a tabela de rotas registradas).
2. Cookie com `HttpOnly`, `Secure`, `SameSite=Strict` e prefixo `__Host-`.
3. POST com `Origin` diferente devolve 403.
4. POST com `Content-Type: text/plain` devolve 415.
5. Sexta tentativa de login no mesmo minuto devolve 429 com `Retry-After`.
6. Chave correta depois do bloqueio continua bloqueada até o fim do prazo.
7. Corpo JSON acima de 64 KB devolve 413.
8. Upload acima do limite, com outro tipo ou com outra chave é rejeitado pelo Garage.
9. GET, PUT e DELETE em `/s3/...` devolvem 404 no Caddy.
10. JPEG de 20000x20000 é recusado sem decodificar (memória estável no teste).
11. Ficheiro com extensão JPEG mas conteúdo PNG ou texto falha com `invalid_image`.
12. A foto pronta não tem EXIF.
13. Cabeçalhos CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` e COOP presentes no HTML.
14. Nenhuma requisição externa no carregamento das páginas (Playwright falha se houver pedido para outro domínio).
15. Logs de um fluxo completo não contêm a chave nem o token (teste que procura as strings no output capturado).
16. `estudio secret rotate` invalida sessões existentes.


## 13. Configuração e CLI

`.env.example`:

```
LAN_HOST=192.168.1.50
APP_ORIGIN=https://192.168.1.50
DATABASE_PATH=/data/estudio.db
S3_ENDPOINT=http://garage:3900
S3_REGION=garage
S3_BUCKET=estudio
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
UPLOAD_PATH=/s3/estudio
MAX_UPLOAD_BYTES=15728640
MAX_PHOTOS_PER_BATCH=50
SESSION_TTL=720h
WORKERS=2
RETENTION_ORIGINALS_DAYS=30
RETENTION_BATCHES_DAYS=90
GARAGE_RPC_SECRET=
GARAGE_ADMIN_TOKEN=
```

A configuração é lida e validada no arranque. Valor inválido ou em falta encerra o processo com mensagem clara.

Binário `estudio`:

* `estudio serve`: API e workers.
* `estudio migrate`: aplica migrações e sai.
* `estudio secret rotate`: gera nova chave, mostra uma vez e revoga sessões.
* `estudio sessions list` e `estudio sessions revoke-all`.

Garage: use a versão 2.x estável mais recente, fixada por digest. Configuração com `replication_factor = 1`, `db_engine = "sqlite"`, `s3_region = "garage"`, segredos lidos de ficheiro ou de variável de ambiente, conforme a versão fixada suportar. O script `deploy/garage-init.sh` é idempotente e faz: atribuir o layout ao nó único, aplicar o layout, criar o bucket `estudio`, criar a chave da API e dar leitura e escrita nesse bucket. Confirme os comandos na documentação da versão fixada.


## 14. Estrutura do repositório

```
estudio/
  CLAUDE.md                 instruções curtas para o agente, apontando para docs/SPEC.md
  Makefile
  .env.example
  .gitignore
  api/
    cmd/estudio/main.go
    internal/
      config/
      httpapi/              rotas, middlewares, handlers
      auth/                 chave, sessões, limite de tentativas
      store/                SQLite, migrações, consultas
      storage/              cliente S3, POST policy
      jobs/                 fila, workers, zelador
      imaging/              validação, normalização, miniaturas
      stamp/                texto e desenho do carimbo
    migrations/
    assets/fonts/           WorkSans-Medium.ttf e OFL.txt
    testdata/
  web/
    src/
    public/
    tests/e2e/
  testdata/
    stamp-text.json         vetores partilhados entre Go e TypeScript
  deploy/
    docker-compose.yml
    Caddyfile
    garage.toml
    garage-init.sh
    api.Dockerfile
  docs/
    SPEC.md                 este documento
    DECISOES.md
    INSTALAR-NO-TELEMOVEL.md
    OPERACAO.md
    QA-REPORT.md
    design/
  scripts/
    security-check.sh
```


## 15. Testes

Go:

* Unitários: texto do carimbo (vetores partilhados), validação de entrada, geração da chave, hash e verificação, limite de tentativas com relógio injetável, cálculo dos estados das etapas, assinatura da POST policy.
* Golden do carimbo (seção 9.3).
* Fuzz: parser do corpo de criação de lote, normalização da descrição, `DecodeConfig` com entradas arbitrárias.
* Handlers com `httptest`, incluindo a lista de segurança da seção 12.8.
* Integração com Garage real num contêiner (testcontainers ou Compose de teste): upload por POST policy, `HeadObject`, processamento completo de um lote, retenção.
* Sempre com `-race`. Cobertura mínima de 80% em `auth`, `stamp`, `storage` e `jobs`.

Web:

* Vitest com Testing Library e MSW: formatação de preço, texto do carimbo, folha de tamanhos, validações do formulário, estados das etapas, mapeamento de erros, gestor de upload com falhas simuladas.
* Playwright contra a stack completa (`make up`) com perfis Pixel 7 (390 px), tablet 834 px e desktop 1440 px:
  * landing nos três tamanhos;
  * chave errada, depois certa;
  * criar lote com 12 imagens sintéticas, acompanhar até terminar, abrir a grelha final;
  * forçar uma falha e usar "Repetir";
  * nenhum pedido para domínio externo;
  * `@axe-core/playwright` sem violações sérias ou críticas em cada tela.
* Imagens de teste sintéticas geradas por script. Nada de fotos reais da loja.

Comandos:

* `make check`: lint (golangci-lint, eslint, prettier, tsc) e testes unitários.
* `make test-integration`: testes de integração com Garage.
* `make e2e`: Playwright contra a stack.
* `make audit`: govulncheck, gosec, auditoria do pnpm, gitleaks.
* `make security-check`: `scripts/security-check.sh` com curl contra a stack (cabeçalhos, cookies, 401, 403, 404 do `/s3`).


## 16. QA feito pelo agente

Ao fim de cada marco com interface, e no fim de tudo:

1. `make check` verde.
2. `make up`, depois `make e2e`. O Playwright grava capturas de cada tela e estado em `artifacts/screens/` nos três tamanhos.
3. Abra cada captura e compare com `docs/design/` (ou com os tokens da seção 11.6). Verifique: cores, espaçamentos, textos em português de Angola, nada a transbordar em 390 px, alvos de 44 px, estados de erro e de carregamento.
4. `make audit` e `make security-check` sem achados de severidade alta ou crítica. Achados médios ficam explicados em `docs/QA-REPORT.md`.
5. Registre em `docs/QA-REPORT.md`: o que foi testado, o que falhou, o que foi corrigido e o que só dá para validar no telemóvel (seção 20).
6. Repita até não haver falhas.


## 17. Operação

Alvos do Makefile:

* `make init`: gera `.env`, sobe o Garage, roda `garage-init.sh` e grava as credenciais da API no `.env`.
* `make up`, `make down`, `make logs`.
* `make secret`: roda `estudio secret rotate` dentro do contêiner.
* `make ca-export`: exporta o certificado raiz da CA do Caddy.
* `make backup`: cópia consistente do SQLite (`.backup`) e arquivo do volume do Garage em `backups/AAAA-MM-DD/`.
* `make restore DATE=AAAA-MM-DD`: restaura um backup, com confirmação.

`docs/OPERACAO.md` explica: primeiro arranque, instalar a CA no telemóvel, instalar a PWA, trocar a chave, revogar sessões, backup e restauro, atualizar a aplicação, regra de firewall no computador para a porta 443, e o que fazer se o IP mudar.

Recomendação para a rede: deixar visitas na rede de convidados do router, separada da rede do computador.


## 18. Marcos e critérios de aceite

M1. Base e infraestrutura

* Repositório com a estrutura da seção 14, Makefile, lint configurado, CI local por `make check`.
* Compose com Caddy, API mínima e Garage inicializado por `make init`.
* Aceite: `https://LAN_HOST/api/health` responde pelo Caddy com TLS interno; só a porta 443 (e 80 para redirecionar) está publicada; `make check` verde.

M2. Autenticação

* Migrações, CLI da chave, login, logout, `me`, sessões, limite de tentativas, middlewares de Origin e Content-Type, cabeçalhos.
* Aceite: itens 1 a 7, 15 e 16 da seção 12.8 automatizados e verdes.

M3. Lotes e uploads

* Criação de lote com políticas, confirmação de envio, `upload-slot`, listagem, detalhe, exclusão.
* Aceite: integração contra Garage prova os casos da seção 8; item 8 e 9 da seção 12.8 verdes.

M4. Processamento e carimbo

* Workers, reserva atómica, tentativas, recuperação de jobs presos, `prepare`, `stamp`, miniaturas, download, zelador.
* Aceite: golden tests verdes; lote de 50 imagens sintéticas processado sem erros; itens 10 a 12 da seção 12.8 verdes.

M5. Aplicação (telas da PWA)

* Entrada, Fotos e preço com folha de tamanhos, Processamento, Pronto, gestor de upload, Wake Lock, partilha e downloads.
* Aceite: testes unitários web verdes; fluxo completo no Playwright em 390 px; capturas revisadas.

M6. Landing e PWA

* Landing em 390, 834 e 1440 px, manifest, ícones, service worker, aviso de atualização.
* Aceite: Playwright nos três tamanhos; manifest válido; item 14 da seção 12.8 verde.

M7. Endurecimento e QA final

* `make audit`, `make security-check`, axe, revisão visual, cobertura mínima.
* Aceite: seção 16 completa, `docs/QA-REPORT.md` atualizado.

M8. Documentação

* README, `docs/OPERACAO.md`, `docs/INSTALAR-NO-TELEMOVEL.md`, `docs/DECISOES.md`.
* Aceite: outra pessoa consegue subir tudo do zero só lendo o README.


## 19. Definição de pronto

* Todos os marcos aceitos.
* `make check`, `make test-integration`, `make e2e`, `make audit` e `make security-check` verdes numa máquina limpa, a partir de `git clone` e `make init`.
* Nenhum segredo no histórico do git.
* Relatório de QA com a lista do que falta validar no telemóvel.


## 20. Validar no telemóvel real

Estes pontos dependem do aparelho e do Android. O agente prepara tudo, mas a confirmação é manual:

* O Chrome do Android aceita a CA local para tratar a origem como segura (instalação da PWA, área de transferência, Wake Lock, partilha).
* Limite de quantidade e tamanho de ficheiros no `navigator.share` com 10 fotos de cerca de 600 KB.
* O Chrome pede permissão para vários downloads seguidos; depois de aceitar, as fotos aparecem na galeria.
* Input com `capture="environment"` abre a câmara traseira.
* Tempo real de envio de 50 fotos pela rede de casa.
* Legibilidade do carimbo em fotos reais claras e escuras (ajustar `stamp.Layout` se preciso).


## Apêndice A: vetores do texto do carimbo

`testdata/stamp-text.json`:

```json
[
  { "priceKz": 8000, "sizes": ["S", "M"], "description": "Veste", "line1": "Veste/ S e M", "line2": "8.000 kz" },
  { "priceKz": 10000, "sizes": ["L", "M"], "description": "Veste", "line1": "Veste/ M e L", "line2": "10.000 kz" },
  { "priceKz": 2500, "sizes": ["M"], "description": null, "line1": "M", "line2": "2.500 kz" },
  { "priceKz": 15000, "sizes": ["XL", "S", "M"], "description": "Conjunto", "line1": "Conjunto/ S, M e XL", "line2": "15.000 kz" },
  { "priceKz": 999, "sizes": ["2XL", "XS"], "description": "  Saia   longa ", "line1": "Saia longa/ XS e 2XL", "line2": "999 kz" },
  { "priceKz": 1250000, "sizes": ["XS", "S", "M", "L", "XL", "2XL"], "description": "", "line1": "XS, S, M, L, XL e 2XL", "line2": "1.250.000 kz" }
]
```


## Apêndice B: primeira mensagem para o Claude Code

Coloque este documento em `docs/SPEC.md` num repositório vazio e envie:

```
Vais implementar o NethStore Estúdio do início ao fim, seguindo docs/SPEC.md.

1. Lê a spec inteira antes de começar.
2. Cria o CLAUDE.md com um resumo das decisões fixas (seção 3) e das regras de segurança (seção 12), apontando para a spec.
3. Cria uma lista de tarefas com os marcos M1 a M8 (seção 18) e segue na ordem.
4. Em cada marco: implementa, escreve os testes, corre make check e os testes do marco, corrige até ficar verde e faz commit.
5. Não troques nenhuma decisão da seção 3 sem me perguntar. Diferenças pequenas vão para docs/DECISOES.md.
6. Segurança não é opcional: cada item da seção 12.8 tem de virar teste automatizado.
7. No fim, faz o QA da seção 16, incluindo abrir e revisar as capturas de ecrã, e entrega docs/QA-REPORT.md com o que falta validar no telemóvel.

O design das telas está em docs/design/. Se faltar alguma tela, segue os tokens da seção 11.6.
```
