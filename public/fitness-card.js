// Fitness card frontend application
// Fetches /api/strava and renders fitness progress card and group rides

import {
  getActivityLabels,
  formatDistance,
  formatSpeed,
  formatPace,
  formatDuration,
  calculateWeeklyProgress,
  parseGroupEventDate,
  createStatCard,
  createProgressBar,
  createGroupEventCard,
  rangeStart,
  rangeTitle,
  computeRangeTotals,
  scaleGoal,
  activityTypesByCount,
} from "./fitness-card-utils.js";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour - Strava API limited to 1 call/hour
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

const fitnessBoard = document.querySelector('section.board[data-mode="fitness"]');
const typeTabsNav = document.querySelector(".fitness-types");
let fitnessTabs = document.querySelectorAll('.fitness-types [role="tab"]');
const rangeTabs = document.querySelectorAll('.fitness-range [role="tab"]');
const rangeTitleEl = document.getElementById("fitness-range-title");
const statsGrid = document.getElementById('fitness-stats');
const progressBars = document.getElementById('fitness-progress-bars');
const groupRidesList = document.getElementById('group-rides-list');
const updatedEl = fitnessBoard?.querySelector('.updated');
const staleBadge = fitnessBoard?.querySelector('.badge.stale');

let currentActivity = "Ride";
let currentRange = "7";
let typeTabsKey = "";
let previousStats = null;
let pollIntervalId = null;

function updateFitnessClock() {
  if (!updatedEl) return;
  const now = new Date();
  updatedEl.textContent = `UPDATED ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function showFitnessTab(activity) {
  currentActivity = activity;
  for (const tab of fitnessTabs) {
    tab.setAttribute("aria-selected", tab.dataset.activity === activity);
  }
  renderFitnessData(currentFitnessData);
}

function showFitnessRange(range) {
  currentRange = range;
  for (const tab of rangeTabs) {
    tab.setAttribute("aria-selected", tab.dataset.range === range);
  }
  if (rangeTitleEl) rangeTitleEl.textContent = rangeTitle(range);
  renderFitnessData(currentFitnessData);
}

// Build the activity tabs from the types actually in the data (most frequent first).
function syncTypeTabs(activities) {
  if (!typeTabsNav) return;
  const types = activityTypesByCount(activities, 4);
  if (types.length === 0) return;
  const key = types.join(",");
  if (key === typeTabsKey) return;
  typeTabsKey = key;
  if (!types.includes(currentActivity)) currentActivity = types[0];
  typeTabsNav.innerHTML = "";
  for (const t of types) {
    const btn = document.createElement("button");
    btn.setAttribute("role", "tab");
    btn.dataset.activity = t;
    btn.textContent = t.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
    btn.setAttribute("aria-selected", t === currentActivity);
    btn.addEventListener("click", () => showFitnessTab(t));
    typeTabsNav.appendChild(btn);
  }
  fitnessTabs = typeTabsNav.querySelectorAll('[role="tab"]');
}

async function fetchFitnessData() {
  try {
    const res = await fetch("/api/strava");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch fitness data:", err);
    return null;
  }
}

let currentFitnessData = null;

function renderFitnessData(data) {
  if (!data) {
    statsGrid.innerHTML = "";
    progressBars.innerHTML = "";
    groupRidesList.innerHTML = '<div class="loading-row">Failed to load data</div>';
    return;
  }

  currentFitnessData = data;
  const { athlete, stats, activities, clubs, groupEvents } = data;

  syncTypeTabs(activities);

  // Totals for the selected type and range
  const now = Date.now();
  const weekly = computeRangeTotals(activities, currentActivity, rangeStart(currentRange, now));
  const labels = getActivityLabels(currentActivity);

  // Weekly goals (hardcoded for now, could come from config)
  const weeklyGoals = {
    Ride: { distance: 160934.4, time: 3 * 3600 }, // 100 miles, 3 hours
    Run: { distance: 32186.88, time: 2 * 3600 }, // 20 miles, 2 hours
    Swim: { distance: 5000, time: 2 * 3600 }, // 5km, 2 hours
    default: { distance: 16093.44, time: 3600 }, // 10 miles, 1 hour
  };
  const goal = scaleGoal(weeklyGoals[currentActivity] || weeklyGoals.default, currentRange, now);

  // Render stats cards
  statsGrid.innerHTML = "";
  const distanceMi = formatDistance(weekly.distanceMeters, labels.distanceUnit);
  const avgSpeed = currentActivity === "Run" ? formatPace(weekly.avgSpeed) : formatSpeed(weekly.avgSpeed);
  const unit = currentActivity === "Run" ? labels.unit : labels.unit;
  const movingTime = formatDuration(weekly.movingTime);

  statsGrid.appendChild(createStatCard("DISTANCE", distanceMi, labels.distanceUnit.toUpperCase()));
  statsGrid.appendChild(createStatCard(labels.primary.toUpperCase(), avgSpeed, unit));
  statsGrid.appendChild(createStatCard("TIME", movingTime, ""));

  // Render progress bars
  progressBars.innerHTML = "";
  const distanceProgress = calculateWeeklyProgress(weekly.distanceMeters, goal.distance);
  const timeProgress = calculateWeeklyProgress(weekly.movingTime, goal.time);

  progressBars.appendChild(createProgressBar(distanceProgress, `DISTANCE GOAL (${formatDistance(goal.distance, labels.distanceUnit)} ${labels.distanceUnit.toUpperCase()})`));
  progressBars.appendChild(createProgressBar(timeProgress, `TIME GOAL (${formatDuration(goal.time)})`));

  // Render group rides
  renderGroupRides(groupEvents);
}

function renderGroupRides(groupEvents) {
  groupRidesList.innerHTML = "";

  // Flatten all group events from all clubs
  const allEvents = [];
  for (const [clubId, events] of Object.entries(groupEvents)) {
    for (const event of events) {
      if (event.upcoming_occurrences && event.upcoming_occurrences.length > 0) {
        allEvents.push({ ...event, clubId });
      }
    }
  }

  // Sort by first upcoming occurrence
  allEvents.sort((a, b) => new Date(a.upcoming_occurrences[0]) - new Date(b.upcoming_occurrences[0]));

  if (allEvents.length === 0) {
    groupRidesList.innerHTML = '<div class="loading-row">No upcoming group rides</div>';
    return;
  }

  for (const event of allEvents) {
    groupRidesList.appendChild(createGroupEventCard(event));
  }
}

function updateFitnessBoard(data) {
  if (!data) return;

  const stale = data.stale || Date.now() - new Date(data.updatedAt).getTime() > STALE_THRESHOLD_MS;
  if (staleBadge) staleBadge.hidden = !stale;

  if (data.updatedAt) {
    const dt = new Date(data.updatedAt);
    if (updatedEl) {
      updatedEl.textContent = `UPDATED ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    }
  }

  renderFitnessData(data);
}

async function pollFitness() {
  const data = await fetchFitnessData();
  if (data) {
    updateFitnessBoard(data);
  }
}

// Tab switching
for (const tab of fitnessTabs) {
  tab.addEventListener("click", () => showFitnessTab(tab.dataset.activity));
}
for (const tab of rangeTabs) {
  tab.addEventListener("click", () => showFitnessRange(tab.dataset.range));
}

// Initialize
updateFitnessClock();
setInterval(updateFitnessClock, 1000);
pollFitness();
pollIntervalId = setInterval(pollFitness, POLL_INTERVAL_MS);

// Expose for testing
window.__fitnessCard = { pollFitness, updateFitnessBoard, renderFitnessData, showFitnessTab, showFitnessRange };