import { login, logout, onAuthChange, isAdmin, currentUser } from "./auth.js";
import {
  COSTUME_TYPES,
  COSTUME_ICONS,
  addCostume,
  deleteCostume,
  renewCostume,
  moveCostume,
  subscribeToOwnCostumes,
  subscribeToAllCostumes,
  computeRemaining,
  formatEndDate,
  formatRemaining,
} from "./costumes.js";
import {
  addSection,
  deleteSection,
  subscribeToOwnSections,
  reorderSections,
  ensureDefaultSection,
} from "./sections.js";
import {
  addCharacter,
  deleteCharacter,
  subscribeToOwnCharacters,
} from "./characters.js";
import { createUser, disableUser, subscribeToUsers } from "./admin.js";
import { requestNotificationPermission, checkCostumeNotifications, clearNotified } from "./notifications.js";

// ---------- Elements ----------
const loadingView = document.getElementById("loading-view");
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const userEmailEl = document.getElementById("user-email");
const tabsEl = document.getElementById("tabs");
const costumesViewEl = document.getElementById("costumes-view");
const adminViewEl = document.getElementById("admin-view");
const costumesListEl = document.getElementById("costumes-list");
const usersListEl = document.getElementById("users-list");

const addCostumeBtn = document.getElementById("add-costume-btn");
const costumeModal = document.getElementById("costume-modal");
const costumeForm = document.getElementById("costume-form");
const costumeFormError = document.getElementById("costume-form-error");
const costumeCancelBtn = document.getElementById("costume-cancel");
const costumeTypePicker = document.getElementById("costume-type-picker");
const costumeTypeInput = document.getElementById("costume-type");

const renewModal = document.getElementById("renew-modal");
const renewForm = document.getElementById("renew-form");
const renewFormError = document.getElementById("renew-form-error");
const renewCancelBtn = document.getElementById("renew-cancel");
const renewCostumeIcon = document.getElementById("renew-costume-icon");
const renewCostumeName = document.getElementById("renew-costume-name");
const renewCostumeType = document.getElementById("renew-costume-type");
const renewCostumeDesc = document.getElementById("renew-costume-desc");

const sectionModal = document.getElementById("section-modal");
const sectionForm = document.getElementById("section-form");
const sectionFormError = document.getElementById("section-form-error");
const sectionCancelBtn = document.getElementById("section-cancel");
const sectionCharacterLabel = document.getElementById("section-character-label");

const addCharacterBtn = document.getElementById("add-character-btn");
const characterModal = document.getElementById("character-modal");
const characterForm = document.getElementById("character-form");
const characterFormError = document.getElementById("character-form-error");
const characterCancelBtn = document.getElementById("character-cancel");

const addUserBtn = document.getElementById("add-user-btn");
const userModal = document.getElementById("user-modal");
const userForm = document.getElementById("user-form");
const userFormError = document.getElementById("user-form-error");
const userCancelBtn = document.getElementById("user-cancel");

const notifHint = document.getElementById("notif-hint");
const enableNotifBtn = document.getElementById("enable-notif-btn");

// ---------- State ----------
let unsubscribeCostumes = null;
let unsubscribeSections = null;
let unsubscribeCharacters = null;
let unsubscribeUsers = null;
let unsubscribeAllCostumes = null;
let latestCostumes = [];
let latestSections = [];
let latestCharacters = [];
let latestUsers = [];
let latestAllCostumes = [];
let renewingCostume = null;
let creatingSectionForCharacter = null;

// ---------- Auth ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await login(email, password);
  } catch (err) {
    loginError.textContent = friendlyAuthError(err);
  }
});

logoutBtn.addEventListener("click", () => logout());

