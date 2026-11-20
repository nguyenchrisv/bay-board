// Bay Board front-end application
// Polls /api/board and renders split-flap style departures

const POLL_INTERVAL_MS = 30_000;

const boards = {
  bart: document.querySelector('[data-mode="bart"]'),
  ferry: document.querySelector('[data-mode="ferry"]'),
  bus: document.querySelector('[data-mode="bus"]'),
};

const tabs = document.querySelectorAll('.mode-tabs [role="tab"]');
const clockEl = document.querySelector('.clock');

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

function renderDepartures(boardEl, data) {
  const tbody = boardEl.querySelector('.departures tbody');
  if (!tbody) return;

  if (!data || !data.departures?.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No departures</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  for (const dep of data.departures) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="line-chip" style="background-color: ${dep.color || 'transparent'}">${dep.line || ''}</span></td>
      <td>${dep.destination || ''}</td>
      <td>${dep.minutes !== undefined ? dep.minutes : ''}</td>
      <td>${dep.platform || dep.remarks || ''}</td>
    `;
    tbody.appendChild(tr);
  }
}

function updateBoard(boardEl, data) {
  if (!data) return;

  const updatedEl = boardEl.querySelector('.updated');
  const staleBadge = boardEl.querySelector('.badge.stale');
  const stopNameEl = boardEl.querySelector('.stop-name');

  if (data.stop) stopNameEl.textContent = data.stop;
  if (data.updatedAt) {
    const dt = new Date(data.updatedAt);
    updatedEl.textContent = `UPDATED ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  staleBadge.hidden = !data.stale;

  renderDepartures(boardEl, data);
}

async function poll() {
  const data = await fetchBoard();
  if (data) {
    for (const [mode, boardEl] of Object.entries(boards)) {
      if (data[mode]) {
        updateBoard(boardEl, data[mode]);
      }
    }
  }
}

// Tab switching
for (const tab of tabs) {
  tab.addEventListener('click', () => showMode(tab.dataset.mode));
}

// Reduced motion check
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Initialize
updateClock();
setInterval(updateClock, 1000);
poll();
setInterval(poll, POLL_INTERVAL_MS);

// Expose for testing
window.__bayBoard = { poll, updateBoard, renderDepartures };