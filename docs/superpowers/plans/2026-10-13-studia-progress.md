# VisuaLex Studia: the streak and the progress dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the review a streak (days on which the user did N reviews or finished the day's queue, one rest day in seven) and turn Studia's home into a progress dashboard in direction D, «Registro vivo»: today's goal as a ring, the streak, the cards by state, progress by subject, an activity calendar and the coming days, with a celebration when the goal closes.

**Architecture:** Two pull requests. **PR 1 (server)** stores one row per user and Rome day (`LingoGiornataStudio`, migration `20261022100000_lingo_study_days`), written in the grade's transaction; a pure module (`lingo/streak.ts`) is the one definition of the streak; one read (`GET /api/lingo/srs/progressi`) answers everything the dashboard draws; the grade's answer says when the goal has just closed. **PR 2 (web)** draws the dashboard in `components/features/studia/progress/` with hand-drawn SVG and CSS motion, replaces `ReviewHome`'s counts and `<select>` with it, and adds the celebration to the session. No new dependency, nothing in `useAppStore`, nothing in the delegated table.

**Tech Stack:** Express 4, Prisma 5 (migration by hand), Zod 3, Vitest + supertest on the server; React 19, react-router 7, Tailwind v4, Vitest + Testing Library on the web.

**Spec:** `docs/superpowers/specs/2026-10-13-studia-progress-design.md`, cited «spec D7» (decision 7 of §3) or «spec §5.1».

## Global Constraints

- **Git flow.** PR 1 on `feat/studia-progress` (this worktree, off `origin/develop`), with the spec and this plan. PR 2 on `feat/studia-progress-web`, branched from PR 1's head and retargeted to `develop` once PR 1 is merged. Each goes into `develop` with a merge commit `merge: <branch> — <what changes>` at green CI. The orchestrator's brief, for the owner: «PRs: into `develop`; merge commit `merge: <branch> — <what changes>` at green CI. `main`, tags and releases are Guglielmo's. Never merge while a question to Guglielmo about that PR is open.» Quote it in every subagent dispatch that commits.
- **The open question, answered.** Spec D13 (storing the days) waited for the owner's answer to question 182; on 14 October: «ok vai con le raccomandate». PR 2 builds on PR 1.
- **The migration** is `20261022100000_lingo_study_days`, assigned by the orchestrator. Written by hand (`prisma migrate diff` from a copy of the old schema saved in the scratch directory), applied with `migrate deploy` to this session's test database only, never `migrate dev`, `reset` by hand or `prisma format`. The orchestrator applies it to the development database after the merge.
- **Server tests** run against this session's own database, `visualex_test_studia_progressi`, in the development Postgres: inside the `dotenv -e .env.test` wrapper only the database name of `DATABASE_URL` is rewritten, by a shell substitution that never prints the URL. Never read or print a `.env` file. Drop the database at the end of the round.
- **Machine load:** `uptime` before a suite; above about 10, no full suite. One suite at a time, nothing left in the background.
- **Files outside the Studia area** (tell the orchestrator before editing): `apps/server/prisma/schema.prisma` and the migration, `apps/server/src/controllers/authController.ts` (export), `apps/server/CLAUDE.md`, `apps/web/CLAUDE.md`. Nothing else outside `components/features/studia/`, `services/studiaService.ts`, `types/studia.ts` and the server's lingo routes and modules.
- **The review card's visual rule** (Studia spec §6) is not touched; nothing runs between a grade and the next card.
- **Copy:** Italian in the UI, sentence case, «scheda/schede», «ripasso/ripassi», never «card» or «streak»; code, comments, commits and docs in English.
- **Errors you surface in files you touch are fixed**, pre-existing ones too.
- **Before calling a PR done:** the suites of the areas touched green (`npm --prefix apps/server test`, `npm --prefix apps/server run build`; `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`), one fresh `code-reviewer` over the branch against the spec and this plan, every finding fixed; for PR 2 the browser pass of Task 11.

## Review Focus

Failure modes the spec implies that no other task's tests would catch. Each is pinned in its task.

