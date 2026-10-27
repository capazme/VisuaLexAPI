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
