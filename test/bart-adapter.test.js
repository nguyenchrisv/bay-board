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
    assert.equal(getStationName("FTVL"), "Fruitvale");
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

    assert.equal(station, "Fruitvale");
    // 12 departures total: 3 Berryessa + 3 Daly City + 3 Dublin/Pleasanton + 3 Richmond
    assert.equal(departures.length, 12);

    // Check sorting by minutes ascending
    assert.equal(departures[0].minutes, 1);  // Daly City
    assert.equal(departures[1].minutes, 7);  // Berryessa
    assert.equal(departures[2].minutes, 10); // Berryessa
    assert.equal(departures[3].minutes, 11); // Daly City
    assert.equal(departures[4].minutes, 14); // Dublin/Pleasanton
    assert.equal(departures[5].minutes, 16); // Richmond
    assert.equal(departures[6].minutes, 19); // Daly City
    assert.equal(departures[7].minutes, 26); // Berryessa
    assert.equal(departures[8].minutes, 34); // Dublin/Pleasanton
    assert.equal(departures[9].minutes, 36); // Richmond
    assert.equal(departures[10].minutes, 54); // Dublin/Pleasanton
    assert.equal(departures[11].minutes, 56); // Richmond

    // Check first departure fields
    const first = departures[0];
    assert.equal(first.line, "DALY");
    assert.equal(first.destination, "Daly City");
    assert.equal(first.minutes, 1);
    assert.equal(first.platform, "2");
    assert.equal(first.color, "#339933"); // GREEN
    assert.equal(first.remarks, "");
  });

  test("colors are valid hex format from recorded fixture", async () => {
    const raw = await loadFixture("bart-normal.json");
    const { departures } = normalizeEtd(raw);

    for (const dep of departures) {
      assert.match(dep.color, /^#[0-9a-f]{6}$/i, `Color ${dep.color} should be valid hex`);
    }
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
              hexcolor: "#ffff33",
            }
          }]
        }]
      }
    };
    const { departures } = normalizeEtd(raw);
    assert.equal(departures.length, 1);
    assert.equal(departures[0].minutes, 5);
    assert.equal(departures[0].color, "#ffff33");
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
            estimate: [{ minutes: "5", platform: "1", hexcolor: "#ffff33" }]
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

    assert.equal(advisories.length, 1);
    assert.equal(advisories[0], "No advisories issued.");
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
