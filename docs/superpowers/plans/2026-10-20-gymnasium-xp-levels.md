# Gymnasium: experience points, levels and missions on the server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server keeps Gymnasium's missions and their experience points (XP): an append-only ledger with one credit per mission per period, the level computed from its total, the missions decided from stored facts only, and the answers the web needs for the level bar, «+20 XP» and the celebration of a new level (G1c).

**Architecture:** One server pull request. A migration adds the ledger `lingo_crediti_xp` and the counters `lingo_giornate_studio.voti` and `.ripassi_dovuti` (G-334). `lingo/levels.ts` is the one definition of the curve. `lingo/missions.ts` holds the catalogue, the evaluation of each mission from stored facts, `settleMissions` (the one writer of the ledger, inside the caller's transaction, under a savepoint, the user's XP lock and the daily ceiling) and `readMissions` (the list the read answers). The grade, the proposal, the vote, the progress read and the session read call `settleMissions`; the grade, the proposal and the vote answer `xp`, the progress read answers `livello`, `missioni` and `crediti`. Nothing in the delegated table, no MCP tool, nothing sent to MERL-T. The web part (G1c) is the web side's, and starts from the contract below.

**Tech Stack:** Express 4, Prisma 5 (migration by hand), Zod 3, Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-20-gymnasium-xp-levels-design.md`, cited «spec §5.1». Decisions it rests on: G-303, G-253, G-314…G-318, L-27 and its five choices, G-331 (this round).

## Global Constraints

- **Git flow.** This plan on `docs/plan-xp-livelli` (docs only). The server on `feat/gymnasium-xp-server`, off `origin/develop` (rebased on the plan's branch while the plan is not merged). Pull requests into `develop`. Under the owners' authorization (G-331) the session may commit and push its own branches and never merges; every subagent dispatch that commits says so.
- **The migration** is `20261026100000_lingo_xp_ledger`, reserved by the orchestrator. Written by hand (`prisma migrate diff` from a copy of the old schema saved in the scratch directory), applied with `migrate deploy` on the session's own test database only. Never `migrate dev`, never `reset` by hand, never `prisma format`. The orchestrator applies it to the development database after the merge.
- **Server tests** run only through `npm --prefix apps/server test`, against the session's own throwaway database (a Homebrew PostgreSQL in the scratch directory on a free port, not 5436, started with `-k ''`; the wrapper rewrites host, port and database name of `DATABASE_URL` without printing it). Never read or print a `.env` file. Stop and delete the throwaway database at the end. Say in the PR which PostgreSQL version ran (Homebrew has 14 and 17, the stack 16).
- **Machine load:** `uptime` before a full suite; one suite at a time, nothing left in the background.
- **Files outside the Studia area** (tell the orchestrator before editing): `apps/server/prisma/schema.prisma` and the migration, `apps/server/src/controllers/authController.ts` (export), `apps/server/CLAUDE.md`, and the progress spec (`docs/superpowers/specs/2026-10-13-studia-progress-design.md`, one sentence, spec §5.2). Nothing on the web.
- **Public repository:** no vault text, no personal paths, no hosts; decisions by code only.
- **Anything the spec leaves open that changes what gets built:** stop and ask the orchestrator; do not choose for the owners.
- **Errors you surface in files you touch are fixed**, pre-existing ones too.
- **Before calling the PR done:** `npm --prefix apps/server run build` and the full `npm --prefix apps/server test` green; one fresh `code-reviewer` over the branch against the spec and this plan, with a security eye on forging XP and on export and deletion; every finding fixed.

## The API contract for the web (G1c, the web side)

Fixed here so the web can start before the server is merged. Additive: every field the web reads today stays as it is. All routes are the user's session only; an exchanged token gets 403 as today.

```ts
/** One shape for the level, everywhere. */
export interface XpLivello {
  livello: number;        // ≥ 1, no ceiling
  totale: number;         // the sum of every credit
  nelLivello: number;     // points earned inside the current level
  perIlProssimo: number;  // what the next level costs in all: 100 + 25·(livello − 1)
  oggi: number;           // points credited on today's Rome day
}

export type MissioneId = 'dovute' | 'nuove' | 'obiettivo' | 'materia-ferma' | 'scrivi' | 'convalida' | 'caso' | 'settimana' | 'consolida';

/** A credit just written. */
export interface XpCredito { missione: MissioneId; punti: number }

/** What an event answers when it succeeded. `crediti` may be empty. */
export interface XpEsito { crediti: XpCredito[]; livello: XpLivello; nuovoLivello: boolean }

