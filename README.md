# Z604

Pass 4C institutional policies live in [library-knowledge.json](pericles/knowledge/library-knowledge.json), with [maintenance and precedence notes](pericles/knowledge/README.md). Institutional answers use deterministic backend routing, local-time regular hours, and explicit unknowns. Policy explanations do not initiate circulation actions; explicit action requests retain account selection and confirmation.

Pass 4B configures https://anjapope.github.io/Z604/ to use https://pericles-api.onrender.com. The manual `.github/workflows/pages.yml` workflow publishes only the browser artifact; GitHub Pages Source must be set to **GitHub Actions** before an authorized publication. See the Pass 4B section of [DEPLOYMENT.md](DEPLOYMENT.md) for exact steps and hosted verification results. The Pages workflow must be dispatched separately after review; no workflow run has been performed.

Pass 4A deployment preparation is documented in [DEPLOYMENT.md](DEPLOYMENT.md). The app supports a Render backend, an allowlisted GitHub Pages frontend artifact, exact origin restrictions, cookie-independent fictional sessions, server-side request ceilings, and bounded AI calls. Nothing has been deployed. Supply the approved Pages origin and real backend URL before a later authorized deployment. Render classroom JSON data and in-memory counters are disposable, not durable cloud storage.

A Stapleton Public Library portal demo with:

- searchable card catalog
- events calendar
- three fictional, stateful classroom circulation accounts
- Pericles-guided chatbot UI wired to a secure backend `/api/chat` route

## Run locally

1. Install dependencies:
   - `npm install`
2. Configure environment variables:
   - Copy `.env.example` to `.env` using your shell or editor.
   - Set `OPENAI_API_KEY` in `.env` for live AI reference service.
3. Start the app:
   - `npm start`
4. Open:
   - `http://localhost:4000`

## Notes

- The API key stays server-side in `.env` and is never exposed to browser JavaScript.
- The server listens on `127.0.0.1` so the development portal is not exposed to the network.
- Catalog search and collection summaries use the generated demonstration records. The catalog does not track current availability and is not a complete real-world holdings inventory.
- Source-finding requests use OpenAI's built-in web-search tool through the Responses API. Titles and URLs must be traceable to search results; relevance is separately assessed across subject, geography, chronology, provenance, authority, and research utility. Sources are labeled directly relevant or supplementary, and one focused recovery search is attempted when the initial retrieval yields too few direct matches. Historical coverage is not inferred from publication date, and missing metadata lowers confidence rather than automatically disqualifying a useful source. Up to four promising institutional pages may be inspected within a request; live research requires a configured OpenAI API key and a model that supports web search.
- Without an API key, deterministic catalog answers and the reference interview still work; other live research requests explain that the service is unavailable.
- Run the repeatable behavior tests with `npm test`.


Pericles source provenance: discovery reads `web_search_call.action.sources` and URL citation annotations into a request-scoped registry. Records receive stable IDs across initial and recovery retrievals. Original URLs are immutable; normalization is used only for duplicate detection. A separate tool-free relevance review returns IDs, direct/supplementary/excluded judgments, and verbatim metadata evidence. The review schema restricts IDs to the retrieved batch and requires a decision per record; incomplete or duplicate reviews fail closed. Search-generated candidate URLs and discovery prose are never used as recommendations. Missing titles use the original URL as the link label. Attribution is rendered only from returned metadata. Historical coverage remains separate from publication date, and legitimate partial-period sources remain eligible.

Run offline regressions with `npm test`. `node pericles/evaluation/run-provenance-live.cjs` performs one explicitly authorized live request (including bounded recovery) and writes the patron response and count-only diagnostics to `pericles/evaluation/provenance-live-result.json`. Do not run it as part of offline tests. Development diagnostics require `PERICLES_RESEARCH_DIAGNOSTICS=true`; production suppresses them. Credentials and patron prompts are never logged by the research diagnostics. Keep `.env` ignored.

Complete-ID review was verified live: 17 retrieved, 17 evaluated, zero accepted (see `pericles/evaluation/complete-review-live-result.json`). The subsequent quality correction requires grounded period coverage for direct period sources, treats boundary-only coverage as supplementary, and excludes generic collection names without evidence of research utility. It permits bounded inspection of up to four promising institutional HTML/text pages across initial and recovery retrievals. Inspection uses a fixed host allowlist, public IPv4 address pinning, per-page deadlines and size limits, and revalidates redirects; it never changes a retrieved source ID or URL. Unsupported or inaccessible pages remain uninspected. Patron notes use evidence-based research guidance and a single linked title, with uncertainty stated where it affects use. The final authorized live test is recorded in `pericles/evaluation/provenance-live-result.json` and `.md`.

The final quality live test returned HTTP 502 and no recommendations. It did not emit pipeline counts, so its retrieved/evaluated/accepted counts are unavailable. The quality changes passed 20 offline tests but are not verified live. Safe review-failure diagnostics were added after that run (counts and provider completion status only); no additional live test was performed.

Phase 1 reliability repair: the diagnostic live request reproduced HTTP 502 when an evaluation array contained 24 entries but only 23 unique source IDs. Evaluation now uses required properties keyed by the existing source IDs, avoiding duplicate entries displacing required reviews. No prompts, relevance rules, URL protections, page inspection, timeouts, or recovery limits changed. The controlled verification returned HTTP 200 with 29 unique retrieved and evaluated IDs, zero accepted. All 21 offline tests passed. See `pericles/evaluation/reliability-findings.md` and the diagnosis/verification JSON traces. Research usefulness remains a separate unresolved issue; no additional live tests were performed.


