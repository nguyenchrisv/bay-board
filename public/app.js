// Bay Board front-end application
// Polls /api/board and renders split-flap style departures

import {
  getLineNameFromColor,
  formatMinutes,
  getAccessibleLabel,
  diffStrings,
  formatDestination,
  abbreviateDestination,
  createSplitFlapCell,
  createLineChipCell,
} from "./split-flap.js";

const POLL_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

const boards = {
  bart: document.querySelector('section.board[data-mode="bart"]'),
  ferry: document.querySelector('section.board[data-mode="ferry"]'),
  bus: document.querySelector('section.board[data-mode="bus"]'),
};

const tabs = document.querySelectorAll(".mode-tabs [role=\"tab\"]");
const clockEl = document.querySelector(".clock");

// Store previous departures for character diffing
const previousDepartures = {
  bart: [],
  ferry: [],
  bus: [],
};

// Destination tile cap per mode: 12 tiles while the DESTINATION cell is
// wide enough to show them at >=12px (>= 155px content with 1px gaps —
// same threshold as the CSS --tile formula); below that, 10 tiles so the
// tiles stay readable instead of shrinking to nothing.
const DEST_CAP_THRESHOLD_PX = 155;
const destCaps = { bart: 12, ferry: 12, bus: 12 };

// Track configured modes to avoid stale badge on unconfigured
const configuredModes = new Set(Object.keys(boards).filter((mode) => {
  const board = boards[mode];
  return board && !board.dataset.unconfigured;
}));

function updateClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function showMode(mode) {
  // Update board visibility (for mobile <600px)
  for (const [key, board] of Object.entries(boards)) {
    if (board) {
      board.dataset.active = key === mode;
    }
  }
  // Update tab aria-selected
  for (const tab of tabs) {
    tab.setAttribute("aria-selected", tab.dataset.mode === mode);
  }
}

async function fetchBoard() {
  try {
    const res = await fetch("/api/board");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch board:", err);
    return null;
  }
}

// Measure the rendered DESTINATION cell content width and derive the cap
// (12 or 10) with the same math as the CSS tile-size formula. Returns null
// when no cell is rendered (empty board).
function measureDestCap(boardEl) {
  const cell = boardEl.querySelector(".departures td.destination-cell");
  if (!cell) return null;
  const style = window.getComputedStyle(cell);
  const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = cell.clientWidth - pad;
  if (!Number.isFinite(width) || width <= 0) return null;
  return width >= DEST_CAP_THRESHOLD_PX ? 12 : 10;
}