1. **Postgres and the Rome day.** The review columns are `TIMESTAMP(3)` without a zone holding UTC. `data_revisione AT TIME ZONE 'Europe/Rome'` on such a column reads it *as Rome time* and is wrong by one or two hours; the right expression is `(data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome'`. Pinned against `romeDay` at 23:30 UTC in summer and winter and across both daylight-saving nights, in **Task 1** (the backfill) and **Task 4** (the route).
2. **Two grades of one user racing on the day's first row.** Both try to create today's row: one must not fail with a unique violation, and both must count. Pinned in **Task 3**.
3. **The streak's edges.** Today still open never breaks it; two missed days in a row break it; a second missed day six days after a rest breaks it, seven days after is a new rest; a rest day before the first counted day is not a rest. Pinned in **Task 2**.
4. **A deleted card does not rewrite the past.** Trashing a studied draft and restoring it leaves every stored day as it was. Pinned in **Task 5**.
5. **The celebration does not cost the review a key.** While it plays, space and 1–4 still act on the card. Pinned in **Task 10**.

---

## PR 1 — Server (`feat/studia-progress`)

### Task 1: The stored days and the review goal (migration)

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (`LingoPreferenzeStudio`, new `LingoGiornataStudio`, `User` relation)
- Create: `apps/server/prisma/migrations/20261022100000_lingo_study_days/migration.sql`
- Test: `apps/server/tests/lingoStudyDays.migration.test.ts`

- [ ] **Step 1:** Save a copy of `schema.prisma` to the scratch directory. Add `ripassiAlGiorno Int @default(10) @map("ripassi_al_giorno") // 1–200` to `LingoPreferenzeStudio`, and:

```prisma
// One Europe/Rome day of a user's review (Studia progress spec §5.1): written with each recorded grade,
// never by the trash, so deleting a card never rewrites a past day. `valido` is frozen once the day is over.
model LingoGiornataStudio {
  utenteId   String   @map("utente_id")
  giorno     DateTime @db.Date
  ripassi    Int      @default(0)
  nuove      Int      @default(0)
  sbagliate  Int      @default(0)
  codaFinita Boolean  @default(false) @map("coda_finita")
  valido     Boolean  @default(false)
  updatedAt  DateTime @updatedAt @map("updated_at")

  utente User @relation(fields: [utenteId], references: [id], onDelete: Cascade)

  @@id([utenteId, giorno])
  @@map("lingo_giornate_studio")
}
```

and `lingoGiornateStudio LingoGiornataStudio[]` on `User`. Do not run `prisma format`.
- [ ] **Step 2:** Generate the DDL with `npx prisma migrate diff --from-schema-datamodel <copy> --to-schema-datamodel prisma/schema.prisma --script` into the migration file, then append by hand the CHECK `ripassi_al_giorno BETWEEN 1 AND 200` and the backfill:

```sql
-- The past, from the review log. «New» is a card's first review by that user; the queue's end cannot be
-- known for a past day, so `coda_finita` stays false and `valido` is the default goal of 10 reviews.
INSERT INTO "lingo_giornate_studio" ("utente_id", "giorno", "ripassi", "nuove", "sbagliate", "coda_finita", "valido", "updated_at")
SELECT "utente_id", "giorno", COUNT(*), COUNT(*) FILTER (WHERE "n" = 1), COUNT(*) FILTER (WHERE "rating" = 1), false, COUNT(*) >= 10, CURRENT_TIMESTAMP
FROM (
  SELECT "utente_id", "rating",
         (("data_revisione" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date AS "giorno",
         ROW_NUMBER() OVER (PARTITION BY "utente_id", "card_id" ORDER BY "data_revisione", "id") AS "n"
  FROM "lingo_revisioni_srs"
) AS "r"
GROUP BY "utente_id", "giorno";
```
- [ ] **Step 3: Test the backfill** (`lingoStudyDays.migration.test.ts`): insert log rows by hand (one user; a card reviewed on two days; a rating 1; a review at 22:30 UTC on 25 October 2026, which is 23:30 Rome, and one at 23:30 UTC on 26 October, which is 00:30 Rome the next day), run the migration's `INSERT … SELECT` read from the file (after deleting the rows the setup left), and check each day's counts and `valido`. Also: `ripassi_al_giorno` 0 and 201 are refused by the CHECK.
- [ ] **Step 4:** `npx prisma migrate deploy` and `npx prisma generate` on the test database through the wrapper; `npx prisma migrate status`; the drift check (`migrate diff --from-migrations … --to-schema-datamodel …`) may show only the known `merlt_qa_jobs.updated_at` difference.
- [ ] **Step 5:** Run the new test, see it pass. Commit: `feat(server): store each Rome day of a user's review, and a review goal`.