export interface MissioneServer {
  id: MissioneId;
  gruppo: 'giornaliera' | 'settimanale' | 'lungo';
  principale: boolean;                                  // true for dovute, nuove, obiettivo: «Le missioni di oggi»
  punti: number;                                        // its value today
  stato: 'fatta' | 'aperta' | 'vuota' | 'in-arrivo';    // fatta ⇔ a credit exists for its period
  progresso?: { fatte: number; di: number };            // absent for scrivi, caso, and a vuota with nothing to count
  motivo?: 'quota';                                     // only on nuove, not fatta: the daily quota of new cards stops it
  materia?: Materia;                                    // only on materia-ferma, when a subject qualifies
}
```

| Route | What it gains |
| --- | --- |
| `GET /api/lingo/srs/progressi[?materia=]` | `livello: XpLivello`, `missioni: MissioneServer[]`, `crediti: XpCredito[]` (the credits this read wrote, usually `[]`). Never narrowed by `materia`. |
| `POST /api/lingo/srs/revisioni` | `xp: XpEsito` next to `oggi`, only when `registrata: true`. |
| `POST /api/lingo/cards/:id/proponi` | the serialized card gains `xp: XpEsito` as one more top-level key. The 409 with `richiedeTesto` carries none. |
| `POST /api/lingo/validazione/:cardId` | the answer becomes `{ stato, xp: XpEsito }`. |
| `GET /api/lingo/srs/sessione` | nothing new in the answer (spec §5.3). It may write a credit (`obiettivo`, `settimana` on a day that counts by the empty queue); the web sees it as `fatta` and in `livello` at its next progress read, not as «+XP». |

- `missioni` is in catalogue order: `dovute, nuove, obiettivo, materia-ferma, scrivi, convalida, caso, settimana, consolida`. `convalida` is present only for a validator. `caso` is always `in-arrivo`, worth 40, never credited.
- Values: `dovute` 20, `nuove` 15, `obiettivo` 10, `materia-ferma` 15, `scrivi` 25, `convalida` 20, `caso` 40, `settimana` 50, `consolida` 100.
- Progress mapping to the web's `Mission.progress`: `fatte` → `done`, `di` → `of`. The web keeps the Italian titles; `scrivi` is now «Proponi una scheda» (G-314). `motivo: 'quota'` is the line under «Impara 5 schede nuove» telling the user to raise the new cards a day.
- `nuovoLivello` is true only on the event whose credits crossed a level; the web celebrates a level once (remembering the last one celebrated, per browser).
- `stato: 'vuota'` missions are not counted in «2 di 3», as in G1b.
- A `vuota` mission with something already counted keeps its `progresso`: «convalida» with one vote cast and nothing left to vote on is `vuota` with «1 of 2»; with no vote cast it has no `progresso`.
- The web no longer computes the missions (`missions/missions.ts` takes `progressi.missioni`), and G1b's rule that lowers «Impara 5» to the daily quota goes (L-27 choice 5).

## Review Focus

Failure modes the spec implies that only a dedicated test catches. Each is pinned in its task.

1. **Forging.** No route takes a mission, a point or a day from the client; an exchanged token reaches no route that settles; `POST /api/lingo/cards` (delegated) writes no credit. **Task 10.**
2. **Once per period under concurrency.** Two grades or two votes at once credit exactly once — and, for `convalida`, at least once (without the XP lock each would see one vote). **Tasks 4, 8.**
3. **XP never fails the event.** A forced error or a lock wait inside the settle leaves the grade, proposal and vote stored and answers empty `crediti`. **Task 4.**
4. **Deadlock with account deletion.** The reads take the user row in key share before anything else. **Task 9.**
5. **The vote rule never reads XP (G-253, G-318).** **Task 8.**
6. **Rome days and weeks.** Credits at 23:59 and 00:01 Rome, across both daylight-saving nights, the Monday of a week. **Tasks 2, 5.**

---

## Task 1: The ledger and the vote counter (migration)

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20261026100000_lingo_xp_ledger/migration.sql`
- Test: `apps/server/tests/lingoXp.migration.test.ts`

- [ ] **Step 1:** Copy `schema.prisma` to the scratch directory. Add, after `LingoGiornataStudio`:

