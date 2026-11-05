# Pericles: broader reference help and classroom services

Prepared November 4, 2026, against upstream commit `1312e0e8ce8735937459787188c9efb93b514704`.

## Result

Subject questions now reach the AI instead of broad keyword-based institutional answers or repeated requests to name a topic. Specific reference questions get substantive assistance; a genuinely vague request can still receive one useful clarifying question. Instructions cover practical tax preparation navigation, 3D-printing workflows, youth learning, reading support, worked examples, and focused referrals. Relevant conversation history continues across short follow-ups. The existing source discovery, provenance, and historical research evaluation pipeline remains intact.

The new server-owned classroom service supports upcoming dated sessions, registration, cancellation, a one-time fee courtesy credit, and simulated settlement. The account page shows the same balances, registrations, and service receipts. Programs and Events display the next session for each bookable offering. Offers include Reading Confidence Lab, Homework and Study Studio, 3D Printing: First Design, and Tax Preparation Readiness alongside established recurring programs. New services and schedules are explicitly fictional; there is no real tax preparation, VITA affiliation, tutoring appointment, equipment reservation, charge, or payment.

Patron B starts with $16 in fictional replacement/damage charges. “Waive my fees” previews a $15 courtesy credit, leaving $1. A subsequent “pay my fees” previews a simulated $1 settlement. Patron A/C have no seeded charges. Overdue fines remain zero. The service never asks for card numbers or payment data.

The server adds a relevant program suggestion after substantive help, avoids repeating suggestions in the recent conversation, and respects “stop suggesting programs.” A yes to an offer shows registration options; it does not register the patron. Actual registration needs a selected fictional account, an unambiguous dated session, a preview, and explicit confirmation.

## Reading metadata

`knowledge/reading-levels.json` contains four sourced text measures (Matilda, The Wild Robot, Charlotte’s Web, Wonder), source links, edition ISBNs, and a review date. Lexile queries can name a title, specify an exact numeric range, or request nearby measures. The catalog API and AI grounding include sourced metadata. Unknown scores stay unknown. The demo records have no ISBNs; title matching does not prove an edition match. A numeric level is never presented as a diagnosis, school-grade placement, content rating, or reason to deny a requested book. Add further titles only after checking publisher or MetaMetrics evidence; this is a curated subset, not collection-wide Lexile coverage.

Source records: Scholastic’s Matilda product listing and Charlotte’s Web Book Clubs listing; Gale/Thorndike’s youth catalog for The Wild Robot; MetaMetrics Lexile Hub for Wonder. General interpretation follows MetaMetrics’ FAQ. Official IRS tax-help navigation is grounded in its free tax return preparation programs page. No current tax thresholds or deadlines are hard-coded.

## Verification

Run `npm test` under Node 22+. All 137 tests pass, including thirteen new integration/regression cases. They cover AI routing/history, dated program lists, registration and cancellation, duplicate prevention, persisted state, stale previews, account switching, expiry, capacity revalidation, foreign tokens, child/adult restrictions, fee adjustments, suggestions/opt-out, sourced reading metadata, and inaccessible/corrupt state files. Existing circulation, institutional, deployment, advisory, and research provenance tests still pass. Provider calls in the new suite are mocked: this verifies routing and request construction, not the quality of live model answers. Age-aware program recommendations now provide distinct choices with reasons, retain age/interests for follow-ups, and can preview a suggested session. Named-program details recognize “story time” and answer activities, duration, and preparation questions without an AI call. The local Programs page was inspected in the browser. The allowlisted Pages frontend build succeeded, and `git diff --check` passed.

No live-model request using the new instructions was made. At local verification, no backend or Pages deployment, billing change, or production data mutation was performed. The user subsequently authorized pushing the completed changes to main on November 5. A local clone was used; the older Desktop checkout and its uncommitted source edits were preserved.

## Live rehearsal before publishing

Use the existing server-side OpenAI configuration in a staging or reviewed deployment; do not paste secrets into chat. Ask:

1. “I need to prepare my US taxes. What should I organize first?” Follow with the tax year. Expect a useful checklist, official navigation, and no invented current eligibility or demand for private documents.
2. “I have never used a 3D printer. How do I make a small name tag?” Expect an understandable design-to-slicing workflow, no claim to book a real printer, and a relevant optional maker-program suggestion.
3. “My nine-year-old struggles to read fluently but loves science. Can you suggest a short practice routine?” Expect concrete, adaptable steps and one useful follow-up rather than a generic referral. No diagnosis or grade inference.
4. “What Lexile is Matilda? What about Dune?” Expect a sourced 840L title/text measure with the edition limitation, then an explicit unknown for Dune. Try “Lexile books from 700L to 800L” and verify only sourced matches are presented.
5. “Show reading programs this week.” Select a patron, request a dated Reading Confidence Lab place, confirm, inspect My Account, and cancel with a second confirmation.
6. Select Patron B, inspect fees, preview a courtesy credit, cancel it, request it again, confirm, and check the $1 remaining balance. Settle it only as an explicitly simulated payment.
7. Start a registration preview, switch patrons or change the topic, and say yes. No registration should occur. Decline promotions and continue a subject conversation.

## Operations and limitations

The backend and frontend must both be updated for the new views. Publish only the allowlisted frontend artifact using the existing manual workflow. GitHub Pages cannot run the new server service. Backend restart/redeploy is required for code and knowledge changes. Verify Render’s deployed revision and test the Pages-to-Render connection after publication.

The new private state file is `pericles/data/patron-services.json`, separate from circulation state. Existing circulation data need no migration. New state is seeded on first use. Like the existing circulation JSON file, it assumes one Node process and disposable classroom storage; multiple workers and durable production operation require a different storage design. To reset a demonstration, stop the server and archive both JSON stores before restarting. Never reset production/shared data during a running exercise.

Preview tokens expire after five minutes; account switching, cancellation, another request, and competing circulation previews invalidate them. Repeated confirmations cannot repeat an action. Capacity, account selection, and balances are checked again at commit. Program registrations are one fictional place per patron per session. Adults can act as a demonstration caregiver; child account C cannot book adult-only sessions. No household/multi-seat bookings, attendance management, email reminders, waitlist, assessment, or real transaction integrations are included.

Read APIs: `GET /api/services/programs`, `GET /api/services/account`. Actions: `POST /api/services/preview` with `{action,eventId?}` where action is `register`, `cancel_registration`, `waive_fees`, or `settle_fees`; `POST /api/services/confirm` with `{confirmationToken}` using the preview’s `token`; `POST /api/services/cancel` with `{}`. Existing opaque session headers/cookies and exact-origin restrictions apply. A program event ID includes the program slug and local date. All state files and backend modules remain excluded from static assets and the Pages build.

## Continue on another computer

Pull `main`, install dependencies with `npm install` (Node 22+), and configure a local `.env` from `.env.example` if needed. Local credentials are intentionally not tracked or pushed. Run `npm test`, then `npm start`. Existing hosted credentials were not changed. The GitHub Pages workflow remains manual; pushing main alone does not publish the frontend.
