import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { connect } from "node:net";

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
      assert.ok(text.includes('data-mode="fitness"'));
      assert.ok(text.includes('id="fitness-stats"'));
      assert.ok(text.includes('id="group-rides-list"'));
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

  test("GET /fitness-card.js serves JavaScript with correct content type", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/fitness-card.js`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("Fitness card frontend"));
    });
  });

  test("GET /fitness-card-utils.js serves JavaScript with correct content type", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/fitness-card-utils.js`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("Fitness card utilities"));
    });
  });

  test("GET /split-flap.js serves JavaScript with correct content type", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/split-flap.js`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("Split-flap utilities"));
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

  test("Very long path (ENAMETOOLONG) returns 404", async () => {
    await withServer(async (baseUrl) => {
      const longPath = "/" + "a".repeat(300);
      const res = await fetch(`${baseUrl}${longPath}`);
      assert.equal(res.status, 404);
      const text = await res.text();
      assert.equal(text, "Not Found");
    });
  });

  test("Server survives malformed request-target and health still works", async () => {
    await withServer(async (baseUrl) => {
      const port = new URL(baseUrl).port;
      // Send raw HTTP with malformed request-target (absolute-form URI)
      const socket = connect({ port: Number(port) });
      await new Promise((resolve) => socket.once("connect", resolve));

      const malformedRequest = "GET http://example.com/ HTTP/1.1\r\nHost: localhost\r\n\r\n";
      socket.write(malformedRequest);

      // Read response (should be 400 Bad Request)
      const response = await new Promise((resolve) => {
        let data = "";
        socket.on("data", (chunk) => { data += chunk; });
        socket.on("end", () => resolve(data));
        socket.on("error", () => resolve(""));
      });

      // Health should still work after the malformed request
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const body = await healthRes.json();
      assert.equal(body.ok, true);
    });
  });
});