onAuthChange((user, err) => {
  cleanupSubscriptions();
  loadingView.hidden = true;

  if (!user) {
    appView.hidden = true;
    loginView.hidden = false;
    loginForm.reset();
    if (err) loginError.textContent = err.message;
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  userEmailEl.textContent = user.displayName;

  const admin = isAdmin();
  tabsEl.hidden = !admin;
  if (!admin) switchTab("costumes-view");

  unsubscribeCostumes = subscribeToOwnCostumes(user.uid, (costumes) => {
    latestCostumes = costumes;
    renderCostumes();
  });

  unsubscribeSections = subscribeToOwnSections(user.uid, (sections) => {
    latestSections = sections;
    renderCostumes();
  });

  unsubscribeCharacters = subscribeToOwnCharacters(user.uid, (characters) => {
    latestCharacters = characters;
    renderCostumes();
  });

  if (admin) {
    unsubscribeUsers = subscribeToUsers((users) => {
      latestUsers = users;
      renderUsers();
    });
    unsubscribeAllCostumes = subscribeToAllCostumes((costumes) => {
      latestAllCostumes = costumes;
      renderUsers();
    });
  }

  if ("Notification" in window && Notification.permission === "default") {
    notifHint.hidden = false;
  }
});

function cleanupSubscriptions() {
  if (unsubscribeCostumes) unsubscribeCostumes();
  if (unsubscribeSections) unsubscribeSections();
  if (unsubscribeCharacters) unsubscribeCharacters();
  if (unsubscribeUsers) unsubscribeUsers();
  if (unsubscribeAllCostumes) unsubscribeAllCostumes();
  unsubscribeCostumes = unsubscribeSections = unsubscribeCharacters = unsubscribeUsers = unsubscribeAllCostumes = null;
  latestCostumes = [];
  latestSections = [];
  latestCharacters = [];
  latestUsers = [];
  latestAllCostumes = [];
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email ou password incorretos.";
  }
  if (code.includes("too-many-requests")) {
    return "Demasiadas tentativas. Tenta novamente mais tarde.";
  }
  return err.message || "Erro ao entrar.";
}

// ---------- Tabs ----------
tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

function switchTab(tab) {
  for (const btn of tabsEl.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  costumesViewEl.hidden = tab !== "costumes-view";
  adminViewEl.hidden = tab !== "admin-view";
}

// ---------- Notifications ----------
enableNotifBtn.addEventListener("click", () => {
  requestNotificationPermission();
  notifHint.hidden = true;
});

setInterval(() => {
  renderCostumes();
  checkCostumeNotifications(latestCostumes, computeRemaining);
}, 30000);

// ---------- Costumes: render ----------
function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

function byRemaining(a, b) {
  return computeRemaining(a.endAt).totalMs - computeRemaining(b.endAt).totalMs;
}

function renderCostumes() {
  costumesListEl.innerHTML = "";

  if (latestCostumes.length === 0 && latestSections.length === 0 && latestCharacters.length === 0) {
    costumesListEl.innerHTML = '<p class="empty-state">Ainda não tens trajes adicionados.</p>';
    return;
  }

  const characterNames = [
    ...new Set([
      ...latestCostumes.map((c) => c.character),
      ...latestSections.map((s) => s.character),
      ...latestCharacters.map((c) => c.name),
    ]),
  ].sort((a, b) => a.localeCompare(b, "pt"));

  for (const character of characterNames) {
    costumesListEl.appendChild(buildCharacterGroup(character));
  }
}

function buildCharacterGroup(character) {
  const groupEl = document.createElement("div");
  groupEl.className = "character-group";

  const costumeCount = latestCostumes.filter((c) => c.character === character).length;
  const sectionCount = latestSections.filter((s) => s.character === character).length;
  const characterDoc = latestCharacters.find((c) => c.name === character);

  const header = document.createElement("div");
  header.className = "character-header";
  header.innerHTML = `<h3>${escapeHtml(character)}</h3>`;

  const headerActions = document.createElement("div");
  headerActions.className = "section-header-actions";

  const addSectionBtn = document.createElement("button");
  addSectionBtn.className = "secondary small";
  addSectionBtn.textContent = "+ Secção";
  addSectionBtn.addEventListener("click", () => openSectionModal(character));
  headerActions.appendChild(addSectionBtn);

  if (characterDoc && costumeCount === 0 && sectionCount === 0) {
    const delCharBtn = document.createElement("button");
    delCharBtn.className = "icon-btn small";
    delCharBtn.textContent = "×";
    delCharBtn.title = "Apagar personagem";
    delCharBtn.addEventListener("click", () => {
      if (confirm(`Apagar a personagem "${character}"?`)) {
        deleteCharacter(characterDoc.id);
      }
    });
    headerActions.appendChild(delCharBtn);
  }

  header.appendChild(headerActions);
  groupEl.appendChild(header);

  const sections = latestSections.filter((s) => s.character === character).sort(byOrder);
  const defaultSections = sections.filter((s) => s.isDefault);
  const defaultSection = defaultSections[0];
  ensureCharacterDefaultSection(character, defaultSections);

  const sectionsContainer = document.createElement("div");
  sectionsContainer.className = "sections-container";
  sectionsContainer.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes("application/x-section-id")) return;
    e.preventDefault();
    sectionsContainer.classList.add("dropzone-active");
    showInsertionMarker(sectionsContainer, e.clientY, ".section-block:not(.unsectioned)");
  });
  sectionsContainer.addEventListener("dragleave", (e) => {
    if (sectionsContainer.contains(e.relatedTarget)) return;
    sectionsContainer.classList.remove("dropzone-active");
    clearInsertionMarker(sectionsContainer);
  });
  sectionsContainer.addEventListener("drop", (e) => {
    sectionsContainer.classList.remove("dropzone-active");
    clearInsertionMarker(sectionsContainer);
    handleSectionDrop(e, sectionsContainer, character);
  });

  const extraDefaultIds = new Set(defaultSections.slice(1).map((s) => s.id));
  const sectionsToRender = sections.filter((s) => !extraDefaultIds.has(s.id));

  for (const section of sectionsToRender) {
    const costumes = latestCostumes.filter((c) => c.character === character && c.sectionId === section.id).sort(byRemaining);
    sectionsContainer.appendChild(buildSectionBlock(section, costumes, character, defaultSection));
  }

  if (defaultSection) {
    migrateOrphanedCostumes(character, defaultSection);
  } else {
    // Enquanto a secção "Geral" ainda não foi criada no Firestore, mostra os trajes sem secção na mesma.
    const orphaned = latestCostumes.filter((c) => c.character === character && !c.sectionId).sort(byRemaining);
    if (orphaned.length) {
      sectionsContainer.appendChild(buildSectionBlock(null, orphaned, character, null));
    }
  }

  groupEl.appendChild(sectionsContainer);

  return groupEl;
}

