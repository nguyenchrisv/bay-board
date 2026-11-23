import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { createPoller, resetPoller } from "../src/poller.js";
import { setTestConfig, setTestPoller, setTestStravaData, clearTestOverrides } from "../src/server.js";

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

describe("API /api/strava endpoint", () => {
  before(async () => {
    resetPoller();
    clearTestOverrides();

    // Set up test config
    setTestConfig(createTestConfig());

    // Load Strava fixtures
    const athlete = await loadFixture("strava-athlete.json");
    const stats = await loadFixture("strava-athlete-stats.json");
    const activities = await loadFixture("strava-activities.json");
    const clubs = await loadFixture("strava-clubs.json");
    const groupEvents9001 = await loadFixture("strava-club-9001-group-events.json");
    const groupEvents9002 = await loadFixture("strava-club-9002-group-events.json");
    const groupEvents9003 = await loadFixture("strava-club-9003-group-events.json");
    const groupEvents9004 = await loadFixture("strava-club-9004-group-events.json");

    const testStravaData = {
      athlete,
      stats,
      activities,
      clubs,
      groupEvents: {
        "9001": groupEvents9001,
        "9002": groupEvents9002,
        "9003": groupEvents9003,
        "9004": groupEvents9004,
      },
      updatedAt: new Date().toISOString(),
    };

    setTestStravaData(testStravaData);

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

  test("GET /api/strava returns athlete, stats, activities, clubs, and group events", async () => {
    const res = await fetch(`${baseUrl}/api/strava`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.athlete);
    assert.equal(body.athlete.id, 1);
    assert.equal(body.athlete.firstname, "Test");
    assert.equal(body.athlete.lastname, "Rider");
    assert.ok(Array.isArray(body.athlete.clubs));
    assert.equal(body.athlete.clubs.length, 4);

    assert.ok(body.stats);
    assert.ok(body.stats.recent_ride_totals);
    assert.ok(body.stats.all_ride_totals);

    assert.ok(Array.isArray(body.activities));
    assert.ok(body.activities.length > 0);
    // Check activity structure
    const activity = body.activities[0];
    assert.ok(activity.id);
    assert.ok(activity.name);
    assert.ok(activity.type);
    assert.ok(activity.distance);
    assert.ok(activity.moving_time);
    assert.ok(activity.average_speed);

    assert.ok(Array.isArray(body.clubs));
    assert.equal(body.clubs.length, 4);

    assert.ok(body.groupEvents);
    assert.ok(body.groupEvents["9003"]);
    assert.equal(body.groupEvents["9003"].length, 1);
    const event = body.groupEvents["9003"][0];
    assert.equal(event.title, "Test group ride 1");
    assert.equal(event.activity_type, "Run");
    assert.ok(event.upcoming_occurrences);
  });

  test("GET /api/strava includes updatedAt timestamp", async () => {
    const res = await fetch(`${baseUrl}/api/strava`);
    const body = await res.json();
    assert.ok(body.updatedAt);
    // Should be valid ISO string
    const date = new Date(body.updatedAt);
    assert.ok(!isNaN(date.getTime()));
  });
});