# Pass 3 exact HTTP conversation

Fictional Patron B selected through the server session. Isolated temporary JSON store; fixed library date 2026-11-02. No AI credentials or external calls.

Patron: When are my books due?

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B, Bram Bookmark (fictional).
Current checkouts:
- Educated (B-1): due 2026-10-28 (overdue); renewals 0/2; eligible for renewal
- The Great Gatsby (B-2): due 2026-11-06; renewals 0/2; blocked: another fictional patron has an active hold on this work
- 1984 (B-3): due 2026-11-08; renewals 2/2; blocked: renewal limit of 2 reached
Active holds: 1. These are fictional records; no real account is connected.
```

Patron: Can you renew everything?

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B.
Eligible for renew:
- Educated (B-1): due 2026-10-28 → 2026-11-23; renewals 0 → 1/2
Blocked (will remain unchanged):
- The Great Gatsby: another fictional patron has an active hold on this work
- 1984: renewal limit of 2 reached
Confirm renewal of only these eligible loans? Say “yes” or “cancel”. This preview expires in 5 minutes.
```

Patron: Yes, renew the eligible ones.

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B. Server confirmed renewal.
- Educated: due 2026-11-23; renewals 1/2
Unchanged: The Great Gatsby (another fictional patron has an active hold on this work); 1984 (renewal limit of 2 reached).
The account page now reads this same server state. No real library transaction occurred.
```

Patron: Yes, renew the eligible ones.

HTTP 200, exact Pericles reply:

```text
There is no pending fictional transaction to confirm. Select an account and request a renewal or hold first.
```

Patron: Why can't I renew this book?

HTTP 200, exact Pericles reply:

```text
Fictional Patron B renewal eligibility:
- Educated (B-1): eligible; renewals 1/2
- The Great Gatsby (B-2): another fictional patron has an active hold on this work
- 1984 (B-3): renewal limit of 2 reached
No changes were made. Ask to renew a named loan or everything for a confirmation preview.
```

Patron: Place a hold on Dune.

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B.
Eligible for hold:
- Dune (CAT-0011): one simulated work-level hold
Confirm placement of this hold? Say “yes” or “cancel”. This preview expires in 5 minutes.
```

Patron: Yes

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B. Server confirmed hold placement.
- Dune: hold e1b486fe-6f12-4f5b-9347-849a56e52c64 placed 2026-11-02; simulated request only
The account page now reads this same server state. No real library transaction occurred.
```

Patron: What holds do I already have?

HTTP 200, exact Pericles reply:

```text
Fictional Patron B existing holds:
- The Hobbit: placed 2026-11-02; Simulated request; no real availability confirmed
- Dune: placed 2026-11-02; Simulated request; no real availability confirmed
```

Patron: Place a hold on Dune.

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B.
No eligible items; nothing will be changed.
Blocked (will remain unchanged):
- Dune: this account already has an active hold on this work
```

Patron: Can you renew everything?

HTTP 200, exact Pericles reply:

```text
Fictional demonstration — Patron B.
Eligible for renew:
- Educated (B-1): due 2026-11-23 → 2026-12-14; renewals 1 → 2/2
Blocked (will remain unchanged):
- The Great Gatsby: another fictional patron has an active hold on this work
- 1984: renewal limit of 2 reached
Confirm renewal of only these eligible loans? Say “yes” or “cancel”. This preview expires in 5 minutes.
```

Patron: Cancel

HTTP 200, exact Pericles reply:

```text
Fictional demonstration: the pending action was cancelled; no changes were made.
```

Patron: Yes

HTTP 200, exact Pericles reply:

```text
There is no pending fictional transaction to confirm. Select an account and request a renewal or hold first.
```

Account API verified: Educated due 2026-11-23, renewal count 1; The Great Gatsby remains due 2026-11-06, count 0; 1984 remains due 2026-11-08, count 2. Holds include The Hobbit and Dune; exactly two completed transactions.

HTTP page/API and protected-file checks:

- /account.html: 200
- /account-summary.html: 200
- /account.js: 200
- /api/circulation/policies: 200
- /api/catalog/summary: 200
- /pericles/data/circulation.json: 404
- /pericles/circulation-service.js: 404
- /.env: 404
