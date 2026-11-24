// GPIO API tests

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

import { setTestConfig, setTestPosey, clearTestOverrides, getPosey, handleRequest } from "../src/server.js";
import { PoseyClient, authorizeControl, isPoseyEnabled } from "../src/services/posey.js";

// Fake posey-tube server for testing
let fakePoseyServer = null;
let fakePoseyPort = 0;
let fakePoseyPins = [];
let fakePoseyToken = "test-token";

function createFakePoseyServer() {
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
        res.end(JSON.stringify(fakePoseyPins));
        return;
      }

      if (req.method === "POST" && path.startsWith("/pins/")) {
        const pinName = path.split("/pins/")[1];
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }
        const data = JSON.parse(body);

        const pinIndex = fakePoseyPins.findIndex((p) => p.name === pinName);
        if (pinIndex === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Pin not found" }));
          return;
        }

        if (data.on !== undefined) {
          fakePoseyPins[pinIndex].on = data.on;
        }
        if (data.pulse_ms !== undefined) {
          fakePoseyPins[pinIndex].on = true;
          // Simulate pulse by turning off after pulse_ms (in test we just set on=true)
          fakePoseyPins[pinIndex].on = true;
        }
        if (data.enabled !== undefined) {
          fakePoseyPins[pinIndex].enabled = data.enabled;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fakePoseyPins.find((p) => p.name === pinName)));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, () => {
      fakePoseyPort = server.address().port;
      resolve(server);
    });
  });
}

describe("GPIO backend", () => {
  let fakePoseyUrl = "";
  let originalEnv = {};

  before(async () => {
    // Save original env
    originalEnv = { ...process.env };
    
    // Start fake posey-tube server
    const server = await createFakePoseyServer();
    fakePoseyServer = server;
    const port = server.address().port;
    process.env.POSEY_TUBE_URL = `http://localhost:${port}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    // Initialize test pins
    fakePoseyPins = [
      { name: "relay1", bcm: 17, direction: "out", active_high: false, max_on_s: 600, label: "Relay 1", on: false, enabled: true, since: null, auto_off_remaining: null },
      { name: "button1", bcm: 27, direction: "in", pull: "up", label: "Button 1", on: false, enabled: true, since: null, auto_off_remaining: null },
    ];
  });

  after(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("POSEY_")) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
    if (fakePoseyServer) fakePoseyServer.close();
  });

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
  let server = null;
  let port = 0;
  let fakePoseyUrl = "";
  
  before(async () => {
    // Start fake posey-tube server
    const server = await new Promise((resolve) => {
      const s = createServer(async (req, res) => {
        const auth = req.headers.authorization;
        if (auth !== "Bearer test-token") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }

        const url = new URL(req.url, `http://localhost`);
        const path = url.pathname;

        if (req.method === "GET" && url.pathname === "/pins") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([
            { name: "relay1", bcm: 17, direction: "out", active_high: false, max_on_s: 600, label: "Relay 1", on: false, enabled: true, since: null, auto_off_remaining: null },
            { name: "button1", bcm: 27, direction: "in", pull: "up", label: "Button 1", on: false, enabled: true, since: null, auto_off_remaining: null },
          ]));
          return;
        }

        if (req.method === "POST" && url.pathname.startsWith("/pins/")) {
          const pinName = url.pathname.split("/pins/")[1];
          let body = "";
          for await (const chunk of req) body += chunk;
          const data = JSON.parse(body);
          
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: pinName, on: data.on ?? false, enabled: true }));
          return;
        }

        res.writeHead(404);
        res.end();
      });

      s.listen(0, () => resolve(s));
    });
    
    fakePoseyServer = server;
    const port = server.address().port;
    process.env.POSEY_TUBE_URL = `http://localhost:${port}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";

    // Create test HTTP server with our handleRequest
    const testServer = createServer(async (req, res) => {
      // Import handleRequest dynamically
      const { handleRequest, setTestConfig, setTestPosey, clearTestOverrides, getPosey } = await import("../src/server.js");
      
      // Override config to use test env
      setTestConfig(async () => ({
        poseyTubeUrl: `http://localhost:${fakePoseyPort}`,
        poseyTubeToken: "test-token",
      }));
      
      // Create a real PoseyClient pointing to our fake server
      const { PoseyClient } = await import("../src/services/posey.js");
      const testPosey = new PoseyClient(`http://localhost:${fakePoseyPort}`, "test-token");
      setTestPosey(testPosey);
      
      await handleRequest(req, res);
    });

    server = createServer(async (req, res) => {
      const { handleRequest } = await import("../src/server.js");
      await handleRequest(req, res);
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
    delete process.env.POSEY_TUBE_URL;
    delete process.env.POSEY_TUBE_TOKEN;
  });

  test("GET /api/gpio returns enabled: false when env vars missing", async () => {
    delete process.env.POSEY_TUBE_URL;
    delete process.env.POSEY_TUBE_TOKEN;
    
    const res = await fetch(`http://localhost:${port}/api/gpio`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.enabled, false);
  });

  test("GET /api/gpio returns pins when posey-tube configured", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio`);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.enabled, true);
    assert.ok(Array.isArray(data.pins));
    assert.ok(data.pins.length >= 2);
  });

  test("GET /api/gpio returns 503 when posey-tube unreachable", async () => {
    process.env.POSEY_TUBE_URL = "http://localhost:9999"; // invalid port
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio`);
    const data = await res.json();
    assert.equal(res.status, 503);
    assert.equal(data.error, "posey-tube offline");
  });

  test("POST /api/gpio/{name} with valid on=true", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.on, true);
  });

  test("POST /api/gpio/{name} with pulse_ms", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pulse_ms: 500 }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.on, true);
  });

  test("POST /api/gpio/{name} with enabled=false", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.enabled, false);
  });

  test("POST /api/gpio/{name} rejects invalid body (multiple fields)", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true, pulse_ms: 500 }),
    });
    const data = await res.json();
    assert.equal(res.status, 422);
    assert.ok(data.error.includes("exactly one"));
  });

  test("POST /api/gpio/{name} rejects unknown pin", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 404);
  });

  test("POST /api/gpio/{name} returns 503 when posey-tube down", async () => {
    process.env.POSEY_TUBE_URL = "http://localhost:9999";
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/relay1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 503);
    assert.equal(data.error, "posey-tube offline");
  });

  test("POST /api/gpio/{name} passes through posey-tube 404", async () => {
    process.env.POSEY_TUBE_URL = `http://localhost:${fakePoseyPort}`;
    process.env.POSEY_TUBE_TOKEN = "test-token";
    
    const res = await fetch(`http://localhost:${port}/api/gpio/nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const data = await res.json();
    assert.equal(res.status, 404);
  });
});