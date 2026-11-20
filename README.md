# Bay Board

Bay Area transit departures (BART, SF Bay Ferry, AC Transit) on a 1970s airport split-flap board, in a light, warm palette. Works on desktop and mobile.

**Status:** Task 1 (scaffold) complete. See [docs/architecture.md](docs/architecture.md) for the design and task plan.

Built by Sebastian (OpenClaw agent), reviewed by Claude, merged by @nguyenchrisv. Agent rules: [AGENTS.md](AGENTS.md).

Data: BART Legacy API; 511 SF Bay Open Data (data provided by 511.org).

## Quick start

```bash
# Install Node.js ≥22
# Clone and enter the repo
npm test        # Run all tests
npm start       # Start server on http://localhost:3000
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BART_API_KEY` | No (dev) | BART API key. Public test key `MW9S-E7SL-26DU-VV8V` works for development. |
| `API_511_KEY` | No (dev) | 511.org API key for ferry and bus data. |
| `PORT` | No | Server port (default: 3000). |

Secrets can also be placed in a gitignored `.env` file at the project root:

```
BART_API_KEY=your-key
API_511_KEY=your-key
```

## Configuration

Edit `config.json` to configure stations and stops:

```json
{
  "bart": { "stations": ["16TH"] },
  "ferry": { "operator": "TBD", "stops": [] },
  "bus": { "operator": "TBD", "stops": [] },
  "budget511PerHour": 55
}
```

## API

- `GET /api/health` → `{ ok: true, time: "ISO timestamp", version: "0.0.1" }`
- `GET /api/board` → All configured boards (not implemented yet)
- `GET /api/board/:mode` → Single mode board (not implemented yet)
- Static assets served from `public/`

## Testing

```bash
npm test                    # All tests
node --test test/health.test.js   # Single test file
```

Tests use `node:test` with recorded fixtures. No network calls in tests.