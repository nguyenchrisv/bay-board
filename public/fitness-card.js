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
} from "./fitness-card-utils.js";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour - Strava API limited to 1 call/hour
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

const fitnessBoard = document.querySelector('section.board[data-mode="fitness"]');
const fitnessTabs = document.querySelectorAll('.fitness-tabs [role="tab"]');
const statsGrid = document.getElementById('fitness-stats');
const progressBars = document.getElementById('fitness-progress-bars');
const groupRidesList = document.getElementById('group-rides-list');
const updatedEl = fitnessBoard?.querySelector('.updated');
const staleBadge = fitnessBoard?.querySelector('.badge.stale');

let currentActivity = "Ride";
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

function computeWeeklyDistance(activities, activityType) {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let totalMeters = 0;
  let totalMovingTime = 0;
  let count = 0;
  let totalSpeed = 0;

  for (const activity of activities) {
    if (activity.sport_type !== activityType && activity.type !== activityType) continue;
    const startTime = new Date(activity.start_date).getTime();
    if (startTime < oneWeekAgo) continue;

    totalMeters += activity.distance || 0;
    totalMovingTime += activity.moving_time || 0;
    count++;
    if (activity.average_speed) totalSpeed += activity.average_speed;
  }

  return {
    distanceMeters: totalMeters,
    movingTime: totalMovingTime,
    count,
    avgSpeed: count > 0 ? totalSpeed / count : 0,
  };
}

function computeYTDDistance(activities, activityType) {
  const yearStart = new Date();
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);
  const yearStartTime = yearStart.getTime();

  let totalMeters = 0;
  let count = 0;

  for (const activity of activities) {
    if (activity.sport_type !== activityType && activity.type !== activityType) continue;
    const startTime = new Date(activity.start_date).getTime();
    if (startTime < yearStartTime) continue;

    totalMeters += activity.distance || 0;
    count++;
  }

  return { distanceMeters: totalMeters, count };
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

  // Get weekly stats for current activity type
  const weekly = computeWeeklyDistance(activities, currentActivity);
  const ytd = computeYTDDistance(activities, currentActivity);
  const labels = getActivityLabels(currentActivity);

  // Weekly goals (hardcoded for now, could come from config)
  const weeklyGoals = {
    Ride: { distance: 160934.4, time: 3 * 3600 }, // 100 miles, 3 hours
    Run: { distance: 32186.88, time: 2 * 3600 }, // 20 miles, 2 hours
    Swim: { distance: 5000, time: 2 * 3600 }, // 5km, 2 hours
    default: { distance: 16093.44, time: 3600 }, // 10 miles, 1 hour
  };
  const goal = weeklyGoals[currentActivity] || weeklyGoals.default;

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

// Initialize
updateFitnessClock();
setInterval(updateFitnessClock, 1000);
pollFitness();
pollIntervalId = setInterval(pollFitness, POLL_INTERVAL_MS);

// Expose for testing
window.__fitnessCard = { pollFitness, updateFitnessBoard, renderFitnessData, showFitnessTab };