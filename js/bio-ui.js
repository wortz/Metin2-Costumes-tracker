import {
  BIO_TYPES,
  MAX_TIMERS_PER_CHARACTER,
  addBioTimer,
  deleteBioTimer,
  changeBioTimer,
  subscribeToOwnBioTimers,
} from "./bio.js";
import { addCharacter, deleteCharacterEverywhere, subscribeToOwnCharacters } from "./characters.js";
import { computeRemaining, formatEndDate } from "./costumes.js";
import { notifyBioTimer, notifyBioCollected } from "./notifications.js";

const listEl = document.getElementById("bio-list");
const addBtn = document.getElementById("bio-add-btn");

const addModal = document.getElementById("bio-modal");
const addForm = document.getElementById("bio-form");
const addError = document.getElementById("bio-form-error");
const characterInput = document.getElementById("bio-character");
const characterDatalist = document.getElementById("bio-character-list");
const groupSelect = document.getElementById("bio-group");
const subtypeLabel = document.getElementById("bio-subtype-label");
const subtypeSelect = document.getElementById("bio-subtype");
const durationHint = document.getElementById("bio-duration-hint");

const timeModal = document.getElementById("bio-time-modal");
const timeForm = document.getElementById("bio-time-form");
const timeError = document.getElementById("bio-time-error");
const timeTitle = document.getElementById("bio-time-title");
const timeHours = document.getElementById("bio-time-hours");
const timeMinutes = document.getElementById("bio-time-minutes");

