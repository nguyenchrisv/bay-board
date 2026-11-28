// Layout editor model tests
// Tests for the layout state management (reorder, resize, hide, persistence, invalid data, new tile)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Import the layout model (works in Node via module.exports fallback)
import { LayoutModel } from "../public/layout-model.js";

const DEFAULT_TILES = [
  { id: "bart", title: "BART", width: "full" },
  { id: "ferry", title: "Ferry", width: "half" },
  { id: "bus", title: "Bus", width: "half" },
  { id: "fitness", title: "Fitness", width: "full" },
];

describe("LayoutModel", () => {
  let model;
  let storage;

  beforeEach(() => {
    // Mock localStorage
    storage = new Map();
    global.localStorage = {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
    };
    model = new LayoutModel({ defaultTiles: DEFAULT_TILES });
  });

  afterEach(() => {
    delete global.localStorage;
  });

  describe("initialization", () => {
    it("starts with default tiles when no saved layout", () => {
      const layout = model.getLayout();
      assert.deepEqual(layout, DEFAULT_TILES.map(t => ({ ...t, hidden: false })));
    });

    it("loads valid saved layout from localStorage", () => {
      const saved = JSON.stringify([
        { id: "ferry", width: "full", hidden: false },
        { id: "bart", width: "half", hidden: false },
        { id: "fitness", width: "full", hidden: false },
        { id: "bus", width: "half", hidden: true },
      ]);
      storage.set("bayboard:layout", saved);
      const model2 = new LayoutModel({ defaultTiles: DEFAULT_TILES });
      const layout = model2.getLayout();
      assert.equal(layout[0].id, "ferry");
      assert.equal(layout[0].width, "full");
      assert.equal(layout[3].hidden, true);
    });

    it("ignores unknown tile ids in saved layout", () => {
      const saved = JSON.stringify([
        { id: "unknown", width: "full", hidden: false },
        { id: "bart", width: "half", hidden: false },
      ]);
      storage.set("bayboard:layout", saved);
      const model2 = new LayoutModel({ defaultTiles: DEFAULT_TILES });
      const layout = model2.getLayout();
      // unknown tile filtered out, bart kept, missing defaults (ferry, bus, fitness) added
      assert.equal(layout.length, 4);
      const ids = layout.map(t => t.id);
      assert.ok(ids.includes("bart"));
      assert.ok(ids.includes("ferry"));
      assert.ok(ids.includes("bus"));
      assert.ok(ids.includes("fitness"));
      assert.ok(!ids.includes("unknown"));
    });

    it("falls back to default when localStorage throws", () => {
      global.localStorage.getItem = () => { throw new Error("storage full"); };
      const model2 = new LayoutModel({ defaultTiles: DEFAULT_TILES });
      const layout = model2.getLayout();
      assert.deepEqual(layout, DEFAULT_TILES.map(t => ({ ...t, hidden: false })));
    });

    it("falls back to default when saved data is invalid JSON", () => {
      storage.set("bayboard:layout", "not-json");
      const model2 = new LayoutModel({ defaultTiles: DEFAULT_TILES });
      const layout = model2.getLayout();
      assert.deepEqual(layout, DEFAULT_TILES.map(t => ({ ...t, hidden: false })));
    });

    it("falls back to default when saved data has wrong shape", () => {
      storage.set("bayboard:layout", JSON.stringify({ not: "array" }));
      const model2 = new LayoutModel({ defaultTiles: DEFAULT_TILES });
      const layout = model2.getLayout();
      assert.deepEqual(layout, DEFAULT_TILES.map(t => ({ ...t, hidden: false })));
    });

    it("includes new tile ids from registry that aren't in saved layout", () => {
      const saved = JSON.stringify([
        { id: "bart", width: "half", hidden: false },
        { id: "ferry", width: "half", hidden: false },
      ]);
      storage.set("bayboard:layout", saved);
      const model2 = new LayoutModel({
        defaultTiles: DEFAULT_TILES,
        tileRegistry: { bambu: { title: "Bambu", defaultWidth: "half" } },
      });
      const layout = model2.getLayout();
      // Should have bart, ferry from saved + fitness, bus, bambu from defaults
      const ids = layout.map(t => t.id);
      assert.ok(ids.includes("bart"));
      assert.ok(ids.includes("ferry"));
      assert.ok(ids.includes("fitness"));
      assert.ok(ids.includes("bus"));
      assert.ok(ids.includes("bambu"));
    });
  });

  describe("reorder", () => {
    it("moves tile earlier in the list", () => {
      model.moveTile("fitness", 0); // move to first
      const layout = model.getLayout();
      assert.equal(layout[0].id, "fitness");
      assert.equal(layout[1].id, "bart");
    });

    it("moves tile later in the list", () => {
      model.moveTile("bart", 3); // move to last
      const layout = model.getLayout();
      assert.equal(layout[3].id, "bart");
    });

    it("clamps index to valid range", () => {
      model.moveTile("bart", -5); // should go to first
      assert.equal(model.getLayout()[0].id, "bart");
      model.moveTile("bart", 100); // should go to last
      assert.equal(model.getLayout()[3].id, "bart");
    });

    it("does nothing for unknown tile id", () => {
      model.moveTile("unknown", 0);
      const layout = model.getLayout();
      assert.deepEqual(layout, DEFAULT_TILES.map(t => ({ ...t, hidden: false })));
    });

    it("persists reorder to localStorage", () => {
      model.moveTile("fitness", 0);
      const saved = JSON.parse(global.localStorage.getItem("bayboard:layout"));
      assert.equal(saved[0].id, "fitness");
    });
  });

  describe("resize", () => {
    it("toggles width between half and full", () => {
      const tile = model.getLayout().find(t => t.id === "bart");
      assert.equal(tile.width, "full");
      model.toggleWidth("bart");
      assert.equal(model.getLayout().find(t => t.id === "bart").width, "half");
      model.toggleWidth("bart");
      assert.equal(model.getLayout().find(t => t.id === "bart").width, "full");
    });

    it("does nothing for unknown tile id", () => {
      model.toggleWidth("unknown");
      assert.equal(model.getLayout().find(t => t.id === "bart").width, "full");
    });

    it("persists resize to localStorage", () => {
      model.toggleWidth("bart");
      const saved = JSON.parse(global.localStorage.getItem("bayboard:layout"));
      assert.equal(saved.find(t => t.id === "bart").width, "half");
    });
  });

  describe("hide/show", () => {
    it("hides a tile", () => {
      model.setHidden("bart", true);
      assert.equal(model.getLayout().find(t => t.id === "bart").hidden, true);
    });

    it("shows a hidden tile", () => {
      model.setHidden("bart", true);
      model.setHidden("bart", false);
      assert.equal(model.getLayout().find(t => t.id === "bart").hidden, false);
    });

    it("does nothing for unknown tile id", () => {
      model.setHidden("unknown", true);
      assert.equal(model.getLayout().find(t => t.id === "bart").hidden, false);
    });

    it("persists hide/show to localStorage", () => {
      model.setHidden("bart", true);
      const saved = JSON.parse(global.localStorage.getItem("bayboard:layout"));
      assert.equal(saved.find(t => t.id === "bart").hidden, true);
    });
  });

  describe("reset", () => {
    it("restores default layout", () => {
      model.moveTile("fitness", 0);
      model.toggleWidth("bart");
      model.setHidden("ferry", true);
      model.reset();
      const layout = model.getLayout();
      assert.deepEqual(layout, DEFAULT_TILES.map(t => ({ ...t, hidden: false })));
    });

    it("clears localStorage", () => {
      model.moveTile("fitness", 0);
      model.reset();
      assert.equal(global.localStorage.getItem("bayboard:layout"), null);
    });
  });

  describe("tile registry", () => {
    it("provides title and default width for registered tiles", () => {
      const model2 = new LayoutModel({
        defaultTiles: DEFAULT_TILES,
        tileRegistry: { bambu: { title: "Bambu Lab", defaultWidth: "half" } },
      });
      const registry = model2.getTileRegistry();
      assert.equal(registry.bambu.title, "Bambu Lab");
      assert.equal(registry.bambu.defaultWidth, "half");
    });

    it("includes default tiles in registry", () => {
      const model2 = new LayoutModel({ defaultTiles: DEFAULT_TILES });
      const registry = model2.getTileRegistry();
      assert.ok(registry.bart);
      assert.ok(registry.ferry);
      assert.ok(registry.bus);
      assert.ok(registry.fitness);
    });
  });
});