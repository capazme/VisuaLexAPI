# Gymnasium restyle — a study area that reads like a path

Status: proposal, 19 October 2026, for the front-end owner's approval; the other owner has already
agreed to a restyle of the whole area (the review card included). Scope: `apps/web` and, for one phase
only, one read route on the server (§6, G5). Plan: phase G of
`docs/superpowers/plans/2026-10-18-redesign-inchiostro.md`.

Read first: the Studia screens spec (`2026-10-07-studia-cards-screens-design.md`) and the progress spec
(`2026-10-13-studia-progress-design.md`). This one does not repeat them; it changes how what they built
is **presented**, not what it does.

## 1. Why

The owners want the area to become as easy to use as a language-learning app such as Duolingo, and it is
not. The pieces of that kind of app are already here: a daily goal ring, a streak, a calendar, a
celebration once a day (progress spec, direction D «Registro vivo»). What is missing is the **order in
which they are given**.

What the code and the two specs say today (read on 19 October at `origin/develop`; **no screen was looked
at for this section**, see §9):

- The home of the area, `/studia/ripasso`, is a dashboard of six panels: the band (ring, streak, today's
  sentence, «Inizia il ripasso»), the subject chips, the activity calendar, the cards by state and the
  coming days, progress by subject, and the study settings at the bottom. The one action is one control
  among many things to read.
- The area mixes three jobs under one heading: **studying** (Ripasso), **writing** cards (Le mie schede)
  and **validating** cards (Da validare, for validators). A student who only wants to study meets the
  other two in the same sidebar.
- There is no sense of a road: nothing says where you are in a subject or what comes next. Levels and
  challenges were left out of the first round on purpose (progress spec §2).
- The review session shows the card, «Restano N» and «Interrompi», with the grade buttons pinned at the
  bottom on a phone; it has no progress bar and no frame of its own.

## 2. Direction

**Usability of a language-learning app, in the tone of «Registro vivo».** Four ideas, taken as
interaction patterns and nothing else:

1. **One thing to do now.** The home leads with a single large action and says what it costs.
2. **A road, not a report.** The subjects and, later, the institutes are stops you pass through, each
   showing where you stand; the statistics sit one level down.
3. **Short closed lessons.** The review session is a screen of its own with a bar that fills as cards are
   done, and a bar at the bottom that holds the one action available.
4. **Visible, calm rewards.** Streak and goal stay in view; the celebration stays once a day.

Not taken: any mascot, character, sound, name, colour scheme or illustration of any language-learning
product. The area has its own marks: the § badge, the stamp, the ink. Nothing in it is a copy.

Tone: the register of the area stays the lawyer's («Registro vivo»): serif numbers, the stamp, ink and
toga, the Gymnasium navy and seal red of the sections spec. Warmth comes from motion and feedback, not
from cartoon.

## 3. Rules that stay

- **The review logic does not change**: the queue (due first, then new), the keys (space, 1–4, Esc), a
  grade of «Di nuovo» sends the card to the back, the practice passes that are not recorded, the second
  key pressed between a post and the re-render, the days and the streak decided by the server. It has its
  own tests and they stay green, untouched.
- **Nothing slows the review** (progress spec decision 6): nothing taking focus, blocking a key or
  delaying the next card.
- Defaults for the review card unless the front-end owner agrees otherwise in the PR: the card's text in
  the reader's serif at a 60-character measure; one motion for the reveal; reduced motion honoured; the
  interval as the large text on the grade buttons; targets of 44 px.
- Routes, identifiers, the `VITE_FEATURE_STUDIA` flag and file names keep their `studia`/`lingo` names.
  The visible name is «Gymnasium» and the object is «scheda».
- Guardrails of the plan: root rule 23, 44 px, contrast test, reduced motion, no skipped test, Italian
  copy, `apps/web/CLAUDE.md` updated.

## 4. Information architecture

