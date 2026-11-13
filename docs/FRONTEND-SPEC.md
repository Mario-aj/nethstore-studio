# NethStore Estúdio: especificação do frontend

Nov 13, 2026 · @Mário Alfredo Jorge

## Visão geral

O Estúdio carimba preço e tamanho em grupos de até 50 fotos de uma vez, no lugar de editar foto a foto. Um fardo gera de 240 a 480 fotos, por isso o ganho está em definir o carimbo uma vez por grupo.

| Ponto | Decisão no design |
| --- | --- |
| Utilizadora | Uma só: a dona da NethStore |
| Aparelho | Telemóvel Android, Chrome, muitas vezes com uma mão |
| Onde corre | Computador de casa, acessado pela rede de casa |
| Formato | PWA instalada no ecrã inicial |
| Idioma da interface | Português de Angola, tratamento por tu |
| Moeda | kz minúsculo, ponto nos milhares: 10.000 kz |

O fluxo do app tem quatro telas:

1. **Entrada**: a chave de acesso abre o estúdio.
2. **Fotos e preço**: escolher as fotos e definir preço, tamanhos e descrição.
3. **Processamento**: enviar, preparar e carimbar, com progresso por etapa.
4. **Pronto**: guardar na galeria, partilhar ou começar um novo grupo, que volta ao passo 2.

