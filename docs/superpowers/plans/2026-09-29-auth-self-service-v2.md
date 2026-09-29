# Self-service authentication — plan v2 (DRAFT 2)

**Date:** 2026-09-29
**Order:** this round now comes **after** the deployment round
(`docs/superpowers/specs/2026-09-29-modular-deployment-design.md`), by the owner's choice.
**Status:** DRAFT for the owner's review. Section 2 records the four decisions taken on
29 September; section 5 lists what is still open before Task 1 can start.
**Supersedes:** the implementation plan `2026-09-10-auth-self-service.md` (kept on the
parked branch `feature/auth-self-service`, with its Task 1 commit `720d682`).
**Keeps from the design** `2026-09-10-auth-self-service-design.md`: D3 (a reset kills
sessions through `tokenVersion`), D5–D10, the token lifecycle, the mailer, WS4, WS5, WS7.
**Replaces in the design:** D1 (registration open to anyone with a confirmed address)
and D2 (the `REQUIRE_ADMIN_APPROVAL` switch) — see section 3. The per-task code of the
old plan (2,876 lines) is not rewritten here: it is re-derived one task at a time,
against the code as it is, once section 5 is answered.

## 1. What changed since 10 September

| Then | Now | Effect on the plan |
|---|---|---|
| `backend/`, `frontend/`, root `app.py` | `apps/server`, `apps/web`, `services/visualex` (monorepo, one `develop`) | Every path in the old plan is wrong. Task 1's commit cannot be cherry-picked as is; re-apply it by hand. |
| One `PrismaClient` per module | One client, `src/lib/prisma.ts`; `tests/prismaClient.test.ts` fails on a second | New modules import `prisma` from there. |
| Last migration `20260716…` | Last migration `20260928120000_add_article_thread_passages` | The old migration is dated 10 September and would sort **before** seven already-applied ones. It gets a fresh timestamp, or `migrate dev` reports drift. |
| A production server, `deploy.sh`, nginx | Neither exists (retired 26 September); `docs/deployment.md` is gone, only `docs/archive/deployment-lightsail.md` remains | The old Rollout section is obsolete. Rewritten in section 6. |
| Registration open to anyone | A closed beta (decision D-018 of the OMNILEX register) | Resolved by decision Q1: invite codes. |
| Login is a plain product feature | The plan for the remote MCP connector builds on VisuaLex login with expiring tokens | `tokenVersion` becomes shared infrastructure; get the claim right the first time. Nothing to build for the connector here. |
| MERL-T is a separate branch | MERL-T routes live in `apps/server` behind the same `authenticate` | The one-off sign-out of WS4 also drops MERL-T sessions. |
| Nothing is reachable from outside | The stack is to run on the home server and be exposed under the domain | Promotes WS6 and adds a prerequisite workstream, section 5. |

### Two defects found while re-reading the spec against the code

1. **The spec's premise about `isVerified` is half wrong.** It says `adminController`
   "sets `true` on every admin-created user". It does not: `create` writes `isActive`
   but not `isVerified` (the `true` at lines 38 and 89 is inside a `select`). Once login
   refuses an unverified user, **every admin-created user is locked out**, including the
   two the E2E harness provisions. The seed script and `tests/helpers.ts` already set
   it; the admin `create` must too. A Task 1 step, with a test.
2. **`tools/e2e/flows/flow_auth.py` asserts the old contract**: its negative step expects
   `/auth/register` to create an inactive user and login to answer 403 for that reason.
   Under the new contract register needs an invite code and the 403 has a different
   cause. The step is rewritten, not deleted.

## 2. Decisions taken on 29 September

| # | Decision |
|---|---|
| Q1 | **Closed registration with invite codes, plus self-service password reset.** An admin issues a code; without one nobody can register. The invite is the approval, so `REQUIRE_ADMIN_APPROVAL` is dropped. |
| Q2 | The Resend key, the sending domain and the public URL are the owner's inputs. How to obtain them is in section 6. Until they exist the mailer logs the mail instead of sending it, as the design already specifies for development. |
| Q3 | The whole stack runs on the home server and is exposed under the domain. WS6 is kept, and section 5 lists what exposure requires. |
| Q4 | The one-off sign-out at release is accepted (one user today). Strict `payload.tv !== user.tokenVersion`, no lenient `?? 0`. |