const pendingDefaultSections = new Set();
const pendingMigrations = new Set();
const pendingDedup = new Set();

function ensureCharacterDefaultSection(character, defaultSections) {
  if (defaultSections.length > 1 && !pendingDedup.has(character)) {
    // Limpa duplicados criados por uma condição de corrida anterior: mantém o mais antigo,
    // move os trajes dos outros para lá, e apaga-os.
    pendingDedup.add(character);
    const [keep, ...extras] = defaultSections;
    Promise.all(extras.map((extra) => deleteSection(extra.id, keep.id))).finally(() => pendingDedup.delete(character));
    return;
  }

  if (defaultSections.length > 0 || pendingDefaultSections.has(character)) return;
  pendingDefaultSections.add(character);
  ensureDefaultSection({ ownerUid: currentUser.uid, character }).finally(() => {
    pendingDefaultSections.delete(character);
  });
}

function migrateOrphanedCostumes(character, defaultSection) {
  const orphaned = latestCostumes.filter(
    (c) => c.character === character && (!c.sectionId || !latestSections.some((s) => s.id === c.sectionId))
  );
  const key = character;
  if (orphaned.length === 0 || pendingMigrations.has(key)) return;
  pendingMigrations.add(key);
  Promise.all(orphaned.map((c) => moveCostume(c.id, { character, sectionId: defaultSection.id }))).finally(() =>
    pendingMigrations.delete(key)
  );
}

function buildSectionBlock(section, costumes, character, defaultSection) {
  const block = document.createElement("div");
  block.className = "section-block" + (section ? "" : " unsectioned");

  if (section) {
    const header = document.createElement("div");
    header.className = "section-block-header";
    header.draggable = true;
    header.dataset.sectionId = section.id;
    header.dataset.character = character;
    header.innerHTML = `<span class="drag-handle">⠿</span><span class="section-name">${escapeHtml(section.name)}</span>`;

    if (!section.isDefault) {
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn small";
      delBtn.textContent = "×";
      delBtn.title = "Apagar secção";
      delBtn.addEventListener("click", () => {
        if (confirm(`Apagar a secção "${section.name}"? Os trajes lá dentro passam para "Geral".`)) {
          deleteSection(section.id, defaultSection ? defaultSection.id : null);
        }
      });
      header.appendChild(delBtn);
    }

    header.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-section-id", section.id);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => block.classList.add("dragging"), 0);
    });
    header.addEventListener("dragend", () => {
      block.classList.remove("dragging");
      clearAllInsertionMarkers();
    });

    block.appendChild(header);
  } else {
    const header = document.createElement("div");
    header.className = "section-block-header muted";
    header.innerHTML = `<span class="section-name">Geral</span>`;
    block.appendChild(header);
  }

  const dropzone = document.createElement("div");
  dropzone.className = "section-dropzone";
  dropzone.dataset.character = character;
  dropzone.dataset.sectionId = section ? section.id : "";

  dropzone.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes("application/x-costume-id")) return;
    e.preventDefault();
    dropzone.classList.add("dropzone-active");
  });
  dropzone.addEventListener("dragleave", (e) => {
    if (dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove("dropzone-active");
    clearInsertionMarker(dropzone);
  });
  dropzone.addEventListener("drop", (e) => {
    dropzone.classList.remove("dropzone-active");
    clearInsertionMarker(dropzone);
    handleCostumeDrop(e, dropzone);
  });

  if (costumes.length === 0) {
    dropzone.innerHTML = '<p class="empty-hint">Arrasta trajes para aqui</p>';
  } else {
    for (const costume of costumes) {
      dropzone.appendChild(buildCostumeCard(costume));
    }
  }

  block.appendChild(dropzone);
  return block;
}

