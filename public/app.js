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

import {
  isWallMode,
  isTerminalWallMode,
  getWallModeType,
  getTerminalTheme,
  getWallModes,
  getNextModeIndex,
  formatWallDestination,
  getRotationInterval,
} from "./wall-view-utils.js";

import { MAX_CONSECUTIVE_FAILURES, shouldShowError, resetConsecutiveFailures, markGoodDataReceived } from "./error-logic.js";

const POLL_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

const boards = {
  bart: document.querySelector('section.board[data-mode="bart"]'),
  ferry: document.querySelector('section.board[data-mode="ferry"]'),
  bus: document.querySelector('section.board[data-mode="bus"]'),
  fitness: document.querySelector('section.board[data-mode="fitness"]'),
};

const tabs = document.querySelectorAll(".mode-tabs [role=\"tab\"]");
const clockEl = document.querySelector(".clock");

// Store previous departures for character diffing
const previousDepartures = {
  bart: [],
  ferry: [],
  bus: [],
};

// Track consecutive failures per board (for issue #39)
// Only show ERROR after MAX_CONSECUTIVE_FAILURES consecutive failures
const consecutiveFailures = {
  bart: 0,
  ferry: 0,
  bus: 0,
  fitness: 0,
};

// Track whether we have ever received good data for each board
const hasGoodData = {
  bart: false,
  ferry: false,
  bus: false,
  fitness: false,
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

// Wall view state
let wallModeActive = false;
let wallModeType = null; // "square" or "terminal"
let terminalTheme = "light";
let wallModes = [];
let currentWallModeIndex = 0;
let wallRotationTimer = null;
let wallRotationInterval = 15_000;

// Track previous departures for terminal typing animation
const previousTerminalDepartures = {
  bart: [],
  ferry: [],
  bus: [],
  fitness: [],
};

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
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { error: true, status: res.status, message: errorData.error || `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch board:", err);
    return { error: true, status: 0, message: err.message };
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

function renderDepartures(boardEl, data, mode, capOverride, isWall = false, isTerminal = false) {
  const tbody = boardEl.querySelector(".departures tbody");
  if (!tbody) return;

  if (!data || !data.departures?.length) {
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.setAttribute("colspan", "4");
    td.textContent = isWall ? "NO DEPARTURES" : "No departures";
    tr.appendChild(td);
    tbody.appendChild(tr);
    previousDepartures[mode] = [];
    if (isTerminal) previousTerminalDepartures[mode] = [];
    return;
  }

  const cap = capOverride ?? destCaps[mode] ?? 12;
  const newDepartures = data.departures;
  const oldDepartures = isTerminal ? previousTerminalDepartures[mode] : (previousDepartures[mode] || []);

  tbody.innerHTML = "";
  const maxRows = (isWall || isTerminal) ? 5 : newDepartures.length;
  for (let i = 0; i < Math.min(newDepartures.length, maxRows); i++) {
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
    // For wall view, use larger cap (16 tiles) and wall destination formatting.
    // For terminal mode, no split-flap tiles — text renders directly with typing animation.
    const isBart = mode === "bart";
    let oldDest, newDest;
    if (isWall || isTerminal) {
      oldDest = formatWallDestination(
        isBart ? oldDep.destination : abbreviateDestination(oldDep.destination),
        16
      );
      newDest = formatWallDestination(
        isBart ? dep.destination : abbreviateDestination(dep.destination),
        16
      );
    } else {
      oldDest = formatDestination(
        isBart ? oldDep.destination : abbreviateDestination(oldDep.destination),
        cap
      );
      newDest = formatDestination(
        isBart ? dep.destination : abbreviateDestination(dep.destination),
        cap
      );
    }
    const destChanges = diffStrings(oldDest, newDest);
    const destTileCount = (isWall || isTerminal) ? 16 : cap;

    if (isTerminal) {
      // Terminal mode: render text with typing animation
      const destTd = document.createElement("td");
      destTd.className = "destination-cell";
      const typingSpan = document.createElement("span");
      typingSpan.className = "term-typing";
      typingSpan.textContent = newDest;
      destTd.appendChild(typingSpan);
      // Add cursor after typing completes
      setTimeout(() => {
        const cursor = document.createElement("span");
        cursor.className = "term-cursor";
        cursor.setAttribute("aria-hidden", "true");
        destTd.appendChild(cursor);
      }, 300);
      tr.appendChild(destTd);
    } else {
      // Normal/square wall mode: use split-flap
      tr.appendChild(createSplitFlapCell(newDest, destChanges, "destination-cell", destTileCount));
    }

    // Minutes - use split-flap if changed (or plain text for terminal)
    const oldMin = formatMinutes(oldDep.minutes);
    const newMin = formatMinutes(dep.minutes);
    const minChanges = diffStrings(oldMin, newMin);

    if (isTerminal) {
      const minTd = document.createElement("td");
      minTd.className = "minutes-cell";
      const typingSpan = document.createElement("span");
      typingSpan.className = "term-typing";
      typingSpan.textContent = newMin;
      minTd.appendChild(typingSpan);
      if (newMin === "NOW") {
        minTd.classList.add("boarding");
      }
      setTimeout(() => {
        const cursor = document.createElement("span");
        cursor.className = "term-cursor";
        cursor.setAttribute("aria-hidden", "true");
        minTd.appendChild(cursor);
      }, 300);
      tr.appendChild(minTd);
    } else {
      const minCell = createSplitFlapCell(newMin, minChanges, "minutes-cell");
      if (newMin === "NOW") {
        minCell.classList.add("boarding");
      }
      tr.appendChild(minCell);
    }

    // Platform - use split-flap if changed (or plain text for terminal)
    const oldPlat = oldDep.platform || oldDep.remarks || "";
    const newPlat = dep.platform || dep.remarks || "";
    const platChanges = diffStrings(oldPlat, newPlat);

    if (isTerminal) {
      const platTd = document.createElement("td");
      platTd.className = "platform-cell";
      const typingSpan = document.createElement("span");
      typingSpan.className = "term-typing";
      typingSpan.textContent = newPlat;
      platTd.appendChild(typingSpan);
      setTimeout(() => {
        const cursor = document.createElement("span");
        cursor.className = "term-cursor";
        cursor.setAttribute("aria-hidden", "true");
        platTd.appendChild(cursor);
      }, 300);
      tr.appendChild(platTd);
    } else {
      tr.appendChild(createSplitFlapCell(newPlat, platChanges, "platform-cell"));
    }

    tbody.appendChild(tr);
  }

  // After rendering, sync the cap with the real cell width: if the
  // measured cap differs from the one used, re-render once with it. The
  // override guard keeps this to a single extra pass.
  if (capOverride === undefined && !isWall && !isTerminal) {
    const measured = measureDestCap(boardEl);
    if (measured && measured !== cap) {
      destCaps[mode] = measured;
      renderDepartures(boardEl, data, mode, measured);
      return;
    }
  }
  destCaps[mode] = cap;

  // Update previous departures for next diff
  if (isTerminal) {
    previousTerminalDepartures[mode] = newDepartures.map((d) => ({
      destination: d.destination || "",
      minutes: d.minutes,
      platform: d.platform || d.remarks || "",
    }));
  } else {
    previousDepartures[mode] = newDepartures.map((d) => ({
      destination: d.destination || "",
      minutes: d.minutes,
      platform: d.platform || d.remarks || "",
    }));
  }
}

function updateBoard(boardEl, data, mode, isWall = false, isTerminal = false) {
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
      td.textContent = (isWall || isTerminal) ? comingSoon : comingSoon;
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

  renderDepartures(boardEl, data, mode, undefined, isWall, isTerminal);
}

async function poll() {
  const data = await fetchBoard();
  if (data) {
    if (data.error) {
      // Error response from API - handle per board
      if (wallModeActive) {
        // In wall mode, only handle the currently visible board
        const currentMode = wallModes[currentWallModeIndex];
        const boardEl = boards[currentMode];
        if (boardEl) {
          handleBoardFailure(boardEl, currentMode, data.message, true, wallModeType === "terminal");
        }
      } else {
        // Normal mode: on HTTP failure, fetchBoard() returns a top-level
        // error object with NO per-mode keys. Handle failure for all
        // configured boards with the same message.
        for (const [mode, boardEl] of Object.entries(boards)) {
          if (boardEl && configuredModes.has(mode)) {
            handleBoardFailure(boardEl, mode, data.message, false, false);
          }
        }
      }
      return;
    }
    // Success - process data
    if (wallModeActive) {
      // In wall mode, only update the currently visible board
      const currentMode = wallModes[currentWallModeIndex];
      const boardEl = boards[currentMode];
      if (boardEl && data[currentMode]) {
        handleBoardSuccess(boardEl, currentMode, data[currentMode], true, wallModeType === "terminal");
      }
    } else {
      // Normal mode: update all boards
      for (const [mode, boardEl] of Object.entries(boards)) {
        if (boardEl && data[mode]) {
          handleBoardSuccess(boardEl, mode, data[mode], false, false);
        }
      }
    }
  }
}

function handleBoardSuccess(boardEl, mode, data, isWall = false, isTerminal = false) {
  // Reset failure count on success
  consecutiveFailures[mode] = 0;
  hasGoodData[mode] = true;
  updateBoard(boardEl, data, mode, isWall, isTerminal);
}

function handleBoardFailure(boardEl, mode, message, isWall = false, isTerminal = false) {
  // Increment failure count
  consecutiveFailures[mode]++;

  // Only show ERROR if:
  // 1. We have never received good data for this board, OR
  // 2. We've hit MAX_CONSECUTIVE_FAILURES consecutive failures
  const shouldShow = shouldShowError(hasGoodData[mode], consecutiveFailures[mode]);

  if (shouldShow) {
    if (isWall || isTerminal) {
      showWallBoardError(boardEl, message, isTerminal);
    } else {
      showBoardError(boardEl, message);
    }
  } else {
    // We have good data and haven't hit max failures yet
    // Mark the board as stale but keep showing the last good data
    const staleBadge = boardEl.querySelector(".badge.stale");
    if (staleBadge) {
      staleBadge.hidden = false;
    }
    const updatedEl = boardEl.querySelector(".updated");
    if (updatedEl && updatedEl.textContent) {
      // Update the updated text to show it's stale
      updatedEl.textContent = `UPDATED (stale - ${consecutiveFailures[mode]}/${MAX_CONSECUTIVE_FAILURES} failures)`;
    }
  }
}

// Wall view functions
function initWallMode(config) {
  wallModeActive = true;
  wallModeType = getWallModeType(); // "square" or "terminal"
  terminalTheme = wallModeType === "terminal" ? getTerminalTheme() : null;
  wallModes = getWallModes(config);
  currentWallModeIndex = 0;
  wallRotationInterval = getRotationInterval(config);

  // Apply terminal theme to document root
  if (wallModeType === "terminal" && terminalTheme) {
    document.documentElement.setAttribute("data-term-theme", terminalTheme);
    document.body.setAttribute("data-wall", "terminal");
  }

  // Hide mode tabs
  const modeTabs = document.querySelector(".mode-tabs");
  if (modeTabs) modeTabs.hidden = true;

  // Hide all boards initially
  for (const board of Object.values(boards)) {
    if (board) board.hidden = true;
  }

  // Show first board
  showWallBoard(currentWallModeIndex);

  // Initial poll to populate boards
  poll();

  // Start rotation timer
  startWallRotation();

  // Add tap/click handler to advance to next board
  document.body.addEventListener("click", handleWallTap);
  document.body.addEventListener("keydown", handleWallKeydown);
}

function showBoardError(boardEl, message) {
  const tbody = boardEl.querySelector(".departures tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const tr = document.createElement("tr");
  tr.className = "error-row";
  const td = document.createElement("td");
  td.setAttribute("colspan", "4");
  td.textContent = `ERROR: ${message}`;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

function showWallBoardError(boardEl, message, isTerminal = false) {
  showBoardError(boardEl, message);
  // Also update header to show error
  const stopNameEl = boardEl.querySelector(".stop-name");
  if (stopNameEl) {
    stopNameEl.textContent = "ERROR";
  }
  const updatedEl = boardEl.querySelector(".updated");
  if (updatedEl) {
    updatedEl.textContent = "";
  }
}

function showWallBoard(index) {
  // Hide all boards
  for (const board of Object.values(boards)) {
    if (board) board.hidden = true;
  }

  // Show current board
  const mode = wallModes[index];
  const boardEl = boards[mode];
  if (boardEl) {
    boardEl.hidden = false;
    boardEl.dataset.active = "true";
  }
}

function advanceWallBoard() {
  currentWallModeIndex = getNextModeIndex(currentWallModeIndex, wallModes);
  showWallBoard(currentWallModeIndex);
}

function startWallRotation() {
  if (wallRotationTimer) {
    clearInterval(wallRotationTimer);
  }
  wallRotationTimer = setInterval(() => {
    advanceWallBoard();
    // Trigger a poll to update the new board
    poll();
  }, wallRotationInterval);
}

function stopWallRotation() {
  if (wallRotationTimer) {
    clearInterval(wallRotationTimer);
    wallRotationTimer = null;
  }
}

function handleWallTap(event) {
  // Ignore clicks on interactive elements (tabs, etc.)
  if (event.target.closest("button, a, input, select")) return;
  advanceWallBoard();
  poll();
}

function handleWallKeydown(event) {
  // Space or Enter to advance
  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    advanceWallBoard();
    poll();
  }
}

// Initialize wall mode if active
function init() {
  // Check for wall mode (square or terminal)
  if (isWallMode()) {
    // Fetch config to determine which modes are available
    fetch("/api/config").then(res => res.json()).then(config => {
      initWallMode(config);
    }).catch(err => {
      console.error("Failed to load config for wall mode:", err);
      // Fallback: assume all modes
      initWallMode({ bart: { stations: ["FTVL"] }, ferry: { stops: ["7206"] }, bus: { stops: ["57727"] } });
    });
    return;
  }

  // Normal mode initialization
  showMode("bart");
  updateClock();
  setInterval(updateClock, 1000);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);

  // Tab switching
  for (const tab of tabs) {
    tab.addEventListener("click", () => showMode(tab.dataset.mode));
  }
}

// Run initialization
init();

// Export for testing
window.__bayBoard = { poll, updateBoard, renderDepartures, showMode, initWallMode, advanceWallBoard };