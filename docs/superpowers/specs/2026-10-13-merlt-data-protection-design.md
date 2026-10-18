# MERL-T data protection — design

**Status:** decided, for release 1.8.0. The owner decided the direction on 12 October and
answered the open questions on 18 October (§5).

## 1. What was decided

The owner wants MERL-T to collect data and to inform users properly, without burying their
interface under it: collection must never interrupt the work flow. Concretely:

- the legal basis is **consent**, asked **once, outside the work flow** (no banner during work),
  with a complete notice; the user can change or revoke it at any time from Impostazioni; data
  comes only from those who said yes;
- the gaps found on 12 October are fixed before other users' data is collected (this round).

## 2. What MERL-T collected, and the gaps

Verified on `develop` 05a2f4bd.

- **Events** (`/api/merlt/events/*` → MERL-T `tracking_events`), at level `basic` and above, from
  every user (not only in development mode): article read (time, scroll), highlight (text up to
  2,000 characters), note (anchored text and the **full note** up to 5,000), bookmark and dossier
  addition (tags, dossier id), citation opened (text), Forum like/download/suggestion (environment
  id and **its author's id**, a third party). Each event carries the user id in clear, plus the
  authority and qualification MERL-T assigns.
- **Assistant questions** (`qa_traces`, `basic`), **feedback** on answers and sources, **citation
  feedback** — at `full`, a click on «Apri nella pratica» in a citation preview sends the
  citation and about 1,000 characters around it automatically — **proposals and votes** for the
  graph, **uploaded documents** (`full`).
- **Gaps:** no notice named any of this (the consent dialog said «nessun tuo contenuto viene
  condiviso senza una tua azione esplicita»); the banner asked during work; no expiry; no export;
  no erasure — account deletion never reached MERL-T; the server's dead-letter file kept payloads
  with note texts, without rotation; MERL-T kept up to 10,000 events in memory when its database
  was down, never drained; code and docs called the user id «anonymized» and «opaque».

## 3. The pull requests

One per area, because every item spans MERL-T, the server and the web app: split by item, each
would edit the same files three times.

| PR | Area | What |
| --- | --- | --- |
| 1 | `services/merlt` | Per-user export and erasure (`merlt/privacy/user_data.py`, `GET`/`DELETE /api/v1/user-data/{id}`, admin key); `tracking_events` expiry (`merlt/privacy/retention.py`); no in-memory event buffer; the words. |
| 2 | `apps/server` | The dead-letter log without personal data, a file a day, deleted after 7 days; Forum events without the author's id. |
| 3 | `apps/server` (+ migration) | The notice as a versioned text; consent recorded with the notice version and required for collection; erasure on account deletion and on request, with durable retries; export; revoke-and-delete. |
| 4 | `apps/web` | The banner removed; one calm consent screen; Impostazioni «Dati MERL-T»; the admin editor for the notice. |

PRs 3 and 4 merge only after the owner approves the notice wording.

## 4. Design

**Erasure** (PR 1, called by PR 3). `USER_COLUMNS` is the one inventory of columns holding a
user id; a test fails when a model gains such a column outside it. Private data is deleted;
proposals not approved are deleted with their votes; what the community took up (approved
proposals, votes, issue reports, the graph's `contributed_by`) stays with the link to the person
cut (null, or a random `erased:<uuid>` per row where the column is NOT NULL — it names nobody and
keeps the unique constraints on votes). Other people's Forum events lose `target_author_id`. The
uploaded files are deleted (only inside `UPLOAD_DIR`); the RLCF replay buffer drops the person's
experiences, in memory and on disk. Left as they are: `audit_log` (an append-only hash chain) and
`api_keys` (service keys). Every step is idempotent; a failed store makes the answer 503 and the
server retries.

**Retention** (decided, §5). `tracking_events`: `MERLT_TRACKING_RETENTION_DAYS`, default 365.
The assistant's questions, the judgements and the citation feedback:
`MERLT_ASSISTANT_RETENTION_DAYS`, default 730 (#185). Dead letters: 7 days, and they hold no
personal data.

**Notice and consent** (PR 3). The notice is the text `INFORMATIVA_MERLT` in the store of the
Studia texts to accept (`LingoTestoVersione`, decision 22 of
`2026-10-07-studia-cards-screens-design.md`): versioned, edited by administrators as new
versions, never overwritten. A consent records the version it was given under
(`merlt_user_preferences` and each `merlt_consent_audits` row). Collection requires the current
version: when an administrator publishes a new one, collection pauses for each user until they
answer it again (*open*: whether existing consents are asked again — recommended yes, since the
old notice was materially incomplete).

**Account deletion** (PR 3). `deleteUserAccount` writes a `merlt_erasure_requests` row in the
same transaction that deletes the user; a worker sends it to MERL-T and retries with backoff
until MERL-T answers that every store is done, then deletes the row.

**Screen** (PR 4). One screen at the first app load after login, for new and existing accounts
(registration needs an administrator's approval, so the account does not exist yet when the form
is filled). No level preselected for a user who never answered; their level for one who did.
Impostazioni gains «Dati MERL-T»: level, the notice, «Scarica i miei dati», «Elimina i miei dati
MERL-T»; revoking offers «Revoca ed elimina i dati raccolti» and «Revoca soltanto».

## 5. The owner's answers (18 October 2026)

His words, to the questions as numbered by the orchestrator (213–221):

| # | Question | Answer |
| --- | --- | --- |
| 213 | Activity events kept 12 months; dead letters 7 days, without personal data | «ok» |
| 214 | Forum events without the author's id | «confermo» |
| 215 | Erasure deletes the private data, keeps what the community approved, unlinked | «confermo» |
| 216 | Ask existing consents again | «non è stato ancora raccolto nulla, quindi non è una criticità» — kept as built: a level from before the notice collects nothing until answered |
| 217 | Controller and contact in the notice | «ok poi lo faremo al go-live publico» |
| 218 | The assistant's questions to LLM providers through OpenRouter, possibly outside the EU | «sì verifico io» |
| 219 | Questions to the assistant, judgements and citation feedback kept 24 months | «ok» |
| 220 | The notice wording | «va bene, poi la rivedo io alla fine» |
| 221 | The text of a lawyer's notes (professional secrecy): (a) as is, (b) only at «Completo», (c) never | «c» |

What follows from them:

- The text of a note is **never** collected: the web does not send it, the server strips it
  from an older client, MERL-T removes it from stored events at every retention pass.
- The assistant's questions, judgements and citation feedback expire after 24 months
  (`MERLT_ASSISTANT_RETENTION_DAYS`, default 730).
- Version 1 of the notice carries no controller or contact: until the public opening it
  says they will be stated there, and requests go through «Invia feedback».

**Before the public go-live (must do):**

1. Publish a new version of the notice from the admin screen naming the controller and a
   contact for the rights (question 217). Every user is asked again at their next entry.
2. The owner verifies OpenRouter's terms for transfers outside the EU (question 218), and the
   notice's sentence on it is changed if they do not hold.