Service Architecture Pass 1: routine library information, policy guidance, events, account limitations, and reference/advisory clarification now use local service routing before any AI configuration check. Established facts come from `pericles/knowledge/library-facts.js`; missing loan periods, addresses, contact details, room rules, and accommodations are explicitly unconfirmed. Current explicit requests override older topics; contextual follow-ups retain only the relevant service conversation. Explicit external source research continues through the unchanged research pipeline.

The My Account page offers three clearly labeled fictional classroom patrons without collecting card numbers, PINs, or passwords. The server serves only an explicit list of website pages and browser assets. Server modules, environment files, circulation data, tests, diagnostics, and development reports are not web assets and return 404. When adding a legitimate public page or browser asset, add it to `PUBLIC_ASSETS` in `server.js`; do not restore workspace-wide static serving.

Regression coverage in `pericles/evaluation/service-routing.test.js` runs without AI credentials or external provider calls. It exercises public navigation/assets, protected-file GET/HEAD requests, local service questions, topic switches, and retained research follow-ups. Pass 2 adds metadata-grounded reader's advisory with preferences, exclusions, audience gates, and distinct-work recommendations. Event descriptions do not establish dated bookings or cancellations.

Pass 1 verification: all 48 automated tests passed; syntax checks and git diff --check passed; npm audit reported zero vulnerabilities. Representative local HTTP requests exercised all seven requested routing examples after unfinished genealogy context with AI credentials disabled. Public pages and catalog APIs returned 200; protected source/diagnostic paths returned 404. No paid AI test was needed.

## Pass 3: fictional circulation

Start with `npm.cmd start` on Windows (or `npm start` where supported). Select a fictional patron on Home or My Account; the selection follows the browser session between pages. Patron A, Aster Page, has ordinary renewable loans. Patron B, Bram Bookmark, has an overdue loan, a loan blocked by A's hold, a loan at its renewal limit, and an existing hold. Patron C, Clover Story, is a child account with juvenile materials. These accounts are shared classroom examples, not private authenticated accounts.

Ask Pericles "When are my books due?", "Can you renew everything?", "Why can't I renew this book?", "Place a hold on Dune.", or "What holds do I already have?" Renewals and holds produce an eligibility preview and require an explicit yes. A preview expires after five minutes. Switching accounts, cancelling, or sending a different chat question cancels it. The account page also offers renewal and hold previews with Confirm/Cancel buttons. Account pages refresh after local transactions, browser-tab notifications, focus, and every five seconds while visible. The server rechecks state before committing and rejects stale previews. Repeated confirmation tokens return the original receipt without another transaction; repeated chat yes messages cannot repeat an executed change.

Fictional rules are implemented in `pericles/circulation-service.js` and exposed through `/api/circulation/policies`: print/large print 21 days; ebook/audio 14 days; DVD/Blu-ray 7 days. Maximum two renewals. Another fictional patron's work-level hold blocks renewal. Overdue items can renew, from today; other renewals extend the existing due date. Dates use America/Indiana/Indianapolis and calendar-day arithmetic. Holds require a known catalog work, no existing hold or checkout of that work on the selected account, and fewer than five active holds. Account C supports Children or All Ages works. Generated editions collapse to one work for holds. Holds do not establish actual availability or trigger real fulfillment. Real SPL policies remain unconfirmed.

The first selected account initializes `pericles/data/circulation.json` with dates relative to that library day. Updates use a temporary file and atomic replacement; completed operations and idempotency receipts persist across restarts. Data is excluded from git and static serving. The service runs in one Node process; do not run multiple workers against this file. Sessions and pending previews are memory-only and are invalidated on restart; a new browser session requires selecting a patron again. A corrupt state file fails closed instead of resetting transactions. To reset a class demonstration, stop the server, archive/move the JSON file, and restart; the next selection reseeds it. No web reset endpoint is provided.

Account API: `GET /api/circulation/patrons`, `/policies`, `/account`; `POST /selection` with `{ "accountId": "A" }` (or B/C; empty string deselects); `POST /preview` with `{ "action": "renew", "loanIds": "all" }` or `{ "action": "hold", "recordId": "CAT-0011" }`; `POST /confirm` with the returned `confirmationToken`; `POST /cancel` with `{}`. Mutations require JSON, reject cross-origin browser requests, validate IDs/parameters, and use only the session's explicitly selected account. Account responses are not cached. Selection uses a random HttpOnly, SameSite=Strict cookie (Secure on HTTPS); it is a simulation selector, not authentication. No real credentials, payments, checkout/return workflow, queue fulfillment, or real library integration exists.

Run `npm.cmd test`, `npm.cmd audit`, and `node pericles/evaluation/run-circulation-http.cjs` for the offline regression and HTTP acceptance checks. The HTTP runner uses an isolated temporary store and a fixed 2026-11-02 library date; it does not change the demonstration account data used by the main server. See `pericles/evaluation/circulation-handoff.md` and `circulation-http-result.md` for verification and the exact conversation. Advanced research retrieval is unchanged.
