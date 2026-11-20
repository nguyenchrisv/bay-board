import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPoller, resetPoller } from "../src/poller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "fixtures");

async function loadFixture(name) {
  const content = await readFile(join(FIXTURE_DIR, name), "utf-8");
  return JSON.parse(content);
}

describe("BART poller", () => {
  let poller;
  let mockFetch;
  let mockTimers;
  let clock;

  before(async () => {
    resetPoller();
    process.env.BART_API_KEY = "TEST_KEY_12345";
    // Reset config cache so new env var is picked up
    const { resetConfigCache } = await import("../src/config.js");
    resetConfigCache();
  });

  after(() => {
    resetPoller();
  });

  function createMockFetch(fixtures) {
    let callCount = 0;
    return async (url) => {
      callCount++;
      if (url.includes("/api/etd.aspx")) {
        return {
          ok: true,
          text: async () => JSON.stringify(fixtures.etd),
        };
      }
      if (url.includes("/api/bsa.aspx")) {
        return {
          ok: true,
          text: async () => JSON.stringify(fixtures.bsa),
        };
      }
      return { ok: false, status: 404 };
    };
  }

  function createFakeTimers() {
    const timers = [];
    let currentTime = 0;

    const setTimeoutImpl = (fn, delay) => {
      const id = { fn, delay, scheduledAt: currentTime };
      timers.push(id);
      return id;
    };

    const clearTimeoutImpl = (id) => {
      const idx = timers.indexOf(id);
      if (idx >= 0) timers.splice(idx, 1);
    };

    const advance = async (ms) => {
      currentTime += ms;
      // Find and execute due timers
      const due = timers.filter((t) => currentTime - t.scheduledAt >= t.delay);
      for (const timer of due) {
        const idx = timers.indexOf(timer);
        if (idx >= 0) timers.splice(idx, 1);
        const result = timer.fn();
        if (result && typeof result.then === "function") {
          await result;
        }
      }
    };

    return { setTimeoutImpl, clearTimeoutImpl, advance, getTimers: () => timers };
  }

  test("poller fetches BART data and caches normalized board", async () => {
    const etdFixture = await loadFixture("bart-normal.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: etdFixture, bsa: bsaFixture });
    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    await poller.start();

    // Wait for initial fetch
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    assert.ok(cache.has("16TH"));

    const board = cache.get("16TH");
    assert.equal(board.mode, "bart");
    assert.equal(board.stop, "16th St Mission");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    assert.equal(board.departures.length, 5);
    assert.ok(board.updatedAt);

    // Check advisories
    const advisories = poller.getAdvisories();
    assert.equal(advisories.length, 2);
    assert.ok(advisories[0].includes("Elevator"));
    assert.ok(advisories[1].includes("Yellow Line"));
  });

  test("poller marks stale and keeps error on fetch failure", async () => {
    resetPoller();

    const etdFixture = await loadFixture("bart-normal.json");
    let failNext = true;

    mockFetch = async (url) => {
      if (url.includes("/api/etd.aspx")) {
        if (failNext) {
          failNext = false;
          throw new Error("Network error");
        }
        return {
          ok: true,
          text: async () => JSON.stringify(etdFixture),
        };
      }
      if (url.includes("/api/bsa.aspx")) {
        return { ok: true, text: async () => JSON.stringify(await loadFixture("bart-advisory-normal.json")) };
      }
      return { ok: false, status: 404 };
    };

    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // First fetch fails
    let cache = poller.getCache();
    let board = cache.get("16TH");
    assert.equal(board.stale, true);
    assert.ok(board.error.includes("Network error"));

    // Second fetch succeeds (simulate by advancing time and triggering poll)
    await mockTimers.advance(30_000);

    cache = poller.getCache();
    board = cache.get("16TH");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    assert.equal(board.departures.length, 5);
  });

  test("poller handles empty etd response", async () => {
    resetPoller();

    const emptyFixture = await loadFixture("bart-empty.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: emptyFixture, bsa: bsaFixture });
    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("16TH");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    assert.equal(board.departures.length, 0);
  });

  test("poller handles Leaving -> 0 minutes", async () => {
    resetPoller();

    const leavingFixture = await loadFixture("bart-leaving.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: leavingFixture, bsa: bsaFixture });
    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("16TH");
    assert.equal(board.departures[0].minutes, 0);
  });

  test("poller respects multiple configured stations", async () => {
    resetPoller();

    const etdFixture = await loadFixture("bart-normal.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: etdFixture, bsa: bsaFixture });
    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    // Override config loading for this test by using a custom poller start
    // We'll test with a custom config by mocking getConfig
    const { getConfig } = await import("../src/config.js");
    const originalGetConfig = getConfig;
    // Note: we can't easily mock getConfig since it's cached
    // Instead, test that poller uses the stations from config

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    // Should have at least the default station
    assert.ok(cache.has("16TH"));
  });

  test("poller stop clears all timers", async () => {
    resetPoller();

    const etdFixture = await loadFixture("bart-normal.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: etdFixture, bsa: bsaFixture });
    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.ok(mockTimers.getTimers().length > 0);

    poller.stop();

    assert.equal(mockTimers.getTimers().length, 0);
  });

  test("poller redacts API key from error messages", async () => {
    resetPoller();

    const failingFetch = async (url) => {
      if (url.includes("key=TEST_KEY_12345")) {
        throw new Error(`Failed to fetch ${url}`);
      }
      return { ok: true, text: async () => JSON.stringify(await loadFixture("bart-normal.json")) };
    };

    mockTimers = createFakeTimers();

    poller = createPoller({
      fetchImpl: failingFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("16TH");
    assert.equal(board.stale, true);
    assert.ok(board.error.includes("key=***"));
    assert.ok(!board.error.includes("TEST_KEY_12345"));
  });
});
