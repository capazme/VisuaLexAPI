# VisuaLex Studia — the streak and the progress dashboard

**Status:** decided by the owner on 13 October 2026: the scope, the visual direction and the six interview points (§3). Decision 13, storing the days, waits for his answer (question 182, recommended); nothing that contains it is merged before it. The server (PR 1) is written; the web app (PR 2) is in progress.
**Builds on:** the Studia screens spec (`docs/superpowers/specs/2026-10-07-studia-cards-screens-design.md`): the review (PR C, decisions 7–9, 17, 18), its routes (`apps/server/src/routes/lingoSrs.ts`) and its screens (`ReviewHome`, `ReviewSession`).
**Plan:** `docs/superpowers/plans/2026-10-13-studia-progress.md`.
**Migration:** `20261022100000_lingo_study_days` (§5.1), assigned by the orchestrator.

## 1. Why, and what was decided

The owner's document of 13 October asks for «una dashboard gamificata in stile duolingo con livelli progressivi di apprendimento e sfide giornaliere che il singolo utente deve svolgere». Asked how far the first round should go (the recommendation was the streak and a progress dashboard on the review data, with levels, challenges and simulations in later rounds), he answered: «ok, cerchaimo anche di spingere con una grafica accattivante e interattiva».

The interview of 13 October put six questions to him (§10), each with a recommendation. His answer: «ok come raccomandi».

