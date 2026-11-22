import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { createPoller, resetPoller } from "../src/poller.js";
import { setTestConfig, setTestPoller, clearTestOverrides } from "../src/server.js";

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

let server;
let baseUrl;
let mockTimers;

async function startServer() {
  const mod = await import("../src/server.js");
  server = createServer(mod.handleRequest);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
}

async function stopServer() {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("API /api/board endpoints", () => {
  before(async () => {
    resetPoller();
    clearTestOverrides();

    // Set up test config
    setTestConfig(createTestConfig());

    // Create a test poller with fake fetch/timers
    const etdFixture = await loadFixture("bart-normal.json");
    const bsaFixture = await loadFixture("bart-advisory-normal.json");
    const sf511Fixture = await loadFixture("sf511-stopmonitoring-recorded.json");
    mockTimers = createFakeTimers();

    const testPoller = createPoller({
      fetchImpl: createMockFetch({ etd: etdFixture, bsa: bsaFixture, sf511: sf511Fixture }),
      setTimeoutImpl: mockTimers.setTimeoutImpl,
      clearTimeoutImpl: mockTimers.clearTimeoutImpl,
      nowImpl: () => new Date("2026-11-20T10:00:00Z"),
      getConfig: createTestConfig(),
    });

    await testPoller.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    setTestPoller(testPoller);
    await startServer();
  });

  after(async () => {
    await stopServer();
    resetPoller();
    clearTestOverrides();
  });

  test("GET /api/board returns all modes with BART data", async () => {
    const res = await fetch(`${baseUrl}/api/board`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.bart);
    assert.equal(body.bart.mode, "bart");
    assert.equal(body.bart.stop, "Fruitvale");
    assert.ok(body.ferry);
    assert.equal(body.ferry.mode, "ferry");
    assert.equal(body.ferry.unconfigured, false); // Now configured
    assert.ok(body.bus);
    assert.equal(body.bus.mode, "bus");
    assert.equal(body.bus.unconfigured, false); // Now configured
  });

  test("GET /api/board/bart returns BART board", async () => {
    const res = await fetch(`${baseUrl}/api/board/bart`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.bart);
    assert.equal(body.bart.mode, "bart");
    assert.equal(body.bart.stop, "Fruitvale");
    assert.ok(Array.isArray(body.bart.departures));
  });

  test("GET /api/board/ferry returns ferry board", async () => {
    const res = await fetch(`${baseUrl}/api/board/ferry`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.ferry);
    assert.equal(body.ferry.mode, "ferry");
    assert.equal(body.ferry.unconfigured, false);
    assert.ok(Array.isArray(body.ferry.departures));
  });

  test("GET /api/board/bus returns bus board", async () => {
    const res = await fetch(`${baseUrl}/api/board/bus`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.bus);
    assert.equal(body.bus.mode, "bus");
    assert.equal(body.bus.unconfigured, false);
    assert.ok(Array.isArray(body.bus.departures));
  });

  test("GET /api/board/unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/board/unknown`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Not found");
  });
});