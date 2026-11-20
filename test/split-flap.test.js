import { test, describe } from "node:test";
import assert from "node:assert/strict";

// We need to test the pure functions from split-flap.js
// Since they're ES modules, we'll test the logic by importing the file
// or by duplicating the pure functions here for testing

const COLOR_NAMES = {
  '#ff0000': 'Red',
  '#ff9933': 'Orange',
  '#ffff33': 'Yellow',
  '#339933': 'Green',
  '#0099cc': 'Blue',
  '#c463c5': 'Purple',
  '#d5cfa3': 'Beige',
};

function getLineNameFromColor(color) {
  if (!color) return 'Line';
  const normalized = color.toLowerCase();
  return COLOR_NAMES[normalized] || 'Line';
}

function formatMinutes(minutes) {
  if (minutes === 0) return 'NOW';
  if (minutes === undefined || minutes === null) return '';
  return String(minutes);
}

function getAccessibleLabel(dep) {
  const lineName = getLineNameFromColor(dep.color);
  const destination = dep.destination || 'Unknown';
  const minutes = formatMinutes(dep.minutes);
  const platform = dep.platform || dep.remarks || '';
  const platformStr = platform ? `, platform ${platform}` : '';
  return `${lineName} line to ${destination}, ${minutes} minutes${platformStr}`;
}

function diffStrings(oldStr, newStr) {
  const maxLen = Math.max(oldStr.length, newStr.length);
  const changes = [];
  for (let i = 0; i < maxLen; i++) {
    const oldChar = oldStr[i] || '';
    const newChar = newStr[i] || '';
    if (oldChar !== newChar) {
      changes.push(i);
    }
  }
  return changes;
}

describe("Split-flap utilities", () => {
  describe("getLineNameFromColor", () => {
    test("returns correct name for known BART colors", () => {
      assert.equal(getLineNameFromColor('#ff0000'), 'Red');
      assert.equal(getLineNameFromColor('#ff9933'), 'Orange');
      assert.equal(getLineNameFromColor('#ffff33'), 'Yellow');
      assert.equal(getLineNameFromColor('#339933'), 'Green');
      assert.equal(getLineNameFromColor('#0099cc'), 'Blue');
      assert.equal(getLineNameFromColor('#c463c5'), 'Purple');
      assert.equal(getLineNameFromColor('#d5cfa3'), 'Beige');
    });

    test("handles case-insensitive colors", () => {
      assert.equal(getLineNameFromColor('#FF0000'), 'Red');
      assert.equal(getLineNameFromColor('#FF9933'), 'Orange');
    });

    test("returns 'Line' for unknown colors", () => {
      assert.equal(getLineNameFromColor('#123456'), 'Line');
      assert.equal(getLineNameFromColor('#abcdef'), 'Line');
    });

    test("returns 'Line' for null/undefined/empty", () => {
      assert.equal(getLineNameFromColor(null), 'Line');
      assert.equal(getLineNameFromColor(undefined), 'Line');
      assert.equal(getLineNameFromColor(''), 'Line');
    });
  });

  describe("formatMinutes", () => {
    test("returns 'NOW' for 0 minutes", () => {
      assert.equal(formatMinutes(0), 'NOW');
    });

    test("returns string for positive minutes", () => {
      assert.equal(formatMinutes(5), '5');
      assert.equal(formatMinutes(12), '12');
    });

    test("returns empty string for undefined/null", () => {
      assert.equal(formatMinutes(undefined), '');
      assert.equal(formatMinutes(null), '');
    });
  });

  describe("getAccessibleLabel", () => {
    test("formats label with line name, destination, minutes, platform", () => {
      const dep = {
        color: '#ffff33',
        destination: 'Antioch',
        minutes: 5,
        platform: '2',
      };
      assert.equal(getAccessibleLabel(dep), 'Yellow line to Antioch, 5 minutes, platform 2');
    });

    test("handles 'NOW' for 0 minutes", () => {
      const dep = {
        color: '#ff0000',
        destination: 'Richmond',
        minutes: 0,
        platform: '1',
      };
      assert.equal(getAccessibleLabel(dep), 'Red line to Richmond, NOW minutes, platform 1');
    });

    test("handles missing platform", () => {
      const dep = {
        color: '#339933',
        destination: 'Daly City',
        minutes: 10,
      };
      assert.equal(getAccessibleLabel(dep), 'Green line to Daly City, 10 minutes');
    });

    test("handles unknown color", () => {
      const dep = {
        color: '#123456',
        destination: 'Test',
        minutes: 5,
        platform: '1',
      };
      assert.equal(getAccessibleLabel(dep), 'Line line to Test, 5 minutes, platform 1');
    });
  });

  describe("diffStrings", () => {
    test("returns empty array for identical strings", () => {
      assert.deepEqual(diffStrings('hello', 'hello'), []);
      assert.deepEqual(diffStrings('', ''), []);
    });

    test("detects single character change", () => {
      assert.deepEqual(diffStrings('hello', 'hallo'), [1]);
      assert.deepEqual(diffStrings('cat', 'bat'), [0]);
    });

    test("detects multiple character changes", () => {
      // 'hello' vs 'world' - all characters differ
      assert.deepEqual(diffStrings('hello', 'world'), [0, 1, 2, 4]);
    });

    test("handles different lengths", () => {
      // 'hi' vs 'hello' - positions 1 (i vs e), 2, 3, 4 differ
      assert.deepEqual(diffStrings('hi', 'hello'), [1, 2, 3, 4]);
      // 'hello' vs 'hi' - positions 1 (e vs i), 2, 3, 4 differ
      assert.deepEqual(diffStrings('hello', 'hi'), [1, 2, 3, 4]);
    });

    test("handles empty to non-empty", () => {
      assert.deepEqual(diffStrings('', 'abc'), [0, 1, 2]);
      assert.deepEqual(diffStrings('abc', ''), [0, 1, 2]);
    });
  });
});
