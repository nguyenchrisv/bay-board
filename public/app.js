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
  getWallModes,
  getNextModeIndex,
  formatWallDestination,
  getRotationInterval,
} from "./wall-view-utils.js";

import { MAX_CONSECUTIVE_FAILURES, shouldShowError, resetConsecutiveFailures, markGoodDataReceived } from "./error-logic.js";

import { LayoutModel } from "./layout-model.js";

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
const editLayoutBtn = document.querySelector(".edit-layout-btn");
const editModePanel = document.querySelector("#edit-mode-panel");
const editModeTilesEl = document.querySelector(".edit-mode-tiles");
const editModeHiddenEl = document.querySelector(".edit-mode-hidden");
const resetLayoutBtn = document.querySelector(".reset-layout-btn");
const doneEditBtn = document.querySelector(".done-edit-btn");

// Store previous departures for character diffing
const previousDepartures = {
  bart: [],
  ferry: [],
  bus: [],
};

// Track consecutive failures per board (for issue #39)
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

// Destination tile cap per mode
const DEST_CAP_THRESHOLD_PX = 155;
const destCaps = { bart: 12, ferry: 12, bus: 12 };

// Track configured modes to avoid stale badge on unconfigured
const configuredModes = new Set(Object.keys(boards).filter((mode) => {
  const board = boards[mode];
  return board && !board.dataset.unconfigured;
}));

// Wall view state
let wallModeActive = false;
let wallModes = [];
let currentWallModeIndex = 0;
let wallRotationTimer = null;
let wallRotationInterval = 15_000;

// Layout model
const DEFAULT_TILES = [
  { id: "bart", title: "BART", width: "full" },
  { id: "ferry", title: "Ferry", width: "half" },
  { id: "bus", title: "Bus", width: "half" },
  { id: "fitness", title: "Fitness", width: "full" },
];

let layoutModel;
let editModeActive = false;
let dragState = null; // { sourceEl, sourceMode, ghostEl, startX, startY }

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

function measureDestCap(boardEl) {
  const cell = boardEl.querySelector(".departures td.destination-cell");
  if (!cell) return null;
  const style = window.getComputedStyle(cell);
  const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = cell.clientWidth - pad;
  if (!Number.isFinite(width) || width <= 0) return null;
  return width >= DEST_CAP_THRESHOLD_PX ? 12 : 10;
}

function renderDepartures(boardEl, data, mode, capOverride, isWall = false) {
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
    return;
  }

  const cap = capOverride ?? destCaps[mode] ?? 12;
  const newDepartures = data.departures;
  const oldDepartures = previousDepartures[mode] || [];

  tbody.innerHTML = "";
  const maxRows = isWall ? 5 : newDepartures.length;
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

    // Destination - capped to the current tile cap
    const isBart = mode === "bart";
    let oldDest, newDest;
    if (isWall) {
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
    const destTileCount = isWall ? 16 : cap;
    tr.appendChild(createSplitFlapCell(newDest, destChanges, "destination-cell", destTileCount));

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

  // After rendering, sync the cap with the real cell width
  if (capOverride === undefined && !isWall) {
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

function updateBoard(boardEl, data, mode, isWall = false) {
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
      td.textContent = isWall ? comingSoon : comingSoon;
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

  renderDepartures(boardEl, data, mode, undefined, isWall);
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
          handleBoardFailure(boardEl, currentMode, data.message, true);
        }
      } else {
        // Normal mode: on HTTP failure, fetchBoard() returns a top-level
        // error object with NO per-mode keys. Handle failure for all
        // configured boards with the same message.
        for (const [mode, boardEl] of Object.entries(boards)) {
          if (boardEl && configuredModes.has(mode)) {
            handleBoardFailure(boardEl, mode, data.message, false);
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
        handleBoardSuccess(boardEl, currentMode, data[currentMode], true);
      }
    } else {
      // Normal mode: update all boards
      for (const [mode, boardEl] of Object.entries(boards)) {
        if (boardEl && data[mode]) {
          handleBoardSuccess(boardEl, mode, data[mode], false);
        }
      }
    }
  }
}

function handleBoardSuccess(boardEl, mode, data, isWall = false) {
  // Reset failure count on success
  consecutiveFailures[mode] = 0;
  hasGoodData[mode] = true;
  updateBoard(boardEl, data, mode, isWall);
}

