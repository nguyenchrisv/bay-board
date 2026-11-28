// Playwright tests for edit mode drag-and-drop
// Tests run in real browser with recorded fixtures

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// Playwright is optional - skip if not available
let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.log("Playwright not available, skipping browser tests");
}

if (!playwright) {
  // Export empty test suite
  describe("Edit mode drag-and-drop (Playwright)", () => {
    test("skipped - Playwright not installed", () => {});
  });
} else {
  const { chromium } = playwright;

  let browser;
  let server;
  let serverProcess;

  before(async () => {
    // Start the server
    const { spawn } = await import("child_process");
    serverProcess = spawn("node", ["src/server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, BART_API_KEY: "MW9S-E7SL-26DU-VV8V" },
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Launch browser
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  });

  after(async () => {
    if (browser) await browser.close();
    if (serverProcess) serverProcess.kill();
  });

  describe("Edit mode drag-and-drop", () => {
    let page;

    beforeEach(async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      page = await context.newPage();
      await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    });

    afterEach(async () => {
      if (page) await page.close();
    });

    test("enters edit mode when clicking Edit layout button", async () => {
      const editBtn = page.locator(".edit-layout-btn");
      await expect(editBtn).toBeVisible();
      await editBtn.click();
      await expect(page.locator(".edit-mode-panel")).not.toBeHidden();
      await expect(page.locator(".edit-mode-panel h2")).toContainText("Hidden Tiles");
    });

    test("exits edit mode when clicking Done button", async () => {
      await page.click(".edit-layout-btn");
      await page.click(".done-edit-btn");
      await expect(page.locator(".edit-mode-panel")).toBeHidden();
    });

    test("drags tile to reorder on the board", async () => {
      await page.click(".edit-layout-btn");
      await page.waitForTimeout(300);

      // Get initial tile order
      const initialOrder = await page.locator(".transit-boards .board:not([hidden])").evaluateAll(
        els => els.map(el => el.dataset.mode)
      );

      // Drag Fitness tile to top (drag from its drag handle)
      const fitnessTile = page.locator('.board[data-mode="fitness"] .edit-tile-drag-handle');
      const bartTile = page.locator('.board[data-mode="bart"]');

      await fitnessTile.dragTo(bartTile, { sourcePosition: { x: 10, y: 10 } });
      await page.waitForTimeout(300);

      // Check new order
      const newOrder = await page.locator(".transit-boards .board:not([hidden])").evaluateAll(
        els => els.map(el => el.dataset.mode)
      );

      // Fitness should now be first
      assert.equal(newOrder[0], "fitness");
    });

    test("toggle width changes tile size", async () => {
      await page.click(".edit-layout-btn");
      await page.waitForTimeout(300);

      const bartTile = page.locator('.board[data-mode="bart"]');
      await expect(bartTile).toHaveAttribute("data-width", "half");

      // Click width toggle on BART
      await page.click('.board[data-mode="bart"] .edit-tile-width-btn');
      await page.waitForTimeout(200);

      // Should be full width now
      await expect(bartTile).toHaveAttribute("data-width", "full");
    });

    test("hide tile removes it from board and shows in hidden list", async () => {
      await page.click(".edit-layout-btn");
      await page.waitForTimeout(300);

      // Hide BART
      await page.click('.board[data-mode="bart"] .edit-tile-visibility-btn');
      await page.waitForTimeout(200);

      // BART should be hidden on board
      const bartBoard = page.locator('.board[data-mode="bart"]');
      await expect(bartBoard).toBeHidden();

      // BART should appear in hidden tiles panel
      await expect(page.locator(".edit-mode-hidden .edit-tile-title")).toContainText("BART");
    });

    test("show hidden tile restores it to board", async () => {
      await page.click(".edit-layout-btn");
      await page.waitForTimeout(300);

      // Hide and then show BART
      await page.click('.board[data-mode="bart"] .edit-tile-visibility-btn');
      await page.waitForTimeout(200);
      await page.click('.edit-mode-hidden .edit-tile-visibility-btn');
      await page.waitForTimeout(200);

      // BART should be visible again
      await expect(page.locator('.board[data-mode="bart"]')).not.toBeHidden();
    });

    test("layout persists after reload", async () => {
      await page.click(".edit-layout-btn");
      await page.waitForTimeout(300);

      // Move Fitness to top
      const fitnessTile = page.locator('.board[data-mode="fitness"] .edit-tile-drag-handle');
      const bartTile = page.locator('.board[data-mode="bart"]');
      await fitnessTile.dragTo(bartTile, { sourcePosition: { x: 10, y: 10 } });
      await page.waitForTimeout(500);

      await page.click(".done-edit-btn");
      await page.waitForTimeout(200);

      // Reload page
      await page.reload({ waitUntil: "networkidle" });

      // Fitness should still be first
      const order = await page.locator(".transit-boards .board:not([hidden])").evaluateAll(
        els => els.map(el => el.dataset.mode)
      );
      assert.equal(order[0], "fitness");
    });

    test("mobile tab order follows saved layout", async () => {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      const mobilePage = await context.newPage();

      try {
        await mobilePage.goto("http://localhost:3000", { waitUntil: "networkidle" });

        // Check mobile tabs are present
        const tabs = mobilePage.locator(".mode-tabs [role=tab]");
        await expect(tabs.first()).toBeVisible();

        // Enter edit mode
        await mobilePage.click(".edit-layout-btn");
        await mobilePage.waitForTimeout(300);

        // Move Fitness to first
        const fitnessTile = mobilePage.locator('.board[data-mode="fitness"] .edit-tile-drag-handle');
        const bartTile = mobilePage.locator('.board[data-mode="bart"]');
        await fitnessTile.dragTo(bartTile, { sourcePosition: { x: 10, y: 10 } });
        await mobilePage.waitForTimeout(500);
        await mobilePage.click(".done-edit-btn");

        // Reload
        await mobilePage.reload({ waitUntil: "networkidle" });

        // Check mobile tabs order - Fitness should be first
        const tabModes = await mobilePage.locator(".mode-tabs [role=tab]").evaluateAll(
          els => els.map(el => el.dataset.mode)
        );
        assert.equal(tabModes[0], "fitness");
      } finally {
        await mobilePage.close();
      }
    });
  });
}