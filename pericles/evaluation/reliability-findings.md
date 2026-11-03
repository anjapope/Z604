# Pericles Phase 1: HTTP 502 reliability findings

## Exact live question

I'm researching the history of public libraries in Indiana between 1900 and 1950. Can you find three specific, credible sources, preferably including primary sources, and give me links to them?

## Confirmed root cause

The diagnostic request reproduced HTTP 502 in 14.147 seconds. Initial retrieval returned HTTP 200/completed with 24 source URLs. Institutional page inspection executed: two pages attempted, one yielded text. Initial relevance evaluation returned HTTP 200/completed and valid JSON with 24 entries, but only 23 unique source IDs: one required ID was omitted and another repeated. The server caught this local source_review_validation_error and returned 502 before recovery retrieval.

There was no observed timeout, network failure, upstream HTTP API error, JSON parsing error, or unhandled server exception in this reproduction. The provider category was completed, not a provider error. The precise cause of the earlier uninstrumented 502 remains unknown; the reproduced ID-coverage failure is confirmed.

## Minimal correction

Replaced the evaluation array schema with required properties keyed by the existing retrieved source IDs. Each property holds exactly one evaluation. Unknown properties are forbidden. The server converts those keyed judgments into its existing evaluation representation; the complete-ID check remains in place. No research prompt, relevance rule, source ID assignment, original URL, inspection policy, timeout, model setting, or recovery loop was changed.

Official API schema reference: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Controlled verification

HTTP 200; total duration 23.486 seconds. All upstream requests returned HTTP 200/completed. Initial retrieval: 24 sources; recovery retrieval: 18 sources, including five newly discovered IDs. Combined: 29 unique retrieved IDs, 29 evaluated, zero accepted. No additional live requests were made after this verification.

| Stage | Diagnostic run | Verification run |
|---|---|---|
| Initial retrieval | HTTP 200; 24 sources; 3.202s | HTTP 200; 24 sources; 4.628s |
| Initial inspection | Completed; 2 attempted, 1 inspected; 0.511s | Completed; 2 attempted, 1 inspected; 0.412s |
| Initial evaluation | HTTP 200; 23 unique/24 required IDs; 9.299s | HTTP 200; 24 unique/24 required IDs; 9.935s |
| Recovery retrieval | Not executed | HTTP 200; 18 sources; 3.636s |
| Recovery inspection | Not executed | Completed; 0 attempted, 0 inspected; 0.000s |
| Recovery evaluation | Not executed | HTTP 200; 5 unique/5 required IDs; 4.497s |

## Exact patron-facing response after repair

I could not establish sources that directly address your question. I could not establish all 3 requested sources. A next step is to ask the responsible archive for dated reports or a finding aid covering your period.

No source citations were displayed because no sources were accepted.

## Remaining problems

The single controlled run verifies the reproduced ID-coverage defect is repaired; it does not establish long-term reliability. Research usefulness remains unresolved. Only five of the 29 records had metadata, including one inspected page. The final checks excluded 24 through model relevance review, two for insufficient research-utility evidence, and three for ungrounded relevance evidence. These are observed exclusion categories, not a new diagnosis of why search metadata was sparse or evidence did not match. No quality rules were loosened and no broader quality redesign was attempted.

## Validation and safeguards

All 21 automated tests passed, including required independent slots for all 24 IDs and rejection of missing/duplicate-ID reviews. Syntax checks passed for server.js, research-quality.js, source-inspection.js, and the live diagnostic runner. git diff --check passed. .env remains ignored and untracked. No credentials or authorization headers were captured or printed. No commits or pushes were made.

Safe trace artifacts: [diagnosis](reliability-diagnosis.json), [verification](reliability-verification.json). The opt-in run-reliability-live.cjs runner records durations, statuses, counts, completion state, and error categories without recording upstream request headers, prompt bodies, page contents, or provider error-message text. The exact public test question and patron-facing response are intentionally included in its local reports.
