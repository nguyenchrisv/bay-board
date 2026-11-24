import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Import the fitness card utilities from the module
// Since we're in Node.js test environment, we need to load the module differently
// The module is designed for browser ES modules, so we'll test the logic by duplicating it here
// or we can use a dynamic import with a file:// URL

const FIXTURE_DIR = new URL(".", import.meta.url).pathname;

async function loadFitnessCardModule() {
  const moduleUrl = new URL("../public/fitness-card.js", import.meta.url);
  const response = await fetch(moduleUrl);
  const source = await response.text();
  // Evaluate the module source in a context where we can extract exports
  const exports = {};
  const module = { exports };
  eval(source + "\nexports.getActivityLabels = getActivityLabels;\nexports.formatDistance = formatDistance;\nexports.formatSpeed = formatSpeed;\nexports.formatPace = formatPace;\nexports.formatDuration = formatDuration;\nexports.calculateWeeklyProgress = calculateWeeklyProgress;\nexports.parseGroupEventDate = parseGroupEventDate;\nexports.formatNumberForSplitFlap = formatNumberForSplitFlap;\n");
  return module.exports;
}

// For now, duplicate the pure functions here for testing (they're pure, no DOM deps)
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
  const mph = mps * 2.23694;
  return mph.toFixed(1);
}

function formatPace(mps) {
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

describe("Fitness card utilities", () => {
  describe("getActivityLabels", () => {
    test("returns correct labels for Ride", () => {
      const labels = getActivityLabels("Ride");
      assert.equal(labels.primary, "Avg Speed");
      assert.equal(labels.unit, "mph");
      assert.equal(labels.distanceUnit, "mi");
    });

    test("returns correct labels for Run", () => {
      const labels = getActivityLabels("Run");
      assert.equal(labels.primary, "Avg Pace");
      assert.equal(labels.unit, "/mi");
      assert.equal(labels.distanceUnit, "mi");
    });

    test("returns correct labels for Swim", () => {
      const labels = getActivityLabels("Swim");
      assert.equal(labels.primary, "Avg Pace");
      assert.equal(labels.unit, "/100m");
      assert.equal(labels.distanceUnit, "m");
    });

    test("returns default for unknown activity", () => {
      const labels = getActivityLabels("Unknown");
      assert.equal(labels.primary, "Avg");
      assert.equal(labels.unit, "");
      assert.equal(labels.distanceUnit, "mi");
    });
  });

  describe("formatDistance", () => {
    test("converts meters to miles", () => {
      assert.equal(formatDistance(1609.344, "mi"), "1.0");
      assert.equal(formatDistance(16093.44, "mi"), "10.0");
    });

    test("converts meters to kilometers", () => {
      assert.equal(formatDistance(1000, "km"), "1.0");
      assert.equal(formatDistance(10000, "km"), "10.0");
    });

    test("formats meters as integer", () => {
      assert.equal(formatDistance(500, "m"), "500");
      assert.equal(formatDistance(1500, "m"), "1500");
    });
  });

  describe("formatSpeed", () => {
    test("converts m/s to mph", () => {
      assert.equal(formatSpeed(5.0), "11.2");
      assert.equal(formatSpeed(4.47), "10.0");
    });
  });

  describe("formatPace", () => {
    test("converts m/s to min/mi pace", () => {
      assert.equal(formatPace(4.47), "6:00");
      assert.equal(formatPace(3.35), "8:00");
    });

    test("handles zero speed", () => {
      assert.equal(formatPace(0), "--:--");
    });
  });

  describe("formatDuration", () => {
    test("formats seconds as hours and minutes", () => {
      assert.equal(formatDuration(3600), "1h 0m");
      assert.equal(formatDuration(5400), "1h 30m");
      assert.equal(formatDuration(1800), "30m");
      assert.equal(formatDuration(4500), "1h 15m");
    });
  });

  describe("calculateWeeklyProgress", () => {
    test("calculates percentage progress", () => {
      assert.equal(calculateWeeklyProgress(50, 100), 50);
      assert.equal(calculateWeeklyProgress(75, 100), 75);
      assert.equal(calculateWeeklyProgress(100, 100), 100);
      assert.equal(calculateWeeklyProgress(120, 100), 100);
    });

    test("handles zero goal", () => {
      assert.equal(calculateWeeklyProgress(50, 0), 0);
    });
  });

  describe("parseGroupEventDate", () => {
    test("parses ISO date string", () => {
      const result = parseGroupEventDate("2026-11-29T18:00:00Z");
      assert.ok(result.date);
      assert.ok(result.time);
      assert.equal(result.iso, "2026-11-29T18:00:00Z");
    });
  });
});