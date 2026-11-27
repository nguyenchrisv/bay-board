// Strava backend service (issue #20).
// Pulls athlete, stats, recent activities, clubs and upcoming group rides at most
// once an hour and serves the cached result. Secrets stay server-side; the browser
// only ever sees the normalized payload.

import { readFile, writeFile, rename } from "node:fs/promises";

const API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";

export const REFRESH_MS = 60 * 60 * 1000; // live API at most hourly
export const RETRY_MS = 5 * 60 * 1000; // retry sooner when we have nothing cached yet
export const MIN_HISTORY_DAYS = 90;
const PER_PAGE = 200;
const MAX_PAGES = 10;
const MAX_CLUBS = 10;

const ACTIVITY_FIELDS = [
  "id", "name", "type", "sport_type", "start_date", "start_date_local",
  "distance", "moving_time", "elapsed_time", "average_speed",
  "total_elevation_gain", "trainer", "commute",
];
const EVENT_FIELDS = [
  "id", "title", "activity_type", "upcoming_occurrences", "address",
  "skill_levels", "terrain", "women_only", "private", "club_id", "route_id",
];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f];
  return out;
}

// Earliest activity start we need: Jan 1 (for YTD) or 90 days back, whichever is earlier.
export function historyStart(nowMs) {
  const now = new Date(nowMs);
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  return Math.min(yearStart, nowMs - MIN_HISTORY_DAYS * 24 * 60 * 60 * 1000);
}

export function createStravaService({
  clientId,
  clientSecret,
  refreshToken,
  tokenFile = null,
  fetchImpl = fetch,
  nowImpl = () => Date.now(),
  readFileImpl = readFile,
  writeFileImpl = async (path, data) => {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, path);
  },
  logger = console,
}) {
  let currentRefresh = refreshToken;
  let tokenLoaded = false;
  let accessToken = null;
  let accessExpiresAt = 0;
  let cache = null;
  let lastAttempt = null;
  let lastOk = false;
  let inflight = null;

  async function loadSavedToken() {
    if (tokenLoaded) return;
    tokenLoaded = true;
    if (!tokenFile) return;
    try {
      const saved = JSON.parse(await readFileImpl(tokenFile, "utf-8"));
      if (saved && typeof saved.refresh_token === "string" && saved.refresh_token) {
        currentRefresh = saved.refresh_token;
      }
    } catch {
      // no saved token yet; use the one from the env
    }
  }

  async function getAccessToken() {
    await loadSavedToken();
    if (accessToken && nowImpl() < accessExpiresAt - 60_000) return accessToken;
    const body = new URLSearchParams({
      client_id: String(clientId),
      client_secret: String(clientSecret),
      grant_type: "refresh_token",
      refresh_token: String(currentRefresh),
    });
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Strava token refresh failed: HTTP ${res.status}`);
    const tok = await res.json();
    if (!tok.access_token) throw new Error("Strava token refresh returned no access token");
    accessToken = tok.access_token;
    accessExpiresAt = (tok.expires_at ? tok.expires_at * 1000 : nowImpl() + 3600_000);
    // Strava can rotate the refresh token; always keep the newest one.
    if (tok.refresh_token && tok.refresh_token !== currentRefresh) {
      currentRefresh = tok.refresh_token;
      if (tokenFile) {
        try {
          await writeFileImpl(tokenFile, JSON.stringify({ refresh_token: currentRefresh }));
        } catch (err) {
          logger.warn?.(`strava: could not save rotated refresh token: ${err.message}`);
        }
      }
    }
    return accessToken;
  }

  async function api(path) {
    const token = await getAccessToken();
    const res = await fetchImpl(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = new Error(`Strava ${path.split("?")[0]}: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function fetchAll() {
    const now = nowImpl();
    const athleteRaw = await api("/athlete");
    const athlete = pick(athleteRaw, ["id", "firstname", "lastname"]);

    let stats = null;
    try {
      stats = await api(`/athletes/${athlete.id}/stats`);
    } catch (err) {
      logger.warn?.(`strava: stats unavailable: ${err.message}`);
    }

    const after = Math.floor(historyStart(now) / 1000);
    const activities = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await api(`/athlete/activities?after=${after}&per_page=${PER_PAGE}&page=${page}`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const a of batch) activities.push(pick(a, ACTIVITY_FIELDS));
      if (batch.length < PER_PAGE) break;
    }
    activities.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

    let clubs = [];
    const groupEvents = {};
    try {
      const clubsRaw = await api("/athlete/clubs");
      clubs = (Array.isArray(clubsRaw) ? clubsRaw : [])
        .slice(0, MAX_CLUBS)
        .map((c) => pick(c, ["id", "name", "sport_type", "city", "member_count"]));
      for (const club of clubs) {
        try {
          const events = await api(`/clubs/${club.id}/group_events?upcoming=true`);
          groupEvents[String(club.id)] = (Array.isArray(events) ? events : []).map((e) => pick(e, EVENT_FIELDS));
        } catch (err) {
          logger.warn?.(`strava: group events for club ${club.id} unavailable: ${err.message}`);
          groupEvents[String(club.id)] = [];
        }
      }
    } catch (err) {
      logger.warn?.(`strava: clubs unavailable: ${err.message}`);
    }

    return {
      athlete,
      stats,
      activities,
      clubs,
      groupEvents,
      updatedAt: new Date(now).toISOString(),
    };
  }

  async function getData() {
    if (inflight) return inflight;
    const now = nowImpl();
    const wait = cache ? REFRESH_MS : RETRY_MS;
    if (lastAttempt !== null && now - lastAttempt < wait) {
      if (cache) return lastOk ? cache : { ...cache, stale: true };
      throw new Error("Strava unavailable (waiting to retry)");
    }
    lastAttempt = now;
    inflight = (async () => {
      try {
        cache = await fetchAll();
        lastOk = true;
        return cache;
      } catch (err) {
        logger.warn?.(`strava: refresh failed: ${err.message}`);
        if (cache) {
          // keep serving the last good data; retry on the normal hourly cadence
          lastOk = false;
          return { ...cache, stale: true };
        }
        lastOk = false;
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return { getData };
}

export function stravaSettings(config, env = process.env) {
  const clientId = env.STRAVA_CLIENT_ID || config?.strava?.clientId;
  const clientSecret = env.STRAVA_CLIENT_SECRET || config?.strava?.clientSecret;
  const refreshToken = env.STRAVA_REFRESH_TOKEN || config?.strava?.refreshToken;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    tokenFile: env.STRAVA_TOKEN_FILE || config?.strava?.tokenFile || null,
  };
}
