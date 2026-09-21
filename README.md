# Metin2 Costumes Tracker

WebApp para acompanhar o tempo restante dos trajes (corpo, arma e cabeça) de cada
personagem, com aviso quando um traje está prestes a expirar. Cada utilizador só
vê os seus próprios trajes; existe uma conta de administrador que gere os
utilizadores (não há registo público).

É uma app 100% estática (HTML/CSS/JS, sem build), pronta para o GitHub Pages,
com autenticação e base de dados no Firebase (plano gratuito Spark).

## Funcionalidades

- **Trajes**: adicionar traje com personagem, tipo (corpo/arma/cabeça),
  descrição, tempo restante (dias/horas/minutos) e limiar de aviso (dias antes
  de expirar). Lista organizada por personagem e, dentro de cada uma, por
  tempo restante (o mais urgente primeiro), mostrando o tempo restante e a
  data/hora exata em que o traje termina. Botão para apagar.
- **Notificações**: quando um traje entra na janela de aviso definida,
  dispara-se uma notificação do browser (requer permissão e o separador
  aberto — ver limitações abaixo).
- **Administração**: conta admin (não se regista, é criada manualmente uma
  única vez) com um menu extra que lista todos os utilizadores, número de
  trajes de cada um, botão para criar novo utilizador e botão para "apagar"
  utilizador.

## Limitações conhecidas

- **Apagar utilizador**: por limitação do plano gratuito do Firebase (apagar
  contas de Auth por completo exige Cloud Functions, que requerem o plano
  Blaze com cartão associado), "apagar" um utilizador **desativa** a conta
  (deixa de conseguir entrar) e apaga todos os seus trajes. O registo de login
  em si fica no Firebase Authentication, mas fica inutilizável.
- **Notificações**: usam a API `Notification` do browser, por isso só
  funcionam enquanto a página está aberta num separador (não há push quando a
  app está fechada, pois isso exigiria um backend/service worker próprio).

## Configuração (passo a passo)

### 1. Criar o projeto Firebase

1. Vai a [console.firebase.google.com](https://console.firebase.google.com) e
   cria um novo projeto (fica no plano gratuito **Spark** — não precisas de
   cartão de crédito).
2. Em **Build > Authentication**, ativa o sign-in method **Email/Password**.
3. Em **Build > Firestore Database**, cria a base de dados (podes escolher
   "modo de produção" — as regras deste repositório tratam da segurança).

### 2. Configurar as credenciais da app

1. Em **Definições do projeto** (ícone de engrenagem) > **As tuas apps**,
   cria uma app **Web** (`</>`).
2. Copia o objeto `firebaseConfig` que aparece e cola-o em
   [`js/firebase-config.js`](js/firebase-config.js), substituindo os valores
   de exemplo. Estes valores não são secretos — a segurança é garantida pelas
   regras do Firestore, não por esconder esta configuração.

### 3. Publicar as regras de segurança

No Firebase Console, vai a **Firestore Database > Regras** e cola o conteúdo
de [`firestore.rules`](firestore.rules) deste repositório, depois clica em
**Publicar**.

(Se preferires usar a Firebase CLI: `firebase deploy --only firestore:rules`.)

### 4. Criar a conta de administrador

Como não há registo público, a primeira conta (admin) cria-se manualmente:

1. Em **Authentication > Users**, clica **Add user**, indica um email e uma
   password, e cria a conta. Copia o **User UID** gerado.
2. Em **Firestore Database > Dados**, cria a coleção `users` (se ainda não
   existir) e dentro dela um documento com o **ID igual ao User UID** copiado,
   com os campos:
   - `email` (string) — o mesmo email da conta criada
   - `displayName` (string) — nome a mostrar, ex: "Admin"
   - `role` (string) — `admin`
   - `disabled` (boolean) — `false`

A partir daqui, esta conta consegue entrar na app e usar o separador
**Administração** para criar os restantes utilizadores diretamente pela
interface (não precisas de repetir este processo manual para os outros).

### 5. Publicar no GitHub Pages

1. Faz commit e push deste repositório para o GitHub.
2. Em **Settings > Pages**, escolhe **Deploy from a branch**, seleciona o
   branch `main` e a pasta `/ (root)`.
3. Guarda — o GitHub dá-te o URL público (algo como
   `https://<utilizador>.github.io/Metin2-Costumes-tracker/`).

Também podes simplesmente abrir o [`index.html`](index.html) localmente no
browser para testar antes de publicar.

## Estrutura de dados (Firestore)

```
users/{uid}
  email: string
  displayName: string
  role: "admin" | "user"
  disabled: boolean
  createdAt: timestamp

costumes/{id}
  ownerUid: string
  character: string
  type: "body" | "weapon" | "head"
  description: string
  endAt: timestamp        // momento exato em que o traje expira
  sectionId: string | null
  createdAt: timestamp

sections/{id}
  ownerUid: string
  character: string
  name: string
  isDefault: boolean      // true só na secção "Geral", automática por personagem
  order: number
  createdAt: timestamp

characters/{id}
  ownerUid: string
  name: string
  order: number
  createdAt: timestamp
```

As notificações do browser disparam quando falta menos de 1 dia para um traje expirar
(fixo, não configurável por traje), repetindo a cada hora cheia se a opção "Repetir
avisos a cada hora" estiver ligada (preferência guardada no browser, por utilizador).
