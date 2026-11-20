import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { serveStatic } from "./static.js";
import { getConfig } from "./config.js";
import pkg from "../package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const VERSION = pkg.version;

export async function handleRequest(req, res) {
  let pathname;
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    pathname = url.pathname;
  } catch {
    // Malformed request-target (e.g., absolute-form URI)
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  // Health endpoint
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      time: new Date().toISOString(),
      version: VERSION,
    }));
    return;
  }

  // API board endpoints (placeholder for now)
  if (pathname === "/api/board" || pathname.startsWith("/api/board/")) {
    res.writeHead(501, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not implemented" }));
    return;
  }

  // Static files
  try {
    const served = await serveStatic(req, res, pathname);
    if (served) return;
  } catch (err) {
    // Should not happen (serveStatic catches internally), but guard anyway
    if (!res.writableEnded) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    }
    return;
  }

  // 404 for unknown paths
  if (!res.writableEnded) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

async function main() {
  await getConfig(); // Load config early to fail fast on errors
  const server = createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`Bay Board server running on http://localhost:${PORT}`);
  });
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
