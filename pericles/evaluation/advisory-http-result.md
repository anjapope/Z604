# PERICLES Pass 2 verification

Catalog: 50000 generated records based on 102 seeded titles; editions can represent the same work. Circulation availability is not tracked.

Validation: complete suite 57/57 passed; JavaScript syntax checks passed; npm audit found 0 vulnerabilities. HTTP scenarios below ran against an ephemeral local Express server without AI credentials. Record links are checked by the regression suite. Advanced research retrieval was not modified. No commit or push was made.

Changes: advisory preference interviewing and follow-up context; audience/genre/subject/format/exclusion filtering; distinct-work grouping including Percy Jackson title variants; metadata-grounded explanations; safe clickable catalog links. Corrected The Queen's Gambit's fiction genre, generated format/call-number and juvenile shelf inconsistencies, and preserved video formats rather than manufacturing book editions of films.

Limits: recommendations use demonstration metadata rather than independent reading-level or content reviews. Length, pace, and reading level are not established by this catalog. Unknown subjects return fewer or zero matches.

## Child fantasy

Request: Recommend fantasy for my seven-year-old.

HTTP 200. Exact reply:

```text
I found 2 appropriate distinct works.
- [Harry Potter and the Sorcerer's Stone](/catalog-detail.html?id=CAT-0096) — J.K. Rowling. Print Book; audience: Children/Teen; genre: Fantasy. Why it fits: the catalog describes fantasy; An orphan discovers he is a wizard and enters a hidden world.
- [Percy Jackson and the Olympians: The Lightning Thief](/catalog-detail.html?id=CAT-0097) — Rick Riordan. Ebook; audience: Children/Teen; genre: Fantasy. Why it fits: the catalog describes fantasy; A modern boy learns he is the son of a Greek god.
These are demonstration-catalog records, not confirmed circulation availability. Generated copies and editions do not represent distinct works.
```

## Adult audio with exclusion

Request: Recommend adult science fiction, no horror, only audiobooks.

HTTP 200. Exact reply:

```text
Here are three matching distinct works.
- [Project Hail Mary](/catalog-detail.html?id=CAT-0014) — Andy Weir. Audiobook; audience: Adult; genre: Science Fiction. Why it fits: the catalog describes science fiction; A lone astronaut wakes with a mission to save Earth.
- [1984](/catalog-detail.html?id=CAT-0105) — George Orwell. Audiobook; audience: Adult; genre: Science Fiction. Why it fits: the catalog describes science fiction; A bleak portrait of authoritarian control and resistance.
- [Dune](/catalog-detail.html?id=CAT-0113) — Frank Herbert. Audiobook; audience: Adult; genre: Science Fiction. Why it fits: the catalog describes science fiction; Paul Atreides confronts destiny on the desert planet Arrakis.
These are demonstration-catalog records, not confirmed circulation availability. Generated copies and editions do not represent distinct works.
```

## One appropriate work

Request: Recommend books about robots for children.

HTTP 200. Exact reply:

```text
I found 1 appropriate distinct work.
- [The Wild Robot](/catalog-detail.html?id=CAT-0094) — Peter Brown. Print Book; audience: Children; genre: Children. Why it fits: the catalog describes robots; A robot learns to live among animals on a remote island.
These are demonstration-catalog records, not confirmed circulation availability. Generated copies and editions do not represent distinct works.
```

## No matching holdings

Request: Recommend adult nonfiction about quantum archaeology.

HTTP 200. Exact reply:

```text
I found no appropriate works matching all of those preferences in the demonstration catalog. These are demonstration-catalog records, not confirmed circulation availability. Generated copies and editions do not represent distinct works.
```

## Interview

Request: Recommend fiction for my seven-year-old.

HTTP 200. Exact reply:

```text
What reading preferences should I use—for example, adventure, friendship, or a favorite genre?
```

## Interview follow-up

Request: Fantasy, no horror.

HTTP 200. Exact reply:

```text
I found 2 appropriate distinct works.
- [Harry Potter and the Sorcerer's Stone](/catalog-detail.html?id=CAT-0096) — J.K. Rowling. Print Book; audience: Children/Teen; genre: Fantasy. Why it fits: the catalog describes fantasy; An orphan discovers he is a wizard and enters a hidden world.
- [Percy Jackson and the Olympians: The Lightning Thief](/catalog-detail.html?id=CAT-0097) — Rick Riordan. Ebook; audience: Children/Teen; genre: Fantasy. Why it fits: the catalog describes fantasy; A modern boy learns he is the son of a Greek god.
These are demonstration-catalog records, not confirmed circulation availability. Generated copies and editions do not represent distinct works.
```

## Nonfiction

Request: Recommend nonfiction about cooking for adults.

HTTP 200. Exact reply:

```text
Here are three matching distinct works.
- [The Joy of Cooking](/catalog-detail.html?id=CAT-0051) — Irma S. Rombauer. Print Book; audience: Adult; genre: Cooking. Why it fits: the catalog describes cooking; A foundational cookbook with broad recipes and kitchen guidance.
- [Salt, Fat, Acid, Heat](/catalog-detail.html?id=CAT-0052) — Samin Nosrat. Print Book; audience: Adult; genre: Cooking. Why it fits: the catalog describes cooking; A practical framework for understanding taste and texture.
- [Half Baked Harvest Super Simple](/catalog-detail.html?id=CAT-0053) — Tieghan Gerard. Ebook; audience: Adult; genre: Cooking. Why it fits: the catalog describes cooking; Approachable recipes designed for busy schedules.
These are demonstration-catalog records, not confirmed circulation availability. Generated copies and editions do not represent distinct works.
```
