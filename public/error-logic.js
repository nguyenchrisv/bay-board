// Shared error handling logic for bay-board
// DOM-free module that can be imported by both the app and tests

/**
 * Maximum number of consecutive failures before showing ERROR state.
 * @type {number}
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Determines if an error should be shown for a board.
 *
 * @param {boolean} hasGoodData - Whether we've ever received good data for this board
 * @param {number} consecutiveFailures - Number of consecutive failures
 * @param {number} [maxConsecutiveFailures=MAX_CONSECUTIVE_FAILURES] - Maximum allowed consecutive failures before showing error
 * @returns {boolean} - True if error should be shown
 */
export function shouldShowError(hasGoodData, consecutiveFailures, maxConsecutiveFailures = MAX_CONSECUTIVE_FAILURES) {
  return !hasGoodData || consecutiveFailures >= maxConsecutiveFailures;
}

/**
 * Resets the consecutive failure count for a mode.
 *
 * @param {Object<string, number>} consecutiveFailures - Object mapping mode names to failure counts
 * @param {string} mode - Mode to reset
 */
export function resetConsecutiveFailures(consecutiveFailures, mode) {
  if (consecutiveFailures[mode] !== undefined) {
    consecutiveFailures[mode] = 0;
  }
}

/**
 * Marks a mode as having received good data.
 *
 * @param {Object<string, boolean>} hasGoodData - Object mapping mode names to boolean flags
 * @param {string} mode - Mode to mark
 */
export function markGoodDataReceived(hasGoodData, mode) {
  if (hasGoodData[mode] !== undefined) {
    hasGoodData[mode] = true;
  }
}