// ---------- Drag and drop ----------
function getDragAfterElement(container, y, selector) {
  const els = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function showInsertionMarker(container, y, selector) {
  let marker = container.querySelector(":scope > .insertion-marker");
  if (!marker) {
    marker = document.createElement("div");
    marker.className = "insertion-marker";
    container.appendChild(marker);
  }
  const afterEl = getDragAfterElement(container, y, selector);
  if (afterEl) {
    container.insertBefore(marker, afterEl);
  } else {
    container.appendChild(marker);
  }
}

function clearInsertionMarker(container) {
  container.querySelector(":scope > .insertion-marker")?.remove();
}

function clearAllInsertionMarkers() {
  document.querySelectorAll(".insertion-marker").forEach((el) => el.remove());
  document.querySelectorAll(".dropzone-active").forEach((el) => el.classList.remove("dropzone-active"));
}

async function handleCostumeDrop(e, dropzoneEl) {
  if (!e.dataTransfer.types.includes("application/x-costume-id")) return;
  e.preventDefault();
  dropzoneEl.classList.remove("dropzone-active");
  const costumeId = e.dataTransfer.getData("application/x-costume-id");
  const draggedCostume = latestCostumes.find((c) => c.id === costumeId);
  if (!draggedCostume) return;

  const targetCharacter = dropzoneEl.dataset.character;
  const targetSectionId = dropzoneEl.dataset.sectionId || null;

  if (draggedCostume.character === targetCharacter && (draggedCostume.sectionId || null) === targetSectionId) {
    return;
  }

  try {
    await moveCostume(costumeId, { character: targetCharacter, sectionId: targetSectionId });
    clearNotified(costumeId);
  } catch (err) {
    alert(err.message || "Erro ao mover o traje.");
  }
}

async function handleSectionDrop(e, containerEl, character) {
  if (!e.dataTransfer.types.includes("application/x-section-id")) return;
  e.preventDefault();
  const sectionId = e.dataTransfer.getData("application/x-section-id");
  if (!sectionId) return;

  const afterEl = getDragAfterElement(containerEl, e.clientY, ".section-block:not(.unsectioned)");
  const existingIds = [...containerEl.querySelectorAll(".section-block:not(.unsectioned) .section-block-header")]
    .map((el) => el.dataset.sectionId)
    .filter((id) => id !== sectionId);

  let insertIndex = existingIds.length;
  if (afterEl) {
    const headerEl = afterEl.querySelector(".section-block-header");
    const idx = existingIds.indexOf(headerEl?.dataset.sectionId);
    if (idx !== -1) insertIndex = idx;
  }
  existingIds.splice(insertIndex, 0, sectionId);

  try {
    await reorderSections(existingIds.map((id, index) => ({ id, order: index })));
  } catch (err) {
    alert(err.message || "Erro ao reordenar a secção.");
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

function buildCostumeCard(costume) {
  const remaining = computeRemaining(costume.endAt);
  const isDanger = !remaining.expired && remaining.totalMs <= ONE_DAY_MS;
  const isWarning = !remaining.expired && !isDanger && remaining.totalMs <= THREE_DAYS_MS;

  const card = document.createElement("div");
  card.className =
    "costume-card" + (remaining.expired ? " expired" : isDanger ? " danger" : isWarning ? " warning" : "");
  card.draggable = true;
  card.dataset.costumeId = costume.id;
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-costume-id", costume.id);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => card.classList.add("dragging"), 0);
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    clearAllInsertionMarkers();
  });

  const main = document.createElement("div");
  main.className = "costume-main";
  main.innerHTML = `
    <div class="costume-title">
      <img class="type-icon" src="${COSTUME_ICONS[costume.type] || ""}" alt="${COSTUME_TYPES[costume.type] || costume.type}" />
      <span class="badge ${costume.type}">${COSTUME_TYPES[costume.type] || costume.type}</span>
    </div>
    ${costume.description ? `<div class="costume-desc">${escapeHtml(costume.description)}</div>` : ""}
  `;

  const time = document.createElement("div");
  time.className = "costume-time";
  const remainingClass = remaining.expired ? "expired" : isDanger ? "danger" : isWarning ? "warning" : "ok";
  time.innerHTML = `
    <span class="remaining ${remainingClass}">${formatRemaining(remaining)}</span>
    <span class="end-date">termina em ${formatEndDate(remaining.endDate)}</span>
  `;

  const actions = document.createElement("div");
  actions.className = "costume-actions";

  const renewBtn = document.createElement("button");
  renewBtn.className = "secondary";
  renewBtn.textContent = "Renovar";
  renewBtn.addEventListener("click", () => openRenewModal(costume));
  actions.appendChild(renewBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn";
  delBtn.textContent = "Apagar";
  delBtn.addEventListener("click", () => {
    if (confirm(`Apagar o traje "${costume.description || COSTUME_TYPES[costume.type]}" de ${costume.character}?`)) {
      deleteCostume(costume.id);
    }
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Costume modal ----------
function selectCostumeType(type) {
  costumeTypeInput.value = type;
  costumeTypePicker.querySelectorAll(".type-option").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.type === type);
  });
}

costumeTypePicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".type-option");
  if (!btn) return;
  selectCostumeType(btn.dataset.type);
});

