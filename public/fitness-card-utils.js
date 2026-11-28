// Fitness card utilities: pure functions for formatting, labels, and calculations

const ACTIVITY_LABELS = {
  Ride: { primary: "Avg Speed", unit: "mph", distanceUnit: "mi" },
  Run: { primary: "Avg Pace", unit: "/mi", distanceUnit: "mi" },
  Swim: { primary: "Avg Pace", unit: "/100m", distanceUnit: "m" },
  Workout: { primary: "Avg Power", unit: "W", distanceUnit: "mi" },
  default: { primary: "Avg", unit: "", distanceUnit: "mi" },
};

function getActivityLabels(activityType) {
  return ACTIVITY_LABELS[activityType] || ACTIVITY_LABELS.default;
}

function formatDistance(meters, unit = "mi") {
  if (unit === "mi") {
    const miles = meters / 1609.344;
    return miles.toFixed(1);
  }
  if (unit === "km") {
    const km = meters / 1000;
    return km.toFixed(1);
  }
  if (unit === "m") {
    return Math.round(meters).toString();
  }
  return (meters / 1609.344).toFixed(1);
}

function formatSpeed(mps) {
  // m/s to mph
  const mph = mps * 2.23694;
  return mph.toFixed(1);
}

function formatPace(mps) {
  // m/s to min/mi
  if (mps <= 0) return "--:--";
  const secPerMi = 1609.344 / mps;
  const min = Math.floor(secPerMi / 60);
  const sec = Math.round(secPerMi % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function calculateWeeklyProgress(current, goal) {
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((current / goal) * 100));
}

function parseGroupEventDate(isoString) {
  const date = new Date(isoString);
  return {
    date: date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
    iso: isoString,
  };
}

// Split-flap style number formatting for animated tiles
function formatNumberForSplitFlap(num, decimals = 0) {
  if (decimals > 0) {
    return num.toFixed(decimals);
  }
  return Math.round(num).toString();
}

function createStatCard(label, value, unit, changed = false) {
  const card = document.createElement("div");
  card.className = "fitness-stat-card";
  if (changed) card.classList.add("updating");

  const labelEl = document.createElement("div");
  labelEl.className = "fitness-stat-label";
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueEl = document.createElement("div");
  valueEl.className = "fitness-stat-value";

  const valueContainer = document.createElement("span");
  valueContainer.className = "fitness-stat-value-inner";
  valueContainer.textContent = value;
  valueEl.appendChild(valueContainer);

  if (unit) {
    const unitEl = document.createElement("span");
    unitEl.className = "fitness-stat-unit";
    unitEl.textContent = unit;
    valueEl.appendChild(unitEl);
  }

  card.appendChild(valueEl);
  return card;
}

function createProgressBar(percentage, label) {
  const container = document.createElement("div");
  container.className = "fitness-progress-bar-container";

  const labelEl = document.createElement("div");
  labelEl.className = "fitness-progress-label";
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const barContainer = document.createElement("div");
  barContainer.className = "fitness-progress-bar";

  const bar = document.createElement("div");
  bar.className = "fitness-progress-fill";
  bar.style.width = `${percentage}%`;
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuenow", percentage);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-label", `${label}: ${percentage}%`);
  barContainer.appendChild(bar);

  container.appendChild(barContainer);

  const pctEl = document.createElement("div");
  pctEl.className = "fitness-progress-percent";
  pctEl.textContent = `${percentage}%`;
  container.appendChild(pctEl);

  return container;
}

function createGroupEventCard(event) {
  const card = document.createElement("div");
  card.className = "group-event-card";

  const title = document.createElement("h4");
  title.className = "group-event-title";
  title.textContent = event.title;
  card.appendChild(title);

  if (event.description) {
    const desc = document.createElement("p");
    desc.className = "group-event-description";
    desc.textContent = event.description;
    card.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "group-event-meta";

  const activityType = document.createElement("span");
  activityType.className = "group-event-activity";
  activityType.textContent = event.activity_type;
  meta.appendChild(activityType);

  const dateInfo = parseGroupEventDate(event.upcoming_occurrences[0]);
  const dateEl = document.createElement("time");
  dateEl.className = "group-event-date";
  dateEl.dateTime = event.upcoming_occurrences[0];
  dateEl.textContent = `${dateInfo.date} at ${dateInfo.time}`;
  meta.appendChild(dateEl);

  if (event.address) {
    const locEl = document.createElement("span");
    locEl.className = "group-event-location";
    locEl.textContent = event.address;
    meta.appendChild(locEl);
  }

  card.appendChild(meta);
  return card;
}

// ---- Time ranges (7D / 30D / 60D / 90D / YTD) ----
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = ["7", "30", "60", "90", "ytd"];

function rangeStart(range, nowMs = Date.now()) {
  if (range === "ytd") {
    const now = new Date(nowMs);
    return new Date(now.getFullYear(), 0, 1).getTime();
  }
  const days = Number(range) || 7;
  return nowMs - days * DAY_MS;
}

function rangeDays(range, nowMs = Date.now()) {
  return Math.max(1, (nowMs - rangeStart(range, nowMs)) / DAY_MS);
}

function rangeTitle(range) {
  return range === "ytd" ? "YEAR TO DATE" : `LAST ${Number(range) || 7} DAYS`;
}

function matchesType(activity, activityType) {
  return activity.sport_type === activityType || activity.type === activityType;
}

// Totals for one activity type since sinceMs. Average speed is total distance / total moving time.
function computeRangeTotals(activities, activityType, sinceMs) {
  let distanceMeters = 0;
  let movingTime = 0;
  let count = 0;
  for (const activity of activities || []) {
    if (!matchesType(activity, activityType)) continue;
    if (new Date(activity.start_date).getTime() < sinceMs) continue;
    distanceMeters += activity.distance || 0;
    movingTime += activity.moving_time || 0;
    count++;
  }
  return { distanceMeters, movingTime, count, avgSpeed: movingTime > 0 ? distanceMeters / movingTime : 0 };
}

// Weekly goal scaled to the length of the range.
function scaleGoal(weeklyGoal, range, nowMs = Date.now()) {
  const factor = rangeDays(range, nowMs) / 7;
  return { distance: weeklyGoal.distance * factor, time: weeklyGoal.time * factor };
}

// Activity types present in the data, most frequent first (max `limit`).
function activityTypesByCount(activities, limit = 4) {
  const counts = new Map();
  for (const a of activities || []) {
    const t = a.sport_type || a.type;
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

export {
  getActivityLabels,
  formatDistance,
  formatSpeed,
  formatPace,
  formatDuration,
  calculateWeeklyProgress,
  parseGroupEventDate,
  formatNumberForSplitFlap,
  createStatCard,
  createProgressBar,
  createGroupEventCard,
  RANGES,
  rangeStart,
  rangeDays,
  rangeTitle,
  computeRangeTotals,
  scaleGoal,
  activityTypesByCount,
};