```prisma
// Gymnasium's experience points (spec 2026-10-20-gymnasium-xp-levels §5.2): one row per mission credited per
// period, append-only (only an account deletion's cascade removes rows). `punti` is the value at the time.
// The CHECKs on `punti`, on the shape of `periodo` and on the event's id are in the migration, not here.
enum LingoMissione {
  DOVUTE
  NUOVE
  OBIETTIVO
  MATERIA_FERMA
  SCRIVI
  CONVALIDA
  SETTIMANA
  CONSOLIDA
}

enum LingoFonteXp {
  REVISIONE
  PROPOSTA
  VOTO
  LETTURA
}

model LingoCreditoXp {
  id        String        @id @default(uuid())
  utenteId  String        @map("utente_id")
  missione  LingoMissione
  periodo   String        // G:YYYY-MM-DD (a day), S:YYYY-MM-DD (the Monday of a week), U (once)
  giorno    DateTime      @db.Date
  punti     Int
  fonte     LingoFonteXp
  fonteId   String?       @map("fonte_id") // the review log row, the card, the vote; no foreign key
  materia   LingoMateria?
  createdAt DateTime      @default(now()) @map("created_at")

  utente User @relation(fields: [utenteId], references: [id], onDelete: Cascade)

  @@unique([utenteId, missione, periodo])
  @@unique([missione, fonteId])
  @@index([utenteId, giorno])
  @@map("lingo_crediti_xp")
}
```

`voti Int @default(0)` on `LingoGiornataStudio` (comment: validation votes cast that day, written only by the vote route), and `lingoCreditiXp LingoCreditoXp[]` on `User`. No `prisma format`.

- [ ] **Step 2:** `npx prisma migrate diff --from-schema-datamodel <copy> --to-schema-datamodel prisma/schema.prisma --script` into the migration file, a header comment (spec, no backfill: G-317), and by hand inside `CREATE TABLE`:

```sql
    CONSTRAINT "lingo_crediti_xp_punti_check" CHECK ("punti" BETWEEN 1 AND 1000),
    CONSTRAINT "lingo_crediti_xp_periodo_check" CHECK (
        ("missione" = 'SETTIMANA' AND "periodo" ~ '^S:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        OR ("missione" = 'CONSOLIDA' AND "periodo" = 'U')
        OR ("missione" NOT IN ('SETTIMANA', 'CONSOLIDA') AND "periodo" ~ '^G:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    ),
    CONSTRAINT "lingo_crediti_xp_fonte_check" CHECK (("fonte" = 'LETTURA') = ("fonte_id" IS NULL))
```

(The mission-to-period rule keeps a later daily mission — `caso`, added with `ALTER TYPE … ADD VALUE` — on `G:` without touching the check.)

