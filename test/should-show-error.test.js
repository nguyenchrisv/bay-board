import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Pure function for determining if error should be shown
const MAX_CONSECUTIVE_FAILURES = 3;

function shouldShowError(hasGoodData, consecutiveFailures, maxConsecutiveFailures = MAX_CONSECUTIVE_FAILURES) {
  return !hasGoodData || consecutiveFailures >= maxConsecutiveFailures;
}

describe("shouldShowError pure function", () => {
  describe("when no good data has been received", () => {
    test("returns true on first failure (0 consecutive failures)", () => {
      assert.equal(shouldShowError(false, 0), true);
    });

    test("returns true on subsequent failures", () => {
      assert.equal(shouldShowError(false, 1), true);
      assert.equal(shouldShowError(false, 2), true);
      assert.equal(shouldShowError(false, 3), true);
    });
  });

  describe("when good data has been received", () => {
    test("returns false on first failure (1 consecutive failure, max 3)", () => {
      assert.equal(shouldShowError(true, 1), false);
    });

    test("returns false on second failure (2 consecutive failures, max 3)", () => {
      assert.equal(shouldShowError(true, 2), false);
    });

    test("returns false on third failure (3 consecutive failures, max 3)", () => {
      assert.equal(shouldShowError(true, 3), true);
    });

    test("returns true on fourth failure (4 consecutive failures, max 3)", () => {
      assert.equal(shouldShowError(true, 4), true);
    });
  });

  describe("custom maxConsecutiveFailures", () => {
    test("uses custom max value", () => {
      assert.equal(shouldShowError(true, 1, 1), true);
      assert.equal(shouldShowError(true, 1, 5), false);
      assert.equal(shouldShowError(false, 0, 5), true);
    });
  });

  describe("edge cases", () => {
    test("handles zero maxConsecutiveFailures", () => {
      assert.equal(shouldShowError(true, 0, 0), true);
      assert.equal(shouldShowError(false, 0, 0), true);
    });

    test("handles negative consecutiveFailures gracefully", () => {
      assert.equal(shouldShowError(true, -1), false);
      assert.equal(shouldShowError(false, -1), true);
    });
  });
});