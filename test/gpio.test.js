// GPIO API tests

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { setTestConfig, setTestPosey, clearTestOverrides, getPosey, handleRequest, resetConfigCache } from "../src/server.js";
import { PoseyClient, authorizeControl, isPoseyEnabled } from "../src/services/posey.js";

// Shared test infrastructure
let fakePoseyServer = null;
let fakePoseyPort = 0;
let fakePoseyPins = [];
let testServer = null;
let testPort = 0;
let originalEnv = {};

function createFakePoseyServer(pins) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const auth = req.headers.authorization;
      if (auth !== "Bearer test-token") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const url = new URL(req.url, `http://localhost`);
      const path = url.pathname;

      if (req.method === "GET" && path === "/pins") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pins));
        return;
      }

      if (req.method === "POST" && path.startsWith("/pins/")) {
        const pinName = path.split("/pins/")[1];
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        const data = JSON.parse(body);

        const pinIndex = pins.findIndex((p) => p.name === pinName);
        if (pinIndex === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Pin not found" }));
          return;
        }

        if (data.on !== undefined) {
          pins[pinIndex].on = data.on;
        }
        if (data.pulse_ms !== undefined) {
          pins[pinIndex].on = true;
          // Simulate pulse by turning off after pulse_ms (in test we just set on=true)
          pins[pinIndex].on = true;
        }
        if (data.enabled !== undefined) {
          pins[pinIndex].enabled = data.enabled;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pins.find((p) => p.name === pinName)));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, () => {
      fakePoseyPort = server.address().port;
      fakePoseyServer = server;
      resolve(server);
    });
  });
}

function createTestServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      await handleRequest(req, res);
    });

    server.listen(0, () => {
      testPort = server.address().port;
      testServer = server;
      resolve(server);
    });
  });
}

// Top-level setup: create shared fake posey server and test server
before(async () => {
  // Save original env
  originalEnv = { ...process.env };
  
  // Start fake posey-tube server with test pins
  fakePoseyPins = [
    { name: "relay1", bcm: 17, direction: "out", active_high: false, max_on_s: 600, label: "Relay 1", on: false, enabled: true, since: null, auto_off_remaining: null },
    { name: "button1", bcm: 27, direction: "in", pull: "up", label: "Button 1", on: false, enabled: true, since: null, auto_off_remaining: null },
  ];
  await createFakePoseyServer(fakePoseyPins);
  
  // Create test HTTP server with our handleRequest
  await createTestServer();
});

after(() => {
  if (testServer) testServer.close();
  if (fakePoseyServer) fakePoseyServer.close();
  // Restore env
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("POSEY_")) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
  clearTestOverrides();
  resetConfigCache();
});

// Reset per-test state
beforeEach(() => {
  // Reset pins to initial state
  fakePoseyPins = [
    { name: "relay1", bcm: 17, direction: "out", active_high: false, max_on_s: 600, label: "Relay 1", on: false, enabled: true, since: null, auto_off_remaining: null },
    { name: "button1", bcm: 27, direction: "in", pull: "up", label: "Button 1", on: false, enabled: true, since: null, auto_off_remaining: null },
  ];
  clearTestOverrides();
  resetConfigCache();
  // Ensure env vars are set for tests that need them
  process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
  process.env.POSEY_TUBE_TOKEN = "test-token";
});

afterEach(() => {
  clearTestOverrides();
  resetConfigCache();
});

describe("GPIO backend - unit tests", () => {
  test("isPoseyEnabled returns false when env vars missing", () => {
    delete process.env.POSEY_TUBE_URL;
    delete process.env.POSEY_TUBE_TOKEN;
    assert.equal(isPoseyEnabled({}), false);
    assert.equal(isPoseyEnabled({ poseyTubeUrl: "http://test" }), false);
    assert.equal(isPoseyEnabled({ poseyTubeToken: "token" }), false);
    assert.equal(isPoseyEnabled({ poseyTubeUrl: "http://test", poseyTubeToken: "token" }), true);
  });

  test("authorizeControl allows by default", async () => {
    const mockReq = {};
    await assert.doesNotReject(() => authorizeControl(mockReq));
  });

  test("PoseyClient creates client when env vars present", async () => {
    process.env.POSEY_TUBE_URL = "http://localhost:1234";
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const client = await PoseyClient.create();
    assert.ok(client);
    assert.ok(client.enabled);
    
    delete process.env.POSEY_TUBE_URL;
    delete process.env.POSEY_TUBE_TOKEN;
  });

  test("PoseyClient returns null when env vars missing", async () => {
    delete process.env.POSEY_TUBE_URL;
    delete process.env.POSEY_TUBE_TOKEN;
    
    const client = await PoseyClient.create();
    assert.equal(client, null);
  });
});

describe("GPIO API endpoints", () => {
  // Helper to set up test config and posey client for a working posey-tube
  function setupWorkingPosey() {
    setTestConfig(async () => ({
      poseyTubeUrl: `http://localhost:${fakePoseyPort}`,
      poseyTubeToken: "test-token",
    }));
    const testPosey = new PoseyClient(`http://localhost:${fakePoseyPort}`, "test-token");
    setTestPosey(testPosey);
  }

  // Helper to set up test config and posey client for a failing posey-tube
  function setupFailingPosey() {
    setTestConfig(async () => ({
      poseyTubeUrl: "http://localhost:9999",
      poseyTubeToken: "test-token",
    }));
    const testPosey = new PoseyClient("http://localhost:9999", "test-token");
    setTestPosey(testPosey);
  }

  test("GET /api/gpio returns enabled: false when env vars missing", async () => {
    clearTestOverrides();
    delete process.env.POSEY_TUBE_URL;
    delete process.env.POSEY_TUBE_TOKEN;
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.enabled, false);
  });

  test("GET /api/gpio returns pins when posey-tube configured", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.enabled, true);
    assert.ok(Array.isArray(data.pins));
    assert.ok(data.pins.length >= 2);
  });

  test("GET /api/gpio returns 503 when posey-tube unreachable", async () => {
    setupFailingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio`);
    const data = await res.json();
    assert.equal(res.status, 503);
    assert.equal(data.error, "posey-tube offline");
  });

  test("POST /api/gpio/{name} with valid on=true", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.on, true);
  });

  test("POST /api/gpio/{name} with pulse_ms", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pulse_ms: 500 }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.on, true);
  });

  test("POST /api/gpio/{name} with enabled=false", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.enabled, false);
  });

  test("POST /api/gpio/{name} rejects invalid body (multiple fields)", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true, pulse_ms: 500 }),
    });
    const data = await res.json();
    assert.equal(res.status, 422);
    assert.ok(data.error.includes("exactly one"));
  });

  test("POST /api/gpio/{name} rejects unknown pin", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 404);
  });

  test("POST /api/gpio/{name} returns 503 when posey-tube down", async () => {
    setupFailingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 503);
    assert.equal(data.error, "posey-tube offline");
  });

  test("POST /api/gpio/{name} passes through posey-tube 404", async () => {
    setupWorkingPosey();
    
    const res = await fetch(`http://localhost:${testPort}/api/gpio/nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 404);
  });
});