- [ ] **Step 3:** Write the test first: the column `voti` defaults to 0 on an existing day row; a second credit with the same `(utente, missione, periodo)` is refused (P2002 / unique violation); a second `SCRIVI` with the same `fonte_id` on another day is refused; two `LETTURA` credits of different missions with null `fonte_id` are accepted; `punti` 0 and 1001 refused; `periodo` `S:…` on a daily mission, `G:…` on `SETTIMANA`, `X` refused; `LETTURA` with a `fonte_id` refused; deleting the user removes the credits (cascade). Run it red (table missing), apply with `npx prisma migrate deploy` on the test database, `npx prisma generate`, `npx prisma migrate status`, run it green.
- [ ] **Step 4:** Drift check by hand: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <a second throwaway database> --exit-code` answers no difference. Commit.

## Task 2: The level and the periods (pure)

**Files:**
- Create: `apps/server/src/lingo/levels.ts`
- Modify: `apps/server/src/lingo/studyDay.ts` (`mondayOf`)
- Test: `apps/server/tests/unit/lingo/levels.test.ts`, `apps/server/tests/unit/lingo/studyDay.test.ts` (extend, or create if absent)

- [ ] **Step 1 (tests first):** `totalFor(L)` = `100·(L − 1) + 12.5·(L − 1)·(L − 2)`: 1 → 0, 2 → 100, 3 → 225, 5 → 550, 10 → 1800, 20 → 6175, 50 → 34300. `levelOf(t)`: 0 → `{1, 0, 100}`; 99 → `{1, 99, 100}`; 100 → `{2, 0, 125}`; 412 → `{4, 37, 175}`; 1799 → `{9, 299, 300}`; 1800 → `{10, 0, 325}`; 10,000,000 → integers, `totalFor(livello) ≤ t < totalFor(livello + 1)`. A negative, fractional or non-finite total is a `RangeError`. `mondayOf('2026-10-20')` (a Tuesday) → `'2026-10-19'`; a Monday → itself; a Sunday → six days before; across a year's end.
- [ ] **Step 2:** Implement. `levelOf` is an integer loop (`cost = 100 + 25·(n − 1)`, subtract while `rest ≥ cost`), no floating point; `totalFor` uses integers too (`(L − 1)·(L − 2)` is even, so `25·(L − 1)·(L − 2)/2` is exact). Export `LEVEL_BASE = 100`, `LEVEL_STEP = 25`. A header says: the level is never stored; after 1.10 ships the curve may only become gentler (L-27 choice 2). `mondayOf` lives with the other day arithmetic in `studyDay.ts` (`dayToDate(day).getUTCDay()`, as `calendarStart` already does).
- [ ] **Step 3:** Green; commit.

## Task 3: The catalogue and the ledger primitives

**Files:**
- Create: `apps/server/src/lingo/missions.ts` (catalogue and types; the rest arrives in Tasks 4–7)
- Create: `apps/server/src/lingo/xpLedger.ts`
- Test: `apps/server/tests/unit/lingo/missionsCatalogue.test.ts`, `apps/server/tests/lingoXpLedger.test.ts`

- [ ] **Step 1 (tests first):**
  - the catalogue has the nine ids in the contract's order, with the contract's group, `principale` and value; every id but `caso` maps to a `LingoMissione` value (`'materia-ferma'` ↔ `MATERIA_FERMA`) and every enum value is in the catalogue;
  - the daily maximum — the sum of every daily mission that can be credited (not `caso`), plus the weekly, plus the long-run — is 255, and `< XP_DAILY_CEILING` (300);
  - `periodOf(mission, today)` gives `G:<today>`, `S:<mondayOf(today)>`, `U`;
  - `xpLedger`: `levelNow(db, userId, today)` answers the `XpLivello` of the credits (total, today's `oggi` by `giorno`); `creditsFor(db, userId, today)` returns the set of missions credited for their current period.
- [ ] **Step 2:** Implement. `MISSIONS` is one `as const` array of `{ id, enumValue | null, gruppo, principale, punti, eventi: XpEvent['tipo'][] }` — `eventi` is the spec's table of §5.1 (`scrivi` only `proposta`; `convalida` `voto` and `lettura`; the review missions `revisione` and `lettura`; `caso` none). Constants: `XP_DAILY_CEILING = 300`, `XP_GOAL_FLOOR = 10`, `NEW_CARDS_TARGET = 5`, `STALE_SUBJECT_DAYS = 7`, `STALE_SUBJECT_REVIEWS = 5`, `VOTES_TARGET = 2`, `STREAK_WEEK = 7`, `CONSOLIDATED_TARGET = 50` (with `CONSOLIDATED_DAYS` imported from `cardMaturity.ts`, not repeated). Header: ids are the web's, Italian titles stay in the web, every value to be reviewed after a month of use (L-27 choice 1).
  - `xpLedger.ts`: `insertCredit(tx, row)` — raw `INSERT INTO lingo_crediti_xp (id, …) VALUES (gen_random_uuid()::text, …) ON CONFLICT DO NOTHING RETURNING missione, punti` (no conflict target: either unique key makes it a no-op); `todayTotal`, `levelNow`, `creditsFor`. A `DATE` travels through `dayToDate` / `dateToDay`.
- [ ] **Step 3:** Green; commit.

## Task 4: `settleMissions` — savepoint, lock, ceiling (with the review missions' skeleton)

**Files:**
- Modify: `apps/server/src/lingo/missions.ts`
- Test: `apps/server/tests/lingoXpSettle.test.ts`

The function, inside the caller's interactive transaction (spec §5.1 «What it does»):

```ts
export type XpEvent =
  | { tipo: 'revisione'; logId: string; cardId: string; materia: LingoMateria; isNew: boolean; intervallo: number }
  | { tipo: 'proposta'; cardId: string; materia: LingoMateria }
  | { tipo: 'voto'; votoId: string }
  | { tipo: 'lettura' };