### Task 2: The streak, as a pure function

**Files:**
- Create: `apps/server/src/lingo/streak.ts`
- Test: `apps/server/tests/unit/lingo/streak.test.ts`

**Interface:**

```ts
export type DayState = 'fatto' | 'riposo' | 'saltato' | 'oggi';
export interface Streak {
  attuale: number;                       // counted days in the current run, today included once it counts
  record: number;                        // the longest run ever, the current one included
  ultimiGiorni: { giorno: string; stato: DayState }[]; // seven, oldest first, the last is today
  riposi: Set<string>;                   // every rest day of the history, for the calendar
}
/** `validDays`: the stored days that counted ('YYYY-MM-DD'); `todayCounts`: today recomputed (spec §5.1). */
export function computeStreak(validDays: Iterable<string>, today: string, todayCounts: boolean): Streak;
```

Rule (spec D8): walk forward from the earliest counted day to today. A counted day adds one. Today, not yet counted, is `oggi` and changes nothing. Any other missed day is a `riposo` if the run is above zero and no rest fell in the six days before it, otherwise `saltato` and the run drops to zero (and the last rest is forgotten). A rest adds nothing. `record` is the maximum the run reaches. Days before the earliest counted day are `saltato`. Day arithmetic only through `studyDay.ts` (`daysBetween`, and a `nextDay` helper added there with its own test).

- [ ] **Step 1: Failing tests:** no history (0, 0, six `saltato` and `oggi`); five days in a row and today open (5); today counted (6); one gap (rest, the run goes on and the gap adds nothing); two gaps in a row (broken); gaps seven days apart (two rests); gaps six days apart (the second breaks); a record from an older run above the current one; a gap before the first counted day (not a rest); `ultimiGiorni` always seven, oldest first; a year-boundary and a daylight-saving week (the day strings stay calendar days).
- [ ] **Step 2:** Implement; run; commit `feat(server): the study streak, one rest day in seven`.

### Task 3: Writing the day with each grade, and the review goal in the preferences

**Files:**
- Create: `apps/server/src/lingo/todayQueue.ts` (moved out of `routes/lingoSrs.ts`), `apps/server/src/lingo/studyDays.ts`
- Modify: `apps/server/src/routes/lingoSrs.ts`
- Test: `apps/server/tests/lingoSrs.routes.test.ts`

- [ ] **Step 1:** Move the queue's counting out of `GET /sessione` into `todayQueue.ts`, unchanged in behaviour: `introducedToday(db, userId, today)`, `dueWhere(userId, scope, today)` and `queueFinished(db, userId, today): Promise<boolean>` (no card in the whole scope due before tomorrow, and no new slot left or no new card left in scope). `GET /sessione` uses them; its tests stay green untouched.
- [ ] **Step 2: Failing tests** in a new `describe('the stored day')`:
  - a recorded grade creates today's row (ripassi 1; nuove 1 on a first review; sbagliate 1 on rating 1); a second card adds; a second grade of the same card the same day (`registrata: false`) adds nothing;
  - with N = 3 (`PUT /preferenze { ripassiAlGiorno: 3 }`), the third grade makes `valido` true, and that grade's answer carries `oggi: { ripassi: 3, obiettivo: 3, raggiunto: true, appenaRaggiunto: true, serie: 1 }`; the fourth has `appenaRaggiunto: false`;
  - with two cards in scope and N = 10, grading both finishes the queue: `codaFinita` and `valido` true, `appenaRaggiunto` on the second;
  - **racing:** two different cards graded at once with `Promise.all` on a fresh day: one row, `ripassi` 2, no 500;
  - a day boundary: a grade at 21:59 UTC and one at 22:01 UTC in summer land on two rows;
  - `GET /sessione` with nothing due and no new card writes today's row with `codaFinita` and `valido` true and zero counts, once (twice → one row); with cards due it writes nothing;
  - `ripassiAlGiorno`: `GET /preferenze` answers 10 by default; `PUT` accepts 1 and 200, refuses 0, 201, 2.5 and a string (400).
- [ ] **Step 3: Implement** `studyDays.ts`:

