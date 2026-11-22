import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatStop, getOperators, getStops } from "../scripts/setup-511.mjs";

test("operator parser accepts the documented content envelope", () => {
  assert.deepEqual(getOperators({ content: [] }), []);
});

test("stop parser reads a recorded 511 response", async () => {
  // Unmodified live capture from 2026-06-22:
  // https://github.com/13rac1/wheres-that-muni/blob/main/internal/transit/testdata/live_stops.json
  const url = new URL("./fixtures/sf511-stops-recorded.json", import.meta.url);
  const text = await readFile(url, "utf8");
  const payload = JSON.parse(text.replace(/^\uFEFF/, ""));
  const stops = getStops(payload);

  assert.equal(stops.length, 64);
  assert.equal(stops[0].id, "17999");
  assert.equal(stops[0].Name, "9th Ave & Irving St");
  assert.equal(formatStop(stops[0]), "17999: 9th Ave & Irving St");
});