O design está no canvas [NethStore Estúdio](https://claude.ai/artifact/NmaiLhS3YnjPgxHPBsYpxa), em três páginas: Landing, App e Componentes e tokens.

## Direção visual e tokens

A direção é Vitrine: fundo escuro como uma montra à noite, a foto em primeiro plano e a interface recuada. O champanhe aparece só no preço, no botão principal e no progresso. A hierarquia vem do tamanho e do peso do tipo, não da cor.

### Cor

| Token | Valor | Uso |
| --- | --- | --- |
| --color-bg | #0E0D0C | Fundo de todas as telas |
| --color-surface-1 | #181715 | Cartões, campos, folha inferior |
| --color-surface-2 | #211F1C | Botão desativado, chips não selecionados |
| --color-line | #2C2925 | Divisórias de 1px |
| --color-line-strong | #3A3631 | Contornos de campos e botões |
| --color-text | #F3EEE6 | Texto principal |
| --color-text-soft | #CFC7BC | Subtítulos e rótulos de campo |
| --color-text-muted | #A39A8E | Notas, contadores, texto secundário |
| --color-accent | #D8B77A | Preço, botão principal, anel de progresso |
| --color-on-accent | #1A1610 | Texto sobre champanhe |
| --color-accent-soft | #2A2418 | Chip de tamanho selecionado |
| --color-accent-soft-text | #E7CC98 | Texto sobre champanhe suave, links |
| --color-success | #5BC48A | Ícone concluído, ponto “Ligado” |
| --color-success-soft | #15291D | Pílula “Ligado”, “Pronta” |
| --color-success-text | #7FD6A4 | Texto de sucesso |
| --color-success-line | #1F3D2A | Contorno do aviso de sucesso |
| --color-error | #F07A6A | Ícone de erro, contorno de campo com erro |
| --color-error-soft | #2E1714 | Fundo de avisos de erro |
| --color-error-text | #F49A8D | Texto de erro |
| --color-error-line | #4A2620 | Contorno dos avisos de erro |
| --color-scrim | rgba(0, 0, 0, 0.62) | Fundo atrás da folha inferior |
| --color-stamp | #000000 | Texto do carimbo |

As cores success-line e error-line não estavam no briefing; foram acrescentadas para os contornos dos avisos.

### Tipo

Só Work Sans, nos pesos 300, 400 e 500.

| Papel | Tamanho (px) | Peso | Notas |
| --- | --- | --- | --- |
| Display da landing | 92 / 80 / 54 | 300 | Tracking −0.03em; desktop, tablet, mobile |
| Título | 56 / 44 / 34 | 300 | Secções da landing, Entrada, telas do app |
| Subtítulo | 28 / 22 | 300 | Título do processamento, cabeçalho da grelha |
| Corpo | 19 / 17 / 15 | 400 |  |
| Nota | 13 | 400 | Ajudas, contadores |
| Rótulo | 11 | 500 | Maiúsculas, tracking 0.2em |
| Ação | 16 / 14 | 500 | Botões |
| Preço | 40 / 24 | 500 | Champanhe, algarismos tabulares |

### Raio, espaço e toque

| Token | Valor |
| --- | --- |
| --radius-thumb | 12px |
| --radius-photo / --radius-field | 16px |
| --radius-field-lg | 18px |
| --radius-card | 20px |
| --radius-card-lg | 22px |
| --radius-pill | 999px |
| --space-1 a --space-30 | múltiplos de 4px: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 80, 120 |
| --tap-min | 44px |
| --button-h / --field-h | 56px |
| --line | 1px |

Proibido: gradientes decorativos, glassmorphism, sombras grandes, emoji, ilustrações 3D, roxo e azul “tech”. O único gradiente é o escurecimento sobre fotos para dar leitura ao texto.

## O carimbo

O carimbo é fixo: a interface mostra-o, mas nunca muda o estilo dele.

| Regra | Valor |
| --- | --- |
| Posição | Canto superior esquerdo da foto |
| Linhas | Duas |
| Linha 1 | Descrição/ Tamanhos, por exemplo “Veste/ M e L” |
| Linha 1 sem descrição | Só os tamanhos, por exemplo “M e L” |
| Linha 2 | Preço, por exemplo “10.000 kz” |
| Tamanhos possíveis | XS, S, M, L, XL, 2XL |
| Como se escrevem | “M”, “M e L”, “S, M e L” |
| Estilo | Texto preto, sem fundo |
| Descrição | Opcional, até 24 caracteres |

O canvas desenha o carimbo em Arial bold preto como substituto. **Em aberto:** qual é a fonte e o tamanho reais do carimbo usado hoje.

## Landing pública

A landing explica o app, ensina a instalar como PWA e leva ao login; nenhum dado da loja aparece sem a chave. Existe em três larguras: 1440 (desktop), 834 (tablet) e 390 (mobile).

| Secção | Conteúdo | Desktop 1440 | Tablet 834 | Mobile 390 |
| --- | --- | --- | --- | --- |
| Topo | NETHSTORE · Estúdio, botão “Entrar” em pílula com contorno | Links Como funciona, O carimbo, Instalar | Botão de menu | Botão de menu |
| Hero | “Do fardo à *montra* em minutos.”, subtítulo, “Entrar no estúdio”, “Instalar no telemóvel”, nota com ponto verde | Texto à esquerda, foto a sangrar até à borda direita, título 92px | Foto a toda a largura, título 80px na base | Foto a toda a largura, título 54px na base, botões empilhados |
| Sobre a foto do hero | Cartão “Pronta” com miniatura carimbada, “Veste/ S e M”, “8.000 kz”; pílula “A carimbar 7 de 12” | Canto inferior direito | Lado direito, a meio | Lado direito, compacto |
| Como funciona | “Três passos. Nenhuma edição à mão.”, passos 01, 02, 03, faixa de fotos | 3 colunas, 6 fotos | 3 colunas, 4 fotos | Passos empilhados, fotos com rolagem horizontal |
| O carimbo | Comparador Depois/Antes com divisória champanhe e pega circular, regras do carimbo | Comparador à esquerda, texto à direita | Comparador largo, regras em 2 colunas | Comparador, depois texto e regras |
| Instalar | “Fica no ecrã do telemóvel, como uma app.” e 3 cartões | 3 cartões lado a lado | Cartões empilhados em linha | Cartões empilhados |
| Chamada final | “Pronta para o próximo *fardo*?” e “Entrar no estúdio” | Centrada, 72px | Centrada, 60px | Centrada, 42px, botão a toda a largura |
| Rodapé | NETHSTORE · Estúdio, Luanda, Acesso privado | Uma linha | Uma linha | Duas linhas |

Fotos usadas: o vestido preto de bolinhas no hero, o conjunto laranja no cartão “Pronta” e o conjunto azul e branco no comparador. As palavras “montra” e “fardo” vêm em itálico champanhe.

## Entrada

A Entrada pede uma chave de 32 caracteres e só ativa “Entrar” com os 32. A foto do vestido bege ocupa o topo e escurece até ao fundo; por baixo vêm “Bem-vinda.” e “A tua chave abre o estúdio.”

Elementos fixos: NETHSTORE no topo, pílula de ligação “Ligado” ou “Desligado”, campo “Chave de acesso” mascarado com botão mostrar e botão “Colar”, contador 0/32 e a nota “Este telemóvel fica lembrado durante 30 dias.”

| Estado | Campo | Mensagem | Botão |
| --- | --- | --- | --- |
| Vazio | Contorno normal, 0/32 | “Pede a chave a quem instalou o estúdio.” | “Entrar” desativado |
| A escrever | Contorno champanhe, 18/32 | “Faltam 14 caracteres.” | “Entrar” desativado |
| Chave incompleta | Contorno coral, 26/32 | “A chave tem 32 caracteres. Esta tem 26.” | “Entrar” desativado |
| Chave errada | Contorno coral, 32/32 | “Chave errada. Restam 2 tentativas.” | “Entrar” ativo |
| Muitas tentativas | Bloqueado | Aviso “Muitas tentativas” com contagem 4:59 | “Tenta em 4:59” desativado |
| A verificar | Bloqueado, 32/32 | “A confirmar com o computador de casa.” | “A verificar” com spinner |
| Computador fora de alcance | 32/32 | Pílula “Desligado” e aviso “Confirma que estás no Wi-Fi de casa e que o computador está ligado.” | “Entrar” desativado e “Tentar ligar outra vez” |

O número de tentativas e o tempo de espera são exemplos do design. **Em aberto:** quantas tentativas antes do bloqueio e quanto tempo dura a espera.

## Fotos e preço

Nesta tela a utilizadora monta o grupo e define o carimbo; “Processar” só ativa com fotos e preço. O topo mostra NETHSTORE, o botão Sair, “NOVO LOTE · 13 NOV” e o título “Fotos e preço”.

Partes da tela:

- **Fotos:** sem fotos, uma área tracejada com “Escolher fotos” e “Tirar foto” (até 50 por grupo). Com fotos, uma faixa de miniaturas 3:4 de 120 × 160px, com o tile “Adicionar” tracejado primeiro, o contador “12 fotos no lote” e “Ver todas”.
- **Preço:** 40px, champanhe, teclado numérico, ponto nos milhares ao digitar, sufixo kz.
- **Tamanhos:** uma linha que abre a folha inferior.
- **Descrição:** opcional, até 24 caracteres, contador, exemplo “Veste, Conjunto, Saia”.
- **Rodapé fixo:** a linha “Carimbo: Veste/ M e L · 10.000 kz” e o botão “Processar 12 fotos”.

| Estado | O que muda |
| --- | --- |
| Sem fotos | Área vazia, tamanhos “Escolher”, botão “Processar fotos” desativado |
| Preço em falta | 12 fotos, rótulo PREÇO em coral, “Escreve o preço para processar.”, rodapé com “falta o preço” em coral, botão desativado |
| Folha de tamanhos | Fundo escurecido, folha com XS, S, M, L, XL, 2XL em grelha de 3, M e L selecionados, linha “No carimbo: Veste/ M e L”, botões “Limpar” e “Aplicar” |
| Pronto a processar | Preço 10.000, tamanhos M e L, descrição Veste, botão “Processar 12 fotos” ativo |
| Ver todas | Grelha de 3 colunas com as 12 fotos, botão de remover com alvo de 44px em cada uma, “Voltar”, “Adicionar” e “Concluir” |

As miniaturas nesta tela são as fotos originais, ainda sem carimbo.

## Processamento

O processamento mostra o lote inteiro num anel champanhe de 168px e o avanço de cada uma das quatro etapas. Por baixo, a faixa “JÁ PRONTAS” vai mostrando as miniaturas carimbadas.

As etapas, por ordem: Enviar fotos, Preparar imagens, Aplicar preço e tamanho, Pronto para guardar. Cada uma tem ícone de estado e contador (por exemplo 7/12).

| Estado | Anel | Título | Mensagem | Etapas |
| --- | --- | --- | --- | --- |
| A aplicar | 58%, “7 de 12 fotos” | “A aplicar o carimbo” | “Podes bloquear o telemóvel. O computador continua.” | 2 concluídas, 1 a carregar (7/12), 1 pendente; “1 falhou · repetir” |
| A enviar | 25%, “3 de 12 fotos” | “A enviar as fotos” | “Não feches o app enquanto as fotos sobem.” em champanhe suave | Enviar a carregar (3/12), resto pendente |
| Sem ligação | 25% em cinza, “Em pausa” | “Sem ligação” | Aviso “Perdeste a ligação ao computador” com retoma automática e “A tentar outra vez em 8 s” | Enviar com erro (“3/12 · em pausa”), resto pendente |
| Etapa com erro | 92%, “11 de 12 fotos” | “Uma foto falhou” | “As outras 11 estão prontas.” | Aplicar com erro (“11/12 · 1 falhou”); rodapé com “Seguir com 11” e “Repetir 1 foto” |

A mensagem muda depois do envio: enquanto as fotos sobem, o app precisa de ficar aberto; depois, o computador trabalha sozinho.

## Pronto

A tela Pronto entrega o lote carimbado: “Prontas” com um check verde e a linha “11 de 12 fotos carimbadas · Veste/ M e L · 10.000 kz”.

- **Grelha:** 4 colunas de miniaturas 3:4 carimbadas.
- **Falhas à parte:** cartão “1 foto falhou”, “Foto 12 · o carimbo não foi aplicado” e o botão “Repetir”.
- **Ações no rodapé:** “Guardar todas na galeria” (principal, champanhe), “Partilhar” e “Novo grupo” (contorno, lado a lado).

“Partilhar” abre a folha de partilha do sistema, para Instagram, TikTok e WhatsApp. “Novo grupo” volta a Fotos e preço.

## Componentes

O canvas define oito componentes, cada um com os seus estados. Todos têm alvo de toque de pelo menos 44px.

| Componente | Estados e variantes | Especificação |
| --- | --- | --- |
| Botão | Principal, principal a carregar, contorno, contorno pequeno, desativado, texto | Pílula, 56px de altura (pequeno 44px), 16px peso 500; principal em champanhe com texto #1A1610; desativado em #211F1C com texto #A39A8E |
| Campo | Normal, foco, erro | Raio 16 a 18px, 56 a 60px de altura, label real por cima; foco com contorno champanhe, erro com contorno coral e mensagem |
| Campo de preço | Com valor, vazio, em falta | 40px peso 500 champanhe, tabular, sufixo kz |
| Seletor de tamanhos | Selecionado, não selecionado | Chips em pílula de 56px, multi seleção; selecionado em #2A2418 com contorno champanhe e check |
| Miniatura | Normal, a processar, pronta, com erro | 3:4, raio 16px; a processar com spinner e foto a 40%; pronta com carimbo e check verde; erro com contorno coral e x |
| Item de etapa | Pendente, a carregar, concluído, erro | Linha de 56px com ícone, nome e contador; pendente círculo vazio, a carregar spinner champanhe, concluído círculo verde com check, erro círculo coral com x |
| Anel de progresso | Grande 168px, médio 96px em pausa, pílula 22px | Traço champanhe sobre #2C2925, percentagem 500 tabular no centro; em pausa fica cinza |
| Aviso de ligação | Pílula Ligado, pílula Desligado, aviso de perda, aviso de ligação de volta | Raio 18px, ícone wifi em linha; erro em #2E1714, sucesso em #15291D |

Ícones: só de linha simples, traço uniforme de 1.5px, desenhados em SVG inline.

## Notas para implementar

O destino é React com TypeScript, como PWA. Estas notas saem da forma como o design foi montado.

- **Tokens:** os nomes da secção Direção visual já estão prontos para um bloco `:root` de variáveis CSS; o canvas tem o bloco completo na prancheta Tokens.
- **Estados como props:** cada tela do canvas é um componente com uma prop `estado`. Entrada: vazio, escrever, incompleta, errada, bloqueada, verificar, desligado. Fotos: vazio, sem-preco, folha, pronto, todas. Processamento: aplicar, enviar, sem-ligacao, erro.
- **Preço:** guardar como número inteiro em kz e formatar com ponto nos milhares só na apresentação.
- **Texto do carimbo:** juntar os tamanhos com vírgula e “e” antes do último; sem descrição, a linha 1 fica só com os tamanhos.
- **Acessibilidade:** labels reais nos campos, `aria-label` nos botões só com ícone, `role="progressbar"` no anel, avisos com `role="alert"`.
- **Fonte:** Work Sans 300, 400 e 500, mais o itálico 300 para “montra” e “fardo”.

### Em aberto

- [ ] Fonte e tamanho reais do carimbo
- [ ] Número de tentativas antes do bloqueio e duração da espera
- [ ] Endereço do computador de casa a mostrar no passo 1 de Instalar