function handleBoardFailure(boardEl, mode, message, isWall = false) {
  // Increment failure count
  consecutiveFailures[mode]++;

  // Only show ERROR if:
  // 1. We have never received good data for this board, OR
  // 2. We've hit MAX_CONSECUTIVE_FAILURES consecutive failures
  const shouldShow = shouldShowError(hasGoodData[mode], consecutiveFailures[mode]);

  if (shouldShow) {
    if (isWall) {
      showWallBoardError(boardEl, message);
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
  wallModes = getWallModes(config);
  currentWallModeIndex = 0;
  wallRotationInterval = getRotationInterval(config);

  // Hide mode tabs
  const modeTabs = document.querySelector(".mode-tabs");
  if (modeTabs) modeTabs.hidden = true;

  // Hide edit layout button in wall mode
  if (editLayoutBtn) editLayoutBtn.hidden = true;

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

function showWallBoardError(boardEl, message) {
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

// Layout model initialization
function initLayoutModel() {
  layoutModel = new LayoutModel({ defaultTiles: DEFAULT_TILES });

  // Apply saved layout to boards
  applyLayoutToBoards();

  // Show/hide edit layout button based on whether there are multiple tiles
  const layout = layoutModel.getLayout();
  if (editLayoutBtn && layout.length > 1) {
    editLayoutBtn.hidden = false;
  }
}

function applyLayoutToBoards() {
  const layout = layoutModel.getLayout();

  // Apply order, width, and hidden state to each board
  layout.forEach((tile, index) => {
    const boardEl = boards[tile.id];
    if (!boardEl) return;

    // Set order via CSS order property
    boardEl.style.order = index;

    // Set width
    boardEl.dataset.width = tile.width;

    // Set hidden state
    boardEl.hidden = tile.hidden;

    // Update mobile tab visibility
    const tab = document.querySelector(`.mode-tabs [data-mode="${tile.id}"]`);
    if (tab) {
      tab.hidden = tile.hidden;
    }
  });

  // Update mobile tab order to match layout order
  updateMobileTabsOrder();

  // Re-render edit mode panel if active
  if (editModeActive) {
    renderEditModePanel();
  }
}

function updateMobileTabsOrder() {
  const modeTabsEl = document.querySelector(".mode-tabs");
  if (!modeTabsEl) return;

  const layout = layoutModel.getLayout();
  const visibleTabs = layout.filter(t => !t.hidden).map(t => t.id);

  // Reorder tabs in DOM to match layout order
  visibleTabs.forEach((modeId, index) => {
    const tab = document.querySelector(`.mode-tabs [data-mode="${modeId}"]`);
    if (tab) {
      tab.style.order = index;
    }
  });
}

function renderEditModePanel() {
  const layout = layoutModel.getLayout();

  // Render visible tiles list
  const visibleTiles = layout.filter(t => !t.hidden);
  editModeTilesEl.innerHTML = "";
  if (visibleTiles.length === 0) {
    editModeTilesEl.innerHTML = '<p class="empty-message">No visible tiles</p>';
  } else {
    const h3 = document.createElement("h3");
    h3.textContent = "Visible tiles (drag to reorder)";
    editModeTilesEl.appendChild(h3);

    visibleTiles.forEach((tile, index) => {
      const tileEl = createEditTileElement(tile, index, false);
      editModeTilesEl.appendChild(tileEl);
    });
  }

  // Render hidden tiles list
  const hiddenTiles = layout.filter(t => t.hidden);
  editModeHiddenEl.innerHTML = "";
  if (hiddenTiles.length === 0) {
    editModeHiddenEl.innerHTML = '<p class="empty-message">No hidden tiles</p>';
  } else {
    const h3 = document.createElement("h3");
    h3.textContent = "Hidden tiles (click to show)";
    editModeHiddenEl.appendChild(h3);

    hiddenTiles.forEach((tile) => {
      const tileEl = createEditTileElement(tile, null, true);
      editModeHiddenEl.appendChild(tileEl);
    });
  }

  // Add drag-and-drop handlers
  addDragHandlers();
}

function createEditTileElement(tile, visibleIndex, isHidden) {
  const div = document.createElement("div");
  div.className = `edit-tile${isHidden ? " hidden-tile" : ""}`;
  div.dataset.tileId = tile.id;
  if (!isHidden) div.dataset.visibleIndex = visibleIndex;

  // Drag handle
  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "edit-tile-drag-handle";
  dragHandle.setAttribute("aria-label", `Drag ${tile.title} to reorder`);
  dragHandle.innerHTML = "⋮⋮";
  dragHandle.tabIndex = 0;

  // Title
  const titleSpan = document.createElement("span");
  titleSpan.className = "edit-tile-title";
  titleSpan.textContent = tile.title;

  // Controls
  const controls = document.createElement("div");
  controls.className = "edit-tile-controls";

  // Width toggle
  const widthBtn = document.createElement("button");
  widthBtn.type = "button";
  widthBtn.className = `edit-tile-width-btn${tile.width === "full" ? " full-width" : ""}`;
  widthBtn.textContent = tile.width === "full" ? "FULL" : "HALF";
  widthBtn.setAttribute("aria-label", `${tile.title}: switch to ${tile.width === "full" ? "half" : "full"} width`);
  widthBtn.addEventListener("click", () => {
    layoutModel.toggleWidth(tile.id);
    applyLayoutToBoards();
  });

  // Visibility toggle
  const visibilityBtn = document.createElement("button");
  visibilityBtn.type = "button";
  visibilityBtn.className = `edit-tile-visibility-btn${isHidden ? " hidden" : ""}`;
  visibilityBtn.textContent = isHidden ? "SHOW" : "HIDE";
  visibilityBtn.setAttribute("aria-label", `${tile.title}: ${isHidden ? "show" : "hide"} tile`);
  visibilityBtn.addEventListener("click", () => {
    layoutModel.setHidden(tile.id, !isHidden);
    applyLayoutToBoards();
  });

  // Move earlier/later buttons (only for visible tiles)
  if (!isHidden && visibleIndex !== null) {
    const layout = layoutModel.getLayout();
    const visibleTiles = layout.filter(t => !t.hidden);

    // Move earlier
    if (visibleIndex > 0) {
      const moveUpBtn = document.createElement("button");
      moveUpBtn.type = "button";
      moveUpBtn.className = "edit-tile-move-btn";
      moveUpBtn.textContent = "↑";
      moveUpBtn.setAttribute("aria-label", `Move ${tile.title} earlier`);
      moveUpBtn.addEventListener("click", () => {
        layoutModel.moveTile(tile.id, visibleIndex - 1);
        applyLayoutToBoards();
        announcePositionChange(tile.title, visibleIndex - 1);
      });
      controls.appendChild(moveUpBtn);
    }

    // Move later
    if (visibleIndex < visibleTiles.length - 1) {
      const moveDownBtn = document.createElement("button");
      moveDownBtn.type = "button";
      moveDownBtn.className = "edit-tile-move-btn";
      moveDownBtn.textContent = "↓";
      moveDownBtn.setAttribute("aria-label", `Move ${tile.title} later`);
      moveDownBtn.addEventListener("click", () => {
        layoutModel.moveTile(tile.id, visibleIndex + 1);
        applyLayoutToBoards();
        announcePositionChange(tile.title, visibleIndex + 1);
      });
      controls.appendChild(moveDownBtn);
    }
  }

  controls.prepend(widthBtn);
  controls.appendChild(visibilityBtn);

  div.appendChild(dragHandle);
  div.appendChild(titleSpan);
  div.appendChild(controls);

  return div;
}

function addDragHandlers() {
  const tiles = editModeTilesEl.querySelectorAll(".edit-tile:not(.hidden-tile)");
  tiles.forEach(tile => {
    tile.addEventListener("pointerdown", handleDragStart);
    tile.addEventListener("dragstart", e => e.preventDefault()); // Prevent native drag
  });
}

function handleDragStart(e) {
  if (e.button !== 0 && e.pointerType !== "touch") return; // Only left click or touch
  const tile = e.currentTarget;
  const mode = tile.dataset.tileId;
  const index = parseInt(tile.dataset.visibleIndex, 10);

  // Create ghost element for visual feedback
  const ghost = tile.cloneNode(true);
  ghost.classList.add("dragging");
  ghost.style.position = "fixed";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "1000";
  ghost.style.opacity = "0.8";
  document.body.appendChild(ghost);

  dragState = {
    sourceEl: tile,
    sourceMode: mode,
    ghostEl: ghost,
    startX: e.clientX,
    startY: e.clientY,
    currentIndex: parseInt(tile.dataset.visibleIndex, 10),
  };

  tile.classList.add("dragging");
  document.body.classList.add("dragging");

  // Position ghost at cursor
  updateGhostPosition(e);

  // Add global pointer events
  document.addEventListener("pointermove", handleDragMove);
  document.addEventListener("pointerup", handleDragEnd);
  document.addEventListener("pointercancel", handleDragEnd);
}

function updateGhostPosition(e) {
  if (!dragState || !dragState.ghostEl) return;
  dragState.ghostEl.style.left = `${e.clientX - 80}px`;
  dragState.ghostEl.style.top = `${e.clientY - 30}px`;
}

function handleDragMove(e) {
  if (!dragState) return;
  e.preventDefault();
  updateGhostPosition(e);

  // Find drop target
  const tiles = editModeTilesEl.querySelectorAll(".edit-tile:not(.hidden-tile):not(.dragging)");
  const layout = layoutModel.getLayout();
  const visibleTiles = layout.filter(t => !t.hidden);

  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (e.clientY < midY) {
      // Show drop indicator above this tile
      tile.classList.add("drag-over-above");
      tile.classList.remove("drag-over-below");
    } else {
      tile.classList.add("drag-over-below");
      tile.classList.remove("drag-over-above");
    }
  }
}

function handleDragEnd(e) {
  if (!dragState) return;

  // Find drop target
  const tiles = editModeTilesEl.querySelectorAll(".edit-tile:not(.hidden-tile):not(.dragging)");
  let newIndex = dragState.currentIndex;

  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (e.clientY < midY) {
      newIndex = parseInt(tile.dataset.visibleIndex, 10);
      break;
    } else {
      newIndex = parseInt(tile.dataset.visibleIndex, 10) + 1;
    }
  }

  // Clean up drop indicators
  tiles.forEach(t => {
    t.classList.remove("drag-over-above", "drag-over-below");
  });

  // Perform the move if index changed
  if (newIndex !== dragState.currentIndex) {
    const mode = dragState.sourceMode;
    layoutModel.moveTile(mode, newIndex);
    applyLayoutToBoards();
    announcePositionChange(dragState.sourceMode, newIndex);
  }

  // Clean up
  dragState.sourceEl.classList.remove("dragging");
  dragState.ghostEl.remove();
  document.body.classList.remove("dragging");
  dragState = null;

  document.removeEventListener("pointermove", handleDragMove);
  document.removeEventListener("pointerup", handleDragEnd);
  document.removeEventListener("pointercancel", handleDragEnd);
}

function announcePositionChange(tileId, newVisibleIndex) {
  const layout = layoutModel.getLayout();
  const tile = layout.find(t => t.id === tileId);
  if (!tile) return;

  const visibleTiles = layout.filter(t => !t.hidden);
  const position = newVisibleIndex + 1;
  const total = visibleTiles.length;

  // Create aria-live announcement
  const announcement = document.createElement("div");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  announcement.className = "visually-hidden";
  announcement.textContent = `${tile.title} moved to position ${position} of ${total}`;
  document.body.appendChild(announcement);

  // Remove after announcement
  setTimeout(() => announcement.remove(), 1000);
}

// Edit mode toggle
function toggleEditMode() {
  editModeActive = !editModeActive;
  document.body.classList.toggle("edit-mode", editModeActive);
  editModePanel.hidden = !editModeActive;
  editLayoutBtn.setAttribute("aria-expanded", editModeActive);

  if (editModeActive) {
    editLayoutBtn.textContent = "Done editing";
    renderEditModePanel();
    // Hide mode tabs on mobile during edit mode
    const modeTabs = document.querySelector(".mode-tabs");
    if (modeTabs && window.innerWidth < 600) {
      modeTabs.hidden = true;
    }
  } else {
    editLayoutBtn.textContent = "Edit layout";
    // Restore mode tabs on mobile
    const modeTabs = document.querySelector(".mode-tabs");
    if (modeTabs && window.innerWidth < 600) {
      modeTabs.hidden = false;
    }
  }
}

function resetLayout() {
  layoutModel.reset();
  applyLayoutToBoards();
}

// Initialize
function init() {
  // Check for wall mode
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
  initLayoutModel();
  showMode("bart");
  updateClock();
  setInterval(updateClock, 1000);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);

  // Tab switching
  for (const tab of tabs) {
    tab.addEventListener("click", () => showMode(tab.dataset.mode));
  }

  // Edit layout button
  if (editLayoutBtn) {
    editLayoutBtn.addEventListener("click", toggleEditMode);
  }

  // Edit mode panel buttons
  if (resetLayoutBtn) {
    resetLayoutBtn.addEventListener("click", resetLayout);
  }
  if (doneEditBtn) {
    doneEditBtn.addEventListener("click", toggleEditMode);
  }

  // Close edit mode on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editModeActive) {
      toggleEditMode();
    }
  });

  // Handle window resize for mobile tab visibility
  window.addEventListener("resize", () => {
    const modeTabs = document.querySelector(".mode-tabs");
    if (modeTabs && editModeActive && window.innerWidth < 600) {
      modeTabs.hidden = true;
    } else if (modeTabs && !editModeActive && window.innerWidth < 600) {
      modeTabs.hidden = false;
    }
  });
}

// Run initialization
init();

// Export for testing
window.__bayBoard = {
  poll,
  updateBoard,
  renderDepartures,
  showMode,
  initWallMode,
  advanceWallBoard,
  layoutModel,
  getLayout: () => layoutModel?.getLayout(),
  toggleEditMode,
};