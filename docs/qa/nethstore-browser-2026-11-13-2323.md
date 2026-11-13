# QA — NethStore Estúdio, telas da PWA (M5 e M6)

**Card:** nenhum
**Modo:** browser
**Alvo:** https://localhost
**Ambiente:** local
**Critérios:** colados (SPEC 18 e FRONTEND-SPEC; execução 2 de 2, a de API está em `nethstore-api-2026-11-13-2321.md`)
**Executado em:** 13/11/2026 23:23–23:27 (hora local)
**Resultado:** 7 passou · 0 falhou · 0 não testado

---

## Resumo

| #   | Critério                                                                                  | Veredito |
| --- | ----------------------------------------------------------------------------------------- | -------- |
| C6  | Landing em 390, 834 e 1440 px com todas as secções, sem transbordo, sem pedidos externos   | PASSOU   |
| C7  | Entrada: 0/32 e Entrar desativado; 18 → "Faltam 14"; chave errada → "Restam N"; Ligado; chave certa → /estudio | PASSOU |
| C8  | /estudio sem sessão → /entrar?next=/estudio                                               | PASSOU   |
| C9  | Fotos e preço: estados, preço formatado, folha de tamanhos, descrição 0/24, rodapé e botão | PASSOU   |
| C10 | Processamento: anel progressbar, 4 etapas com contadores, faixa JÁ PRONTAS                 | PASSOU   |
| C11 | Pronto: "Prontas", linha de resumo, grelha carimbada, 3 botões; Novo grupo → /estudio      | PASSOU   |
| C13 | Sair termina a sessão e volta a pedir a chave                                             | PASSOU   |

---

## Detalhe

### C6 — Landing em 390, 834 e 1440 px: secções Topo, Hero ("Do fardo à montra em minutos."), Como funciona, O carimbo (comparador Depois/Antes), Instalar (3 cartões, passo 1 mostra o endereço real), Chamada final, Rodapé; nada transborda em 390 px; nenhum pedido a outro domínio.

**Veredito:** PASSOU
**Interpretei como:** nas três larguras, os títulos das secções estão presentes, o comparador existe como controlo deslizante, o passo 1 de Instalar cita o host real (`localhost`), o rodapé tem NETHSTORE · Estúdio, Luanda, Acesso privado; `scrollWidth == clientWidth` (sem rolagem horizontal) e os recursos carregados (`performance.getEntriesByType('resource')`) são todos de `localhost`.
**Passos:** viewport 390×844, snapshot da landing; depois, para 390, 834 e 1440, navegar, percorrer a página até ao fim e medir largura, hosts, títulos, passo 1 e rodapé.
**Observei:** snapshot em 390: `banner` com `link "NETHSTORE · Estúdio"`, `link "Entrar"`, `button "Abrir menu"`; `heading [level=1]` "Do fardo à *montra* em minutos."; secções `"Três passos. Nenhuma edição à mão."`, `"O carimbo de sempre, sem o trabalho de sempre."` com `slider "Mover a divisória entre a foto com carimbo e sem carimbo": "50"` e rótulos DEPOIS/ANTES, `"Fica no ecrã do telemóvel, como uma app."` com 3 `listitem`, `"Pronta para o próximo fardo?"`; `contentinfo` com `NETHSTORE · Estúdio`, `Luanda`, `Acesso privado`. Medições: 390 → `scrollWidth 375 / clientWidth 375`, 834 → `819 / 819`, 1440 → `1425 / 1425` (a barra de rolagem do browser ocupa 15 px); `hosts: ["localhost"]` nas três; passo 1: `"O endereço é o do computador onde o Estúdio corre: localhost."` nas três.

### C7 — Entrada: sem chave, contador 0/32, "Entrar" desativado; com 18 caracteres "Faltam 14 caracteres."; chave errada de 32 mostra "Chave errada. Restam N tentativas."; pílula "Ligado" visível; chave certa entra e vai para /estudio.