Three visual directions were shown to him as an interactive mock: A (sober, like the reader), B (playful, like Duolingo) and C (a lawyer's register, with a stamp). His answer: «come stile studia servirebbe qualcosa tra B e C». Two blends followed, D (leaning to B) and E (leaning to C). His answer: «ok D mi piace». The direction is **D, «Registro vivo»**, as shown, without E's notches on the ring (§6.1).

What exists today, checked in the code on 13 October:

- the review with FSRS v4: one state row per user and card (`LingoStatoRipasso`), an append-only log of first grades (`LingoRevisioneSRS`, one row per card per Rome day at most), the study preferences (`LingoPreferenzeStudio`);
- a «daily goal» that is about **new cards only** (`nuoveAlGiorno`, default 20, decision 9). It cannot carry a streak: on a day with no new card left in scope it cannot be met. What makes a day count is therefore a new definition (decision 7);
- the subjects (`LingoMateria`, five);
- proposals and validation (PR B);
- the exam traces, readable through `GET /api/lingo/simulazioni/tracce` and used by no screen.

## 2. Scope

**In this round:**

1. **The streak:** consecutive Rome days on which the day counted (decision 7), with the rule for a missed day (decision 8); the current streak, the best one, the last seven days.
2. **A progress dashboard on Studia's home** (`/studia/ripasso`, where `/studia` already lands):
   - today's goal, as a ring;
   - the streak;
   - the cards by state: new, learning, consolidated (§4.2);
   - progress by subject;
   - the review history as an activity calendar;
   - what is due in the coming fourteen days.
   A subject filter narrows the whole dashboard and the session it starts.
3. **«Accattivante e interattiva»:** direction D (§6.1), motion that rewards (the ring filling, the § badge, a celebration when the goal is reached), charts that answer hover and tap, everything off under `prefers-reduced-motion`.
4. **The review session** gains only what the goal needs: the celebration when a grade closes it, and the ring and streak on its end screen. The review card's visual rule (Studia spec §6) does not change, and nothing is added between a grade and the next card.
5. **The review goal** in the study settings: «Ripassi al giorno», N, 1–200, default 10.

**Out of this round:** levels, daily challenges, exam simulations, leaderboards or anything that shows one user's study to another, notifications and reminders, sounds. §8 lists the seams left for them.

## 3. Decisions

Settled on 13 October:

1. **Scope** as §2 (answer to question 165).
2. **Visual direction D** (answers to question 178).
3. **Server time decides.** «Today», «yesterday» and every calendar day are Rome days computed on the server (Studia decision 18). The web app never computes a day for the streak or the goal; it formats the days it is given.
4. **One read for the dashboard.** The home asks one route for everything it draws (§5.2), so the page renders whole or says it could not read, never half a dashboard with stale parts.
5. **No new dependency.** The charts are hand-drawn SVG; the confetti is one small canvas routine; the motion is CSS (`motion-safe:`) and, where a sequence needs it, `framer-motion`, already a dependency.
6. **Nothing slows the review.** The celebration never takes focus, never blocks a key, never delays the next card; it plays beside the card and is gone in under 1.5 seconds.

7. **A day counts** (O1 b) when the user recorded at least N reviews that day, or finished the day's queue. N is the user's own («Ripassi al giorno», default 10). «Finished» means nothing left due today and no new card left to introduce today, across every subject. A day whose queue was empty from the start counts too, provided the user has studied (at least one reviewed card in scope) and opened Studia that day (the literal reading of «la coda del giorno finita se le schede erano meno di N»: zero cards are fewer than N); this keeps a user with few cards from losing the streak because the scheduler gave them nothing to do.
8. **A missed day** (O2 b): one missed day in any seven keeps the streak, automatically. Rest days are at least seven days apart; two missed days in a row, or a second one within seven days of the last rest, break it. A rest day does not add to the count.
9. **The home** (O3): the band first (ring, streak, «Inizia il ripasso»), then the rest, the settings closed at the bottom; the dashboard is the home of «Ripasso», no new tab.
10. **One celebration a day** (O4), at the moment the goal closes; no sound; off under «riduci movimento».
11. **Only reviews count** (O5); writing and validating cards wait for the daily challenges.
12. **The calendar** (O6): 26 weeks on a computer, 12 on a phone.
13. **The days are stored** (§5.1; awaiting the owner, question 182), one row per user and Rome day, written with each grade. Two reasons. Trashing a studied draft moves its review rows out of the log until it is restored, and a streak computed from the log alone would break backwards. And the log cannot say that a past day's queue was finished. A past day's row is frozen: changing N later does not rewrite it.

## 4. What the dashboard shows, and where each number comes from

### 4.1 Today, and the streak

- **Reviews today:** the first grades recorded today (`LingoRevisioneSRS` rows of the user whose Rome day is today). Practice passes are not recorded and do not count, as in the session.
- **The goal and whether it is met:** decision 7. The ring fills `ripassi / N`, and is full as soon as the day counts (a finished queue with fewer than N reviews fills it too).
- **The streak:** the days that counted, with decision 8's rule for a missed day; today joins it once today counts. `lingo/streak.ts` is one pure function over the stored days and today: it walks the days forward from the user's first stored day, and is the one definition for the count, the best run and the last seven days. So a streak is never shown broken in the morning just because today's review has not happened yet: until midnight today is «da fare», drawn as an empty box.
- **The best streak:** the longest run in the user's history, under the same rules.
- **The last seven days:** each one `fatto` (the day counted), `riposo` (missed, but kept by decision 8's rule), `saltato` (missed, streak broken) or `oggi` (still open).

### 4.2 The cards by state

Over the cards in the user's review scope (`reviewScope`: their own drafts, proposals and validated cards, the community's validated cards in the subjects switched on), so the counts agree with the session:

- **Nuove:** in scope, no state row.
- **In apprendimento:** a state row whose current interval (the Rome days from the last review to `dueAt`) is under 21 days.
- **Consolidate:** current interval of 21 days or more.

21 days is the threshold Anki calls «mature»; it is one named constant, so a level system can read the same split later.

### 4.3 Progress by subject

For each of the five subjects: the three counts above and the share consolidated, plus the reviews of the last 30 days. A subject with no card in scope is listed greyed, with «Nessuna scheda», so the list is always the same five rows. A row is also a filter (§6.3).

### 4.4 The activity calendar

One cell per Rome day, the last 26 weeks on a computer and the last 12 on a phone (decision 12), weeks starting on Monday. Per day: reviews, of which new (a card's first review ever) and wrong (rating 1, «Di nuovo»), and whether the day counted. The colour scale is the count of reviews; a day that counted carries a small mark; a `riposo` day a dashed outline. Filtered by subject, a day shows that subject's reviews; whether the day counted stays the whole day's.

### 4.5 The coming days

Due cards per Rome day for the next 14 days, from `LingoStatoRipasso.dueAt` within the scope; overdue cards count in today. Today's bar is drawn apart (the streak's warm colour), because it is the only one the user can act on.

## 5. Server

### 5.1 The stored days: `LingoGiornataStudio`

Migration `20261022100000_lingo_study_days`, written by hand and applied with `migrate deploy`:

- a table `lingo_giornate_studio`: `utente_id` (→ `users`, `ON DELETE CASCADE`), `giorno` (`DATE`, the Rome day), `ripassi`, `nuove`, `sbagliate` (integers, default 0), `coda_finita`, `valido` (booleans, default false), `updated_at`; primary key `(utente_id, giorno)`;
- a column `lingo_preferenze_studio.ripassi_al_giorno`, integer, default 10, with a CHECK 1–200 as the route checks;
- the past filled from `lingo_revisioni_srs`, grouped by `(data_revisione AT TIME ZONE 'Europe/Rome')::date`: reviews, new (a card's first review by that user, by a window over the log), wrong (rating 1); `valido` when reviews ≥ 10; `coda_finita` false, since the log cannot tell.

Who writes a row:

- **a recorded grade**, in its transaction, after the log row: the counters go up by one (`nuove` when there was no state row, `sbagliate` on rating 1); then whether the queue is finished (nothing in scope due before tomorrow, and no new slot left or no new card left in scope); then `valido = ripassi ≥ N or coda_finita`, with the user's current N. A second grade of the day writes nothing, as now;
- **a read of today's session (not narrowed to a subject) or of the progress**, when today's queue is finished: today's row gets `coda_finita` and `valido`, created with zero counts when the user had nothing to do (decision 7's empty day). An upsert, so it cannot double. Someone who never reviewed a card in scope has no queue to finish, so an empty account never makes a day count;
- **a change of the goal** (`PUT /preferenze` with `ripassiAlGiorno`): today's `valido` is recounted with the new N; past days are not;
- nothing else. The trash does not touch it, a restore does not add to it, an account deletion removes it by cascade, and `GET /auth/export` carries it as `data.lingoGiornate` (day, counts, the two flags). It is not in the delegated table.

Today is never read from its stored `valido` alone: the progress route recomputes it with the current N, so raising N in the evening shows the ring as it now stands. Past days are read as stored.

### 5.2 `GET /api/lingo/srs/progressi?materia=`

Session only, like every `/api/lingo/srs` route, and not in the delegated table: an exchanged token gets the default 403. Study history is not surface for a connected application.

```jsonc
{
  "oggi": { "giorno": "2026-10-13", "ripassi": 21, "obiettivo": 20, "raggiunto": true, "dovute": 5, "nuove": 8 },
  "serie": {
    "attuale": 13, "record": 27,
    "ultimiGiorni": [{ "giorno": "2026-10-07", "stato": "fatto" }, /* … seven, the last is today */]
  },
  "stati": { "nuove": 63, "apprendimento": 125, "consolidate": 212 },
  "materie": [{ "materia": "DIRITTO_CIVILE", "nuove": 20, "apprendimento": 28, "consolidate": 104, "ripassi30": 310 }, /* five */],
  "calendario": [{ "giorno": "2026-04-14", "ripassi": 24, "nuove": 6, "sbagliate": 3, "valido": true, "riposo": false }, /* 26 weeks, days with no review omitted */],
  "prossimi": [{ "giorno": "2026-10-13", "schede": 30 }, /* 14 */]
}
```

`materia` narrows `stati`, `calendario`'s counts, `prossimi`, and `oggi.dovute` and `oggi.nuove` (the band's sentence about the session «Inizia il ripasso» starts); `oggi.ripassi`, `obiettivo`, `raggiunto`, `serie`, `valido` and `riposo` are always the whole day's, because the goal is.

