import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Pure functions for wall view - will be extracted to a module

const WALL_MODES = ["bart", "ferry", "bus", "fitness"];

function isWallMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("wall") === "square";
}

function getWallModes(config) {
  const modes = ["bart"];
  if (config.ferry?.stops?.length > 0) modes.push("ferry");
  if (config.bus?.stops?.length > 0) modes.push("bus");
  if (config.strava?.enabled) modes.push("fitness");
  return modes;
}

function getNextModeIndex(currentIndex, modes) {
  return (currentIndex + 1) % modes.length;
}

function formatWallDestination(destination, maxTiles = 16) {
  return String(destination || "").slice(0, maxTiles);
}

function calculateTileSize(viewportWidth, viewportHeight, tileCount, gap = 2) {
  // Calculate tile size to fit exactly in viewport
  const availableWidth = viewportWidth - (tileCount - 1) * gap;
  return Math.floor(availableWidth / tileCount);
}

function calculateRowsForViewport(viewportHeight, tileHeight, headerHeight = 60, gap = 8) {
  const availableHeight = viewportHeight - headerHeight - gap;
  const rows = Math.floor(availableHeight / tileHeight);
  // Cap at 5 rows for wall view readability
  return Math.min(rows, 5);
}

describe("Wall view utilities", () => {
  describe("isWallMode", () => {
    test("returns true for ?wall=square", () => {
      // Mock window.location
      global.window = { location: { search: "?wall=square" } };
      assert.equal(isWallMode(), true);
    });

    test("returns false for no wall param", () => {
      global.window = { location: { search: "" } };
      assert.equal(isWallMode(), false);
    });

    test("returns false for other wall values", () => {
      global.window = { location: { search: "?wall=landscape" } };
      assert.equal(isWallMode(), false);
    });
  });

  describe("getWallModes", () => {
    test("returns only bart when others unconfigured", () => {
      const config = { bart: { stations: ["FTVL"] }, ferry: { stops: [] }, bus: { stops: [] } };
      const modes = getWallModes(config);
      assert.deepEqual(modes, ["bart"]);
    });

    test("includes ferry when configured", () => {
      const config = { bart: { stations: ["FTVL"] }, ferry: { stops: ["7206"] }, bus: { stops: [] } };
      const modes = getWallModes(config);
      assert.deepEqual(modes, ["bart", "ferry"]);
    });

    test("includes bus when configured", () => {
      const config = { bart: { stations: ["FTVL"] }, ferry: { stops: [] }, bus: { stops: ["57727"] } };
      const modes = getWallModes(config);
      assert.deepEqual(modes, ["bart", "bus"]);
    });

    test("includes fitness when strava enabled", () => {
      const config = { bart: { stations: ["FTVL"] }, ferry: { stops: [] }, bus: { stops: [] }, strava: { enabled: true } };
      const modes = getWallModes(config);
      assert.deepEqual(modes, ["bart", "fitness"]);
    });
  });

  describe("getNextModeIndex", () => {
    test("cycles through modes", () => {
      const modes = ["bart", "ferry", "bus"];
      assert.equal(getNextModeIndex(0, modes), 1);
      assert.equal(getNextModeIndex(1, modes), 2);
      assert.equal(getNextModeIndex(2, modes), 0);
    });

    test("works with single mode", () => {
      const modes = ["bart"];
      assert.equal(getNextModeIndex(0, modes), 0);
    });
  });

  describe("formatWallDestination", () => {
    test("truncates long destinations", () => {
      assert.equal(formatWallDestination("San Francisco Ferry Building", 16), "San Francisco Fe");
      assert.equal(formatWallDestination("Short", 16), "Short");
    });
  });

  describe("calculateTileSize", () => {
    test("calculates tile size for 720px viewport", () => {
      // 16 tiles, 2px gaps = 14 tiles * 2 = 28px gaps, 720 - 28 = 692 / 16 = 43.25 -> 43
      assert.equal(calculateTileSize(720, 720, 16, 2), 43);
    });

    test("calculates tile size for 12 tiles", () => {
      // 12 tiles, 2px gaps = 11 * 2 = 22px gaps, 720 - 22 = 698 / 12 = 58.16 -> 58
      assert.equal(calculateTileSize(720, 720, 12, 2), 58);
    });
  });

  describe("calculateRowsForViewport", () => {
    test("calculates rows for 720px height", () => {
      // tileHeight ~50, header 60, gap 8 = 720 - 68 = 652 / 50 = 13 rows
      const rows = calculateRowsForViewport(720, 50, 60, 8);
      assert.ok(rows >= 4 && rows <= 5); // Should fit 4-5 rows
    });
  });
});