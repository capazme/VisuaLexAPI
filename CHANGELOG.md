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
