#!/usr/bin/env node
// 511 SF Bay setup script: one-off lookup of operator IDs and stop codes.
// Run with: API_511_KEY=your_key node scripts/setup-511.mjs
// Prints suggestions; the owner fills in config.json.

import { pathToFileURL } from "node:url";

const OPERATORS_URL = "https://api.511.org/transit/operators";
const STOPS_URL = "https://api.511.org/transit/stops";

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  // 511 may return gzip-compressed body without Content-Encoding header
  const buffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  // Check for gzip magic bytes
  if (uint8.length >= 2 && uint8[0] === 0x1f && uint8[1] === 0x8b) {
    const { gunzipSync } = await import("node:zlib");
    const decompressed = gunzipSync(Buffer.from(uint8));
    return JSON.parse(decompressed.toString("utf-8").replace(/^\uFEFF/, ""));
  }
  const text = Buffer.from(uint8).toString("utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getOperators(payload) {
  const data = payload?.Contents?.dataObjects;
  return asArray(payload?.content || data?.Operator || data || payload);
}

function getStops(payload) {
  const data = payload?.Contents?.dataObjects || payload;
  return asArray(data?.ScheduledStopPoint || data?.ServiceFrame?.scheduledStopPoints || data);
}

function formatStop(entry) {
  const stop = entry?.ScheduledStopPoint || entry;
  const code = stop?.id || stop?.Id || stop?.Stop?.StopCode || stop?.StopCode || stop?.code || "";
  const name = stop?.Name || stop?.Stop?.StopName || stop?.StopName || stop?.name || "";
  const desc = stop?.Stop?.StopDesc || stop?.StopDesc || "";
  return `${code}: ${name}${desc ? ` — ${desc}` : ""}`;
}

async function main() {
  const apiKey = process.env.API_511_KEY;
  if (!apiKey) {
    console.error("Error: API_511_KEY environment variable is required");
    console.error("Usage: API_511_KEY=your_key node scripts/setup-511.mjs");
    process.exit(1);
  }

  console.log("Fetching 511 operators...\n");
  const operators = getOperators(await fetchJson(buildUrl(OPERATORS_URL, { api_key: apiKey, format: "json" })));

  console.log("=== Operators (use 'operator' in config.json) ===");
  for (const op of operators) {
    const id = op.Id || op.id || op.PrivateCode || op.Operator?.OperatorCode || op.OperatorCode || "";
    const name = op.Name || op.name || op.Operator?.OperatorName || op.OperatorName || "";
    const hasRT = op.Monitored ?? op.Extensions?.Monitored ?? op.Operator?.Monitored ?? op.HasRealTimeData ?? false;
    console.log(`  ${id}: ${name} ${hasRT ? "(real-time)" : ""}`);
  }

  console.log("\nFetching stops for each operator with real-time data...\n");
  for (const op of operators) {
    const id = op.Id || op.id || op.PrivateCode || op.Operator?.OperatorCode || op.OperatorCode || "";
    const hasRT = op.Monitored ?? op.Extensions?.Monitored ?? op.Operator?.Monitored ?? op.HasRealTimeData ?? false;
    if (!hasRT || !id) continue;

    try {
      const payload = await fetchJson(buildUrl(STOPS_URL, { api_key: apiKey, operator_id: id, format: "json" }));
      console.log(`=== Stops for operator ${id} ===`);
      for (const stop of getStops(payload)) {
        const line = formatStop(stop);
        if (!line.startsWith(": ")) console.log(`  ${line}`);
      }
      console.log("");
    } catch (err) {
      console.error(`  Failed to fetch stops for ${id}: ${err.message}`);
    }
  }

  console.log("\n---\nCopy the operator codes and stop codes you need into config.json:");
  console.log(`
{
  "ferry": { "operator": "SB", "stops": ["7206"] },
  "bus": { "operator": "AC", "stops": ["57727", "57780"], "lines": ["O"] },
  "budget511PerHour": 55
}
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Setup failed:", err.message);
    process.exit(1);
  });
}

export { formatStop, getOperators, getStops };
