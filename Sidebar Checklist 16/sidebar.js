/**
 * sidebar.js — Sidebar Checklist v3.0
 *
 * Cell layout (7 columns per row):
 *   cells[0] = drag handle (⠿)
 *   cells[1] = trash icon (🗑)
 *   cells[2] = row number (#)
 *   cells[3] = name input
 *   cells[4] = acct # input
 *   cells[5] = sub # input
 *   cells[6] = done checkbox
 *
 * Data model:
 *   { id, name, acct, sub, done, launched, sessionLaunched }
 *
 * Launch flow:
 *   Sidebar sends accounts to background script via runtime.sendMessage.
 *   Background creates tabs, waits for load, injects acct# via executeScript.
 */

const STORAGE_KEY = "tsvSidebarRows";

// DOM refs
const tableBody    = document.getElementById("tableBody");
const clearAllBtn  = document.getElementById("clearAllBtn");
const launchBtn    = document.getElementById("launchBtn");
const copyAllBtn   = document.getElementById("copyAllBtn");
const relaunchCheck= document.getElementById("relaunchCheck");
const statsText    = document.getElementById("statsText");
const copyToast    = document.getElementById("copyToast");

let toastTimer = null;
let draggedRow  = null;

/* ═══════════════════════════════════════
   TOAST
   ═════════════════════════════════════════ */
function showToast(message) {
  copyToast.textContent = message || "Copied!";
  copyToast.classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => copyToast.classList.remove("visible"), 1500);
}

/* ═══════════════════════════════════════
   ACCT # CLICK-TO-COPY
   ═════════════════════════════════════════ */
function handleAcctClick(e) {
  const input = e.target;
  if (document.activeElement !== input) {
    e.preventDefault();
    input.focus();
    input.select();
    const value = input.value.trim();
    if (value) {
      navigator.clipboard.writeText(value).then(() => showToast("Copied!"))
        .catch(() => showToast("Copied!"));
    }
  }
}

function handleAcctMousedown(e) {
  if (document.activeElement !== e.target) {
    e.preventDefault();
  }
}

/* ═══════════════════════════════════════
   ROW BUILDERS
   ═════════════════════════════════════════ */

/**
 * Build a single table row with 7 cells.
 * @param {object} [data] — optional initial data for the row
 * @returns {HTMLTableRowElement}
 */
function buildRow(data) {
  const row = tableBody.insertRow();
  row.dataset.id = data?.id || crypto.randomUUID();

  // cells[0] — Drag handle
  const dragCell = row.insertCell();
  dragCell.classList.add("drag-col");
  const dragBtn = document.createElement("button");
  dragBtn.type = "button";
  dragBtn.className = "btn-drag";
  dragBtn.draggable = true;
  dragBtn.innerHTML = "⠿";
  dragBtn.title = "Drag to reorder";
  dragCell.appendChild(dragBtn);

  // cells[1] — Trash icon
  const trashCell = row.insertCell();
  trashCell.classList.add("trash-col");
  const trashBtn = document.createElement("button");
  trashBtn.type = "button";
  trashBtn.className = "btn-trash";
  trashBtn.innerHTML = "&#128465;"; // 🗑
  trashBtn.title = "Delete row";
  trashBtn.addEventListener("click", () => deleteRow(row));
  trashCell.appendChild(trashBtn);

  // cells[2] — Row number
  const numCell = row.insertCell();
  numCell.classList.add("row-num-col");
  numCell.textContent = tableBody.rows.length;

  // cells[3] — Name input
  const nameCell = row.insertCell();
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = data?.name || "";
  nameInput.addEventListener("input", handleChange);
  nameInput.addEventListener("paste", handlePasteFromExcel);
  nameCell.appendChild(nameInput);

  // cells[4] — Acct # input
  const acctCell = row.insertCell();
  const acctInput = document.createElement("input");
  acctInput.type = "text";
  acctInput.className = "input-number";
  acctInput.value = data?.acct || "";
  acctInput.addEventListener("input", handleChange);
  acctInput.addEventListener("click", handleAcctClick);
  acctInput.addEventListener("mousedown", handleAcctMousedown);
  acctCell.appendChild(acctInput);

  // cells[5] — Sub # input
  const subCell = row.insertCell();
  const subInput = document.createElement("input");
  subInput.type = "text";
  subInput.className = "input-number";
  subInput.value = data?.sub || "";
  subInput.addEventListener("input", handleChange);
  subInput.addEventListener("click", handleAcctClick);
  subInput.addEventListener("mousedown", handleAcctMousedown);
  subCell.appendChild(subInput);

  // cells[6] — Done checkbox
  const doneCell = row.insertCell();
  doneCell.classList.add("done-col");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!data?.done;
  checkbox.addEventListener("change", handleCheckboxChange);
  doneCell.appendChild(checkbox);

  // Apply visual state from data
  if (data?.done) row.classList.add("completed");
  if (data?.launched) row.classList.add("launched");

  return row;
}

function addEmptyRow() {
  buildRow(null);
}

