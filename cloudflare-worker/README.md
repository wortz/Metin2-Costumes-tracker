# DM no Discord via bot (Cloudflare Worker)

Este Worker faz duas coisas:

1. **Pedido manual** (botão "Testar DM" na app): recebe um pedido do browser e
   envia uma DM, autenticando quem pede através do próprio token de login do
   Firebase — só quem tem conta válida nesta app consegue disparar uma DM.
2. **Verificação agendada** (a cada hora, sozinho, mesmo com o site fechado):
   lê diretamente do Firestore os trajes de todos os utilizadores e envia DMs
   a quem estiver perto de expirar. Para isto, usa uma credencial de serviço
   do Firebase (Admin), que ignora as regras de segurança normais.

O token do bot e a credencial de serviço ficam só aqui (nunca no browser) —
são a única forma segura de fazer isto a partir de uma app que corre só no
cliente (GitHub Pages).

## 1. Criar o bot do Discord

1. Vai a [discord.com/developers/applications](https://discord.com/developers/applications) e cria uma **New Application** (dá-lhe o nome que quiseres, ex: "Costumes Tracker Bot").
2. No menu lateral, vai a **Bot** → **Add Bot**.
3. Em **Privileged Gateway Intents**, não precisas de ativar nenhuma (o Worker só usa a API REST, não liga por gateway).
4. Clica em **Reset Token** (ou "View Token") e copia o **token do bot** — vais precisar dele no passo 3. Trata-o como uma password: nunca o partilhes nem o cometas no Git.

## 2. Convidar o bot para um servidor

O Discord só deixa um bot mandar DM a alguém que esteja num servidor em comum com o bot. Cria um servidor "só para ti" (ou usa um já existente) e convida o bot para lá — cada utilizador que quiser receber DMs também tem de estar nesse servidor.

1. No menu lateral da aplicação, vai a **OAuth2 → URL Generator**.
2. Em **Scopes**, marca `bot`.
3. Em **Bot Permissions**, não precisas de marcar nenhuma permissão especial (só precisa de "existir" no servidor).
4. Copia o URL gerado no fundo da página, abre-o num separador novo, escolhe o servidor, e autoriza.

## 3. Ativar o login "Continuar com Discord" (OAuth2)

Isto é o que permite o botão "Obter automaticamente (login Discord)" nas Configurações da app.

1. No menu lateral da aplicação, vai a **OAuth2 → General**.
2. Copia o **Client ID** (no topo da página — este não é secreto, pode ir no código da app).
3. Em **Redirects**, adiciona o URL exato onde a app está publicada (ex: `https://wortz.github.io/Metin2-Costumes-tracker/`, com a barra final) e Guarda.
4. Cola o Client ID em [`js/settings.js`](../js/settings.js), na constante `DISCORD_OAUTH_CLIENT_ID`.

## 4. Criar a credencial de serviço do Firebase (para a verificação agendada)

Isto é o que permite ao Worker ler o Firestore sozinho, sem precisar do browser.

1. Na [Firebase Console](https://console.firebase.google.com), abre o teu projeto → ⚙️ **Definições do projeto → Contas de serviço**.
2. Clica em **Gerar nova chave privada** — descarrega um ficheiro `.json`. Trata-o como uma password: nunca o partilhes nem o cometas no Git.
3. Abre esse ficheiro; vais precisar de dois valores dele: `client_email` e `private_key`.

## 5. Publicar o Worker na Cloudflare (grátis, sem cartão)

1. Cria uma conta grátis em [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. Nesta pasta (`cloudflare-worker/`), corre `npm install` para instalar as dependências.
3. Corre `npx wrangler login` para autenticares (abre o browser).
4. Corre `npx wrangler deploy` — isto publica o Worker (código + o agendamento a cada hora, já configurados em [`worker.js`](worker.js) e [`wrangler.toml`](wrangler.toml)).
5. Define os secrets (cada comando vai pedir para colares o valor — nunca ficam no código):
   ```
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put FIREBASE_CLIENT_EMAIL
   npx wrangler secret put FIREBASE_PRIVATE_KEY
   ```
   - `DISCORD_BOT_TOKEN` → o token do passo 1.
   - `FIREBASE_CLIENT_EMAIL` → o campo `client_email` do ficheiro `.json` do passo 4.
   - `FIREBASE_PRIVATE_KEY` → o campo `private_key` do ficheiro `.json` do passo 4 (cola tal como está, com os `\n` incluídos — o Worker já trata disso).
6. Se o `projectId` do teu Firebase for diferente de `costumes-tracker`, ajusta o valor de `FIREBASE_PROJECT_ID` em [`wrangler.toml`](wrangler.toml) e volta a correr `npx wrangler deploy`.
7. O Worker fica disponível num URL tipo `https://costumes-tracker-discord-dm.<a-tua-conta>.workers.dev`. Cola esse URL em [`js/settings.js`](../js/settings.js), na constante `DISCORD_DM_WORKER_URL` (também não é secreto — a segurança vem da verificação do login, não de esconder o URL).

## 6. Usar na app

Cada utilizador, nas **⚙ Configurações** da app, na secção "Discord — DM privada via bot", pode ter **vários destinatários** (ex: ele próprio e um amigo/guild leader):
1. Clica em **"Adicionar via login Discord"** para adicionares a tua própria conta automaticamente (nome + ID preenchidos sozinhos).
2. Para outras pessoas, pede-lhes o Discord User ID delas (Modo de Programador → Copiar ID do Utilizador) e usa o campo "Nome" + "Discord User ID" com o botão **"+ Adicionar"**.
3. Clica em **Guardar**.
4. Usa o botão **"Testar DM"** para confirmar que todos os destinatários da lista recebem a mensagem.

Quando um traje está prestes a expirar, a mensagem é enviada a **todos** os destinatários configurados.

Não precisam de token, password, nem de ativar Modo de Programador — só o login do Discord.
