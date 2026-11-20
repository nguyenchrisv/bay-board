import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resetPoller } from "../src/poller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let server;
let baseUrl;

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
    process.env.BART_API_KEY = "TEST_KEY_12345";
    const { resetConfigCache } = await import("../src/config.js");
    resetConfigCache();
    await startServer();
  });

  after(async () => {
    await stopServer();
    resetPoller();
  });

  test("GET /api/board returns all modes with BART data", async () => {
    const res = await fetch(`${baseUrl}/api/board`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.bart);
    assert.equal(body.bart.mode, "bart");
    assert.equal(body.bart.stop, "16th St Mission");
    assert.ok(body.ferry);
    assert.equal(body.ferry.mode, "ferry");
    assert.equal(body.ferry.stop, "Not configured");
    assert.ok(body.bus);
    assert.equal(body.bus.mode, "bus");
    assert.equal(body.bus.stop, "Not configured");
  });

  test("GET /api/board/bart returns BART board", async () => {
    const res = await fetch(`${baseUrl}/api/board/bart`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.ok(body.bart);
    assert.equal(body.bart.mode, "bart");
    assert.equal(body.bart.stop, "16th St Mission");
    assert.ok(Array.isArray(body.bart.departures));
  });

  test("GET /api/board/ferry returns 404 (not implemented)", async () => {
    const res = await fetch(`${baseUrl}/api/board/ferry`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.equal(body.error, "Not found");
  });

  test("GET /api/board/bus returns 404 (not implemented)", async () => {
    const res = await fetch(`${baseUrl}/api/board/bus`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Not found");
  });

  test("GET /api/board/unknown returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/board/unknown`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Not found");
  });
});