let ownerUid = null;
let timers = [];
let characters = [];
let getExtraCharacterNames = () => [];
let getRecipients = () => [];
let getLimits = () => ({ characters: 5 });
let onReadyCount = () => {};
let editingTimer = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Tempo que falta só em horas e minutos (nestes timers nunca passa de 1 dia, por
// isso não se mostram dias; 24 horas aparece como "24h 0m").
function formatHoursMinutes({ days, hours, minutes }) {
  return `${days * 24 + hours}h ${minutes}m`;
}

function formatHours(ms) {
  const hours = ms / 3600000;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} horas`;
}

// Todas as personagens conhecidas (sem repetir, ignorando maiúsculas).
function allCharacterNames() {
  const seen = new Map();
  for (const name of [...characters.map((c) => c.name), ...timers.map((t) => t.character), ...getExtraCharacterNames()]) {
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "pt"));
}

// Cada personagem só pode ter 1 Biologo (1-8 ou Joias) e 1 6-7: devolve os grupos já usados.
function usedGroups(character) {
  return new Set(timersOf(character).map((t) => BIO_TYPES[t.type].group));
}

function timersOf(character) {
  return timers
    .filter((t) => t.character.toLowerCase() === character.toLowerCase())
    .sort((a, b) => computeRemaining(a.endAt).totalMs - computeRemaining(b.endAt).totalMs);
}

// ---------- Render ----------
// Quantos timers já terminaram (prontos a entregar/recolher): vai para a bolinha da barra lateral.
function reportReadyCount() {
  onReadyCount(timers.filter((t) => computeRemaining(t.endAt).expired).length);
}

function render() {
  reportReadyCount();
  listEl.innerHTML = "";
  const names = allCharacterNames();

  if (names.length === 0) {
    listEl.innerHTML = '<p class="empty-state">Ainda não tens tempos adicionados.</p>';
    return;
  }

  for (const character of names) {
    const group = document.createElement("div");
    group.className = "character-group";
    const characterTimers = timersOf(character);

    const header = document.createElement("div");
    header.className = "character-header";
    header.innerHTML = `<h3>${escapeHtml(character)}</h3>`;
    const addForCharacter = document.createElement("button");
    addForCharacter.className = "secondary small";
    addForCharacter.textContent = "+ Adicionar tempo";
    addForCharacter.disabled = usedGroups(character).size >= MAX_TIMERS_PER_CHARACTER;
    addForCharacter.title = addForCharacter.disabled ? "Esta personagem já tem um Biologo e um 6-7" : "";
    addForCharacter.addEventListener("click", () => openAddModal(character));

    const delCharacter = document.createElement("button");
    delCharacter.className = "icon-btn small";
    delCharacter.textContent = "×";
    delCharacter.title = "Apagar personagem";
    delCharacter.addEventListener("click", async () => {
      const message =
        `Apagar a personagem "${character}"?

` +
        `Vai apagar também TUDO o que ela tem, em todos os menus: trajes, pets e os tempos do Biologo / 6-7.
` +
        `Não dá para desfazer.`;
      if (!confirm(message)) return;
      try {
        await deleteCharacterEverywhere(ownerUid, character);
      } catch (err) {
        alert(err.message || "Erro ao apagar a personagem.");
      }
    });

    const actions = document.createElement("div");
    actions.className = "section-header-actions";
    actions.appendChild(addForCharacter);
    actions.appendChild(delCharacter);
    header.appendChild(actions);
    group.appendChild(header);

    if (characterTimers.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = "Sem tempos.";
      group.appendChild(empty);
    }
    for (const timer of characterTimers) group.appendChild(buildCard(timer));
    listEl.appendChild(group);
  }
}

function buildCard(timer) {
  const type = BIO_TYPES[timer.type];
  const remaining = computeRemaining(timer.endAt);

  const card = document.createElement("div");
  card.className = "costume-card" + (remaining.expired ? " ready" : "");

  const main = document.createElement("div");
  main.className = "costume-main";
  main.innerHTML = `<div class="costume-title"><span class="badge bio">${escapeHtml(type.label)}</span></div>`;

  const time = document.createElement("div");
  time.className = "costume-time";
  // Em grande: a data/hora a que termina; em pequeno: o tempo que falta.
  time.innerHTML = remaining.expired
    ? `<span class="remaining ready">Pronto</span>
       <span class="end-date">terminou em ${formatEndDate(remaining.endDate)}</span>`
    : `<span class="remaining ok">${formatEndDate(remaining.endDate)}</span>
       <span class="end-date">faltam ${formatHoursMinutes(remaining)}</span>`;

  const actions = document.createElement("div");
  actions.className = "costume-actions";

  const actionBtn = document.createElement("button");
  actionBtn.textContent = type.action;
  // Entregar / Recolher abrem um pop-up com o tempo pré-definido (editável).
  actionBtn.addEventListener("click", () => openCollectModal(timer));
  actions.appendChild(actionBtn);

  const changeBtn = document.createElement("button");
  changeBtn.className = "secondary";
  changeBtn.textContent = "Alterar tempo";
  changeBtn.addEventListener("click", () => openTimeModal(timer));
  actions.appendChild(changeBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn";
  delBtn.textContent = "Apagar";
  delBtn.addEventListener("click", () => {
    if (confirm(`Apagar o tempo "${type.label}" de ${timer.character}?`)) deleteBioTimer(timer.id);
  });
  actions.appendChild(delBtn);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "16px";
  right.appendChild(time);
  right.appendChild(actions);

  card.appendChild(main);
  card.appendChild(right);
  return card;
}

// ---------- Adicionar tempo ----------
function currentType() {
  return groupSelect.value === "bio" ? subtypeSelect.value : "sixseven";
}

function updateAddForm() {
  const isBio = groupSelect.value === "bio";
  subtypeLabel.hidden = !isBio;
  durationHint.textContent = `Tempo inicial: ${formatHours(BIO_TYPES[currentType()].durationMs)}`;
}

// Desativa o tipo que a personagem escolhida já tem e passa para o que está livre.
function refreshGroupOptions() {
  const used = usedGroups(characterInput.value.trim());
  for (const option of groupSelect.options) option.disabled = used.has(option.value);
  if (groupSelect.selectedOptions[0]?.disabled) {
    const free = [...groupSelect.options].find((o) => !o.disabled);
    if (free) groupSelect.value = free.value;
  }
  updateAddForm();
}

characterInput.addEventListener("input", refreshGroupOptions);
groupSelect.addEventListener("change", updateAddForm);
subtypeSelect.addEventListener("change", updateAddForm);

function openAddModal(character = "") {
  addForm.reset();
  addError.textContent = "";
  characterDatalist.innerHTML = "";
  for (const name of allCharacterNames()) {
    const option = document.createElement("option");
    option.value = name;
    characterDatalist.appendChild(option);
  }
  characterInput.value = character;
  refreshGroupOptions();
  addModal.showModal();
}

const characterModal = document.getElementById("bio-character-modal");
const characterForm = document.getElementById("bio-character-form");
const characterNameInput = document.getElementById("bio-character-name");
const characterError = document.getElementById("bio-character-error");

// O botão do topo só cria personagens (partilhadas com trajes e pets); os
// tempos adicionam-se no botão de cada personagem.
addBtn.addEventListener("click", () => {
  characterForm.reset();
  characterError.textContent = "";
  characterModal.showModal();
});
document.getElementById("bio-character-cancel").addEventListener("click", () => characterModal.close());

characterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  characterError.textContent = "";
  const name = characterNameInput.value.trim();
  if (!name) {
    characterError.textContent = "Indica um nome para a personagem.";
    return;
  }
  if (allCharacterNames().some((n) => n.toLowerCase() === name.toLowerCase())) {
    characterError.textContent = "Já existe uma personagem com esse nome.";
    return;
  }
  if (allCharacterNames().length >= getLimits().characters) {
    characterError.textContent = `Atingiste o limite de ${getLimits().characters} personagens.`;
    return;
  }
  try {
    await addCharacter({ ownerUid, name });
    characterModal.close();
  } catch (err) {
    characterError.textContent = err.message || "Erro ao criar a personagem.";
  }
});
document.getElementById("bio-cancel").addEventListener("click", () => addModal.close());

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  addError.textContent = "";
  const character = characterInput.value.trim();
  if (!character) {
    addError.textContent = "Indica o nome da personagem.";
    return;
  }
  const group = groupSelect.value;
  if (usedGroups(character).has(group)) {
    addError.textContent = `Esta personagem já tem um ${group === "bio" ? "Biologo" : "6-7"}. Cada personagem só pode ter um Biologo e um 6-7.`;
    return;
  }
  try {
    // Se for uma personagem nova, guarda-a (partilhada com trajes e pets).
    const known = allCharacterNames().some((n) => n.toLowerCase() === character.toLowerCase());
    if (!known && allCharacterNames().length >= getLimits().characters) {
      addError.textContent = `Atingiste o limite de ${getLimits().characters} personagens.`;
      return;
    }
    if (!known) await addCharacter({ ownerUid, name: character });
    await addBioTimer({ ownerUid, character, type: currentType() });
    addModal.close();
  } catch (err) {
    addError.textContent = err.message || "Erro ao guardar o tempo.";
  }
});

// Mensagem no Discord (3.º bot) com a hora a que já pode ser entregue/recolhido.
function sendBioMessage(timer, hours, minutes, changed) {
  const type = BIO_TYPES[timer.type];
  const readyAt = new Date(Date.now() + (hours * 60 + minutes) * 60 * 1000);
  notifyBioTimer({ label: type.label, action: type.action, character: timer.character, type: timer.type, readyAt, changed }, getRecipients());
}

// ---------- Entregar (Biologo) / Recolher (6-7) ----------
const collectModal = document.getElementById("bio-collect-modal");
const collectHours = document.getElementById("bio-collect-hours");
const collectMinutes = document.getElementById("bio-collect-minutes");
const collectError = document.getElementById("bio-collect-error");
const collectNewBtn = document.getElementById("bio-collect-new");
const collectDeleteBtn = document.getElementById("bio-collect-delete");
let collectingTimer = null;

function openCollectModal(timer) {
  collectingTimer = timer;
  const type = BIO_TYPES[timer.type];
  const isSixSeven = type.group === "sixseven";
  collectError.textContent = "";
  document.getElementById("bio-collect-title").textContent = `${type.action} — ${type.label}`;
  document.getElementById("bio-collect-text").textContent = isSixSeven
    ? `${timer.character}: queres começar um novo 6-7 ou apagar este tempo?`
    : `${timer.character}: o tempo recomeça com o valor abaixo.`;
  collectNewBtn.textContent = isSixSeven ? "Novo 6-7" : type.action;
  collectDeleteBtn.hidden = !isSixSeven;
  // Tempo pré-definido do tipo (22h / 12h / 24h), que o utilizador pode alterar.
  const totalMinutes = Math.round(type.durationMs / 60000);
  collectHours.value = Math.floor(totalMinutes / 60);
  collectMinutes.value = totalMinutes % 60;
  collectModal.showModal();
}

document.getElementById("bio-collect-cancel").addEventListener("click", () => collectModal.close());

collectNewBtn.addEventListener("click", async () => {
  const hours = Number(collectHours.value) || 0;
  const minutes = Number(collectMinutes.value) || 0;
  if (hours < 0 || minutes < 0 || hours * 60 + minutes <= 0) {
    collectError.textContent = "O tempo tem de ser maior que zero.";
    return;
  }
  try {
    await changeBioTimer(collectingTimer.id, { hours, minutes });
    sendBioMessage(collectingTimer, hours, minutes, false);
    collectModal.close();
  } catch (err) {
    collectError.textContent = err.message || "Erro ao atualizar o tempo.";
  }
});

collectDeleteBtn.addEventListener("click", async () => {
  try {
    const timer = collectingTimer;
    await deleteBioTimer(timer.id);
    notifyBioCollected({ label: BIO_TYPES[timer.type].label, character: timer.character, type: timer.type }, getRecipients());
    collectModal.close();
  } catch (err) {
    collectError.textContent = err.message || "Erro ao apagar o tempo.";
  }
});

// ---------- Alterar tempo ----------
function openTimeModal(timer) {
  editingTimer = timer;
  timeError.textContent = "";
  timeTitle.textContent = `Alterar tempo — ${timer.character} (${BIO_TYPES[timer.type].label})`;
  const remaining = computeRemaining(timer.endAt);
  timeHours.value = remaining.days * 24 + remaining.hours;
  timeMinutes.value = remaining.minutes;
  timeModal.showModal();
}

document.getElementById("bio-time-cancel").addEventListener("click", () => timeModal.close());

timeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  timeError.textContent = "";
  const hours = Number(timeHours.value) || 0;
  const minutes = Number(timeMinutes.value) || 0;
  if (hours < 0 || minutes < 0 || hours * 60 + minutes <= 0) {
    timeError.textContent = "O tempo tem de ser maior que zero.";
    return;
  }
  try {
    await changeBioTimer(editingTimer.id, { hours, minutes });
    sendBioMessage(editingTimer, hours, minutes, true);
    timeModal.close();
  } catch (err) {
    timeError.textContent = err.message || "Erro ao alterar o tempo.";
  }
});

// ---------- Ligação à app ----------
// Chamado no login; devolve a função que pára as subscrições. getExtraNames
// devolve personagens que só existem nos trajes/pets (para também aparecerem aqui).
export function startBio(user, getExtraNames, getRecipientsFn, getLimitsFn, onReadyCountFn) {
  ownerUid = user.uid;
  onReadyCount = onReadyCountFn || onReadyCount;
  getLimits = getLimitsFn || getLimits;
  getRecipients = getRecipientsFn || (() => []);
  getExtraCharacterNames = getExtraNames || (() => []);
  const unsubs = [
    subscribeToOwnBioTimers(user.uid, (items) => {
      timers = items;
      render();
    }),
    subscribeToOwnCharacters(user.uid, (items) => {
      characters = items;
      render();
    }),
  ];
  const interval = setInterval(render, 30000);
  return () => {
    unsubs.forEach((u) => u());
    clearInterval(interval);
    timers = [];
    characters = [];
    ownerUid = null;
    onReadyCount(0);
    listEl.innerHTML = "";
  };
}

export function renderBio() {
  render();
}
