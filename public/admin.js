const socket = io();

const elements = {
  status: document.getElementById("adminStatus"),
  total: document.getElementById("adminTotal"),
  unique: document.getElementById("adminUnique"),
  clients: document.getElementById("adminClients"),
  top: document.getElementById("adminTop"),
  lockBtn: document.getElementById("lockBtn"),
  seedBtn: document.getElementById("seedBtn"),
  clearBtn: document.getElementById("clearBtn"),
  table: document.getElementById("entriesTable")
};

let snapshot = null;

socket.on("connect", () => {
  elements.status.textContent = "Conectat la sesiune.";
});

socket.on("disconnect", () => {
  elements.status.textContent = "Reconectare la sesiune...";
});

socket.on("snapshot", (nextSnapshot) => {
  snapshot = nextSnapshot;
  render();
});

elements.lockBtn.addEventListener("click", () => {
  socket.emit("admin-lock", !snapshot?.locked);
});

elements.seedBtn.addEventListener("click", () => {
  socket.emit("admin-seed-demo");
});

elements.clearBtn.addEventListener("click", () => {
  if (!confirm("Ștergi definitiv toate răspunsurile din sesiune?")) return;
  socket.emit("admin-clear");
});

elements.table.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-delete]");
  if (!button) return;
  socket.emit("admin-delete", button.dataset.delete);
});

function render() {
  if (!snapshot) return;
  elements.total.textContent = snapshot.total;
  elements.unique.textContent = snapshot.unique;
  elements.clients.textContent = snapshot.clients;
  elements.top.textContent = snapshot.counts[0]?.word || "-";
  elements.status.textContent = snapshot.locked
    ? "Colectarea este pauzată. Poți modera sau exporta datele."
    : `Live. Ultima actualizare: ${formatTime(snapshot.updatedAt)}.`;
  elements.lockBtn.textContent = snapshot.locked ? "Repornește colectarea" : "Pauză colectare";

  const countByWord = new Map(snapshot.counts.map((item) => [item.normalized, item.count]));
  elements.table.innerHTML = "";

  if (!snapshot.recent.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td class="empty-row" colspan="6">Nu există încă răspunsuri.</td>';
    elements.table.appendChild(row);
    return;
  }

  for (const [index, entry] of snapshot.recent.entries()) {
    const row = document.createElement("tr");
    row.append(
      cell(snapshot.total - index),
      cell(entry.word, true),
      cell(entry.normalized),
      cell(formatTime(entry.createdAt)),
      cell(countByWord.get(entry.normalized) || 1),
      actionCell(entry.id)
    );
    elements.table.appendChild(row);
  }
}

function cell(value, strong = false) {
  const td = document.createElement("td");
  if (strong) {
    const element = document.createElement("strong");
    element.textContent = value;
    td.appendChild(element);
  } else {
    td.textContent = value;
  }
  return td;
}

function actionCell(id) {
  const td = document.createElement("td");
  td.className = "table-actions";
  const button = document.createElement("button");
  button.className = "danger";
  button.type = "button";
  button.dataset.delete = id;
  button.textContent = "Șterge";
  td.appendChild(button);
  return td;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