```ts
/** Inside the grade's transaction, after the log row: count the grade into today's row and say whether the day counts now. */
export async function recordGradeDay(tx: Prisma.TransactionClient, userId: string, today: string, grade: { isNew: boolean; wrong: boolean }): Promise<{ ripassi: number; obiettivo: number; before: boolean; after: boolean }>;
/** On a read of today's session or progress: an empty queue makes today a counted day (spec D7). Idempotent. */
export async function markQueueFinished(db: Prisma.TransactionClient, userId: string, today: string): Promise<void>;
/** After the review goal changed: today's `valido` by the new goal; past days untouched. */
export async function recountToday(db: Prisma.TransactionClient, userId: string, today: string, goal: number): Promise<void>;
export function dayToDate(day: string): Date;   // 'YYYY-MM-DD' → the Date Prisma maps to a DATE (UTC midnight)
export function dateToDay(date: Date): string;  // the inverse, read in UTC, never through romeDay
```

`recordGradeDay`, in order: `INSERT … ON CONFLICT ("utente_id", "giorno") DO NOTHING` (raw SQL); `SELECT "valido" … FOR UPDATE` (the row lock serialises a user's grades of the day); `queueFinished`; one `UPDATE` adding the counters and setting `coda_finita = coda_finita OR $finished` and `valido = ripassi + 1 >= $N OR coda_finita OR $finished`, `RETURNING` the new values. The grade route calls it inside its transaction only when the grade is recorded; after the transaction it reads the counted days and calls `computeStreak` for `serie`. `markQueueFinished` is an upsert setting the two flags true (a row with reviews gets them too), called by `GET /sessione` when `dovute` and `nuove` are both zero, no subject narrows it and `queueFinished` agrees (false for someone who never reviewed a card in scope); `PUT /preferenze` with `ripassiAlGiorno` calls `recountToday`.
- [ ] **Step 4:** Run the file's tests; commit `feat(server): each recorded grade counts into the day; the grade says when the goal closes`.

### Task 4: `GET /api/lingo/srs/progressi`

**Files:**
- Create: `apps/server/src/lingo/progress.ts` (the queries), `apps/server/src/lingo/cardMaturity.ts`
- Modify: `apps/server/src/routes/lingoSrs.ts`
- Test: `apps/server/tests/lingoProgress.routes.test.ts`, `apps/server/tests/unit/lingo/cardMaturity.test.ts`

The answer is spec §5.2's shape. Where each part comes from:

- `oggi`: today's row (or zeros), `obiettivo` the current N, `raggiunto = ripassi >= N || codaFinita || queueFinished(now)`; a finished queue calls `markQueueFinished`. `dovute` and `nuove` are the session's counts for the subject asked (the home shows them in its sentence).
- `serie`: `computeStreak` over the stored counted days, with today as just computed.
- `stati`, `materie`, `prossimi`: one `findMany` of the state rows in scope (`select: { dueAt, lastReviewAt, card: { select: { materia } } }`), split in TypeScript with `cardMaturity.ts` (`CONSOLIDATED_DAYS = 21`; the interval is `daysBetween(romeDay(lastReviewAt), romeDay(dueAt))`), and one `lingoCard.groupBy({ by: ['materia'] })` of the new cards in scope. `prossimi`: 14 days from today, overdue counted today.
- `materie[].ripassi30`: the log of the last 30 Rome days joined to the card's subject, grouped by subject, in SQL with the review-focus expression.
- `calendario`: 26 weeks back from the Monday that starts the week 25 weeks before this one; whole-day counts from the stored rows; with `materia`, the counts from the log joined to the card's subject (the stored flags stay the whole day's); `riposo` from `computeStreak`'s set; days with no row and no rest omitted.

- [ ] **Step 1: Failing tests:** the shape with no history; a seeded history over three weeks (stored rows and log rows made with the grade route under a moved clock) checked field by field; `materia` narrowing `stati`, `calendario`'s counts and `prossimi` but not `oggi`/`serie`/`valido`; the 21-day split (20 → apprendimento, 21 → consolidate); overdue counted today; a card of a community subject switched off not counted; the calendar's first day a Monday; **the Rome day in SQL** equal to `romeDay` for reviews at 21:30, 22:30 and 23:30 UTC on 24, 25 and 26 October 2026 (DST ends on the 25th) and on 28–29 March 2027; an exchanged token gets 403; no other user's row ever appears.
- [ ] **Step 2:** Implement; the route stays a thin `router.get('/progressi', …)` over `progress.ts`. Run; commit `feat(server): one read for the Studia progress dashboard`.

