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

describe("Path traversal protection", () => {
  const traversalAttempts = [
    "/../package.json",
    "/%2e%2e/package.json",
    "/..%2fpackage.json",
    "/..%2fsrc/server.js",
    "/public/../AGENTS.md",
    "/%2e%2e%2fpackage.json",
    "/..%5cpackage.json",
    "/.%2e/package.json",
  ];

  for (const path of traversalAttempts) {
    test(`Traversal attempt "${path}" returns 400 or 404`, async () => {
      await withServer(async (baseUrl) => {
        const res = await fetch(`${baseUrl}${path}`);
        assert.notEqual(res.status, 200, `Path "${path}" should not return 200`);
        assert.ok(res.status === 400 || res.status === 404, `Path "${path}" returned ${res.status}`);
      });
    });
  }

  test("Traversal attempts never leak file contents", async () => {
    await withServer(async (baseUrl) => {
      for (const path of traversalAttempts) {
        const res = await fetch(`${baseUrl}${path}`);
        const text = await res.text();
        assert.ok(!text.includes("\"name\": \"bay-board\""), `Path "${path}" leaked package.json`);
        assert.ok(!text.includes("Rules for AI agents"), `Path "${path}" leaked AGENTS.md`);
        assert.ok(!text.includes("createServer"), `Path "${path}" leaked server.js`);
      }
    });
  });
});