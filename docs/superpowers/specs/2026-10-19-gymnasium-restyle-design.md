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

What the code, the two specs and the running screens say today (read on 19 October at `origin/develop`;
the screens were looked at on a local stack at 1366 and 390 px, see §9 for what that does and does not
cover):

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

Seen on the screens:

- **The navigation is a rail of icons with no visible words.** At 1366 px the sidebar is a narrow strip:
  Ricerca, Analizza documento, Ripasso, Le mie schede, Dossier, each only an icon (the names are only
  accessible names). The two Gymnasium entries sit among the app-wide ones. This stack serves an older
  branch than `develop` (the sections work), so the rail must be checked again on `develop`.
- **With data, the home's first screen is the calendar.** The band (ring, streak, «Oggi: 12 da ripassare ·
  8 nuove», «Inizia il ripasso») is good and clear, but the 26-week calendar fills the rest of the first
  screen; cards by state, coming days, progress by subject and the settings are below it.
- **A new user meets a dead page**: a disabled button, «Non hai ancora schede da ripassare», and an empty
  calendar grid as large as a full one. The way out it points to, «Le mie schede», says «Nessuna scheda
  ancora. Aprine una da un articolo con «+ Nuova scheda»…» (the wording «Aprine» also reads oddly): **there
  is no way to write a card from inside the area**, only from an article in the reader or through Claude.
- **The lesson is bare.** On a computer: the page heading «VisuaLex Gymnasium» stays, then a small grey
  «Restano 3» and a text link «Interrompi», the question in serif, and a half-width «Mostra risposta
  Spazio» button; after the reveal the answer, a «Spiegazione» label and four small outlined grade tiles
  left-aligned under the text. The rest of the page is empty, the sidebar stays, there is no progress bar,
  and the grades are not pinned. On a phone the action bar is pinned at the foot, which works, with the
  menu button above the heading.

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
| Studia | **Progressi** | `/studia/progressi` (new, web only, with G3; no entry until then) | calendar, cards by state, coming days, progress by subject (§5.3) |
| Contribuisci | **Le mie schede** | `/studia/schede` (as today) | write and manage your cards |
| Contribuisci | **Da validare** | `/studia/valida` (as today), validators only | the validation queue |

The entries carry visible words, not only icons. *Corrected on 19 October:* `develop` drew the rail as
icons alone at every width (the label only on hover from `md`, none on a phone), and the front-end owner
decided for words. They come in a phase of their own before G1, **G0** (§6): from `xl` a wide bar
(224 px) with icon and word, grouped by section, the groups named; between `lg` and `xl` the 64 px rail of
icons, labelled on hover and keyboard focus; on a phone the drawer, icon and word in rows of 44 px; from
`xl` a control narrows the bar to the rail and widens it again, remembered in the browser, wide by
default. The accessible names, the tours' ids and the badges stay. In Gymnasium the dossiers sit in
«Studia», after Oggi.

«Impostazioni di studio» (`StudyPreferences`, unchanged in content) leave the bottom of the home and open
from a gear in the header of **Oggi**, in a `ui/Sheet`.

## 5. The screens

Each screen is a free hand inside §3: the component names below are where the work lands, not a design
brief to copy. The look is Inchiostro (paper, ink, toga) with the Gymnasium hue.

### 5.1 Oggi (`ReviewHome`)

*Rewritten on 19 October for G1b.* G1 built Oggi as a strip, one action card, the chips, the road and the
progress panels at the bottom. The front-end owner then fixed the order of the page — «1. prossime
missioni; 2. Stats; 3. elenco completo delle missioni» — and asked for the progress to be drawn again from
scratch, in one type language with the rest of Inchiostro. From top to bottom, one column at every width:

0. **The heading** of the area: «Gymnasium: la tua palestra giuridica» (the short name «Gymnasium» stays
   in the section switcher).
