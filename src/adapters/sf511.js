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

function parseMinutes(expectedDepartureTime, aimedDepartureTime) {
  const now = new Date();
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

function normalizeStopMonitoring(rawJson, operator, stopCode, allowedLines = []) {
  // rawJson is already parsed JSON (BOM stripped, decompressed)
  // SIRI StopMonitoring structure:
  // {
  //   "ServiceDelivery": {
  //     "StopMonitoringDelivery": [{
  //       "MonitoredStopVisit": [...]
  //     }]
  //   }
  // }

  if (!rawJson || !rawJson.ServiceDelivery || !rawJson.ServiceDelivery.StopMonitoringDelivery) {
    return { stop: STOP_NAMES[stopCode] || stopCode, departures: [] };
  }

  const deliveries = rawJson.ServiceDelivery.StopMonitoringDelivery;
  if (!deliveries.length) {
    return { stop: STOP_NAMES[stopCode] || stopCode, departures: [] };
  }

  const delivery = deliveries[0];
  const visits = delivery.MonitoredStopVisit || [];
  const departures = [];

  for (const visit of visits) {
    const journey = visit.MonitoredVehicleJourney;
    if (!journey) continue;

    const lineRef = journey.LineRef || "";
    const lineName = journey.PublishedLineName || lineRef;

    // Filter by allowed lines if specified (e.g., bus.lines = ["O"])
    if (allowedLines.length > 0 && !allowedLines.includes(lineRef)) {
      continue;
    }

    const destination = journey.DestinationName || "";
    const aimedDepartureTime = journey.AimedDepartureTime;
    const expectedDepartureTime = journey.ExpectedDepartureTime;
    const minutes = parseMinutes(expectedDepartureTime, aimedDepartureTime);

    if (minutes === null) continue;

    // Determine color based on operator/line
    let color = "#ffff33"; // default yellow
    if (operator === "SB") {
      color = "#0099cc"; // blue for ferry
    } else if (operator === "AC") {
      color = "#ff9933"; // orange for AC Transit
    }

    departures.push({
      line: lineName,
      destination,
      minutes,
      platform: journey.MonitoredCall?.StopPointRef || "",
      color,
      remarks: "",
    });
  }

  // Sort by minutes ascending
  departures.sort((a, b) => a.minutes - b.minutes);

  return {
    stop: STOP_NAMES[stopCode] || stopCode,
    departures,
  };
}

export { normalizeStopMonitoring, stripBom, maybeDecompress, OPERATOR_NAMES, STOP_NAMES, parseMinutes };