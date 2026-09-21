import { login, logout, onAuthChange, isAdmin, currentUser } from "./auth.js";
import {
  COSTUME_TYPES,
  COSTUME_ICONS,
  addCostume,
  deleteCostume,
  subscribeToOwnCostumes,
  subscribeToAllCostumes,
  computeRemaining,
  formatEndDate,
  formatRemaining,
} from "./costumes.js";
import { createUser, disableUser, subscribeToUsers } from "./admin.js";
import { requestNotificationPermission, checkCostumeNotifications } from "./notifications.js";

// ---------- Elements ----------
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

const addUserBtn = document.getElementById("add-user-btn");
const userModal = document.getElementById("user-modal");
const userForm = document.getElementById("user-form");
const userFormError = document.getElementById("user-form-error");
const userCancelBtn = document.getElementById("user-cancel");

const notifHint = document.getElementById("notif-hint");
const enableNotifBtn = document.getElementById("enable-notif-btn");

// ---------- State ----------
let unsubscribeCostumes = null;
let unsubscribeUsers = null;
let unsubscribeAllCostumes = null;
let latestCostumes = [];
let latestUsers = [];
let latestAllCostumes = [];

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
  if (unsubscribeUsers) unsubscribeUsers();
  if (unsubscribeAllCostumes) unsubscribeAllCostumes();
  unsubscribeCostumes = unsubscribeUsers = unsubscribeAllCostumes = null;
  latestCostumes = [];
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
function renderCostumes() {
  costumesListEl.innerHTML = "";

  if (latestCostumes.length === 0) {
    costumesListEl.innerHTML = '<p class="empty-state">Ainda não tens trajes adicionados.</p>';
    return;
  }

  const groups = groupByCharacter(latestCostumes);
  const characterNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt"));

  for (const character of characterNames) {
    const groupEl = document.createElement("div");
    groupEl.className = "character-group";

    const heading = document.createElement("h3");
    heading.textContent = character;
    groupEl.appendChild(heading);

    const sorted = groups[character].sort((a, b) => {
      const ra = computeRemaining(a.endAt);
      const rb = computeRemaining(b.endAt);
      return ra.totalMs - rb.totalMs;
    });

    for (const costume of sorted) {
      groupEl.appendChild(buildCostumeCard(costume));
    }

    costumesListEl.appendChild(groupEl);
  }
}

function groupByCharacter(costumes) {
  return costumes.reduce((acc, c) => {
    (acc[c.character] ||= []).push(c);
    return acc;
  }, {});
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
