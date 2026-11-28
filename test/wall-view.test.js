import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isWallMode,
  isTerminalWallMode,
  getWallModeType,
  getTerminalTheme,
  getWallModes,
  getNextModeIndex,
  formatWallDestination,
  calculateTileSize,
  calculateRowsForViewport,
} from "../public/wall-view-utils.js";

describe("Wall view utilities", () => {
  describe("isWallMode", () => {
    test("returns true for ?wall=square", () => {
      global.window = { location: { search: "?wall=square" } };
      assert.equal(isWallMode(), true);
    });

    test("returns true for ?wall=terminal", () => {
      global.window = { location: { search: "?wall=terminal" } };
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

  describe("isTerminalWallMode", () => {
    test("returns true for ?wall=terminal", () => {
      global.window = { location: { search: "?wall=terminal" } };
      assert.equal(isTerminalWallMode(), true);
    });

    test("returns false for ?wall=square", () => {
      global.window = { location: { search: "?wall=square" } };
      assert.equal(isTerminalWallMode(), false);
    });

    test("returns false for no wall param", () => {
      global.window = { location: { search: "" } };
      assert.equal(isTerminalWallMode(), false);
    });
  });

  describe("getWallModeType", () => {
    test("returns 'square' for ?wall=square", () => {
      global.window = { location: { search: "?wall=square" } };
      assert.equal(getWallModeType(), "square");
    });

    test("returns 'terminal' for ?wall=terminal", () => {
      global.window = { location: { search: "?wall=terminal" } };
      assert.equal(getWallModeType(), "terminal");
    });

    test("returns null for no wall param", () => {
      global.window = { location: { search: "" } };
      assert.equal(getWallModeType(), null);
    });
  });

  describe("getTerminalTheme", () => {
    // Mock matchMedia for these tests
    const mockMatchMedia = (matches) => {
      global.window = global.window || {};
      global.window.matchMedia = (query) => ({ matches });
    };

    test("returns explicit theme when provided", () => {
      global.window = { location: { search: "?wall=terminal&theme=dark" } };
      mockMatchMedia(false);
      assert.equal(getTerminalTheme(), "dark");
    });

    test("returns explicit theme: light", () => {
      global.window = { location: { search: "?wall=terminal&theme=light" } };
      mockMatchMedia(false);
      assert.equal(getTerminalTheme(), "light");
    });

    test("returns explicit theme: retro", () => {
      global.window = { location: { search: "?wall=terminal&theme=retro" } };
      mockMatchMedia(false);
      assert.equal(getTerminalTheme(), "retro");
    });

    test("falls back to prefers-color-scheme when no theme param", () => {
      global.window = { location: { search: "?wall=terminal" } };
      mockMatchMedia(true);
      assert.equal(getTerminalTheme(), "dark");
    });

    test("falls back to light when no theme param and prefers light", () => {
      global.window = { location: { search: "?wall=terminal" } };
      mockMatchMedia(false);
      assert.equal(getTerminalTheme(), "light");
    });

    test("ignores invalid theme values", () => {
      global.window = { location: { search: "?wall=terminal&theme=invalid" } };
      mockMatchMedia(false);
      assert.equal(getTerminalTheme(), "light");
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