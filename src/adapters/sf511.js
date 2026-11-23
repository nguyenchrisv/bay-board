// 511 SF Bay adapter: pure functions to transform raw 511 SIRI StopMonitoring JSON
// into normalized board shape. Strips BOM, handles gzip magic bytes.

import { gunzipSync } from "node:zlib";

const OPERATOR_NAMES = {
  SB: "SF Bay Ferry",
  AC: "AC Transit",
};

const STOP_NAMES = {
  // Ferry stops
  "7206": "Harbor Bay Ferry Terminal",
  // AC Transit stops
  "57727": "High St & Encinal Av (westbound)",
  "57780": "High St & Encinal Av (eastbound)",
};

// Strip UTF-8 BOM if present
function stripBom(text) {
  if (text.startsWith("\uFEFF")) {
    return text.slice(1);
  }
  return text;
}

// Handle gzip-compressed responses that may arrive without Content-Encoding header
function maybeDecompress(buffer) {
  // Check for gzip magic bytes: 0x1f 0x8b
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return gunzipSync(buffer);
  }
  return buffer;
}

function parseMinutes(expectedDepartureTime, aimedDepartureTime, now = new Date()) {
  let depTime;

  if (expectedDepartureTime) {
    depTime = new Date(expectedDepartureTime);
  } else if (aimedDepartureTime) {
    depTime = new Date(aimedDepartureTime);
  } else {
    return null;
  }

  const diffMs = depTime - now;
  if (diffMs < 0) return 0;
  const minutes = Math.round(diffMs / 60000);
  return minutes;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getOperatorColor(operator) {
  if (operator === "SB") return "#0099cc";
  if (operator === "AC") return "#ff9933";
  return "#ffff33";
}

function normalizeStopMonitoring(rawJson, operator, stopCode, allowedLines = [], now = new Date()) {
  // Live 511 responses use a top-level ServiceDelivery and may encode both
  // StopMonitoringDelivery and MonitoredStopVisit as objects or arrays.
  const serviceDelivery = rawJson?.ServiceDelivery || rawJson?.Siri?.ServiceDelivery;
  const deliveries = asArray(serviceDelivery?.StopMonitoringDelivery);
  const visits = deliveries.flatMap((delivery) => asArray(delivery?.MonitoredStopVisit));
  const responseStopName = visits[0]?.MonitoredVehicleJourney?.MonitoredCall?.StopPointName;
  const stop = STOP_NAMES[stopCode] || responseStopName || stopCode;
  const departures = [];

  for (const visit of visits) {
    const journey = visit?.MonitoredVehicleJourney;
    if (!journey) continue;

    const lineRef = journey.LineRef || "";
    const lineName = journey.PublishedLineName || lineRef;

    // Filter by allowed lines if specified (e.g., bus.lines = ["O"])
    if (allowedLines.length > 0 && !allowedLines.includes(lineRef)) {
      continue;
    }

    const call = journey.MonitoredCall || {};
    const expectedTime = call.ExpectedArrivalTime || call.ExpectedDepartureTime || journey.ExpectedArrivalTime || journey.ExpectedDepartureTime;
    const aimedTime = call.AimedArrivalTime || call.AimedDepartureTime || journey.AimedArrivalTime || journey.AimedDepartureTime;
    const minutes = parseMinutes(expectedTime, aimedTime, now);

    if (minutes === null) continue;

    const color = getOperatorColor(operator);

    departures.push({
      // Use LineRef (short code) for the chip; PublishedLineName only as fallback
      line: lineRef || lineName,
      destination: journey.DestinationName || "",
      minutes,
      // No real platform data in SIRI StopMonitoring for ferry/bus — keep empty
      platform: "",
      color,
      remarks: "",
    });
  }

  departures.sort((a, b) => a.minutes - b.minutes);
  return { stop, departures };
}

export { normalizeStopMonitoring, stripBom, maybeDecompress, getOperatorColor, OPERATOR_NAMES, STOP_NAMES, parseMinutes };