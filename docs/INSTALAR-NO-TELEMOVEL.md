# Instalar no telemóvel (Android, Chrome)

Este passo a passo é para o modo `lan`, em que o Estúdio corre no computador de casa com um certificado da CA local do Caddy. No modo `public` (com domínio), salte para a parte 2.

> Capturas de ecrã: os menus do Android variam por fabricante e versão, por isso este guia descreve o caminho e o texto de cada ecrã. As capturas reais ficam por fazer no telemóvel da loja (ver `docs/QA-REPORT.md`, secção "Validar no telemóvel").

## Parte 1: instalar o certificado da CA (só no modo `lan`, uma vez)

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

## Parte 2: instalar a PWA

1. Ligue o telemóvel ao Wi-Fi de casa (modo `lan`) ou a qualquer rede (modo `public`).
2. Abra o Chrome e vá a `https://<IP do computador>` (por exemplo `https://192.168.1.50`) ou ao domínio.
3. A landing do Estúdio abre sem avisos de segurança. Se aparecer "A sua ligação não é privada", volte à parte 1.
4. Toque no menu **⋮** e escolha **Instalar app** (ou **Adicionar ao ecrã principal**, depois **Instalar**).
5. O ícone "Estúdio" aparece no ecrã inicial. Abra-o: a app abre direto em `/estudio`, sem barra do navegador.

## Parte 3: entrar

1. Na Entrada, cole ou escreva a chave de 32 caracteres que recebeu.
2. A pílula no topo deve dizer **Ligado**. Se disser **Desligado**, confirme que está no Wi-Fi de casa e que o computador está ligado (modo `lan`).
3. Toque em **Entrar**. O telemóvel fica lembrado durante 30 dias.

O gestor de senhas do Chrome pode oferecer-se para guardar a chave. Aceitar é seguro e evita ter de colá-la de novo.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| "A sua ligação não é privada" | CA não instalada, ou instalada como certificado de VPN/Wi-Fi | Repita a parte 1 escolhendo **Certificado CA** |
| Não aparece "Instalar app" | Página aberta por `http://` ou com aviso de certificado | Abra o endereço com `https://` e sem avisos |
| "Desligado" na Entrada | Telemóvel fora do Wi-Fi de casa, ou computador desligado | Ligue ao Wi-Fi de casa; no computador, `make ps` |
| "Muitas tentativas" | Várias chaves erradas seguidas | Espere a contagem terminar; confirme a chave com quem instalou |
| A partilha não mostra Instagram ou TikTok | Limite do Android para vários ficheiros | Partilhe em grupos menores; o botão já envia de 10 em 10 |