**Veredito:** PASSOU
**Interpretei como:** os quatro estados aparecem com os textos literais; a mensagem de chave errada traz "Restam N tentativas." quando N ≤ 3 (regra acordada em `docs/DECISOES.md`, item 6); a chave de QA leva a `/estudio`.
**Passos:** abrir `/entrar`; escrever 18 caracteres; escrever 32 caracteres errados e Entrar; repetir com outra chave errada; escrever a chave certa e Entrar.
**Observei:** inicial: `status: Ligado`, `"Pede a chave a quem instalou o estúdio."`, `0/32`, `button "Entrar" [disabled]`. Com `qaagentQAagent1234`: `"Faltam 14 caracteres."`, `18/32`, Entrar `[disabled]`. 1.ª chave errada: `POST /api/auth/login` → `401`, corpo `{"error":{"code":"invalid_secret","message":"invalid secret","remainingAttempts":4}}`; tela `"Chave errada."`, campo `[invalid]`, `32/32`. 2.ª chave errada: `POST /api/auth/login` → `401`; tela `"Chave errada. Restam 3 tentativas."`. Chave certa: URL passou a `https://localhost/estudio` e apareceu `"Fotos e preço"`.

### C8 — /estudio sem sessão redireciona para /entrar?next=/estudio.

**Veredito:** PASSOU
**Interpretei como:** sem cookie de sessão, abrir `/estudio` termina em `/entrar` com `next` igual a `/estudio`.
**Passos:** conferir cookies do contexto; navegar para `/estudio`.
**Observei:** cookies antes: `[]`; URL final `https://localhost/entrar?next=%2Festudio` (`%2F` é `/` codificado).

### C9 — Fotos e preço: estado vazio com "Escolher fotos" e "Tirar foto"; com fotos e sem preço, rótulo PREÇO em coral e "Escreve o preço para processar."; preço formata com ponto (10000 -> 10.000); folha de tamanhos abre como diálogo com XS..2XL e "Aplicar"; descrição com contador 0/24; rodapé mostra "Carimbo: Veste/ M e L · 10.000 kz" e "Processar N fotos" só ativo com fotos, preço e tamanhos.

**Veredito:** PASSOU
**Interpretei como:** cada estado mostra os textos literais; a cor computada do rótulo PREÇO no estado de erro é um token coral; o diálogo é um `<dialog>` modal; o botão só fica ativo quando há fotos, preço e tamanhos.
**Passos:** snapshot do estado vazio; escolher 3 imagens sintéticas; ler a cor do rótulo; digitar `10000` tecla a tecla; abrir Tamanhos, marcar L e M, Aplicar; digitar `Veste` na descrição; snapshot.
**Observei:** vazio: `"Ainda não há fotos"`, `button "Escolher fotos"`, `button "Tirar foto"`, `0/24`, rodapé `"Carimbo: escolhe fotos, preço e tamanhos"`, `button "Processar fotos" [disabled]`. Com 3 fotos: `"3 fotos no lote"`, `textbox "Preço" [invalid]`, `"Escreve o preço para processar."`, rótulo `Preço` com `text-transform: uppercase` e `color: rgb(244, 154, 141)` (= `#F49A8D`, `--color-error-text`), rodapé `"falta o tamanho · falta o preço"`, `"Processar 3 fotos" [disabled]`. Depois do preço: campo `"10.000"`, rodapé `"falta o tamanho · 10.000 kz"`, botão ainda `[disabled]`. Folha: `dialog "Tamanhos"` (`tag DIALOG, open true, :modal true`) com `XS`, `S`, `M`, `L`, `XL`, `2XL`, `Limpar`, `Aplicar`; com M e L `[pressed]`: `"No carimbo M e L"`. Final: seletor `"Tamanhos M e L"`, descrição `5/24`, rodapé `"Carimbo: Veste/ M e L · 10.000 kz"`, `button "Processar 3 fotos"` sem `[disabled]`.

### C10 — Processamento: anel de progresso com role progressbar, 4 etapas (Enviar fotos, Preparar imagens, Aplicar preço e tamanho, Pronto para guardar) com contadores; faixa "JÁ PRONTAS".

**Veredito:** PASSOU
**Interpretei como:** ao processar, a tela do lote mostra um elemento `role="progressbar"`, a lista de 4 etapas com contador `n/N` e a região "JÁ PRONTAS".
**Passos:** clicar "Processar 3 fotos" e ler a árvore de acessibilidade assim que o anel aparece.
**Observei:** URL `https://localhost/estudio/lotes/01a1d704-7922-7251-8a15-50bc60f23a64`; anel `role "progressbar"`, `aria-label "Progresso do lote"`, `aria-valuenow 0`, `aria-valuemax 100`, largura `168` px, texto `"0% 0 de 3 fotos"`; `heading "A enviar as fotos"`, `"Não feches o app enquanto as fotos sobem."`; `list "Etapas"`: `img "A carregar"` `Enviar fotos 0/3`, `img "Pendente"` `Preparar imagens 0/3`, `Aplicar preço e tamanho 0/3`, `Pronto para guardar 0/3`; `region "JÁ PRONTAS · 0"` com `"As fotos carimbadas aparecem aqui."`.

