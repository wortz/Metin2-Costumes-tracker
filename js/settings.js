// Constantes públicas da app (não são segredos, podem ir no código do cliente).
// As preferências por-utilizador (limiares, Discord User ID) estão em
// user-settings.js, guardadas no Firestore.

// Client ID da app OAuth2 do Discord — usado para o botão "Obter automaticamente
// (login Discord)". Ver cloudflare-worker/README.md.
export const DISCORD_OAUTH_CLIENT_ID = "1551745128828502026";

// URL do Cloudflare Worker que envia as DMs (a segurança vem da verificação do
// token de login do Firebase feita pelo Worker, não de esconder este URL).
// Ver cloudflare-worker/README.md.
export const DISCORD_DM_WORKER_URL = "https://costumes-tracker-discord-dm.wortz.workers.dev";
