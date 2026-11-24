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
};