addCostumeBtn.addEventListener("click", () => {
  costumeForm.reset();
  costumeFormError.textContent = "";
  selectCostumeType("body");
  costumeModal.showModal();
});

costumeCancelBtn.addEventListener("click", () => costumeModal.close());

costumeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  costumeFormError.textContent = "";
  const character = document.getElementById("costume-character").value.trim();
  const type = document.getElementById("costume-type").value;
  const description = document.getElementById("costume-description").value.trim();
  const daysLeft = document.getElementById("costume-days").value;
  const hoursLeft = document.getElementById("costume-hours").value;
  const minutesLeft = document.getElementById("costume-minutes").value;
  const notifyDaysBefore = document.getElementById("costume-notify-days").value;

  if (!character) {
    costumeFormError.textContent = "Indica o nome da personagem.";
    return;
  }
  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  if (totalMinutes <= 0) {
    costumeFormError.textContent = "O tempo restante tem de ser maior que zero.";
    return;
  }

  try {
    await addCostume({
      ownerUid: currentUser.uid,
      character,
      type,
      description,
      daysLeft,
      hoursLeft,
      minutesLeft,
      notifyDaysBefore,
    });
    costumeModal.close();
  } catch (err) {
    costumeFormError.textContent = err.message || "Erro ao guardar o traje.";
  }
});

// ---------- Renew modal ----------
function openRenewModal(costume) {
  renewingCostume = costume;
  renewForm.reset();
  renewFormError.textContent = "";
  renewCostumeIcon.src = COSTUME_ICONS[costume.type] || "";
  renewCostumeIcon.alt = COSTUME_TYPES[costume.type] || costume.type;
  renewCostumeName.textContent = costume.character;
  renewCostumeType.innerHTML = `<span class="badge ${costume.type}">${COSTUME_TYPES[costume.type] || costume.type}</span>`;
  renewCostumeDesc.textContent = costume.description || "";
  renewModal.showModal();
}

renewCancelBtn.addEventListener("click", () => renewModal.close());

renewForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  renewFormError.textContent = "";
  const daysLeft = document.getElementById("renew-days").value;
  const hoursLeft = document.getElementById("renew-hours").value;
  const minutesLeft = document.getElementById("renew-minutes").value;

  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  if (totalMinutes <= 0) {
    renewFormError.textContent = "O tempo restante tem de ser maior que zero.";
    return;
  }

  try {
    await renewCostume(renewingCostume.id, { daysLeft, hoursLeft, minutesLeft });
    clearNotified(renewingCostume.id);
    renewModal.close();
  } catch (err) {
    renewFormError.textContent = err.message || "Erro ao renovar o traje.";
  }
});

