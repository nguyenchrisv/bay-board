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

  test("pads short names with blanks so every row is 12 tiles", () => {
    assert.equal(formatDestination("Daly City"), "Daly City   ");
    assert.equal(formatDestination("Antioch"), "Antioch     ");
  });

  test("returns 12 characters for every input", () => {
    for (const input of ["Richmond", "", null, undefined, "Berryessa WTF"]) {
      assert.equal(formatDestination(input).length, 12);
    }
  });

  test("leaves names of exactly 12 characters unchanged", () => {
    assert.equal(formatDestination("Pleasanton W"), "Pleasanton W");
  });
});

describe("chipLabel", () => {
  test("shortens line names to at most 3 characters", () => {
    assert.equal(chipLabel("Yellow"), "Yel");
    assert.equal(chipLabel("Green"), "Gre");
    assert.equal(chipLabel("Orange"), "Ora");
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