1. **Today's missions**, «Le missioni di oggi», one under the other, each with its mark (done or not),
   its progress («8 di 18») and an action, and a summary «2 di 3». The first, «Ripassa le schede
   dovute», carries what is on today («Oggi: 18 da ripassare, 8 nuove»), what it costs («circa N
   minuti», `N = ceil(cards × 20 s / 60)`, a single constant in `studiaLabels.ts`, never a promise) and
   **«Inizia»**, the page's one primary button, 44 px, full width on a phone («Continua» once the goal is
   met; «Hai finito per oggi» with the next due day when nothing is left). The other two open the study
   settings that set their target. The missions are **computed by the web** from what the progress read
   already carries — a pure function in `studia/missions/`, so that only its source changes when the
   server records missions:
   - «Ripassa le schede dovute»: the due cards reviewed today (today's reviews less today's first
     reviews, from the calendar's row of today) of those plus the ones still due (`oggi.dovute`);
   - «Impara 5 schede nuove»: today's first reviews, of five — or of what today allows, when the daily
     quota of new cards or the cards left make five impossible;
   - «Raggiungi l'obiettivo di oggi»: `oggi.ripassi` of `oggi.obiettivo`, done when the server says the
     day counts (`raggiunto`).

   A mission with nothing to do today (no card due, no new card) says so and leaves the summary. The
   missions are the whole day's, whatever subject is chosen below: the subject narrows only the action of
   the first («Oggi in Diritto penale: …») and the session it starts.
2. **The statistics**, one band under the heading «I tuoi progressi»: the streak (the § badge, the count,
   the record), the goal (a small ring, «5 di 10»), the gear of the study settings, **the current week**
   (seven boxes, Monday to Sunday, each with its letter: done, a rest, missed, today, or still to come),
   and under them three large numbers in Newsreader — new, in learning, consolidated — with their bar.
   The long calendar and «Prossimi 14 giorni» leave the page: a button «Il tuo mese» opens them in a
   sheet (until G3 gives them `/studia/progressi`).
3. **The full list of missions**, «Tutte le missioni»: daily, weekly and long-term. Those the web can count
   show their state; those that need the server to record them (writing a card, validating, a case, a
   week of streak) are listed with «In arrivo» and cannot be ticked. **No experience points and no level**
   are shown until the server keeps them: a count in the browser would be lost on another device and could
   be forged.
4. **«Cosa ripassi»** (the subject chips, unchanged in behaviour) and **the road** (§5.2), as G1 left them.

One type language: block headings in Newsreader, labels in Geist; no small capitals and no double rule.
The empty states are drawn, not left as empty grids: a first-time user reads «Il primo giorno comincia
oggi» in the band and a week with nothing missed; a user with no card is told how to begin from an
article; a failed read says «Non riesco a leggere i tuoi progressi.» with «Riprova» and keeps «Inizia»
usable; while the first read travels everything holds its final size.

### 5.2 The road

**Stops are free: no locks, no unlocking.** Every stop can be opened at any time; no order of subjects or
institutes is imposed (that would be a decision about content, not about layout).

- **From the first PR (web only):** one stop per **subject**, from `Progressi.materie` (new, in learning,
  consolidated, and the reviews of the last 30 days). A stop shows its name, a bar of the three states
  (also in words), the reviews of the last 30 days, and a button «Ripassa» that starts a session
  narrowed to that subject. The stops are ordered by the cards still open, new plus in learning, most
  first, then by name. *Corrected on 19 October:* this section first said each stop shows «N da
  ripassare» and the stops sort by most due; the progress read cannot give that — `Progressi.materie`
  (`types/studia.ts`) carries per subject only `nuove`, `apprendimento`, `consolidate` and `ripassi30`,
  and the cards due exist only as the day's total (`oggi.dovute`).
- **Later, with the server read of G5:** «N da ripassare» per subject and per institute; inside a subject,
  one stop per **institute** («Risoluzione per inadempimento»), with the same bar and «N da ripassare»,
  sorted by the cards due first.

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
not change, except one addition and one correction. **Addition:** a «+ Nuova scheda» in the page header of
Le mie schede and as the action of its empty state, opening the existing card form with the anchors typed
as references («art. 1455 c.c.»), as the form's «+ Ancora» already allows; today a card can only start from
an article or from Claude (see §8, point 5). **Correction:** the empty state's sentence is rewritten. The row «Schede su questo articolo (n) · + Nuova scheda» in the reader and its peek follow the
reader's quieter look. The validation vote bar keeps its three votes and the required reason.

## 6. Phases

Each is one PR into `develop`, web only except G5, behind no flag. G0 and G1 touch different files and
branch from `develop` side by side; G2–G4 follow in this order; G5 waits for a decision.

| # | Phase | Main files |
| --- | --- | --- |
| G0 | The sidebar's words (§4): the wide bar from `xl`, the rail between `lg` and `xl`, the drawer's rows, the narrow/widen control; Gymnasium's two groups | `Sidebar.tsx`, `Layout.tsx`, `SectionSwitcher.tsx` |
| G1 | **Oggi** (strip, action card, subject chips, subject stops by the three states — no «N da ripassare» per subject until G5); the settings in a sheet; the empty and failed states; the progress panels kept at the bottom under «I tuoi progressi» until G3 gives them their page. **G1b**, stacked on G1, sets the order the owner fixed (§5.1): the heading with its phrase; today's missions, computed in the web, «Inizia» on the first; the statistics band (streak, goal, the current week, three numbers) with «Il tuo mese» in a sheet; the full list, «In arrivo» where the server must record; then the chips and the road; no points or levels until the server keeps them | `ReviewHome.tsx`, `missions/*`, `progress/StatsBand.tsx`, `progress/MonthSheet.tsx`, `progress/SubjectChips.tsx`, `progress/SubjectRoad.tsx`, `StudyPreferences.tsx`, `StudiaPage.tsx` |
| G2 | **Lezione**: the frame, the progress bar, the bottom bar, the note after a grade, the end screen; the same PR rewrites §6 of the Studia screens spec and the review-card sentence of `apps/web/CLAUDE.md` | `ReviewSession.tsx`, `ReviewCard.tsx`, `GradeBar.tsx`, `progress/SessionEndProgress.tsx`, `useReviewSession.ts` (read only unless a test says otherwise) |
| G3 | **Progressi**: the page and the restyle of its four components | `progress/*` |
| G4 | **Contribuisci**: Le mie schede, Da validare, the reader's row; a «+ Nuova scheda» inside Le mie schede and in its empty state (§5.5) | `MyCardsView.tsx`, `CardGroups.tsx`, `CardFilters.tsx`, `CardDetail.tsx`, `ValidationQueueView.tsx`, `VoteBar.tsx`, `ArticleCardsRow.tsx`, `ArticleCardsPeek.tsx` |
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
5. A way to write a card from inside the area. The Studia screens spec (decision 4) describes the form
   as opened from an article, with the article as primary anchor. Opening it from Le mie schede with a
   typed anchor needs the server to accept a card whose only anchor was typed (the form's «+ Ancora»
   suggests it does); the executor checks that the route allows it before building the button, and says so
   in the PR. If it does not, the empty state says how to start from an article and nothing else changes.

## 9. What was verified, and what was not

**Looked at (19 October):** the home with and without data, «Le mie schede» empty, the lesson up to the
grades, at 1366 px, and the lesson on a phone at 390 px, on a local development stack in light mode.

**Limits of that look.**
- The stack serves the sections branch, older than `develop`; the sidebar in particular may differ.
- The test account has no cards and the card sources were unreachable, so no card could be created. The
  screens with data (home, lesson) were drawn from **simulated answers of the three study routes**, held
  in the browser only; nothing was written to the database. Real data may lay out differently (long
  questions, many anchors, long institute names).
- Not seen: dark mode, the lesson's end screen and celebration, «Da validare», the card form and detail,
  the settings, the reader's row, a long list of cards, 390 px for the home.
- No anchor line was seen above the question in the lesson; the simulated cards may be the reason.

Before G1 starts, the front-end owner's session repeats the look on `develop` with real cards, covers the
points above, and corrects this spec where it is wrong.

## 10. Testing

Per phase: the existing tests of the touched components pass unchanged where behaviour is unchanged; new
tests for what is new (the stops and their ordering, the estimate, the progress bar's value and its
reduced-motion path, the sidebar's groups and the `/studia/progressi` route, the note after a grade); the
review logic's tests are not edited. `break-ui` on Oggi and the lesson with long Italian labels, a
subject with no cards and one with hundreds.