// ---------- Section modal ----------
function openSectionModal(character) {
  creatingSectionForCharacter = character;
  sectionForm.reset();
  sectionFormError.textContent = "";
  sectionCharacterLabel.textContent = `Personagem: ${character}`;
  sectionModal.showModal();
}

sectionCancelBtn.addEventListener("click", () => sectionModal.close());

sectionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  sectionFormError.textContent = "";
  const name = document.getElementById("section-name").value.trim();
  if (!name) {
    sectionFormError.textContent = "Indica um nome para a secção.";
    return;
  }
  try {
    await addSection({ ownerUid: currentUser.uid, character: creatingSectionForCharacter, name });
    sectionModal.close();
  } catch (err) {
    sectionFormError.textContent = err.message || "Erro ao criar a secção.";
  }
});

// ---------- Character modal ----------
addCharacterBtn.addEventListener("click", () => {
  characterForm.reset();
  characterFormError.textContent = "";
  characterModal.showModal();
});

characterCancelBtn.addEventListener("click", () => characterModal.close());

characterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  characterFormError.textContent = "";
  const name = document.getElementById("character-name").value.trim();
  if (!name) {
    characterFormError.textContent = "Indica um nome para a personagem.";
    return;
  }
  const exists = [...latestCostumes.map((c) => c.character), ...latestCharacters.map((c) => c.name)].some(
    (existing) => existing.toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    characterFormError.textContent = "Já existe uma personagem com esse nome.";
    return;
  }
  try {
    await addCharacter({ ownerUid: currentUser.uid, name });
    characterModal.close();
  } catch (err) {
    characterFormError.textContent = err.message || "Erro ao criar a personagem.";
  }
});

// ---------- Admin: render users ----------
function renderUsers() {
  if (latestUsers.length === 0) {
    usersListEl.innerHTML = '<p class="empty-state">Sem utilizadores.</p>';
    return;
  }

  const countsByUid = latestAllCostumes.reduce((acc, c) => {
    acc[c.ownerUid] = (acc[c.ownerUid] || 0) + 1;
    return acc;
  }, {});

  const rows = latestUsers
    .slice()
    .sort((a, b) => (a.email || "").localeCompare(b.email || ""))
    .map((u) => {
      const count = countsByUid[u.uid] || 0;
      const isSelf = currentUser && currentUser.uid === u.uid;
      const statusTag = u.disabled
        ? '<span class="tag disabled">Desativado</span>'
        : u.role === "admin"
        ? '<span class="tag">Admin</span>'
        : "";
      const deleteBtn =
        u.disabled || isSelf
          ? ""
          : `<button class="icon-btn" data-uid="${u.uid}" data-action="disable">Apagar</button>`;
      return `
        <tr>
          <td>${escapeHtml(u.displayName || u.email)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${count}</td>
          <td>${statusTag}</td>
          <td>${deleteBtn}</td>
        </tr>
      `;
    })
    .join("");

  usersListEl.innerHTML = `
    <table>
      <thead>
        <tr><th>Nome</th><th>Email</th><th>Trajes</th><th>Estado</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  usersListEl.querySelectorAll('[data-action="disable"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      if (confirm("Apagar este utilizador? Os trajes dele serão removidos e deixa de conseguir entrar.")) {
        btn.disabled = true;
        try {
          await disableUser(uid);
        } catch (err) {
          alert(err.message || "Erro ao apagar utilizador.");
          btn.disabled = false;
        }
      }
    });
  });
}

// ---------- User modal ----------
addUserBtn.addEventListener("click", () => {
  userForm.reset();
  userFormError.textContent = "";
  userModal.showModal();
});

userCancelBtn.addEventListener("click", () => userModal.close());

userForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  userFormError.textContent = "";
  const displayName = document.getElementById("user-displayname").value;
  const email = document.getElementById("user-email-input").value.trim();
  const password = document.getElementById("user-password").value;
  const submitBtn = userForm.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  try {
    await createUser({ email, password, displayName });
    userModal.close();
  } catch (err) {
    userFormError.textContent = friendlyAuthError(err);
  } finally {
    submitBtn.disabled = false;
  }
});