The sidebar of the Gymnasium section (the sections spec's S6) gets two groups. The routes of the existing
views do not move.

| Group | Entry | Route | What it is |
| --- | --- | --- | --- |
| Studia | **Oggi** | `/studia/ripasso` (as today) | the home: one action and the road (§5.1) |
| Studia | **Progressi** | `/studia/progressi` (new, web only) | calendar, cards by state, coming days, progress by subject (§5.3) |
| Contribuisci | **Le mie schede** | `/studia/schede` (as today) | write and manage your cards |
| Contribuisci | **Da validare** | `/studia/valida` (as today), validators only | the validation queue |

«Impostazioni di studio» (`StudyPreferences`, unchanged in content) leave the bottom of the home and open
from a gear in the header of **Oggi**, in a `ui/Sheet`.

## 5. The screens

Each screen is a free hand inside §3: the component names below are where the work lands, not a design
brief to copy. The look is Inchiostro (paper, ink, toga) with the Gymnasium hue.

### 5.1 Oggi (`ReviewHome`, `ProgressBand`)

From top to bottom, one column on a phone:

1. **A slim strip**, always the same: the streak (the § badge and the count) and the goal (a small ring,
   «5 di 10»). It is also what the other views of the area show above their content (a compact version),
   so the reward is never out of sight. The gear is at its end.
2. **The action**: a large card, «Oggi: 18 da ripassare, 8 nuove» and what it costs, «circa N minuti»
   (an estimate, `N = ceil(cards × 20 s / 60)`, a single constant in `studiaLabels.ts`, never a
   promise), and **«Inizia»**, the page's one primary button, 44 px, full width on a phone. When the goal
   is already met: the stamp of the day and «Continua» (more cards if any are left), else «Hai finito per
   oggi» with the next due day.
3. **«Cosa ripassi»**: the subject chips (`SubjectChips`), unchanged in behaviour (they narrow the session
   and, now, the road).
4. **The road** (§5.2).

States as in the progress spec §6.2: a skeleton at the final size while reading; a failed read says «Non
riesco a leggere i tuoi progressi.» with «Riprova» and keeps «Inizia» usable; a first-time user sees the
ring at zero, the streak at 0 with «Il primo giorno comincia oggi», and a road with nothing started.

### 5.2 The road

**Stops are free: no locks, no unlocking.** Every stop can be opened at any time; no order of subjects or
institutes is imposed (that would be a decision about content, not about layout).

- **From the first PR (web only):** one stop per **subject**, from `Progressi.materie` (new, in learning,
  consolidated, and the reviews of the last 30 days). A stop shows its name, a bar of the three states,
  «N da ripassare», and a button «Ripassa» that starts a session narrowed to that subject. The stops are
  ordered by what needs attention first (most due), then by name.
- **Later, with the server read of G5:** inside a subject, one stop per **institute**
  («Risoluzione per inadempimento»), with the same bar and «N da ripassare», sorted by the same rule.

The road is drawn as a vertical path of stops joined by a line in the section hue; on a computer it may
sit beside the action card. Stops are buttons (`aria-pressed` where they filter), the state is also
written in words, never by colour alone.

### 5.3 Progressi

A page of its own, `/studia/progressi`, holding what the home no longer shows: the activity calendar, the
cards by state and the coming days, and the full progress by subject. The components exist
(`ActivityCalendar`, `CardStatesBar`, `DueForecast`, `SubjectProgress`) and keep their behaviour,
interaction and accessibility (progress spec §6.3, §6.5); they are restyled, not rewritten.

### 5.4 Lezione (`ReviewSession`)

The session becomes a screen of its own:

- **Top**: a close button (the existing «Interrompi il ripasso?» confirmation, same key Esc), and a
  **progress bar** that fills as cards are graded, `done / (done + remaining)`. The bar advances with an
  eased transition on the card's grade; under reduced motion it jumps. «Restano N» stays as the text for
  screen readers.
- **The card**: free restyle inside §3; the anchor's citation small above; the anchors still open the
  article in a side panel on a computer and in `ui/Sheet` on a phone.
- **Bottom**: the bar pinned at the foot on every width, holding the one action available: «Mostra
  risposta» before the reveal (space), the four grades with their intervals after it (1–4). It keeps the
  `pinnedBar` band and the phone rules.
- **After a grade**: a one-line note beside the bar, «Torna tra 3 giorni» (from `anteprima`), on screen
  about a second, never blocking and never taking focus. «Di nuovo»: «Torna in coda».
- **The lesson frame**: the area's sidebar and its floating buttons are out of the way while the lesson
  runs. The executor uses what the shell already offers (the focus mode) if it does that; otherwise a
  page-level frame inside `StudiaPage`. `Layout.tsx` is not touched without reserving it in the register,
  and the PR says which way was taken.
- **The end**: the sentence («Hai ripassato 23 schede, 4 da rifare. Le prossime: domani.»), the ring and
  the streak as now, and two buttons: «Torna a Oggi» and, if cards are left, «Continua».
- The celebration (progress spec §6.4) is kept as it is: once a day, 1.5 s, beside the card, never on top.

### 5.5 Contribuisci: Le mie schede, Da validare, the reader's row

Same logic, same routes, restyled with the shared tokens and the Gymnasium hue; their copy and states do
not change. The row «Schede su questo articolo (n) · + Nuova scheda» in the reader and its peek follow the
reader's quieter look. The validation vote bar keeps its three votes and the required reason.

## 6. Phases

Each is one PR into `develop`, web only except G5, behind no flag. The first four stack on each other in
this order; G5 waits for a decision.

| # | Phase | Main files |
| --- | --- | --- |
| G1 | The sidebar's two groups; **Oggi** (strip, action card, subject chips, subject stops); the settings in a sheet; the empty and failed states | `features/sections/sections.ts`, `ReviewHome.tsx`, `progress/ProgressBand.tsx`, `progress/SubjectChips.tsx`, `progress/SubjectProgress.tsx`, `StudyPreferences.tsx`, `StudiaPage.tsx`, `App.tsx` (the new route) |
| G2 | **Lezione**: the frame, the progress bar, the bottom bar, the note after a grade, the end screen; the same PR rewrites §6 of the Studia screens spec and the review-card sentence of `apps/web/CLAUDE.md` | `ReviewSession.tsx`, `ReviewCard.tsx`, `GradeBar.tsx`, `progress/SessionEndProgress.tsx`, `useReviewSession.ts` (read only unless a test says otherwise) |
| G3 | **Progressi**: the page and the restyle of its four components | `progress/*` |
| G4 | **Contribuisci**: Le mie schede, Da validare, the reader's row | `MyCardsView.tsx`, `CardGroups.tsx`, `CardFilters.tsx`, `CardDetail.tsx`, `ValidationQueueView.tsx`, `VoteBar.tsx`, `ArticleCardsRow.tsx`, `ArticleCardsPeek.tsx` |
| G5 | **Institute stops** (needs a server read, below) | `ReviewHome.tsx`, a new `progress/InstituteStops.tsx`, the server |

**G5, the one server change.** The progress read carries counts by subject, not by institute, and the
list of one's cards leaves out the community cards that are in the user's review. The road by institute
needs one read, `GET /lingo/srs/percorso?materia=…`, answering for the cards in the user's review scope:
`[{ istituto, nuove, apprendimento, consolidate, dovute }]`, Rome days, the same scope rules as the
session. It is the back-end owner's to design and implement (no migration expected: a query over the
tables of the review); the web phase starts after it is on `develop`. Until then the road stops at the
subject.