export async function settleMissions(tx: Prisma.TransactionClient, userId: string, today: string, event: XpEvent): Promise<XpEsito>
```

1. `SAVEPOINT xp`; `SET LOCAL lock_timeout = '1s'`.
2. `SELECT pg_advisory_xact_lock(${LINGO_XP_LOCK_CLASS}::int, hashtext(${userId}))` — the two-key form; `LINGO_XP_LOCK_CLASS` an exported int4 constant.
3. Level before; `creditsFor`; the missions this event evaluates (catalogue `eventi`) minus those credited.
4. Evaluate each from stored facts (`evaluate(mission, ctx)`, Tasks 5–7; this task wires `obiettivo` only, enough to test the mechanics), each answering `{ fulfilled, progresso?, motivo?, materia? }`.
5. For each fulfilled one, in catalogue order: if `todayTotal + punti > XP_DAILY_CEILING`, skip and `console.warn` (user id hashed or omitted: no personal data in logs beyond what the server already logs); else `insertCredit` with `fonte`/`fonte_id` (`REVISIONE`/logId, `PROPOSTA`/cardId, `VOTO`/votoId, `LETTURA`/null) and `materia` (the card's for `scrivi`, the chosen subject for `materia-ferma`, else null).
6. `RELEASE SAVEPOINT xp`; `SET LOCAL lock_timeout TO DEFAULT`; level after; answer `{ crediti, livello, nuovoLivello: after.livello > before.livello }`.
7. On any throw: `ROLLBACK TO SAVEPOINT xp` (which also undoes the `SET LOCAL`), `console.error` with the event's kind (never the error's parameters, which may hold ids), and answer `{ crediti: [], livello: await levelNow(...), nuovoLivello: false }`. After the rollback to the savepoint the transaction is usable again, so that read is an ordinary query: if it throws, it propagates like any other query of the caller (the transaction itself is broken).

- [ ] **Step 1 (tests first, through the grade route wired in Task 5 or a direct call in a `prisma.$transaction` of the helper client):**
  - a fulfilled `obiettivo` writes one credit and answers it; a second call in another transaction writes nothing and answers `[]`;
  - **two concurrent settles** (two transactions started together, both on a fulfilled day) write exactly one credit;
  - **forced error:** `ALTER TABLE lingo_crediti_xp ADD CONSTRAINT xp_test_block CHECK (false) NOT VALID` in the test (dropped in `finally`): the settle answers `crediti: []`, the caller's own write in the same transaction (a marker row) commits;
  - **lock wait:** the test holds `pg_advisory_xact_lock(class, hashtext(user))` in an open transaction of its own; a settle in another answers `[]` after about a second, and its caller's write commits; released, the next settle credits it;
  - **ceiling:** with credits of the day already at 290 (inserted by hand), a fulfilled 20-point mission is not written; at 280 it is;
  - `nuovoLivello` true exactly when the total crosses 100 (credits at 90 by hand, then a 10-point credit), false on the next.
- [ ] **Step 2:** Implement; green; commit.

## Task 5: The review missions and the grade

**Files:**
- Modify: `apps/server/src/lingo/missions.ts`, `apps/server/src/routes/lingoSrs.ts` (`POST /revisioni`)
- Test: `apps/server/tests/lingoXp.review.test.ts`

The facts, read inside the transaction, once per settle (`MissionContext`, built lazily: a mission not evaluated reads nothing): preferences; today's stored day (`ripassi`, `nuove`, `valido`, `voti`); `due` = `count(dueWhere(user, reviewScope(user, materieComunita), today))`; `newLeft` = `count(newCardsWhere(…))` (ignoring the quota); `introduced` = `introducedToday`; for the streak `countedDays` + `computeStreak(…, today, day.valido)`.

- `dovute`: `fatte = ripassi_dovuti` (G-334: today's grades of a card due before tomorrow, counted by `recordGradeDay` from the state the grade read, in the same migration); fulfilled `fatte ≥ 1 && due = 0`; progress `fatte` of `fatte + due`; `vuota` when both 0.
- `nuove`: `target = min(5, nuove + newLeft)`; `vuota` when 0; fulfilled `nuove ≥ target`; `motivo: 'quota'` when `nuoveAlGiorno − nuove < target − nuove` (and not fulfilled).
- `obiettivo`: `target = max(ripassiAlGiorno, 10)`; fulfilled `valido && (ripassi ≥ target || (ripassi ≥ 1 && due = 0 && newLeft = 0))`; progress `min(ripassi, target)` of `target`.
- `materia-ferma`: on a grade, only the graded card's subject, only when today's recorded reviews in it reach 5: qualifies when `MAX(data_revisione)` of the user's log in that subject **before 00:00 Rome today** is on `today − 7` or earlier (Rome day in SQL: `(data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome'`; the bound as `romeDayStartSql`); a subject never reviewed before today does not qualify. Credited with `materia`. (The read's choice of subject is Task 9.)
- `settimana`: `valido` today and `attuale` a positive multiple of 7; period `S:<mondayOf(today)>`; progress `attuale mod 7` of 7.
- `consolida`: only when `intervallo ≥ 21` on a grade (always on a read): cards in the whole review scope whose review state has `maturity(...) === 'consolidate'` ≥ 50; progress `min(n, 50)` of 50.

