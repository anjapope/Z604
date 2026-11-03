# Pass 4A — deployment preparation only

No service, GitHub Pages publication, commit, or push was created by this pass. The actual GitHub Pages origin and Render URL must be supplied before deployment. The placeholders below are not configured destinations.

## Render backend (perform only after deployment authorization)

Create one **Node Web Service** from the Z604 repository. Use the repository root as the root directory:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Node version | Node 22 or newer; set `NODE_VERSION=22` for a fixed major |
| Instances | One; no multi-worker command |
| Port | Render assigns `PORT`; do not hardcode it |
| Host | Defaults to `0.0.0.0` in production/Render; leave `HOST` unset |

Render requires binding its assigned port on `0.0.0.0`. The application does this when `RENDER=true` or `NODE_ENV=production`; local development defaults to `127.0.0.1:4000`. [Render Web Services](https://render.com/docs/web-services)

Set these backend environment variables in Render, never in browser files:

| Variable | Purpose / suggested classroom value |
| --- | --- |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGIN` | Required: exact approved `https://YOUR-USERNAME.github.io`, with no repository path or trailing slash |
| `OPENAI_API_KEY` | Server-side secret, only if live AI is wanted; omit to keep local services available without AI |
| `OPENAI_MODEL` | Existing default `gpt-4o-mini`; must support the existing research pipeline if changed |
| `AI_REQUESTS_PER_CLIENT` | `3` public requests per client IP per window |
| `AI_CLIENT_WINDOW_SECONDS` | `600` |
| `CLASSROOM_AI_REQUEST_LIMIT` | `50` admitted AI submissions per process lifetime |
| `CLASSROOM_PROVIDER_CALL_LIMIT` | `200` outbound OpenAI calls per process lifetime, including research review/recovery calls |
| `AI_MAX_CONCURRENT` | `2` active AI submissions |
| `API_REQUESTS_PER_MINUTE` | `300` API requests per IP; covers catalog/account/health as well as chat |
| `AI_PROVIDER_TIMEOUT_MS` | `45000` per provider call, maximum 60000 |
| `AI_RESPONSE_TIMEOUT_MS` | `180000` total AI response deadline; keep at or below the browser's 195-second chat deadline |
| `LOCAL_DEV_ORIGINS` | Optional comma-separated extra loopback origins, e.g. `http://localhost:8080` |

Only `NODE_ENV`, `FRONTEND_ORIGIN`, and the platform's assigned `PORT` are needed for a public non-AI demonstration. Render provides `RENDER=true`; that enables one trusted proxy hop so client IP limits use the platform's forwarded client address and HTTPS cookies can be Secure. Do not use this trust setting behind an arbitrary proxy chain or expose a second ingress that bypasses the trusted Render proxy. Local development ignores forwarded IP headers. All numeric settings reject invalid/zero values. Development's default AI client allowance is 30 to accommodate offline research regression runs; production's default is 3. The `.env.example` explicitly uses the conservative value of 3.

AI admission is checked only after local services and research interview clarification, before any provider request. Account operations, catalog search, and reader's advisory do not consume AI allowances. Each outbound provider call also consumes the separate provider ceiling. A research submission can include several provider operations; the retrieval algorithm, relevance rules, provenance, inspection, and recovery behavior are unchanged. Ceiling or provider failures fail closed rather than inventing research. HTTP 429 replies include Retry-After. Transport requests have bounded header/body timeouts; total AI deadlines abort provider calls and return a graceful unavailable message.

Limits are in memory and apply to a single Node process, not an authenticated identity or durable billing budget. They reset on restarts, redeploys, and instance replacement. Shared classroom networks may share one IP allowance. CORS does not authenticate callers; direct non-browser requests can reach this public simulation. Keep these conservative limits, use only fictional data, and review usage before expanding the class. A provider ceiling reached midway through research can produce a safe failure instead of a complete answer.

## GitHub Pages frontend (prepare now; publish only after authorization)

The public, non-secret backend setting is `window.PERICLES_CONFIG.backendUrl` in `frontend-config.js`. An empty value preserves same-origin localhost behavior. For Pages, generate an allowlisted artifact with the real HTTPS Render origin:

PowerShell:

```powershell
$env:PUBLIC_BACKEND_URL = 'https://YOUR-SERVICE.onrender.com'
npm.cmd run build:frontend
```

POSIX shell / a future CI build:

```sh
PUBLIC_BACKEND_URL=https://YOUR-SERVICE.onrender.com npm run build:frontend
```

This only writes `dist-frontend/`; it never commits, pushes, uploads, or deploys. The script refuses to reuse a nonempty output directory so unreviewed stale files cannot be published accidentally. For a repeat build, archive/move the previous output first or choose a new empty directory with `npm run build:frontend -- --output another-empty-directory`.

Publish **only the contents of this artifact**, never the source repository's root. Its shared allowlist contains HTML, CSS, browser JavaScript, the synthetic catalog, and `.nojekyll`. Backend modules, `.env`, local state, package files, tests, and diagnostic reports are excluded. The generated `frontend-config.js` contains only a public URL, never credentials. The entire artifact should be reviewed before authorizing publication.

After authorization, choose GitHub Pages' **GitHub Actions** publishing source and use a reviewed workflow to: check out the repository, select Node 22, run `npm ci`, set the public `PUBLIC_BACKEND_URL` build variable, run `npm run build:frontend`, upload **only `dist-frontend`** with `actions/upload-pages-artifact`, and deploy that artifact with `actions/deploy-pages`. Grant only the documented Pages/OIDC permissions and protect the deployment environment. No publishing workflow is installed or activated by this pass. Alternatively publish the artifact alone on a dedicated Pages publishing branch after an explicit commit/push authorization. [GitHub publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

The origin is `https://YOUR-USERNAME.github.io`; a project path such as `/Z604/` is not part of CORS configuration. Browser API calls for chat, account selection, summaries, previews, confirmations, and catalog hold search all go through `api-client.js` to the configured backend. The browser catalog itself can still browse the public synthetic dataset offline. Chat record links retain the Pages project path. Without a configured backend, Pages reports a useful configuration error rather than pretending to run a backend.

## Sessions and restricted origins

Allowed browser origins are the one configured GitHub Pages origin plus exact local development origins `http://localhost:4000`, `http://127.0.0.1:4000`, the same two hosts on ports 5500 and 5173, and explicitly configured extra loopback origins. There is no wildcard or arbitrary github.io subdomain allowance. Requests from another origin receive 403, including reads. Approved preflights allow GET/POST/HEAD and Content-Type/X-Demo-Session only. Origin checks apply before body parsing and route execution.

Because Pages and Render are different sites, the frontend does not rely on third-party cookies. The backend returns an opaque 256-bit demonstration session through the exposed X-Demo-Session response header. The frontend retains it in sessionStorage and returns it in the request header; cross-site fetch omits cookies. The session follows navigation in the same tab, expires after two hours, and disappears on backend restart. A new tab may need to select a fictional patron again. The existing HttpOnly, SameSite=Strict cookie remains supported for direct localhost/same-origin clients. Never use this JavaScript-accessible selector token for real patron authentication; all three accounts remain intentionally public fictional examples. Approved origins must be controlled by the classroom operator.

## Disposable JSON persistence — not cloud durability

The three patrons and all circulation policies remain intact. The JSON store stays at `pericles/data/circulation.json` and uses atomic local replacement in one Node process. It is excluded from git, the frontend artifact, and Express public routes. Render's default filesystem is **ephemeral**: local changes can be lost on restart/redeploy or free-service spin-down. This resets renewals, holds, history, receipts, and seed dates when the file is lost; in-memory sessions, pending confirmations, and usage counters also reset. The next account selection seeds a fresh classroom scenario with dates relative to that day's Indianapolis date. Do not promise continuity across class sessions or instance resets. [Render filesystem FAQ](https://render.com/docs/faq), [free-service limitations](https://render.com/docs/free)

No persistent disk or database is configured. This is appropriate only for disposable classroom data. Do not scale horizontally against the JSON file. A durable storage design would be a separate change; this preparation does not claim durable cloud persistence.

## Verification before a later deployment

Run `npm test`, JavaScript syntax checks, and `npm audit`. Review `pericles/evaluation/deployment.test.js`: it covers Render host/port configuration, minimal health, exact CORS and preflights, cookie-free cross-site circulation, general/IP/global/provider/concurrency limits, unavailable providers, safe JSON errors, frontend API URL routing, session propagation, Pages record paths, and the static artifact allowlist.

After deployment is authorized, smoke-test both the Pages project URL and Render backend: health should return only `{ "ok": true }`; select each fictional patron, read checkouts, preview and confirm one eligible renewal, verify blocked items unchanged, and preview/confirm a hold. Repeat a yes and confirm no duplicate. Verify catalog APIs and a chat record link. A disallowed Origin must get 403; source/state/diagnostic URLs must get 404. Test throttling with reduced test ceilings without spending live AI credits. Preview in-browser before the class; this pass performs local HTTP and executable frontend tests only and does not claim a live Render/Pages verification.
