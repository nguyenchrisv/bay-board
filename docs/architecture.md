# Bay Board: Architecture and Task Plan

A responsive Bay Area transit departures dashboard showing **BART**, **SF Bay Ferry** and **AC Transit** buses, styled as a **1970s airport split-flap departures board**, in a light, warm palette. It works on desktop browsers and phones.

Reference for patterns (read-only): the owner's earlier `nguyenchrisv/dash` repo already has a BART integration (`/api/bart`), a mock ferry feed, and caching. Port ideas by hand; don't copy unrelated features (Strava, markets, weather) or add its dependencies (Express, dotenv, cors).

---

## 1. Data sources
| Mode | Source | Auth (env var) | Refresh |
|---|---|---|---|
| BART departures | `https://api.bart.gov/api/etd.aspx?cmd=etd&orig=<STN>&key=<KEY>&json=y` | `BART_API_KEY` (BART's public test key `MW9S-E7SL-26DU-VV8V` is fine for development) | every 30 s |
| BART advisories | `https://api.bart.gov/api/bsa.aspx?cmd=bsa&key=<KEY>&json=y` | `BART_API_KEY` | every 2 min |
| Ferry + AC Transit | 511 SIRI StopMonitoring: `https://api.511.org/transit/StopMonitoring?api_key=<KEY>&agency=<OP>&stopCode=<ID>&format=json` | `API_511_KEY` | budgeted (see below) |

**511 rate limit: 60 requests/hour per key, shared by every endpoint.**
- The server keeps a request budget of **≤ 55/hour** and spreads it across configured stops.
- Browsers never trigger 511 calls; they read the server's cache.
- 511 JSON may start with a UTF-8 BOM. Strip it before `JSON.parse`.
- **511 responses can arrive gzip-compressed even when the client didn't ask for it** (seen 2026-11-20 on `/transit/operators`; the body started with `1f 8b`). Node's `fetch` decompresses automatically when `Content-Encoding: gzip` is set; still check for the gzip magic bytes and use `node:zlib` `gunzipSync` as a fallback. Recorded fixtures should be stored decompressed.
- **Operator ids (confirmed 2026-11-20 via `/transit/operators`):** San Francisco Bay Ferry = **`SB`**, AC Transit = **`AC`** (both have real-time data). BART is also on 511 as `BA`, but we use BART's own API to keep the 511 budget free. Stop codes are looked up once with a setup script (Task 4) and stored in `config.json`.

## 2. Server design
- Node ≥22, standard library only: `node:http`, global `fetch`, `node:fs/promises`, `node:path`.
- Modules (suggested):
  - `src/server.js`: HTTP routing and startup
  - `src/static.js`: safe static file serving from `public/`
  - `src/config.js`: loads `config.json` + environment (+ optional gitignored `.env` via a tiny built-in parser)
  - `src/adapters/bart.js`, `src/adapters/sf511.js`: **pure** functions, raw API JSON → normalized shape
  - `src/poller.js`: schedules fetches, owns the cache and the 511 budget
- Routes:
  - `GET /` and static assets from `public/`
  - `GET /api/health` → `{ ok: true, time, version }`
  - `GET /api/board` → all configured boards from cache
  - `GET /api/board/:mode` → one mode (`bart` | `ferry` | `bus`)
- **Normalized board shape** (every mode):
  ```json
  { "mode": "bart", "stop": "16th St Mission", "updatedAt": "2026-11-20T10:00:00Z", "stale": false,
    "error": null,
    "departures": [ { "line": "Yellow", "destination": "Antioch", "minutes": 4,
                      "platform": "2", "color": "#ffff33", "remarks": "" } ] }
  ```
- Failures never crash the server. The board keeps its last good data, `stale: true`, and an `error` message.

## 3. Visual design: "1970s airport, light edition"
| Token | Value | Use |
|---|---|---|
| `--paper` | `#F0EEE6` | page background (warm ivory) |
| `--flap` | `#FAF9F5` | split-flap tile face |
| `--flap-edge` | `#E3DFD3` | tile seam / hinge line |
| `--ink` | `#141413` | characters and primary text |
| `--ink-muted` | `#5E5D59` | secondary text, timestamps |
| `--accent` | `#D97757` | header band, BOARDING/now highlights, focus rings |
| `--warn` | `#B85C38` | DELAYED / STALE badges |
| `--ok` | `#5A7D5A` | ON TIME |

- **Split-flap rows:** each character sits in its own tile with a horizontal hinge line. On change, the tile flips (CSS 3D `rotateX`, top and bottom halves) and briefly cycles before landing. With `prefers-reduced-motion: reduce`, values swap instantly.
- **Type:** bold grotesk system stack `"Helvetica Neue", Helvetica, Arial, sans-serif`; uppercase; wide letter-spacing; `font-variant-numeric: tabular-nums`. No web fonts.
- **Header band (accent):** "DEPARTURES" plus a live HH:MM clock. Each board shows its mode pictogram, stop name and "UPDATED HH:MM". A STALE badge appears when data is old.
- **Pictograms:** simple original inline SVGs (train, ferry, bus), drawn in this repo.
- **Columns:** LINE · DESTINATION · MIN · PLATFORM/REMARKS. BART line colour as a small chip; colour is never the only signal.
- **Responsive:**
  - ≥ 900 px: three boards side by side
  - 600–899 px: two plus one
  - < 600 px: stacked, with mode tabs pinned at the top, tap targets ≥ 44 px
- **Accessibility:** each row also has a plain-text accessible label; the animation is decorative; WCAG AA contrast.

## 4. Configuration
`config.json` (committed, no secrets):
```json
{ "bart": { "stations": ["16TH"] },
  "ferry": { "operator": "SB", "stops": [] },
  "bus": { "operator": "AC", "stops": [] },
  "budget511PerHour": 55 }
```
Secrets come only from the environment: `BART_API_KEY`, `API_511_KEY`.

---

## 5. Tasks (one PR each, in order; start each from up-to-date `main` after the previous PR merges)

### Task 1: Scaffold *(no API keys needed)*
- `package.json` (no dependencies; `start` = `node src/server.js`, `test` = `node --test`), `src/server.js`, `src/static.js`, `src/config.js`, `config.json`, placeholder `public/index.html`, `public/app.js`, `public/style.css` (style.css defines the palette tokens above as CSS variables).
- `GET /api/health` returns `{ ok: true, time, version }` (version from package.json).
- Static serving with correct content types (`text/html`, `text/javascript`, `text/css`, `image/svg+xml`, all with `charset=utf-8` where textual), `404` for unknown paths.
- **Path traversal impossible:** `/../package.json`, `/%2e%2e/package.json`, `/..%2fsrc/server.js` and `/public/../AGENTS.md` all return 404 or 400, never file contents.
- `config.js` reads `config.json` and env vars; a missing `.env` is fine; it never logs secret values.
- Tests: health, static content types, 404, ≥4 traversal attempts, config loading (env overrides, missing `.env`).
- Remove `test/placeholder.test.js` once real tests exist.
- `README.md`: what it is, how to run, env vars.

### Task 2: BART adapter + poller *(public test key)*
- `src/adapters/bart.js`: raw `etd` JSON → normalized board (handles "Leaving" → 0 min, multiple platforms, missing data). Advisories → list of strings.
- `src/poller.js`: fetches BART every 30 s per configured station; caches; on failure keeps last data with `stale: true` and `error`.
- `/api/board` and `/api/board/bart` serve from cache.
- Tests with recorded fixtures in `test/fixtures/bart-*.json` (normal, leaving, empty, error) and a fake clock or timer injection for poller timing. No network in tests.

### Task 3: Split-flap board UI *(BART only)*
- Board rendering per §3 using `createElement`/`textContent` only; polls `/api/board` every 30 s; flip animation on changed characters; reduced-motion support; desktop and phone layouts; clock; STALE badge.
- PR includes notes on manual checks (desktop width, ~375 px phone width, reduced-motion).

### Task 4: 511 adapter (ferry + AC Transit) + request budget
- `scripts/setup-511.mjs`: one-off lookup of operator ids and stop codes (prints suggestions; the owner fills in `config.json`).
- `src/adapters/sf511.js`: SIRI StopMonitoring JSON → normalized board; strips BOM.
- Budget scheduler in the poller: never exceeds `budget511PerHour` (unit-test with a fake clock: simulate 2 hours, assert ≤ 55 calls per rolling hour).
- Fixture tests. The key is never in responses or logs.

### Task 5: Alerts + polish
- Alerts banner (BART advisories; 511 alerts if within budget), empty and error states per board, wall-display mode (`?wall=1`: larger type, no tabs), PWA manifest + icons (original), Lighthouse accessibility ≥ 90.

### Task 6: Run it
- systemd unit example, and docs for running on dev-01 behind Caddy on svc-01 (e.g. `http://10.0.0.21:8080`) so phones on the home network can open it.

## 6. Review checklist (used by the reviewer on every PR)
- Meets the task's acceptance criteria; nothing out of scope
- Tests added and passing in CI; no network in tests
- No dependencies; no secrets; keys never reach the browser or logs
- Security items: traversal, `textContent`, budget
- `AGENTS.md` process: branch name, conventional commits, PR description sections incl. self-review