Grade route: keep the id of the created log row (`const log = await tx.lingoRevisioneSRS.create(...)`); after `recordGradeDay`, `const xp = await settleMissions(tx, userId, today, { tipo: 'revisione', logId: log.id, cardId, materia: <the card's>, isNew: !previous, intervallo: result.scheduledDays })` (the card's subject read with the scope check, `select: { id: true, materia: true }`); answer `xp` next to `oggi`; `registrata: false` returns before and carries no `xp`.

- [ ] **Step 1 (tests first):** each mission at its threshold and one short (`dovute` with one due left; `nuove` at 4 and 5; `nuove` with 3 new cards left in scope credited at 3; `obiettivo` at 9 and 10 with N = 10; N = 1 and quota 1 with plenty of cards: two reviews earn neither `nuove` nor `obiettivo`, the streak still counts); `motivo: 'quota'` (Task 9 reads it; here the evaluation's value); `materia-ferma` with the last review on today − 7 (qualifies) and today − 6 (does not), never reviewed (does not), the fifth review of the day credits, the fourth does not; `settimana` at 7 and 14, not at 8, with a rest day inside the run, the period the Monday across a Sunday→Monday boundary, a week with no multiple of 7 credits nothing; `consolida` at 49 and 50; a grade not recorded settles nothing (`xp` absent, no row); each credit's `fonte = REVISIONE`, `fonte_id` = the log row's id; **two concurrent grades of two cards** that both complete `obiettivo` credit it once; **Rome days**: grades at 23:59 and 00:01 Rome on 2026-03-28/29 and 2026-10-24/25 land on the right `giorno` and `periodo` (fake `Date`, as `lingoProgress.routes.test.ts`).
- [ ] **Step 2:** Implement; green (with `lingoSrs.routes.test.ts` and `lingoProgress.routes.test.ts` still green); commit.

## Task 6: Proposing a card (`scrivi`)

**Files:**
- Modify: `apps/server/src/lingo/missions.ts`, `apps/server/src/routes/lingoCards.ts` (`POST /:id/proponi`)
- Test: `apps/server/tests/lingoXp.proposal.test.ts`

`scrivi` is fulfilled by the `proposta` event alone (never by a read: a proposal leaves no dated row), period the day, `fonte = PROPOSTA`, `fonte_id` = the card's id, `materia` = the card's. Proposal route: after the update to `PROPOSTA_COMMUNITY`, `settleMissions(tx, userId, today, { tipo: 'proposta', cardId, materia: card.materia })`; answer `{ ...serialize(card), xp }`. The 409 `richiedeTesto` returns before and settles nothing.

- [ ] **Step 1 (tests first):** a proposal credits 25 once; a second card the same day credits nothing (the period); withdrawn and proposed again — the same day, and the next day (fake `Date`) — credits nothing (the `(missione, fonte_id)` key, so a once-in-a-life rule for the card); a second card the next day credits; the 409 path writes nothing; a proposal never credits `dovute` (a day otherwise fulfilling it stays uncredited until a grade or a read); the archive of the card by validators leaves the credit.
- [ ] **Step 2:** Implement; green with `lingoValidation.routes.test.ts`; commit.

## Task 7: Votes (`convalida`) and the `voti` counter

**Files:**
- Modify: `apps/server/src/lingo/studyDays.ts` (`countVoteDay`, header), `apps/server/src/lingo/missions.ts`, `apps/server/src/routes/lingoValidazione.ts`
- Test: `apps/server/tests/lingoXp.vote.test.ts`

- `countVoteDay(tx, userId, today)`: the same `INSERT … ON CONFLICT DO NOTHING` as `recordGradeDay`, then `UPDATE … SET voti = voti + 1 … RETURNING voti` (the update locks the row). The header of `studyDays.ts` changes: «a recorded grade, a finished queue and a vote write these rows; nothing else does».
- `convalida`: fulfilled when today's `voti ≥ 2`; progress `min(voti, 2)` of 2; evaluated on `voto` and `lettura`; listed only to validators (Task 9); `vuota` when `voti < 2` and the validation queue holds no card the user can vote on (the queue's `where` of `GET /coda`, moved into a shared `votableWhere(userId)` in the route module or `lingo/`, used by both).
- Vote route order (spec §5.1 lock order): voter check → card `FOR UPDATE` → duplicate check → vote row created (keep its id) → `countVoteDay` → `settleMissions(tx, me, today, { tipo: 'voto', votoId })` → votes read → `stateAfterVotes` → delete or update the card. Answer `{ stato, xp }`.

- [ ] **Step 1 (tests first):** one vote credits nothing, the second credits 20 with `fonte = VOTO`, `fonte_id` = the second vote's id; a third credits nothing; approval and «errata» count alike; **two concurrent votes on two different cards** (the validator's first two) credit exactly once; a withdrawal of the first card's proposal after the first vote, then a second vote elsewhere, credits (the counter is never decreased); the vote that archives an authorless card (deleted with its votes) still counts toward the two; a vote refused (own card, second vote, card no longer proposed) adds nothing to `voti`; a non-validator's 403 adds nothing.
- [ ] **Step 2:** Implement; green with `lingoValidation.routes.test.ts`, `lingoSoglie.routes.test.ts`; commit.