## 7. Motion, within the Inchiostro budget

- **Lesson**: the progress bar fill, the card's entrance (opacity and a few pixels of translation, 180 ms,
  `--ease-out`), the grade's press (`active:scale-[0.97]`), the note after a grade. Nothing else moves
  between a grade and the next card.
- **Oggi**: the ring fills once on entry; stops enter with a 40 ms stagger, once per mount.
- **Rewards**: the celebration is kept; the streak badge's slow breathing stays `motion-safe:`.
- Reduced motion: only the end states are drawn. No sound.

## 8. Open decisions

1. The estimate of a lesson's length: 20 seconds a card, a guess. Replace it with the user's own average
   once the server can give it.
2. The institute road (G5): the back-end owner's design of the read route, and whether it ships with 1.9.
3. A checkpoint every 10 cards, a short pause with the count: **not in this spec**, because the queue and
   the rule that nothing is added between a grade and the next card stay as they are. If wanted, it is a
   separate decision.
4. «Contribuisci» as the group's name; alternatives «Scrivi e valida», «Comunità».

## 9. What was not verified

This was written from the specs, the types (`types/studia.ts`) and the component sources, not from the
running screens. Before G1 starts, the front-end owner's session checks at 1366 and 390 px, light and
dark: how the home reads today (the length of the page, what sits above the fold), how the session looks
on a phone, what the Gymnasium sidebar holds, and what the focus mode hides; and corrects this spec where
it is wrong.

## 10. Testing

Per phase: the existing tests of the touched components pass unchanged where behaviour is unchanged; new
tests for what is new (the stops and their ordering, the estimate, the progress bar's value and its
reduced-motion path, the sidebar's groups and the `/studia/progressi` route, the note after a grade); the
review logic's tests are not edited. `break-ui` on Oggi and the lesson with long Italian labels, a
subject with no cards and one with hundreds.
