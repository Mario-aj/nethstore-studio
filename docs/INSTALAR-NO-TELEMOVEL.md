# Instalar no telemóvel (Android e iPhone)

Este passo a passo é para o modo `lan`, em que o Estúdio corre no computador de casa com um certificado da CA local do Caddy. No modo `public` (com domínio), salte para a parte 2.

> Capturas de ecrã: os menus do Android variam por fabricante e versão, e os do iPhone pela língua escolhida, por isso este guia descreve o caminho e o texto de cada ecrã. As capturas reais ficam por fazer no telemóvel da loja (ver `docs/QA-REPORT.md`, secção "Validar no telemóvel").

## Parte 1: instalar o certificado da CA (só no modo `lan`, uma vez por telemóvel)

### Android

Sem este passo o Chrome mostra "A sua ligação não é privada" e não deixa instalar a PWA, partilhar ficheiros nem manter o ecrã ligado.

1. No computador, corra `make ca-export`. O ficheiro fica em `deploy/ca/estudio-root.crt`.
2. Passe o ficheiro para o telemóvel: cabo USB, Bluetooth, ou e-mail para si próprio. Não publique o ficheiro em lado nenhum.
3. No telemóvel, abra **Definições**.
4. Procure **Segurança e privacidade** (ou **Segurança**), depois **Mais definições de segurança** (ou **Encriptação e credenciais**).
5. Toque em **Instalar a partir do armazenamento** (ou **Instalar certificado**) e escolha **Certificado CA**.
6. O Android avisa que a rede pode ser monitorizada. É esperado: toque em **Instalar mesmo assim**.
7. Confirme com o PIN ou a impressão digital e escolha o ficheiro `estudio-root.crt`.
8. Para conferir: **Credenciais fidedignas**, separador **Utilizador**: aparece "Caddy Local Authority".

O aviso "rede monitorizada" fica nas notificações. Ele só existe porque há uma CA instalada pelo utilizador; o certificado só serve para o endereço do Estúdio.

### iPhone

No iPhone são dois passos: instalar o perfil **e** ligar a confiança total. Sem o segundo passo, o Safari mostra "Esta conexão não é privada" (*This Connection Is Not Private*). Se alguém tocar em "Mostrar Detalhes" e depois em "visitar este site" nesse aviso, a página até abre, mas só por algumas horas: o servidor renova o certificado sozinho várias vezes por dia, e a partir daí a app mostra **"Computador fora de alcance"** (foi o que aconteceu em 14/11/2026).

Os nomes abaixo são os do iPhone em português do Brasil, com o inglês entre parênteses. Em português de Portugal, "Ajustes" chama-se "Definições".

1. No computador, corra `make ca-export` (se ainda não existir `deploy/ca/estudio-root.crt`).
2. Envie o ficheiro para o iPhone por **AirDrop** ou por **e-mail** para si próprio, e abra-o no app **Mail** da Apple. Não publique o ficheiro em lado nenhum.
3. O iPhone diz "Perfil baixado" (*Profile Downloaded*). Toque em **Fechar**.
4. Abra **Ajustes** (*Settings*). Logo no topo aparece **Perfil Baixado**. Se não aparecer, vá a **Geral → VPN e Gerenciamento de Dispositivos** (*General → VPN & Device Management*).
5. Toque no perfil "Caddy Local Authority - 2026 ECC Root", depois em **Instalar** (*Install*), confirme com o código do iPhone e toque em **Instalar** mais duas vezes.
6. **Passo que não pode faltar:** vá a **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificado** (*Settings → General → About → Certificate Trust Settings*), ligue a chave de **Caddy Local Authority - 2026 ECC Root** e confirme com **Continuar**.
7. Para conferir: abra o Safari em `https://<IP do computador>`. A landing do Estúdio tem de abrir sem nenhum aviso.

Se um dia o perfil for apagado ou o iPhone for trocado, repita os passos 2 a 6. Instalar o perfil outra vez não liga a confiança sozinho: o passo 6 é sempre preciso.

## Parte 2: instalar a PWA

### Android (Chrome)

1. Ligue o telemóvel ao Wi-Fi de casa (modo `lan`) ou a qualquer rede (modo `public`).
2. Abra o Chrome e vá a `https://<IP do computador>` (por exemplo `https://192.168.1.50`) ou ao domínio.
3. A landing do Estúdio abre sem avisos de segurança. Se aparecer "A sua ligação não é privada", volte à parte 1.
4. Toque no menu **⋮** e escolha **Instalar app** (ou **Adicionar ao ecrã principal**, depois **Instalar**).
5. O ícone "Estúdio" aparece no ecrã inicial. Abra-o: a app abre direto em `/estudio`, sem barra do navegador.

### iPhone (Safari)

1. Ligue o iPhone ao Wi-Fi de casa (modo `lan`) ou a qualquer rede (modo `public`).
2. Abra o **Safari** e vá a `https://<IP do computador>` ou ao domínio. Tem de abrir sem avisos; se aparecer "Esta conexão não é privada", volte à parte 1 (iPhone), passo 6.
3. Toque em **Compartilhar** (*Share*, o quadrado com a seta para cima) e escolha **Adicionar à Tela de Início** (*Add to Home Screen*), depois **Adicionar**.
4. Abra o ícone "Estúdio" no ecrã inicial.

No iPhone, "Guardar todas na galeria" abre a folha de partilha com todas as fotos: escolha **Salvar Imagens** (*Save Images*) e elas vão para o app Fotos de uma vez.

## Parte 3: entrar

1. Na Entrada, cole ou escreva a chave de 32 caracteres que recebeu.
2. A pílula no topo deve dizer **Ligado**. Se disser **Desligado**, confirme que está no Wi-Fi de casa e que o computador está ligado (modo `lan`).
3. Toque em **Entrar**. O telemóvel fica lembrado durante 30 dias.

O gestor de senhas do Chrome pode oferecer-se para guardar a chave. Aceitar é seguro e evita ter de colá-la de novo.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| "A sua ligação não é privada" | CA não instalada, ou instalada como certificado de VPN/Wi-Fi | Repita a parte 1 escolhendo **Certificado CA** |
| iPhone: funcionava e de repente diz "Computador fora de alcance", mesmo no Wi-Fi de casa | Confiança total na CA desligada; o acesso dependia de "visitar este site", que deixa de valer quando o servidor renova o certificado | Parte 1 (iPhone), passo 6. Depois feche a app por completo e abra de novo |
| iPhone: "Esta conexão não é privada" | Perfil não instalado, ou confiança total desligada | Parte 1 (iPhone), passos 2 a 6 |
| Não aparece "Instalar app" | Página aberta por `http://` ou com aviso de certificado | Abra o endereço com `https://` e sem avisos |
| "Desligado" ou "Computador fora de alcance" na Entrada | Telemóvel fora do Wi-Fi de casa, computador desligado ou com outro IP | Ligue ao Wi-Fi de casa; no computador, `make ps` e confirme o IP (`LAN_HOST` no `.env`) |
| "Muitas tentativas" | Várias chaves erradas seguidas | Espere a contagem terminar; confirme a chave com quem instalou |
| A partilha não mostra Instagram ou TikTok | Limite do Android para vários ficheiros | Partilhe em grupos menores; o botão já envia de 10 em 10 |
