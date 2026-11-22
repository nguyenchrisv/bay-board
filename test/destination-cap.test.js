import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Regression tests for issue #6: destinations are capped at 12 split-flap
// tiles and line chips use a short visual label. These import the real
// module from public/ (it has no DOM calls at import time).
import { formatDestination, chipLabel } from "../public/split-flap.js";

describe("formatDestination", () => {
  test("caps names longer than 12 tiles", () => {
    assert.equal(formatDestination("Dublin/Pleasanton"), "Dublin/Pleas");
    assert.equal(formatDestination("DUBLIN/PLEASANTON"), "DUBLIN/PLEAS");
  });

  test("does not pad short names (no trailing blanks)", () => {
    assert.equal(formatDestination("Daly City"), "Daly City");
    assert.equal(formatDestination("Antioch"), "Antioch");
  });

  test("returns at most 12 characters for every input", () => {
    for (const input of ["Richmond", "", null, undefined, "Berryessa North"]) {
      assert.ok(formatDestination(input).length <= 12);
    }
  });

  test("leaves names of exactly 12 characters unchanged", () => {
    assert.equal(formatDestination("Pleasanton W"), "Pleasanton W");
  });

  test("caps at 10 tiles on narrow screens", () => {
    assert.equal(formatDestination("Dublin/Pleasanton", 10), "Dublin/Ple");
    assert.equal(formatDestination("Richmond", 10), "Richmond");
  });

  test("never returns more tiles than the cap allows", () => {
    for (const cap of [10, 12]) {
      for (const input of ["Richmond", "", null, undefined, "Dublin/Pleasanton"]) {
        assert.ok(formatDestination(input, cap).length <= cap);
      }
    }
  });
});

describe("chipLabel", () => {
  test("shortens destination abbreviations to at most 3 characters", () => {
    // Real BART destination abbreviations from API
    assert.equal(chipLabel("RICH"), "RIC");
    assert.equal(chipLabel("DUBL"), "DUB");
    assert.equal(chipLabel("BERY"), "BER");
    assert.equal(chipLabel("DALY"), "DAL");
  });

  test("keeps short line codes as-is", () => {
    assert.equal(chipLabel("O"), "O");
    assert.equal(chipLabel("HB"), "HB");
  });

  test("handles missing line names", () => {
    assert.equal(chipLabel(""), "");
    assert.equal(chipLabel(undefined), "");
    assert.equal(chipLabel(null), "");
  });
});