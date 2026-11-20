import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { serveStatic } from "./static.js";
import { getConfig as defaultGetConfig } from "./config.js";
import { getPoller as defaultGetPoller, resetPoller as defaultResetPoller, createPoller } from "./poller.js";
import pkg from "../package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const VERSION = pkg.version;

// Test overrides
let testGetConfig = null;
let testPoller = null;

export function setTestConfig(getConfig) {
  testGetConfig = getConfig;
}

export function setTestPoller(poller) {
  testPoller = poller;
}

export function clearTestOverrides() {
  testGetConfig = null;
  testPoller = null;
}

function getConfig() {
  return testGetConfig ? testGetConfig() : defaultGetConfig();
}

function getPoller() {
  return testPoller ? Promise.resolve(testPoller) : defaultGetPoller();
}

function resetPoller() {
  if (testPoller) {
    testPoller.stop();
    testPoller = null;
  } else {
    defaultResetPoller();
  }
}

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

  // API board endpoints
  if (pathname === "/api/board" || pathname === "/api/board/bart") {
    try {
      const poller = await getPoller();
      const cache = poller.getCache();
      const boards = {};

      if (pathname === "/api/board") {
        // Return all modes
        for (const [station, board] of cache) {
          boards.bart = board; // Only BART for now
        }
        // Add empty ferry and bus for consistent shape
        boards.ferry = {
          mode: "ferry",
          stop: "Not configured",
          updatedAt: null,
          stale: true,
          error: "Not configured",
          departures: [],
        };
        boards.bus = {
          mode: "bus",
          stop: "Not configured",
          updatedAt: null,
          stale: true,
          error: "Not configured",
          departures: [],
        };
      } else {
        // Single mode: bart
        const config = await getConfig();
        const stations = config.bart?.stations || [];
        for (const station of stations) {
          const board = cache.get(station);
          if (board) {
            boards.bart = board;
            break;
          }
        }
        if (!boards.bart && stations.length > 0) {
          boards.bart = {
            mode: "bart",
            stop: stations[0],
            updatedAt: null,
            stale: true,
            error: "No data yet",
            departures: [],
          };
        }
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(boards));
      return;
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }
  }

  // Unknown board mode
  if (pathname.startsWith("/api/board/")) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
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

// Export for testing
export { getPoller, resetPoller, createPoller };