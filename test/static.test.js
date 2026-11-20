import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function withServer(fn) {
  const mod = await import("../src/server.js");
  const server = createServer(mod.handleRequest);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("Static file serving", () => {
  test("GET / serves index.html with correct content type", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("<title>Bay Board</title>"));
    });
  });

  test("GET /style.css serves CSS with correct content type", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/style.css`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/css; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("--paper: #F0EEE6"));
    });
  });

  test("GET /app.js serves JavaScript with correct content type", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/app.js`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("Bay Board front-end"));
    });
  });

  test("Unknown path returns 404", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
      const text = await res.text();
      assert.equal(text, "Not Found");
    });
  });

  test("Unknown API path returns 404", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/unknown`);
      assert.equal(res.status, 404);
      const text = await res.text();
      assert.equal(text, "Not Found");
    });
  });
});