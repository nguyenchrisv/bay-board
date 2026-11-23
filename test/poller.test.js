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
  return JSON.parse(content.replace(/^\uFEFF/, ""));
}

function createTestConfig() {
  return async () => ({
    bartApiKey: "TEST_KEY_12345",
    api511Key: "TEST_511_KEY",
    bart: { stations: ["FTVL"] },
    ferry: { operator: "SB", stops: ["7206"] },
    bus: { operator: "AC", stops: ["57727", "57780"], lines: ["O"] },
    budget511PerHour: 55,
  });
}

function createMockFetch(fixtures) {
  return async (url) => {
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
    if (url.includes("/transit/StopMonitoring")) {
      return {
        ok: true,
        arrayBuffer: async () => {
          const text = JSON.stringify(fixtures.sf511);
          return new TextEncoder().encode(text).buffer;
        },
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

describe("BART poller", () => {
  let poller;
  let mockFetch;
  let mockTimers;

  before(() => {
    resetPoller();
  });

  after(() => {
    resetPoller();
  });

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
      getConfig: createTestConfig(),
    });

    await poller.start();

    // Wait for initial fetch
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    assert.ok(cache.has("bart:FTVL"));

    const board = cache.get("bart:FTVL");
    assert.equal(board.mode, "bart");
    assert.equal(board.stop, "Fruitvale");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    assert.equal(board.departures.length, 12);
    assert.ok(board.updatedAt);

    // Check advisories
    const advisories = poller.getAdvisories();
    assert.equal(advisories.length, 1);
    assert.equal(advisories[0], "No advisories issued.");
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
      getConfig: createTestConfig(),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // First fetch fails
    let cache = poller.getCache();
    let board = cache.get("bart:FTVL");
    assert.equal(board.stale, true);
    assert.ok(board.error.includes("Network error"));

    // Second fetch succeeds (simulate by advancing time and triggering poll)
    await mockTimers.advance(30_000);

    cache = poller.getCache();
    board = cache.get("bart:FTVL");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    assert.equal(board.departures.length, 12);
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
      getConfig: createTestConfig(),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("bart:FTVL");
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
      getConfig: createTestConfig(),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("bart:FTVL");
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
      getConfig: async () => ({
        bartApiKey: "TEST_KEY_12345",
        bart: { stations: ["FTVL", "12TH"] },
      }),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    // Should have both stations
    assert.ok(cache.has("bart:FTVL"));
    assert.ok(cache.has("bart:12TH"));
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
      getConfig: createTestConfig(),
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
      if (url.includes("TEST_KEY_12345")) {
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
      getConfig: createTestConfig(),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("bart:FTVL");
    assert.equal(board.stale, true);
    assert.ok(board.error.includes("key=***"));
    assert.ok(!board.error.includes("TEST_KEY_12345"));
  });
});

describe("511 poller with budget", () => {
  let poller;
  let mockFetch;
  let mockTimers;
  let fakeNow;

  function createBudgetTestConfig(budget = 55) {
    return async () => ({
      bartApiKey: "TEST_KEY_12345",
      api511Key: "TEST_511_KEY",
      bart: { stations: [] },
      ferry: { operator: "SB", stops: ["7206"] },
      bus: { operator: "AC", stops: ["57727"], lines: ["N"] },
      budget511PerHour: budget,
    });
  }

  before(() => {
    resetPoller();
  });

  after(() => {
    resetPoller();
  });

  test("poller fetches 511 ferry data and caches normalized board", async () => {
    resetPoller();

    const sf511Fixture = await loadFixture("sf511-stopmonitoring-recorded.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: null, bsa: bsaFixture, sf511: sf511Fixture });
    mockTimers = createFakeTimers();
    fakeNow = 0;
    const nowImpl = () => new Date(fakeNow);

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl,
      getConfig: createBudgetTestConfig(55),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    assert.ok(cache.has("ferry:7206"));

    const board = cache.get("ferry:7206");
    assert.equal(board.mode, "ferry");
    assert.equal(board.stop, "Harbor Bay Ferry Terminal");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    assert.equal(board.departures.length, 3);
    for (const dep of board.departures) {
      assert.equal(dep.color, "#0099cc"); // ferry blue
    }
  });

  test("poller fetches 511 bus data with line filter", async () => {
    resetPoller();

    const sf511Fixture = await loadFixture("sf511-stopmonitoring-recorded.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");

    mockFetch = createMockFetch({ etd: null, bsa: bsaFixture, sf511: sf511Fixture });
    mockTimers = createFakeTimers();
    fakeNow = 0;
    const nowImpl = () => new Date(fakeNow);

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl,
      getConfig: createBudgetTestConfig(55),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    assert.ok(cache.has("bus:57727"));

    const board = cache.get("bus:57727");
    assert.equal(board.mode, "bus");
    assert.equal(board.stop, "High St & Encinal Av (westbound)");
    assert.equal(board.stale, false);
    assert.equal(board.error, null);
    // The recorded response has three N/JUDAH departures.
    // LineRef ("N") is used for the chip instead of PublishedLineName ("JUDAH")
    assert.equal(board.departures.length, 3);
    for (const dep of board.departures) {
      assert.equal(dep.line, "N");
      assert.equal(dep.color, "#ff9933"); // AC Transit orange
      // No real platform data in SIRI StopMonitoring for 511
      assert.equal(dep.platform, "");
    }
  });

  test("511 budget blocks requests after exhaustion", async () => {
    resetPoller();

    const sf511Fixture = await loadFixture("sf511-stopmonitoring-recorded.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");
    const fixtures = { etd: null, bsa: bsaFixture, sf511: sf511Fixture };
    let requestCount = 0;
    mockFetch = async (url) => {
      if (url.includes("/transit/StopMonitoring")) requestCount++;
      return createMockFetch(fixtures)(url);
    };
    mockTimers = createFakeTimers();
    fakeNow = 0;
    const nowImpl = () => new Date(fakeNow);

    poller = createPoller({
      fetchImpl: mockFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl,
      getConfig: async () => ({
        bartApiKey: "",
        api511Key: "TEST_511_KEY",
        bart: { stations: [] },
        ferry: { operator: "SB", stops: ["7206"] },
        bus: { operator: "AC", stops: ["57727", "57780"], lines: ["O"] },
        budget511PerHour: 2,
      }),
    });

    await poller.start();

    assert.equal(requestCount, 2);
    const cache = poller.getCache();
    assert.equal(cache.get("ferry:7206").stale, false);
    assert.equal(cache.get("bus:57727").stale, false);
    assert.equal(cache.get("bus:57780").stale, true);
    assert.equal(cache.get("bus:57780").error, "No data yet");
  });

  test("511 budget respects rolling hour window (simulate 2 hours)", async () => {
    resetPoller();

    const sf511Fixture = await loadFixture("sf511-stopmonitoring-recorded.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");
    const fixtures = { etd: null, bsa: bsaFixture, sf511: sf511Fixture };
    const requestTimes = [];
    const countingFetch = async (url) => {
      if (url.includes("/transit/StopMonitoring")) requestTimes.push(fakeNow);
      return createMockFetch(fixtures)(url);
    };

    mockTimers = createFakeTimers();
    fakeNow = 0;
    const nowImpl = () => new Date(fakeNow);

    poller = createPoller({
      fetchImpl: countingFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl,
      getConfig: async () => ({
        bartApiKey: "",
        api511Key: "TEST_511_KEY",
        bart: { stations: [] },
        ferry: { operator: "SB", stops: ["7206"] },
        bus: { operator: "AC", stops: ["57727", "57780"], lines: ["O"] },
        budget511PerHour: 4,
      }),
    });

    await poller.start();
    assert.equal(requestTimes.length, 3);

    // Three stops share a budget of four. Only one request is allowed at 45m.
    fakeNow += 45 * 60 * 1000;
    await mockTimers.advance(45 * 60 * 1000);
    assert.equal(requestTimes.length, 4);

    // The initial three requests expire at 90m, allowing three more.
    fakeNow += 45 * 60 * 1000;
    await mockTimers.advance(45 * 60 * 1000);
    assert.equal(requestTimes.length, 7);

    // Reach two hours; the next scheduled cycle is at 135m.
    fakeNow += 30 * 60 * 1000;
    await mockTimers.advance(30 * 60 * 1000);
    assert.equal(requestTimes.length, 7);

    // Request counts only increase at request boundaries, so checking every
    // window ending at a request proves the maximum over every rolling hour.
    for (const end of requestTimes) {
      const count = requestTimes.filter((ts) => ts > end - 3_600_000 && ts <= end).length;
      assert.ok(count <= 4, `${count} requests in rolling hour ending at ${end}`);
    }
  });

  test("poller handles 511 fetch failure gracefully", async () => {
    resetPoller();

    let failNext = true;
    const failingFetch = async (url) => {
      if (url.includes("/transit/StopMonitoring")) {
        if (failNext) {
          failNext = false;
          throw new Error("511 network error");
        }
      }
      return createMockFetch({ etd: null, bsa: await loadFixture("bart-advisory-normal.json"), sf511: await loadFixture("sf511-stopmonitoring-recorded.json") })(url);
    };

    mockTimers = createFakeTimers();
    fakeNow = 0;
    const nowImpl = () => new Date(fakeNow);

    poller = createPoller({
      fetchImpl: failingFetch,
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl,
      getConfig: createBudgetTestConfig(55),
    });

    await poller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = poller.getCache();
    const board = cache.get("ferry:7206");
    // First fetch fails
    assert.equal(board.stale, true);
    assert.ok(board.error.includes("511 network error"));

    // Second fetch succeeds
    fakeNow += 200_000;
    await mockTimers.advance(200_000);

    const cache2 = poller.getCache();
    const board2 = cache2.get("ferry:7206");
    assert.equal(board2.stale, false);
    assert.equal(board2.error, null);
  });
});