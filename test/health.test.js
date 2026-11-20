import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("Health endpoint", () => {
  before(startServer);
  after(stopServer);

  test("GET /api/health returns ok with time and version", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.time);
    assert.ok(body.version);
    assert.ok(!isNaN(Date.parse(body.time)));
  });
});