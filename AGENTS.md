# Rules for AI agents working in this repo

**Team (CCTW):**

| Who | Role | Commit author | Branch prefix | Sign-off |
|---|---|---|---|---|
| Gilfoyle (OpenClaw) | Engineer | `Gilfoyle (OpenClaw)` | `gilfoyle/` | `— Gilfoyle` |
| Dinesh (Hermes Agent) | Engineer | `Dinesh (Hermes Agent)` | `dinesh/` | `— Dinesh` |
| Jared | Product Owner: writes issues and acceptance criteria; no code | n/a | n/a | `— Jared` |
| Claude | Final review + merge | n/a | `claude/` | n/a |

Agent tokens act as the repo owner's account, so PRs and issues show as opened by @nguyenchrisv. End every PR description, review and issue with your sign-off.
**Peer review:** each engineer reviews the other engineer's PR (findings grouped CRITICAL / WARNING / INFO) before Claude's final review. Never push to a teammate's branch.
**Reviewer:** Claude posts reviews on your PRs. **Merger:** @nguyenchrisv only.

Read `docs/architecture.md` before starting any task. Follow these rules exactly.

## Project
Bay Board: a responsive Bay Area transit departures dashboard (BART, SF Bay Ferry, AC Transit) styled as a 1970s airport split-flap board in a light, warm palette.
- Server: Node ≥22, **standard library only** (`node:http`, global `fetch`). Code in `src/`.
- Front-end: plain HTML/CSS/JS in `public/`. No framework, no build step, no CDN, no external fonts.
- Tests: `node:test` in `test/`, with recorded API responses in `test/fixtures/`. **Tests never hit the network.**
- Commands: `npm test` (all tests) · `node --test test/<file>.test.js` (one file) · `npm start` (serves on `:3000`).

## Workflow
- Do only the task you were given. Make minimal changes and don't refactor unrelated code.
- Run `npm test` after every change and fix failures before moving on. Add or update tests for every behaviour you change.
- If unsure between approaches, pick the simpler one and explain the alternative in the PR description.

## Commits
- One commit per logical change, with conventional prefixes `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Subject under ~50 characters; add a short body for the *why* when it isn't obvious.

## Branches and pull requests
- Never push to `main` (it's protected). One branch per task: `<your-prefix>/<task-name>`, started from an up-to-date `main`.
- Open a PR into `main` when done. The description must include:
  1. **What** changed and **why**, linked to the task number in `docs/architecture.md`
  2. **How you tested it**: commands run and their results
  3. **Self-review**: findings grouped CRITICAL / WARNING / INFO, ending "X critical, Y warnings, Z info". Fix all CRITICAL before opening. **A violation of any rule in this file is always CRITICAL.**
  4. **Uncertainties**: anything unclear or unfinished
- Keep PRs small: one task per PR.

## Code rules
- **No dependencies.** Don't add packages to `package.json`. Installing packages runs third-party code.
- **Secrets:** API keys come only from environment variables (`BART_API_KEY`, `API_511_KEY`) or a gitignored `.env`. Never commit keys, never send them to the browser, never log them.
- **Browser safety:** never put API data into `innerHTML`. Build DOM with `createElement` + `textContent`.
- **Static files:** resolve paths and verify they stay inside `public/` (no path traversal).
- **External APIs:** call them only from the server poller, never because a browser requested something. Respect the 511 budget (≤ 55 requests/hour total).
- **Fixtures must be recorded from the real API, never invented.** Save a real response (with keys removed) under `test/fixtures/`. If a test disagrees with a recorded fixture, fix the test, not the fixture.
- **Report only test results you just observed.** Before reporting counts, push, then run `npm test` on a clean checkout of the pushed branch and paste the summary lines.
- Style: ES modules, 2-space indentation, double quotes.

## Out of scope (don't modify unless the task explicitly asks)
- `.github/` (CI, CODEOWNERS), `AGENTS.md`, `docs/architecture.md`, `.gitignore`

## Safety
- Never commit secrets or `.env` files.
- If a task is ambiguous, say so in the PR description instead of guessing silently.

## Maintaining these rules (repo owner)
When an agent makes a mistake, add a one-line rule here. Prune duplicates periodically.