## 3. Invite design (replaces D1 and D2)

**Data model** — a second new table beside `AuthToken`:

```prisma
model Invite {
  id          String    @id @default(uuid())
  codeHash    String    @unique @map("code_hash")   // sha256; the code is shown once
  label       String?                                 // "for Luca" — the admin's own note
  createdById String?   @map("created_by_id")
  usedById    String?   @map("used_by_id")
  expiresAt   DateTime  @map("expires_at")
  usedAt      DateTime? @map("used_at")
  revokedAt   DateTime? @map("revoked_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  createdBy User? @relation("InviteCreator", fields: [createdById], references: [id], onDelete: SetNull)
  usedBy    User? @relation("InviteUser", fields: [usedById], references: [id], onDelete: SetNull)

  @@map("invites")
}
```

The relations are `SetNull`, not `Cascade`: deleting an account must not erase the
record that an invite was issued or spent. `tests/accountData.test.ts` (export and
delete) is reviewed in Task 1 because it walks the `User` relations.

**The code.** 16 random bytes, base64url (128 bits), so guessing is out of the question
whatever the rate limit. Only its sha256 is stored (the design's D9, applied to invites).
Single-use, valid 7 days by default (the admin may choose 1–30), revocable, issued by an
admin only. It travels as a link, `APP_BASE_URL/register?code=…`, and the register form
also accepts it typed. It is **not** bound to an email address: the admin sends it over
whatever channel they trust, and `usedBy` records who spent it. Binding a code to an
address is a later option, not built now.

**Admin API** (`requireAdmin`): `POST /admin/invites` returns the code and the link once;
`GET /admin/invites` lists status (pending, used by, expired, revoked) without codes;
`DELETE /admin/invites/:id` revokes. **Admin UI:** an "Inviti" tab in `AdminPage`: create
with label and validity, the link shown once with a copy button, the list, revoke.

**`register`** gains a required `invite_code`. In one transaction: reject an invalid code;
check that email and username are free; create the user (`isActive: true`,
`isVerified: false`); spend the invite with a conditional update — `usedAt` and
`revokedAt` null and `expiresAt` in the future — that must touch exactly one row, or the
transaction rolls back. The verification mail goes out after commit.

**The enumeration contract, revised.** A caller without a valid code learns nothing:
missing, unknown, used, expired and revoked codes all answer the same 400, whatever
email is submitted. A caller **with** a valid code is a vetted invitee and gets explicit
messages for a taken email or username, without spending the code. `forgot-password` and
`resend-verification` stay always-generic 200s. `login` refuses an unverified address with
its own 403, only after the password is right, so it is no oracle.

**Verification stays.** The invite proves the admin trusts the person, not that the
address is typed correctly, and a wrong address means a reset mail that never arrives.
So `verify-email` completes the signup and logs the user in (design WS3, unchanged).

## 4. Task list on the present tree

`S` = `apps/server`, `W` = `apps/web`, `P` = `services/visualex`.

| # | Task | Tree | Notes |
|---|---|---|---|
| 1 | Tables `auth_tokens` and `invites`, `User.tokenVersion`, grandfathering migration | S | Fresh timestamp; `UPDATE users SET is_verified = true WHERE is_active = true`; **admin `create` sets `isVerified: true`** (defect 1) with a test; `tests/setup.ts` truncates both tables; review `accountData.test.ts`. |
| 2 | Mailer, templates, config | S | `fetch`, no npm dependency (D7). Refuse to boot in production without `RESEND_API_KEY`. Env in `apps/server/.env.example` and `docs/setup.md`: `RESEND_API_KEY`, `MAIL_FROM`, `APP_BASE_URL`. |
| 3 | `tokenVersion` in `jwt.ts`, `authenticate`, `refresh`, `changePassword` | S | First step inside the task: `tests/helpers.ts` mints tokens with the user's current `tokenVersion`, or every authenticated test breaks at once. |
| 4 | Invites: lifecycle and admin API | S | New `utils/invites.ts` (issue, redeem, revoke) and `/admin/invites`; the redeem is the conditional update of section 3, tested under concurrency (two registers, one code, one winner). |
| 5 | `register` with an invite; the login gate; `mailLimiter` | S | Section 3. `mailLimiter` (5/hour/IP, counts successes) on register, resend-verification and forgot-password, in addition to the existing `authLimiter`. |
| 6 | `verify-email`, `resend-verification` | S | The 60-second per-address floor lives in `issueToken`. |
| 7 | `forgot-password`, `reset-password` | S | Reset increments `tokenVersion` and returns no session. |
| 8 | Web: the four calls, `VerifyEmailPage`, register form with the code, login changes | W | First auth tests in `pages/__tests__`. Italian copy, `ui/` primitives, 44px targets. |
| 9 | Web: forgot and reset pages, the "Inviti" admin tab | W | |
| 10 | Python: per-IP ceiling on the scraping paths, and the client-IP fix | P | Promoted by exposure. `visualex_api/tools/config.py`, `app.py`; see P1 in section 5. |
| 11 | Documentation, E2E harness, runbook | docs, `tools/e2e` | `apps/server/CLAUDE.md` (invite contract, enumeration contract), `flow_auth.py` (defect 2), the section 6 runbook as a doc. |

**Gates after every task** (from `CLAUDE.md`): in `apps/server`, `npm test` (it loads
`.env.test` and refuses a database that does not match `/test/i`, which is the
safeguard, not an obstacle); in `apps/web`, `npm run build` (the real type-check),
`npm run lint`, `npm run test`; in `services/visualex`, `.venv/bin/python -m pytest
tests/ -q`. Baselines on 29 September, on the branch that lands PR #15: server 522
passed, web 1469 passed.

**Method:** a branch `feat/auth-self-service` from `develop` (a hook forbids commits on
`develop`; work reaches it by pull request), one commit per task, a review after each,
the mailer mocked at module level (`vi.mock`) because `nockShim` replaces `global.fetch`.

## 5. Exposure: what the auth plan assumes and does not yet have

> **Superseded by the deployment spec** (`2026-09-29-modular-deployment-design.md`), which
> settles P1–P4: the stack runs as modular containers on a dedicated Linux host, the scrapers
> start on that host in an isolated network, exposure is a later phase, and `start.sh` gains
> `--dev` and `--prod`. What follows is kept as the record of how the question arose.

Auth on its own protects the Node routes. Exposing the home server puts three more
things in front of the internet, and only the first has a decision recorded.

**P1 — The Python rate limiter trusts a header the caller controls.**
`rate_limit_middleware` keys on `request.headers.get('X-Forwarded-For', …)`. Reached
directly, any caller sets that header to any value and every request counts as a new
client: the per-IP limit does nothing. Behind a proxy that overwrites the header it is
fine. Task 10 fixes it at the source (read the client address only from the proxy the
deployment names) rather than relying on the proxy being right. Node is already set to
`trust proxy 1`; the hop count must match whatever is put in front.

**P2 — Undecided: the scraping endpoints have no authentication.** The frontend calls
them at the root (`/fetch_article_text`, `/export_pdf`, …), not under `/api`; in
development Vite proxies them to the Quart app. Exposed, anyone on the internet could
drive Normattiva, EUR-Lex and Brocardi traffic from the home IP (which those sites can
then block for the owner too) and start Chromium for PDF exports on the machine. WS6
caps the rate; it does not close the door.

| Option | How | Trade-off |
|---|---|---|
| a. Node authenticates and forwards | Quart binds to `127.0.0.1`; the BFF proxies the legal endpoints after `authenticate` | The clean fix, and one more hop. Changes every legal call's URL in the web app and needs streaming (`stream_article_text`) to survive the proxy. Its own round. |
| b. Forward-auth at the reverse proxy | The proxy asks Node "is this token valid?" before passing a request to Quart | A new small Node endpoint and a proxy that supports it. Like (a), it needs the web app to send the token on every legal call — see below. |
| c. An access layer in front of everything | The tunnel or proxy provider admits only listed people before any request arrives | Zero application code and a second login for testers; a third party sees the traffic. The only option that leaves the web app untouched. |

Options (a) and (b) share a cost that was missed in the first draft: **the browser calls the
scraping endpoints with a bare `fetch` from about seventeen places** (`services/legalApi.ts`,
`SearchPanel.tsx` for the stream and the PDF export, `articleFetchCache.ts`, `actUrn.ts`,
`useAnnexNavigation.ts`, `useCitationPreview.ts`, `CompareView.tsx`, the palette, …) and none
sends the login token, because these calls do not go through `services/api.ts` (the axios
client with Bearer and refresh). Any option that makes the server check the login first needs
those call sites consolidated into one authenticated client — the step the header comment of
`legalApi.ts` already announces and that was never taken. It is a real web change, on files
the reading surface depends on, so it is planned as its own task with its own review.

**P3 — Undecided: how the machine is reached.**

| Option | Trade-off |
|---|---|
| Cloudflare Tunnel | Outbound-only: no port opened on the router, no exposed home IP, TLS handled for you. The DNS zone moves to Cloudflare, Cloudflare decrypts the traffic (a processor for the testers' data), and it is a dependency. Its access layer (option c) may fit a closed beta; Cloudflare's overview page does not state the free-tier terms, so check them before counting on it. |
| Port forwarding + Caddy | Full control, no third party. Needs a public IPv4 address (not carrier-grade NAT) and the ISP not blocking 80/443, publishes the home IP, and leaves hardening (updates, firewall, DDoS) entirely to us. |

**P4 — Undecided: how it runs.** `start.sh` is the development entry point (hot-reload
servers). An exposed host needs a built web app, Node from its build, the Quart app under
a production server (`app.run` is the development server), automatic restart, and a
scheduled `scripts/backup.sh` with a copy off the machine. Keeping one entry point means
`start.sh` gains a production mode; the alternative is a second script.

**Already right:** every store in `infra/compose.yml` binds `127.0.0.1`; MERL-T's port
must never be published (its admin routes have no gate of their own); `ALLOWED_ORIGINS`
unset means localhost only, so production must set it.

## 6. Runbook: obtaining what the code needs (the owner's steps)

**The public URL (`APP_BASE_URL`)** is where testers open the app, for example
`https://visualex.org` or `https://app.visualex.org`. It goes into every emailed link, so
it is fixed after P3 is decided. In development it stays `http://localhost:5173`.

**The Resend key and the sending domain.** Checked against Resend's own documentation on
29 September:

1. Create an account at resend.com. The free plan is 3,000 emails a month, 100 a day and
   3 domains — far above one invite mail and a few resets per tester. Whether a card is
   needed is not stated on the pricing page.
2. *Domains → Add domain.* Resend recommends a **subdomain** (for example
   `send.visualex.org`) so that its sending reputation is kept apart from the root
   domain. Choose the **Ireland (eu-west-1)** region. That region controls where mail is
   sent from; per Resend, account data stays in the United States either way. For the
   testers' data that makes Resend a processor outside the EU, to be covered in the
   privacy notice.
3. Resend shows the DNS records to create. Add them wherever the domain's DNS is managed
   (the registrar, or Cloudflare if the zone moves there). Before adding anything, look at
   the records already there: a domain allows a single SPF record, and a mailbox on the
   same name may already have one.
4. Add a DMARC record too (start with the policy `p=none` so nothing is rejected while
   testing), then press *Verify*. Until the domain is verified Resend delivers only to
   the account owner.
5. *API Keys → Create*. Give the key **sending access only** and restrict it to that
   domain. Resend shows the value **once**. Paste it yourself into `apps/server/.env` as
   `RESEND_API_KEY`; it must not reach chat, commits or logs. `MAIL_FROM` is then
   `VisuaLex <noreply@send.visualex.org>` (the subdomain chosen in step 2).

**Rollout order** (no production to deploy to any more):

1. Back up with `scripts/backup.sh`. The migration adds a column and two tables and runs
   one `UPDATE`; `start.sh` applies it with `prisma migrate deploy`.
2. Verify the domain (steps 2–4) and put the key in `.env`.
3. Start the stack; create an invite from the admin tab; register a throwaway address with
   it. Check: mail received, link confirms and logs in, reset works, and a refresh token
   issued before the reset is rejected.
4. Only then expose the machine (P3), with P1 and P2 settled.

## 7. Declared, not forgotten

- Tokens stay in `localStorage`; no 2FA, no session list, no email change, no CAPTCHA,
  no Forum moderation — as in the design's non-goals. Invite-only registration is what
  keeps the Forum closed.
- This plan does **not** touch the MCP connector's OAuth; it only keeps the token claim
  compatible with it.
- The testers' privacy notice and the security measures for the exposed host are legal
  work that this plan does not cover and that must exist before anyone else is invited.
- Cited by ID only, because this repository is public: OMNILEX decision D-018.
