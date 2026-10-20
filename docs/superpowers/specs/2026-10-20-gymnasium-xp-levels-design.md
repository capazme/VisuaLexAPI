# Gymnasium — experience points, levels and missions recorded by the server

**Status:** decided, 20 October 2026: both owners have answered every question this spec raised (§10). Design
only: no code, no migration yet.
**Target:** release 1.10 (owners' decision L-30: 1.9 is the redesign alone).
**Decisions it rests on** (codes of the owners' decision register):
- **G-303:** points and levels will, later, be the engine of validator authority;
- **G-253:** every validator vote weighs the same for now; authority comes gradually, later;
- **L-27:** the draft table of missions, weights and level curve is a starting point, to be revised; its
  follow-up of 20 October settled the five open choices (§10);
- **G-314…G-318:** the points for proposing a card, the daily ceiling, who sees a level, no XP for the past,
  and XP never weighing a vote by itself (§10);
- **L-30:** 1.9 is the redesign, points and levels go in 1.10;
- **G1b** (Gymnasium restyle spec, merged in 1.8.5): the web counts the three daily missions it can already
  read and shows the others as «In arrivo», with no points and no level until the server keeps them.

**Builds on:** the progress spec (`2026-10-13-studia-progress-design.md`: Rome days, the stored days, the
streak, `GET /api/lingo/srs/progressi`), the Gymnasium restyle spec (`2026-10-19-gymnasium-restyle-design.md`
§5.1: the missions on «Oggi»), the Studia screens spec (`2026-10-07-studia-cards-screens-design.md`: the
review, proposals and votes) and the validation threshold spec (`2026-10-18-studia-validation-threshold-design.md`).
**Migration:** one, written by hand and applied with `migrate deploy`; its name is reserved with the
orchestrator once this spec is approved (§7).

## 1. Why, and what this spec settles

The owners want Gymnasium to hand out missions each day, each worth experience points (XP) by how much
effort it takes and how much it gives others, and the points to add up to levels with no ceiling. G1b
already shows the missions, counted in the browser from the progress read, and deliberately shows no
points: a count kept in the browser is lost on another device and can be forged.

This spec moves the missions to the server and gives them points:

1. an **append-only ledger** of XP credits, one row per mission completed per period (§5.2);
2. the **level**, computed from the ledger's total with one curve (§4);
3. the **missions** of the day, the week and the long run, decided by the server from stored facts, in
   the Rome days of the streak (§3, §5.1);
4. the **anti-gaming rules**: one credit per mission per period, credits only from server-side events of
   the user's own session, settings that cannot lower a mission's target, a daily ceiling (§3.2–§3.3);
5. how the ledger can, later, **feed an authority score** without being rewritten (G-303), and what does
   not change now (G-253) (§6);
6. the **reads** the web needs for G1c (the level bar, «+20 XP», the celebration of a new level), the
   routes, MCP, privacy, the migration, and what is in the first cut (§5.3, §7–§9).

## 2. Vocabulary

- **Mission:** a task with a target, a period and a value in XP. Its **period** is a Rome day (daily), a
  Rome week from Monday to Sunday (weekly) or the whole history (long run).
- **Credit:** one ledger row: the user, the mission, the period, the Rome day it was written, the points,
  and the event that completed it.
- **Total:** the sum of a user's credits. **Level:** a function of the total (§4).
- **Review scope** (`reviewScope`, `lingo/reviewQueue.ts`): what the session offers — the user's own
  drafts, proposals and validated cards, and the community's validated cards in the subjects the user
  switched on (`materieComunita`).
- **Study stream** (this spec): XP, earned by doing. **Reputation stream** (later, §6): how reliable a
  user's validation and writing turn out to be. They are kept apart.

## 3. The missions

### 3.1 The catalogue of the first cut

Values are the draft's (L-27), and «Consolida 50 schede», which the draft lists without a value, is set at 100
(L-27 follow-up, choice 1); all are to be reviewed after a month of use. Ids are the web's (`apps/web/src/components/features/studia/missions/missions.ts`), so G1b's
list keeps its keys; the database enum is their upper-case form. The catalogue lives in
`lingo/missions.ts` as one constant (id, group, value, the event kinds that evaluate it, its target
constants); Italian titles stay in the web.

| Id | Mission | Group | XP | Done when (Rome days) |
| --- | --- | --- | --- | --- |
| `dovute` | Ripassa le schede dovute | daily, main | 20 | at least one due card was reviewed today and none in the review scope is still due today |
| `nuove` | Impara 5 schede nuove | daily, main | 15 | today's first reviews reach 5, or every new card left in the review scope if fewer, whatever the daily quota (§3.3) |
| `obiettivo` | Raggiungi l'obiettivo di oggi | daily, main | 10 | the day counts for the streak and holds at least `max(N, 10)` reviews (§3.3) |
| `materia-ferma` | Ripassa una materia che non tocchi da 7 giorni | daily | 15 | 5 recorded reviews today in one subject whose last review before today was 7 or more days ago |
| `scrivi` | Proponi una scheda | daily | 25 | one of the user's drafts is proposed to the community, a card never credited before (§3.4) |
| `convalida` | Convalida due schede della comunità | daily, validators only | 20 | two validation votes cast today, whatever their verdict (§3.5) |
| `settimana` | Una settimana di serie | weekly | 50 | the streak reaches a positive multiple of 7 this week |
| `consolida` | Consolida 50 schede | long run, once | 100 | 50 cards in the review scope have an interval of 21 days or more (`CONSOLIDATED_DAYS`) |

**Main** marks the draft's three missions of the day: they make «Le missioni di oggi» and its summary
«2 di 3» as in G1b; the other daily missions are listed in «Tutte le missioni», where they can be done
and credited too. Whether «Oggi» shows more than three is the front-end owner's call; the read carries
the flag (`principale`, §5.3).

Later, not in the first cut: `caso` («Risolvi un caso breve», 40 XP in the draft), which needs the short
cases to exist; it is in the catalogue constant with its value and always `in-arrivo`, and its enum value
is added with the feature (`ALTER TYPE … ADD VALUE`). More weekly missions and a ladder of long-run
missions (100, 250, 500 consolidated cards…) are later too.

The weighting principle (the draft's): more effort, and more value for others, earns more. Reviewing is
worth less than writing for the community, and writing less than solving a case.

**The same missions for everyone** in the first cut (L-27 follow-up, choice 4; personalised later): the catalogue is fixed and every
mission is always listed (`convalida` only to validators); one with nothing to do in its period says so
(`vuota`, as in G1b) and is not counted in the summary.

### 3.2 Each mission credits once per period

This is the anti-gaming rule that carries the rest. A mission is worth its value once per period, so no
amount of repetition earns more:

- the ledger's unique key is `(user, mission, period)`; a second credit for the same period is refused by
  the database, not only by the code;
- a card reviewed twice in a day was recorded once (only the first grade of a card in a Rome day is
  recorded, Studia screens spec decision 7; practice passes are never recorded), and every mission counts
  recorded grades only, so repeating a card adds nothing;
- the most a day can earn is the sum of its missions: 105 XP from the six daily missions, plus 50 on the
  day the weekly mission closes, plus a long-run mission once in a lifetime (255 at the very most).

**The daily ceiling** (G-315) is therefore a safety net, not the rule: there is no cap below the sum of the
missions, and `XP_DAILY_CEILING = 300` is checked when a credit
is written. A credit that would take the day's total past it is not written and is logged as a warning:
in normal use it never bites, and a test pins that the catalogue's daily maximum stays under it.

### 3.3 The user's settings cannot lower a target

Three study settings belong to the user: the new cards a day (`nuoveAlGiorno`, 1–200), the reviews that
make a day count (`ripassiAlGiorno`, N, 1–200) and the community subjects switched on
(`materieComunita`, none by default). If the missions followed the first two, a user could set both to
1 and earn 45 XP a day for two cards; a level would stop meaning effort, and since levels are meant to
feed authority one day (G-303), that matters. So, for the missions only:

- `nuove`: the target is 5, lowered only when **fewer than 5 new cards are left in the review scope** —
  never by the daily quota. A user whose quota is under 5 cannot complete it until they raise the quota;
  the read says why (`motivo: 'quota'`, §5.3) and the web says what to change.
- `obiettivo`: the target is `max(N, XP_GOAL_FLOOR)` reviews, `XP_GOAL_FLOOR = 10` (the default N),
  and the day must count. A lower N still makes the day count for the streak (progress spec decision 7):
  the streak is untouched; only the XP waits for 10 reviews. A user with fewer cards than that earns
  `obiettivo` when the day counts, holds at least one review, and nothing is left in the review scope
  (no due card, no new card, whatever the quota).

**The subjects switched on are not neutralised, on purpose.** They decide what the user studies, and
they are off by default: a mission that counted community cards the user never switched on would be
out of reach for most users. Switching subjects off can therefore shrink the review scope and close
`dovute`, `nuove` or `obiettivo` early. That hole is **accepted and bounded**: each of the three still
needs real recorded reviews, each pays once a day (45 XP at most together), and the switched-off cards
leave the user's review, so the user studies less, not more. If it is abused, the fix is to freeze the
day's scope at its first read (a later change, §9).

This departs from G1b's web rule for «Impara 5 schede nuove», which lowers the target to what the daily
quota allows. The owners decided it (L-27 follow-up, choice 5): «Impara 5» and the daily goal do not go
below 5 new cards and 10 reviews for XP, so G1b's web rule changes in 1.10. Once the server keeps the
missions, the web shows the server's progress and no longer computes its own.

### 3.4 Writing: credited at the proposal, once per card

A draft is cheap and can be written by a connected application (Claude Code and LibreLex create cards
through `POST /api/lingo/cards` with an exchanged token). Proposing a draft is done only in the user's
own session (`POST /api/lingo/cards/:id/proponi`, not in the delegated table), after accepting the
proposal text, and puts the card before the validators. So:

- `scrivi` is credited when a draft becomes `PROPOSTA_COMMUNITY`, in the proposal's transaction;
- a card earns it **once in its life**: withdrawing it and proposing it again, today or another day,
  earns nothing (the unique key `(missione, fonte_id)`, the card's id as `fonte_id`, §5.2);
- nothing is taken back if the validators archive the card: the reputation stream (§6) is where the
  quality of a user's writing will count;
- the mission's visible name is «Proponi una scheda», since that is what it rewards (G-314: the points are
  for proposing a card to the community, once per card, never taken back). It is `aperta` whenever not credited today: anyone can write.

### 3.5 Validating: credited for the act, not the verdict

`convalida` counts votes cast today in `POST /api/lingo/validazione/:cardId`, whatever the verdict.
Paying for approvals and not for rejections (or the reverse) would push validators toward one answer. It
is a study credit for the work of reading and judging a card, nothing more: it does not change the weight
of the vote, which stays equal for all (G-253), and it is never read by the vote rule (§6.3).

Votes can disappear from `lingo_validazioni_card`: withdrawing a proposal deletes its votes, and the vote
that archives an authorless card deletes the card with its votes in the same transaction. So the count is
**not** read from that table: each stored vote adds one to a new counter on today's stored day,
`lingo_giornate_studio.voti` (§5.2), in the vote's transaction, before the card's state changes. The
counter is never decreased; a withdrawal later in the day takes nothing back. `convalida` is `vuota` when
the validation queue holds no card the validator can vote on (not their own, not already voted) and they
have cast fewer than two votes today.

## 4. Levels

Going from level `n` to `n + 1` costs `100 + 25·(n − 1)` XP (L-27). A new user is at level 1 with 0 XP;
there is no highest level.

The total needed to reach level `L` is `T(L) = 100·(L − 1) + 12.5·(L − 1)·(L − 2)`:

| Level | 2 | 3 | 5 | 10 | 20 | 50 |
| --- | --- | --- | --- | --- | --- | --- |
| Total XP | 100 | 225 | 550 | 1,800 | 6,175 | 34,300 |

With the three main missions (45 XP a day), level 10 takes about 40 days; with every daily mission (105
XP), about 17.

`lingo/levels.ts` holds the one definition: `levelOf(total) → { livello, nelLivello, perIlProssimo }`
(`nelLivello`: the points earned inside the current level; `perIlProssimo`: what the next level costs in
all, `100 + 25·(livello − 1)`), an integer loop over the curve (no floating point), with `T(L)` exported
for the tests. Example: 412 XP is level 4, 37 into it, 175 for the next. The level is **never stored**: it
is computed from the total on every read, so it cannot drift from the ledger.

A consequence to accept now: if the curve is made steeper after 1.10 ships, some users' levels go down.
The curve is therefore fixed before 1.10 and, after release, may only become gentler (L-27 follow-up,
choice 2). There are no titles in 1.10 (choice 3); titles every ten levels are a later decision.

## 5. Server

### 5.1 How missions are decided: one function, called by events and by the reads

`lingo/missions.ts` holds the catalogue and one function:

```ts
type XpEvent =
  | { tipo: 'revisione'; logId: string; cardId: string; materia: LingoMateria; isNew: boolean; intervallo: number }
  | { tipo: 'proposta'; cardId: string; materia: LingoMateria }
  | { tipo: 'voto'; votoId: string }
  | { tipo: 'lettura' };

settleMissions(tx, userId, today, event: XpEvent) → {
  crediti: { missione: MissionId; punti: number }[];
  livello: Livello;          // the object of §5.3, after the credits
  nuovoLivello: boolean;     // the credits crossed a level
}
```

**Which event evaluates which mission** (part of the catalogue constant):

| Event | Missions evaluated | `fonte` / `fonte_id` written |
| --- | --- | --- |
| `revisione` (a recorded grade) | `dovute`, `nuove`, `obiettivo`, `materia-ferma` (only the graded card's subject), `settimana`, `consolida` (only when `intervallo ≥ 21`) | `REVISIONE` / the review log row's id |
| `proposta` | `scrivi` | `PROPOSTA` / the card's id |
| `voto` | `convalida` | `VOTO` / the vote's id |
| `lettura` (the progress read, the session read) | every mission but `scrivi` | `LETTURA` / null |

`scrivi` is the one mission that cannot be read back from stored facts (a proposal leaves no dated row),
so only a `proposta` event credits it.

**What it does,** inside the caller's transaction:

1. sets a savepoint (`SAVEPOINT xp`, raw SQL in Prisma's interactive transaction) and bounds its own
   waits, `SET LOCAL lock_timeout = '1s'`. Any error inside the settle — a lock wait past that bound
   included — rolls back to the savepoint (`ROLLBACK TO SAVEPOINT xp`, which also undoes the `SET
   LOCAL`), is logged, and the function returns no credit; on success it releases the savepoint and
   restores the timeout (`SET LOCAL lock_timeout TO DEFAULT`). So **a bug or a slow wait in XP never fails
   a grade, a proposal or a vote**, and the settle cannot spend the transaction's own timeout (Prisma's
   default 5 s for interactive transactions). A mission missed this way is caught up by the next read,
   except `scrivi`, which is lost and logged;
2. takes the user's XP lock, `pg_advisory_xact_lock(LINGO_XP_LOCK_CLASS, hashtext(userId))` — the
   two-key form, whose key space does not overlap the one-key locks the grade route takes on
   `hashtext(user || ':' || card)`. Two settles of one user take turns, and under READ COMMITTED (the
   database's level, which this relies on) each counts what the other committed;
3. reads the user's credits for today, this week and the long run, and skips every evaluated mission
   already credited for its period;
4. evaluates each remaining mission from **stored facts only** — the stored day (`lingo_giornate_studio`),
   the review log (`lingo_revisioni_srs`), the review states (`lingo_stato_ripasso`), the scopes — never
   from anything the client sends;
5. writes a credit for each mission now fulfilled (`INSERT … ON CONFLICT DO NOTHING RETURNING`), under the
   ceiling (§3.2), and returns only the rows actually inserted, with the level before and after.

**Who calls it:**

- `POST /api/lingo/srs/revisioni`, when the grade is recorded, after `recordGradeDay` (which locks
  today's day row). The route keeps the id of the log row it creates (today it discards it). A grade not
  recorded (`registrata: false`) does not call it.
- `POST /api/lingo/cards/:id/proponi`, after the card becomes `PROPOSTA_COMMUNITY`.
- `POST /api/lingo/validazione/:cardId`, after the vote row is created and today's `voti` counted, and
  **before** the card's state changes or the card is deleted.
- `GET /api/lingo/srs/progressi`, with or without `?materia=` (missions are always the whole day's).
  `readProgress` today runs on the global client with no transaction and calls `markQueueFinished` only
  when the queue is finished. It changes to: open a transaction; first take the user row in key share
  (`SELECT 1 FROM users WHERE id = $1 FOR KEY SHARE`, see the lock order below); if today's queue is
  finished, run `markQueueFinished` in it; settle with `lettura`; commit; then build the answer,
  `missioni` and `livello` included, from what is now stored.
- `GET /api/lingo/srs/sessione`, not narrowed by `materia`, right after it runs `markQueueFinished`, in
  one transaction with it that also begins with the user row in key share. Without this, a day that counts only through the session's empty-queue rule
  would leave `obiettivo` and `settimana` uncredited until a progress read, and at midnight they would be
  lost: a settle only ever credits today and this week.

The reads settle because a mission can become fulfilled with no grade: the day counts through decision
7's empty-queue rule, or the due queue empties because a subject was switched off (§3.3). The settle is
idempotent and nearly free when everything is credited. So **a mission is `fatta` if and only if its
credit exists**: the ledger is the one source of truth for the list, the level and «+XP».

**Lock order.** Card rows, then today's day row, then the XP lock, always in that order: a grade holds its
pair lock, the card (`FOR KEY SHARE`) and today's day row, then the XP lock; a vote holds its card
(`FOR UPDATE`), then today's day row (for `voti`), then the XP lock; a proposal holds its card, then the
XP lock; a read holds the user row in key share, then today's day row (when it marks the queue
finished), then the XP lock. Account deletion locks the person's cards, then deletes the user row, whose
cascade removes the days and the credits. The events take the user row in key share with their first
insert (the vote row, the review state); the reads take it explicitly first, because
`markQueueFinished` on an existing day row updates no foreign key and would otherwise lock the day row
without it: the read would then wait on the user row for its credit insert while the deletion, holding
the user row, waits on the day row — a deadlock. With the key share first, a deletion waits for the read
to finish, or the read waits for the deletion and finds no user.

**The mission details** (the progress of each is what §5.3 returns):

- `dovute` (review scope): `due` = cards due before tomorrow (`dueWhere`, the session's definition);
  `fatte` = today's grades of a card that was already due, by the same definition (the stored day's
  `ripassi_dovuti`, §5.2; G-334): a card graded before its day or graded for the first time does not count,
  so the mission cannot be earned without a due card. Fulfilled when `fatte ≥ 1` and `due = 0`. Progress `fatte` of `fatte + due`; `vuota` when both are 0.
- `nuove` (review scope): `imparate` = today's first reviews (the stored day's `nuove`); `rimaste` = new
  cards in the review scope (`newCardsWhere`, ignoring the quota). Target `min(5, imparate + rimaste)`;
  `vuota` when it is 0; fulfilled when `imparate ≥ target`. `motivo: 'quota'` when the quota left today
  (`nuoveAlGiorno − imparate`) is under what remains of the target.
- `obiettivo`: target `max(N, 10)`; fulfilled when the day counts and `ripassi ≥ target`, or when the day
  counts, `ripassi ≥ 1` and the review scope has no due card and no new card. Progress `min(ripassi, target)`
  of `target`.
- `materia-ferma` (review scope): a subject **qualifies** when the user's last recorded review in it
  before 00:00 Rome of today fell on today − 7 or earlier (one `MAX(data_revisione)` per subject over the
  log joined to the cards; a subject never reviewed does not qualify: the mission is about going back,
  and a first subject is rewarded by `nuove`). Fulfilled by a qualifying subject with 5 recorded reviews
  today. On a grade, only the graded card's subject is checked, and only once it has 5 reviews today. On
  a read, the subject shown is: the qualifying subject with the most reviews today; failing that, the
  qualifying subject with the oldest last review among those where `reviews today + due today + new
  cards left today (with the quota)` reach 5. The read returns that subject (`materia`); `vuota` when none.
  Reviews moved out of the log by the trash are not seen, as for the calendar.
- `scrivi`: §3.4. Period: the day. The row carries the card's id and subject.
- `convalida`: today's `voti` ≥ 2 (§3.5). Listed only to validators.
- `settimana`: today counts and the streak (`computeStreak(…).attuale`) is a positive multiple of 7.
  Period: the Monday of today's Rome week. Two multiples of 7 are at least seven days apart, so never in
  one week. Progress `attuale mod 7` of 7 (7 of 7 once credited). A week can hold no multiple of 7 (a
  rest day stretches the run, or the run began mid-week): then nothing is credited that week, on purpose
  — the mission follows the streak count the user sees («Serie: 14 giorni»), and over a long run it pays
  about once a week.
- `consolida` (review scope): cards with an interval of 21 days or more ≥ 50 (the progress read's split
  over the whole scope, not the `materia` filter). Period: once.

### 5.2 Storage

**The ledger, table `lingo_crediti_xp` (model `LingoCreditoXp`):**

| Column | Type | What |
| --- | --- | --- |
| `id` | uuid, PK | |
| `utente_id` | text → `users`, `ON DELETE CASCADE` | |
| `missione` | enum `LingoMissione` (`DOVUTE`, `NUOVE`, `OBIETTIVO`, `MATERIA_FERMA`, `SCRIVI`, `CONVALIDA`, `SETTIMANA`, `CONSOLIDA`) | |
| `periodo` | text | `G:YYYY-MM-DD` for a day, `S:YYYY-MM-DD` (the Monday) for a week, `U` for once; a `CHECK` on its shape in the migration, not in the Prisma model (as the other checks of this schema) |
| `giorno` | `DATE` | the Rome day the credit was written (the ceiling, `livello.oggi`, the history) |
| `punti` | integer, `CHECK (punti BETWEEN 1 AND 1000)` | the value **at the time**: changing the catalogue never rewrites the past |
| `fonte` | enum `LingoFonteXp` (`REVISIONE`, `PROPOSTA`, `VOTO`, `LETTURA`) | the kind of event that completed it |
| `fonte_id` | text, nullable | the review log row, the card, the vote; null for `LETTURA`. No foreign key: the ledger outlives a trashed card or a deleted vote |
| `materia` | `LingoMateria`, nullable | for missions bound to one subject (`materia-ferma`, `scrivi`); null for those that span the scope |
| `created_at` | timestamp | |

Keys and indexes, all expressible in the Prisma model so the drift check covers them:
`@@unique([utenteId, missione, periodo])`; `@@unique([missione, fonteId])` — nulls are distinct in
Postgres and no mission reuses a `fonte_id`, so it holds `scrivi` to once per card in its life without a
partial index; `@@index([utenteId, giorno])`.

**Append-only.** The application never updates or deletes a row; the only deletion is the cascade of an
account deletion. The trash does not touch it (as the stored days). There are no negative rows in the
first cut; a later reversal, if ever wanted, would be a new row of its own kind, never an edit.

**One column on the stored day:** `lingo_giornate_studio.voti`, integer, default 0: validation votes cast
that day (§3.5), written only by the vote route (an upsert of today's row, then `voti = voti + 1`). The
progress spec foresaw a day's row counting kinds of activity other than reviews (its §8); this is the
first. It changes nothing for the streak: `valido` and its rules are untouched. A row created only by a
vote has zero reviews and `valido` false; the calendar of the progress read leaves such rows out (a row
with `ripassi = 0` that did not count is not a study day), so it still shows only days with reviews or
days that counted. «Did not count» is read with today's `valido` computed as the read already does
(`raggiunto` for today, the stored value for past days), and the same filter applies in the branch
narrowed by subject. The change also corrects two texts that would become false: the header of
`lingo/studyDays.ts` («nothing else writes these rows») and the progress spec's §5.1 list of who writes a
row; and the export test's expected shape (`tests/accountData.test.ts`) gains `voti`.

**And a second (G-334):** `lingo_giornate_studio.ripassi_dovuti`, integer, default 0: of the day's
`ripassi`, the grades of a card whose state was due before tomorrow (`dueAt` before 00:00 Rome of the next
day, as `dueWhere`). `recordGradeDay` adds it in the same update as `ripassi`, from the state the grade
read before rewriting it; nothing else writes it. Only «dovute» reads it; the streak does not.

### 5.3 The reads and the answers

**One shape for the level**, used everywhere:

```jsonc
"livello": { "livello": 4, "totale": 412, "nelLivello": 37, "perIlProssimo": 175, "oggi": 45 }
```

`oggi` is the sum of the user's credits whose `giorno` is today.

**`GET /api/lingo/srs/progressi`** gains three fields (additive; the rest unchanged):

```jsonc
"livello": { /* as above */ },
"missioni": [
  { "id": "dovute", "gruppo": "giornaliera", "principale": true, "punti": 20, "stato": "aperta", "progresso": { "fatte": 8, "di": 18 } },
  { "id": "nuove", "gruppo": "giornaliera", "principale": true, "punti": 15, "stato": "aperta", "progresso": { "fatte": 2, "di": 5 }, "motivo": "quota" },
  { "id": "materia-ferma", "gruppo": "giornaliera", "principale": false, "punti": 15, "stato": "aperta", "progresso": { "fatte": 2, "di": 5 }, "materia": "DIRITTO_PENALE" },
  { "id": "caso", "gruppo": "giornaliera", "principale": false, "punti": 40, "stato": "in-arrivo" },
  { "id": "settimana", "gruppo": "settimanale", "principale": false, "punti": 50, "stato": "aperta", "progresso": { "fatte": 3, "di": 7 } },
  { "id": "consolida", "gruppo": "lungo", "principale": false, "punti": 100, "stato": "aperta", "progresso": { "fatte": 12, "di": 50 } }
  /* the catalogue in its order; `convalida` only for validators */
],
"crediti": [ /* the credits this read just wrote, usually empty: [{ "missione": "obiettivo", "punti": 10 }] */ ]
```

- `gruppo`: `giornaliera`, `settimanale`, `lungo` (the web's `MissionGroup`).
- `stato`: `fatta` (credited for the period), `aperta`, `vuota` (nothing to do in this period) or
  `in-arrivo` (announced, not yet recorded) — G1b's `MissionStatus`.
- `progresso: { fatte, di }` maps to the web's `progress: { done, of }`; absent for `scrivi`, `in-arrivo`
  and a `vuota` with nothing to count.
- `motivo` (only on `nuove`, when not `fatta`): `quota` (§5.1).
- `materia` (only on `materia-ferma`): the subject the mission is about.
- `missioni`, `livello` and `crediti` are never narrowed by `materia`, like `oggi.raggiunto` and `serie`.

**`POST /api/lingo/srs/revisioni`** (a recorded grade), **`POST /api/lingo/cards/:id/proponi`** and
**`POST /api/lingo/validazione/:cardId`** always add, when the event succeeded:

```jsonc
"xp": { "crediti": [{ "missione": "dovute", "punti": 20 }], "livello": { /* as above */ }, "nuovoLivello": false }
```

The grade's answer gains `xp` next to `oggi`; the proposal's answer, the serialized card, gains it as one
more top-level key (`{ ...card, xp }`); the vote's answer becomes `{ stato, xp }`. A grade not recorded
(`registrata: false`) carries no `xp`; a proposal that answers 409 with the text to accept carries none.
`crediti` may be empty. `nuovoLivello` is true when this event's credits crossed a level, for G1c's
celebration; the web celebrates a level once (it remembers the last level it celebrated, a per-browser
convenience like the goal's).

No other route. A history of credits on screen is later; `GET /auth/export` already carries it (§8).

### 5.4 What does not change

The review queue and its counts, the review scope (`reviewQueue.ts`), FSRS, the streak's rules
and `valido`, the trash, the validation rule and its thresholds, who is a validator.

## 6. Authority, later (G-303), and what stays as it is (G-253)

### 6.1 Two streams, kept apart

- **Study (this spec):** XP rewards effort and regularity. Anyone who studies earns it; it says nothing
  about whether the user's judgement is reliable.
- **Reputation (a later spec):** how reliable a user's contributions turn out to be — a validator's votes
  that agree with the outcome a card reaches, cards a user wrote that the community validates or archives
  as wrong, per subject.

If XP alone bought vote weight, grinding reviews would buy authority over what the community accepts as
correct. So the future authority model reads XP **at most as one input among others**, and the ledger is
built so it can do that without being rewritten.

### 6.2 What an authority model would read, and what this spec fixes now so it can

| Signal | Where it is | Ready now? |
| --- | --- | --- |
| Effort over time, by mission and by day | `lingo_crediti_xp` (`missione`, `giorno`, `punti`) | yes, from 1.10 |
| Effort per subject | `lingo_crediti_xp.materia` for subject-bound missions; the review log for the rest | partly: the log is the better per-subject signal |
| Competence per subject | consolidated cards per subject (`lingo_stato_ripasso`, the 21-day split) | yes |
| A validator's agreement with outcomes | `lingo_validazioni_card` (voter, verdict, date) and the card's final state | the data exists, but a withdrawal deletes votes, and nothing records the outcome at the time: the reputation spec needs its own append-only record |
| An author's validated vs archived cards | `lingo_cards` (`autore_id`, `stato`) | yes, while the card exists |

Fixed now so nothing needs rewriting later: credits are append-only and carry their value at the time,
the kind and id of the event and the subject where there is one; the mission ids are stable.

Left to the authority spec: the formula (and its weight on XP, if any), per-subject authority, an
append-only record of votes and outcomes, how authority enters the vote rule (the Studia screens spec's
decision 14 already foresees the RLCF weighted sum replacing the count), the existing unused
`lingo_cards.authority_score` column, and the relation, if any, with MERL-T's own authority
(`services/merlt/merlt/rlcf/authority.py`, which needs the owner's explicit approval to change).

### 6.3 What this spec must not change

- **Every validator vote weighs the same (G-253).** `lingo/validationRule.ts` never reads the ledger or
  the level, and the vote route calls only `settleMissions` from `lingo/missions.ts`, after the vote is
  stored and before `stateAfterVotes` runs on the same, unweighted votes. A test fails if
  `validationRule.ts` imports `lingo/missions.ts` or `lingo/levels.ts`, and another checks that a vote's
  outcome is the same whatever the voter's level.
- **A level grants nothing.** It does not make anyone a validator (an administrator does,
  `User.lingoValidatore`), does not change a threshold, and unlocks no content (stops are free, Gymnasium
  restyle spec §5.2).
- **The level is private.** Only its owner sees it: no leaderboard, no badge in the Forum, nothing that
  shows one user's study to another (progress spec §7). Showing it to others is a later decision
  (G-316: in 1.10 the level is visible only to its owner, with no leaderboards and no badges).

## 7. Migration

One migration, written by hand and applied with `migrate deploy` (never `migrate dev`): the two enums,
the table with its two unique keys, index and checks, and the columns `lingo_giornate_studio.voti` and
`lingo_giornate_studio.ripassi_dovuti` (`INTEGER NOT NULL DEFAULT 0`). **No backfill:** the ledger records missions it saw; the past cannot say
which missions were done on a given day (whether the due cards were all reviewed, for instance), so XP
starts at zero for everyone on the day 1.10 ships (G-317), and both counters start at zero. Its name
is reserved with the orchestrator before it is written (proposed: `<next free timestamp>_lingo_xp_ledger`);
the drift check covers the model, and the checks are written in SQL as for the other Studia tables.

## 8. Privacy and security

- **Study actions only.** The ledger stores a mission, a period, a number, an event id and a subject.
  No card text, no question or answer, nothing from a document, a dossier or a client file. The missions
  read only the review, the proposals and the votes.
- **Personal data, the user's alone.** Credits cascade with the account (`deleteUserAccount` needs no
  change: the cascade does it). `GET /auth/export` carries them as `data.lingoCreditiXp` (mission,
  period, day, points, kind of event, subject), next to `lingoGiornate`, which gains `voti` and `ripassiDovuti`. Nothing is
  sent to MERL-T.
- **Session only.** Every route that settles missions is outside the delegated table, so an exchanged
  token (Claude Code, LibreLex) can neither earn XP nor read it; `progressi` already answers 403 to it.
  Rule for later changes: `settleMissions` is never called from a route an exchanged token can reach.
  `POST /api/lingo/cards`, which is delegated, credits nothing. **No MCP tool** reads or writes XP in the
  first cut: study history is not surface for a connected application.
- **Forgery.** The client sends no points, no mission and no day; the server decides all three from its
  own records and its own clock.
- **A change of purpose, later.** Today XP serves the user's own motivation. Using it to weigh votes
  (G-303) is a new purpose: it uses a person's study history to decide how much their judgement counts.
  G-318 settles the limits: XP alone never weighs a vote; at most it becomes one input of a future authority
  model, and the privacy notice is updated before any use of XP in votes. The authority spec must also weigh
  it; this spec only flags it.

## 9. First cut and later

**First cut (1.10):** the migration; `lingo/levels.ts`; `lingo/missions.ts` with the eight missions of
§3.1, `caso` as `in-arrivo`, and `settleMissions`; its calls from the grade, the proposal, the vote, the
progress read and the session read; `voti` written by the vote; the new fields of §5.3; the export; the
tests of §11. On the web (G1c, the front-end owner's phase): `missions.ts` takes its list from
`progressi.missioni` instead of computing it; the level bar; «+20 XP» after an event (and after a read
whose `crediti` is not empty); the celebration of a new level; the XP of each mission in the list;
`motivo` as a line under «Impara 5 schede nuove».

**Later:** `caso` (with the short cases); more weekly missions; long-run ladders; titles every ten levels;
missions chosen from what the user studies; freezing the day's scope for `dovute` if needed (§3.3); a
history of credits on screen; the reputation stream and the authority model (§6), each with its own spec; a review of the mission
weights after a month of use.

## 10. Decisions

All the questions this spec raised were answered by the owners on 20 October 2026. G-314…G-318 were
accepted by both owners as recommended; the five choices are the front-end owner's (L-27 follow-up).
G-334 came up while building the server, where §3.1 («a due card») and §5.1 (`ripassi − nuove`) disagreed.

| Code | Decision | Date |
| --- | --- | --- |
| G-314 | XP for proposing a card to the community, once per card, never taken back; the mission is named «Proponi una scheda» (§3.4) | 20 Oct 2026 |
| G-315 | No daily cap below the sum of the missions; 300 only as a safety net (§3.2) | 20 Oct 2026 |
| G-316 | The level is visible only to its owner in 1.10; no leaderboards or badges (§6.3) | 20 Oct 2026 |
| G-317 | Nobody gets XP for the past; everyone starts at zero at release (§7) | 20 Oct 2026 |
| G-318 | XP alone never weighs a vote. At most it becomes one input of a future authority model, and the privacy notice is updated before any use of XP in votes (§6, §8) | 20 Oct 2026 |
| L-27 (1) | The draft's mission weights for 1.10, with «Consolida 50 schede» at 100, to be reviewed after a month of use (§3.1) | 20 Oct 2026 |
| L-27 (2) | The curve `100 + 25·(n − 1)`, fixed before 1.10; after release it may only become gentler (§4) | 20 Oct 2026 |
| L-27 (3) | No titles in 1.10 (§4) | 20 Oct 2026 |
| L-27 (4) | The same missions for everyone in 1.10, personalised later (§3.1) | 20 Oct 2026 |
| L-27 (5) | «Impara 5» and the daily goal do not go below 5 new cards and 10 reviews for XP; this changes G1b's web rule in 1.10 (§3.3) | 20 Oct 2026 |
| G-334 | «Ripassa le schede dovute» counts only the grades of a card already due (`ripassi_dovuti`, in the same migration), so a card graded early cannot earn it (§5.1, §5.2) | 20 Oct 2026 |

Validating earns XP whatever the verdict (§3.5); together with G-318 it is the principle the authority
spec starts from.

## 11. Testing

Server (its own test database, one suite at a time, as the other Studia suites):

- `levels.ts`: `T(L)` against the table of §4; `levelOf` at 0, 99, 100, 412, 1,799, 1,800 and a large total.
- Each mission: fulfilled exactly at its threshold and not one short; `vuota` when there is nothing to do;
  the whole-day missions unchanged by `?materia=` on the read; the floors of §3.3 (quota 1 and N 1 with
  plenty of cards: no `nuove`, no `obiettivo` for two reviews; `motivo: 'quota'`); the accepted hole of
  switched-off subjects behaves as described.
- Which event evaluates which mission: a proposal never credits `dovute`; a vote never credits a review
  mission; each `fonte` and `fonte_id` as in §5.1.
- Once per period: two grades, two tabs (two concurrent settles), a retried proposal and vote; a card
  withdrawn and proposed again earns `scrivi` once in its life; a grade not recorded settles nothing.
- `convalida`: two concurrent votes on different cards credit **exactly once** (without the XP lock the
  risk is zero credits); a withdrawal after the first vote, and the vote that deletes an authorless
  card, still count toward the two.
- The savepoint: a forced error inside the settle leaves the grade, the proposal and the vote stored and
  answers with empty `crediti`.
- `settimana`: at 7 and 14, not at 8, with a rest day inside the run; the Monday period across a week;
  a week with no multiple of 7 credits nothing.
- `materia-ferma`: last review on today − 7 qualifies, on today − 6 does not; a never-reviewed subject
  does not; the read's choice stays on the subject being studied as its reviews accumulate.
- Rome days: a credit at 23:59 and 00:01 Rome, across both daylight-saving nights, lands on the right
  `giorno` and `periodo`.
- The reads: a mission fulfilled without a grade (a subject switched off; an empty-queue day seen by the
  session read) is credited once by the read; `crediti` lists it; `fatta` ⇔ a credit exists.
- The calendar leaves out a day row created only by a vote.
- The ceiling: the catalogue's daily maximum is under `XP_DAILY_CEILING`; a forced credit past it is not
  written.
- `nuovoLivello` on exactly the event that crosses a level.
- The vote rule: the import check and the same-outcome check of §6.3.
- An exchanged token: `POST /api/lingo/cards` writes no credit; `progressi` stays 403.
- The export keys (`lingoCreditiXp`, `voti`); the account deletion removes the credits; a trash round
  trip leaves them; the migration's drift check.

Web (G1c): the list from `progressi.missioni`; the level bar's value and its text alternative; «+XP»
never taking focus or delaying the next card (progress spec decision 6); the level celebration once and
never under reduced motion.
