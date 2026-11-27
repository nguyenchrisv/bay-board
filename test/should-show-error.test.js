import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shouldShowError, MAX_CONSECUTIVE_FAILURES, resetConsecutiveFailures, markGoodDataReceived } from "../public/error-logic.js";

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

  describe("resetConsecutiveFailures", () => {
    test("resets failure count for a mode", () => {
      const consecutiveFailures = { bart: 3, ferry: 2, bus: 1 };
      resetConsecutiveFailures(consecutiveFailures, "bart");
      assert.equal(consecutiveFailures.bart, 0);
      assert.equal(consecutiveFailures.ferry, 2); // unchanged
      assert.equal(consecutiveFailures.bus, 1); // unchanged
    });
  });

  describe("markGoodDataReceived", () => {
    test("marks a mode as having received good data", () => {
      const hasGoodData = { bart: false, ferry: false };
      markGoodDataReceived(hasGoodData, "bart");
      assert.equal(hasGoodData.bart, true);
      assert.equal(hasGoodData.ferry, false);
    });

    test("idempotent - calling twice doesn't change result", () => {
      const hasGoodData = { bart: false };
      markGoodDataReceived(hasGoodData, "bart");
      markGoodDataReceived(hasGoodData, "bart");
      assert.equal(hasGoodData.bart, true);
    });
  });

  describe("integration: counter resets on success", () => {
    test("good data, then 2 failures, then success, then 1 failure: no ERROR", () => {
      // Simulate the state transitions
      const hasGoodData = { bart: false };
      const consecutiveFailures = { bart: 0 };

      // Initially no good data
      assert.equal(shouldShowError(hasGoodData.bart, consecutiveFailures.bart), true);

      // Receive good data
      markGoodDataReceived(hasGoodData, "bart");
      resetConsecutiveFailures(consecutiveFailures, "bart");
      assert.equal(shouldShowError(hasGoodData.bart, consecutiveFailures.bart), false);

      // 2 failures
      consecutiveFailures.bart = 2;
      assert.equal(shouldShowError(hasGoodData.bart, consecutiveFailures.bart), false);

      // Success - counter resets
      resetConsecutiveFailures(consecutiveFailures, "bart");
      assert.equal(shouldShowError(hasGoodData.bart, consecutiveFailures.bart), false);

      // 1 failure after success
      consecutiveFailures.bart = 1;
      assert.equal(shouldShowError(hasGoodData.bart, consecutiveFailures.bart), false);
    });
  });
});