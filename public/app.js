// Bay Board front-end application
// Polls /api/board and renders split-flap style departures

import {
  getLineNameFromColor,
  formatMinutes,
  getAccessibleLabel,
  diffStrings,
  createSplitFlapCell,
  createLineChipCell,
  createDestinationCell,
  createMinutesCell,
  createPlatformCell,
} from './split-flap.js';

const POLL_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

const boards = {
  bart: document.querySelector('[data-mode="bart"]'),
  ferry: document.querySelector('[data-mode="ferry"]'),
  bus: document.querySelector('[data-mode="bus"]'),
};

const tabs = document.querySelectorAll('.mode-tabs [role="tab"]');
const clockEl = document.querySelector('.clock');

// Store previous departures for character diffing
const previousDepartures = {
  bart: [],
  ferry: [],
  bus: [],
};

function updateClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function showMode(mode) {
  for (const [key, board] of Object.entries(boards)) {
    board.hidden = key !== mode;
  }
  for (const tab of tabs) {
    tab.setAttribute('aria-selected', tab.dataset.mode === mode);
  }
}

async function fetchBoard() {
  try {
    const res = await fetch('/api/board');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch board:', err);
    return null;
  }
}

function renderDepartures(boardEl, data, mode) {
  const tbody = boardEl.querySelector('.departures tbody');
  if (!tbody) return;

  if (!data || !data.departures?.length) {
    tbody.innerHTML = ''; // Clear existing
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.setAttribute('colspan', '4');
    td.textContent = 'No departures';
    tr.appendChild(td);
    tbody.appendChild(tr);
    previousDepartures[mode] = [];
    return;
  }

  const newDepartures = data.departures;
  const oldDepartures = previousDepartures[mode] || [];

  tbody.innerHTML = '';
  for (let i = 0; i < newDepartures.length; i++) {
    const dep = newDepartures[i];
    const oldDep = oldDepartures[i] || {};
    
    const tr = document.createElement('tr');
    tr.setAttribute('data-accessible-label', getAccessibleLabel(dep));
    
    // Line chip cell
    tr.appendChild(createLineChipCell(dep));
    
    // Destination - use split-flap if changed
    const oldDest = oldDep.destination || '';
    const newDest = dep.destination || '';
    const destChanges = diffStrings(oldDest, newDest);
    tr.appendChild(createSplitFlapCell(newDest, destChanges));
    
    // Minutes - use split-flap if changed
    const oldMin = formatMinutes(oldDep.minutes);
    const newMin = formatMinutes(dep.minutes);
    const minChanges = diffStrings(oldMin, newMin);
    const minCell = createSplitFlapCell(newMin, minChanges);
    if (newMin === 'NOW') {
      minCell.classList.add('boarding');
    }
    tr.appendChild(minCell);
    
    // Platform - use split-flap if changed
    const oldPlat = oldDep.platform || oldDep.remarks || '';
    const newPlat = dep.platform || dep.remarks || '';
    const platChanges = diffStrings(oldPlat, newPlat);
    tr.appendChild(createSplitFlapCell(newPlat, platChanges));
    
    tbody.appendChild(tr);
  }

  // Update previous departures for next diff
  previousDepartures[mode] = newDepartures.map(d => ({
    destination: d.destination || '',
    minutes: d.minutes,
    platform: d.platform || d.remarks || '',
  }));
}

function updateBoard(boardEl, data, mode) {
  if (!data) return;

  const updatedEl = boardEl.querySelector('.updated');
  const staleBadge = boardEl.querySelector('.badge.stale');
  const stopNameEl = boardEl.querySelector('.stop-name');

  if (data.stop) stopNameEl.textContent = data.stop;
  if (data.updatedAt) {
    const dt = new Date(data.updatedAt);
    updatedEl.textContent = `UPDATED ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    
    // Check if data is stale (older than 2 minutes)
    const isStale = data.stale || (Date.now() - dt.getTime() > STALE_THRESHOLD_MS);
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
      if (data[mode]) {
        updateBoard(boardEl, data[mode], mode);
      }
    }
  }
}

// Tab switching
for (const tab of tabs) {
  tab.addEventListener('click', () => showMode(tab.dataset.mode));
}

// Initialize
updateClock();
setInterval(updateClock, 1000);
poll();
setInterval(poll, POLL_INTERVAL_MS);

// Expose for testing
window.__bayBoard = { poll, updateBoard, renderDepartures };
