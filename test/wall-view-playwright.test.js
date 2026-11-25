import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { createPoller, resetPoller } from "../src/poller.js";
import { setTestConfig, setTestPoller, clearTestOverrides, handleRequest } from "../src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "fixtures");

// Dynamically import Playwright; skip entire suite if not available
let chromium;
try {
  const playwright = await import("playwright");
  chromium = playwright.chromium;
} catch {
  // Playwright not installed - skip all tests in this suite
  describe.skip("Wall view Playwright screenshots (Playwright not available)", () => {
    test("skipped - Playwright not installed", () => {});
  });
  // Exit early if Playwright not available
  if (!chromium) {
    // Don't run the rest of this module
  }
}

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
    wallRotationMs: 15_000,
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
let browser;
let page;

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

async function startBrowser() {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 720, height: 720 } });
}

async function stopBrowser() {
  if (browser) {
    await browser.close();
  }
}

if (chromium) {
  describe("Wall view Playwright screenshots", () => {
    before(async () => {
      resetPoller();
      clearTestOverrides();

      setTestConfig(createTestConfig());

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
      await startBrowser();
    });

    after(async () => {
      await stopBrowser();
      await stopServer();
      resetPoller();
      clearTestOverrides();
    });

    test("wall view BART board renders at 720x720", async () => {
      await page.goto(`${baseUrl}/?wall=square`);
      
      await page.waitForSelector('.split-flap-tile', { timeout: 10000 });
      await page.waitForSelector('section.board[data-mode="bart"]:not([hidden])', { timeout: 5000 });

      // Take screenshot
      const screenshot = await page.screenshot({ path: "test-results/wall-bart.png" });
      assert.ok(screenshot.length > 0);

      // Verify no scrollbars
      const hasScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth ||
               document.documentElement.scrollHeight > document.documentElement.clientHeight;
      });
      assert.equal(hasScroll, false);

      // Verify header is present
      const header = await page.$(".header");
      assert.ok(header);

      // Verify board is visible
      const board = await page.$('section.board[data-mode="bart"]:not([hidden])');
      assert.ok(board);

      // Verify departures table has rows
      const rows = await page.$$(".departures tbody tr");
      assert.ok(rows.length > 0);
    });

    test("wall view ferry board renders at 720x720", async () => {
      await page.goto(`${baseUrl}/?wall=square`);
      
      await page.waitForSelector('.split-flap-tile', { timeout: 10000 });
      await page.waitForSelector('section.board[data-mode="bart"]:not([hidden])', { timeout: 5000 });

      // Click to advance to ferry and trigger poll
      await page.click("body");
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__bayBoard && window.__bayBoard.poll && window.__bayBoard.poll());
      
      // Wait longer for poll to complete and render
      await page.waitForTimeout(3000);
      
      // Wait for ferry board to appear AND for its departures to load
      await page.waitForSelector('section.board[data-mode="ferry"]:not([hidden])', { timeout: 5000 });
      await page.waitForSelector('section.board[data-mode="ferry"]:not([hidden]) .departures tbody tr', { timeout: 10000 });

      const screenshot = await page.screenshot({ path: "test-results/wall-ferry.png" });
      assert.ok(screenshot.length > 0);

      const board = await page.$('section.board[data-mode="ferry"]:not([hidden])');
      assert.ok(board);
    });

    test("wall view bus board renders at 720x720", async () => {
      await page.goto(`${baseUrl}/?wall=square`);
      
      await page.waitForSelector('.split-flap-tile', { timeout: 10000 });
      await page.waitForSelector('section.board[data-mode="bart"]:not([hidden])', { timeout: 5000 });

      // Click twice to get to bus
      await page.click("body");
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__bayBoard && window.__bayBoard.poll && window.__bayBoard.poll());
      await page.click("body");
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__bayBoard && window.__bayBoard.poll && window.__bayBoard.poll());
      
      // Wait longer for poll to complete and render
      await page.waitForTimeout(3000);
      
      // Wait for bus board to appear AND for its departures to load
      await page.waitForSelector('section.board[data-mode="bus"]:not([hidden])', { timeout: 5000 });
      await page.waitForSelector('section.board[data-mode="bus"]:not([hidden]) .departures tbody tr', { timeout: 10000 });

      const screenshot = await page.screenshot({ path: "test-results/wall-bus.png" });
      assert.ok(screenshot.length > 0);

      const board = await page.$('section.board[data-mode="bus"]:not([hidden])');
      assert.ok(board);
    });

    test("wall view empty state renders at 720x720", async () => {
    // Use test override to return empty board data
    const { setTestBoardData } = await import("../src/server.js");
    setTestBoardData({ 
      status: 200, 
      body: { 
        bart: { mode: "bart", stop: "FTVL", updatedAt: new Date().toISOString(), departures: [] },
        ferry: { mode: "ferry", stop: "", updatedAt: new Date().toISOString(), departures: [], unconfigured: true },
        bus: { mode: "bus", stop: "", updatedAt: new Date().toISOString(), departures: [], unconfigured: true }
      } 
    });
    
    await page.goto(`${baseUrl}/?wall=square`);
    await page.waitForSelector('section.board[data-mode="bart"]:not([hidden])', { timeout: 5000 });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ path: "test-results/wall-empty.png" });
    assert.ok(screenshot.length > 0);

    // Check if empty row exists (might show "NO DEPARTURES" or "No departures" or "Loading...")
    const hasEmptyOrLoading = await page.evaluate(() => {
      const rows = document.querySelectorAll(".departures tbody tr");
      return Array.from(rows).some(r => 
        r.textContent.includes("NO DEPARTURES") || 
        r.textContent.includes("No departures") ||
        r.textContent.includes("Loading")
      );
    });
    assert.ok(hasEmptyOrLoading);

    // Clean up
    const { setTestBoardData: clearTestBoardData } = await import("../src/server.js");
    clearTestBoardData(null);
  });

    test("wall view error state renders at 720x720", async () => {
      // Use test override to return error
      const { setTestBoardData } = await import("../src/server.js");
      setTestBoardData({ status: 500, body: { error: "Internal server error" } });
      
      await page.goto(`${baseUrl}/?wall=square`);
      await page.waitForSelector('section.board[data-mode="bart"]:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(3000);

      const screenshot = await page.screenshot({ path: "test-results/wall-error.png" });
      assert.ok(screenshot.length > 0);
    });

    test("normal view still works at desktop size", async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${baseUrl}/`);
      await page.waitForSelector('section.board[data-mode="bart"]', { timeout: 5000 });

      // Verify mode tabs are visible
      const tabs = await page.$(".mode-tabs");
      assert.ok(tabs);

      // Verify all three boards are present (not hidden by wall mode)
      const bartBoard = await page.$('section.board[data-mode="bart"]');
      const ferryBoard = await page.$('section.board[data-mode="ferry"]');
      const busBoard = await page.$('section.board[data-mode="bus"]');
      assert.ok(bartBoard);
      assert.ok(ferryBoard);
      assert.ok(busBoard);
    });
  });
}