The Rome day of a stored instant is computed in SQL as `((data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date` (the column is a `TIMESTAMP` without a zone holding UTC), which agrees with `lingo/studyDay.ts` `romeDay`; the tests pin the two against each other across both daylight-saving nights. The log is read from 00:00 in Rome of the window's first day, as an instant, so the index `(utente_id, data_revisione)` bounds every scan: 30 days for `ripassi30`, 26 weeks for a subject's calendar.

### 5.3 The grade's answer

`POST /api/lingo/srs/revisioni` adds to its answer, when the grade was recorded:

```jsonc
"oggi": { "giorno": "2026-10-13", "ripassi": 20, "obiettivo": 20, "raggiunto": true, "appenaRaggiunto": true, "serie": 13 }
```

`appenaRaggiunto` is true on the one grade that made the day count (it did not before), so the session celebrates at that moment, also across two devices. Raising N after the goal was met makes the day not count again, and the grade that reaches the new N says `appenaRaggiunto` again; the web app still celebrates once a day (decision 10) by remembering the day it celebrated (§6.4). Additive: nothing that reads the answer today changes.

### 5.4 The preferences

`GET`/`PUT /api/lingo/srs/preferenze` gain `ripassiAlGiorno` (1–200, default 10), next to `nuoveAlGiorno` and `materieComunita`.

