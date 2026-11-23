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

function getBoardsByMode(cache, mode) {
  const boards = [];
  for (const [key, board] of cache) {
    if (key.startsWith(`${mode}:`)) {
      boards.push(board);
    }
  }
  return boards;
}

function getFirstBoardByMode(cache, mode) {
  for (const [key, board] of cache) {
    if (key.startsWith(`${mode}:`)) {
      return board;
    }
  }
  return null;
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
  if (pathname === "/api/board" || pathname.startsWith("/api/board/")) {
    try {
      const poller = await getPoller();
      const cache = poller.getCache();
      const config = await getConfig();
      const boards = {};

      const mode = pathname === "/api/board" ? "all" : pathname.split("/api/board/")[1];

      // Validate mode
      const validModes = ["bart", "ferry", "bus"];
      if (mode !== "all" && !validModes.includes(mode)) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      if (mode === "all" || mode === "bart") {
        const bartBoards = getBoardsByMode(cache, "bart");
        if (bartBoards.length > 0) {
          boards.bart = bartBoards[0]; // Single station for now
        } else if (config.bart?.stations?.length > 0) {
          boards.bart = {
            mode: "bart",
            stop: config.bart.stations[0],
            updatedAt: null,
            stale: true,
            error: "No data yet",
            departures: [],
          };
        }
      }

      if (mode === "all" || mode === "ferry") {
        const ferryBoards = getBoardsByMode(cache, "ferry");
        if (ferryBoards.length > 0) {
          // For /api/board/ferry return first; for /api/board return all combined?
          // Per architecture: each stop gets its own board. For now return first.
          boards.ferry = ferryBoards[0];
        } else if (config.ferry?.stops?.length > 0) {
          boards.ferry = {
            mode: "ferry",
            stop: "",
            updatedAt: null,
            stale: true,
            error: "No data yet",
            departures: [],
            unconfigured: false,
          };
        } else {
          boards.ferry = {
            mode: "ferry",
            stop: "",
            updatedAt: null,
            stale: false,
            unconfigured: true,
            departures: [],
          };
        }
      }

      if (mode === "all" || mode === "bus") {
        const busBoards = getBoardsByMode(cache, "bus");
        if (busBoards.length > 0) {
          boards.bus = busBoards[0];
        } else if (config.bus?.stops?.length > 0) {
          boards.bus = {
            mode: "bus",
            stop: "",
            updatedAt: null,
            stale: true,
            error: "No data yet",
            departures: [],
            unconfigured: false,
          };
        } else {
          boards.bus = {
            mode: "bus",
            stop: "",
            updatedAt: null,
            stale: false,
            unconfigured: true,
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