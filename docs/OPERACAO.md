# Operação

Guia para quem instala e mantém o Estúdio. Todos os comandos correm na raiz do repositório.

## Requisitos

* Linux com Docker 24+ e Docker Compose v2. Também funciona em macOS com Docker Desktop.
* `make`, `openssl`, `curl`.
* Para desenvolver: Go 1.26 e Node 24 com pnpm 10.

## Primeiro arranque

### Modo `lan` (rede de casa)

1. Reserve um IP fixo para o computador no router (reserva DHCP). Exemplo: `192.168.1.50`.
2. Gere a configuração e inicialize o armazenamento:

   ```sh
   DEPLOY_MODE=lan LAN_HOST=192.168.1.50 make init
   ```

   Sem `LAN_HOST`, o script tenta descobrir o IP principal do computador. Confira o valor no `.env`.
3. Suba tudo: `make up`. A primeira vez demora (constrói as imagens da API e do site).
4. Gere a chave de acesso: `make secret`. A chave aparece **uma única vez**. Passe-a à dona da loja por um canal seguro (pessoalmente, ou num gestor de senhas).
5. Exporte o certificado da CA local: `make ca-export`. O ficheiro fica em `deploy/ca/estudio-root.crt`.
6. Instale o certificado no telemóvel e a PWA: [INSTALAR-NO-TELEMOVEL.md](INSTALAR-NO-TELEMOVEL.md).

### Modo `public` (na internet, com domínio)

Serve para um VPS ou para o próprio computador de casa com redirecionamento de portas.

1. Aponte um registo DNS `A` (e `AAAA`, se houver IPv6) do domínio para o IP público do servidor.
2. Abra as portas 80 e 443 para o servidor. Em casa: redirecionamento de portas no router para o IP fixo do computador. Num VPS: regra no firewall do fornecedor.
3. Gere a configuração:

   ```sh
   DEPLOY_MODE=public PUBLIC_DOMAIN=estudio.exemplo.com ACME_EMAIL=voce@exemplo.com make init
   ```

4. `make up`. O Caddy pede o certificado ao Let's Encrypt no primeiro acesso (precisa da porta 80 aberta).
5. `make secret` e envie a chave à dona da loja.
6. No telemóvel basta abrir `https://estudio.exemplo.com` e instalar a PWA. Não há CA para instalar.

Diferenças do modo `public` (ver `docs/DECISOES.md`):

* HSTS ligado.
* `LOGIN_GLOBAL_LOCKOUT` desligado por padrão: um atacante não consegue bloquear o login de todos. O limite por IP continua.
* Os textos da app deixam de falar em "computador de casa" e "Wi-Fi de casa".

### Cloudflare Tunnel (alternativa, não automatizada)

Se o fornecedor de internet não deixar abrir portas (CGNAT), dá para expor o modo `public` por um Cloudflare Tunnel:

1. Use o modo `lan` com `LAN_HOST` igual ao domínio público (o Caddy emite o certificado pela CA interna) e `APP_ORIGIN=https://<domínio>`.
2. Acrescente um serviço `cloudflared` ao Compose, na rede `edge`, com o token do túnel, e no painel da Cloudflare aponte o hostname para `https://caddy:443` com "No TLS Verify" ligado (o TLS público fica a cargo da Cloudflare).
3. Atenção ao IP real: atrás do túnel, todos os pedidos chegam do `cloudflared`. Seria preciso confiar no cabeçalho `CF-Connecting-IP` para o limite de tentativas por IP voltar a distinguir clientes. Isto não está implementado; até lá, o limite por IP vale para todos os acessos juntos. Ligue `LOGIN_GLOBAL_LOCKOUT=false`.

Esta variante não foi testada. Prefira o modo `public` com portas abertas sempre que possível.

## Dia a dia

| Tarefa | Comando |
| --- | --- |
| Ver estado | `make ps` |
| Ver logs | `make logs` |
| Parar | `make down` (os dados ficam nos volumes) |
| Subir de novo | `make up` |
| Trocar a chave de acesso | `make secret` (revoga todas as sessões) |
| Ver sessões ativas | `make sessions-list` |
| Revogar sessões (telemóvel perdido) | `make sessions-revoke`, depois `make secret` |
| Apagar um lote | Botão "Apagar lote" no fim da tela Prontas, no app |
| Apagar todos os lotes e fotos | `make reset-data` (ver abaixo) |