### 5.5 What does not change

The session's queue and its counts, the scope, the FSRS engine, the trash, the review log.

## 6. Web

### 6.1 Direction D, «Registro vivo»

The app's own tokens, light and dark; no colour outside them.

- **Ink:** `primary-900` in light, `primary-300` in dark: the numbers, the § badge, the ticked boxes, the calendar's scale, the session-start button.
- **Stamp red:** `red-700` / `red-400`, for the stamp alone.
- **Warm accent:** the warning tone (`amber`), for today's bar in the forecast.
- **Success:** the existing green, for the ring once the goal is met.
- **Subjects:** one hue each from the environment category palette (civil blue, penal red, administrative amber, the two procedures violet and purple), used only for the subject rows, the chips' dots and a filtered calendar.
- **Type:** numbers and panel headings in the reader's serif (`font-serif`, headings in small caps); everything else the app's sans.
- **Surfaces:** the band and the panels as rounded tiles (`rounded-2xl`) on a faintly tinted ground, each panel with a double rule in ink on its left edge.

The pieces:

- **The ring** (today's goal): thick (about 15 px at 148 px), its track the neutral, its arc a gradient from ink to primary, a dotted seal around it; the count large in serif, «di 20 ripassi» under it. It fills with an eased transition; once the goal is met it turns green.
- **The streak:** a round badge in ink with a white «§» that breathes slowly (a soft halo, `motion-safe:` only), the count beside it in large serif ink, «giorni di fila · record 27» under it, and seven boxes for the last seven days: filled ink with a tick for `fatto`, dashed for `riposo`, empty for `saltato`, outlined for today.
- **Inizia il ripasso:** the area's primary action, in ink with a pressed-key shadow, 44 px high on a phone and full width there.
- **The celebration** (when the goal closes): the ring turns green, the badge pops, the streak's number ticks up, confetti of «§» and «✓» in ink, stamp red, primary, green and amber burst from the ring (about 90 pieces, 1.5 s, a canvas laid over the band, `pointer-events: none`), and a stamp «Obiettivo raggiunto · 13 ottobre 2026 · giorno 13» presses onto the band and stays there for the day. Under `prefers-reduced-motion` only the end state is drawn: green ring, the new count, the stamp, no confetti, no movement.

### 6.2 The home, `/studia/ripasso`

From top to bottom (decision 9):

1. the band: ring, streak, today's sentence («Oggi: 5 da ripassare · 8 nuove», as now) and «Inizia il ripasso»;
2. the subject chips: «Tutte le materie» and the five subjects. They replace the current `<select>` and keep its job: the chosen subject narrows the session that «Inizia il ripasso» starts, and now the dashboard too. The choice is remembered in `localStorage`, as the validation queue does;
3. the activity calendar (full width);
4. the cards by state and the coming days, side by side on a computer;
5. progress by subject (full width);
6. the study settings (`StudyPreferences`), unchanged, in a closed disclosure at the bottom.

On a phone everything is one column, the band's ring and streak side by side above the sentence and the button.

States: while reading, a skeleton of the band and the panels at their final size (no layout jump); a failed read says «Non riesco a leggere i tuoi progressi.» with «Riprova», and keeps «Inizia il ripasso» usable, since the session reads its own data; a user with no review yet sees the ring at zero, the streak at 0 with «Il primo giorno comincia oggi», and the calendar empty with its scale.

### 6.3 Interaction

- **Calendar:** hovering a day, or tapping it on a phone, writes its details in a line under the calendar (a live region): «martedì 7 ottobre: 42 ripassi · 6 nuove · 3 sbagliate · obiettivo raggiunto». One tab stop; the arrow keys move by day and by week, Home/End to the first and last day. The SVG has a text alternative that says the range and the totals.
- **Cards by state:** a stacked bar; hovering or tapping a segment says its count and share.
- **Coming days:** bars with a light grid and two value lines; hovering or tapping a bar says the day and the count.
- **Subjects:** each row is a button that sets the filter (pressing the selected one clears it), `aria-pressed`.
- Every interactive mark is at least 44 px on a phone (a bar's hit area is its whole column).

### 6.4 The session

- When a grade's answer says `appenaRaggiunto` and this browser has not celebrated today, the celebration plays in a layer above the session header, never over the card or the grade bar, without moving focus; the keys keep working. Under reduced motion, a one-line status: «Obiettivo di oggi raggiunto · serie di 13 giorni».
- The end screen keeps its sentence and adds the ring and the streak as they are now.
- Back on the home after a celebration, the stamp is there at rest; the home plays the celebration itself only when the goal was met today and this browser has not celebrated today (a `localStorage` key per day: a per-browser convenience, never the source of the streak).

### 6.5 Accessibility

The ring and the badge have text alternatives («Obiettivo di oggi: 21 di 20 ripassi», «Serie: 13 giorni, record 27»). No information is carried by colour alone: the seven boxes differ by fill, outline and tick; the calendar's marks by shape. Contrast is checked in both themes. Every animation is behind `motion-safe:` or a `prefers-reduced-motion` check.

## 7. Security and privacy

- Session only; not in the delegated table, so no connected application can read a user's study history.
- Personal data: a user sees only their own; nothing in this round compares users or shows one user's activity to another.
- The stored days are personal: they cascade from the user, `GET /auth/export` carries them, and the trash leaves them alone (§5.1).

## 8. Seams for the next rounds

- **Levels:** the consolidated count per subject (§4.2, one named threshold) and the per-day record are what a level would be computed from; the band has room for a level badge left of the ring.
- **Daily challenges:** a slot above the band, empty in this round; a day's record can count kinds of activity other than reviews (cards written, cards validated) without changing what counts for the streak today.
- **Exam simulations:** the calendar's day detail is a list, so a simulation done that day can join it.

## 9. Testing

- **Server** (one suite at a time, its own test database): the progress route's shape; the Rome day in SQL against `romeDay` (23:59 and 00:01; a daylight-saving night both ways); the streak with today still open, a missed day under O2's rule, a broken streak, the best streak; the subject filter on each field and not on `oggi`/`serie`; the state split at the 21-day threshold; the forecast with overdue cards counted today; the grade's `appenaRaggiunto` on exactly one grade, and not on a second-of-the-day grade (`registrata: false`); an exchanged token refused; the stored day written by a grade (counters, `coda_finita`, `valido` with N) and by an empty-queue read (once); a changed N leaving past days as stored and today recomputed; the migration's backfill against a log built by hand; the migration drift check; the export key; the account deletion; a trash round trip that leaves the days untouched; `ripassiAlGiorno` in the preferences (bounds, default).
- **Web:** each chart's scale and readout (unit tests on the pure layout functions); the calendar's keyboard; the dashboard's loading, failure and empty states; the subject filter reaching the session's address; the celebration once per crossing and never under reduced motion (stubbed `matchMedia`); the session's keys unaffected while it plays.
- **Browser pass:** `http://localhost:5173`, a test account with some review history, desktop and phone widths, light and dark, reduced motion on and off.

## 10. The interview of 13 October

Questions 170–175, each with a recommendation; the owner's answer to all six: «ok come raccomandi». Recorded as decisions 7–12 in §3.

- **O1. What makes a day count?** (a) at least one review; (b) at least N reviews, N chosen by the user (default 10), or the whole day's queue finished when it held fewer than N; (c) the whole day's queue finished. **Taken: (b).**
- **O2. Does a missed day break the streak?** (a) yes; (b) one missed day in any seven keeps it, computed automatically; (c) freezes earned and spent. **Taken: (b);** (c) belongs with levels and challenges.
- **O3. What comes first on Studia's home?** **Taken:** the band, then the calendar, states, coming days, subjects, the settings closed at the bottom; no new tab.
- **O4. How much celebration?** **Taken:** once a day, when the goal closes; no sound; nothing during the cards; off under reduced motion.
- **O5. What counts?** **Taken:** only reviews.
- **O6. How far back does the calendar look?** **Taken:** 26 weeks on a computer, 12 on a phone.

O1 (b) needs the stored days (decision 13); the migration was announced to the orchestrator and named by it before it was written.