/* ═══════════════════════════════════════
   ROW DELETION
   ═════════════════════════════════════════ */
function deleteRow(rowElement) {
  rowElement.remove();
  updateRowNumbers();
  updateStats();
  saveToStorage();

  if (tableBody.rows.length === 0) {
    addEmptyRow();
  }
}

/* ═══════════════════════════════════════
   HANDLERS
   ═════════════════════════════════════════ */
function handleChange() {
  ensureTrailingEmptyRow();
  updateStats();
  saveToStorage();
}

function handleCheckboxChange(e) {
  const row = e.target.closest("tr");
  row.classList.toggle("completed", e.target.checked);
  updateStats();
  saveToStorage();
}

/* ═══════════════════════════════════════
   TRAILING ROW + NUMBERING
   ═════════════════════════════════════════ */
function ensureTrailingEmptyRow() {
  const lastRow = tableBody.rows[tableBody.rows.length - 1];
  if (!lastRow) {
    addEmptyRow();
    return;
  }
  const nameInput = lastRow.cells[3].querySelector("input");
  const acctInput = lastRow.cells[4].querySelector("input");
  const subInput  = lastRow.cells[5].querySelector("input");
  const hasData =
    (nameInput && nameInput.value.trim() !== "") ||
    (acctInput && acctInput.value.trim() !== "") ||
    (subInput  && subInput.value.trim()  !== "");
  if (hasData) {
    addEmptyRow();
    updateRowNumbers();
  }
}

function updateRowNumbers() {
  Array.from(tableBody.rows).forEach((row, index) => {
    row.cells[2].textContent = index + 1;
  });
}

/* ═══════════════════════════════════════
   STATS — row count display
   ═════════════════════════════════════════ */
function updateStats() {
  const rows = Array.from(tableBody.rows).filter(r => !isRowEmpty(r));
  const total     = rows.length;
  const completed = rows.filter(r => {
    const cb = r.cells[6].querySelector("input[type='checkbox']");
    return cb && cb.checked;
  }).length;
  const launched  = rows.filter(r => r.classList.contains("launched")).length;

  const parts = [];
  parts.push(total + " account" + (total !== 1 ? "s" : ""));
  if (launched > 0) parts.push(launched + " launched");
  if (completed > 0) parts.push(completed + " completed");
  statsText.textContent = parts.join(" · ") || "0 accounts";
}

function isRowEmpty(row) {
  const nameInput = row.cells[3].querySelector("input");
  const acctInput = row.cells[4].querySelector("input");
  return (
    (!nameInput || nameInput.value.trim() === "") &&
    (!acctInput || acctInput.value.trim() === "")
  );
}

/* ═══════════════════════════════════════
   PASTE HANDLER
   ═════════════════════════════════════════
   Supports 2-column (Name, Acct#) and 3-column
   (Name, Acct#, Sub#) tab-separated paste from Excel.
   ═════════════════════════════════════════ */
function handlePasteFromExcel(event) {
  const text = event.clipboardData.getData("text");
  if (!text) return;

  event.preventDefault();

  const startRow = event.target.closest("tr").rowIndex - 1;
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");

  lines.forEach((line, lineIdx) => {
    const rowIndex = startRow + lineIdx;
    while (tableBody.rows.length <= rowIndex) {
      addEmptyRow();
    }
    const row = tableBody.rows[rowIndex];
    const cols = line.split(/\t/);

    const nameInput = row.cells[3].querySelector("input");
    const acctInput = row.cells[4].querySelector("input");
    const subInput  = row.cells[5].querySelector("input");

    if (nameInput) nameInput.value = cols[0] || "";
    if (acctInput) acctInput.value = cols[1] || "";
    if (subInput)  subInput.value  = cols[2] || "";
  });

  ensureTrailingEmptyRow();
  updateRowNumbers();
  updateStats();
  saveToStorage();
}

/* ═══════════════════════════════════════
   STORAGE
   ═════════════════════════════════════════ */
async function loadFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      const rows = result[STORAGE_KEY] || [];
      tableBody.innerHTML = "";
      rows.forEach(r => buildRow(r));
      resolve();
    });
  });
}

function saveToStorage() {
  const rows = Array.from(tableBody.rows)
    .filter(r => !isRowEmpty(r))
    .map(r => ({
      id:              r.dataset.id || crypto.randomUUID(),
      name:            r.cells[3].querySelector("input")?.value || "",
      acct:            r.cells[4].querySelector("input")?.value || "",
      sub:             r.cells[5].querySelector("input")?.value || "",
      done:            r.cells[6].querySelector("input[type='checkbox']")?.checked || false,
      launched:        r.classList.contains("launched"),
      sessionLaunched: r.dataset.sessionLaunched === "true"
    }));

  chrome.storage.local.set({ [STORAGE_KEY]: rows });
}

/* ═══════════════════════════════════════
   LAUNCH ACCOUNTS
   ═════════════════════════════════════════ */
