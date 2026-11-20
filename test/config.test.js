import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const originalEnv = { ...process.env };

describe("Config loading", () => {
  before(() => {
    // Reset env
    process.env = { ...originalEnv };
    delete process.env.BART_API_KEY;
    delete process.env.API_511_KEY;
  });

  after(() => {
    process.env = originalEnv;
  });

  test("loads config.json with default values", async () => {
    const { getConfig, resetConfigCache } = await import("../src/config.js");
    resetConfigCache();

    const config = await getConfig();
    assert.ok(config.bart);
    assert.deepEqual(config.bart.stations, ["16TH"]);
    assert.ok(config.ferry);
    assert.ok(config.bus);
    assert.equal(config.budget511PerHour, 55);
  });

  test("env var BART_API_KEY overrides config", async () => {
    const { getConfig, resetConfigCache } = await import("../src/config.js");
    resetConfigCache();

    process.env.BART_API_KEY = "test-bart-key-123";
    const config = await getConfig();
    assert.equal(config.bartApiKey, "test-bart-key-123");

    delete process.env.BART_API_KEY;
  });

  test("env var API_511_KEY overrides config", async () => {
    const { getConfig, resetConfigCache } = await import("../src/config.js");
    resetConfigCache();

    process.env.API_511_KEY = "test-511-key-456";
    const config = await getConfig();
    assert.equal(config.api511Key, "test-511-key-456");

    delete process.env.API_511_KEY;
  });

  test("missing .env file does not throw", async () => {
    const { getConfig, resetConfigCache } = await import("../src/config.js");
    resetConfigCache();

    // Should not throw
    const config = await getConfig();
    assert.ok(config);
  });

  test(".env file with valid content is parsed", async () => {
    const { getConfig, resetConfigCache } = await import("../src/config.js");
    resetConfigCache();

    const originalEnvPath = join(PROJECT_ROOT, ".env");
    await writeFile(originalEnvPath, "BART_API_KEY=from-env-file\nAPI_511_KEY=from-env-file-2\n");
    try {
      const config = await getConfig();
      assert.equal(config.bartApiKey, "from-env-file");
      assert.equal(config.api511Key, "from-env-file-2");
    } finally {
      try { await unlink(originalEnvPath); } catch {}
    }
  });

  test("config values not in env remain from config.json", async () => {
    const { getConfig, resetConfigCache } = await import("../src/config.js");
    resetConfigCache();

    process.env.BART_API_KEY = "only-bart";
    const config = await getConfig();
    assert.equal(config.bartApiKey, "only-bart");
    assert.equal(config.api511Key, undefined);
    assert.deepEqual(config.bart.stations, ["16TH"]);
    assert.equal(config.budget511PerHour, 55);

    delete process.env.BART_API_KEY;
  });
});