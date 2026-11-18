# A web session that can be revoked: cookies, kept on the server

Status: proposed on 16 November 2026 under G-455 («Direttamente la soluzione completa con i cookie»). Decisions D1–D5
below are for the owners. This is a document only; the plan follows once they are settled. The server is the security
line's work; the web is the web owner's (see «For the web owner»). The repository scan of 11 November calls this
point A.1.

## Why

Today the web signs in with two JWTs kept in `localStorage`: an access token (30 minutes) and a refresh token
(7 days). Each refresh hands back a new 7-day refresh token (`authController.refresh`), and the server keeps no record
of either token (`utils/jwt.ts`). As a result:

- whoever obtains a copy of the refresh token stays signed in indefinitely, by refreshing before it expires;
- neither a password change (`changePassword`) nor an administrator's reset (`adminController.resetPassword`, or the
  command `utils/reset-admin-password.ts`) ends any session;
- signing out only empties the browser's storage. There is no server logout, so an earlier copy keeps working;
- any script running in the page can read both tokens, and the page now includes lawyers' acts with their clients'
  data (Atti, #473).

Only deactivating or deleting the account stops a session today (`middleware/auth.ts` loads the user on every
request).

## What changes for a user

- **Signing out signs out.** «Esci» ends the session on the server too, and a copy taken earlier stops working.
- **Changing the password ends the other sessions**: other browsers and devices must sign in again; the one in use
  stays signed in.
- **An administrator's reset ends every session** of that account (D3).
- **A session lasts at most 30 days and ends after 7 days without use** (D2). Today one used at least once a week
  never ends.
- **Each person can see their open sessions** (browser, system, last use) and end any or all of them (D5, web).
- **On the release day everyone signs in once more** (D4).

## Design

### D1 · The mechanism: an opaque session kept on the server (recommended)

A session is a row on the server. The browser holds only its random key, in a cookie that scripts cannot read.

**The cookie**

- Its value is a 256-bit random secret (`oauth/hash.ts` `randomSecret`).
- Attributes: `HttpOnly; SameSite=Strict; Path=/`, no `Domain`. `Secure` and the `__Host-` prefix are added whenever
  the app is served over HTTPS (see «Plain HTTP» below).
- `Max-Age` is the absolute lifetime; the server enforces the idle limit.
- The path is `/`, not `/api`. The ingress's login check runs `forward_auth` to `/api/auth/verify` for the scraping
  routes (the `@legal` list in `infra/ingress/Caddyfile`: `/fetch_*`, `/stream_article_text`, `/search_*`,
  `/parse_query`, `/extract_citations`, `/export_pdf`…). That check reads the cookie from the request to those routes.

**The `WebSession` table** has one row per session:

- `id`, and `userId` (cascade on account deletion);
- `secretHash`: SHA-256, unique. The secret itself is never stored;
- `createdAt`, `lastUsedAt`, and `expiresAt` (the absolute limit);
- `label`: the browser and system family («Firefox su macOS»), derived once from the User-Agent; the raw string is
  never kept;
- no IP address.

The migration is written by hand and reserved in the owners' register first.

**Resolving the session**

- A middleware, `webSession`, runs early, beside `delegatedAuth` and before the rate limiters. It looks up the session
  by the hash of the cookie, together with its user, in one query, and sets `req.user`.
- `authenticate` then only checks that `req.user` is set, as it already does for a delegated token.
- The limiters' `identifyUser` (`middleware/rateLimiter.ts`) reads `req.user` instead of decoding a Bearer. Without
  that, every web user would fall into the anonymous tier: 100 requests a minute per address, shared by a whole office
  behind one NAT.
- A session is valid while `now < expiresAt`, `now < lastUsedAt + idle`, and its user is active.
- `lastUsedAt` is written at most once every 10 minutes per session, by an `updateMany` conditioned on the old value,
  so a burst of requests causes no burst of writes.
- Revoking deletes the row: the session ends at its next request. No access token stays valid until it expires.

**Sign-in, refresh, clean-up**

- **Sign-in** creates a new row and sets the cookie, so a session cannot be fixed in advance. Any cookie the browser
  presented is deleted with its row. The response carries the user, no tokens.
- **No refresh.** There is nothing to refresh. `/api/auth/refresh` answers 401 for one release, a status the current
  web already reads as «session over» (a 410 would leave an old tab believing it is signed in), and is then removed.
  The race of tabs refreshing at once, and the web code that manages it, go with it.
- **Expired rows** are swept daily, beside the sweep of OAuth requests and codes (`oauth/sweep.ts`).

**Alternative, not recommended: JWTs in cookies, with rotation.** A 15-minute access JWT in one cookie, and an opaque
refresh token in a second cookie on `/api/auth`, rotated at each use with detection of reuse, as `oauth/tokens.ts`
does for MCP clients.

- It would gain requests that skip the database while the access token lasts. That buys nothing here: the user is
  already read on every request.
- It would cost a revocation that waits up to 15 minutes, two cookies, a refresh flow, and a race. Tabs share one
  cookie jar, so two tabs refreshing at once look like a reuse and end the session, unless the web adds a lock and the
  server a grace window.

### D2 · Lifetimes

7 days idle, 30 days at most (recommended), configurable (`SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS`). The idle limit is
what applies today (the refresh token's 7 days); the ceiling is new.

### D3 · What ends sessions

| Event | Web sessions | OAuth connections (MCP clients) |
| --- | --- | --- |
| Signing out | this one | untouched |
| «Esci da tutti i dispositivi» | all, this one included | untouched |
| Changing one's own password | all except the one in use | untouched; the connections page lists them (recommended) |
| Administrator's password reset, from the admin page or `npm run db:reset-admin` | all | all revoked (recommended: a reset means a forgotten or compromised password) |
| Deactivation by an administrator | all deleted (they already stop working today) | already refused today (inactive user) |
| Account deletion | cascade | cascade (already) |

### Cross-site requests (CSRF)

The browser now attaches the credential itself, so a request from another site must not count as the user's. Two
defences.

**First defence: `SameSite=Strict`.** The browser does not send the cookie on a request another site starts. The app is
a single page and its own calls are same-origin `fetch`, which carries the cookie. A link to the app from an e-mail
opens the page; the calls that follow are the page's own.

**Second defence: the server guard.** It applies to every `POST`, `PUT`, `PATCH` and `DELETE` under `/api`, whatever
authenticates it. That includes sign-in and registration: the server also reads HTML forms (`express.urlencoded` in
`app.ts`), so without the guard another site could post its own credentials and sign the victim into the attacker's
account. Two exemptions only: requests authenticated by an OAuth Bearer token (`delegatedAuth`, no cookie) and the
MERL-T callbacks under `/api/merlt/internal/*` (`X-Internal-Secret`). The guard requires:

- the header `X-VisuaLex-Client: web`. A form on another site cannot set a header, and a cross-origin `fetch` that sets
  one is stopped by CORS before it leaves;
- if an `Origin` header is present, an origin listed in `ALLOWED_ORIGINS` or equal to the request's own host. The
  second case keeps the app working when it is opened by another name of the same host, such as a home-network
  address;
- a refusal is `403` with `code: "csrf_refused"`, distinct from a refused session, and the web must not sign the user
  out on it.

**The scraping routes.** `forward_auth` always calls `/api/auth/verify` with `GET`, so for those routes the check
happens there: when `X-Forwarded-Method` is not `GET` or `HEAD`, verify requires the same header. Otherwise a POST to
`/export_pdf` from another site could spend the user's quota.

**Pages that now depend on the guard.** The OAuth consent decision (`POST /api/oauth/requests/:id/decision`), account
deletion, password change and the administrator's routes are protected today by the `Authorization` header, which no
other site can set. With cookies they rely on the guard. Each gets a test that a request without the header is
refused.

### The ingress

- `forward_auth` already passes the original request's headers to `/api/auth/verify`, cookie included, together with
  `X-Forwarded-Method`.
- The two blocks that proxy to the scrapers add `header_up -Cookie` beside `header_up -Authorization`, so the scrapers
  never see the session. `infra/ingress/paths.test.mjs` checks it. `infra/` is reserved in the register first.

### Plain HTTP (the first, private phase)

A browser does not store a `Secure` cookie received over plain HTTP; Chrome and Firefox make an exception for
`localhost`. The private phase serves plain HTTP (`Caddyfile`, header), so a fixed «Secure in production» would lock
everyone out on release day.

- The server derives the flag from the app's public origin: `Secure` exactly when the first origin in
  `ALLOWED_ORIGINS` starts with `https://`. In production that list comes from `PUBLIC_ORIGIN` in `infra/.env`
  (`infra/compose.app.yml`).
- `SESSION_COOKIE_SECURE` overrides the derived value, in either direction, and the server logs one line at start
  when the cookie is not `Secure`.
- `scripts/prod/preflight.sh` refuses the two inconsistent cases: an `https://` origin with `Secure` off, and a plain
  `http://` origin other than localhost with `Secure` forced on.

### What stays as it is

- **OAuth and the MCP.** `delegatedAuth`, the consent flow and the MCP's tokens are unchanged; they use their own
  secret, not `JWT_SECRET`.
- **The scraping gate's limits.** Unchanged.
- **The Python API.** In production it never receives the cookie: the ingress strips it. In development Vite's proxy
  forwards the browser's headers to it; the web owner can strip the cookie there too (item 9 below).
- **The Bearer user JWT.** No longer accepted once the web has moved (see «Order»). `JWT_SECRET` stays as long as
  anything still signs with it.

### Data protection

- **What a session row holds:** the user's id, dates and a coarse device label. No IP, no full User-Agent. It is
  deleted with the account and swept when expired.
- **The privacy notice** says so when it is reread against the code (G-456).
- **No consent banner:** the session cookie is strictly necessary.

## How it pairs with the CSP

`HttpOnly` puts the session out of reach of scripts: an injected script can no longer copy a credential and use it
elsewhere. While the page is open, though, it can still act as the user, with the user's own cookie. The CSP is what
stops such a script from running at all.

- **Today** the CSP is only reported (`Content-Security-Policy-Report-Only` in `infra/ingress/Caddyfile`), and nobody
  collects the reports, so it stops nothing.
- **Proposed:** make it binding in the same release as this change, or the next. The web owner checks the browser
  console on the main pages; the deployment host's operator switches the header.
- **The policy itself needs no change for cookies.** `default-src 'self'`, `connect-src 'self'` and
  `frame-ancestors 'none'` already fit.
- **Together they close the risk.** Cookies alone or a binding CSP alone each leave half of it open.

## For the web owner

What the web changes; the shape of the code is the web owner's choice.

1. **No token in the browser.**
   - Remove every read and write of `access_token` and `refresh_token`: `services/authService.ts`, `services/api.ts`,
     and the hand-made headers of `features/merlt/contrib/contribApi.ts`, `store/deferredRemovals.ts`,
     `services/assistantService.ts` and `services/legalFetch.ts`.
   - Drop the two fields from the login response type (`types/api.ts`).
   - In `services/sessionEnd.ts` and its inventory test (`browserStorageInventory.test.ts`), the two keys leave the
     list of stored keys. On the first load after the release they are removed once.
2. **No refresh.**
   - These go: the single in-flight refresh, the expiry checks (`isAccessTokenExpired`, `readExpSeconds`), the refresh
     before a `keepalive` fetch, and `legalFetch`'s refresh-and-retry on 401.
   - A 401 means the session is over: `clearUserData`, then the sign-in page.
   - A 5xx or a network error keeps the user signed in (T80's rule, unchanged).
   - A 403 with `code: "csrf_refused"` is an error to show, never a sign-out.
3. **«Am I signed in?» is a state in memory.**
   - It comes from `GET /api/auth/me` at start (200 signed in, 401 not) and from sign-in and sign-out.
   - It replaces the synchronous `isAuthenticated()` that reads the token today: `hooks/useAuth.ts`, `SearchPanel`,
     `ArticleTabContent`, `useArticlePassageThreads`, `store/useAppStore.ts`.
4. **Every request that changes something carries `X-VisuaLex-Client: web`**: sign-in and registration, the axios
   client's default header, and every hand-made `fetch`, `keepalive` ones and the scraping routes' POSTs included.
5. **The API at a relative address (`/api`).** Same-origin `fetch` sends the cookie without any `credentials` option.
   `docs/frontend/setup.md` and `apps/web/.env.example` still suggest a `VITE_API_URL` on another origin, which would
   need credentials and CORS. Correct them.
6. **Sign-in:** the response is the user, with no tokens.
7. **Sign-out:** `POST /api/auth/logout`, then the user's data is cleared as today.
8. **Account page (D5): a «Sessioni aperte» section.** Each session shows its label and last use, the current one
   marked. «Esci» beside each, and «Esci da tutti i dispositivi». Copy in Italian.
9. **Development:** Vite's proxy can strip the cookie toward the Python API (`vite.config.ts`, the proxy block).
10. **Tests rewritten for the cookie.**
    - Among them: `api.refreshFailure`, `api.signInNoRefresh`, `api.session`, `api.returnTo`, `legalFetch.guard`,
      `legalFetch`, `authService` (current user, dev mode, logout), `deferredRemovals`, `highlightEdits`,
      `noteUndoShortcut`, `DevMode.flow`, `useAuth.devMode`, and the login form's tests.
    - The guard's rule stays: every call to the scraping routes goes through one helper, which now adds only the
      header on writes.

## Server routes

| Route | What |
| --- | --- |
| `POST /api/auth/login` | as today, plus a new session and its cookie; the response is the user, no tokens |
| `POST /api/auth/logout` | deletes this session, clears the cookie (204) |
| `GET /api/auth/sessions` | the user's sessions: id, label, `createdAt`, `lastUsedAt`, `current` |
| `DELETE /api/auth/sessions/:id` | ends one of one's own sessions; another user's id gives 404 |
| `POST /api/auth/logout-all` | ends all of one's sessions, this one included |
| `POST /api/auth/refresh` | 401 for one release, then removed |

## Order

1. **Server**, one PR:
   - the table and its migration, `webSession`, the guard, the routes above, the revocations of D3, and
     `identifyUser` on `req.user`;
   - the test helper (`tests/helpers.ts`: `createTestUser`, `authHeader`) makes a session cookie and adds the
     header. The test files that call it follow; the ones that carry OAuth delegated tokens stay as they are.

   In this step the current web must keep working in development:
   - a Bearer user JWT, when present, still authenticates and takes precedence over a cookie;
   - a request carrying it passes the guard, because the header is itself the proof of a same-origin caller, as
     today;
   - sign-in sets the cookie only when the request carries `X-VisuaLex-Client: web`. Otherwise it answers with
     tokens, as today, so the old web keeps them, and with no cookie, so another site's form gets nothing it can
     use.
2. **Web**, the web owner's PR (the list above).
3. **Server, ingress and tools**, one PR:
   - **server:** the Bearer user JWT and the tokens in the sign-in response are removed; sign-in and registration
     require the header; `/auth/refresh` answers 401;
   - **ingress:** it strips the cookie toward the scrapers;
   - **`tools/e2e`:** a separate cookie jar per simulated user, the header on writes, and no more refresh-rotation
     step (`flows/flow_auth.py`); `preflight.py` follows;
   - **`scripts/merlt-live-smoke.sh`:** curl with a cookie jar and the header;
   - **docs that describe the tokens:** `apps/server/CLAUDE.md`, `docs/architecture.md`,
     `docs/backend/node_backend.md`, `apps/server/README.md`.
4. **One release** carries all three (D4), so production never runs a mix. Its Italian note says that everyone signs
   in once more.
5. **The binding CSP** follows, in the same release or the next (the deployment host's operator).

## Decisions for the owners

- **D1 · Mechanism:** an opaque session kept on the server (recommended), or JWTs in cookies with rotation.
- **D2 · Lifetimes:** 7 days idle and 30 days at most (recommended), or other values.
- **D3 · Revocations** as in the table. In particular, an administrator's reset also revokes the OAuth connections
  (recommended); one's own password change does not.
- **D4 · Transition:** everyone signs in once at the release (recommended). The alternative, accepting the old tokens
  for 7 more days, keeps today's weakness for those 7 days.
- **D5 · «Sessioni aperte» on the account page:** in this round (recommended), or later. The server routes come in
  step 1 either way.

## Not in this change

- **The login limiter:** per account, kept in Redis, failing closed (scan B). A separate pull request.
- **Self-service password reset by e-mail:** parked; a separate decision.
- **Two-factor sign-in.**
- **Registration by invitation** (risk R-06, which the deployment host's operator carries).
