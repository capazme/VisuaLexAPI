# Changelog

What changed in VisuaLex, release by release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), grouped by area
rather than by kind of change: a reader looks for what moved in the part they
use. Versions and the release steps are in `docs/git-workflow.md`.

Each section is written from the merge titles of its release
(`sh scripts/release-notes.sh <previous tag> origin/develop`), when the
release is prepared. The GitHub release
carries, beside it, a short note in Italian for the people who use VisuaLex.

## [Unreleased]

## [1.72.0] - 2026-11-28

Administrative decisions open again, faster collectors, provincial laws and a dossier's entries in one request.
No migration, no cache to clear. MERL-T stays off. The desktop app's work (#757 and after) is not in it.

Pins: lexcraft-web v1.72.0 (the note), lexcraft-mcp v1.70.0, lexcraft-contracts 2927be88 (1.71.0).

### Features

- A dossier's entries in one request, the caps applied once (G-595) (#748).
- The core accepts an older contract of the same major when its own only adds to it (G-607…G-611) (#765).

### Fixes

- Administrative decisions (Consiglio di Stato, CGARS, TAR) open without text, with references, ECLI, date and
  the source link, instead of a 503 (T134) (#768).
- A law of the Province of Trento or Bolzano is never read as a State law (G-577) (#742).
- The article tests never reach Normattiva (#746).

### Performance

- Concurrent identical reads share one fetch (#769); a stored Normattiva page is read once (#770); an EU article
  is extracted once (#771); one queue per source, Normattiva at 3 (G-647) (#773); a cold page is parsed off the
  event loop (#774); the act's tree comes from the article's own page (G-646) (#775). Measurement tools (#767).

### Documentation

- The desktop app's local mode: design and M1 plan (#756).

## [1.71.0] - 2026-11-23

The first release after the repository split (G-596): the web app, the MCP server and the contract live in
repositories of their own and the core pins them. Nothing changes for the user. No migration. MERL-T stays off.

Pins: lexcraft-web v1.71.0, lexcraft-mcp v1.70.0, lexcraft-contracts 5fb3c15.

### Work

- The core drops `apps/web`, `apps/mcp` and `conventions` and mounts them as submodules of LexCraft-IT/lexcraft-web,
  lexcraft-mcp and lexcraft-contracts (#751).
- `vendor/mcp-legal-it` is fetched from LexCraft-IT; the pinned commit is unchanged (#752).

## [1.70.0] - 2026-11-22

Trial release before the repository split (G-600): the contracts between core, web and mcp, and a deploy ready for
submodules. Nothing changes for the user. No migration. MERL-T stays off.

### Work

- The values the web copies from the core are pinned as a contract (#743).
- Rule 23 is checked across repositories, from `conventions/` (#744).
- One list of Python paths for Vite and the ingress (#745).
- The release note check and the deploy are ready for submodules: the deploy initialises and checks each one,
  `start.sh` takes `LEXCRAFT_WEB_DIR` and `LEXCRAFT_MCP_DIR` (#747).

## [1.69.0] - 2026-11-21

The Pratiche sort menu as a plain menu with short options, readable in light and dark. Web only, no migration.
MERL-T stays off.

### Work

- The sort menu is a plain menu again, with short options that fit on a phone: «Più recenti», «Nome A–Z»,
  «Creazione», «Elementi»; the text no longer overlaps in the dark theme (LC150).

## [1.68.0] - 2026-11-21

The Pratiche sort menu reads in full on a phone. Web only, no migration. MERL-T stays off.

### Work

- The closed sort menu shows a short name (Recenti, Nome, Creazione, Elementi); the open list and the screen
  reader keep the full text (LC149).

## [1.67.0] - 2026-11-21

Two touch-ups to the Pratiche list. Web only, no migration. MERL-T stays off.

### Work

- On a phone the sort menu shows «Ultimo aggiornamento» in full; the Categoria column is left out when no pratica
  has a category, with a dash when only some do (LC148).

## [1.66.0] - 2026-11-21

Pratiche as cards or as a list, with sorting. Web only, no migration. MERL-T stays off.

### Work

- «Schede / Lista»: the Pratiche page shows cards or a list with one row per pratica (name, category, entries,
  last update, «⋯»); the choice is remembered (LC147).
- «Ordina le pratiche»: last update (by default), name, creation date, number of entries; pinned pratiche always
  first, those without a date last. «Last update» is the latest of the creation and the last entry added.

## [1.65.0] - 2026-11-21

No more focus rings: fields show focus by a darker border, and the other controls draw a thin outline only for
the keyboard. Web only, no migration. MERL-T stays off.

### Interface

- Fields show focus by their border alone, one step darker, with no ring or halo; buttons, links, tabs and rows
  draw nothing with the mouse and a 1.5 px grey outline with the keyboard (LC146).

## [1.64.0] - 2026-11-20

Seven touch-ups collected on 19 November. Web only, no migration. MERL-T stays off.

### Interface

- The reader's island is measured, so it never covers the text it belongs to.
- «Prendi» is off while a name conflict is open.
- The Forum spaces keep what was typed when another space takes their place, and forget it when the session ends.
- The chronology stands in a box; lists with a moving tab stop show the ring on the row reached with the keyboard.
- Progressi no longer grows its bars on every visit (LC145).

## [1.63.0] - 2026-11-19

In the reader, the annotations and the actions of a selection open under the paragraph, and citation previews
are text only. Web only, no migration. MERL-T stays off.

### Reading

- The block annotations and the actions of a selection open under the paragraph they belong to; in long
  paragraphs and low windows the island follows the selection (LC142, L-73).
- Citation previews on hover show the text only; the NER feedback bar for contributors is no longer there, queued
  for MERL-T (LC142).

### Tests

- The DecisionEntryView test waits for its effects, no longer flaky (LC144).

## [1.62.0] - 2026-11-19

No focus ring around titles and landing points: the ring stays on the controls you reach with the keyboard. Web
only, no migration. MERL-T stays off.

### Interface

- Titles, spaces, paragraphs and notices that receive the focus after a change of page no longer show a ring; the
  ring stays on buttons, fields and links reached with the keyboard (LC143).

## [1.61.0] - 2026-11-19

«Dicci cosa ti serve» in the top bar, and the reading bar's and the Forum suggestions' windows inside the page.
Web only, no migration. MERL-T stays off.

### Interface

- «Dicci cosa ti serve» in the top bar, on the right, as Luca asked (LC141).

### Reading

- Five windows of the reading bar open in the page flow; a day the article did not exist on keeps the reader's
  place, with «Vai al testo attuale»; on a phone Note and Evidenziazioni open from «⋯» (LC139, L-73).

### Forum

- The Forum suggestions open in the page flow; a name already taken offers another (LC140).

## [1.60.0] - 2026-11-19

Two to-do lists, one for Work and one for Learn, and the Forum's windows inside the page. Web only, no
migration. MERL-T stays off.

### Work and Learn

- Two to-do lists: Work's «Attività» and Learn's own, each with its path in the top bar; in the quick add, Enter
  takes the first «#» suggestion (LC130, part 2).

### Forum

- Six Forum windows open in the page flow, one at a time, «Pubblica» and «Recupera» included (LC138, L-73).

## [1.59.0] - 2026-11-19

The chronology of the facts in a work dossier, and no notifications timer left running after a test. Web only, no
migration. MERL-T stays off.

### Work

- «Cronologia» in a work dossier: the facts in date order, each row opens it in the dossier, and one button
  flips the order (LC137, P4).

### Tests

- No notifications timer outlives a test (LC136).

## [1.58.0] - 2026-11-19

Five motion touch-ups after the common timings, and the arrows in Fonti. Web only, no migration. MERL-T stays off.

### Interface

- Five touch-ups to the motion after the common timings; the Learn page is preloaded like the other main pages
  (LC133).
- The arrows in Fonti move as the rest of the app (LC133).
- Where the browser has no idle callback (Safari), the search band is drawn after a second instead of 200 ms, so a
  cold boot is not slowed (LC135).

## [1.57.0] - 2026-11-19

Common motion timings across the app, and a rule on how often something may move. Web only, no migration.
MERL-T stays off.

### Interface

- The animations share the same timings, and a frequency rule keeps motion for what happens rarely (LC132).

## [1.56.0] - 2026-11-19

«Accedi» without a flash or a jump, and the animations that did not help removed. Web only, no migration.
MERL-T stays off.

### Interface

- «Accedi» opens without a flash or a jump; with a saved session the form stays usable while the session is
  checked (LC131).
- The animations that did not help are removed (LC129).

## [1.55.0] - 2026-11-19

«Scadenze» becomes «Attività», and the change of page never shows two pages at once. Web only, no migration.
MERL-T stays off.

### Work

- «Scadenze» becomes «Attività», with the title above the views (LC130, part 1).

### Interface

- The change of page never draws two pages at once; after «Indietro» or Esc the focus goes to the page title
  (LC127).

## [1.54.0] - 2026-11-19

A light transition at every change of page, the last windows of Pratiche inside the page, and steadier tests.
Web only, no migration. MERL-T stays off.

### Interface

- A minimal transition at every change of page, as Luca asked (LC126).

### Work

- The last windows of Pratiche open inside the page (LC125, L-73).

### Tests

- Three flaky tests made steady; the import panel moves its focus and its leave warning in the same commit that
  draws them (LC122).

## [1.53.0] - 2026-11-19

The PDF of an act opens inside the page. Web only, no migration. MERL-T stays off.

### Work

- The PDF of an act opens in a space inside the page, no longer in a separate window (LC124).

## [1.52.0] - 2026-11-19

Two saved versions of a dossier side by side, and loading placeholders shaped like the content. Web only, no
migration. MERL-T stays off.

### Work

- Compare two snapshots of a dossier: «Da» and «A», a count of what came in, went out or changed, and one row per
  entry, in a space inside the page (LC121).

### Interface

- While a page loads, its placeholders have the shape of the content that will appear (LC120).

## [1.51.0] - 2026-11-19

The interface alignment is complete: a global guard keeps the pages on the common controls, and the common
components take their radius and motion from one source. Web only, no migration. MERL-T stays off.

### Interface

- A global guard checks that no page goes back to its own controls, styles or timings (LC118, alignment 14 of 14).
- The common components take their corner radius and their animation timings from the shared tokens (LC119).

## [1.50.0] - 2026-11-19

The rest of the app on the common controls of the interface alignment. Web only, no migration. MERL-T stays
off.

### Interface

- The pages not yet aligned use the common controls; small buttons are 32 px, or 44 px on a phone (LC117,
  alignment 13 of 14).

## [1.49.0] - 2026-11-19

Sign-in, the connection of apps, Impostazioni and Amministrazione on the common controls of the interface
alignment, and a theme that can follow the device. Web only, no migration. MERL-T stays off.

### Interface

- Sign-in and the connection of an app use the common controls; the fields have a new dark surface across the
  app (LC116, alignment 12 of 14).
- Impostazioni and Amministrazione use the common controls, with the common back link and confirmation across
  the app (LC115, alignment 10 of 14).
- The theme is «Chiaro», «Scuro» or «Di sistema», which follows the device (LC115).

## [1.48.0] - 2026-11-19

The Forum on the common controls of the interface alignment. Web only, no migration. MERL-T stays off.

### Forum

- The Forum uses the common controls (LC114, alignment 9 of 14).

### Interface

- The small segmented tabs are 44 px tall on a phone across the app (LC114).

## [1.47.0] - 2026-11-19

The search and the reader on the common controls of the interface alignment. Web only, no migration. MERL-T
stays off.

### Search and reading

- The search and the reader use the common controls (LC113, alignment 8 of 14).

## [1.46.0] - 2026-11-19

Learn on the common controls of the interface alignment, with the new card written inside the page. Web only,
no migration. MERL-T stays off.

### Learn

- Learn on the common controls; «Nuova scheda» opens inside the page instead of over it (LC112, alignment 7 of 14).

## [1.45.0] - 2026-11-19

Opus (Work) on the common controls of the interface alignment, with its finishing touches. Web only, no
migration. MERL-T stays off.

### Work

- Opus on the common controls: «Aggiungi» and «Dettagli» at 44x44 px on a phone (LC110).
- The view tabs at 13 px on a computer; «Aggiungi un compito» on the fields' surface, and the focus stays in the
  field after adding, so the next task can be typed at once; the date of «Testo a una data» is a common field
  (LC111).

## [1.44.0] - 2026-11-18

The fiscal testi unici follow the date, regional laws are never read as state laws, and «Modifica pratica» and
«Importa» open inside the page, with an import that keeps the pace of the server's limit. No migration.
MERL-T stays off.

### Sources

- «tuir», «tur» and «tuiva» lead to the old text until 31/12/2026 and to the new testo unico (annex 1) from
  1/1/2027, with a notice; «tua» asks which of the two acts; regional laws are refused, never read as state
  laws (G-577, #647 in the API, #650 in the web).

### Work

- «Modifica pratica» and «Importa una pratica» open inside the page; the import keeps the pace of the write
  limit and offers «Riprendi» after a refusal or a dropped connection, saying what is not imported yet (LC107).

### Tests

- The StudiaPage test of the strip's settings waits for the panel to open (LC108).

## [1.43.0] - 2026-11-18

Pratiche on the common controls, caps on dossiers, and MERL-T's last security fixes before it can come back on:
zero-retention models, logs without people's words, and no port of its own on the host. No migration.
MERL-T stays off.

### Work

- Pratiche on the common controls, with the order as a choice in a row (LC106, alignment 5 of 14).

### Server

- Caps on dossiers: 500 per account, 2,000 entries each, 10,000 entries in all; a refusal says the limit in
  Italian (G-576, #644).

### MERL-T

- The default models have a zero-retention provider; 53 stale model ids removed (G-575, #642).
- Logs carry lengths, never a person's text, a model's text or a provider's raw error (#627).

### Infrastructure

- In production MERL-T's port and mcp-legal-it's are not published on the host; the ingress refuses MERL-T's
  internal callbacks (#625, #643).

## [1.42.0] - 2026-11-18

Two more parts of the interface alignment: common switches, back links, text areas and cards, and one way for
tabs and rows that open. Web only, no migration.

### Interface

- Common Switch, BackLink, Textarea and one Card across the app (LC104, alignment 2 of 14).
- Tabs and rows that open work the same everywhere: one SegmentedTabs, a link version, Collapsible
  (LC105, alignment 3 of 14).

## [1.41.0] - 2026-11-18

The «⋯» menus fade in under their trigger, as Luca chose (variant A), across the app. Web only, no migration.

### Interface

- The «⋯» menus fade in under the button that opens them (LC102, variant A).
- The «⋯» of Cronologia and Forum use the same menu; no «⋯» opens an empty menu (LC103).

## [1.40.0] - 2026-11-18

Loading and a change of view with one movement, «Novità» with the rule of the notifications, steadier tests,
and MERL-T behind its key on every route. No migration. MERL-T stays off.

### Interface

- Loading and a change of view move with one movement in Pratiche, Learn and Opus (LC98, alignment 4 of 14).
- «Novità» stands above the bottom bar and follows the same rule as the notifications (LC101).

### MERL-T

- Every route needs the key, except /health and /; no key route, no websocket, no API pages in production
  (#623). MERL-T stays off until G-575.

### Tests

- Two flaky focus tests made steady, ReportProblemSection and MyCardsView (LC100).

## [1.39.0] - 2026-11-18

EU acts before 2015 cited in the Official Journal's form, the first shared components of the interface
alignment, and a round of security and clean-up on the server, the Python API and MERL-T. No migration.
MERL-T stays off.

### Sources

- EU acts before 2015 are cited as the Official Journal numbered them, «dir. 95/46/CE»,
  «reg. (CE) n. 1907/2006», in the web, the server and the API (G-540, #581, #617).

### Interface

- Shared components with one language, the first of the alignment's fourteen parts (LC97).

### Server

- Failed password checks count per account too, from any address, and a wrong password at password change or
  account deletion counts as a failed attempt (#620, #602).
- «Togli i miei contributi»: one call that removes what a person wrote for others (G-558, #601); an author
  removes a validated card, a validator erases a vote's reason (G-556, G-557, #600).
- The server survives an error nobody caught; free-text fields have a length limit (#598).
- A Forum suggestion item is taken, declined or revoked once (#609).

### Python API

- At most two browsers at once for EUR-Lex; the rest wait, then retry (#596).
- Every redirect the scrapers follow is checked against the allow-list first (#610).
- The old global /history and /dossiers, the unused twin server and the code nothing called are gone
  (#611, #612, #618, #621).

### MERL-T

- Every call to a language model refuses providers that keep or train on the text (#622); a key MERL-T refuses
  is the server's 503, never the user's 401 (#624). MERL-T stays off until G-575.

## [1.38.0] - 2026-11-18

The search island in the flow, glosses at the height of their words, Amministrazione as a page inside the
app and «Segnala un problema» next to Impostazioni. Web only: no server change, no migration.

### Search

- The search island opens in the flow of the page, without a veil over the content (LC87, L-75); after a
  choice the focus goes to the new page's title, and closing without a choice leaves it where it was (LC94).

### Reading

- The glosses on a passage stand at the height of their words (LC90, part 2 of 3).

### Interface

- Amministrazione is a page inside the app, like Impostazioni, in one page with an index (LC93).
- «Commenti» becomes «Segnala un problema», next to Impostazioni; the Settings index in four groups (LC92).
- A round of small fixes on Scadenze, Learn and the dossier (LC91).

### Notes

- The body of the merge commit of #607 (df29f57f) carries by mistake the text of #605; #607 is LC92.

## [1.37.0] - 2026-11-18

Fonti with a filter and a selection, a Learn card deleted with an undo instead of a confirmation, and the
server's privacy and safety fixes (Atti, connected apps, Forum reports). No migration. MERL-T stays off.

### Work

- Fonti, filter and selection: the second part of Fonti and Lettura in one tab (LC88).

### Learn

- «Elimina» on a Learn card moves it to the trash at once, with an undo, no confirmation (LC89, L-80).

### Server

- A connected app without the «Leggere i testi» permission gets a norm's identity, not its text (#565).
- Atti: a save over a newer version is refused; an account holds at most 500 acts (#566).
- Forum reports and the moderation log drop people's words after 12 months (#583); a deleted person is
  «utente cancellato» in the log (#584).
- prisma is a production dependency, so the blocking audit covers it (#593, #594).
- The spec and plan of the EU recitals, approved (#571).

## [1.36.0] - 2026-11-18

Fonti and Lettura in one tab, the import from Todoist, «Completa per sempre», menus and notices that grow
from their button, a Learn path's goal and exam date, and the EU recitals in the sources service. One
migration (lingo_course_goal). MERL-T stays off.

### Work

- Fonti and Lettura are one tab of the pratica (LC86, part 1).
- Import a Todoist CSV into the tasks of a pratica (LC80).
- «Completa per sempre» for a recurring task (LC79).

### Interface

- Menus, notices and confirmations open and close from their button like the search island, one
  component for all (LC85).

### Learn (server)

- A path keeps the learner's goal and exam date (#554, migration `20261117120000_lingo_course_goal`);
  the link to a path's declaration points to /learn (#553).

### Sources (server and services)

- EU recitals («considerando»): text settled and frozen, reachable behind the login, read in a citation,
  kept in a pratica as a norm entry (#577, #578, #579, #580). The web reading comes later.
- The spec of the Forum community's server (#434).

## [1.35.0] - 2026-11-18

Scadenze without the clutter, Impostazioni as a real page, and the server's security fixes of the night
(G-553). One migration (web_sessions). MERL-T stays off.

### Work

- Scadenze: one header, one «Aggiungi», no empty spaces or interface descriptions (LC83).
- Impostazioni is a page (`/impostazioni`) that slides in and back, not a modal (LC84).

### Security (server)

- Passwords set by the administrator follow the sign-up rule (#551).
- Sign-in limited per account on Redis as well as per address, refresh limited, the session check on its
  own limit (#552).
- The server side of a web session in a cookie, kept on the server and revocable (#555, step 1; the web
  moves later). Migration `20261117130000_web_sessions`.
- One refusal for a taken email or username; sign-in no longer tells which emails exist (#567).
- An unexpected error's log line says what failed and where, never what it carried (#563).
- The article stream closes with an end line when the client asks (#550).
- CI: the npm audit blocks only on what ships (#582).

## [1.34.0] - 2026-11-17

Glosses in the margin with their own button, the act structure opening in the page, the search pill and
the island's field as one object, dates in words in the quick add, Learn's short lesson on validated
cards only. No migration.

### Reading

- Glosses in the margin, part 1 (LC74): a «Glosse» button of its own in the article bar, with the count,
  on computer and phone.
- The act structure opens in the page and pushes the text down, nothing on top of the content (LC77);
  small fixes to the structure lines, «In vigore dal…» and the PDF of a pratica (LC73).
- The search pill and the island's field share shape, text, lens and colours: while the island opens only
  width and position change (LC81).

### Work

- The quick add reads dates and times in words as you type («domani alle 10», «venerdì prossimo»,
  «tra 3 giorni», «20/11»): the title keeps the rest (LC78).

### Learn

- The short lesson uses validated cards only, never a draft (L-67); the MCP tools say «schede di Learn»
  (LC82).

## [1.33.0] - 2026-11-17

The search island rewritten, the Ricerca reader on a phone, the act structure panel redone; the Forum
community's server (votes, profile, communities by subject). Three migrations (Forum). MERL-T stays off.

### Ricerca

- The search island rewritten from scratch, opening and closing checked frame by frame, one component
  instead of two (LC69).
- The reader on a phone: one head for an act, the article in the selector, the graph off in the reader;
  status and selector on one line (LC68, LC70).
- The «Struttura» panel redone: a plain title, a simple close, the act's parts in a short menu (LC71).
- The reader's commands show their background under the cursor (LC72).

### Forum (server)

- Votes up and down on glosses and replies, never on one's own, and a public personal score (#506).
- A minimal profile and the «non è chi dice di essere» report, behind `forum_identity`, off (#509).
- Communities by subject, moderators and validators appointed by the owners, validation and appeal
  (#510). Migrations `20261116100000_forum_votes_up_down`, `20261116100001_forum_profiles`,
  `20261116100002_forum_communities`. The web side comes later.

## [1.32.0] - 2026-11-17

Learn's trail and a short lesson per subject; Rassegne in ⌘K and a passage into a pratica as a note;
connected apps' notes drawn as Markdown; the small fixes from the tests of 16-11. Two migrations
(lingo_lessons). The Percorsi stay off.

### Learn

- «Il tuo sentiero» (LC62): each subject opens with a «Lezione breve» node, closed with its reason when
  the subject has fewer than 4 cards to review.
- The short lesson (LC63): 5 to 8 exercises from the subject's cards, graded on the server, with an end
  screen; at most three lessons a day give points. Migrations `20261117100000_lingo_lessons` and
  `20261117100001_lingo_lessons_period` (rollback written in #540 and tried).
- Fixes (LC62b): closing a lesson after the first answer asks to confirm; the trail first on a phone;
  the closed node reachable with Tab.

### Search and pratiche

- ⌘K shows a «Rassegne» group for a topic, and a passage goes into a pratica as a note (U3).
- A note written by a connected application is drawn as Markdown, folded when long, and printed in the
  PDF without its marks (D4).

### Fixes

- The small fixes from the tests of 16-11 (LC61): «Carica un file» disabled while act files are off; the
  PDF viewer closes with Esc; the MERL-T screens say LexCraft; a pratica opened by its address after the
  Forum opens in Work, and an id that is not yours says so.

## [1.31.0] - 2026-11-17

«Dossier» becomes «Pratiche» everywhere a user reads it, and the Ricerca's own browser-only practices
go, with a box that saves the old ones as practices. Web only, no migration.

### Pratiche

- Work's entry, page titles, cards, buttons and messages say «Pratiche» / «pratica» (LC60); the address
  is `/pratiche`, and `/dossier` with everything under it leads there.
- The Ricerca no longer keeps its own practices (no bar, no «Salva come dossier», no «Nuova pratica»):
  what you read goes into a practice. Practices left in the browser by the old Ricerca are offered once,
  in a box, to be saved as practices; nothing is lost before you answer.
- The consent sentences name practices instead of dossiers; what is granted does not change (Brandeis).

## [1.30.0] - 2026-11-17

Claude works on a case's acts through MCP: it reads the case and its files, PDFs included, and deposits an
act as a Word file; the «Lettura» shows the dossier's own work under the article; «Aggiungi al dossier»
from the Ricerca. No migration; one new server dependency (pdfjs-dist). Act files for testing only.

### Claude and the acts (MCP)

- New tools for a case (LC56): read the case (instructions first, then its files), read a file's text in
  parts, deposit an act as DOCX, or a new version beside the original. Owner only; every other route stays
  closed to MCP tokens.
- The «Leggere i testi» permission names the acts and the personal data they contain (consent version 2):
  an application connected before keeps reading notes and must be reconnected to read acts.
- The text of PDFs (LC57), with pdfjs-dist 6.5.438; a damaged PDF answers with the reason.

### Dossier

- In «Lettura», under each article, the dossier's own work: its notes and the proposals of the connected
  applications, and the norms a decision cites (LC58).
- «Aggiungi al dossier» from every result of the Ricerca (LC59).

## [1.29.0] - 2026-11-16

The dossier gathers the case: its «Lettura» and «Atti» tabs, the act files encrypted on the server, the
deadline from a notification; Work's new names, the two-page guide and the motto. One migration
(pratica_files). Act files for testing only: no real client file until there is a backup off this host.

### Dossier

- A «Lettura» tab: the Corpus's reading on the dossier's own table (LC51, LC52, LC54); each row says
  «Non nel dossier» when it is on the table only, and is added, removed and reordered from there (LC55).
- An «Atti» tab (LC53): «Istruzioni per Claude», the case's files with their versions, uploaded or written
  by Claude; the old act editor and Work's «Atti» entry go, `/work/atti` leads to the dossier.
- The act files on the server (LC50): encrypted at rest with a key per file wrapped by PRATICA_FILES_KEY,
  with versions, instructions and an access log; the volume is in the backup, the key never is.
  Migration `20261116120000_pratica_files` (additions only, rollback written in #525).

### Work

- New names (LC48): «Ricerca» for the Corpus, «Scadenziario» for «Oggi» («Scadenze» in the bar),
  «Pseudonimizzatore» for the Anonimizzatore, and «Grafo delle pratiche» «in arrivo».
- «Analizza documento» marked «in sviluppo» and the Pseudonimizzatore «in arrivo» among Work's
  document tools (LC47).
- The deadline from the notification (LC44): appeal and cassation terms, the long term, the summer
  suspension and national holidays, shown step by step and added to the dossier's tasks; «Calcolo
  indicativo: verifica sempre il termine.»

### Look

- The first-visit guide in two pages instead of eleven tours; the motto «La legge è ancora uguale per
  tutti».

## [1.28.0] - 2026-11-16

Citations and the dossier's sources beside an act's text, the three ways for the AI drawn on the connect
page, the column as the browser and phone icon, the section tabs whole in the bar. Web only, no migration.

### Atti

- «Citazioni» beside an act's text: the norms and decisions it cites, each with its state in words
  (verified at the source, not found, ambiguous, not checked); a row opens the norm or the decision. The
  dossier's sources on the left on a wide frame, «Cita» inserts at the caret (LC46). Not yet tried on a
  phone: the «Vai alle citazioni» button.

### Connections

- On «Collega un'app AI», a drawing of the three ways to bring your AI: your subscription via MCP (today),
  a model on the computer and your own key (marked «in arrivo»); a pause button, nothing moves under
  reduced motion (LC45).

### Look

- The column as the browser's icon (.ico and PNG on a stone square), the iPhone's home-screen icon and the
  manifest's 192 and 512 px icons (LC43): Safari no longer shows the old blue V.
- The four section tabs and «Analizza» whole in the 224 px bar (LC41).

## [1.27.0] - 2026-11-16

The search as an island at the top of every section, and Learn's day closed with a plate and a curl of
smoke. Web only, no migration.

### Search

- On a wide screen the search is a round pill at the middle of the top bar, in every section; the
  menu grows out of it and closes back into it (LC40). On a phone the field's placeholder drops the
  example, which was cut.

### Learn

- The day's goal met: Luca's plate in place of the drawn tick, and a curl of smoke rising once from
  its lamp in place of the confetti (none under reduced motion); the session's end notice with the
  small plate (LC39).
- The section tabs as wide as their word, so «Forum» is whole.

## [1.26.0] - 2026-11-16

The Corpus desk at a phone's scale, and Work's trash as a small button. Web only, no migration.

### Phone

- The Corpus desk starts under the search field, with quieter example chips and smaller tools and
  lists (LC38).
- Work's trash is a small framed «Cestino» button with a 44 px touch area; an action beside a page's
  title sits at its middle.

## [1.25.0] - 2026-11-16

The sign-in page over an engraving, Progressi in stone and ink, a still column at start. Web only, no
migration.

### Look

- The sign-in page over an engraved law library, faded at the edges (LC36); the sign-in flow unchanged.
- Learn's «Progressi» in stone and ink with muted category hues; the splash's column stands still and
  breathes; the credits' index marks the chosen entry with a stone tile (LC37).

## [1.24.0] - 2026-11-16

LexCraft's engravings, Work's to-do list on a phone, the section's name beside the phone's menu. Web
only, no migration.

### Look

- LexCraft's engravings (LC35): 15 plates in one ink, drawn in the theme's colour (warm black on the
  paper, chalk on the dark), in Learn (the day, the streak, the level, the done seal, the subjects) and on
  the empty lists of Work, the dossiers and the Forum.

### Phone

- Work's to-do list on a phone (LC33): rows to tick and swipe, a quick add at the foot.
- The section's name beside the menu in the top bar, not over the page's title (LC34).

### Development

- Two local-only Vite configs that came in by mistake are gone (`apps/web/vite.lc29.config.ts`,
  `vite.lc30.config.ts`).

## [1.23.0] - 2026-11-16

The sign-in page, a light depth, a simpler reading of one article, plainer «Analizza documento» and act
editor. Web only, no migration.

### Look

- The sign-in page's layout (LC31); the sign-in flow unchanged.
- A light depth across fields, cards and bands; an empty «Oggi» in Work says what to do next (LC30).
- The anti-slop review's small notes in the command palette, the sidebar and the tour (LC32).

### Reading

- One article in a practice is read simply, with the glosses and discussions in a side view (LC28).
- «Analizza documento» and the act editor plainer: a quieter drop zone and paste box, no placeholder
  dash in «Tipo» (LC29).

## [1.22.0] - 2026-11-15

Corrections to what the 1.21.0 showed: one search width, a cleaner full screen, tabs that keep their
place, the wordmark in the narrow bar, the acts' row. Web only, no migration.

### Look and use

- One search, the same width everywhere; full screen keeps its bar; the wordmark folds in the narrow
  rail; Work's and the dossier's tabs keep the scroll position instead of jumping to the top (LC27).
- The dossier's «Atti» row in proportion with the others; the acts' errors in Italian, never an HTTP status's own words («Not Found»); small fixes from
  Quality's and the anti-slop reviews of the redesign (LC26).

## [1.21.0] - 2026-11-15

The rest of the redesign: Learn as a road, the Forum's Community and its people, the wordmark centred.
Web only, no migration.

### Learn

- «Oggi» is a road (LC23): one unit per subject, its institutes as stops joined by a line (cards due in
  ink with their count, a ring for what is being learnt, a check for what is consolidated); «Sei qui» on
  the first stop with cards due; «Ripassa» per subject; the rail beside the road from `lg`.

### Forum

- Community (LC24): the feed takes the page, each row with its «utile» count on the left, the subject,
  the author, the source as cited, the title and the first lines, the replies and «Risposta accettata»;
  communities by subject beside the feed; a discussion on its own page; the people's profiles.

### Look

- The LexCraft wordmark centred over the section tabs and 150 px wide (LC25).

## [1.20.0] - 2026-11-15

LexCraft's interface, and Atti: the acts a lawyer drafts, in Work and in the dossier. One migration.

### Interface

- The shell and the main pages follow the «interfaccia unificata» prototype (LC21): the sections as tabs
  under the logo, compact sidebar rows, «Impostazioni» at the bar's foot, a top bar from `lg` with the
  path, a compact search (⌘K), the news, «Commenti» and «Tutto schermo»; the 1056 px sheet; a quieter
  Corpus desk; practices as a row of tabs; dialog titles in the serif.
- Over a page's title only the section's name, without the phrase (LC20).

### Atti

- Work's «Atti»: the list of acts and an editor with autosave; an act can belong to a dossier, where it
  is read first; the dossier's sources with «Cita»; copy, download, delete with confirmation;
  «Analizza l'atto». Acts are in the account export.
- Server: table `atti` (migration `20261115230000_atti_draft`) and `/api/atti` (the session only, each
  user sees only their own acts, 404 across users, at most 500,000 characters).

### Deploy

- One migration: after this release the host cannot go back to 1.19.0 with `--no-pull` alone (the deploy
  refuses a version without a migration it has applied); going back means dropping the `atti` table by hand.

## [1.19.0] - 2026-11-15

Twenty small fixes from the day's browser tests, the dark theme's states, and a sign-in that never
leaves tokens behind when refused. Web only, no migration.

### Sign-in

- If the sign-in succeeds but the account is then refused (401 or 403 on `/auth/me`), both tokens are
  removed, with no redirect; a busy server (429, 5xx, no answer) keeps them (LC18).
- The password rule is written under the field at sign-up and checked before sending, with the server's
  own rule (a test compares the two); the server's refusals are in Italian.
- A 429 says how long to wait when the server gives `Retry-After`; admin pages show the same waiting line.

### Use

- History rows open from the keyboard; «Nuovo dossier» opens straight on the form; confirmations start on
  «Annulla»; Labs shows «in arrivo» while it is off; the logo's sweep and intro play once a session (LC18).

### Look

- In the dark theme a disabled primary action reads as off, the chosen option of a group has one look,
  and a switch that is on takes the light ink (LC19).

## [1.18.0] - 2026-11-15

The LexCraft logo in the app, animated; the independent UI review's corrections; a wrong password says
so; primary actions readable in the dark. Web only, no migration.

### Look

- The LexCraft logo in the sidebar and at sign-in, with its sweep and intro from the design file; still
  under reduced motion (LC16). The sections share Pietra's ink and are told apart by name and icon.
- The independent UI review's corrections (LC15): a pointer on every enabled control, readable
  placeholders, no em dashes as joints in visible strings, no off-palette stripes, a solid sidebar,
  plainer icons, sentence case, a plainer tour, colour words in the Markdown export.
- In the dark theme, filled primary actions are light ink instead of a grey slab that looked disabled;
  the chosen option of a group stands out (LC17).

### Sign-in

- A wrong password or an unknown email shows «Email o password non corrette.» and keeps the email,
  instead of reloading an empty form; sign-in errors are in Italian; while `/auth/me` is retried the
  loading screen says «Il server non risponde, riprovo…» (LC14).

## [1.17.0] - 2026-11-15

A busy or briefly unreachable server no longer signs anyone out; the night's retouches from the browser
tests; Learn's exam follows its state. Web only, no migration.

### Sign-in

- A 429, a server error or no answer on `/auth/me` keeps the session: the app asks again after 1, 2, 4
  and 8 s, and if the server is still unreachable says «Connessione al server non riuscita. La sessione
  resta aperta: riprova tra poco.» with «Riprova». Only a 401 or 403, or a token already gone, signs out
  (LC13). No page is drawn without its user.

### Look

- The sign-in page's column lines up with the «L» of LexCraft from 768 px; no jump in opacity from the
  splash to the app; sidebar, Forum and dossier PDF retouches from the browser tests (LC11).
- «Segnala» in the Forum starts on «Annulla», so an Enter pressed at once does not report.

### Learn

- The exam's page and Oggi's row follow the attempt's state (to start, in progress, handed in); the
  hand-in always asks for confirmation; «Rivedi l’esito» after it (LC12). Behind `lingo_courses`, off
  in production.

## [1.16.0] - 2026-11-15

A course's final exam from the web, behind the courses switch, which stays off in production. Web only,
no migration.

### Learn

- The final exam of a course from the web (LC9): `/learn/percorsi/:id/esami/:esameId`, with its rules,
  every question and the written opinion on one page, the hand-in, and the result (percentage, skills
  under 60%, when a new exam can be asked, the right answers with explanations, the opinion beside the
  model answer with a grid to tick). The course page offers «Inizia la prova» or «Riprendi la prova».
- «Simulazione d'esame» in «Oggi», one row per course whose next step is the exam.

### Admin

- The courses switch (`lingo_courses`) in «Testi di Learn»: «Accendi/Spegni i percorsi». With it off
  nothing of the courses shows, as before.

## [1.15.0] - 2026-11-15

The Forum's Community page: the discussion feed and one open discussion at its own address. Web only, no
migration.

### Forum

- Community (LC10): the feed of discussions on norms and decisions, filtered by subject, and one
  discussion open at `/forum/community/:threadId`, with its replies, votes and comments.
- A new gloss can carry a subject (optional), so the filter finds discussions started from the web.
- The panel under an article and the Forum share the same controls: vote (named with what is voted and
  the count), «Segnala» with a confirmation, reply; the same reply count in both places.
- Touch targets of 44 px on the phone for vote, report, reply and the norm or decision link.

## [1.14.0] - 2026-11-15

VisuaLex becomes LexCraft on screen: the name in every text a user reads, LexCraft's column as the mark,
the addresses named after the sections, and Work's bar in five entries. Web only, no migration.

### Name and mark

- LexCraft in every text a user reads: page title, manifest, sign-in, the steps to connect an AI app,
  PDF footers, examples, credits (LC5). The MCP commands keep «visualex»; consent texts, past release
  notes and the browser's storage keys are unchanged.
- LexCraft's column replaces the book in the splash, the app's mark and the tab icon; under reduced
  motion it does not move.

### Addresses

- `/opus/…` → `/work/…`, `/studia/…` → `/learn/…`, `/merlt…` and `/grafo` → `/labs…` (LC6, D-235).
  Every old address redirects to the new one with its path, query and hash, and stays for good: links
  in the server's notifications (`/studia/percorsi`), saved links and bookmarks keep working. A guard
  test refuses old addresses in the sources.

### Work

- Work's bar has five entries: Oggi, Corpus (the search, ⌘K), Dossier, Atti and Anonimizzatore, the
  last two «in arrivo» with a page of their own (LC8, D-315, D-324). «Prossimi giorni» and «Lista
  d'ingresso» are tabs of Work's page, with «Oggi» lit on all three; «Analizza documento» and
  «Rassegne» are links on the search page.
- The logo's column marks the active entry in every section's bar (D-237).

## [1.13.0] - 2026-11-15

The web in Pietra, LexCraft's design system: warm greys and warm ink, EB Garamond to read and Inter for
the interface, the sections named Work, Learn, Labs and Forum, «Commenti» at the top right. No migration.

### Look

- Pietra's colours (LC1, D-156): the ink and toga scales take warm greys and warm ink, so thousands of
  classes change value, not name; the dark theme redefines the action, focus and selection-tint steps;
  the courts' and the highlighter's blues stay blue; shadows, `theme-color` and the splash follow. The
  guard is `lib/pietra.guard.test.ts`; text on paper is checked at 12:1 (Pietra measures 12.4:1).
- Pietra's type (LC2): EB Garamond for reading text and titles, Inter for the interface, Geist Mono for
  codes; all served by the app (fontsource, OFL-1.1), no request to Google Fonts; «Crediti» updated.
  The reading text is 19 px on a phone and 20 px from `md` (LC4).
- The text selection is one translucent stone on every paper, Study Mode's and the note cards included,
  so a highlight under it keeps its hue; native checkboxes, radios and ranges take Pietra's ink (LC4).

### Navigation

- The sections take their LexCraft names: Opus → Work, Gymnasium → Learn, Academia → Labs (with the
  flask icon), Forum (LC3, D-137, D-157, D-236). Identifiers, routes and data stored in the browser
  are unchanged; the section switcher drops «VisuaLex».
- Feedback is «Commenti» at the top right, beside «Tutto schermo», and the user menu's entry below
  768 px; the round floating button and the room kept for it are gone (LC3, D-253).
- The Learn sidebar names «Learn» once for a screen reader (LC4).

## [1.12.0] - 2026-11-14

The practice in two views; notes beside the text and a Forum highlight cut like any other; dossiers and
study cards as grids; a long load that says how far it got and fetches the rest; the browser cleared
at every way out of a session. No migration.

### Reading

- The practice in two views, «Panoramica» and «Lettura», with a passage between them (U2, L-61, L-62).
- A4, second round: a highlight imported from the Forum is cut and recoloured like the others, its author
  on every piece; the note tool; notes in the margin beside the text.
- A long load of articles no longer stops after about 60 seconds without a word: the article stream has
  a time budget proportional to the request (`STREAM_SECONDS_PER_ARTICLE`, 30 s; at least 60 s, at most
  `STREAM_MAX_SECONDS`, 5400 s) and, when it runs out, ends with a `kind: "time_budget"` line naming the
  missing articles. The web shows «Caricamento interrotto: caricati N di M articoli» with «Carica i
  mancanti», which loads only those into the same practice (D-323, LC0).
- When Normattiva's article page cannot be read, the AKN text served instead is marked
  (`text_source: "akn"`) and never cached; saved norms, the assistant and MERL-T do not anchor on it (scan A.7).

### Layout

- U1: the dossier list and «Le mie schede» are grids of cards of at least 320 px; Gymnasium's «Per
  materia» is a grid, and «Oggi» and «Progressi» keep their columns in full screen.

### Limits

- One request expands to at most 150 articles, bis and ter included (`MAX_ARTICLES_PER_REQUEST`,
  G-473); above it the message says how many the request opens. A dossier's «Apri tutto» pages its
  groups at 150. Note uploads (MERL-T) are refused above 10 MB before being read (scan A.4).

### Privacy

- Every way out of a session clears the copies of server data and the traces of use from the browser; the
  only copy of the person's work (practices, old tabs' backup, assistant thread) is parked under the owner,
  never deleted. A failed token refresh ends the session only when the server refuses it, not when the
  network drops (T80).

### Development

- The Python dependencies are locked to the production image (`services/visualex/requirements-lock.txt`,
  45 pins); Dockerfile and CI install from it, and Dependabot reads it (scan A.6). Developers:
  `services/visualex/.venv/bin/pip install -r services/visualex/requirements-dev.txt`.
- `VISUALEX_API_PORT` moves the Python API off 5000 in development (AirPlay on the Mac).
- `@hono/node-server` 2.1.8 and `hono` 4.13.18 (closes the open Dependabot alerts on hono) in `apps/server` and `apps/mcp`.
- Spec: the MCP's next tools (N2) and notes on decisions (D7c).

## [1.11.0] - 2026-11-06

The highlighter as a tool, as a word processor has it, in every reader; one frame for every page,
wider on large screens and in full screen; a CI about four times shorter. No migration.

### Reading

- The highlighter is a tool (A4): a split button with the four colours and «Nessun colore»; switched
  on, every selection takes the ink as it is released. Whole words, the exact piece with Alt; the same
  colour removes where it passes, another recolours, a mixed selection applies and merges; no toasts
  for highlights, Ctrl+Z / ⌘Z undoes the last gesture; no duplicates. In the article, the decision,
  the dossier item, Modalità studio and Gymnasium's lessons.
- `PUT /highlights/:id` takes the range too, and `POST /highlights` takes `splitFrom`: a highlight
  imported from the Forum keeps its original author when it is cut or recoloured (G-417, G-418).

### Layout

- One frame (U1): 1600 px, 2400 px in full screen; one width per page and one 70-character reading
  measure; Gymnasium «Oggi» keeps its two columns in full screen; the full screen widens, named in
  Italian, and its key is ⌘⇧F (Ctrl+Shift+F), since ⌘Space opens Spotlight on the Mac.
- The Forum's «Pronti da VisuaLex» is a grid of cards on a wide frame.

### Development

- CI: the server tests reset the database once per run and empty it with DELETEs; the web tests run
  on three runners; the CI's Postgres runs without fsync. About 22 minutes → 5½ per pull request
  (G-411).
- `vendor/mcp-legal-it` on its rewritten history (same tree, G-416).

## [1.10.8] - 2026-11-02

«Analizza documento» rebuilt around the search, with hyperlinks written into the text and into a copy
of the Word file; «Copia link Normattiva» with the date; the Massimario's reviews served by VisuaLex's
core; the Forum Community's server; article parts and Gymnasium courses still switched off. Two
migrations. The reviews panel stays hidden until the archive is installed.

### Reading

- «Copia link Normattiva» (and «Copia link EUR-Lex») in the reader and the dossier: the address
  VisuaLex holds, dated today for the text in force and at the date asked for a past text, and the
  citation as a link for Word.
- The Massimario's reviews come from VisuaLex's core (MERL-T may read them): a panel inside
  «Giurisprudenza», every volume, a filter by word, the reviews of another article, and a «Rassegne»
  page to search the whole Massimario by word; with no archive installed the panel says nothing,
  never an error on every article.

### Analizza documento

- One recognizer with the search (`/parse_query_batch`), the act inherited from the context only when
  the text names its type, completion by hand of what is missing.
- Hyperlinks: `/fetch_norm_links` resolves the found citations (the Constitution included); a safe
  DOCX reader in the browser; «Prepara i link» and a copy of the Word file with the links written in,
  with a report.

### Forum

- The Community's server (data and routes; licence text as draft v1): the glosses' discussions
  gathered, ready for the web.

### Sources

- Normattiva articles split into parts: part and paragraph in the article routes, one article with
  its parts in the index (switch `article_parts`, off until the web shows them).

### Gymnasium

- Courses (switch `lingo_courses`, off): check cards for every competence, module and exam shapes in
  the MCP's schema tool, the reading web's fixes.

## [1.10.7] - 2026-10-29

The D8 request: the highlight colours' meanings set by each user, a dossier created in one call
through the MCP, and the assistant's glosses in place of its coloured highlights; the readers' update
notes and partial texts; the Gymnasium courses (A1) server, MCP and first web screens. Glosses and
courses ship switched off. Three migrations. MCP clients reconnect.

### Reading

- Each user sets what the four highlight colours mean (Impostazioni › «Significato dei colori»,
  reached from the gear beside «Colore»); labels only, kept on the device.

### Dossier and MCP

- `omnilex_crea_dossier` creates a dossier and adds up to 50 norms, 10 decisions and 10 notes in one
  call, verified at the source, with one compact outcome per row not entered (`non_entrate[].riga`
  as written); `in_sospeso` names a step left without an answer. On the fixed AgID case: 10 calls
  to 1. `omnilex_aggiungi_nota_dossier` takes `note[1..10]`; the single form is gone.
- Glosses (switch `assistant_glosses`, with `assistant_passages`): an assistant's note anchored to a
  passage by position, validated by the user, shown beside the text as a word processor's comments
  and in a sheet on the phone. `omnilex_glossa_voce` replaces `omnilex_evidenzia_passaggi_dossier`;
  applications proposing coloured passages get 410; saved proposals stay. `omnilex_leggi_testo_voce`
  no longer depends on a switch.
- The text of the user's dossier notes leaves through the MCP under «Leggere i testi», whose words
  now name the notes.

### Sources

- Normattiva: an article's update notes («AGGIORNAMENTO») in their own field beside the text
  (`note_aggiornamento`), and an article Normattiva splits into parts says it is partial
  (`testo_parziale`, `parti`). The article's text is unchanged.

### Gymnasium

- Courses created by the assistant (A1, switch `lingo_courses`): the model, the declaration, the
  creating routes, studying, mastery and the final exam on the server; the MCP's course tools on the
  one consent; in the web the list, the course page, «Oggi»'s row, the declaration, and a module's
  reading and recall.

## [1.10.6] - 2026-10-29

The Union's acts read again despite EUR-Lex's firewall, and a lighter MCP. Server and MCP only: no
migration, no change to the web.

### MCP

- Fewer tokens for the same results: compact JSON in every tool result; `lingolex_le_mie_card`
  returns a light list (`ancore` as words, no URN) and the new read-only `lingolex_leggi_card`
  gives 1–10 cards whole; server instructions at `initialize`; a dossier named wrongly is refused
  with the list of the user's dossiers. Clients reconnect to see the new tool.

### Sources

- The Union's acts are read from CELLAR, the Publications Office's repository, first, and from
  EUR-Lex's site through the browser only when CELLAR does not serve the act: since 25-26
  October 2026 eur-lex.europa.eu answers a server with a firewall challenge. Same page, same
  texts (23 acts compared, 1534 articles identical). `/health/detailed` probes both hosts and
  reports the source down only when both are.
- An EU act's article heading glued to the end of the paragraph before it is now found also when
  its body sits in the next container or is bare text after the paragraph. A paragraph that
  opens on an article it cites («Articolo 5 della direttiva … è sostituito», «Article 5 of
  Directive …») is no longer read as that article's heading, and, on every page, no longer ends
  the article it sits in. No real page known today has these shapes; the texts of the 23 acts
  compared are unchanged.

## [1.10.5] - 2026-10-27

The web only: the boundaries of an assistant's passage moved by hand, and the
signs of a dossier row on one line. No migration, no server change.

### Dossier

- D7b: «Sposta l'evidenziazione» on a proposal's card, in the block's popover
  and among the proposals no longer in the text: new words chosen by mouse,
  touch or Shift+arrows, 1–2000 characters inside the entry's text; the note
  keeps its state and the application's original words stay viewable.
- The AI light and the notes' count on a dossier row sit on the line of the
  star and the bin, for articles and decisions.

## [1.10.4] - 2026-10-26

The web only: undo for removed highlights and notes, the highlight colour
chosen once, and the touch-ups from a real phone. No migration, no server
change.

### Reading

- «Annulla» (and Ctrl/Cmd+Z, also over Study Mode) when removing a highlight
  or a note: the removal reaches the server only when the notification closes.
- H1: the highlight colour is chosen once in the reading bar and every new
  highlight uses it; a short legend suggests a meaning for each colour.
- In Study Mode «H» with text selected no longer moves to the previous article.

### Phone

- 44 px targets in the reader, in Settings and on the group marks in the text
  (touch area only), contrast fixes, Cronologia at 392 px, the sign-in margin,
  the 404 bar; the favourites dash in the sidebar removed.

## [1.10.3] - 2026-10-25

Passages and notes an assistant proposes in a dossier, validated by hand (D7b,
first cut), and the readers' corrections from the inventory of mcp-legal-it.
One migration.

### Dossier and MCP

- An assistant connected through MCP reads the text of a dossier's norm or
  decision (`omnilex_leggi_testo_voce`, scope `dossier:text`) and proposes
  passages with a note (`omnilex_evidenzia_passaggi_dossier`): the server finds
  the quoted words in the real text and stores its own slice (rule 23).
- In the dossier each assistant note is «da validare», «Validato» (or
  «modificato da te», the assistant's original kept), or «Da rivedere» with a
  comment; a mark per row sums them. No tool confirms, edits or removes.
- Behind a switch (`app_switches`), off by default; the consent's words name
  the text that goes to the connected application's provider.
- Migration `20261027100000_assistant_proposed_marks`.

### Readers

- The c.p.a., the cod. nav., the cod. post. and the c.g.c. by their sigla.
- EUR-Lex: an article quoted by an amending act is never served as the act's
  own; older acts' titles read without commas round the date; dir. 85/374's
  art. 11 is listed and served.
- Three acts whose text is their decree's annex 1 are read from the annex; a
  request for the original at a date is refused, also in imports and quick
  norms.
- The exported PDF's cache name and the review of #279 and #281.

## [1.10.2] - 2026-10-24

The phone first: a lighter first load and no layout shift on «Oggi» and the
Forum; decisions that open in place in the dossier, the goal's mark written in
ink, accessibility, and a security update. No migration.

### Performance

- jsPDF loaded on the first export, out of the initial chunk (−126 KB gzip).
- Tours, study packs and the comparison loaded when used (−19 KB gzip).
- Pages loaded with their route; an address opened directly preloads its page
  through a small map written at build time (−112 KB gzip on the first chunk).
- Places held as tall as what takes them on «Oggi» and the Forum: CLS on a
  phone from 0.63 and 0.12 to 0.
- A page whose code cannot be fetched, or that fails while in use, keeps the
  layout with «Si è verificato un errore.» and «Riprova»; the comparison closes.

### Dossier

- Decisions open in place like acts, in two columns from lg (D7a); each column
  scrolls on its own, and a norm cited in a decision opens on the left when it
  is in the dossier (D7d).
- The header's labels never wrap inside their buttons; the row wraps as a row
  (D3b). Touches: the task field's hint whole, a decision's name as a line.

### Gymnasium

- «Obiettivo raggiunto» as a mark written in ink, drawn once; no mark and no
  «0 di 0» when the day counts with nothing to review (G9).
- «Oggi» without missions keeps its columns, and the page's foot clears the
  feedback button (G8c).
- Three touches for a first use: the cards' search hint, «Torna alla ricerca»
  on a missing card, a line on what a card is (Q1).

### Readers

- The citation matcher knows cod. nav., cod. post. and c.g.c.

### Accessibility

- «Confronta articoli» is a dialog: role, name, focus kept and returned; the
  command palette opened above it keeps Tab. The open decision in a dossier is
  a named region.

### Security

- zod 4.6.7 in the server and the MCP (removed from the web, unused);
  body-parser 1.20.9 and 2.4.0; multer 2.5.0; fast-uri 3.1.9. Italian messages,
  status codes and lengths as before.

## [1.10.1] - 2026-10-23

The afternoon's design across the app, a fix for Gymnasium on the phone that
was in production, the readers' corrections and a security update. No
migration.

### Fixes in production

- Gymnasium «Oggi» fits a phone again: one column of minmax(0, 1fr), strips that
  scroll sideways hold their pieces, subject names wrap (G8b).
- dompurify 3.4.17 for a critical advisory on the reader's sanitizer; vitest
  4.1.12 and ip-address 10.7.4 (moderate) in the three projects.

### Look and navigation

- The search field opens into the command menu, in place, with its words; Tab
  only brings the focus (R2).
- The reader puts the text first: one status line and three actions, the rest
  in «⋯»; on the phone the text reaches the page's edges (R3, R3b).
- Inchiostro everywhere: tokens instead of hand-written colours, no text under
  11 px, shadows and focus rings in dark mode (Y1).
- The sign-in wordmark written in ink, the card as tall as the form shown (A3,
  A1c); «Carattere dell'interfaccia» instead of «Font».
- A shared panel that opens in place (U1a); a task's «Dettagli» and the study
  settings open in place (U1b); «Interrompere il ripasso?» from its button, and
  no question with no card rated (U1c); «Crediti» across the frame with an index
  beside the sources (U1d).

### Dossier, Forum, Academia

- A dossier's page in the planner's shape (S7c).
- The Forum shows the community's dossiers first, «Pronti da VisuaLex» in a strip
  below, «Recenti» on a phone (S7a).
- Academia starts from the consent: nothing collected before a clear yes (S7b).

### Legal texts and server

- An article inserted from a later day says so; the later text on request,
  always marked not in force (G-357, G-358).
- EUR-Lex: the article asked is never served as its bis; whitespace read in
  linear time; the title of older ELI pages.
- The PDF export gives today's text for an undated request, under the act's full
  name; the shared PDF cache can no longer be filled under another act's name, and
  exported PDFs are swept after two days (G-361).
- A read-only route for Gymnasium's counts of the day (G-356); Gymnasium's
  reads no longer answer 500 when a card or an account goes mid-read.

### Release notes

**Un aspetto più curato**
- All'accesso la scritta VisuaLex si disegna come inchiostro sulla carta, con lo stesso carattere del resto della pagina. Il riquadro di accesso è alto quanto il modulo che mostri.
- Colori, misure e ombre sono gli stessi in tutte le pagine, e i testi più piccoli sono stati ingranditi.
- In Impostazioni, «Font» si chiama ora «Carattere dell'interfaccia»: cambia il carattere dei menu e dei pulsanti; il testo di legge resta sempre nel suo.

**La ricerca**
- Il campo di ricerca si apre nel menu dei comandi, nello stesso punto e con le parole già scritte; con Tab il campo prende solo il fuoco.

**Il lettore delle norme**
- Il testo viene prima: sopra l'articolo c'è una sola riga con lo stato («In vigore dal 1° gennaio 2005») e tre azioni; il resto è in «⋯».
- Sul telefono il testo usa tutta la larghezza dello schermo.

**Dossier, Forum e Academia**
- La pagina di un dossier ha la forma del planner: titolo, azioni in una riga, compiti e voci come righe.
- «Dettagli» di un compito si apre sul posto, senza una finestra.
- Nel Forum vedi prima i dossier della comunità; quelli pronti di VisuaLex sono in una striscia sotto. «Community» spiega cosa arriverà.
- Academia comincia dal consenso: se non l'hai dato, un solo riquadro ti dice cosa fa MERL-T e cosa raccoglie.

**Gymnasium**
- Sul telefono la pagina «Oggi» sta di nuovo tutta nello schermo, con la settimana intera e i nomi delle materie leggibili.
- Le impostazioni dello studio si aprono sul posto, sopra l'elenco.
- Se interrompi un ripasso senza aver valutato nessuna scheda, esci subito; se ne hai valutata almeno una, ti chiediamo conferma.

**Crediti**
- La pagina dei crediti usa tutta la larghezza, con l'indice delle fonti accanto.

**Testi di legge**
- Un articolo che entra in vigore più avanti ora lo dice: vedi il testo di oggi e, a richiesta, quello che verrà, con la data da cui varrà.
- Atti dell'Unione: se chiedi un articolo che non c'è, ora te lo diciamo invece di mostrarne un altro; le pagine lunghe si aprono più in fretta; tornano i titoli mancanti di alcune direttive meno recenti.
- L'esportazione in PDF dà sempre il testo in vigore oggi, con il nome completo dell'atto.

**Sicurezza**
- Aggiornata la libreria che pulisce i testi mostrati nella pagina.

## [1.10.0] - 2026-10-22

Opus's planner, Gymnasium's points and levels, and a night of design across
the app; the readers keep codes in their annexes and say when an article will
change. Two migrations, both additive: the `tasks` table, and the points ledger
with one column of `lingo_giornate_studio` (default 0).

### Opus

- A planner for the day's work: «Oggi», «Prossimi giorni» with the week, the
  inbox for what has no date yet; a task opens in a sheet (dossier, planned
  date, deadline, priority, labels, repetition) and saves as it changes;
  overdue deadlines and late tasks first; a dossier shows its tasks.

### Gymnasium

- Points and levels: each mission done is worth points, the level and what is
  left to the next one in «I tuoi progressi», the points earned shown during
  the lesson; the server keeps the ledger and the missions.
- «Oggi» starts with the day: what is due, one button to begin, three compact
  missions, the subjects in one place.
- «Progressi»: a line chart of the reviews over 7 days, 30 days or six months,
  with the goal, instead of the calendar.
- The pages stand when a server sends no level or missions.

### Look and navigation

- The section switcher is a split button: the name to the section's main
  page, the arrow to the list.
- Notifications drawn from a line, with the time left to undo; deleting a
  dossier or closing a practice asks nothing and offers «Annulla»; Ctrl+Z (⌘Z)
  runs the newest «Annulla» outside text fields.
- The confirmations that remain, for what cannot be undone, open from their
  button with the focus on «Annulla».
- Every page's title is the page's name, the section's phrase above it; on the
  phone the bar shows the name once the title scrolls away.
- Analizza documento: the drop zone reacts to a file dragged over it; the file
  stays in the browser.
- The sign-in page draws the wordmark on a seven-segment display.
- Small fixes: Esc closes the phone's drawer, the focus goes back to the
  magnifier, no sideways shift when a page grows past the window, fields of
  16 px on the phone.

### Legal texts

- A date is the text in force on that day; an undated request is today's text,
  and an article that will change says so beside the text («Dal 1° gennaio
  2027 questo articolo è abrogato»).
- Four codes published as a decree's annex, and the TULPS, are keyed by the
  annex like the c.c. and the c.p.: their articles are the code's, labels
  unchanged.
- EUR-Lex: a missing article is no longer replaced by another one; the readers
  find ordinals in one word or two («135 sex decies» and «135-sexdecies»),
  rubriche without brackets, and read article numbers in linear time.
- mcp-legal-it 2.17.1.

### Release notes

**Opus: il tuo planner**
- In Opus c'è un planner per il lavoro di ogni giorno: «Oggi», «Prossimi giorni» con la settimana, la «Lista d'ingresso» per quello che non ha ancora una data.
- Un compito si apre in una scheda con dossier, data pianificata, termine finale, priorità, etichette e ripetizione; ogni modifica si salva da sola.
- I termini scaduti e i compiti in ritardo stanno in cima, con i giorni che mancano o che sono passati.
- Un compito può appartenere a un dossier, e il dossier mostra i suoi compiti.

**Gymnasium: punti e livelli**
- Ogni missione compiuta vale dei punti; i punti fanno salire di livello. Il livello e quanto manca al prossimo sono in «I tuoi progressi».
- Durante la lezione vedi i punti guadagnati, senza che interrompano il ripasso.
- In «Progressi» il calendario lascia il posto a un grafico dei ripassi: 7 giorni, 30 giorni o 6 mesi, con la linea dell'obiettivo.
- La pagina «Oggi» comincia con quello che c'è da fare oggi e un solo pulsante per iniziare.

**Più ordine nell'interfaccia**
- Il selettore delle sezioni ha due parti: il nome porta alla pagina principale della sezione, la freccia apre l'elenco.
- Le notifiche nascono da una riga e mostrano il tempo per annullare; si fermano quando ci passi sopra. Eliminare un dossier o chiudere una pratica non chiede più conferma: c'è «Annulla».
- Ctrl+Z (⌘Z sul Mac) annulla l'ultima azione finché la notifica è a schermo.
- In «Analizza documento» la zona per il file reagisce quando ci trascini sopra un documento; il file resta nel tuo browser, come sempre.
- Il titolo di ogni pagina dice dove sei («Oggi», «Progressi», «Le mie schede»), con il nome della sezione sopra.

**Testi di legge più precisi**
- Per un articolo che cambierà (per esempio abrogato dal 1° gennaio 2027) vedi il testo in vigore oggi. Accanto al testo un avviso dice da quando cambia.
- Alcuni codici e testi unici pubblicati come allegato a un decreto (per esempio il codice del turismo e il TULPS) mostrano ora gli articoli del codice, non quelli del decreto.
- Gli articoli di EUR-Lex che non si trovano non vengono più sostituiti da un altro articolo.
- Gli articoli con suffisso in una parola sola (per esempio «391-novies») si cercano anche nella grafia dell'atto.

## [1.9.2] - 2026-10-21

The look of VisuaLex, on the computer and on the phone; faster reading of the
sources; dependency security fixes. No migration.

### Look and navigation

- Moving between sections is a short fade under 250 ms, the section's mark
  changing colour, instead of the ink transition; instant with reduced motion.
- One frame for section pages: the title in the same place and size from
  Dossier to the Forum, Analizza documento and Cronologia; the fixed Focus button
  never covers a page's action.
- On the phone: the same top bar on every page, hiding while you scroll down and
  coming back up, never hidden while the focus is in it; the feedback entry in
  the user menu; filters on one row; titles of one size.

### Gymnasium

- «Oggi» uses the full width: today's missions and every other mission on the
  left, the progress and the subjects to review on the right.
- The study settings open inside the «I tuoi progressi» card.
- «Progressi» at full width; the cards by state and the next 14 days side by
  side.

### Release notes

- The «Novità» window always shows the new version's note, and those of any
  version skipped; the notes now live in `apps/web/src/content/novita/`.

### Sources and caching

- The act tree is downloaded once per page and an EUR-Lex act visited once by
  the browser; the Normattiva tree goes through the shared HTTP client, which
  pauses a source after a stated `Retry-After`.
- The Normattiva cache is pruned (2 GB, 30 days) and its expired pages are
  removed at start and every six hours.

### Security

- `@modelcontextprotocol/sdk` 1.32.0 in the server and the MCP server, and the
  `follow-redirects` and `launch-editor` advisories fixed (production was not
  using the affected parts of the SDK).

## [1.9.1] - 2026-10-20

Sign in and sign up on one page, Analizza documento redrawn, the account export
without other users' data, and the minor findings of the 1.9 test. No
migration.

### Account and privacy

- «Accedi» and «Registrati» on one page with two tabs and a short animation;
  the registration form in the new design; the page holds still when the tab
  changes, «Crediti» stays at the foot, the list under the subtitle is gone.
- The account export holds no other user's id, name or text: replies, votes,
  imported content, the search parameters of accepted proposals and person
  objects inside hand-imported data are filtered, with a two-user test.

### Analizza documento

- Redrawn: a drop area, a reading text with the citations marked, the citations
  grouped by act and counted, an empty state with examples; the document never
  leaves the browser.

### Search and navigation

- The search menu in the new design: a panel under the field on a computer, a
  sheet on a phone, the steps as a trail, acts in a column with their
  abbreviation and filtered by word start as you type, favourites and aliases
  «a portata di mano», a recognised citation as one strong row that opens the
  article; a named dialog that keeps and returns the focus.
- Moving between sections (Corpus, Opus, Gymnasium, Forum) prints a short ink
  transition, and Gymnasium's marks, digits and missions move when they change;
  every animation is off with reduced motion and none takes a key or the focus.

### Minor findings after 1.9

- 44 px targets on the Forum's cards, in the search menu and in the welcome
  tour, whose buttons now speak Italian («Chiudi»); an `h1` on «Dossier» and
  «Cronologia».
- With MERL-T off the consent is read once per session; the validation queue is
  asked only for validators.

## [1.9.0] - 2026-10-20

The rest of the 1.9 redesign: Gymnasium complete, the pages for credits and for
mcp-legal-it, and a third-party doctrine source out of the web app (D-078). No
migration.

### Gymnasium

- The lesson: the review session is a screen of its own, with a progress bar,
  the card in serif, one action at the foot («Mostra risposta», then the four
  grades with their intervals), a short note after each grade («Torna tra 3
  giorni») and an ending with the streak, «Torna a Oggi» and «Continua».
- «Contribuisci»: «+ Nuova scheda» in «Le mie schede» writes a card with no
  article, its references typed and checked against Normattiva; shown only
  while the sources answer.
- The road gains its institutes: each subject opens its institute stops, with
  how many cards are due, and a review session can be limited to one institute
  (server: `GET /api/lingo/srs/sessione?materia=…&istituto=…`, optional).
- «Progressi», `/studia/progressi`: streak and record, a calendar of the past
  months, the cards by state, the next 14 days, progress by subject; it takes
  the place of the «Il tuo mese» sheet on «Oggi».

### Third-party doctrine out of the web app (D-078)

- No more doctrine, massime, relations, glossary or footnotes from that source,
  in the reader, beside it, in Study Mode or in the export; the palette loses
  «Includi dottrina» and «Solo articoli con dottrina».
- Saved practices drop that source's fields when they are read and when they
  are written; highlights and notes made on the old sections stay the reader's,
  listed as «Sezione non più disponibile», and can be removed.
- «Cerca sentenze sul tema dell'articolo» under «Giurisprudenza» searches the
  Cassazione by the article's rubric, except for EU acts, notices and a short
  list of generic rubrics.

### Credits and connected AI applications

- «Crediti», `/crediti`, public: the sources with their holders, licences and
  attribution lines, the fonts and the libraries; linked from the user menu and
  the login.
- «Collega un'app AI» adds mcp-legal-it: the Claude Code plugin, the Claude
  Desktop extension and the terminal, with the first-launch notes.

### Navigation

- The services' status moves into the user menu; the pill over the page is gone.

## [1.8.5] - 2026-10-19

The first part of the 1.9 redesign, released early at the owners' request (G-305).

### Look and feel («Inchiostro»)

- A new palette, self-hosted fonts and motion tokens; the login and the
  Scrivania redrawn; a book mark while the app loads; the theme set before the
  first paint.
- The primitives (buttons, dialogs, sheets, toasts, tooltips) follow one set of
  states and timings; entrances that never generated CSS now play, briefly, and
  leave nothing applied once they end; hover motion removed from rows and lists.

### Navigation

- The sidebar shows its words: a wide bar with icons and labels from 1280 px,
  which can be narrowed and remembers the choice; the icon rail between 1024 and
  1280 px; a drawer with 44 px rows on a phone.

### Gymnasium

- The home is «Oggi»: today's missions first, computed from the progress the
  app already reads, then the progress (streak, goal, week, the states of the
  cards), then every mission, those the server does not record yet marked
  «In arrivo»; titled «Gymnasium: la tua palestra giuridica».
- The review scope counted by institute (server, for the next steps).

### Forum

- Two areas: «Dossier pubblici», the published dossiers as before, and a
  «Community» placeholder; titled «Forum: il luogo del dibattito giuridico».

### Dossier

- The list filters by category from a menu beside the sort, and labels show
  with a capital initial wherever a dossier's labels are shown, the PDF aside.

### Connected AI applications

- mcp-legal-it at v2.16.1; the tools that read Brocardi stay withheld from
  MERL-T's experts.

## [1.8.0] - 2026-10-19

### Licence

- The whole repository is under the Mozilla Public License 2.0 (MPL-2.0),
  in place of MIT (root), Apache-2.0 (MERL-T) and ISC (the applications).
  Portions ported from mcp-legal-it keep the MIT terms they were relicensed
  under.

Everything since v1.7.8: the first release of the unified repository, which
brings in the MERL-T line merged on 27 September 2026.

### Sections

- VisuaLex is divided into sections: Opus (work dossiers), Gymnasium (study),
  Academia (the graph and the assistant, in development mode only) and Forum.
  A switcher at the top of the sidebar moves between them, and each section
  has its own sidebar; search and reading stay in every section.
- The section is read from the address, otherwise remembered in the browser.
- Dossiers per section: Opus lists the work dossiers, Gymnasium the study
  ones, and a new dossier takes the kind of its section.
- «Studia» is called Gymnasium in the interface and in what a connected AI
  application reads; the discussions on a passage are called «glosse».

### Reading norms

- The text as at a date: the server states which version of an article it
  returns, the reader shows it, and a dossier keeps the version it saved and
  tells two versions apart.
- «Giurisprudenza» under an article: the Cassazione's decisions that mention
  the article, one row and one year control per
  source, and the Court of Justice under an article of the Union.
- The Massimario's annual reviews: the paragraphs that cite an article, read
  by year.
- One source convention (`conventions/sources/`) names norms and decisions
  everywhere — web, server, MCP and graph — and a copy of the text in force
  starts with its citation.
- Discussions on passages of the text, with their loading and error states.
- «Importa articoli da norma» offers Regolamento UE and Direttiva UE, by year.
- «Confronta articoli» sets two articles side by side, comma facing comma.
- Brocardi is no longer a source: VisuaLex stops asking it for anything and
  shows none of its text (D-078).

### Court decisions

- A decision opens at its own address, its text read once and in paragraphs:
  the Cassazione (whole, from the court's PDF, which can be downloaded), the
  Corte costituzionale, the Court of Justice and the General Court, the
  Consiglio di Stato, the C.G.A.R.S. and the TAR.
- Decisions searched by cited norm or by text, and the Cassazione's by year.
- Decisions in the search space: from the palette, the address and the links;
  in a list a decision opens its preview first; decisions in the Cronologia.
- Notes, highlights and norm links on decisions, with the anchors that no
  longer land listed rather than dropped; discussions on decisions.
- Decisions cited in a decision or an article become links that open beside
  it, and a Corte costituzionale decision's own precedents too.
- A decision's key passages, found by rules; the preview shows the first.

### Search and find

- «Cerca nel testo» on articles and decisions, as one floating window on
  Cmd/Ctrl+F, over one tab or every tab.
- A citation in the find window finds every form a decision writes it in:
  date first, ordinal commas, «e ss.», «del c.c.».
- A search field always on the search page, and ⌘K on every page.

### Workspace

- The practice table replaces the floating tabs: practices, decisions and
  windows kept in the store, a bar of practices, and articles or decisions
  read beside the practice, two at a time. Collections are gone.
- On a phone: reading full screen, the list of practices, page headers under
  the floating menu button.
- A quieter sidebar; Grafo and Assistente sit behind a per-user development
  mode.
- The Cronologia moves to the user menu, and the avatar counts the saved
  norms that changed.

### Dossier

- Grouped by act: each act named once with its title, its articles as
  «art. N — rubrica», notes first, and a PDF that carries every text. An EU
  act gets a title too.
- Court decisions kept in a dossier, under «Giurisprudenza».
- Notes about an article sit with it; an undo keeps a note on its article.
- A trash for 30 days: a dossier deleted from the site, with «Annulla», and
  what a connected application removed, restorable from the dossier.
- The dossier page shows what a connected application adds without a reload;
  the share link carries any character and still reads the old links.
- Entries removed on the web go to the trash, with «Annulla».
- The PDF holds the dossier's decisions and can print only the marked
  passages.
- Dossiers of work and of study.

### Forum

- «Pubblica nel Forum» from a dossier, with a preview, the notes chosen one
  by one and a warning on personal data; the server filters what is published
  and imported.
- The Forum absorbs «Ambienti»: «Ai miei dossier», ready-made study dossiers,
  old environments kept read-only and old links brought to the Forum.

### Gymnasium (study cards)

- Study cards written, edited, listed and found under their article, anchored
  by the official URN.
- Reviewed with FSRS v4, with a daily goal and community subjects.
- Proposed to the community and validated by named validators; a card the
  community took up outlives its author's account.
- The study days stored, the streak and a progress dashboard, with a
  celebration of the daily goal.
- The validation thresholds (approvals, «errata» votes) set by an
  administrator, with a preview of what changes.

### Connected AI applications (MCP)

- An MCP server for Claude Code and LibreLex, with an OAuth 2.1 authorization
  server, a consent page and the list of connected applications.
- Tools for dossiers, notes, study cards and court decisions (Cassazione and
  Corte costituzionale). Deleting needs its own permission and the user's
  confirmation in the client, and goes to the trash.
- «Collega un'app AI»: how to connect an application, with a notice on
  personal data there and on the consent page.
- The MCP server runs in the production stack.

### MERL-T

- MERL-T joins the product, behind `MERLT_ENABLED`.
- One vocabulary for the graph's writers and readers, with the graph and its
  vectors migrated to it; graph labels in the source convention, with a
  backfill for the ones already written.
- The Massimario's reviews enter the graph, the vectors and the bridge.
- Lazy ingestion of an ordinary act carries its date, number and annex, lands
  on the existing node, enters as a stub, and fails with a reason.
- The doctrine layer is «Dottrina», with its source credited; bulk ingestion
  runs on its own queue.
- Personal data: consent under a versioned notice at first entry, export and
  erasure of one's MERL-T data, «Dati MERL-T» in the settings; questions and
  judgements expire after 24 months, tracking events after 12; stored events
  never keep a note's text; dead letters without personal data.
- MERL-T no longer fetches Brocardi and never shows a user its text; the data
  already in the graph stays as an internal signal (D-078).

### Fixed

- Parsing references: «615bis» and «615 bis» are art. 615-bis everywhere;
  «nonies» is an ordinal; any spelling of a norm reaches its identity, EU acts
  by CELEX; a decree searched by its year gets its own date; an annex reaches
  the norm, its URN and its citation; an article refused in the annex named
  says where it is; the parser and the palette read back every label the
  source convention writes.
- A repealed article or act reads as abrogated, whatever its markup.
- The articles of one EU act are told apart in a dossier, and an act's title
  stays in its block.
- A database hiccup no longer logs users out; no duplicate requests.
- Touch targets of 44 px on a phone (the Modal's close button, the services
  pill, the Forum card's menu); a range whose index cannot be read says so.

### Security

- The scraping routes need a login, checked by the ingress.
- Forum proposals and shared environments are rebuilt from closed values when
  published and imported, so no publisher's text reaches a citation.
- The exported PDF's cache path stays inside the download folder.
- Each client is counted at its own address behind the ingress.
- Dependency advisories patched: express (qs, path-to-regexp),
  brace-expansion, proxy-addr, source-map-js.

### Deployment and development

- One repository: every component in its place (`apps/`, `services/`,
  `tools/`, `infra/`), one stack with fixed names, data moved by
  `scripts/backup.sh` and `scripts/restore.sh`.
- `./start.sh --dev` and `--prod`: production images, the stack as Compose
  modules on three networks, `--prod --branch main|develop` pulling before it
  deploys, a daily backup timer and a reversible host firewall rule.
- The `develop` and `main` flow, with its CI checks; the same Claude Code
  rules for everyone; MERL-T's integration tests in CI against a disposable
  FalkorDB; server tests on `.env.test` alone.

## [1.7.8] - 2026-09-25

The last release of the line before the unified repository. Its history is in
`git log v1.7.8`.
