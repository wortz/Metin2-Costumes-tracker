// Avisa quando há uma versão nova da app: de tempos a tempos volta a pedir o
// index.html (sem cache) e compara o número de versão dos ficheiros com o desta
// página. Se for diferente, mostra uma faixa no topo com um botão para recarregar.
const CHECK_EVERY_MS = 5 * 60 * 1000;

// A versão em execução vem do próprio endereço deste módulo (…/update-check.js?v=XXXX).
const currentVersion = new URL(import.meta.url).searchParams.get("v");

let bannerShown = false;

async function fetchLatestVersion() {
  const res = await fetch(`index.html?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const match = (await res.text()).match(/main\.js\?v=([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}

function showBanner(latest) {
  if (bannerShown) return;
  bannerShown = true;
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.innerHTML = '<span>Há uma nova versão da app.</span>';
  const button = document.createElement("button");
  button.textContent = "Recarregar";
  button.addEventListener("click", () => {
    // Muda o endereço (em vez de só recarregar) para o browser não reutilizar o index.html antigo.
    const url = new URL(location.href);
    url.searchParams.set("update", latest);
    location.replace(url);
  });
  banner.appendChild(button);
  document.body.appendChild(banner);
}

async function check() {
  if (!currentVersion || bannerShown) return;
  try {
    const latest = await fetchLatestVersion();
    if (latest && latest !== currentVersion) showBanner(latest);
  } catch {
    // Sem rede ou erro temporário: tenta de novo na próxima verificação.
  }
}

export function startUpdateCheck() {
  // Limpa o parâmetro usado para forçar o recarregamento.
  const url = new URL(location.href);
  if (url.searchParams.has("update")) {
    url.searchParams.delete("update");
    history.replaceState(null, "", url);
  }
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}
