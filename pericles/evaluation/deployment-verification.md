# PERICLES Pass 4A verification

Prepared locally only. No commit, push, Pages upload, Render service, or deployment was performed. No paid AI call was made. The actual approved GitHub Pages origin and Render URL remain unset; public startup requires an explicit FRONTEND_ORIGIN, and the Pages build must receive its actual PUBLIC_BACKEND_URL.

## Results

- Complete test suite: **85/85 passed**, retaining all 74 pre-existing tests and adding 11 deployment tests.
- JavaScript syntax: **36 files passed** (generated frontend copies excluded).
- `git diff --check`: passed.
- `npm audit`: **0 vulnerabilities**. The sandbox could not reach the registry; the authorized network audit succeeded.
- `npm run build:frontend`: passed, producing the ignored `dist-frontend/` browser-only artifact. This initial artifact retains the empty, same-origin local backend default; rebuild with the actual Render URL into a new empty directory before publishing.
- HTTP regressions: health 200 with only `{ "ok": true }`; approved Pages and local origins 200; approved credential/header preflight 204; unapproved origins/methods/headers 403; API/IP/classroom limits 429 with Retry-After; simulated provider timeout 502 with a safe message; malformed JSON 400; protected source/state/config/report routes 404.
- Cookie-free cross-site circulation test: selected Patron B using the exposed X-Demo-Session header; previewed eligible renewal; explicitly confirmed; verified renewal count 1 in the account API; previewed and confirmed Dune hold; verified Dune in authoritative account state. A request with no selected session receives 409. All three patrons and prior circulation behavior remain covered by the existing regression suite.
- Frontend execution tests: account/catalog/chat URLs route to the configured HTTPS backend; opaque session headers persist in sessionStorage; cross-site requests omit cookies; localhost retains same-origin requests; chat record links preserve the Pages `/Z604/` project path.
- Artifact tests: only the shared browser allowlist is copied; `.env`, backend modules, package metadata, circulation state, and diagnostic reports are excluded. Reusing a nonempty artifact directory is refused. Credential-bearing backend URLs are refused.

## Implementation scope

New: `pericles/deployment.js`, `pericles/public-assets.js`, `api-client.js`, `frontend-config.js`, `scripts/prepare-frontend.cjs`, `pericles/evaluation/deployment.test.js`, `DEPLOYMENT.md`, and this verification report.

Updated for this pass: `server.js`, `pericles/circulation-service.js` (opaque header session support), `pericles/citation-renderer.js` (Pages project-relative catalog links), `app.js`, `account.js`, `index.html`, `account.html`, `account-summary.html`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, and `README.md`.

The advanced research retrieval algorithm, source review/evaluation, provenance, recovery, and inspection logic were not redesigned or modified. Admission controls and provider transport deadlines wrap the existing pipeline. The interface layout is unchanged; the status label now indicates backend readiness without claiming that AI configuration was exposed by health.

## Operational limits

The server supports one instance and one JSON file. Render's ephemeral filesystem can discard circulation changes; in-memory sessions, pending confirmations, throttling counters, and classroom/provider ceilings reset on process restart. These ceilings are not durable spending caps. CORS is a browser origin restriction, not authentication; non-browser callers remain subject to IP/global limits. All accounts are explicitly fictional and shared. Header session identifiers are JavaScript-accessible simulation selectors and must not be used for real patron authentication. Production browser/Render/Pages behavior is not claimed as verified because nothing was deployed.

Build/start commands, environment variables, later publication instructions, official hosting references, and a post-authorization smoke-test sequence are in [DEPLOYMENT.md](../../DEPLOYMENT.md).
