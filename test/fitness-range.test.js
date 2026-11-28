import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RANGES, rangeStart, rangeTitle, computeRangeTotals, scaleGoal, activityTypesByCount } from "../public/fitness-card-utils.js";

const DAY = 86400000;
const now = Date.parse("2026-11-27T20:00:00Z");
const at = (daysAgo, extra) => ({ start_date: new Date(now - daysAgo * DAY).toISOString(), ...extra });
const acts = [
  at(1, { sport_type: "Ride", type: "Ride", distance: 30000, moving_time: 3600 }),
  at(20, { sport_type: "Ride", type: "Ride", distance: 50000, moving_time: 7200 }),
  at(45, { sport_type: "Ride", type: "Ride", distance: 40000, moving_time: 5400 }),
  at(80, { sport_type: "Ride", type: "Ride", distance: 60000, moving_time: 9000 }),
  at(200, { sport_type: "Ride", type: "Ride", distance: 70000, moving_time: 10800 }),
  at(3, { sport_type: "Run", type: "Run", distance: 8000, moving_time: 2400 }),
  at(5, { sport_type: "Run", type: "Run", distance: 5000, moving_time: 1500 }),
  at(10, { sport_type: "Soccer", type: "Workout", distance: 0, moving_time: 3600 }),
];

describe("fitness ranges", () => {
  test("offers 7/30/60/90 days and YTD", () => {
    assert.deepEqual(RANGES, ["7", "30", "60", "90", "ytd"]);
    assert.equal(rangeTitle("30"), "LAST 30 DAYS");
    assert.equal(rangeTitle("ytd"), "YEAR TO DATE");
  });

  test("totals per range", () => {
    const d = (r) => computeRangeTotals(acts, "Ride", rangeStart(r, now)).distanceMeters;
    assert.equal(d("7"), 30000);
    assert.equal(d("30"), 80000);
    assert.equal(d("60"), 120000);
    assert.equal(d("90"), 180000);
    assert.equal(d("ytd"), 250000);
  });

  test("average speed is distance over moving time", () => {
    const t = computeRangeTotals(acts, "Ride", rangeStart("30", now));
    assert.equal(t.count, 2);
    assert.ok(Math.abs(t.avgSpeed - 80000 / 10800) < 1e-9);
    assert.equal(computeRangeTotals([], "Ride", 0).avgSpeed, 0);
  });

  test("matches sport_type or type", () => {
    assert.equal(computeRangeTotals(acts, "Soccer", rangeStart("30", now)).count, 1);
    assert.equal(computeRangeTotals(acts, "Workout", rangeStart("30", now)).count, 1);
  });

  test("weekly goals scale with the range", () => {
    const g = scaleGoal({ distance: 7000, time: 700 }, "30", now);
    assert.ok(Math.abs(g.distance - 30000) < 1e-6);
    assert.ok(Math.abs(g.time - 3000) < 1e-6);
    assert.ok(Math.abs(scaleGoal({ distance: 7, time: 7 }, "7", now).distance - 7) < 1e-9);
  });

  test("activity tabs come from the data, most frequent first", () => {
    assert.deepEqual(activityTypesByCount(acts), ["Ride", "Run", "Soccer"]);
    assert.deepEqual(activityTypesByCount(acts, 1), ["Ride"]);
    assert.deepEqual(activityTypesByCount([]), []);
  });
});
