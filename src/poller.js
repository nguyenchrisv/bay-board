// Poller: fetches BART and 511 (ferry + bus) data on a schedule, caches results,
// handles failures, and enforces 511 request budget.

import { getConfig as defaultGetConfig } from "./config.js";
import { normalizeEtd, normalizeAdvisories, getStationName } from "./adapters/bart.js";
import { normalizeStopMonitoring, stripBom, maybeDecompress } from "./adapters/sf511.js";

const BART_ETD_URL = "https://api.bart.gov/api/etd.aspx";
const BART_BSA_URL = "https://api.bart.gov/api/bsa.aspx";
const SF511_STOP_MONITORING_URL = "https://api.511.org/transit/StopMonitoring";

const POLL_INTERVAL_MS = 30_000; // BART ETD every 30s
const ADVISORY_INTERVAL_MS = 2 * 60 * 1000; // BART advisories every 2 min
const SF511_POLL_INTERVAL_MS = 3 * 60 * 1000; // 511 base interval ~3 min (adjusted by budget)

function buildEtdUrl(station, apiKey) {
  const params = new URLSearchParams({
    cmd: "etd",
    orig: station,
    key: apiKey,
    json: "y",
  });
  return `${BART_ETD_URL}?${params.toString()}`;
}

function buildBsaUrl(apiKey) {
  const params = new URLSearchParams({
    cmd: "bsa",
    key: apiKey,
    json: "y",
  });
  return `${BART_BSA_URL}?${params.toString()}`;
}

function buildSf511Url(operator, stopCode, apiKey) {
  const params = new URLSearchParams({
    api_key: apiKey,
    agency: operator,
    stopCode: stopCode,
    format: "json",
  });
  return `${SF511_STOP_MONITORING_URL}?${params.toString()}`;
}

function redactKey(url) {
  return url.replace(/key=[^&]+/, "key=***").replace(/api_key=[^&]+/, "api_key=***");
}

function scrubApiKey(message, apiKey) {
  if (!apiKey) return message;
  return message.split(apiKey).join("***");
}

function createInitialBoard(mode, stopId, stopName) {
  return {
    mode,
    stop: stopName,
    updatedAt: null,
    stale: true,
    error: "No data yet",
    departures: [],
  };
}

function createErrorBoard(previousBoard, errorMessage) {
  if (!previousBoard) return null;
  return {
    ...previousBoard,
    stale: true,
    error: errorMessage,
  };
}

// 511 Budget Manager: ensures we never exceed budget511PerHour requests per rolling hour
class BudgetManager {
  constructor(budgetPerHour, nowImpl) {
    this.budgetPerHour = budgetPerHour;
    this.nowImpl = nowImpl;
    this.requestTimestamps = []; // timestamps of completed requests
  }

  // Call before making a request; returns true if allowed
  async canRequest() {
    const now = this.nowImpl().getTime();
    const oneHourAgo = now - 60 * 60 * 1000;
    // Prune old timestamps
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > oneHourAgo);
    return this.requestTimestamps.length < this.budgetPerHour;
  }

  // Call after a request completes (success or failure)
  recordRequest() {
    this.requestTimestamps.push(this.nowImpl().getTime());
  }

  // Get current usage in the last hour
  getUsage() {
    const now = this.nowImpl().getTime();
    const oneHourAgo = now - 60 * 60 * 1000;
    return this.requestTimestamps.filter((ts) => ts > oneHourAgo).length;
  }

  // For testing: simulate time passing
  _setNowImpl(nowImpl) {
    this.nowImpl = nowImpl;
  }
}