### C11 — Pronto: título "Prontas", linha "N de N fotos carimbadas · Veste/ M e L · 10.000 kz", grelha de miniaturas carimbadas, botões "Guardar todas na galeria", "Partilhar" e "Novo grupo"; "Novo grupo" volta a /estudio.

**Veredito:** PASSOU
**Interpretei como:** o lote do C10 chega a "Prontas" com a linha de resumo literal, 3 miniaturas carregadas que trazem o carimbo, os 3 botões, e "Novo grupo" leva a `/estudio`.
**Passos:** esperar o título; ler a árvore, o estado das imagens e as colunas da grelha; capturar a grelha; abrir a miniatura da foto escura; clicar "Novo grupo".
**Observei:** `heading "Prontas" [level=1]`; parágrafo `"3 de 3 fotos carimbadas · Veste/ M e L · 10.000 kz"`; `list "Fotos carimbadas"` com `img "Foto 1, carimbada"`, `"Foto 2, carimbada"`, `"Foto 3, carimbada"`, todas `loaded: true` a partir de `/api/photos/{id}/thumb?v=s`; `grid-template-columns: 83px 83px 83px 83px` (4 colunas); `contentinfo` com `button "Guardar todas na galeria"`, `button "Partilhar"`, `button "Novo grupo"`. `GET /api/photos/01a1d704-7922-7261-934d-364a72a54dc4/thumb?v=s` → `200 image/jpeg`; a imagem mostra `Veste/ M e L` e `10.000 kz` em branco no canto superior esquerdo sobre o fundo escuro. Após "Novo grupo": URL `https://localhost/estudio`.

### C13 — Sair (logout) termina a sessão e volta a pedir a chave.

**Veredito:** PASSOU
**Interpretei como:** "Sair" chama o logout, o cookie de sessão deixa de existir, a tela vai para a Entrada, e voltar a `/estudio` pede a chave de novo.
**Passos:** clicar "Sair" em `/estudio`; ler URL e cookies; navegar para `/estudio`.
**Observei:** `POST /api/auth/logout` → `204`; URL `https://localhost/entrar`; cookies do contexto `[]`; `GET /api/auth/me` seguintes → `401`; `/estudio` → `https://localhost/entrar?next=%2Festudio` com `heading "Bem-vinda."`.

---

## Fora do escopo

- C1 a C5 e C12 (health, 401/403/415/413, cookie, `/s3`, cabeçalhos, download carimbado) — critério de API em execução no modo browser; cobertos na execução de API.
- Guardar na galeria e Partilhar: o critério C11 pede só os botões; os downloads em série e o `navigator.share` com ficheiros dependem do Android (SPEC 20).

---

## Notas da execução

- O browser do Playwright MCP recusa a CA interna do Caddy (`net::ERR_CERT_AUTHORITY_INVALID`). Liguei `Security.setIgnoreCertificateErrors` por CDP na página, o equivalente ao `ignoreHTTPSErrors` dos testes e2e. Efeito colateral: o Chromium não regista o service worker nessas condições, o que aparece no console como `An SSL certificate error occurred when fetching the script.` (6 vezes). Os outros 7 erros de console são os 401 esperados de `/api/auth/me` e `/api/auth/login`.
- O viewport de 390 tem `clientWidth` 375 porque este browser mostra barra de rolagem de 15 px.
- Imagens: 3 JPEG sintéticos 1200×1600 gerados com PIL (`qa-agent-1..3.jpg`), copiados para `.playwright-mcp/` (ignorado no git) porque o upload do MCP só aceita ficheiros dentro do repositório.
- Dados criados: lote `01a1d704-7922-7251-8a15-50bc60f23a64` com 3 fotos.
- No C7, a primeira tentativa errada não mostrou "Restam N" porque a API devolveu `remainingAttempts: 4` e a interface só mostra a contagem com N ≤ 3 (decisão registrada); a segunda tentativa mostrou `"Restam 3 tentativas."`.
- No C7, a chave de QA foi digitada pelo `browser_type` e ficou na transcrição da sessão; uma mensagem de erro do Playwright também imprimiu o cookie de sessão. A chave foi trocada e as sessões revogadas no fim do QA (`estudio secret rotate`).
- Também no C7, digitei primeiro 16 caracteres por engano (a tela mostrou `"Faltam 16 caracteres."`, `16/32`) e corrigi para 18.
