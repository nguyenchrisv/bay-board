// 511 adapter tests

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { normalizeStopMonitoring, stripBom, maybeDecompress, parseMinutes, getOperatorColor, OPERATOR_NAMES, STOP_NAMES } from "../src/adapters/sf511.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "fixtures");

async function loadFixture(name) {
  const content = await readFile(join(FIXTURE_DIR, name), "utf-8");
  return JSON.parse(content.replace(/^\uFEFF/, ""));
}

describe("511 adapter - stripBom", () => {
  it("strips UTF-8 BOM from start of string", () => {
    const withBom = "\uFEFF{\"test\":true}";
    assert.equal(stripBom(withBom), "{\"test\":true}");
  });

  it("returns string unchanged if no BOM", () => {
    const withoutBom = "{\"test\":true}";
    assert.equal(stripBom(withoutBom), "{\"test\":true}");
  });

  it("handles empty string", () => {
    assert.equal(stripBom(""), "");
  });
});

describe("511 adapter - maybeDecompress", () => {
  it("returns buffer unchanged if not gzip", () => {
    const buf = Buffer.from("not gzip");
    const result = maybeDecompress(buf);
    assert.deepEqual(result, buf);
  });

  it("decompresses gzip buffer", () => {
    const original = "test content";
    const gzipped = gzipSync(Buffer.from(original));
    const result = maybeDecompress(gzipped);
    assert.equal(result.toString("utf-8"), original);
  });
});

describe("511 adapter - parseMinutes", () => {
  it("returns minutes until expected departure", () => {
    const now = new Date("2026-11-22T10:00:00-08:00");
    const expected = "2026-11-22T10:15:00-08:00";
    const aimed = "2026-11-22T10:10:00-08:00";
    assert.equal(parseMinutes(expected, aimed, now), 15);
  });

  it("returns 0 for past departure", () => {
    const now = new Date("2026-11-22T10:20:00-08:00");
    const expected = "2026-11-22T10:15:00-08:00";
    assert.equal(parseMinutes(expected, null, now), 0);
  });

  it("returns null if no times provided", () => {
    assert.equal(parseMinutes(null, null), null);
  });
});

describe("511 adapter - recorded StopMonitoring response", () => {
  let fixture;

  before(async () => {
    // Unmodified live capture from 2026-06-22:
    // https://github.com/13rac1/wheres-that-muni/blob/main/internal/transit/testdata/live_stopmonitoring.json
    fixture = await loadFixture("sf511-stopmonitoring-recorded.json");
  });

  it("normalizes object delivery and MonitoredCall times", () => {
    const now = new Date("2026-06-22T21:57:32Z");
    const result = normalizeStopMonitoring(fixture, "SF", "17999", ["N"], now);

    assert.equal(result.stop, "9th Ave & Irving St");
    assert.equal(result.departures.length, 3);
    assert.deepEqual(result.departures.map((dep) => dep.minutes), [6, 13, 21]);
    assert.deepEqual(result.departures.map((dep) => dep.line), ["JUDAH", "JUDAH", "JUDAH"]);
    assert.equal(result.departures[0].destination, "Judah/La Playa/Ocean Beach");
    assert.equal(result.departures[0].platform, "17999");
  });

  it("filters the recorded response by LineRef", () => {
    const now = new Date("2026-06-22T21:57:32Z");
    const result = normalizeStopMonitoring(fixture, "SF", "17999", ["OTHER"], now);
    assert.equal(result.departures.length, 0);
  });
});

describe("511 adapter - normalizeStopMonitoring (malformed input)", () => {
  it("handles null input", () => {
    const result = normalizeStopMonitoring(null, "SB", "7206");
    assert.equal(result.departures.length, 0);
    assert.equal(result.stop, "Harbor Bay Ferry Terminal");
  });

  it("handles missing ServiceDelivery", () => {
    const result = normalizeStopMonitoring({}, "SB", "7206");
    assert.equal(result.departures.length, 0);
  });

  it("handles missing StopMonitoringDelivery", () => {
    const result = normalizeStopMonitoring({ ServiceDelivery: {} }, "SB", "7206");
    assert.equal(result.departures.length, 0);
  });

  it("handles empty StopMonitoringDelivery array", () => {
    const result = normalizeStopMonitoring({ ServiceDelivery: { StopMonitoringDelivery: [] } }, "SB", "7206");
    assert.equal(result.departures.length, 0);
  });
});

describe("511 adapter - operator colors", () => {
  it("uses blue for SF Bay Ferry", () => {
    assert.equal(getOperatorColor("SB"), "#0099cc");
  });

  it("uses orange for AC Transit", () => {
    assert.equal(getOperatorColor("AC"), "#ff9933");
  });

  it("uses the default color for other operators", () => {
    assert.equal(getOperatorColor("SF"), "#ffff33");
  });
});

describe("511 adapter - OPERATOR_NAMES and STOP_NAMES", () => {
  it("has correct operator names", () => {
    assert.equal(OPERATOR_NAMES.SB, "SF Bay Ferry");
    assert.equal(OPERATOR_NAMES.AC, "AC Transit");
  });

  it("has correct stop names", () => {
    assert.equal(STOP_NAMES["7206"], "Harbor Bay Ferry Terminal");
    assert.equal(STOP_NAMES["57727"], "High St & Encinal Av (westbound)");
    assert.equal(STOP_NAMES["57780"], "High St & Encinal Av (eastbound)");
  });
});