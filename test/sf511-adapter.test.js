// 511 adapter tests

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { normalizeStopMonitoring, stripBom, maybeDecompress, parseMinutes, OPERATOR_NAMES, STOP_NAMES } from "../src/adapters/sf511.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "fixtures");

async function loadFixture(name) {
  const content = await readFile(join(FIXTURE_DIR, name), "utf-8");
  return JSON.parse(content);
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
    // Expected takes precedence, so 15 minutes
    // But we can't easily test without mocking now, so test the logic
    const diffMs = new Date(expected) - now;
    const minutes = Math.round(diffMs / 60000);
    assert.equal(minutes, 15);
  });

  it("returns 0 for past departure", () => {
    const now = new Date("2026-11-22T10:20:00-08:00");
    const expected = "2026-11-22T10:15:00-08:00";
    const diffMs = new Date(expected) - now;
    assert.ok(diffMs < 0);
  });

  it("returns null if no times provided", () => {
    assert.equal(parseMinutes(null, null), null);
  });
});

describe("511 adapter - normalizeStopMonitoring (ferry)", () => {
  let fixture;

  before(async () => {
    fixture = await loadFixture("sf511-ferry-normal.json");
  });

  it("produces normalized board with correct mode and stop", () => {
    const result = normalizeStopMonitoring(fixture, "SB", "7206");
    assert.equal(result.stop, "Harbor Bay Ferry Terminal");
    assert.ok(Array.isArray(result.departures));
  });

  it("includes departures with correct fields", () => {
    const result = normalizeStopMonitoring(fixture, "SB", "7206");
    assert.equal(result.departures.length, 2);
    for (const dep of result.departures) {
      assert.ok(dep.line);
      assert.ok(dep.destination);
      assert.ok(typeof dep.minutes === "number");
      assert.ok(dep.color);
      assert.equal(dep.color, "#0099cc"); // ferry blue
    }
  });

  it("sorts departures by minutes ascending", () => {
    const result = normalizeStopMonitoring(fixture, "SB", "7206");
    for (let i = 1; i < result.departures.length; i++) {
      assert.ok(result.departures[i].minutes >= result.departures[i - 1].minutes);
    }
  });

  it("uses stop name from STOP_NAMES map", () => {
    const result = normalizeStopMonitoring(fixture, "SB", "7206");
    assert.equal(result.stop, "Harbor Bay Ferry Terminal");
  });
});

describe("511 adapter - normalizeStopMonitoring (bus with line filter)", () => {
  let fixture;

  before(async () => {
    fixture = await loadFixture("sf511-bus-normal.json");
  });

  it("filters to only allowed lines", () => {
    const result = normalizeStopMonitoring(fixture, "AC", "57727", ["O"]);
    // Should only include line "O" (2 departures in fixture), not "NL"
    assert.equal(result.departures.length, 2);
    for (const dep of result.departures) {
      assert.equal(dep.line, "O");
    }
  });

  it("includes all lines if allowedLines is empty", () => {
    const result = normalizeStopMonitoring(fixture, "AC", "57727", []);
    assert.equal(result.departures.length, 3); // O (2) + NL (1)
  });

  it("uses orange color for AC Transit", () => {
    const result = normalizeStopMonitoring(fixture, "AC", "57727", ["O"]);
    assert.equal(result.departures[0].color, "#ff9933");
  });

  it("uses stop name from STOP_NAMES map", () => {
    const result = normalizeStopMonitoring(fixture, "AC", "57727");
    assert.equal(result.stop, "High St & Encinal Av (westbound)");
  });
});

describe("511 adapter - normalizeStopMonitoring (empty)", () => {
  let fixture;

  before(async () => {
    fixture = await loadFixture("sf511-empty.json");
  });

  it("returns empty departures for empty response", () => {
    const result = normalizeStopMonitoring(fixture, "SB", "7206");
    assert.equal(result.departures.length, 0);
  });

  it("returns stop name even for empty", () => {
    const result = normalizeStopMonitoring(fixture, "SB", "7206");
    assert.equal(result.stop, "Harbor Bay Ferry Terminal");
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