## Telemóvel perdido ou chave exposta

1. `make secret`: gera uma chave nova e termina todas as sessões.
2. Entregue a nova chave à dona da loja.

## Backup e restauro

* `make backup` cria `backups/AAAA-MM-DD/` com:
  * `estudio.db`: cópia consistente do SQLite (`VACUUM INTO`, sem parar a API).
  * `garage-meta.tar.gz` e `garage-data.tar.gz`: volumes do Garage. O Garage para alguns segundos durante o arquivo; envios em curso tentam de novo sozinhos.
  * `SHA256SUMS`.
* Copie a pasta `backups/` para fora do computador (disco externo, nuvem pessoal). O backup contém as fotos da loja.
* `make restore DATE=AAAA-MM-DD` confere os checksums, pede confirmação (escrever `RESTAURAR`) e substitui os dados atuais.

## Apagar tudo e começar do zero

`make reset-data` pede confirmação (escrever `APAGAR`) e depois:

1. Para a stack.
2. Esvazia os volumes `api-data` (base de dados) e `garage-meta`/`garage-data` (fotos).
3. Volta a inicializar o Garage (layout, bucket e chave da API a partir do `.env`) e sobe a stack.
4. Gera uma chave de acesso nova e mostra-a uma vez. A chave antiga e as sessões deixam de valer, por isso o telemóvel volta a pedir a chave.

Não mexe no `.env`, no volume `caddy-data` (a CA local, então não é preciso reinstalar o certificado no telemóvel) nem na pasta `backups/`. Se quiser uma cópia antes, corra `make backup`.

Não apague só um dos volumes à mão: a base de dados e o Garage ficam dessincronizados.

## Retenção automática

O zelador corre um minuto depois do arranque e depois a cada 24 h:

* Originais e miniaturas com mais de `RETENTION_ORIGINALS_DAYS` dias (padrão 30) são apagados. As fotos carimbadas ficam.
* Lotes inteiros com mais de `RETENTION_BATCHES_DAYS` dias (padrão 90) são apagados.
* Fotos à espera de envio há mais de 24 h passam a falhadas.
* Sessões expiradas e tentativas de login com mais de 7 dias são apagadas.

## Atualizar a aplicação

```sh
git pull
make up        # reconstrói as imagens e reinicia o que mudou
```

As migrações da base de dados correm sozinhas no arranque da API. Faça `make backup` antes de atualizar.

Para atualizar as imagens base (Caddy, Garage, Go, Node), troque o digest em `deploy/*.Dockerfile` e `deploy/docker-compose.yml` e corra `make check test-integration` antes de `make up`.

## Firewall no computador (modo `lan`)

Só as portas 80 e 443 precisam de estar abertas para a rede local. Com `ufw`:

```sh
sudo ufw allow from 192.168.1.0/24 to any port 443 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 80 proto tcp
```

Para publicar só numa interface, defina `BIND_ADDR` no `.env` com o IP do computador.

Recomendação: deixe as visitas na rede de convidados do router, separada da rede do computador.

## Se o IP do computador mudar (modo `lan`)

1. Atualize a reserva DHCP no router, se possível, para voltar ao IP antigo. É o caminho mais simples.
2. Se não der: `DEPLOY_MODE=lan LAN_HOST=<novo IP> make init` (mantém os segredos e atualiza `LAN_HOST` e `APP_ORIGIN`), depois `make up`.
3. O certificado é emitido para o novo IP pela mesma CA, por isso não é preciso reinstalar a CA no telemóvel. A PWA instalada aponta para o endereço antigo: desinstale e instale de novo a partir do novo endereço.

## Testes e auditoria

| Comando | O que faz |
| --- | --- |
| `make check` | gofmt, vet, golangci-lint, testes Go com `-race` e cobertura, eslint, prettier, tsc, Vitest |
| `make test-integration` | testes Go contra um Garage descartável em `127.0.0.1:39000` |
| `make e2e` | Playwright contra a stack em execução. **Troca a chave de acesso**; use só em desenvolvimento |
| `make audit` | govulncheck, gosec, `pnpm audit`, gitleaks no histórico |
| `make security-check` | curl contra a stack: cabeçalhos, 401, 403, 415, 413, 404 do `/s3`, portas. Com `ESTUDIO_SECRET=<chave>` também confere o cookie |
