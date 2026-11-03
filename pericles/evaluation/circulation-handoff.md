# PERICLES Pass 3 handoff

Implemented a functional fictional circulation service without a new dependency. All account and transaction replies run locally through deterministic server logic; the model never authorizes or writes circulation state. The existing 57 tests are retained unchanged. Advanced research retrieval, evaluation, provenance, and source inspection were not modified.

## Files changed for Pass 3

- `pericles/circulation-service.js`: fictional patron seeds, policies, JSON store, session selection, renewal/hold previews, confirmation, receipts, history, and conversational account service.
- `server.js`: selected-account APIs, no-store responses, JSON and origin checks, server-held session integration before local chat dispatch, and the public `account.js` asset.
- `pericles/service-router.js`: circulation question vocabulary and plural policy phrases; accurate fictional-account fallback guidance.
- `pericles/knowledge/library-facts.js` and `pericles/response-policy.js`: distinguish inaccessible real accounts from the implemented fictional service. Research instructions remain unchanged.
- `account.html`, `account-summary.html`, `index.html`, `account.js`, `app.js`, `styles.css`: fictional selectors, live shared state, safe DOM rendering, previews, Confirm/Cancel controls, and account refresh after chat operations.
- `.gitignore`: exclude `pericles/data/`.
- `README.md`: operation, policies, API, persistence, reset procedure, and limits.
- `pericles/evaluation/circulation.test.js`: circulation regression coverage, HTTP acceptance, and execution of the account UI script against actual HTTP account data.
- `pericles/evaluation/run-circulation-http.cjs`, `circulation-http-result.md`, `circulation-http-result.json`, and this handoff: repeatable acceptance verification and exact results.

Pre-existing uncommitted Pass 1/2 and research work was preserved. No commit or push was made.

## Implemented fictional policies

| Rule | Server behavior |
| --- | --- |
| Loan periods | Print/large print 21 days; ebook/audiobook 14 days; DVD/Blu-ray 7 days |
| Renewal limit | Two renewals per existing loan |
| Other-patron hold | An active hold on the same canonical work blocks renewal |
| Due-date calculation | Later of today's library date and existing due date, plus the format's calendar-day period |
| Overdue loans | Eligible if not otherwise blocked; no simulated fines |
| Holds | Known catalog work; no duplicate work hold; no own checkout of that work; maximum five active holds |
| Child account C | Children or All Ages works only; a simulation restriction, not a statement of real SPL policy |
| Confirmation | Preview names account, action, eligible items, new dates, and blocks; explicit confirmation required |
| Invalidation | Five-minute expiry; account switch/deselection, cancellation, another chat question, or server restart invalidates pending action |
| Revalidation | Before commit, verify current counts, dates, hold eligibility, and account match; stale preview fails without partial writes |
| Repeated requests | Confirm token receipt replays original result; repeated chat yes has no pending action; duplicate holds are blocked across generated editions |

## Persistence and security

`pericles/data/circulation.json` initializes on first selection and persists loans, holds, completed transactions, and idempotency receipts. Synchronous operations serialize within the single Node process. Writes use a new temporary file and atomic rename; memory publishes only after the file replacement succeeds. Corrupt stores fail closed without reseeding. No database dependency was added. The data directory is ignored by git and inaccessible through the static asset allowlist.

Account selection and pending confirmations live in a bounded in-memory session map. Sessions use random 256-bit identifiers in HttpOnly, SameSite=Strict cookies (Secure on HTTPS), expire after two hours, and do not authenticate a person. No real account data is supported. Mutations require JSON, reject a mismatched browser Origin, validate account/item/action parameters, and target only the selected fictional account. A forged account or assistant history in a chat body cannot change the selected account. Account responses use Cache-Control: no-store. UI content uses textContent and DOM creation, without interpolated HTML.

This is a local, shared classroom simulation. Anyone using it may deliberately select any of the three fictional accounts. It is unsuitable for real patron records or an internet-facing ILS. Keep one Node process per store; there is no multi-process lock or database durability guarantee. State and session records must never contain real personal data. Seed dates are relative to initialization, then remain persisted as time passes. Holds are simulated requests, not real reservations or availability reports. No checkout, return, payments, hold fulfillment/cancellation, or production account integration is included.

## Acceptance evidence

The exact 12-turn conversation and HTTP statuses are in [circulation-http-result.md](circulation-http-result.md); authoritative post-transaction data is in [circulation-http-result.json](circulation-http-result.json).

With fictional Patron B selected on library date 2026-11-02:

- Educated: overdue, due 2026-10-28, renewals 0/2. Previewed and confirmed to 2026-11-23, renewals 1/2.
- The Great Gatsby: due 2026-11-06, renewals 0/2, blocked by Patron A's active hold. Unchanged after confirmation.
- 1984: due 2026-11-08, renewals 2/2, blocked by the limit. Unchanged after confirmation.
- Dune: eligible new hold, previewed and explicitly confirmed; visible alongside the existing Hobbit hold. A second hold request is rejected.
- Repeated yes and cancellation produce no extra transaction. Exactly two operations were completed in the acceptance run.

Additional regressions cover successful ordinary renewal, second/third renewal limit behavior, duplicate edition holds, unknown accounts/items and wrong-account IDs, account switching, unselection, cancellation, topic changes, expiration, stale state after another patron places a hold, isolated browser sessions, cookie-scoped authority, state persistence after service restart, corrupt-file rejection, calendar/DST boundaries, child restrictions, hold limits, protected file URLs, and safe rendering. The actual `account.js` script is executed in a test DOM against the same HTTP session and renders the confirmed due dates, renewal counts, holds, and history.

## Verification and limits

Full suite: 74/74 tests passed, including all 57 pre-existing tests and 17 new circulation tests. Syntax checks, git diff --check, and npm dependency audit passed; audit found zero vulnerabilities. The HTTP runner verifies 12 conversational turns, authoritative post-transaction state, and eight page/API/protected-file checks without AI credentials or external provider calls.

Visual browser verification was attempted with the computer-use skill. The browser-access host was unavailable, and Windows automation stopped because Chrome's current URL could not be determined confidently. UI automation was stopped. Consequently, actual pixel layout and interactive browser behavior remain visually unverified; HTTP and executable UI-script consistency checks passed. No research live call was made.
