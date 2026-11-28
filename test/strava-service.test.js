import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createStravaService, stravaSettings, historyStart, REFRESH_MS, RETRY_MS } from "../src/services/strava.js";

const FIX = new URL("./fixtures/", import.meta.url);
const load = async (n) => JSON.parse((await readFile(new URL(n, FIX), "utf-8")).replace(/^﻿/, ""));
const quiet = { warn() {} };

async function fixtures() {
  return {
    athlete: await load("strava-athlete.json"),
    stats: await load("strava-athlete-stats.json"),
    activities: await load("strava-activities.json"),
    clubs: await load("strava-clubs.json"),
    events: {
      9001: await load("strava-club-9001-group-events.json"),
      9002: await load("strava-club-9002-group-events.json"),
      9003: await load("strava-club-9003-group-events.json"),
      9004: await load("strava-club-9004-group-events.json"),
    },
  };
}

function mockStrava(fx, { failAll = false, rotateTo = null } = {}) {
  const calls = [];
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (failAll) return { ok: false, status: 500, json: async () => ({}) };
    if (url.includes("/oauth/token")) {
      return json({ access_token: "AT", expires_at: 4102444800, refresh_token: rotateTo || new URLSearchParams(opts.body).get("refresh_token") });
    }
    const path = new URL(url).pathname.replace("/api/v3", "");
    if (path === "/athlete") return json(fx.athlete);
    if (/^\/athletes\/\d+\/stats$/.test(path)) return json(fx.stats);
    if (path === "/athlete/activities") {
      const page = Number(new URL(url).searchParams.get("page"));
      return json(page === 1 ? fx.activities : []);
    }
    if (path === "/athlete/clubs") return json(fx.clubs);
    const m = path.match(/^\/clubs\/(\d+)\/group_events$/);
    if (m) return fx.events[m[1]] ? json(fx.events[m[1]]) : { ok: false, status: 403, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

const creds = { clientId: "1", clientSecret: "s", refreshToken: "r1" };

describe("Strava service", () => {
  test("normalizes athlete, stats, activities, clubs and group events", async () => {
    const fx = await fixtures();
    const { fetchImpl, calls } = mockStrava(fx);
    const svc = createStravaService({ ...creds, fetchImpl, logger: quiet });
    const d = await svc.getData();
    assert.deepEqual(Object.keys(d.athlete).sort(), ["firstname", "id", "lastname"]);
    assert.ok(d.stats.recent_ride_totals);
    assert.equal(d.activities.length, fx.activities.length);
    assert.ok(!("athlete" in d.activities[0]), "activities are slimmed");
    assert.ok(d.activities[0].distance >= 0 && d.activities[0].moving_time >= 0);
    assert.equal(d.clubs.length, 4);
    assert.ok(Array.isArray(d.groupEvents["9003"]));
    assert.ok(d.updatedAt);
    // Bearer token, never secrets, on API calls
    const apiCall = calls.find((c) => c.url.includes("/api/v3/athlete"));
    assert.equal(apiCall.opts.headers.Authorization, "Bearer AT");
    assert.ok(!apiCall.url.includes("s") || !apiCall.url.includes("client_secret"));
  });

  test("activities request reaches back to Jan 1 or 90 days, whichever is earlier", async () => {
    const fx = await fixtures();
    const { fetchImpl, calls } = mockStrava(fx);
    const now = Date.parse("2026-02-15T12:00:00Z");
    const svc = createStravaService({ ...creds, fetchImpl, nowImpl: () => now, logger: quiet });
    await svc.getData();
    const after = Number(new URL(calls.find((c) => c.url.includes("/athlete/activities")).url).searchParams.get("after"));
    assert.equal(after, Math.floor(historyStart(now) / 1000));
    assert.ok(after * 1000 <= now - 90 * 86400000);
    const nov = Date.parse("2026-11-27T12:00:00Z");
    assert.ok(historyStart(nov) <= new Date(2026, 0, 1).getTime());
  });

  test("calls the live API at most once an hour", async () => {
    const fx = await fixtures();
    const { fetchImpl, calls } = mockStrava(fx);
    let now = 1_000_000;
    const svc = createStravaService({ ...creds, fetchImpl, nowImpl: () => now, logger: quiet });
    await svc.getData();
    const n = calls.length;
    now += REFRESH_MS - 1;
    await svc.getData();
    assert.equal(calls.length, n, "served from cache within the hour");
    now += 2;
    await svc.getData();
    assert.ok(calls.length > n, "refreshes after an hour");
  });

  test("concurrent requests share one refresh", async () => {
    const fx = await fixtures();
    const { fetchImpl, calls } = mockStrava(fx);
    const svc = createStravaService({ ...creds, fetchImpl, logger: quiet });
    await Promise.all([svc.getData(), svc.getData(), svc.getData()]);
    assert.equal(calls.filter((c) => c.url.includes("/oauth/token")).length, 1);
  });

  test("keeps serving last good data marked stale when a refresh fails", async () => {
    const fx = await fixtures();
    let fail = false;
    const ok = mockStrava(fx).fetchImpl;
    const bad = mockStrava(fx, { failAll: true }).fetchImpl;
    let now = 0;
    const svc = createStravaService({ ...creds, fetchImpl: (...a) => (fail ? bad(...a) : ok(...a)), nowImpl: () => now, logger: quiet });
    const good = await svc.getData();
    fail = true;
    now += REFRESH_MS + 1;
    const stale = await svc.getData();
    assert.equal(stale.stale, true);
    assert.equal(stale.activities.length, good.activities.length);
  });

  test("throws when nothing is cached, then waits before retrying", async () => {
    const { fetchImpl, calls } = mockStrava(await fixtures(), { failAll: true });
    let now = 0;
    const svc = createStravaService({ ...creds, fetchImpl, nowImpl: () => now, logger: quiet });
    await assert.rejects(svc.getData());
    const n = calls.length;
    await assert.rejects(svc.getData());
    assert.equal(calls.length, n, "no hammering while waiting");
    now += RETRY_MS + 1;
    await assert.rejects(svc.getData());
    assert.ok(calls.length > n);
  });

  test("saves a rotated refresh token and prefers it next time", async () => {
    const fx = await fixtures();
    const files = {};
    const io = {
      readFileImpl: async (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
      writeFileImpl: async (p, d) => { files[p] = d; },
    };
    const { fetchImpl } = mockStrava(fx, { rotateTo: "r2" });
    await createStravaService({ ...creds, tokenFile: "/state/t.json", fetchImpl, logger: quiet, ...io }).getData();
    assert.equal(JSON.parse(files["/state/t.json"]).refresh_token, "r2");
    const second = mockStrava(fx);
    await createStravaService({ ...creds, tokenFile: "/state/t.json", fetchImpl: second.fetchImpl, logger: quiet, ...io }).getData();
    const body = new URLSearchParams(second.calls.find((c) => c.url.includes("/oauth/token")).opts.body);
    assert.equal(body.get("refresh_token"), "r2");
  });

  test("stravaSettings needs all three secrets", () => {
    assert.equal(stravaSettings({}, {}), null);
    assert.equal(stravaSettings({}, { STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: "s" }), null);
    const s = stravaSettings({}, { STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: "s", STRAVA_REFRESH_TOKEN: "r", STRAVA_TOKEN_FILE: "/state/t.json" });
    assert.equal(s.tokenFile, "/state/t.json");
  });
});
