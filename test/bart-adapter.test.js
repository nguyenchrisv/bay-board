import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeEtd, normalizeAdvisories, parseMinutes, getStationName } from "../src/adapters/bart.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "fixtures");

async function loadFixture(name) {
  const content = await readFile(join(FIXTURE_DIR, name), "utf-8");
  return JSON.parse(content);
}

describe("BART adapter - parseMinutes", () => {
  test("parses numeric minutes", () => {
    assert.equal(parseMinutes("5"), 5);
    assert.equal(parseMinutes("18"), 18);
  });

  test("parses 'Leaving' as 0", () => {
    assert.equal(parseMinutes("Leaving"), 0);
    assert.equal(parseMinutes("leaving"), 0);
    assert.equal(parseMinutes("  Leaving  "), 0);
  });

  test("returns null for invalid input", () => {
    assert.equal(parseMinutes(""), null);
    assert.equal(parseMinutes("invalid"), null);
    assert.equal(parseMinutes(null), null);
    assert.equal(parseMinutes(undefined), null);
  });
});

describe("BART adapter - getStationName", () => {
  test("returns full name for known abbreviations", () => {
    assert.equal(getStationName("16TH"), "16th St Mission");
    assert.equal(getStationName("EMBR"), "Embarcadero");
    assert.equal(getStationName("MONT"), "Montgomery");
  });

  test("returns abbreviation for unknown", () => {
    assert.equal(getStationName("UNKNOWN"), "UNKNOWN");
    assert.equal(getStationName("XYZ"), "XYZ");
  });
});

describe("BART adapter - normalizeEtd", () => {
  test("normal response produces sorted departures with correct fields", async () => {
    const raw = await loadFixture("bart-normal.json");
    const { station, departures } = normalizeEtd(raw);

    assert.equal(station, "16th St Mission");
    assert.equal(departures.length, 5); // 2 Antioch + 2 SFO + 1 Richmond

    // Check sorting by minutes
    assert.equal(departures[0].minutes, 3); // Richmond first
    assert.equal(departures[1].minutes, 5); // Antioch
    assert.equal(departures[2].minutes, 8); // SFO
    assert.equal(departures[3].minutes, 18); // Antioch
    assert.equal(departures[4].minutes, 22); // SFO

    // Check first departure fields
    const first = departures[0];
    assert.equal(first.line, "RICH");
    assert.equal(first.destination, "Richmond");
    assert.equal(first.minutes, 3);
    assert.equal(first.platform, "1");
    assert.equal(first.color, "#FF3333");
    assert.equal(first.remarks, "");
  });

  test("'Leaving' becomes 0 minutes", async () => {
    const raw = await loadFixture("bart-leaving.json");
    const { departures } = normalizeEtd(raw);

    assert.equal(departures.length, 2);
    assert.equal(departures[0].minutes, 0); // Leaving -> 0
    assert.equal(departures[1].minutes, 15);
  });

  test("empty etd returns empty departures", async () => {
    const raw = await loadFixture("bart-empty.json");
    const { station, departures } = normalizeEtd(raw);

    assert.equal(station, "16th St Mission");
    assert.equal(departures.length, 0);
  });

  test("missing etd field returns empty departures", async () => {
    const raw = await loadFixture("bart-error.json");
    const { station, departures } = normalizeEtd(raw);

    assert.equal(station, "16th St Mission");
    assert.equal(departures.length, 0);
  });

  test("null/undefined input returns empty", () => {
    const { station, departures } = normalizeEtd(null);
    assert.equal(station, null);
    assert.equal(departures.length, 0);

    const { station: s2, departures: d2 } = normalizeEtd(undefined);
    assert.equal(s2, null);
    assert.equal(d2.length, 0);
  });

  test("missing root returns empty", () => {
    const { station, departures } = normalizeEtd({});
    assert.equal(station, null);
    assert.equal(departures.length, 0);
  });

  test("handles single estimate (not array)", async () => {
    const raw = {
      root: {
        station: [{
          name: "Test",
          abbr: "TEST",
          etd: [{
            destination: "Test Dest",
            abbreviation: "TEST",
            estimate: {
              minutes: "5",
              platform: "1",
              color: "FFFF33",
            }
          }]
        }]
      }
    };
    const { departures } = normalizeEtd(raw);
    assert.equal(departures.length, 1);
    assert.equal(departures[0].minutes, 5);
  });

  test("handles single station (not array)", async () => {
    const raw = {
      root: {
        station: {
          name: "Test",
          abbr: "TEST",
          etd: [{
            destination: "Test Dest",
            abbreviation: "TEST",
            estimate: [{ minutes: "5", platform: "1" }]
          }]
        }
      }
    };
    const { departures } = normalizeEtd(raw);
    assert.equal(departures.length, 1);
  });
});

describe("BART adapter - normalizeAdvisories", () => {
  test("normal response returns array of descriptions", async () => {
    const raw = await loadFixture("bart-advisory-normal.json");
    const advisories = normalizeAdvisories(raw);

    assert.equal(advisories.length, 2);
    assert.ok(advisories[0].includes("Elevator at 16th St Mission"));
    assert.ok(advisories[1].includes("10-15 minute delays on Yellow Line"));
  });

  test("empty bsa returns empty array", () => {
    const raw = { root: { bsa: [] } };
    const advisories = normalizeAdvisories(raw);
    assert.equal(advisories.length, 0);
  });

  test("missing bsa returns empty array", () => {
    const raw = { root: {} };
    const advisories = normalizeAdvisories(raw);
    assert.equal(advisories.length, 0);
  });

  test("null/undefined input returns empty array", () => {
    assert.deepEqual(normalizeAdvisories(null), []);
    assert.deepEqual(normalizeAdvisories(undefined), []);
  });

  test("single bsa (not array) works", () => {
    const raw = {
      root: {
        bsa: {
          description: "Single advisory"
        }
      }
    };
    const advisories = normalizeAdvisories(raw);
    assert.equal(advisories.length, 1);
    assert.equal(advisories[0], "Single advisory");
  });
});