function renderDepartures(boardEl, data, mode, capOverride) {
  const tbody = boardEl.querySelector(".departures tbody");
  if (!tbody) return;

  if (!data || !data.departures?.length) {
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.setAttribute("colspan", "4");
    td.textContent = "No departures";
    tr.appendChild(td);
    tbody.appendChild(tr);
    previousDepartures[mode] = [];
    return;
  }

  const cap = capOverride ?? destCaps[mode] ?? 12;
  const newDepartures = data.departures;
  const oldDepartures = previousDepartures[mode] || [];

  tbody.innerHTML = "";
  for (let i = 0; i < newDepartures.length; i++) {
    const dep = newDepartures[i];
    const oldDep = oldDepartures[i] || {};

    const tr = document.createElement("tr");

    // Line chip cell with visually hidden accessible label
    const lineChipCell = createLineChipCell(dep);
    const accessibleLabel = getAccessibleLabel(dep);
    const srSpan = document.createElement("span");
    srSpan.className = "visually-hidden";
    srSpan.textContent = accessibleLabel;
    lineChipCell.prepend(srSpan);
    tr.appendChild(lineChipCell);

    // Destination - capped to the current tile cap (12, or 10 on narrow
    // cells) so long names never overflow into the MIN column (issue #6).
    // Format both sides so diff compares like-for-like values and blank
    // tiles don't re-animate on poll.
    // For ferry/bus, abbreviate destination names first so they fit
    // sensibly within the tile cap (e.g., "San Francisco Ferry Building"
    // → "SF Ferry Bldg" → "SF Ferry Bld" at 12 tiles).
    const isBart = mode === "bart";
    const oldDest = formatDestination(
      isBart ? oldDep.destination : abbreviateDestination(oldDep.destination),
      cap
    );
    const newDest = formatDestination(
      isBart ? dep.destination : abbreviateDestination(dep.destination),
      cap
    );
    const destChanges = diffStrings(oldDest, newDest);
    tr.appendChild(createSplitFlapCell(newDest, destChanges, "destination-cell", cap));

    // Minutes - use split-flap if changed
    const oldMin = formatMinutes(oldDep.minutes);
    const newMin = formatMinutes(dep.minutes);
    const minChanges = diffStrings(oldMin, newMin);
    const minCell = createSplitFlapCell(newMin, minChanges, "minutes-cell");
    if (newMin === "NOW") {
      minCell.classList.add("boarding");
    }
    tr.appendChild(minCell);

    // Platform - use split-flap if changed
    const oldPlat = oldDep.platform || oldDep.remarks || "";
    const newPlat = dep.platform || dep.remarks || "";
    const platChanges = diffStrings(oldPlat, newPlat);
    tr.appendChild(createSplitFlapCell(newPlat, platChanges, "platform-cell"));

    tbody.appendChild(tr);
  }

  // After rendering, sync the cap with the real cell width: if the
  // measured cap differs from the one used, re-render once with it. The
  // override guard keeps this to a single extra pass.
  if (capOverride === undefined) {
    const measured = measureDestCap(boardEl);
    if (measured && measured !== cap) {
      destCaps[mode] = measured;
      renderDepartures(boardEl, data, mode, measured);
      return;
    }
  }
  destCaps[mode] = cap;

  // Update previous departures for next diff
  previousDepartures[mode] = newDepartures.map((d) => ({
    destination: d.destination || "",
    minutes: d.minutes,
    platform: d.platform || d.remarks || "",
  }));
}

function updateBoard(boardEl, data, mode) {
  if (!data) return;

  const updatedEl = boardEl.querySelector(".updated");
  const staleBadge = boardEl.querySelector(".badge.stale");
  const stopNameEl = boardEl.querySelector(".stop-name");

  if (!updatedEl || !staleBadge || !stopNameEl) {
    console.error(`Missing required elements in board for mode ${mode}`);
    return;
  }

  if (data.stop) stopNameEl.textContent = data.stop;

  // Handle unconfigured boards (ferry/bus) - show COMING SOON, no stale badge.
  // Title is the mode name, never a "not configured" placeholder (issue #6).
  if (data.unconfigured) {
    stopNameEl.textContent = mode === "ferry" ? "FERRY" : "BUS";
    const comingSoon = mode === "ferry" ? "FERRY \u00B7 COMING SOON" : "BUS \u00B7 COMING SOON";
    const tbody = boardEl.querySelector(".departures tbody");
    if (tbody) {
      tbody.innerHTML = "";
      const tr = document.createElement("tr");
      tr.className = "empty-row";
      const td = document.createElement("td");
      td.setAttribute("colspan", "4");
      td.textContent = comingSoon;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    // No stale badge for unconfigured
    staleBadge.hidden = true;
    updatedEl.textContent = "";
    return;
  }

  if (data.updatedAt) {
    const dt = new Date(data.updatedAt);
    updatedEl.textContent = `UPDATED ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;

    // Check if data is stale (older than 2 minutes) - only for configured modes
    const isStale = data.stale || Date.now() - dt.getTime() > STALE_THRESHOLD_MS;
    staleBadge.hidden = !isStale;
  } else {
    staleBadge.hidden = false;
  }

  renderDepartures(boardEl, data, mode);
}

async function poll() {
  const data = await fetchBoard();
  if (data) {
    for (const [mode, boardEl] of Object.entries(boards)) {
      if (boardEl && data[mode]) {
        updateBoard(boardEl, data[mode], mode);
      }
    }
  }
}

// Tab switching
for (const tab of tabs) {
  tab.addEventListener("click", () => showMode(tab.dataset.mode));
}

// Initialize: default to BART
showMode("bart");

updateClock();
setInterval(updateClock, 1000);
poll();
setInterval(poll, POLL_INTERVAL_MS);

// Expose for testing
window.__bayBoard = { poll, updateBoard, renderDepartures, showMode };
