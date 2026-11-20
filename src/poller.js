// BART poller: fetches BART data on a schedule, caches results, handles failures

import { getConfig } from "./config.js";
import { normalizeEtd, normalizeAdvisories, getStationName } from "./adapters/bart.js";

const BART_ETD_URL = "https://api.bart.gov/api/etd.aspx";
const BART_BSA_URL = "https://api.bart.gov/api/bsa.aspx";
const POLL_INTERVAL_MS = 30_000;
const ADVISORY_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

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

function redactKey(url) {
  return url.replace(/key=[^&]+/, "key=***");
}

function createInitialBoard(stationAbbr, stationName) {
  return {
    mode: "bart",
    stop: stationName,
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

export function createPoller(options = {}) {
  const {
    fetchImpl = fetch,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    nowImpl = () => new Date(),
  } = options;

  let cache = new Map(); // stationAbbr -> board
  let advisories = [];
  let timers = [];
  let stopped = false;

  async function fetchEtd(stationAbbr, apiKey) {
    const url = buildEtdUrl(stationAbbr, apiKey);
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      // BART sometimes returns empty response or non-JSON
      if (!text.trim()) {
        throw new Error("Empty response");
      }
      const json = JSON.parse(text);
      return json;
    } catch (err) {
      // Redact API key from error message
      const message = err.message.replace(url, redactKey(url));
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
      const message = err.message.replace(url, redactKey(url));
      throw new Error(message);
    }
  }

  async function pollStation(stationAbbr, apiKey, stationName) {
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
      };
      cache.set(stationAbbr, board);
    } catch (err) {
      const previous = cache.get(stationAbbr);
      if (previous) {
        cache.set(stationAbbr, createErrorBoard(previous, err.message));
      } else {
        cache.set(stationAbbr, createErrorBoard(createInitialBoard(stationAbbr, stationName), err.message));
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
    const apiKey = config.bartApiKey;
    const stations = config.bart?.stations || [];

    if (!apiKey) {
      console.warn("BART_API_KEY not configured; BART polling disabled");
      return;
    }

    // Initialize cache with empty boards
    for (const station of stations) {
      const stationName = getStationName(station);
      cache.set(station, createInitialBoard(station, stationName));
    }

    // Initial fetch
    await Promise.all(stations.map((s) => pollStation(s, apiKey, getStationName(s))));
    await pollAdvisories(apiKey);

    // Schedule recurring polls
    const scheduleEtd = async () => {
      if (stopped) return;
      await Promise.all(stations.map((s) => pollStation(s, apiKey, getStationName(s))));
      const timer = setTimeoutImpl(scheduleEtd, POLL_INTERVAL_MS);
      timers.push(timer);
    };

    const scheduleBsa = async () => {
      if (stopped) return;
      await pollAdvisories(apiKey);
      const timer = setTimeoutImpl(scheduleBsa, ADVISORY_INTERVAL_MS);
      timers.push(timer);
    };

    // Schedule first recurring polls (initial fetch already done)
    const timerEtd = setTimeoutImpl(scheduleEtd, POLL_INTERVAL_MS);
    timers.push(timerEtd);
    const timerBsa = setTimeoutImpl(scheduleBsa, ADVISORY_INTERVAL_MS);
    timers.push(timerBsa);
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