launchBtn.addEventListener("click", () => {
  const allowRelaunch = relaunchCheck.checked;

  const eligible = Array.from(tableBody.rows).filter(row => {
    if (isRowEmpty(row)) return false;
    const acctInput = row.cells[4].querySelector("input");
    if (!acctInput || !acctInput.value.trim()) return false;

    const alreadyLaunched = row.dataset.sessionLaunched === "true";
    if (!allowRelaunch && alreadyLaunched) return false;

    return true;
  });

  if (eligible.length === 0) {
    showToast("No accounts to launch");
    return;
  }

  const accounts = eligible.map(row => ({
    acct:  row.cells[4].querySelector("input").value.trim(),
    rowId: row.dataset.id
  }));

  showToast(`Launching ${accounts.length} account${accounts.length > 1 ? "s" : ""}…`);

  eligible.forEach(row => {
    row.classList.add("launched");
    row.dataset.sessionLaunched = "true";
  });
  updateStats();
  saveToStorage();

  chrome.runtime.sendMessage({
    type: "LAUNCH_ACCOUNTS",
    accounts: accounts
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("[Sidebar] Launch failed:", chrome.runtime.lastError.message);
      showToast("Launch failed");
    }
  });
});

/* ═══════════════════════════════════════
   COPY ALL ROWS (TSV format for Excel)
   ═════════════════════════════════════════ */
copyAllBtn.addEventListener("click", () => {
  const rows = Array.from(tableBody.rows).filter(r => !isRowEmpty(r));
  if (rows.length === 0) {
    showToast("No rows to copy");
    return;
  }

  const tsv = rows.map(r => {
    const name = r.cells[3].querySelector("input")?.value || "";
    const acct = r.cells[4].querySelector("input")?.value || "";
    const sub  = r.cells[5].querySelector("input")?.value || "";
    return [name, acct, sub].join("\t");
  }).join("\n");

  navigator.clipboard.writeText(tsv).then(() => {
    showToast(`Copied ${rows.length} row${rows.length > 1 ? "s" : ""}`);
  }).catch(() => {
    showToast("Copy failed");
  });
});

/* ═══════════════════════════════════════
   CLEAR ALL
   ═════════════════════════════════════════ */
clearAllBtn.addEventListener("click", () => {
  const confirmed = confirm(
    "This will clear all rows and reset the checklist. Are you sure?"
  );
  if (!confirmed) return;

  chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
    tableBody.innerHTML = "";
    addEmptyRow();
    updateRowNumbers();
    updateStats();
    showToast("All rows cleared");
  });
});

/* ═══════════════════════════════════════
   DRAG AND DROP — reorder rows
   ═══════════════════════════════════════
   Uses native HTML5 Drag and Drop API.
   Event delegation on tableBody handles
   dynamically added rows automatically.
   ═════════════════════════════════════════ */
tableBody.addEventListener("dragstart", (e) => {
  const handle = e.target.closest(".btn-drag");
  if (!handle) return;

  draggedRow = handle.closest("tr");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "");

  // Delay adding class so the browser captures the full row as drag image
  requestAnimationFrame(() => {
    if (draggedRow) draggedRow.classList.add("dragging");
  });
});

tableBody.addEventListener("dragover", (e) => {
  const row = e.target.closest("tr");
  if (!row || row === draggedRow) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  // Remove previous indicators
  document.querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
  row.classList.add("drag-over");
});

tableBody.addEventListener("dragleave", (e) => {
  // Only remove if actually leaving the row (not entering a child element)
  const row = e.target.closest("tr");
  if (!row) return;
  const related = e.relatedTarget?.closest("tr");
  if (row !== related) row.classList.remove("drag-over");
});

tableBody.addEventListener("drop", (e) => {
  e.preventDefault();
  const targetRow = e.target.closest("tr");
  if (!draggedRow || !targetRow || targetRow === draggedRow) return;

  // Determine insert position based on cursor Y relative to row midpoint
  const rect = targetRow.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  if (e.clientY < midY) {
    tableBody.insertBefore(draggedRow, targetRow);
  } else {
    tableBody.insertBefore(draggedRow, targetRow.nextSibling);
  }

  cleanupDrag();
  updateRowNumbers();
  updateStats();
  saveToStorage();
});

tableBody.addEventListener("dragend", () => {
 cleanupDrag();
});

function cleanupDrag() {
 document.querySelectorAll(".dragging, .drag-over").forEach(r => {
    r.classList.remove("dragging", "drag-over");
  });
  draggedRow = null;
}

/* ═══════════════════════════════════════
   INIT
   ═════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  await loadFromStorage();

  // Restore sessionLaunched state from stored data
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const savedRows = result[STORAGE_KEY] || [];
    const launchedIds = new Set(
      savedRows.filter(r => r.sessionLaunched).map(r => r.id)
    );

    Array.from(tableBody.rows).forEach(row => {
      if (launchedIds.has(row.dataset.id)) {
        row.dataset.sessionLaunched = "true";
        row.classList.add("launched");
      }
    });
  });

  if (tableBody.rows.length === 0) {
    addEmptyRow();
  }
  updateRowNumbers();
  updateStats();
});
