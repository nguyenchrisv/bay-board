import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { serveStatic } from "./static.js";
import { getConfig as defaultGetConfig, resetConfigCache } from "./config.js";
import { getPoller as defaultGetPoller, resetPoller as defaultResetPoller, createPoller } from "./poller.js";
import { PoseyClient, authorizeControl, isPoseyEnabled } from "./services/posey.js";
import pkg from "../package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const VERSION = pkg.version;

// Test overrides
let testGetConfig = null;
let testPoller = null;
let testStravaData = null;
let testBoardData = null;
let testPosey = null;

function setTestConfig(getConfig) {
  testGetConfig = getConfig;
}

function setTestPoller(poller) {
  testPoller = poller;
}

function setTestStravaData(data) {
  testStravaData = data;
}

function setTestBoardData(data) {
  testBoardData = data;
}

function setTestPosey(posey) {
  testPosey = posey;
}

function clearTestOverrides() {
  testGetConfig = null;
  testPoller = null;
  testStravaData = null;
  testBoardData = null;
  testPosey = null;
}

function getConfig() {
  return testGetConfig ? testGetConfig() : defaultGetConfig();
}

function getPoller() {
  return testPoller ? Promise.resolve(testPoller) : defaultGetPoller();
}

async function getPosey() {
  if (testPosey) return testPosey;
  return PoseyClient.create();
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

// Config endpoint (for wall mode)
  if (pathname === "/api/config") {
    try {
      const config = await getConfig();
      // Return sanitized config (no API keys)
      const sanitized = {
        bart: config.bart ? { stations: config.bart.stations } : null,
        ferry: config.ferry ? { stops: config.ferry.stops } : null,
        bus: config.bus ? { stops: config.bus.stops } : null,
        strava: config.strava ? { enabled: !!config.strava.clientId } : null,
        wallRotationMs: config.wallRotationMs,
      };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(sanitized));
      return;
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }
  }

  // API Strava endpoint
  if (pathname === "/api/strava") {
    try {
      if (testStravaData) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(testStravaData));
        return;
      }

      // In production, this would call the Strava backend service
      // For now, return empty structure
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        athlete: null,
        stats: null,
        activities: [],
        clubs: [],
        groupEvents: {},
        updatedAt: new Date().toISOString(),
      }));
      return;
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }
  }

  // API board endpoints
  if (pathname === "/api/board" || pathname.startsWith("/api/board/")) {
    try {
      // Test override: allow testing error states
      if (testBoardData) {
        res.writeHead(testBoardData.status || 200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(testBoardData.body || { error: "Test error" }));
        return;
      }

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

  // API GPIO endpoints
  if (pathname === "/api/gpio" || pathname.startsWith("/api/gpio/")) {
    try {
      const config = await getConfig();

      // Feature disabled if env vars not set
      if (!isPoseyEnabled(config)) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ enabled: false }));
        return;
      }

      const posey = await getPosey();
      if (!posey) {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "posey-tube unavailable" }));
        return;
      }

      const pathParts = pathname.split("/api/gpio/")[1];

      // GET /api/gpio - list pins
      if (pathname === "/api/gpio" && req.method === "GET") {
        try {
          const pins = await posey.listPins();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ enabled: true, pins }));
          return;
        } catch (err) {
          if (err.status === 503) {
            res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "posey-tube offline" }));
            return;
          }
          throw err;
        }
        return;
      }

      // POST /api/gpio/{name} - set pin state
      if (pathParts && req.method === "POST") {
        const pinName = pathParts;

        // PIN-code plumbing: every write route goes through authorizeControl
        try {
          await authorizeControl(req);
        } catch (err) {
          if (err.status === 403) {
            res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "PIN required" }));
            return;
          }
          throw err;
        }

        let body;
        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        // Validate body
        const hasOn = typeof body.on === "boolean";
        const hasPulse = typeof body.pulse_ms === "number" && body.pulse_ms > 0;
        const hasEnabled = typeof body.enabled === "boolean";

        if ((hasOn ? 1 : 0) + (hasPulse ? 1 : 0) + (hasEnabled ? 1 : 0) !== 1) {
          res.writeHead(422, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Provide exactly one of: on (bool), pulse_ms (positive int), enabled (bool)" }));
          return;
        }

        try {
          const result = await posey.setPin(pathParts, body);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
          return;
        } catch (err) {
          if (err.status) {
            // Pass through posey-tube error status (404, 409, 422, 423, 503)
            res.writeHead(err.status, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: err.message || `posey-tube error: ${err.status}` }));
            return;
          }
          throw err;
        }
        return;
      }

      // Unknown GPIO endpoint
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not found" }));
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
export { getPoller, resetPoller, createPoller, setTestConfig, setTestPoller, setTestStravaData, setTestBoardData, setTestPosey, clearTestOverrides, getPosey, resetConfigCache };