## Task 8: The vote rule stays blind to XP (G-253, G-318)

**Files:**
- Test: `apps/server/tests/unit/lingo/validationRuleIsolation.test.ts`, extend `apps/server/tests/lingoXp.vote.test.ts`

- [ ] **Step 1:** A test reads `src/lingo/validationRule.ts` and `src/lingo/validationSettings.ts` as text and fails if either imports `./missions`, `./levels` or `./xpLedger`.
- [ ] **Step 2:** Same-outcome check: two validators, one with 0 XP and one with 5,000 (credits inserted by hand), each casting the same verdicts on twin cards under the same thresholds: the two cards end in the same state.
- [ ] **Step 3:** Green; commit.

## Task 9: The reads — progress and session

**Files:**
- Modify: `apps/server/src/lingo/progress.ts`, `apps/server/src/lingo/missions.ts` (`readMissions`, the read's `materia-ferma`), `apps/server/src/routes/lingoSrs.ts` (`GET /sessione`)
- Test: `apps/server/tests/lingoXp.reads.test.ts`, extend `apps/server/tests/lingoProgress.routes.test.ts`

- **`readProgress`:** first `prisma.$transaction(async (tx) => { ... })`: `SELECT 1 FROM users WHERE id = $1 FOR KEY SHARE` (no row: skip the rest of the transaction); `finished = queueFinished(tx, …)`; if finished, `markQueueFinished(tx, …)`; `crediti = (await settleMissions(tx, userId, today, { tipo: 'lettura' })).crediti`. Then the read as today (`finishedNow` from the transaction), plus `livello = levelNow(prisma, …)` and `missioni = readMissions(prisma, userId, today, isValidator)` — both after the commit, from what is stored. Answer `{ ...today's fields, livello, missioni, crediti }`.
- **`readMissions`:** the catalogue in order; `convalida` only when `User.lingoValidatore`; `caso` `in-arrivo` with `punti` 40 and no `progresso`; every other: `fatta` when a credit exists for its period (with `progresso` at its full `di` when it has one: «7 of 7», «5 of 5»), else the evaluation's `aperta`/`vuota`, `progresso`, `motivo` (only `nuove`, not `fatta`), `materia` (only `materia-ferma`). `scrivi` is `aperta` unless credited today, never `vuota`, no `progresso`.
- **The read's `materia-ferma`:** among the subjects that qualify (last review before today on today − 7 or earlier): the one with the most reviews today; failing that, the one with the oldest last review among those where `reviews today + due today + new cards left today (with the quota)` ≥ 5; `vuota` when none. One `MAX(data_revisione)` per subject over the log joined to the cards; reviews moved out by the trash are not seen.
- **The calendar** leaves out a stored row with `ripassi = 0` that did not count (today's `valido` read as `raggiunto`, past days as stored), in the whole-day branch and the branch narrowed by subject: a row created only by a vote is not a study day. Correct the progress spec's §5.1 list of who writes a day row (one sentence: «and the vote route, for `voti`»).
- **`GET /sessione`:** in the existing branch (`!materia && dovute === 0 && newCards.length === 0 && queueFinished`), one `prisma.$transaction`: users `FOR KEY SHARE`, `queueFinished(tx)` again (it may have changed), `markQueueFinished(tx)`, `settleMissions(tx, …, { tipo: 'lettura' })`. The answer does not change.

- [ ] **Step 1 (tests first):**
  - the shape: `livello`, `missioni` (order, values, groups, `principale`) and `crediti` present; `convalida` absent for a non-validator and present for a validator; `caso` `in-arrivo`;
  - `?materia=DIRITTO_PENALE` answers the same `missioni`, `livello` and `crediti` as the whole read;
  - **a mission fulfilled without a grade:** all due cards reviewed except the community ones of one subject, which the user then switches off → the next progress read credits `dovute` once, `crediti` lists it, the following read lists `[]` and `dovute` is `fatta` (the accepted hole of spec §3.3, bounded to once a day);
  - **the empty-queue day seen by the session read:** a user with fewer reviews than N finishes the queue; `GET /sessione` credits `obiettivo`; no progress read is needed; the next progress read shows `fatta` and `crediti: []`;
  - `fatta` ⇔ a credit exists, for every mission (credits inserted by hand turn the matching missions `fatta`);
  - `motivo: 'quota'` with quota 1 and plenty of new cards; absent once `nuove` is `fatta`;
  - the read's `materia-ferma` stays on the subject being studied as its reviews accumulate (two qualifying subjects; three reviews today in the second; the read names the second);
  - the calendar leaves out a day row created only by a vote; still shows a day with reviews and an empty-queue day;
  - **deletion while reading:** a progress read and `deleteUserAccount` of the same user started together both finish (no deadlock error); the credits are gone after.
- [ ] **Step 2:** Implement; green with `lingoProgress.routes.test.ts`, `lingoSrs.routes.test.ts`, `lingoPercorso.routes.test.ts`; commit.

## Task 10: Forgery and delegation

**Files:**
- Test: `apps/server/tests/lingoXp.security.test.ts`

- [ ] **Step 1:** A grade body with extra keys (`punti`, `missione`, `giorno`) is a 400 (the schema is strict) and writes nothing; the vote and proposal bodies with the same extra keys are 400 too (both schemas are already `.strict()`: the test pins it); an exchanged token: `POST /api/lingo/cards` creates a draft and writes no credit; `GET /progressi`, `POST /revisioni`, `POST /cards/:id/proponi`, `POST /validazione/:id` answer 403; a test greps `src/` and fails when `settleMissions` is imported anywhere but `routes/lingoSrs.ts`, `routes/lingoCards.ts`, `routes/lingoValidazione.ts` and `lingo/progress.ts`, and checks that `oauth/delegatedRoutes.ts` lists none of the settling paths (`/lingo/srs/`, `/lingo/cards/:id/proponi`, `/lingo/validazione/`). The client's clock never enters: the credit's `giorno` follows the server's (fake) `Date`.
- [ ] **Step 2:** Green; commit.

## Task 11: Export, deletion, trash

**Files:**
- Modify: `apps/server/src/controllers/authController.ts`
- Test: extend `apps/server/tests/accountData.test.ts`, `apps/server/tests/accountExport.otherUser.test.ts`, `apps/server/tests/lingoAccountErasure.test.ts`, `apps/server/tests/trash.test.ts`

- [ ] **Step 1 (tests first):** `data.lingoCreditiXp` is `[]` for a new user; with credits it lists `{ missione, periodo, giorno: 'YYYY-MM-DD', punti, fonte, materia }` in `(giorno, createdAt)` order — no `id`, no `fonteId`, no `utenteId` (spec §8); `data.lingoGiornate` rows carry `voti`; in the other-user test the second user also votes on the first one's card and earns `convalida`, and the first one's export holds nothing of theirs; `deleteUserAccount` removes the credits (and nobody else's); a studied card trashed and restored leaves every credit as it was.
- [ ] **Step 2:** Add the query and the key to the export (`giorno` through `dateToDay`, as `lingoGiornate`); add `voti` to `lingoGiornate`'s `select`. `deleteUserAccount` needs no change (the cascade). Green; commit.

## Task 12: Documentation, full suite, review, PR

**Files:**
- Modify: `apps/server/CLAUDE.md` (a «Gymnasium XP» entry next to «The streak and the progress dashboard»: the ledger, append-only, the unique keys, `settleMissions` the one writer, its callers and the rule that it is never called from a delegated route, the savepoint and the lock order, the level computed never stored, the export key; fix «`lingo/studyDays.ts` writes it and nothing else does» for `voti`; the grade's, proposal's, vote's and progress read's answers)

- [ ] **Step 1:** Docs.
- [ ] **Step 2:** `uptime`; `npm --prefix apps/server run build`; the full `npm --prefix apps/server test` on the throwaway database; fix anything red, pre-existing included.
- [ ] **Step 3:** A fresh `code-reviewer` over `origin/develop...HEAD` against the spec and this plan, with the security brief: forging XP (client inputs, delegated reach, concurrency, the ceiling), the savepoint (can an XP failure leave the outer transaction aborted?), lock order and deadlocks, export and deletion (G-306: nothing of another person). Fix every finding; rerun the suites.
- [ ] **Step 4:** Push `feat/gymnasium-xp-server`; open the PR into `develop` (not merged): what it does, «carries migration `20261026100000_lingo_xp_ledger`, to apply with `migrate deploy` after the merge», the PostgreSQL version the suite ran on, the contract section of this plan as the web's starting point. Mark the task for review and tell the orchestrator. Stop and delete the throwaway database; remove the worktrees.