export function createPoller(options = {}) {
  const {
    fetchImpl = fetch,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    nowImpl = () => new Date(),
    getConfig = defaultGetConfig,
  } = options;

  let cache = new Map(); // key -> board (key = "bart:FTVL" | "ferry:7206" | "bus:57727")
  let advisories = [];
  let timers = [];
  let stopped = false;
  let budgetManager = null;

  async function fetchEtd(stationAbbr, apiKey) {
    const url = buildEtdUrl(stationAbbr, apiKey);
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text.trim()) {
        throw new Error("Empty response");
      }
      const json = JSON.parse(text);
      return json;
    } catch (err) {
      let message = err.message.replace(url, redactKey(url));
      message = scrubApiKey(message, apiKey);
      throw new Error(message);
    }
  }

  async function fetchBsa(apiKey) {
    const url = buildBsaUrl(apiKey);
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text.trim()) {
        throw new Error("Empty response");
      }
      const json = JSON.parse(text);
      return json;
    } catch (err) {
      let message = err.message.replace(url, redactKey(url));
      message = scrubApiKey(message, apiKey);
      throw new Error(message);
    }
  }

  async function fetchSf511(operator, stopCode, apiKey) {
    const url = buildSf511Url(operator, stopCode, apiKey);
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // 511 may return gzip-compressed body even without Content-Encoding header
      const buffer = await res.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      const decompressed = maybeDecompress(Buffer.from(uint8));
      const text = stripBom(decompressed.toString("utf-8"));
      if (!text.trim()) {
        throw new Error("Empty response");
      }
      const json = JSON.parse(text);
      return json;
    } catch (err) {
      let message = err.message.replace(url, redactKey(url));
      message = scrubApiKey(message, apiKey);
      throw new Error(message);
    }
  }

  async function pollBartStation(stationAbbr, apiKey, stationName) {
    try {
      const rawJson = await fetchEtd(stationAbbr, apiKey);
      const { station, departures } = normalizeEtd(rawJson);
      const board = {
        mode: "bart",
        stop: station || stationName,
        updatedAt: nowImpl().toISOString(),
        stale: false,
        error: null,
        departures,
        unconfigured: false,
      };
      cache.set(`bart:${stationAbbr}`, board);
    } catch (err) {
      const previous = cache.get(`bart:${stationAbbr}`);
      if (previous) {
        cache.set(`bart:${stationAbbr}`, createErrorBoard(previous, err.message));
      } else {
        cache.set(`bart:${stationAbbr}`, createErrorBoard(createInitialBoard("bart", stationAbbr, stationName), err.message));
      }
    }
  }

  async function pollSf511Stop(mode, operator, stopCode, apiKey, stopName, allowedLines = []) {
    // Check budget before requesting
    if (!(await budgetManager.canRequest())) {
      // Budget exceeded; keep stale data, don't make request
      const previous = cache.get(`${mode}:${stopCode}`);
      if (previous) {
        cache.set(`${mode}:${stopCode}`, createErrorBoard(previous, "511 budget exceeded"));
      }
      return;
    }

    try {
      const rawJson = await fetchSf511(operator, stopCode, apiKey);
      budgetManager.recordRequest();

      const { stop, departures } = normalizeStopMonitoring(rawJson, operator, stopCode, allowedLines);
      const board = {
        mode,
        stop: stop || stopName,
        updatedAt: nowImpl().toISOString(),
        stale: false,
        error: null,
        departures,
        unconfigured: false,
      };
      cache.set(`${mode}:${stopCode}`, board);
    } catch (err) {
      budgetManager.recordRequest(); // Count failed requests too
      const previous = cache.get(`${mode}:${stopCode}`);
      if (previous) {
        cache.set(`${mode}:${stopCode}`, createErrorBoard(previous, err.message));
      } else {
        cache.set(`${mode}:${stopCode}`, createErrorBoard(createInitialBoard(mode, stopCode, stopName), err.message));
      }
    }
  }

  async function pollAdvisories(apiKey) {
    try {
      const rawJson = await fetchBsa(apiKey);
      advisories = normalizeAdvisories(rawJson);
    } catch {
      // Keep previous advisories on failure
    }
  }

  async function start() {
    const config = await getConfig();
    const bartApiKey = config.bartApiKey;
    const sf511ApiKey = config.api511Key;
    const bartStations = config.bart?.stations || [];
    const ferryConfig = config.ferry || { operator: "", stops: [] };
    const busConfig = config.bus || { operator: "", stops: [], lines: [] };
    const budget511PerHour = config.budget511PerHour || 55;

    budgetManager = new BudgetManager(budget511PerHour, nowImpl);

    // Initialize BART cache
    if (bartApiKey) {
      for (const station of bartStations) {
        const stationName = getStationName(station);
        cache.set(`bart:${station}`, createInitialBoard("bart", station, stationName));
      }
    } else {
      console.warn("BART_API_KEY not configured; BART polling disabled");
    }

    // Initialize 511 cache (ferry + bus)
    if (sf511ApiKey) {
      for (const stopCode of ferryConfig.stops || []) {
        const stopName = ferryConfig.stops.length > 0 ? stopCode : ""; // Will be resolved by adapter
        cache.set(`ferry:${stopCode}`, createInitialBoard("ferry", stopCode, stopName));
      }
      for (const stopCode of busConfig.stops || []) {
        const stopName = busConfig.stops.length > 0 ? stopCode : "";
        cache.set(`bus:${stopCode}`, createInitialBoard("bus", stopCode, stopName));
      }
    } else {
      console.warn("API_511_KEY not configured; 511 polling disabled");
    }

    // Initial fetches
    if (bartApiKey && bartStations.length > 0) {
      await Promise.all(bartStations.map((s) => pollBartStation(s, bartApiKey, getStationName(s))));
      await pollAdvisories(bartApiKey);
    }

    if (sf511ApiKey) {
      // Stagger initial 511 requests to respect budget
      const ferryStops = ferryConfig.stops || [];
      const busStops = busConfig.stops || [];
      const allowedLines = busConfig.lines || [];

      for (const stopCode of ferryStops) {
        if (await budgetManager.canRequest()) {
          await pollSf511Stop("ferry", ferryConfig.operator, stopCode, sf511ApiKey, stopCode);
        }
      }
      for (const stopCode of busStops) {
        if (await budgetManager.canRequest()) {
          await pollSf511Stop("bus", busConfig.operator, stopCode, sf511ApiKey, stopCode, allowedLines);
        }
      }
    }

    // Schedule recurring BART polls
    if (bartApiKey && bartStations.length > 0) {
      const scheduleEtd = async () => {
        if (stopped) return;
        await Promise.all(bartStations.map((s) => pollBartStation(s, bartApiKey, getStationName(s))));
        const timer = setTimeoutImpl(scheduleEtd, POLL_INTERVAL_MS);
        timers.push(timer);
      };

      const scheduleBsa = async () => {
        if (stopped) return;
        await pollAdvisories(bartApiKey);
        const timer = setTimeoutImpl(scheduleBsa, ADVISORY_INTERVAL_MS);
        timers.push(timer);
      };

      const timerEtd = setTimeoutImpl(scheduleEtd, POLL_INTERVAL_MS);
      timers.push(timerEtd);
      const timerBsa = setTimeoutImpl(scheduleBsa, ADVISORY_INTERVAL_MS);
      timers.push(timerBsa);
    }

    // Schedule recurring 511 polls (distributed across budget)
    if (sf511ApiKey) {
      const ferryConfigLocal = config.ferry || { operator: "", stops: [] };
      const busConfigLocal = config.bus || { operator: "", stops: [], lines: [] };
      const ferryStops = ferryConfigLocal.stops || [];
      const busStops = busConfigLocal.stops || [];
      const allowedLines = busConfigLocal.lines || [];
      const totalStops = ferryStops.length + busStops.length;

      if (totalStops > 0) {
        // Calculate interval per stop to stay within budget
        // budget511PerHour requests/hour / totalStops = requests per hour per stop
        // interval = 3600000 / (budgetPerHour / totalStops) = 3600000 * totalStops / budgetPerHour
        const intervalPerStop = Math.max(SF511_POLL_INTERVAL_MS, Math.floor((3600000 * totalStops) / budget511PerHour));

        const scheduleSf511 = async () => {
          if (stopped) return;

          // Poll each stop sequentially, respecting budget
          for (const stopCode of ferryStops) {
            if (stopped) break;
            if (await budgetManager.canRequest()) {
              await pollSf511Stop("ferry", ferryConfigLocal.operator, stopCode, sf511ApiKey, stopCode);
            }
          }
          for (const stopCode of busStops) {
            if (stopped) break;
            if (await budgetManager.canRequest()) {
              await pollSf511Stop("bus", busConfigLocal.operator, stopCode, sf511ApiKey, stopCode, allowedLines);
            }
          }

          const timer = setTimeoutImpl(scheduleSf511, intervalPerStop);
          timers.push(timer);
        };

        const timerSf511 = setTimeoutImpl(scheduleSf511, intervalPerStop);
        timers.push(timerSf511);
      }
    }
  }

  function getCache() {
    return new Map(cache);
  }

  function getAdvisories() {
    return [...advisories];
  }

  function stop() {
    stopped = true;
    for (const timer of timers) {
      clearTimeoutImpl(timer);
    }
    timers = [];
  }

  return { start, getCache, getAdvisories, stop };
}

// Default poller instance for production use
let defaultPoller = null;

export async function getPoller() {
  if (!defaultPoller) {
    defaultPoller = createPoller();
    await defaultPoller.start();
  }
  return defaultPoller;
}

export function resetPoller() {
  if (defaultPoller) {
    defaultPoller.stop();
    defaultPoller = null;
  }
}