### Task 5: Export, account deletion, trash, docs

**Files:**
- Modify: `apps/server/src/controllers/authController.ts`, `apps/server/CLAUDE.md`
- Test: `apps/server/tests/lingoAccountErasure.test.ts`, the export's test, `apps/server/tests/trash*.test.ts` (whichever holds the card trash round trip)

- [ ] **Step 1: Failing tests:** `GET /auth/export` carries `data.lingoGiornate` (day as 'YYYY-MM-DD', the three counts, the two flags), and `data.lingoPreferenze` gains `ripassiAlGiorno`; `DELETE /auth/account` leaves no `lingo_giornate_studio` row; trashing a studied draft and restoring it leaves every stored day byte for byte as before (review focus 4).
- [ ] **Step 2:** Implement the export. Update `apps/server/CLAUDE.md`: the «Card review» paragraph (`/progressi`, the grade's `oggi`, `ripassiAlGiorno`, the stored days, `markQueueFinished`, `recountToday`), «LingoLex cards» (the export key, the cascade), and the Rome-day SQL gotcha.
- [ ] **Step 3:** Full server suite and build; `code-reviewer` over the branch; fix every finding; push; open PR 1. Merge it at green CI (question 182 answered on 14 October).

---

## PR 2 — Web (`feat/studia-progress-web`)

### Task 6: Types, service, the review goal in the settings

**Files:**
- Modify: `apps/web/src/types/studia.ts`, `apps/web/src/services/studiaService.ts`, `apps/web/src/components/features/studia/StudyPreferences.tsx`
- Test: `StudyPreferences.test.tsx`, `studiaService` call shapes where tested

- [ ] Types `Progressi`, `StatoGiorno`, `OggiDelVoto` mirroring spec §5.2–5.3; `studiaService.progress(materia?)`; the grade's answer typed with optional `oggi`; `PreferenzeStudio.ripassiAlGiorno`. In `StudyPreferences`, a field «Ripassi al giorno» (1–200, same pattern as «Nuove schede al giorno», hint «Quanti ripassi tengono viva la serie»). Tests first; commit.

### Task 7: The layout functions

**Files:**
- Create: `apps/web/src/components/features/studia/progress/layout.ts`
- Test: `layout.test.ts`

- [ ] Pure functions, no React: `calendarGrid(days, today, weeks)` (Monday-first columns, a cell per day from the first Monday to today, month labels at the first column of each month, every day string from the server's list, the dates walked by string arithmetic in UTC, never the browser's zone); `heatLevel(count, max)` (0–4); `niceMax(values)` and the two grid lines for the forecast; `stateShares(stati)`. Tests: a 26-week and a 12-week grid ending on a Sunday and on a Wednesday, a month boundary, an empty history, a browser zone set to `America/Los_Angeles` and to `Pacific/Kiritimati` giving the same grid. Commit.

### Task 8: The pieces of direction D

**Files** (all under `components/features/studia/progress/`): `GoalRing.tsx`, `StreakBadge.tsx`, `ActivityCalendar.tsx`, `CardStatesBar.tsx`, `DueForecast.tsx`, `SubjectProgress.tsx`, `SubjectChips.tsx`, `tokens.ts` (the class names of spec §6.1: ink `text-primary-900 dark:text-primary-300` and its fills, stamp red, the subject hues from the category palette), each with a test.

- [ ] Per spec §6.1 and §6.3. Ring: SVG, ~15 px stroke at 148 px, gradient ink→primary, dotted seal, `stroke-dashoffset` transition behind `motion-safe:`, green once met, `role="img"` with «Obiettivo di oggi: X di N ripassi». Badge: ink disc with «§», the slow halo `motion-safe:animate-…` (a keyframe in the component's CSS module or `index.css` only if Tailwind cannot express it — tell the orchestrator first if `index.css`), the count in serif, «giorni di fila · record R», seven boxes (fatto: ink fill and tick; riposo: dashed; saltato: empty; oggi: outlined). Calendar: one tab stop, arrows by day and week, Home/End, the readout line as a live region, a text alternative with the range and totals, 44 px hit areas on a phone. Bars and forecast: readout on hover and tap. Chips: «Tutte le materie» + five, `aria-pressed`. Tests: the readouts' text, the keyboard, `aria` names, the box states. Commit per piece or two.

### Task 9: The dashboard on the home

**Files:**
- Create: `components/features/studia/progress/ProgressDashboard.tsx`, `useProgress.ts`
- Modify: `components/features/studia/ReviewHome.tsx`, `ReviewHome.test.tsx`

- [ ] `useProgress(materia)` reads `/progressi`, with the discriminated loading state; a refresh after a settings change (as `ReviewHome` does today). `ReviewHome` becomes: the band (ring, badge, «Oggi: … da ripassare · … nuove», «Inizia il ripasso» in ink with the pressed-key shadow), the chips (replacing the `<select>`, remembered in `localStorage` under `visualex-studia-ripasso-materia`, wrapped in try/catch; the chosen subject still narrows the session's address), the calendar, states and forecast side by side from `md`, subjects, and `StudyPreferences` inside a closed `<details>` «Impostazioni di studio». States per spec §6.2: a skeleton at final size, the failure line with «Riprova» while «Inizia il ripasso» stays usable, the empty history («Il primo giorno comincia oggi»). Tests: the three states, the chips reaching the session's address, the remembered subject, «Per oggi hai finito» when nothing is left. Commit.

### Task 10: The celebration, in the session and on the home

**Files:**
- Create: `components/features/studia/progress/Celebration.tsx`, `confetti.ts`, `useCelebratedToday.ts`
- Modify: `ReviewSession.tsx`, `useReviewSession.ts` (pass the grade's `oggi` up), their tests

- [ ] `confetti.ts`: the particle step as a pure function (`spawn(origin, count, palette)`, `step(particles)`), drawn by a ~40-line canvas loop in `Celebration`; «§» and «✓» in ink, stamp red, primary, green, amber; 90 pieces, 1.5 s, `pointer-events: none`, `aria-hidden`. The stamp «Obiettivo raggiunto · <day in words> · giorno <serie>» presses in (scale and rotate, `motion-safe:`) and stays. Under `prefers-reduced-motion` (`matchMedia`, read at play time): no canvas, no movement, the end state only. `useCelebratedToday(day)`: a `localStorage` key holding the last celebrated day, try/catch, a convenience only.
- [ ] Session: when a grade's answer has `oggi.appenaRaggiunto`, the celebration plays in a layer above the session header, never over the card or the grade bar; focus is not moved; a status line «Obiettivo di oggi raggiunto · serie di N giorni» for screen readers (and as the only signal under reduced motion). The end screen adds the ring and the badge as they now stand. Home: plays it once when today counts with at least one review and this browser has not celebrated today; otherwise the stamp at rest.
- [ ] **Tests:** plays once on the closing grade and not on the next; never under reduced motion (stubbed `matchMedia`); **while it plays, space reveals and 1–4 grade** (review focus 5); the home plays it once per day; no canvas left mounted after 1.5 s (fake timers). Commit.

### Task 11: Docs, review and the browser pass

- [ ] Update `apps/web/CLAUDE.md`'s «Card review» paragraph (the dashboard, the chips, the celebration, the stored subject key).
- [ ] Web suite, build, lint; `code-reviewer` over the branch against the spec and this plan; fix every finding.
- [ ] **Browser pass** without touching the shared stack: the branch's server on port 3011 against this session's test database and the branch's web app on 5175 through an untracked `vite.config.*.mts` that overrides the `/api` proxy and `cacheDir`; a test account registered there and activated by the orchestrator; review history made by grading under the app (a few days of history seeded through the grade route with a moved clock, or by SQL on the test database only). In an isolated browser context opened by this session, closed at the end: desktop and 390 px, light and dark, reduced motion on and off; the ring filling, the celebration in the session and on the home, the calendar's keyboard, hover and tap readouts, the subject filter, the settings. Screenshots to the orchestrator.
- [ ] Push; open PR 2 (base `feat/studia-progress` until PR 1 is merged, then `develop`). Merge only after PR 1.

---

## After the round

- Drop `visualex_test_studia_progressi`.
- Written handoff to the orchestrator: what is done, what is left, the owner's decisions in his words, the PRs, the migration (`20261022100000_lingo_study_days`, to apply to the development database after the merge).
