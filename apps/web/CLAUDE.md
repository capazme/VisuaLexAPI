# Web app — apps/web

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`.

### Frontend (`apps/web/src`)

- `App.tsx` — routing. **Pages loaded with their route** (P1): Dossier, the Forum and its Community, Opus (its frame
  and views in one fetch), «Analizza documento», the Cronologia, «Crediti» and «Collega un'app AI» are `lazy` routes,
  as Gymnasium's, Academia's and the admin's were. Their modules are listed once in `pageCode.ts` (`PAGE_CODE`), which the routes,
  the sidebar's entries (`preparePage`, as an entry is pointed at, touched or focused), the section switcher
  (`SECTION_HOME_CODE`) and `main.tsx` (the address opened, fetched beside the sign-in check) share;
  `pageCode.test.ts` refuses a static import of any of these pages by any path, and of a folder index that would
  re-export one (the connections' was removed: «Collega un'app AI» was in it). Ricerca, the sign-in page, a
  decision's address (`DecisionAddress`), `/connect` and «Pagina non trovata» stay in the first chunk. An address
  opened directly fetches its lazy
  page's code beside the first chunk, not after it: the build (`routePreload` in `vite.config.ts`, over
  `ROUTE_PAGES`, which `pageCode.test.ts` keeps in step with `PAGE_CODE` and in the order of its prefixes) writes each
  page's chunks into `assets/route-preload-<hash>.js` (~1.9 KB, outside the first chunk), which `index.html` loads
  `async` and which adds a `modulepreload` for the address opened and no other. A file, not an inline script: the
  ingress's Content-Security-Policy allows scripts from 'self' only (as `theme-boot.js`). Its name carries its hash,
  so an `index.html` always names its own build's map and a cached older one is never asked for.
  Inside the layout the lazy pages wait in `RoutePage` (`components/layout/RouteBoundary.tsx`, around `Layout`'s
  outlet): a boundary on screen from the first draw, with nothing in the page's place, so nothing stays once it is
  there, and a navigation keeps the screen it leaves until the new page is ready (the router renders it in a
  transition; a boundary mounted with the new page would show its fallback at once). «Crediti», outside the layout,
  has no `Suspense` above it: it suspends the root, so opened by its address the splash of `index.html` stays until it
  is there, and moved to from the app the router's transition keeps the screen it leaves. The phone's bar names
  nothing while nothing is drawn (`usePageTitleInView`), and names the page if it then draws no `h1` (the error). A
  page whose code cannot be fetched, or that fails in use, keeps the layout and says «Si è verificato un errore.» with
  «Riprova», which reloads (the one mend for a file a deploy removed; before P1 no boundary held it and the app went
  blank); any new navigation draws the page again (`useLocation().key`: the same address with another query, or its
  entry chosen again, included).
  In the signed-in layout: `/` (search), `/dossier`, `/opus` (the planner, below: `OpusPage`
  over `oggi`, `prossimi`, `ingresso` and `cestino`; `/opus` redirects to `oggi`),
  `/studia` (VisuaLex Gymnasium, the study cards; the code keeps the name `studia`: `StudiaPage` with its views under
  `components/features/studia/`, `studiaService`; behind `VITE_FEATURE_STUDIA`, default on
  (`features/studia/featureFlag.ts`; in production a build argument of the ingress image, key only
  in `infra/compose.app.yml`), which also takes Gymnasium out of the section switcher; `/studia` redirects to `ripasso` (see «Card review» below); `/studia/progressi` is «Progressi», the page of the data (see «Progressi» below); «Le mie schede» is
  `MyCardsView` — `useMyCards` pages through `ordine=materia` and groups subject → institute,
  the selected card is the route `/studia/schede/:id`, an anchor opens its article through
  `triggerSearch` as the dossier's rows do; with no card open the cards are tiles across the frame (G8: two
  columns from `lg`, three from `2xl`; `CardGroups`' `grid`), each with its front in Newsreader, its subject's dot,
  its state and its next review, and with one open the list is a column beside it; the filters (`CardFilters`) are one
  row from `lg` (the search a third, the selects, «Scritte da Claude» and «Da ripassare oggi»), behind «Filtri» under
  1024 px; the search box's hint is «Cerca per istituto o domanda» from `sm`, «Cerca nelle schede» below, «Cerca» under 360 px (it was cut, Q1),
  its name «Cerca nelle schede» at every width, and below `sm` «Per istituto o domanda» its description; the act filter offers the acts of the cards listed,
  keeping what a narrowed list hid until a deletion starts it over; each card shows the next review,
  `nextReviewLabel`, and «Da ripassare oggi» filters with `dovuteOggi`; «+ Nuova scheda», beside the page's
  title (portalled into `StudiaPage`'s `actionSlot`, from the outlet's context), and the empty list's «Scrivi la prima scheda» (Q1), open `CardFormDialog` with `{ kind: 'create' }` and no article (no
  fixed anchor, the reference field open, the anchors typed as «art. 1455 c.c.», which `POST /lingo/cards`
  resolves; saved with no anchor, the reference field stays open and takes the focus; the field has «Aggiungi»
  only — Esc or an empty «Aggiungi» closes it — so the dialog's «Annulla» is the one; the form's body goes back
  to the top once the dialog's first focus lands, which had left «Materia» scrolled out; a 502/503/504 says the
  service is not available at the moment, only a call with no answer asks to check the connection), and is drawn only while
  Normattiva answers (`useCardSources` over `cardSourcesAnswer`, the cached `/health/detailed`, read once per
  mount; the empty list says «Non hai ancora schede.» and what a card is (Q1), then, once the sources answer, the solid
  «Scrivi la prima scheda» (the same form); until they answer it says no way to begin, with the sources down it points to an
  article and promises nothing; after the first card is saved the title's button takes the focus); the detail proposes a draft
  («Proponi alla comunità» asks for the notice through `AcceptTextDialog`, the one place a text to
  accept is drawn — every word from the server's version, the body as `TextParagraphs` plain text) and
  withdraws a proposal, and reads a card past the drafts again by its id for `approvazioni` and the
  validators' `rilievi`, which the list does not carry (a failed read says so, with «Riprova»); the admin page's «Testi di VisuaLex Gymnasium»
  tab (`features/admin/StudiaTextsAdmin`, which keeps an unsaved draft across a reload) saves a text as a new version and its user list
  names the validators; both follow `VITE_FEATURE_STUDIA`. «Da validare» is `/studia/valida`
  (`ValidationQueueView`), linked for validators only (`useAuth().isValidator`, from `lingo_validatore`
  on `/auth/me`; the server checks the flag on every call): `useValidationQueue` shows the proposed cards
  one at a time, oldest first, refilling when two are left; the primary anchor's article sits beside the
  card read-only (`ArticleReadOnly`: the reader's text, copy only, no marks; on a phone a collapsed «Testo
  dell'articolo»); `VoteBar` sends Approvata at once and asks a reason for Migliorabile and Errata, and sits
  `sticky bottom-0` at every width (the keyboard moves to the next card's heading after a vote, back to the
  verdict after «Annulla»; below `md` no feedback button floats over it, nor over any page: there it is the user
  menu's «Invia un commento», M1; from `md` it floats at the bar's right end, which keeps 56 px clear for it,
  `md:pr-14`, G8c); the subject is remembered in `localStorage`; a vote that outlives a subject
  change only marks its card handled, and a 403 stops the queue with «Non sei più tra i validatori»; the queue is
  read only once the outlet's `validator` is `true` — while the account loads it waits, for someone the account
  says is not a validator it shows «Questa sezione è riservata…» with no request, which the server would refuse with
  403, and when `/auth/me` failed (`validator` null, never taken for «not a validator») it reads and the server decides),
  `/history`, `/forum` («Dossier pubblici»; `/environments`, the page «Ambienti» was, redirects there keeping an old
  share link's `?import=`), `/forum/community` («Community», `ForumCommunityPage`: an honest placeholder — titled
  «Community» under the Forum's phrase (L-37), an empty state composed for the page, «Le discussioni arrivano presto»
  with «Esplora i dossier pubblici», see `features/bulletin/` below; no sample posts, no counts, no server route), `/documents`, `/collega-app` («Collega un'app AI»,
  `features/connections/ConnectAiAppPage`: the MCP address from `GET /api/oauth/connection` with
  «Copia», one card per client that connects today — `aiClients.ts`, the survey of 13 Oct 2026, with
  the clients our server refuses listed apart and why —, the personal-data notice (what a connected app reads: dossier
  names, entry titles and citations, study cards; no clients' personal data there, or only trusted AI apps — the owner,
  13 Oct 2026, in place of pseudonymisation; the consent page `/connect` carries the same notice), what a connected app can do, and
  `ConnectedAppsSection`, the same list Impostazioni shows; reached from the user menu. The page has two parts, named
  by two anchors at its top: «VisuaLex» (`#visualex`, all of the above) and «mcp-legal-it» (`#mcp-legal-it`, a
  separate MCP server installed on the user's own computer, no account, drawn whatever the address says):
  `legalItClients.ts`, the same card shape (`ClientCard`, without the deletion line), uv first, Claude Desktop and
  Claude Code, the clients that cannot run it, the rest left to the README. Its privacy sentence is the owner's,
  word for word; it writes no version number (`releases/latest`, `legal-it-….mcpb`), links only to the repository
  and its latest release, names neither the licence nor Brocardi — `legalItClients.test.ts` reads the file and
  checks all of it), then `/sentenze` and
  `/sentenze/:corte/:numero/:anno` (both `DecisionAddress`: they redirect to `/`, a decision
  address queues the decision for the search space to open in a practice; `/sentenze` alone and an
  address that does not parse both open the palette, and only the address that does not parse
  says why, in the error toast (`pushSyncError`); the addresses stay the contract with LibreLex
  and the graph), then the MERL-T pages `/merlt` (the hub), `/merlt/contribuisci`, `/merlt/valida` and
  `/grafo` (`/merlt/qa` and `/merlt/chiedi` redirect to `/grafo`), and a 404 for
  anything else. The MERL-T routes are always registered, each inside `DevRoute`: without the
  development mode (below) the address redirects to `/`. `VITE_FEATURE_MERLT`
  and `VITE_FEATURE_MERLT_GRAPH` decide the Sidebar's «Assistente» and «Grafo»
  entries and whether a page says it is unavailable. Outside the layout:
  `/login` and `/register` (one page, `components/auth/AuthPage`, A1: the colophon — the mark, «VisuaLex»
  and one sentence — beside a card with two
  tabs, «Accedi» and «Registrati» (`LoginForm`, `RegisterForm`, their shared classes in `authForm.ts` and parts
  in `AuthFormParts.tsx`); one parent route over both addresses, so a change of tab replaces the address — the
  router state that carries the return after the login travels with it — and keeps the page mounted. The tab
  is the page's own state, read from the address when it opens: React Router 7 applies a navigation in a
  transition, so a tab read from the address would lag one render behind the click. `useAuth` runs
  once, in the page, and `LoginForm` takes it as a prop. The card takes the height of the form shown (A1c,
  Luca, 22 Oct 2026; it replaced A1b's card as tall as the taller form, which left «Accedi» a box of empty space):
  both forms stay mounted, the one not shown out of the flow (`absolute` from the box's top), `invisible` and
  `inert`, and the box that holds them is as tall as the shown one (`height: auto`, always clipped by `overflow: clip`,
  which makes no scroller); only across a change of tab is its height written, from where the box is to the new
  form's, read after the commit (a fresh «Registrati» after a sign-up), in 220 ms, let go at `transitionend` (at once
  under reduced motion); each form keeps what was typed in
  it, and its error (after a
  sign-up, the confirmation stays until the tab changes, and back on «Registrati» a new key mounts the form
  empty; «Torna ad Accedi» finds a fresh sign-in form too, a new key, with the failure the page's `useAuth`
  still holds not shown); «Crediti»
  is the last row of a grid as tall as the window; the page is its own scroller (`h-app`) with
  `scrollbar-gutter: stable`, so a low window does not shift sideways when a bar appears; on a computer the
  card's top sits where the card on «Accedi» is centred above the foot (`--login-card-h`, its measured height), so
  «Registrati», or a form that grows (an error), grows downwards, the tabs never move and the page scrolls when the
  window is too low, and the colophon is centred against the card on «Accedi» (as tall as it, `md:min-h`; text
  left-aligned; on a phone centred above it) and holds still; its title is 48 px up to `lg` and 68 px from it
  (between 768 and 1023 px the column beside the card is about 200 px).
  **The wordmark** (A3, replacing A2's seven-segment display; inspired by a signature written with a pen, written
  from scratch in CSS, `index.css`'s `vlx-ink-*`): one face, one ink, once per opening, about 1.3 s. The book traces
  itself (`BookMark` with `vlx-ink-book`, 450 ms); a faint, blurred copy of «VisuaLex» comes out from under a mask whose
  soft edge (12 %) is the pen's tip — `--vlx-ink-edge`, an `@property` percentage, 250–950 ms — and the word itself
  follows it 100 ms behind under its own (350–1050 ms), so each letter is faint and soft before it is sharp; the copy
  fades as the ink ends, and the line under it rises 4 px into view (200 ms). The waits are inside the keyframes, not
  delays. The word is one text throughout, the copy stacked on it in one grid cell (`aria-hidden`, not selectable):
  never split into letters, which lose their kerning on WebKit and settled 1–3 px when joined again. On the ink's
  `animationend`, or its `animationcancel` (listened to on the element, React has none: reduced motion turned on
  halfway), the copy and the mask go, so the finished page is the page without the animation (the text's box
  measured identical at every moment). On WebKit for iOS (`inkMark.ts`, `isIOSWebKit`: an iPhone, an iPod, an iPad,
  an iPad with a Mac's user agent and touch points) the word only fades in from the left, no mask, no blur — the
  brief's fallback for a mask that stutters. The animations sit inside `prefers-reduced-motion: no-preference` (as
  `vlx-book-draw` does): the global reduced-motion rule cuts durations, not delays, and a delayed `backwards` would
  have hidden the line for a second; under reduced motion nothing is written and the colophon fades in through that
  rule's 150 ms opacity transition. Measured in Chromium only (headless, at 1920 and 390, the iOS path by its user
  agent): not on Safari nor on a phone. The register form fits a window 768 px high
  inside (1366×768, 1470×753 measured as viewports; a 768 px screen with a browser's bars scrolls a little) by
  its spacing (`space-y-4` between fields, `space-y-1.5` inside one), the sign-in form spaced the same. While a sign-in or a
  sign-up is on its way the tabs hold still (`aria-disabled`): its answer would land on the hidden form. A
  return address that is the page itself (`isLoginPage` in `utils/returnTo.ts`, either tab) goes to `/`
  instead, or the entrance would stay on screen. Each form has a visually hidden
  `h2` («Accedi», «Registrati»), the tab being its heading on screen. A click or the link under a form puts
  the cursor in the new form's first field (once it is enabled), the arrows keep it on the tabs; the mark
  slides by `transform`, the form leaving fades (its `visibility` follows at the end of the fade; the form
  coming in has no transition, which would hold it hidden for a frame and lose the focus sent to its first
  field), the next comes in from the side of its tab, and under reduced motion the change is immediate; the wait for approval
  after signing up is drawn
  in the same card), `/crediti` (public, below), `/connect` (the consent page an MCP client's
  authorization request lands on: signed in, the user approves or refuses) and
  `/admin/*` (admins only).
- **The credits** (C1, 19 Oct 2026): `data/credits.ts` is the one source of truth for a source's
  licence, its conditions and its line of attribution — one typed entry per source (`id`, `group`,
  `name`, `holder`, `uses`, `terms`, `attribution`, `sourceUrl`, `licenceUrl?`, `verified`), read by id
  with `getCredit` and linked with `creditHref` (`/crediti#<id>`). **No screen writes a licence or an
  attribution by hand**: a new one reads its entry. Those that predate the file still do, until C2 and
  after move them to it: the Corte costituzionale's PDF (`decisionPdf.ts`: `LICENCE_URIS`, `licenceLine`,
  the footer's «Fonte: … · licenza …»), `DecisionView`'s footer, `EuCaseLawBlock`'s «Fonte: EUR-Lex / …»,
  `CitationPreviewPopup`'s «Fonte: Normattiva», `RassegnaPassage`'s Massimario line and
  `DOCTRINE_ATTRIBUTION` (`utils/doctrineLabel.ts`, Brocardi, which has no entry); and, once the maxims are
  shown, the line under them. The `attribution` lines are legal text the owners approved, copied verbatim
  (`credits.test.ts` holds each; never restyle one, as for root rule 23); `uses` and `terms` come only
  from the conditions read on each source's page and the owners' table, and a source enters only once
  its conditions are clear (today group A: Normattiva, EUR-Lex, Corte costituzionale, Cassazione,
  giustizia amministrativa, Senato, CONSOB, CeRDEF; and Newsreader and Geist — Geist Mono in Geist's
  entry —, OFL-1.1 as their `@fontsource-variable` packages say: the test reads the packages, and fails
  when `main.tsx` loads a typeface no entry covers). Normattiva carries the site's
  conditions, never the open data's CC BY 4.0; the Corte costituzionale «CC BY-SA 3.0» with no version.
  `/crediti` is `pages/CreditsPage`: public (outside `ProtectedRoute`), a page to consult in the frame's whole width
  (U1d): the opening at a reading measure, then from 1024 px an index «In questa pagina» (`nav`, 220 px, sticky,
  `aria-current="location"` on the group being read, from the scroll — `creditsIndex.ts`'s `groupAt`: the last section
  past 30 % of the window, the last at the page's end; a group an address or the index reached stays marked while the
  page stays there (`groupOf`: `/crediti#cerdef` marks «Autorità e registri», not the last group the page's end would);
  marked by weight and a bar, not a tint alone; the same item pressed again goes there again) beside the sources, on a
  phone rows that wrap, every group in sight, the bar under the place being read (`min-w-0`, or the grid item widens
  the page); a section per group
  (`CREDIT_GROUPS`, its `id` the group's, `/crediti#giurisprudenza`), the entries as cards of equal height, two a row
  from 1280 px; an `article` per entry whose `id` is the anchor — the page scrolls to the address's
  fragment and focuses the entry, since the router renders after the browser looked for it —, external
  links in a new tab with `rel="noopener noreferrer"`, every text breaking anywhere rather than widen a
  phone's page. Reached from the login's foot and the user menu's «Crediti».
- **The version's news** (R1, 21 Oct 2026): `ui/ChangelogNotification` (mounted by `Layout`) toasts «Novità in
  vX.Y.Z» when `/version` names a version this browser has not seen (`useVersionCheck`, the last one kept in
  `localStorage`; nothing on a first visit), and «Vedi» opens the notes for the people who use VisuaLex, which
  are the web's own: `content/novita/<X.Y.Z>.md`, one per release, the Italian note of the GitHub release
  without its title, read by `content/novita/releaseNotes.ts` (`newsSince`: the new version, and the versions
  with a note skipped since the last visit, the newest first; one version under the title «Novità in vX.Y.Z»,
  several under «Novità dalla tua ultima visita», each headed «Versione X.Y.Z»; a version with no note says
  «Correzioni e miglioramenti»). The component stays mounted, so the toast and the window leave with their
  motion, and once they go the focus returns to where it was before it entered the toast, or, when it came from the body (a click on «Vedi»), to `Layout`'s `<main>` (`utils/focusPage.ts`: focusable only while it holds it — a `tabindex` it kept would make every click on the page focus it); a screen reader
  hears «Novità in vX.Y.Z» from a status region drawn from the first render. The number comes from the server
  and the note from the bundle, so the version is marked seen only when the bundle has its note
  (`hasReleaseNote`): a tab opened before a deploy shows «Correzioni e miglioramenti», and after a reload the
  real note. A note is the GitHub release's text word for word. `/version` gives the number only: its `changelog` comes from
  `git log`, which the production image does not carry, so it is always empty there (the technical panel in
  Impostazioni still lists it). A note is plain Markdown and only this much: a bold line heads a group, `- `
  an item, `**bold**`, `*italic*`, `` `code` ``, drawn as React text (no HTML, no links, no `#` heading, no
  numbered list). The release pull request adds the note with `version.txt` (`docs/git-workflow.md`):
  `releaseNotes.test.ts` fails when `version.txt` names a version with no note, on a file not named after a
  version, on a `#` heading or a numbered list, and on «Brocardi» in a note, which writes «una fonte esterna
  di dottrina».
- `store/useAppStore.ts` — Zustand + Immer, the single global store.
- `types/index.ts` — shared types. `services/` — one file per backend entity.
- `components/features/` — `search`, `workspace`, `dossier`,
  `bulletin` (the Forum, which absorbed «Ambienti»), `history`, `compare`, `settings`, `studia` (VisuaLex
  Gymnasium: the study cards, see `/studia` above and «Study cards under the article»),
  `documents`
  (`DocumentReviewPage`, «Analizza documento»: citations found in a TXT/Markdown/HTML/DOCX the
  user chooses or drops on the box — read in the browser (`documentFile.ts`), never uploaded, no
  request at all — each opening the reader through `navigate('/')` + `triggerSearch`, gotcha 15. The
  document is drawn as it is (`DocumentText`: every character once and in order, the citations only
  wrapped in a `<mark>`, the test compares the drawn text with the file's), the citations listed beside
  it by act (`citationGroups.ts`, pure: an act is its type, number and year, so «l. 241/90» and
  «l. 241/1990» are one; a code by its name); a mark selects its row, a row scrolls the text to its mark
  (the column; on a phone, where the columns are stacked, the page as well when the column is not wholly
  in sight) and pulses it once (`--doc-pulse`, the theme's toga step); the box closes upwards, then the
  result comes (`AnimatePresence mode="wait"`: both at once flashed a scrollbar), and the first 8 rows
  enter 40 ms apart, none of it under reduced motion. **The box** (`DropZone`, D6, a native `<button>`: the click,
  Enter and Space open the picker) follows a file from `dragover` alone — `dragenter`/`dragleave` fire between
  children —, on `window`: `idle`, `page` (a file over the window), `over` (over the box, which leans the sheets
  towards the pointer), back to `idle` 400 ms after the last event (the HTML standard lets a still pointer send a
  `dragover` only every 350 ± 200 ms; the brief's 200 could rest the box under a file still held). Its frame is an SVG measured on the box: dashes
  that stand still at rest and turn slowly under a mouse or the keyboard's focus (`vlx-dash`, `stroke-dashoffset`,
  paused by default; Bill: nothing moves for ever on an open page), in ink and faster over the window, one line over
  the box, all stopped in a hidden tab (`data-tab-hidden`) —
  three strokes shown by their opacity, as the tinted ground: only transforms, opacity and the dash offset move;
  three sheets in a pile fan out, then open wide (Framer Motion, `spring.gentle`); let go, they settle and a wave
  runs in from the frame, and the ink sheet flies to the document's row (`SheetFlight`, in a portal, taking the
  kind's colour by a veil's opacity). The row (`DocumentRow`, `documentJob.ts`): the kind's mark (DOCX ink, HTML
  amber, Markdown and TXT slate), the name cut with an ellipsis, the size, «Leggo il documento…» then «Cerco le
  citazioni…» (the search after a frame, so the words are on screen) over a bar that slides — no percentage it
  does not know —, the check for 450 ms, then the text; a refusal turns it red, shakes it once (`vlx-shake`, 300 ms)
  with its reason, and ✕ slides it away. «Il file resta nel tuo browser» is in the box in every state; a phone
  says «Tocca per scegliere un documento». A polite live region says «Documento in lettura» (the search for citations is too short
  to say), «Pronto», the refusal, then the count. Several files let go at once: the first is read, and its row says
  «Letto il primo dei N file: uno alla volta». Under reduced motion the dashes stand, the sheets change place without
  moving, and nothing is thrown, bounced or shaken. While `/documents` is open it refuses a file
  dropped **anywhere in the window** but on its box (the same `dragover`/`drop` listeners on `window`, so the
  browser does not open the file in place of the app): a drop zone added elsewhere on the page, or in
  the shell, is neutralised there until those listeners let it through) and `decisions`
  (`DecisionView`, the body of a decision wherever it is drawn; `DecisionEntryView`, a practice's
  decision read in its row, its window or the phone's reader, over `useDecisionAnswer` (the fetch, the
  candidates, the notices) and `DecisionAnswerBody`; `DecisionAddress`, the `/sentenze/…` route element;
  `DecisionLink`, a decision named by other data (the Massimario's chips);
  `DecisionPreviewDialog` (with `useListDecisionPreview`, its own file), the preview a list opens on a decision (see «A
  decision in a list opens its preview» below);
  `DecisionTextView`: a court decision's text; `DecisionReadingSurface`: the same text with the
  reader's marks and the norms it cites as links; `DecisionDownloads`: its two PDF buttons; `DecisionResultList`, the Cassazione's decisions for an
  article or a topic, `EuCaseLawBlock`, the Union's courts' decisions that cite an article of a regulation or a directive, and `DecisionSearchTabView`, a topic search's window (or the phone's reader); design `docs/superpowers/specs/2026-10-01-sentenze-design.md`).
- `components/layout/` — `Layout`, `Sidebar`, `ReaderLayout`, `PageFrame`. **The page frame** (W2, 21 Oct 2026):
  `PageFrame` is the frame of every section page — the layout's own width (`Layout`'s `max-w-7xl` and its padding: a
  1216 px column at 1920 px) with nothing narrower inside, the `h1` at the column's left edge in one size
  (`PAGE_TITLE`: Newsreader, 28 px on a phone, 30 px from `md`) — the page's name, with its section's phrase over it,
  small (`kicker`: «Gymnasium · la tua palestra giuridica», `PAGE_KICKER`, Geist `text-sm` slate 600; L-37, the owner,
  22 October 2026) —, the sentence under it (`line`, at a reading
  measure), the main action on its right from `md` and under it on a phone (`action`), and no icon beside the title;
  a header with an action pads its right side from `lg` just enough to stay clear of `Layout`'s fixed Focus button
  (`FOCUS_BUTTON_CLEARANCE`, from `--sidebar-width` and `100vw`: up to 44 px, the button's width, nothing once the
  window is about 1590 px wide — between 1024 and 1550 px the button covered «Svuota cronologia» and «Gestisci»);
  `section` marks a section's home for the switcher's focus (`data-section-title`, `tabIndex={-1}`, `FOCUS_RING`).
  It draws the dossier list, «Dossier pubblici», Community, Gymnasium (every view but the lesson, through
  `StudiaPage`), Opus's planner (`OpusPage`, its views the frame's width), «Analizza documento», «Collega un'app AI» (its body keeps a column of 768 px: it reads as text, the
  title does not move), the Cronologia, the MERL-T hub and, since S7b, the graph («Grafo», the window's height: its
  canvas under the frame's header); «Cestino» and the MERL-T pages under a way back
  («Torna ai Dossier», «MERL-T») write their `h1` with `PAGE_TITLE`. A dossier's own page is in the frame since S7c
  (`DossierDetailView`: its name the title, under «Torna ai Dossier»; see «Dossier»). Impostazioni (a dialog, not a page), the Scrivania, the lesson, the reader and the practice, the
  login stay out; «Crediti», public and outside the layout, is in the frame since M1 (the column's width and padding;
  since U1d its whole width, an index beside the sources). On a phone `actionBeside` keeps icon-only actions on the title's row (the dossier list's
  «⋯» and «+»). `PageFrame.test.tsx` reads the section pages' files
  and fails on a title of their own, an icon in an `h1` or a root narrowed with `mx-auto max-w-…`. `Layout`'s content
  area keeps the scrollbar's room (`scrollbar-gutter: stable`) on every page but the search page: a page that grew past
  the window as it loaded drew its 8 px bar and moved the centred column 4 px sideways. From `md`, for someone signed in
  and on every page but the search page, it ends 16 px over the floating feedback button (G8c: it covered the last row
  on the right, «Ripassa» of the last subject on «Oggi»): `--page-foot` (5.375 rem: the button's 24 px off the edge,
  its 46 px and the air) as the bottom padding, which a page sized to the window takes off its height
  (`GraphExplorerPage`, `DocumentReviewPage`'s columns: `var(--page-foot,2rem)`); a bar pinned to the bottom keeps the button's room at its right end
  («Da validare»'s votes). **The sections** (D-076, spec
  `docs/superpowers/specs/2026-10-18-sections-switcher-design.md`): Corpus is the common core and no section;
  over it Opus, Gymnasium (the code's `studia`), Academia (development mode only) and Forum, in
  `features/sections/` (`sections.ts`: names, lines, icons, home addresses, `sectionForPath`; `useSection`: the
  active section — from the address on `/opus/*`, `/studia/*`, `/forum`, `/merlt*`, `/grafo`, else the last one, kept in the
  browser under `visualex-section`, Opus by default; `SectionSwitcher`: at the top of the sidebar,
  `#tour-section-switcher`, a menu of `menuitemradio` entries with its own keyboard (arrows, Home/End, Enter/Space,
  Esc back to the arrow, Tab, a click outside), a dot for the Forum's news from another section, Opus's count of today's tasks on its entry; where the bar writes
  the section's name — from `xl` and in the phone's drawer — a split button (S6): the mark and the name go to the
  section's home («Vai a Gymnasium: Oggi», `goToLabel`, `homeName`), an arrow after a thin rule opens the menu; in
  the rail one button, the mark, opens it. Its motions are `sectionMenuMotion.ts`, Web Animations: the menu unrolls
  from the top in 260 ms (an `inset` clip with the same four lengths at both ends, a scale from 0.97), the arrow
  turns, the entries come in 40 ms apart; the page changes on the click; one check slides to the entry chosen (180 ms) and the
  menu closes by itself 200 ms later in 180 ms, while the name rolls to the new one and the button takes its width
  (220 ms) — all counted from the first frame drawn after the choice, since T1's hold draws nothing until the new page
  is there, and measured there, never in the commit (a forced layout, or a change of weight or attribute on the menu
  at the click, cost the change 20–35 ms on the slow machine); under reduced motion nothing moves and the menu goes at
  once; in the drawer it is the drawer's width less 32 px, with entries of 56 px, and goes at once with the choice,
  the drawer closing over it). **The section change** (T1, which replaced S2's halftone on the owner's word, 21 October 2026: light, and never
  over the page): `chooseSection(id)` plays `sectionTransition.ts`, a View Transition on `vlx-page` only (`index.css`) —
  the layout's content area, not `<main>`, so the bars at the top and the floating buttons hold still. It is named only
  while a transition runs (`lib/pageTransition.ts`, the class `vlx-page-changing` on the root; the sign-in page's
  entrance goes through it too): a `view-transition-name` makes a stacking context (gotcha 22), and `<main>` keeps
  its own with `isolate`. The content fades out in 100 ms, then the new one fades in rising by 5 px in 140 ms,
  `--ease-out`: 240 ms, no overlap, nothing drawn over the screen; the root and the groups do not animate (a group's
  default 250 ms would outlast the change, `theme.test.ts` checks the budget), the root's pictures do not blend
  (`mix-blend-mode: normal`: the default `plus-lighter` adds old and new, the old sidebar's entries showing through
  the new, a light page washed out), and `::view-transition` takes no pointer, so a tap reaches the page. The
  240 ms start once the new page is there: the router renders a navigation in a transition (`flushSync` would not make
  it synchronous), so the old page's picture holds for the new title, at most `HOLD_MAX` (150 ms), watched by a
  `MutationObserver` — the browser draws no frame, so no `requestAnimationFrame`, while the update is pending. A heading
  that already named the section before the swap (the dossier list's says the kind it last listed) is not taken until
  that hold is over. The pages loaded on demand (Opus's, Gymnasium's, Academia's, the Forum's) are fetched when the
  switcher opens (`SECTION_HOME_CODE`), or the first change would play over the page it leaves (Opus, the Forum) or
  fade into «Caricamento…» (Gymnasium, Academia), the new page coming after the hold. The
  switcher's mark passes to the new hue in 200 ms (`transition-colors duration-200`), the change's one touch of colour;
  the sidebar's new entries fade in, the first six 20 ms apart, the old ones simply go (`useEntriesEntrance`, Web
  Animations, opacity only, never on the sidebar's first draw). The section's entries are a `LayoutGroup` of their
  own, so the active dot does not slide from the old section's entries — nor, since, between «Ricerca» or «Analizza
  documento» and a section's entry: it appears there. A tap or a key during it brings it to its end (`skipTransition`;
  Enter, Space and Esc are taken, so they do not press the switcher again, and let go as soon as it is skipped); a
  second choice ends the first; the browser's Back drops it — no swap if the update had not run, and the wait for
  the title stops, so the section just left's title takes no focus. Chosen in the phone's drawer (`SectionSwitcher
  inDrawer`) the page changes at once, with no transition: the drawer closing over it is the change, and the content's
  picture would be drawn over the drawer and its veil. The focus goes to the
  new page's title unless the user moved it meanwhile: each section's home marks its heading
  `data-section-title="<section id>"` with `tabIndex={-1}` and `FOCUS_RING` (`PageFrame`'s `section`), so a keyboard user sees where the focus
  went — and only a keyboard user: the browser counts a focus the script gives after a focused menu entry as visible,
  so a choice made with a pointer (the entry's click in `SectionSwitcher`, `detail` above 0) marks the title
  `data-pointer-focus`, which `index.css` draws with no ring, until it loses the focus (Gymnasium's `h1`, Opus's — the planner's, `OpusPage`, on «Oggi» —, the dossier list's
  `h1` — `opus` or `gymnasium` by the kind it lists, since the same element stays from one to the other —, «Dossier
  pubblici», the MERL-T hub); a new home marks its own. Under reduced motion the page changes at once and nothing moves; without View
  Transitions the page changes at once, and only the mark and the sidebar's entries move. Choosing the section one is
  in goes to its home
  with no change shown. The sidebar: the Corpus entries for everyone — «Ricerca»
  (a link to `/` that puts the cursor on the search page's field, `focusSearchField({ focus: true })`, with no
  window over it — the owner, 13 Oct 2026; the first key typed opens the search menu with it; its hover label
  carries ⌘K, the palette; the quick norms' dot sits under it;
  `#tour-nav-search` is what the welcome and search tours point at) and «Analizza documento» —, then the active
  section's, in a group named after it: Opus, «Oggi» (the home, `/opus/oggi`, with the count of overdue and today's
  tasks, named in words: «Oggi, 3 compiti per oggi o scaduti»), «Prossimi giorni», «Lista d'ingresso» and Dossier;
  Gymnasium in two groups (Gymnasium spec §4), «Studia»
  (Oggi, the home `/studia/ripasso`, Progressi, `/studia/progressi`, and Dossier) and «Contribuisci» (Le mie schede, Da validare for validators);
  Academia, Assistente and Grafo (`VITE_FEATURE_MERLT*`); Forum, «Dossier pubblici» (`/forum`, with the Forum's count;
  `end`, so it is not active under `/forum/community`) and «Community» — the section keeps its name and its areas are
  named apart, so «Forum» is never written twice. The section's line is «Dossier pubblici e community». The sections'
  phrases (the owner's, 19 Oct 2026: «la tua palestra giuridica», «la tua officina giuridica», «il luogo del dibattito
  giuridico»; Academia's, «il laboratorio del diritto», 22 Oct 2026) live in `SECTION_PHRASES` (`sections.ts`) only, and since L-37 (22 Oct 2026) go over a page's title as
  `sectionKicker`'s «Opus · la tua officina giuridica», `PageFrame`'s `kicker`; the title is the page's name — Gymnasium's
  views («Oggi», «Progressi», «Le mie schede», «Da validare», `StudiaPage`), Opus's («Oggi», «Prossimi giorni», «Lista
  d'ingresso», «Cestino dei compiti», `OpusPage`; a view's own `h2` stays for screen readers and the focus's
  fallback), the Forum's «Dossier pubblici» and «Community». Academia's «Assistente» and «Grafo» too, under «Academia · il
  laboratorio del diritto» (Bill and the owner, 22 Oct 2026); `kickerOf` draws no line for a section with no phrase. The switcher's Opus entry carries the same count as «Oggi» (`MenuItem.badgeLabel` names
  what a count counts; without it «N notifiche»), and no dot: it is a to-do, not news. A count is 11 px on red 600.
  **Words, not only icons** (`layout`, `sidebarWidth.ts`): from `xl` the desktop column is a 224 px bar with
  icon and word and the groups' headings (the section's name, or «Studia» and «Contribuisci»), the palette's
  shortcut beside «Ricerca» (⌘K on a Mac, Ctrl K elsewhere); between `lg` and `xl` the 64 px rail of icons, each labelled on hover and keyboard focus; below
  `lg` the drawer, icon and word in rows of 44 px, its foot clear of the home indicator. From `xl` a control
  at the foot narrows the bar to the rail and widens it again, remembered in the browser under
  `visualex-sidebar` (`guardedStorage`); wide by default. Every column keeps 10 px of side padding and every
  icon a 44 px box, so widening moves no icon: `Layout` animates the column's width (instantly under reduced
  motion) and the words are clipped as it moves. With words the user menu opens over its button, not beside,
  and the button's name carries the username it shows («Menu utente di …», label in name).
  `Layout` sets the column's drawn width on its root as `--sidebar-width` (224, 64, or 0 hidden or in Focus
  mode), for what would float beside it from `lg`: nothing does since the services pill went into the user menu (S1).
  The bar's 11 px texts (headings, shortcut) are `SIDEBAR_SMALL_TEXT`, slate 600 / dark slate 400: AA for small
  text on the glass over the page and over the phone's backdrop; `theme.test.ts` composites and checks it.
  The narrow/widen control is `SIDEBAR_TOGGLE_TEXT`, the entries' words' colour (slate 700 / dark slate 300). At the bottom only the user menu, whose dropdown holds Impostazioni,
  Cronologia (moved there by the owner, 13 Oct 2026; the saved norms that changed are counted on the avatar
  and beside the entry, and both names say it in words: «Menu utente, 2 norme salvate cambiate»),
  «Collega un'app AI», «Crediti» (`/crediti`), on a phone «Invia un commento» (the feedback form, which `Layout` holds and
  the floating button opens from `md`, M1), the services' status, the theme, «Scorciatoie» (no «(?)» since S1: the `?` key still opens it),
  «Pannello Admin» (admins) and «Esci». **The services' status** (S1, 19 Oct 2026; it was a pill fixed at the bottom left,
  over the foot of the page on a phone) is `ui/ServiceHealthMenuEntry`: the status icon and phrase («Servizi operativi»,
  «Alcune fonti non disponibili», «Servizio non raggiungibile», «Controllo servizi…», `utils/serviceHealth`; a screen
  reader hears «Stato dei servizi:» first); a tap opens, inside the menu, each service with its state and latency
  (`menuitem`s that do nothing, so the arrows read them, named «Backend dati utente: OK, 12 ms»; not `aria-disabled`,
  read as "unavailable") and «Ricontrolla», which keeps the menu open; it opens folded each time. `Layout` runs the one `useServiceHealth` and
  hands the reading to both copies of the sidebar; when it is degraded or offline (not while checking) an amber dot
  (`ServiceHealthDot`) sits at the foot of the avatar — clear of the count of changed norms — and, below `lg`, on the
  menu button of the phone's bar, and both names end with the phrase («Menu utente di …, alcune fonti non disponibili»). The menu
  grows upwards and scrolls rather than leave a low window. The dropdown is a portalled WAI-ARIA
  menu (`role="menu"`/`menuitem`): focus goes to the first entry on open (ArrowUp opens on the last), the arrows,
  Home and End move, Esc closes and returns focus to the avatar, Tab closes and goes on from the avatar, the
  backdrop closes; entries are 44 px high on a phone. **The phone's bar** (M1, 21 Oct 2026): below `lg` every page
  has one bar at the top. On the search page it is the field's bar (56 px below `lg`, 72 from it), with `MenuToggle`
  beside the field; on every other page `PhoneTopBar` (`layout/PhoneTopBar.tsx`): `MenuToggle` at the left (44 px, the
  services' dot), in the middle — as iOS's large titles (G8) — nothing while the page's `h1` is in sight under the bar
  (it says the name already: no «Gymnasium» over «Gymnasium · la tua palestra giuridica»), the page's name in Newsreader
  once it has scrolled out, faded in over 150 ms (`motion-safe:` only), on every page (`usePageTitleInView`: an
  `IntersectionObserver` on the first `h1` of the content scroller, the bar's height off its top, a `MutationObserver`
  finding a title drawn later; a page with no `h1`, or a browser with no observer, has the name at once; `phoneBarTitle.ts` over `features/sections/pageNames.ts`, the one list of the pages'
  names, which the titles read too, else the section's name) —, the magnifier on the right, which opens the search menu (the palette) and takes the focus on a
  click (Safari's does not give it), so the menu gives it back as it closes; on the page's paper with a
  hairline, absolutely placed over the content area (`Z_INDEX.floating`), which starts under it (`pt-[calc(4.5rem+env(safe-area-inset-top))]`,
  repeated at `md`), and whose `scroll-padding-top` stops what the focus or an anchor scrolls to under it (WCAG 2.4.11).
  Below `md` it slides away scrolling down and comes back scrolling up or near the top (`useHideOnScroll`, which listens
  to the content scroller below `md` only, holds the scroll top to the last real one so iOS's bounce at the end is no
  move up, and never hides while the focus is inside the bar; a new address and a focus landing in it bring it back;
  under reduced motion at once); from `md` it stays, and the Focus button sits inside its right end. A sticky row of a page pins under it
  with `top-[var(--phone-bar-offset,0px)]`: `<main>` sets the bar's height below `lg` and 0 once it has slid away
  («Le mie schede»'s filters and its card's column, the Cronologia's dates, «Da validare»'s article; a new sticky row
  does the same, or it slides under the bar). No ancestor of such a row may be `overflow: hidden` (say `overflow-clip`
  for rounded corners): it would become the row's scroll container, and the row would pin the bar's height below that
  box's top instead (the Cronologia's card did, M1, 25 October 2026). Focus mode and Gymnasium's lesson draw no bar. During a section change
  the bar is named (`vlx-phone-bar`, `index.css`), so the page's picture passes under it. The drawer's section switcher
  sits where the bar is; the closed drawer is `inert`, and whatever closes it from inside (an entry, a link, the
  backdrop) gives the focus to the bar's menu button, where a dialog an entry opens gives it back; Esc closes it
  wherever the focus is (opening it leaves the focus on the button) and gives the focus to that button, unless a control
  inside took the key (the user menu, the section switcher) or an overlay is over it (`aria-modal`, `data-find-overlay`:
  a sheet, the palette); only below `lg`, so a window widened with the drawer open leaves Esc to the page. That button is
  `data-focus-parked`: a section chosen in the drawer still focuses its new title (`sectionTransition.ts` does not
  take the parked focus for a move by the user).
  There is no «Ricerca Veloce», no
  «Sentenze» and no row of system buttons. `Layout` mounts the same component twice (the desktop column and
  the phone's off-canvas copy), so both show the same list and the same menu.
  **The search page's field** (`features/search/SearchField`, spec
  `docs/superpowers/specs/2026-10-13-fixed-search-design.md`): `Layout` draws it on `/` (not in Focus mode) in a
  bar above the content scroller (56 px and the iPhone's top edge below `lg`, 72 from it; the phone's bar there), so it
  is always on screen, and sets `--search-bar-height` on `<main>`, which `h-app-row` subtracts and the bar takes as its
  height. It is the door to the search menu (R2, brief of 21 Oct 2026: one field, no «Opzioni»): a button
  (`#tour-search-field`, `aria-haspopup="dialog"`) that shows the words and opens the palette with them
  (`openCommandPaletteWith`, or `openCommandPalette` when empty) on a click, Enter or Space, the arrows, a character
  typed on it (AltGr's too; the character goes on after its words), words pasted on it (`onPaste`, after its words),
  and ⌘K (`openSearchMenu`, `Layout`; nothing while the palette is open). Tab only brings the focus (a focus changes no
  context, WCAG 3.2.1: Bill's choice). It stands for a field (`data-text-field`): «?», ⌘Z and the page's other
  shortcuts leave it alone (`isEditableTarget`, `Layout`'s `isTyping`). Esc on it empties its words. The focus goes back to what opened
  the palette as it closes, on a phone too; the field focuses itself on a click (Safari and a tap do not focus a
  button). The palette's own tour starts only on an empty opening: opened with words,
  it would take the letters that follow.
  Everything else is the palette's: what the box reads, the first row, Enter, the steps. The palette closing with no
  choice (Esc, a click outside, ✕) at its first step gives its words back to the field
  (`returnWordsToSearchField`); a choice empties it. No practice is closed.
  **The palette's look** (`CommandPalette`, the search menu's brief O1, 20 Oct 2026): on a computer a panel that
  drops from the field's form (`SEARCH_FIELD_FORM_ID` in `utils/searchFieldControl.ts`; floating-ui puts its top on
  the field's, as wide as the field, so it covers it, as tall as what it holds up to 640 px — Bill: one row is not a
  640 px panel —, the lists scrolling inside it past that: a flex column all the way down to the columns, since a
  percentage height finds nothing definite in a panel sized by its content), hung at the top, centred, where no field is on screen (another page, Focus mode); on a
  phone the same panel, the page's width less 16 px each side, dropping from the bar at the top (R2: no bottom sheet
  any more; its «Chiudi» is the field row's ✕, drawn at every width). From the top: the box, the one strong thing, with the help
  line (12 px), or «Cerco l’atto…» while the server names it: a decision, a norm or a topic read in the box is its
  row, the chosen one, with «↵», never a second line saying the same (Bill). Enter in the box
  follows the field's order: a decision, then a wait while the server is still naming the act (the line says «la
  ricerca parte appena lo trovo», and the search runs once it answers, never after a close; any change of the words
  drops the wait, so a new Enter is needed), then a norm (a ready one searched, another taken to its next step; an alias counted once,
  there), then a topic — unless the arrows chose another row since the words changed: Enter is then that row's.
  Opened again within the 200 ms of the reset after a close, it starts at its first step all the same. The steps after the act («Dettagli», «Articolo») are subpages: the act chosen is a crumb
  in the field (`Torna indietro: <what it shows>`, the act, and its number and year on the article's step; 44 px on a
  phone) that goes back a step, and so does Backspace in an empty field (not a held one; on an empty date it goes to
  the number first); the article's field opens empty, its placeholder saying what it takes, so Backspace there goes
  back at once (a «1» standing in it took the first press, Bill); there is no trail of steps under the box. Then two columns on a computer and one on a phone, in this
  order: «Scegli l'atto» (`paletteActs.ts`: every act of `ACT_TYPES` named in full with the source convention's
  abbreviation, «Codice civile · c.c.», in 44 px rows under group headings in Geist 12 px) and «A portata di mano»
  (Preferiti, I tuoi alias with the presets' line, «In dotazione» while typing; six of each at rest, then «Tutti i
  preferiti (N)» and «Gestisci alias (N)»; empty, one quiet line each, «Crea un alias» a row like a link);
  «Filtri avanzati» closed at the foot, its state in words (`activeFiltersLabel`, `utils/searchFilters.ts`); the
  keys on a computer only. The box filters every list while it is typed (`filterPaletteActs`, `queryMatches`: each
  typed word begins a word of the row, case and accents folded, an abbreviation with or without its dots; «Nessun
  atto con questo nome»); cmdk's own filter is off (`shouldFilter={false}`): it would reorder the rows by score,
  across the columns. The order drawn is the keyboard's: on a computer the acts come first, so the row chosen as
  the menu opens is the first act (Costituzione); on a phone «A portata di mano» comes first when it holds
  something. A decision or a norm read in the box is one strong row in the columns' place, the chosen one
  («art. 2043 c.c. · Apri l'articolo ↵», «… · Completa ↵» while it lacks number or date, «… · Apri la
  sentenza ↵»), with under it only what still matches (a favourite, an alias, an act). The box sits in a
  bordered field that carries the focus ring (`focus-within`; the box itself cancels the global
  `input:focus-visible` ring), and the line under it starts 10 px below, on the line of the field's text. cmdk takes Enter, the
  arrows, Home and End anywhere inside it (Enter picks the chosen row): every control that is not the box keeps
  them (`keepKeys`), or Enter on «Filtri avanzati» would open the first act.
  On a computer the panel is a dialog («Menu di ricerca», `useRole` and `FloatingFocusManager`, modal): the focus
  stays inside, and goes back to what had it as the palette opened (the field), as it closes rather than
  once the fade is over (the manager sits outside the `AnimatePresence`); nothing had it, the field. cmdk replaces an
  id given to `Command.List` with its own, so the tour's `#command-palette-results` is on the acts' column;
  `tourConfig.commandPalette.test.tsx` checks the palette's tour against the palette drawn, on both breakpoints. Motion (R2, the second pull request; inspired by Animorio's «menu dei comandi», written from scratch with
  Framer Motion and Web Animations): the field grows into the panel (`PanelGrowth`): the same place and width, the panel
  uncovered from the field's height down to its own (`clip-path`, `calc(100% - <the field's height>)` to
  `calc(0% - 0px)`, one template so the two ends interpolate; the corners from the field's 12 px to a card's 16), in
  about 280 ms on `ease.out` (no bounce; a curve, not a spring); the clip is set before the first paint, so the panel
  never flashes open, and the growth starts once the first frame is drawn (mounting the rows is a long frame, which an
  animation started before it would spend unseen); Web Animations with no fill, so once grown nothing holds the clip and
  the card's `shadow-lg` shows. The content fades in as it grows; the first four groups come 30 ms apart, rising 4 px.
  Closing (Esc, a click outside, a choice), the same way back in about 200 ms from wherever it is (a growth cut short
  included), the panel taking no pointer meanwhile; opened again before it went, it grows back from there. Without Web
  Animations the panel is drawn at once. While the box filters, a row filtered out fades and pops out of its list
  (`AnimatePresence mode="popLayout"`, against its own scrolling column, which is `relative`) and the rows left slide to
  their places (`layout`, `spring.snappy`); a row leaving is `disabled` for cmdk and `aria-hidden` (Enter never picks a
  row no longer there); the letters the box matched are drawn in toga, semibold (`Matched`, over `matchRanges` in
  `paletteActs.ts`, one entry per UTF-16 unit; an abbreviation typed with its dots is one word). A new step slides in
  from the side it moved to; the chosen row's tint is one element carried from row to row (`layoutId`). On a phone the
  page under the panel holds still (the body's overflow, a backdrop that takes no touch scroll) and the panel is as tall
  as the visual viewport leaves (the keyboard; `100dvh` does not shrink on iOS), watched only while the menu is open on a phone. Under reduced motion everything only
  fades and nothing moves. This reverses spec `2026-10-18-redesign-inchiostro` §6.1 («no open or close
  animation») for the palette, as the brief asked. There is no «ultimi atti aperti»: the web keeps no list of the
  acts opened (the search history is the server's, read by its page alone). `utils/searchFieldControl.ts` reaches it: `focusSearchField({ text?, open?, focus? }, { wait? })` opens the
  menu from the field (with `focus`, only puts the cursor on it; with `open: false`, only sets its words, as
  `returnWordsToSearchField` does) and says whether the field took
  the request, and the sidebar's «Ricerca», which navigates first, asks it to wait (2 s) for the field to mount;
  the empty page's button and examples and the empty practice use `focusSearchFieldOrPalette`, which opens the
  palette with the same words when no field is on screen (Focus mode).
  **The palette is global**: `GlobalSearch` (the palette, `QuickNormsManager`, `AliasManager`) is mounted by
  `Layout`, so ⌘K opens it on every page at once; what it opens lands in the practices through
  `hooks/useSearchActions` (`search`, `browse`, `openDecision`, `openTopic`), which bring the reader to `/` from
  any other page. A typed search (palette, field) is marked (`isTypedSearch`, on a copy of its params, never on a
  quick norm's own) and `SearchPanel` does not run the annex auto-switch on it, as when the palette called the panel
  directly; a quick norm used from its manager is a plain trigger (`trigger`), checked as before.
- `features/devMode/` — the per-user **development mode**: `useDevMode()` (the effective flag) and
  `DevRoute` (a route element: without the mode, `<Navigate to="/" replace />`; while `useAuth` is
  still loading it draws nothing, so a reload on a development address is not mistaken for the mode
  being off). The administrator enables an account (`dev_mode_allowed`, a checkbox in `AdminPage`);
  the account switches the mode in Impostazioni («Modalità sviluppo», only for an enabled account;
  `dev_mode`, stored on the server, so it follows the user across devices). `useAuth` exposes
  `canUseDevMode`, `devMode` (`dev_mode_allowed && dev_mode`) and `setDevMode(enabled)`, which calls
  `PUT /auth/dev-mode`, makes the answer the shared `/auth/me` and publishes it
  (`services/authEvents.ts`), so every mounted `useAuth` — the sidebar, an article, a route guard —
  follows at once, with no reload. **The mode hides and never grants:** it is drawn in the sidebar
  (the Academia section, whose «Assistente» and «Grafo» sit on top of their `VITE_FEATURE_MERLT*`
  flags), on the MERL-T routes, and on an article (the `article_sidebar` graph rail, `AskMerltEntry`,
  the selection popup's «Segnala come citazione» and `MissedCitationReporter`, all gated in
  `ArticleTabContent`, on top of the consent gates); the server's guards stay the real barrier.
  Not behind it: the RLCF trackers and the consent screen (collection is the owner's separate
  decision), the Massimario's panel (`article_case_law`), `article_content_after`, `global` and the
  implicit citation feedback on a click. The citation preview's feedback bar (✓ / ✗ / correct) is a
  citation report, and is behind it. The mode is unrelated to the Q&A view's own `useQaDevMode`
  (a local toggle for the pipeline trace).
- `features/merlt/consent/` and `features/merlt/privacy/` — the MERL-T consent (spec
  `docs/superpowers/specs/2026-10-13-merlt-data-protection-design.md`). The server is its only
  record (`ConsentContext`, nothing in the browser: until it answers, `canTrack` is false). It is read through
  `consentRead.ts` (`readMerltConsent`): one `GET /api/merlt/consent` shared by the mounts that ask while it travels
  (StrictMode's second effect, a provider mounted again), and none after a server without MERL-T answered 404
  `merlt_disabled`, which reads as `DISABLED_CONSENT` for the life of the page; any other failure is an error, asked
  again by the next mount; `useAuth`'s logout drops a read on its way and forgets the «without MERL-T» answer
  (`clearConsentRead`). A level
  counts only under the current version of the MERL-T notice (`INFORMATIVA_MERLT`, a text
  administrators edit as new versions in «Testi di VisuaLex Gymnasium»); `ConsentScreen`, in the `global`
  slot, asks it once as the app loads when it is unanswered — the first entry, then only a new
  version — and cannot be dismissed («Nessuna raccolta» is one of its three choices). No prompt
  during work: no banner, no teaser. `ConsentChoiceModal` is the one place a level is chosen (the
  notice in full as `TextParagraphs`, the three levels of `levels.ts`, the notice's checkbox for
  «Base» and «Completo»); `ConsentDialog` is it on request, `RevokeConsentDialog` revokes with or
  without erasing. Impostazioni › «Dati MERL-T» (`MerltDataSection`): the state, «Cambia scelta»,
  the notice, «Scarica i miei dati», «Elimina i miei dati MERL-T», «Revoca il consenso». The
  welcome tour waits for the screen (`Layout`). The Forum's events carry the environment, never
  its author, and an annotation event never carries the note's words (the owner, 18 October 2026, «c»).
- `features/merlt/hub/` and `pages/MerltHubPage.tsx` — Academia's «Assistente», consent first (S7b). With the
  consent «Nessuno» the page opens on `ConsentFirst` («Attiva MERL-T»: what MERL-T does, «Che cosa raccoglie» at each
  level — `levels.ts`'s summaries, rendered from it, never a shorter list —, «Scegli il consenso» → `ConsentDialog`),
  only where a consent can be given: with no notice (a server answering 404 `merlt_disabled`, or none published) the
  dialog would show nothing, so `ConsentUnavailable` says «MERL-T non è attivo su questo server»; a read that failed
  says so, with «Riprova». The cards' gated actions follow the same `ConsentGate` (`hubStyles.ts`). Then four cards of equal height (`HubCard`: a serif
  title, the text, one action at its foot): Q&A, «Valida proposte», «Grafo giuridico» (only with the graph's flag),
  «I miei contributi». An action that needs more consent is `HubAction`'s `gated`, its words («Serve il consenso
  base», «… completo», or «Non attivo su questo server», «Consenso non letto») on an `aria-disabled` button still in
  the Tab order, never a badge, and none while the consent is being read; the level is named as `levels.ts` names it
  («Nessuna raccolta»); a source the card cannot reach is said in its text; an
  action is a `Link` or a `button`, never a button inside a link. The consent and the profile (`ConsentCard`,
  `ProfileCard`, unchanged in what they do: change, revoke, the ladder, the vote's weight) open one at a time from a
  row of links at the foot («Consenso e privacy · Base», «Il tuo profilo»). The ops cards stay for administrators.
  Tokens in `hub/hubStyles.ts` (44 px, no text under 12 px). On `/grafo` (`GraphExplorerPage`) the deliberation
  column is a rail while the graph is empty — no centre, no node or relation chosen, no question — opened by hand
  from the rail or by whatever fills it, and open from then on (not stored: the stored preference is the user's
  collapse); on a phone the «Dibattito» button sits over the home bar (`env(safe-area-inset-bottom)`), the truncation
  chip over it, and the frame keeps the canvas tall — no line under the title, the slice's tools as icons beside it. `features/merlt/academiaTokens.test.ts`
  reads every MERL-T file and fails on a `text-[Npx]` under 12 or a hand-written `blue-`, `indigo-`, `purple-` or
  `violet-` (not the canvas's labels, `graphStyles.ts`'s `labelFontSize`, which scale with the graph's zoom).
- `components/ui/` — shared primitives: `Button`, `IconButton`, `Input`, `Card`,
  `Modal`, `ConfirmDialog`, `WireConfirm` (below, «Destructive confirmations»), `Toast`, `EmptyState`, `Sheet` (a
  phone's bottom sheet), plus feature-flavoured modals.
  `Collapsible` («la tendina», U1a) is the way to open a panel in place, pushing what follows down — no window, no
  veil (two older panels still grow their height through Framer, `DocumentReviewPage` and `EnvironmentContentViewer`:
  to move to it): `grid-template-rows` from `0fr` to `1fr` (no height in script), 200 ms on `--ease-out` to open and 150 ms to
  close, its content fading in 150 ms just after; closed it is `inert`, `aria-hidden` and, once its height has gone,
  `visibility: hidden` (visible at once as it opens, so a focus given in the next frame lands); open and still its
  content may overflow (a menu, a ring), clipped only while the height moves; Esc inside closes it and gives the focus
  back to `triggerRef` — not an Esc from a dialog portaled from inside it, which is the dialog's. Closed it is still a
  box of no height and keeps its parent's `gap`: it goes in a plain wrapper with what it opens under. Under reduced motion it opens and closes at once —
  the content is kept at full opacity, or the global rule's 150 ms (after the delay) would fade it in late. The
  trigger is the caller's (`aria-expanded`, `aria-controls`). «Oggi»'s study settings (`StudySettingsPanel`) use it.
  `SegmentedTabs` and `SegmentedTabPanel` («linguette che scorrono», U1; first on the Forum's three tabs and its
  suggestions' «Ricevuti · Inviati», S7a) are a
  `tablist` over one `tabpanel`: the chosen tab's mark slides on `spring.snappy` (a `layoutId` in the row's own
  `LayoutGroup`, still on the first drawing), the content comes in over 160 ms with a 12 px shift the way the mark
  moved (to a tab further right, the content moves right too: U1's words), in CSS (`animate-in`, fill backwards —
  Framer's fade ended by writing the opacity, one frame at 0 and, under reduced motion, a second fade from the global
  150 ms opacity transition of `index.css`), the panel clipping the shift 8 px out at the sides; under reduced motion
  the mark is drawn in place and the content changes at once (that sheet makes every animation instant); the arrows,
  Home and End move the choice and the focus (not with Alt, Cmd or Ctrl). The older
  `SegmentedControl` (a choice in a form: the card's kind, a relation's end) slides a pill too, without the keyboard,
  reduced motion or a row's own `LayoutGroup`: U1 folds it in.
  `Modal` is portaled to `document.body`, so a dialog opened inside a reading window
  (transformed, stacked) is not confined to it; each open `Modal`, `WireConfirm` and `CompareView` is on a module-level
  stack (`ui/dialogStack.ts`) and only the top-most handles Tab (its focus trap, on `document`) and Esc, so a dialog opened
  from a dialog keeps the keyboard. `Modal` and `CompareView` share that focus (`ui/useDialogFocus.ts`): the stack, the
  Tab trap, the focus given 50 ms after opening (to «Chiudi» unless told otherwise) and back to what had it on closing.
  `CommandPalette` keeps its own focus (floating-ui's) but takes its place on the stack while open: ⌘K over a dialog
  (the comparison) leaves Tab and Esc to the palette, whose box is portalled to the body, outside the dialog.
  `Button` has four variants (spec `2026-10-18-redesign-inchiostro` §5.1): `primary` (toga-600, white),
  `secondary` (paper with an ink-200 hairline), `quiet` (text only) and `danger` (red-600) — `ghost` and
  `outline` are the earlier names of `quiet` and `secondary` —, no gradient, glow or hover lift, a minimum
  height of 36 px on a desktop and 44 px on a phone; `loading` keeps the label and puts a spinner in the
  icon's place (`aria-busy`), `status="error" | "success"` shows the outcome of the last press. Its look is
  `ui/buttonStyles.ts`'s `buttonClassName(variant, size)`, for a link that must look like one (the 404's «Torna alla
  ricerca», `primary` `lg`: 44 px at every width). `Modal`
  enters in `dur.panel` on `ease.drawer`, growing from 0.97, and `Sheet` rises from its edge on the same
  timing (its «Chiudi» in ink-500, dark ink-400: over 3:1, since it is often the one way out); both only fade under reduced motion (`useReducedMotion`).
  `Sheet` gives the focus back to what had it as it opened, taken while it is first drawn: a field inside with
  `autoFocus` (the palette's box) takes the focus before the focus manager records what had it, and the focus went to
  the body as the sheet closed. The notifications (K1a,
  `components/ui/notifications/`): every `Toast` while `isVisible` and every `showUndoToast` is an entry of one
  store (`notifications.ts`), drawn by `NotificationHost` (mounted once in `Layout`, in the toast band): a stack at
  the bottom (at the top for `position="top"`; from `md` at the right, its foot over the feedback button, which it
  covered), three at most per edge — the newest first, a fourth closes the oldest
  plain one first (an «Annulla» or a notification that stays until closed goes only when nothing else can; one pushed
  out stands), the others move with `spring.gentle`; a list named «Notifiche», read from a
  polite and an assertive live region that `notify` sets when one arrives (a closing one never makes an older one read
  again). Where no host is mounted (a component's test) a `Toast` draws itself alone at
  its edge (`role="alert"` on its fixed box, as before). The card (`NotificationCard`, Framer Motion's `useAnimate`)
  is drawn from a line: the line grows from the centre with a tick at each end (300 ms), opens like a slit
  (an `inset` clip with the same lengths at both ends, 350 ms), and the words rise from it 60 ms apart with a touch
  of weight (Geist's axis); the clip is let go once open, so a focus ring is never cut. Each entry's time is a
  `countdown.ts`, held by a mouse over it, the focus in it, a finger on it and a hidden tab; «Annulla»'s 5 s is the
  line at the bottom drawing back between two ticks, which grow while it is held. Run out (or taken back), it closes
  into the line, which draws back to the centre; ✕, Esc from inside it and a swipe to the side (a finger, or the
  mouse dragging it from anywhere but a button, which it presses instead; a short one springs back, and a press that
  moved it is no click — `swipeGuard.ts`: never a key's click (`detail` 0), and the flag goes once the release has
  been seen, so a swipe let go outside eats nothing after it; no text is selected while it moves; started in `onPointerDown` with `dragListener` off, so the words stay selectable by a double
  or triple click) fold it and slide it away. «Annulla» closes it at once — nothing in a closing
  notification takes a click (`inert`) — awaits the undo and draws «Ripristinato» in its place for 1.5 s (`undoneSlots`: the place is kept when the undo
  outlasts the exit); the focus of a notification closed from the keyboard (Esc, or a key's click, `detail` 0, or a
  `:focus-visible` button) goes to the next one still open — never after a mouse click or a swipe, where it would
  hold the next one's time for ever; an undo
  that throws has reported its failure and gets no «Ripristinato» (the dossier, entry, card and task undos rethrow
  after saying so; a practice's or an act's with nothing left to put back says «Non ripristinabile: …»). At logout
  (`clearUserData`) every notification goes, `dropped`: an «Annulla» resolves as not standing and runs no undo, so an
  action held until the notification is gone (a large import) is not carried out. Plain toasts stay 3 s. Under reduced motion it fades, already open, and the time line still draws
  back. Its «Annulla» and ✕ are 44 px at every width. **Ctrl+Z (⌘Z on a Mac)** runs the newest «Annulla» still on screen
  (L-36; `undoShortcut.ts`, the host's `keydown` on `window`): never in a field, a list, an editor or anything
  editable (`isEditableTarget`: there it is the browser's own undo), never with Shift (redo), never when something
  took the key first, never under a dialog or an overlay (`isUndoCovered`: an undo behind it would go unseen) — but
  over Study Mode, drawn under the notifications (`data-undo-through`), it undoes, and under a dialog over it it does not —,
  once for a held key (`repeat`), Z read by its place on a keyboard that writes no Latin letter; with no «Annulla» on
  screen the key goes by. «Ripristinato» comes as after a click, and once the undo has run the live region says
  «Ripristinato: <what was undone>» in its place (one message: two in a row on an atomic region, the first is lost);
  the focus in the notification undone goes to the next one, as after Esc. That notification writes the key beside its «Annulla» («Annulla · Ctrl+Z»,
  seen, not in the name; `aria-keyshortcuts`) where the pointer is not coarse and nothing covers the workspace
  (`useWorkspaceCovered(…, isUndoCovered)`, watched only while an «Annulla» is on screen: under a dialog the key does
  nothing); the
  shortcuts' list has it.
  `registerUndoToastListener` hands the newest «Annulla» on screen to a test. `Tooltip` waits 500 ms under a pointer, opens at once and
  without motion within 300 ms of another closing, and at once on keyboard focus.
  Interaction tokens live in `constants/interactions.ts`, stacking bands in
  `constants/zIndex.ts`. Compose these rather than hand-rolling Tailwind: `TRANSITION` names the
  properties it moves (never `all`; `scale` and `translate` included, `box-shadow` left out so the focus
  ring — `FOCUS_RING`, toga-500 on a paper offset — appears at once), `ACTIVE` presses to 0.97 on buttons
  only, `HOVER_LIFT` lifts 1 px for a fine pointer and goes on nothing that is a row or a list item.
  **Motion** comes from `lib/motion.ts` (`ease`, `dur`, `spring.snappy` for panels and rows,
  `spring.gentle` for rare moments): no component types a spring or a curve, and a transition names what
  changes. A CSS transition that needs a spring takes `--ease-catch` (`index.css`, a damped spring sampled as a
  `linear()` curve; the lesson bar's ink). `lib/motion.guard.test.ts` fails on a `transition-all` or a hand-typed spring, with no exception
  since the Gymnasium celebration's stamp is gone (G9). A row or a list item takes a colour change on hover, never a
  scale or a lift.

### The planner (Opus, wave 1)

Personal tasks, filed under a dossier or in the inbox, with a planned date and a deadline the user writes
(`/api/tasks`, `apps/server/CLAUDE.md`). `components/features/planner/`; `types/tasks.ts`; `services/taskService.ts`
(maps the snake_case answer once). Wording: no string may suggest a computed deadline (`plannerStyle.test.ts`
checks the files; «termine calcolato» comes with wave 2 and its warning), and no Todoist names, icons or texts.

- **Pages**: `OpusPage` (in `PageFrame` with `section="opus"`: the view's name as the title under Opus's phrase (L-37),
  which the switcher focuses,
  «Cestino dei compiti» as its action, the view the frame's width, P2b), `OpusViews`: `TodayView` (Gymnasium's day
  on one line that opens Gymnasium's «Oggi» — `StudyTodayRow`, «Gymnasium: il ripasso di oggi», absent with Gymnasium
  off; not a task, and it reads nothing: Gymnasium's session and progress reads mark the day and settle the missions
  when the queue is done, and opening Opus must not count toward the streak; its counts wait for a read that only
  counts —, then by date (the «Oggi» group always, with its «+ Aggiungi compito», even when only late tasks are
  listed): the
  missed deadlines under «Termini scaduti» — a past deadline is always there, whatever the planned date —, then the
  tasks planned before today whose deadline is not past or absent under «In ritardo», then «Oggi»: `splitToday`;
  the owner's choice after the first pass, 20 October 2026; or, by «Raggruppa: per dossier», one group per dossier
  by title, the inbox last — the choice kept in this browser, `localStorage`), `UpcomingView` (P2c: the week's strip, `WeekStrip`, sticky
  under the phone's bar — the month, a menu when the seven days span two; «‹ Oggi ›»; Monday to Sunday, the chosen
  day `aria-pressed` and underlined, today a filled ring and `aria-current="date"`, a day out of reach drawn but
  disabled; a day chosen scrolls the content scroller alone so its block's heading stops under the strip where it
  sticks, smoothly unless reduced motion — never `scrollIntoView`, which also scrolls the layout's `overflow: hidden`
  ancestors once the scroller is at its end and slides the whole page up with no way back — then one block per day of
  the chosen week in reach, «21 ott · Oggi · mercoledì» (`blockHeading`), an empty day too, each with «+ Aggiungi
  compito» for that day, its rows not repeating the day (`TaskList.dayShown`: only a time); a task once, under its planned date when in range, else its deadline: `groupUpcoming`. The server answers
  today and six days, `view=upcoming`, with no range: the weeks are the one or two those days touch, until
  `/api/tasks` takes one), `InboxView` (no dossier),
  `TaskTrashView` (`view=trash`: a task's trash is `deletedAt` on the row, not a `TrashEntry`, so it is not in the
  dossiers' `TrashPage`; «Ripristina», 30 days). «Today» is the server's day (`TaskViewAnswer.today`), never the browser's.
- **Groups** (`TaskGroup`, P2b): a view's groups fold and open by their heading (the accordion pattern: the toggle
  in the `h3`, `aria-expanded`), with the count and «⋯» («Aggiungi un compito», a dossier's «Apri il dossier»);
  folded for the session (`plannerStore.folded`, by key), instantly — only the arrow turns, and not under reduced
  motion. Under the rows «+ Aggiungi compito» (`InlineAddTask`: a title and Enter, with the group's day or dossier,
  open for the next one, Esc closes); the inbox has one under its list. Groups are by date or by dossier only
  (the views the server answers); by person comes with wave 4.
- **The row** (`TaskRow`, two levels, P2b): a real checkbox (Space ticks it), the title as a button (opens the
  task's sheet), the description in one grey line, then a line of signs: the planned day in its colour and in words
  (`rowDay`, `dayTone`, `DAY_TONE`: «Oggi» green, «Domani» amber, the weekday in the accent, a past one red with
  «in ritardo di N giorni»), the deadline bordered with its count (`countdown`: «scaduto da 2 giorni», «scade oggi»,
  «manca 1 giorno», «mancano 3 giorni»), the subtasks' counter (a button that opens and folds them in place; they
  start open in «Oggi» and «Prossimi giorni», where each is listed because it is due, folded in a list:
  `TaskList.subtasksOpen`), the repetition, the priority in words (1 «Urgente» is the most urgent, 4
  «Normale» the default and not shown; the tick's ring carries it too, in colour and in line, `PRIORITY_TICK`: thick
  and tinted red, tinted amber, dashed ink, thin — not a red-orange-blue scale with the last unmarked, which is another
  app's look —, the labels (first letter capitalised, as the dossiers' tags: `tagLabel`; stored as typed), the dossier at the line's right end in grey (a link; not in the dossier's own
  panel; it and the subtasks' counter lay their 44 px over the gaps from `md`, and take the line's height on a phone,
  where they would overlap the title's target), a thin rule under the row, «⋯» (Modifica, Aggiungi un sottocompito, Sposta nel cestino). `TaskList` nests subtasks one level under a
  parent in the same list (`nestTasks`; deeper ones under the top ancestor); the arrows, Home and End move between
  the rows' ticks across every list of the page (`moveBetweenRows`, `data-task-lists`). A row that leaves (ticked,
  trashed) first hands the focus to the next row's tick, else the previous one's, else the view's heading
  (`focusAwayFrom`, `data-focus-fallback`), so Space and the arrows go on.
- **Writes** (`taskActions.ts`): a tick hides the row — until an answer read after the write landed
  (`optimistic.landed`, the write counter): a read that started before, or a failed one keeping the last answer,
  would show it again, not done — then `POST /complete` — a repeating task with its current
  `plannedDate` (the server needs it, and a stale one is a 409) — and the undo toast: «Annulla» reopens, or for a
  repeating task (`recurred`) puts the planned date back with a `PUT`. A deletion goes to the trash with its
  subtasks, «Annulla» restores. A refusal shows the row again and the server's Italian `detail` in the planner's toast
  — and a 4xx (409, 404) makes the views read again, or the stale row would be refused the same way at every try
  (`PlannerHost`, at the top: the undo toast holds the bottom). Every write bumps `plannerStore.version` and every view
  mounted reads again; nothing holds tasks between reads. No toast, log or error carries a task's title (it may name a
  client): `useTaskView` and the count log a status only.
- **Adding**: `QuickAddField` at the top of each view (a title and Enter, at 16 px on a phone; «Dettagli» opens dates,
  priority and dossier in a `ui/Collapsible` under the row, the box growing, its arrow turning, Esc closing it — U1b;
  a line says where the task goes; a task that will not show in the view is announced; the field keeps its hint whole,
  12 em of its own 16 px text whatever the text size, never wider than its line, the ＋ with it, and on a row too narrow
  for it and its two buttons — a phone — the buttons go under it, at the right); «c» (as in «compito») from anywhere opens
  `TaskDialog` (`PlannerHost`, mounted by `Layout`; not in a field, with a modifier, or under a dialog,
  a menu or a `data-find-overlay`), with the dossier chosen on `/dossier?dossier=` and today's date on «Oggi» and
  «Prossimi giorni»; a task the page will not list is announced, as from the field; listed in the «?» dialog. No date
  is read from the words (wave 2). The origin follows the dossier's kind (`studio` or `lavoro`).
- **The task's sheet** (`TaskSheet`, P2a; a `ui/Modal` with its own header, `labelledBy`, the whole screen below
  `sm`, `phoneFullScreen`): the path (the dossier, a link, or «Lista d'ingresso»; a subtask's parent, which opens it),
  «Compito precedente» and «Compito successivo» (and j, k, not in a field or a menu: `aria-keyshortcuts`), «⋯»
  (Aggiungi un sottocompito, Sposta nel cestino), «Chiudi». On the left the tick, the title (edited where it stands:
  Enter or leaving it saves, Esc gives up the edit before it closes the sheet) and the description (its links live
  while read; «Modifica la descrizione» or a click on its words opens the field, leaving it saves), then the open
  subtasks (ticked there, each opening in the sheet; «N da fare»: the server lists open tasks only, so no «3/5») and
  «Aggiungi un sottocompito». On the right, under the title on a phone, `TaskSheetFields` in the brief's order:
  Dossier (`DossierPicker`, a combobox that searches the titles; a subtask's is its parent's, shown), Data
  pianificata, Termine finale with its count, Priorità (a `MenuButton` of four `menuitemradio`, a flag in the
  priority's colour, `MenuItem.iconClassName`), Etichette (chips, Enter or a comma adds), Ripetizione last. No field
  for what the server does not keep (reminders, an assignee, a place, comments). A change saves when it is made —
  a choice at once, a typed field (title, description, a date, a time) when it is left or at Enter, a date half typed
  (`validity.badInput`) put back, never saved as cleared; Esc in a field with a change not saved (the title, the
  description, a date, a time, a label being typed) gives the change up and keeps the sheet open, the next Esc closes
  it — one `PUT` at a time per sheet, the changes made meanwhile
  merged and sent after it, so the server never ends on an older value than the sheet shows; `draftProblem` refuses
  first what the server would refuse, and a refusal puts the sheet back to the last saved copy and says why in the
  server's words. The scope keeps the sheet's saved copy (`onSaved`), so a task moved out of the view (to a dossier,
  from the inbox) stays current in its sheet. `TaskSheetScope` wraps a view's lists (`data-task-lists`): one
  sheet per view, the arrows step through the rows as they stand on the page (a folded group or subtask is skipped;
  a task saved out of the view steps from its old place), and closing gives the focus to the task's row, else the row
  now in its place. Opened from «Aggiungi un sottocompito», the field to add one has the focus (`initialFocusRef`),
  and the request stays with that task. `Modal`'s Tab trap sends Shift+Tab from an element outside its list (the
  sheet's wrapper, `tabIndex -1`) to the last one, not out of the dialog. `TaskDialog` is the new task only («c»): every field (`TaskFields`; a repetition and a deadline
  switch each other off, and the times need their dates). `taskDraft.ts` checks what the server would refuse before
  sending and builds the input (a subtask's dossier is never sent: it is its parent's).
- **The dossier's panel** (`DossierTasksPanel`, after the header of `DossierDetailView`): its open tasks and the quick
  add with the dossier fixed.
- **The count** beside «Oggi» and on the switcher's Opus entry: the today view's length, set by `TodayView`'s read
  and by `PlannerHost` every two minutes while the tab is visible and after every write.
- **A new day**: every read stores the server's day (`plannerStore.today`); when one answers a different day (the
  count's, every two minutes) or the tab comes back into view, every view mounted reads again, and the quick add,
  keyed on the day, proposes the new one. A page left open overnight no longer files the morning's first task under
  yesterday.
- **Focus after the sheet**: a task saved out of the view leaves after the sheet gave its row the focus back;
  `focusWhenRowLeaves` watches for a few seconds and hands the focus to the row's neighbour (or the heading) when no
  row of the task is left. A subtask ticked in the sheet hands it to the next subtask, else the field to add one.
- **Origin**: a task's origin follows its dossier's kind when it is created or moved to another dossier (`studio`
  for a dossier di studio, else `lavoro`; a `forum` origin is kept); a subtask takes its parent's.
- Style: Gymnasium's tokens (`studia/progress/tokens.ts`) and `plannerStyles.ts`; every control 44 px at every width
  and no text under 11 px (`plannerStyle.test.ts` reads the folder). The tick (`TaskCheckbox`) is the native checkbox
  as a transparent 44 px square over the 20 px box it draws; the title is a 44 px button; the dossier's link is 44 px
  tall with its extra height laid over the gaps (`-my-3.5`). **A list that is a `grid` gets `grid-cols-1`** (a track
  that may shrink): with the implicit `auto` track one `truncate` line — the dossier's name — widened every row to
  763 px on a 390 px phone and clipped it (seen by «occhi», the headless pass, 20 October 2026).

## Frontend State

One Zustand store (`store/useAppStore.ts`) with Immer. Always mutate through
actions.

**Server-backed** (hydrated by `fetchUserData`, mutated optimistically then
synced): bookmarks, dossiers + items, environments (read-only: the Forum's archive), quickNorms, customAliases,
annotations and highlights (these two hydrate per-article via
`loadAnnotationsForArticle` / `loadHighlightsForArticle`). The search history is
not a store slice: `HistoryView` keeps it in local state and reloads it on mount.

**Not in the store:** the planner's tasks are server state read per view (`planner/useTaskView`; see «The
planner» above), never in `useAppStore`; `planner/plannerStore` holds only what the planner's surfaces share
(a write counter, the bar's count, the server's day, the quick-add dialog, the planner's toast). Study cards are server state fetched per view (`studiaService`, `useMyCards`,
`useArticleCards` over `utils/articleCardsCache.ts`, `useReviewSession`), never in `useAppStore`.

**UI-only** (persisted to `localStorage` through the `persist` partialize):
settings, `searchPanelState`, and the practices of the norm-tab redesign (`practices`,
`activePracticeId`; spec `docs/superpowers/specs/2026-10-08-norm-tab-container-design.md` §9-10). The
persist `version` is 1: `migrate` turns a browser's version-0 state into practices once —
the sanitized `practices` when it carries `practicesSeeded: true`, else `practicesFromTabs` over its
`workspaceTabs` — and drops `workspaceTabs`, `highestZIndex` and the marker; the topic searches it
could not reopen are told once (`practiceNotice`). `merge` sanitizes the practices
(`sanitizePractices`), which also drops `brocardi_info` and `brocardi_error` from every saved article
(D-078: an article saved before kept showing Brocardi until it was fetched again), and `addArticles` drops
them from every article on its way in (an API not yet updated, during a staggered release, may still send
them; they would sit in `localStorage` until a reload); the old
`show_brocardi_info` and `hasBrocardi` in saved searches, quick norms and `?norma=` links are left where
they are, inert: no code writes or reads them, a saved quick norm or link still sends its flag as saved,
and the Python API ignores it. `persist` writes through `utils/guardedStorage.ts`: a save the
browser refuses (a full `localStorage`) is logged and told once as a sync error, never thrown out of
`set`. `clearUserData` empties the practices.
Before the first conversion the raw version-0 value is copied once to `visualex-storage.v0-backup`, so a
browser's old tabs can be recovered by hand should the conversion go wrong (never overwritten; skipped,
with a logged warning «saved workspace too large to back up», when the value is over 1 000 000
characters, so the copy cannot fill the browser's space). The key holds a user's saved norms and
searches: `clearUserData` (logout) removes it, and nothing reads it back in the app.

The partialize deliberately holds UI state only. **Every user-owned slice is
server-backed** — see gotcha 17, which is the rule any new slice must follow.

### How the collections differ

- **Dossiers** (`/dossier`) — the working file for a task: many articles, read in
  place, reorderable, exportable, shareable. This is where real work happens.
- **Bookmarks** — a save action in the reading toolbar backed by
  `bookmarkService`. There is **no bookmarks page or route**; the dedicated UI was
  removed as dead code. Don't document or build against a bookmarks page without
  first deciding to rebuild one.
- **History** (`/history`) — server-side search history. It also hosts
  `NormaChangesSection`, the one place the "a saved norm changed"
  notifications are listed and marked read; the avatar of the user menu and
  its Cronologia entry count the unread ones (`useForumNotifications().count.normaChanges`,
  deliberately kept out of the Forum's `total`, which nothing on that page
  could clear). Marking read dispatches `NORMA_NOTIFICATIONS_CHANGED_EVENT`
  on `window` so the badge drops before the next 30s poll. A row is a norm (`act_type`) or a
  decision (`decision_key`, never both): `DecisionEntryView` records a found decision once per
  opening: the key it sent is kept on the practice's entry (`historyRecordedKey`, persisted with it,
  `markDecisionEntryRecorded`), so a remount, a closed and reopened row or a reload never records
  again, while a new entry does (the copy on screen only), and `DecisionHistoryRow` previews it on a
  click and reopens it from the preview with `openDecision(…, { fromLink: true })`. The entry is marked
  before the request, so a failed request is not retried (not even after a reload) and the failure
  is logged: the history is a convenience.

All of them reopen a norm through `triggerSearch()`.

### Aliases

Three different things. Conflating them is the recurring mistake.

- **Presets** (80) — shipped in `preset_aliases.yaml`, served by
  `GET /fetch_alias_catalog`. 21 of them only rename an act type: "codice
  appalti" IS the "Codice dei contratti pubblici" row already in the palette's
  list of acts, so listing them duplicates that list. The palette shows only the 59
  that carry a number and a date (`gdpr` → Reg. UE 679/2016), which is work
  the list cannot save.
- **Known acts** (392) — names `act_resolver.py` understands unaided ("statuto
  dei lavoratori", "TUSL"). These need no alias at all; one would only drift.
- **CustomAlias** — the user's own, server-backed. A custom trigger beats a
  preset of the same name, because the client resolves its own aliases before
  asking the server. So the palette hides the shadowed preset rather than
  advertising a shortcut that no longer runs, and the manager badges it
  "sovrascritto".

`AliasManager` is reached **only** from the command palette (gotcha 27; both are mounted by `Layout`'s
`GlobalSearch`), and in
the palette the presets cost one line of header text at rest — they render as
rows only once the user types, matched by `queryMatches` (`paletteActs.ts`). `useAliasCatalog`
keeps its `loaded` flag in component state, so the palette and the manager each
fetch the catalog once for as long as they stay mounted — two calls per session,
never repeated, nothing persisted.

### Reading surface

The dashboard article view (`ArticleTabContent`) composes: `ArticleBody` (renders
sanitised HTML + hosts `SelectionPopup`), `useArticleMarkers` (turns raw text into
HTML with highlight `<mark>`s and wavy note anchors), and the toolbar
(`ReadingToolbar`; R3, «prima il testo»: one line over the text with a hairline, no box — the status in words,
`VersionStatusChip`, «In vigore dal 1° gennaio 2005» with the date in full, and «Allegato N» (`shownAnnex`: never a
code's own); on a computer «Note» and
«Evidenziazioni» with their counts (`NotesHighlightsButtons labelled`), «Colore» (`HighlightColorMenu`, H1, below),
«Al dossier», then «⋯» («Altre azioni sull’articolo»: the quick norm, the glosse, «Cerca nel testo», «Copia»,
«Condividi link», «Esporta…», «Testo alla data…», «Confronta con…»); on a phone «Al dossier» (its icon) and «⋯» on the
status's row, «⋯» adding Study Mode, the source and, last under its own title, the four colours (the compact bar of a
window and of the phone's reader: «Note», «Evidenziazioni», «Colore» and «⋯» with the glosse, «Cerca nel testo» and
«Copia»; on a phone «⋯» alone, the colours in it); «Colore» and the colours are not offered on a text that takes no
highlight (`lockedReason`); quiet
neutral buttons, 36 px on a computer and 44 on a phone; «Cerca nel testo» says «Chiudi la ricerca nel testo» only while
the window is pointed at this very text (`useFindWindowScopedTo(…, exact)`), else it points the window here. Nothing of it is inside the text root, root rule 23). Keys are `buildItemKey(norma)` and
`uniqueArticleIdFromNorma(norma)` from `utils/normaKeys.ts` — the dossier reader
uses the same two functions, and they must stay byte-identical or annotations
made on one surface stop appearing on the other.

**The text is structured, never rewritten** (round A, spec
`docs/superpowers/specs/2026-09-25-lettura-testo-design.md`).
`parseArticleStructure` (`utils/articleStructure.ts`) reads heading, rubric,
commi, items with their printed enumerator and level, Normattiva's
`((modifications))` and repeal notices, `(119)` references and the
AGGIORNAMENTO notes, as raw ranges that partition `article_text`;
`renderArticleHtml` (`utils/articleRender.ts`, behind `useArticleMarkers`)
emits one `div.vlx-b.vlx-{kind}` per block, cutting the text at every block and
mark edge and nesting marks with a stack, so the HTML is always well-formed and
escaped. Styles are the `.vlx-*` rules in `index.css` (READING SURFACE): a 68ch
measure, commi divided by space, hanging numbers and items. The contract is
gotcha 23: the rendered text nodes spell `article_text` minus `\n` — any new
label goes in CSS (`content: attr(...)`), never in a text node.
`articleRender.test.ts` enforces it on 27 real texts
(`utils/__fixtures__/articleTexts.ts`). The practice's rows and windows, the dossier reader and Study Mode all
render this way; Study Mode hides the heading and rubric blocks
(`vlx-hide-header`) instead of cutting them, so its offsets are
document-relative like everywhere else. No surface renders flat (`structure: null`) since the
Brocardi sections went (D-078); the mode stays under its tests.

**Offsets are measured from the text alone.** `SelectionPopup` takes a
`textRootRef` (the element holding only the article text) and stores the anchor
from `getSelectionAnchor` (`utils/selectionOffset.ts`), which reads
`Range.toString()`: `Selection.toString()` is rendered text and writes a newline
per line or comma boundary, which made every cross-comma highlight unmatched.
The renderer also accepts, at the same offset, a stored text that differs only
in whitespace, so those older highlights show again.

**«Giurisprudenza» under the article** (`CaseLawSection`, after the text): an accordion closed by default (state per host in
`sessionStorage`) holding the Massimario's panel (the plugin slot
`article_case_law`, which takes `articleUrn`, `isHistorical`, `besideId`,
`backEntry`), the Cassazione's decisions that mention the article, searched
only when the reader presses the button (`DecisionResultList`; not offered on an act of the Union,
`isEuropeanAct`), and «Cerca sentenze sul tema dell’articolo»: a topic search of the Cassazione by the
article's rubric (`topic`, `getRubricText`; no rubric, no link; not on an act of the Union, nor when the
«rubric» is a notice the source wrote in its place, `isNotice`, or the text is repealed or not yet in force, nor
for a generic rubric — `GENERIC_RUBRICS` in `caseLaw/genericRubrics.ts`, «Definizioni», «Oggetto», «Ambito di
applicazione», «Entrata in vigore», «Abrogazioni», «Finalità», «Oggetto e ambito di applicazione», «Finalità e
oggetto», «Definizioni e ambito di applicazione», «Abrogazione», compared ignoring case, accents, spaces and a final
period by `isGenericRubric`: alone they would find every act's decisions),
which records the way back (`backEntry`, as a decision's link does) and opens beside the article — the
decisions on its subject, whether or not they cite it. It took the place of the
Brocardi glossary's «Sentenze su questo tema»: Brocardi is no longer a source (D-078), and its massime,
commentary, footnotes, glossary and credits are gone from every surface. On a past text the section stays. A click on a decision's estremi
opens its preview, whose «Apri accanto» opens it beside the article with the way back. Every block draws its rows with the one `CaseLawRow`
(`components/features/search/caseLaw/`: the estremi as a `DecisionLink`, the exact date else the year,
the text cut at three lines with «Mostra tutto», the source as a small label; `authorityColor` is the
one colour key) and the section's header holds the one set of controls (`CaseLawControls`): a range of
years «dal / al», a chip per year with the count of the rows loaded, the order (newest first, reversible)
and one text filter; on a phone they sit behind «Filtri». The blocks do not own a filter and no block
scrolls inside itself. The controls reach them through `CaseLawFiltersContext` (`useCaseLawFilters`;
the Massimario's panel is a plugin whose slot props are a contract, so it reads the same context) and
each block reports its years back with `useReportCaseLawYears(source, counts)` — `YearCount[]`, memoised;
the section adds them up into the chips (`mergeYearCounts`; a year is «circa» when any block's count is
approximate). What a row answers to is the source's to say (`YearsOf`: a passage's
cited decisions' years — the review's year is its provenance, a Court of Justice decision's day); a row
with no year is kept only while no range is set. The year range and the text filter narrow what is
*loaded* — except for the Cassazione: its block sends the range to the archive (`anno_dal`/`anno_al`,
`DecisionResultList`'s `yearRange`; a new range starts the search again from page one, nothing is asked
before the reader presses the button) and reports the archive's own `anni` counts for every year — approximate
(«circa») in index mode, which counts before the citation re-check, exact in the text search — or, when the
archive sent none, the years of the hits loaded (the counts are kept for the query, archive and mode they
count, not for the next one if that fails; the range is clamped to 1900 – this year in Rome, and a range wholly outside
that answers «none» without a request). On the Cassazione the reversed order applies once every
decision is loaded; until then the archive's order (newest first) stands and a line says so. Filters reset
with the article.
**An act of the Union has the Court of Justice's block** (`EuCaseLawBlock`, in place of the Cassazione's) for a
regulation or a directive: `utils/euCaseLaw.ts` derives the act's CELEX from the norm
(`3` + the year + `R`/`L` + the number on four digits, as the API's `sources.eu_identity` does — the norm
carries none; a pair written in `numero_atto` is not guessed at) and the plain-number article; a Treaty, or an article that is not a plain number, has no query
and the block says the list is for regulations and directives (for a regulation or a directive whose article is not
a plain number, that it is searched by simple numbers). It asks `/search_eu_case_law`
(`services/euCaseLawService.ts`, `legalFetch`) when it appears, once per act and article for the session
(`utils/euCaseLawCache.ts`, cleared at logout; only an answer is kept, so «Riprova» asks again). A row is
`CaseLawRow`: a judgment is a `DecisionLink` from its `identita` (our reader, beside, the way back, the phone's
full screen); an order or an Advocate General's opinion, which that reader does not hold, is a link to EUR-Lex by
its CELEX (`eurLexDecisionUrl`, new tab, «su EUR-Lex»; no link from a CELEX that is not a decision's). The
opinions («Conclusioni AG») are hidden, and out of the counts, until the toggle; the block says the list may be
incomplete with a link to InfoCuria's search page (its search by cited provision has no address to rely on),
credits «EUR-Lex / Ufficio delle pubblicazioni dell'UE», and holds the archive's order when the query stopped at
its 500 rows.
A topic opens a topic-search window of the practice (`openTopicSearch`; `ReadingWindow` draws
`DecisionSearchTabView`: heading «Tema: …», the article when the query has one, «Solo il tema» to
drop it, the limits line, the list; a decision opened from it sits beside that window, with no way
back; on a phone it is the full-screen reader's subject): from «Cerca sentenze sul tema dell’articolo» in
an article's «Giurisprudenza» (its rubric, beside the article's row, without its norm) or from the palette
(a line «Cerca "…" nelle sentenze della Cassazione», shown only when the box is neither a decision,
a norm, has at least three characters one of which is a letter or a digit, nor starts with a custom alias, nor while the server is still resolving it as an act, and announced in the palette's status region).

**Normattiva's update notes** are interactive and out of the way:
`useArticleTextInteractions` delegates click and Enter/Space on the body — a
`(119)` chip opens `UpdateNotePopover`, the "Note di aggiornamento (N)" toggle
folds the tail through the `vlx-updates-open` class on the text container
(the HTML never changes when it opens). A reference whose note is not in the
text is plain text; only `((49))` is dimmed.

**The reader's own annotations are marked where they are** (round B, spec
`docs/superpowers/specs/2026-09-25-annotazioni-sul-testo-design.md`).
`utils/articleAnnotations.ts` is the one definition of where a highlight or a
note renders (`resolveAnchors`) and of which block shows it
(`groupAnnotationsByBlock`). With `signs: true` — the practice's rows and windows and the dossier
reader, not Study Mode — the renderer ends each annotated block with an empty
`span.vlx-sign`: the note icon, the count and one dot per colour are CSS, so
the text nodes are untouched. The sign sits inline after the block's text, or
in the right margin when the `vlx-frame` size container (a wrapper around the
text in `ArticleBody`) has room for the 68ch column plus a sign. It opens
`BlockAnnotationsPopover` through `useArticleTextInteractions` (one popover at
a time with the update notes): the block's notes, edited and deleted in place
with the Notes panel's own `NoteCard`, and its highlights, removed; *Vai al
passo* scrolls to the passage and makes it glow (`utils/revealAnnotation.ts`).
The popover is placed against the whole block (`utils/blockAnchorRect.ts`) —
beside it when the margin has room, else below or above it, never over the
passage it lists — through a virtual reference that finds the sign again on
every measurement, because every edit redraws the text. Its focus management
is modal: with no element in the text for floating-ui to bridge Tab back to,
Tab cycles inside and Esc returns to the sign.

**Passages an application proposed** (D7b: the MCP design's §8, in the documentation pull request #318, as the
server's contract for the first cut revises it) are highlights with a `proposal` (`types/index.ts`, `HighlightProposal`): only a dossier entry's reader is
ever given one. The state is the application's note's, not the highlight's: a
passage with no note is a plain mark titled «Evidenziato dall'IA», removable, outside every count and with no
checkbox (`hasAiNote`). Until its note is validated («da validare» or «Da rivedere», `isOpenProposal`), `highlightOpen` adds
`data-proposed` and `.vlx-proposed` — a dashed line, red once flagged. The sign draws each passage with an
application's note by its state's own shape, as on the row's light (`.vlx-sign-ai`: a filled red flag, a yellow dashed
ring, a green tick, each with its count; the other highlights stay dots of their colour) and names them apart
(«…; 3 passaggi proposti dall'IA: 1 da validare · 1 da rivedere · 1 validato», `signAriaLabel`), as its `title` too; still no text node, and the projection tests run with proposals on. A click on
such a passage opens its block's popover (`useArticleTextInteractions`, in an article's comma or a decision's
paragraph), unless it lands on something with a click of its own (a reference, a citation, a link) or the
highlights are hidden; the readers' note handlers skip what `proposedPassageAt` returns, whatever order the listeners were added in,
so a note of the reader's under it never opens. The
popover lists them first, only when given `proposalActions`, as `ProposalCard`s: the passage, its note, then
`AiReviewControls` — a real checkbox «Proposto dall'IA, confermi?» → «Validato» (or «Validato, modificato da
te») with the green tick, «Da rivedere» while flagged, the flag «Da rivedere» with its optional «Cosa non va?», the pencil (the note edited
in place in `NoteEditBox`, shared with `NoteCard`, here `explicit`: «Salva» and «Annulla» under it, Enter saves,
Shift+Enter a new line, Esc cancels without closing the popover, leaving the box saves nothing; a changed text is
never dropped without «Scartare la modifica?» — «Continua» or «Scarta» —, asked by «Annulla» or Esc, and by the
popover's X, Esc or «Vai al passo», which a press outside never closes while a note is edited), the bin, and «Vedi la versione dell'IA» once the note was
changed. Every proposal, a bare mark too and one that no longer lands, offers «Sposta l’evidenziazione» (the
passage's boundaries by hand: Luca, «l'evidenziatura l'IA me la fa, però devo poterla modificare»): the popover closes,
the reader shows `MoveProposalBar` (portalled, fixed at the foot, the page's width on a phone; one on the page at a
time, `assistantProposalsStore.moving`, which a removal, the feature switched off or its reader going ends) with the passage's words
selected in the text (only when they are still at their offset) and the focus on it; meanwhile the selection popup is off
(`ArticleBody`'s `selectionPopup`) and a click in the text opens nothing (a drag ends with one, on the very passage), nor
Enter or Space on a sign, a reference or the update notes' toggle, and
a changed note in the popover asks first («Scartare la modifica?»). The new words
are a drag or a touch, or Maiusc+frecce from the keyboard (Ctrl or Alt a word at a time, `Selection.modify`, wherever
the focus is but in a field, under a dialog or on a key already taken) with «Sposta l'inizio» / «Sposta la fine»
choosing the edge (`setBaseAndExtent`; a backward drag makes it the start); on a touch screen with no fine pointer
(`pointer: coarse` without `any-pointer: fine`: an iPad with a trackpad keeps them) the help says «Tieni premuto su una
parola, poi trascina le maniglie» and those two buttons go. A press on the bar does not read the selection it empties
(iOS does, as the finger lands, and sends the click late): it lasts until the bar's click has been handled, or 400 ms
after the release, then puts back the words selected as it began — never words the user had let go of, and never a
`preventDefault` on the press. The title and the help are the bar's `aria-describedby`.
While open the bar says its room at the foot of the window (`ui/notifications/footBar.ts`, 0 as it closes), over which the
notifications' bottom stack rises (`NotificationHost`, as `--foot-bar` on the stack alone: rewriting the root's style
while a notification animated crashed headless Chromium's page, one row in four). The focus goes back to the block's sign after a move or «Annulla». They are read as a highlight of the user's is (`getSelectionAnchor` over the
reader's text root, its projection; root rule 23), 1–2000 characters, and «Sposta qui» or Enter sends them
(`PUT …/proposals/:id/range`, `moveProposal` in the store, the note's state unchanged); Esc leaves. A passage removed
meanwhile in another tab (404 «Proposta non trovata») goes, and the move says so («Evidenziazione non spostata: …»),
where a state or a note written on it goes quietly. Once moved, the card
offers «Vedi l'evidenziazione dell'IA» (`HighlightProposal.originalText`, the server's `assistantRange`).
`rangeFromPlainOffsets` (`utils/selectionOffset.ts`) is `plainOffsetAt`'s inverse. A shape per state, never colour alone. The dossier's rows carry the traffic light (`AiReviewSignal`,
`utils/aiReview.ts`): a red flag if one item is to review, else a yellow dashed ring if one waits, else a green
tick, nothing if the application wrote nothing — last in the row's toggle, in a box as tall as the star and the bin
(`ROW_SIGN`), its sign on their line, and so is the closed article row's notes' count beside it; its words
(«2 da validare · 1 da rivedere») are its `title` and in the row's name, its counts the server's `assistant_notes` on
the item (`serverFieldsFromApi`).

The colour of new highlights is chosen once, in the reading bar (H1, the owner's decision; `settings.highlightColor`,
kept on this device with the other reading settings, yellow until chosen, and yellow again for a save holding
anything else — the persist `merge` checks it, `isHighlightColor`): `HighlightColorMenu` beside «Evidenziazioni» on a
computer (`ReadingToolbar`, its compact form too; «Colore: giallo», a dot of the highlight's tint inside its ink, named
«Colore: giallo (nuove evidenziazioni)» — the name starts with the words shown, WCAG 2.5.3 —; where the dot stands
alone, the decision's bar and Study Mode's header, its words are its `title`), its four choices closing the «⋯» on a
phone under their own title («Colore delle nuove evidenziazioni — uso suggerito», each named «Nuove evidenziazioni in
verde, uso suggerito: …» so it reads as a setting, not as «highlight now»), in the decision's bar, in Study Mode's
header, and with the dossier reader's actions (it has no bar); never on a text that takes no highlight. The menu, under
the same title, offers the four as `menuitemradio`, each with what it is suggested for, a hint: any colour is free for
anything. **What a colour means is each user's** (the owner, 29 October 2026: «solo etichette» — the four colours stay, no colour
is added, only the words for them change, so no highlight, colour key or anchor moves, root rule 23): the default is
`HIGHLIGHT_COLOR_MEANINGS` (yellow «Punto centrale», green «Condizione o presupposto», blue «Definizione o eccezione», red
«Da rivedere»), and a user's own are `settings.highlightColorMeanings` — only the colours given one, trimmed, 1 to 40
characters (`normalizeHighlightMeaning`; the persist `merge` drops anything else, `sanitizeHighlightMeanings`, and a
meaning written back to the default is no meaning of one's own), kept on this device with the other reading settings,
never sent to the server or to an application (the MCP tool's description gives the defaults). Whatever words a
colour's meaning reads it through `useHighlightColorMeanings` (`highlightColorItems` takes the meanings; its names lower
the first letter, not an acronym the user wrote). Beside the colour's trigger one gear and only that (no «?»: the menu
already explains; the gear says «change it»), named and titled «Cambia il significato dei colori»
(`CHANGE_MEANINGS_LABEL`), the trigger's look with 44 px of width on a phone — the article's bar, the decision's, the
dossier reader's; on the phone's «⋯» the same words are the entry after the four colours; in Study Mode, whose header
has a gear already (its own settings, «Impostazioni (S)»), the entry is the last of that panel, not a second gear
(`meaningsGear={false}`); and none in the lesson's article sheet on a phone (`ui/Sheet` keeps the focus inside it, a
dialog over it would fight it: Impostazioni stays the user menu's there). All open Impostazioni at «Significato dei colori» (`openSettings('highlightColors')`):
the dialog's state is the store's (`settingsDialog`, session-only), so `Layout`'s `SettingsModal` opens from any reader,
and with that section it gives the section's first field («Giallo») the focus (`initialFocusRef`) — never the heading:
`useDialogFocus`'s trap sends Shift+Tab from an element outside its Tab order (`tabIndex -1`) to the dialog's last
control — and that first focus scrolls the dialog's body alone so the section's heading is at its top (`revealOnFocus`,
`scrollParentOf`).
`HighlightMeaningsSection`, after «Tipografia»: a field per colour (its dot and name as the label, the default as
placeholder, `maxLength` 40, 44 px on a phone, `FIELD_TEXT`), saved when left or on Enter, an emptied one keeping the
meaning it had (said in the section's status line), Esc giving up a change without closing the dialog, and «Ripristina
predefiniti» (`aria-disabled` while nothing differs). Every way of highlighting takes it: `SelectionPopup` never asks — «Evidenzia» (named
«Evidenzia in giallo», `aria-keyshortcuts="h"`) and H highlight at once in it, its icon in the colour bright on the
popup's dark surface (`HIGHLIGHT_ICON_ON_DARK`, never the highlight's tint, dark in the dark theme and transparent
while highlights are hidden) —, a key passage's «Fai tua», and Study Mode's keys 1–4, which highlight in their colour
and make it the one chosen. Sideways the popup is moved 8 px inside the window by its drawn box — the positioning
element's first child, the positioning element being `w-max` — (a `marginLeft` set as it is drawn). Study Mode's own keys leave alone a key a menu took or one pressed in a menu (Esc there closes the
menu, not Study Mode), every key while a dialog is open over it (`[aria-modal="true"]` anywhere in the document, the
focus inside it or not: Impostazioni opened from its settings — its Esc, arrows and digits are the dialog's), and H and N while text is selected (the popup's). The MCP tool gives an application the same meanings and refuses red (`apps/mcp/src/tools/passages.ts`).

The wiring follows the server's contract (`services/assistantService.ts`). `GET /api/features` says whether the
feature is on, read as the app starts (`useAuth`) and as the dossier page mounts; a 404 «Non disponibile» from a
route turns it off again. `store/assistantProposals.ts` is a store of its own, keyed by entry id and filled by the
entry's reader from `…/items/:itemId/proposals`: the marks never enter the app's highlights, so Study Mode, the Forum,
environments and the PDF never receive one, whatever the note's state. `useEntryProposals` serves the entry's
reader: an article's `DossierItemReader` and a decision's `DecisionReadingSurface` (its `dossierItemId`, from
`DossierDecisionRow`), each given its entry's id, the dossier from `CurrentDossierContext` (`DossierDetailView`). It asks
nothing outside a dossier entry, with the feature off or on a text shown read-only, and draws the proposals with the
reader's own highlights (a decision's downloads keep only the reader's); one whose words no longer land is listed under
the text at every width, as the application's, with its note and the popover's actions (`LostProposalsList`), never
in the reader's own boxes (`LooseHighlightsList`, desktop only, and `UnmatchedAnchors`). Each
write takes the server's answer and moves the row's light by one (the old state down, the new up). The bin removes at
once and offers «Annulla»; the `DELETE` leaves when the notification closes, when the entry's reader goes (its row
closed), or at `pagehide` as a `keepalive` fetch (the removal refreshes the token first, since that fetch cannot), never
after a logout drops it. Sent early, its notification goes too, «Annulla» with it. A reading never draws back a removal
waiting or out; a refused `DELETE` puts the passage and its count back. Each write reads the state it replaces as the
answer lands, and only the latest action's answer is taken (an earlier one landing after it is dropped); while a write
is out the checkbox and the flag wait (`busy`, `aria-disabled`, still focusable). An answer landing while the passage
waits behind «Annulla» is what «Annulla» puts back, the server's state. A 404 «Proposta non trovata», on a write or a
`DELETE`, is a removal done: no error, nothing put back. Errors are read as `apiClient` rejects them (`{ status,
message, data }`): the server's `detail` is what the notification says. A state that changes is said in a `status`
region; the focus comes back to the pencil after editing, and to the popover after a bin; «Cosa non va?» also saves on
Esc. On a narrow card the three buttons go under the label (`flex-wrap`). The flag is read once as the app starts
(with the user's data) and as the dossier page mounts; on again after an off, the dossiers are read again for their
lights. A 404 «Non disponibile» also clears the items' `assistantNotes` and
`assistantNote`, so no light or control stays; a logout empties the store; a share link or a JSON export carries
neither field (`shareableDossier`). Trashing a note entry an application wrote takes its count off its article's light
(`trashDossierItems`, `shiftAiReviewCount`). A note entry an application wrote (`assistantNote` on the item, contract §3) has the same controls
(`AiNoteEntryReview`, in the free notes and under an article; its bin is the row's own removal): its writes replace
the item's text and state from the answer and move the light of the article it is about.

The "Evidenziazioni" box under
the article now lists only what no sign can reach (`LooseHighlightsList`,
desktop): highlights made in the Brocardi sections (`<article>/brocardi/ratio|spiegazione`, still
loaded by the prefix queries and labelled «Sezione non più disponibile · Ratio» since the sections went,
D-078 — `retiredSectionLabel`, which also heads such a note in `NoteCard`, so its quote is not taken for
the article's words) and highlights whose text changed — without it they could no longer be removed.

**Find in the text** («Cerca nel testo», spec §13): one floating `FindWindow` (`features/search/`,
mounted once in `Layout`, portalled, z-index `findWindow`) opened by Cmd/Ctrl+F (`Layout.tsx`: opens,
or focuses and selects the query when already open), by «Cerca nel testo» in the «⋯» of `ReadingToolbar`
(desktop and phone rows; R3: the window gives the focus back to that «⋯») and by the magnifier
(`FindInTextButton`) of `DecisionReadingToolbar`. Cmd/Ctrl+F is intercepted on `/`
only, where the workspace is drawn; on every other route it is the browser's, and leaving `/` closes the
window. It is also the browser's while an overlay covers the workspace (`isWorkspaceCovered`): an element
with `aria-modal="true"`, or one marked `data-find-overlay` — Study Mode, `CommandPalette`, `CompareView`,
`PDFViewer`. A new full-screen overlay that is not a modal dialog in ARIA terms takes the mark on its
root, rendered only while open; do not add `aria-modal` for this alone (Study Mode lost it: its note
popovers are portalled outside it, and VoiceOver hides what lies outside a modal dialog). The hand-rolled
`z-50`/`z-[100]` modals sit under the window, which stays over them, visible and usable.
`utils/findWindowControl.ts` (`openFindWindow`, `closeFindWindow`, `subscribeFindWindow`,
`isWorkspaceCovered`) is its control; `useFindWindowScopedTo` gives the magnifier its pressed state
(pressed: open on this practice and this text; the state is read at `pointerdown`, before a practice
switch changes the active one). The scopes are «Questa pratica» (the active
practice, on both breakpoints: every article of every act, its row open or closed, then its decisions
newest first) and «Tutte le pratiche» (the bar's order, each place named with its practice); a row's
root registers under its practice's id with the same keys, and so does a light window's (the
surface's `findHostId` prop, which also names the practice for the magnifier's pressed state and
request; the window's own id stays the way back's and the focus's); `setFindWindowDefaultPlace` lets a
layout give the window its opening place (`ReadingRow`, in every case: right-aligned in the table's
column, or the first window's body with the rail, under the stack pinned at its top — the practice header,
the first act's heading, an open row's toolbar, each marked `data-pinned-head` — and every window's
header, so never over a control; a dragged place wins; a tool held over the table carries
`data-floating-tool`, which the rail's overlay does not read as a click away); a decision never read counts nothing (it
is not in the session's cache); reaching an undrawn match opens its row with its practice made active
(`revealPracticeRow`, `revealPracticeDecision`; on a phone the reveal's own update takes the full-screen reader off, so the row is on screen — a match in the reader's own subject is drawn and needs nothing), and the window recomputes on a practice switched, a
row opened or closed, a subject added or removed. `CompareView` then lists the practices' articles. Under «Tutte le pratiche» the place of the match is one label: the target's own (a decision entry's, which carries the section, or an article's `shortNorm`), with its practice. The window is dragged by its handle (pointer or arrow keys), its
place kept in sessionStorage and clamped; on a phone it is a full-width top bar, not draggable (gotcha
26: use `useIsDesktop`). Esc closes it and returns focus. Text roots register through
`useRegisterFindRoot`; `useFindWindow` finds across `utils/findTargets.ts` targets (a displayed root is
searched in its DOM, any other in its stored projection and only counted), moves the reader only on
next or previous, and shows an undrawn match through `revealPracticeRow` / `revealPracticeDecision` (the practice made
active, the row opened). A target whose root does not
appear within 3 s is given up for that query and leaves the counter. The article searches `ArticleBody`'s text root only (`textRootRef`), not «Giurisprudenza»; the root holds only the text (the empty-text placeholder is drawn beside it), which the find and `SelectionPopup` both rely on;
a decision only when it has text (`hasDecisionText`). The search reads the text nodes, joined by one virtual space at every block boundary, `<br>` and skipped hidden subtree, and paints with
the CSS Custom Highlight API (`::highlight(vlx-find)`, `::highlight(vlx-find-current)`); it adds,
moves and changes nothing in the DOM (gotcha 23), and where the API is missing it only fails to
draw. The article renderer emits nothing for a search (no `search` mark kind, no amber `<mark>`).
Matching ignores case, accents and marks, folded 1:1 per UTF-16 unit so offsets are the
original's; a query needs two letters or digits (punctuation does not count: «n.» is not searched); past 1000 matches the rest are not drawn.
A dot or comma of an abbreviation is optional («cpa» finds «c.p.a.», «art 13» finds «art. 13»; «art.» never finds «articolo»), and a
number is never cut out of a longer one («8980/2018» is not in «18980/2018»). A query that reads as a
citation (`readQueryCitation`, spec §13.2) also finds the other forms of it: per target, the literal
matches and `findCitationSpans` are one list (`matchesWithCitation`), ordered by start, overlapping matches joined into their union, on a drawn text
over the same separator map and on a stored text over its projection (`utils/citationSearch.ts`).
The literal matches of a citation query obey the spans' bounds: never right after a letter, digit
or dot, never before a letter when the query ends with a dot («art. 1 c.p.» is not in «c.p.c.»).
`useFindWindow` keeps one `CitationText` per target in scope (folded and parsed for citations once
per text, replaced when the text changes, dropped when the target leaves the scope). Act types come from `sources/actTypes.ts` plus the
palette's spellings (`NUMBERED_ACT_SPELLINGS`); a type is never found inside another's name («legge»
in «decreto-legge» or «decreto- legge»), a decision's number never inside an act's citation (any
type of the table, or «decreto», «direttiva», «regolamento», or an administrative act, in every form of the number and
year: «circolare», «nota», «provvedimento», «delibera», «determina», «risoluzione», «parere»…; regional laws and
Union acts too, never «ordinanza» or «sentenza», which are decisions; an administrative court (`ADMIN_COURT_HEAD_SOURCE`)
named in the act's words is a decision's head, except right after «del»/«della»/«dello»/«dell'», where it is the act's issuer: «il parere del C.d.S. n. 5/2018» is an act; any other court there stays a head: «il decreto del Tribunale di Milano n. 5/2018» is a decision), and
an article links to its act only across the gap §13.2 whitelists (commas, «comma N», «commi 2 e 3», «primo comma» and the
other ordinals, «e ss.», «lett.», «n.», «del»…). A decision cited date first («Cass., sez. III, 12 aprile 2018, n. 8980») is found by
its date and number when the date's year is the query's and a court or a decision's marker stands within 60
characters before the date (`followsDecisionMarker`: no act's name, semicolon or end of a sentence between; a full stop ends a sentence
after a word of five letters or more, a digit, a bracket or a quote, a short abbreviation never does), never
as an act's («legge 12 aprile 2018, n. 8980»); without a marker nothing is found, because date first is also how
ministerial decrees, regional laws and administrative acts are cited. A code's article
is found across the same words (`blankCodeLinks`: «art. 2043 del c.c.», «art. 2043, primo comma, c.c.», «art. 2043 e ss. c.c.»
are blanked to spaces at the same offsets and `extractCitations` reads the text again; it is the one reader of codes, and it
still does not make «del c.c.» a link). Its tests use synthetic texts (no run of 30
characters shared with the real ones); the real ones live in
the git-ignored `utils/__fixtures__/private/` (personal data: never copy them into a committed
file) and `citationSearch.local.test.ts` is skipped where the folder is absent.
Browser floor: the Highlight API (Chrome/Edge 105, Safari 17.2, Firefox 140). `articleRender.test.ts` and
`decisionRender.test.ts` check the projection with a search open (`utils/__fixtures__/openFind.ts`).
The «?» dialog lists Cmd/Ctrl+F as «Cerca nel testo».

**Card review** (`/studia/ripasso`, `ReviewHome` with `StudyPreferences`; the session is
`/studia/ripasso/sessione?materia=&istituto=`, `ReviewSession`; `istituto` is read only with a known `materia`, as the
server refuses one alone, and passed back as the road spelt it): the server builds the day's queue and decides
what «today» is (Studia spec decision 18), so the web app never computes a due date; the one exception,
`nextReviewLabel`'s «Da ripassare oggi», is a display label. `useReviewSession` holds the queue: a card's
first grade is posted, «Di nuovo» puts it back at the end, and its later passes that day are practice,
never posted (the bar then shows the grades without intervals and «Ripasso di pratica: non registrato»).
Its key handler reads the queue from refs and every queue update checks the head is still the graded
card: a second key pressed between a post resolving and the re-render must not drop the next card.
Keys: space reveals (ignored on a focused button or link, in a field, under an `aria-modal` dialog or a
`data-find-overlay` layer), 1–4 grade after the reveal, Esc closes the article first, then asks
«Interrompere il ripasso?» while a card is on screen and at least one is graded (with none graded it leaves at once,
since stopping loses nothing — U1c, Bill's choice; with no card — the end, a failed read, the read on its way — it goes
back to Oggi too, as the header's button does); listed in the «?» dialog's «Ripasso» group. The question is K1b's
`WireConfirm` drawn from the header's «Interrompi», for the button and for Esc alike (U1c), no icon, its words the
session's count of cards graded (`summary.reviewed`, a «Di nuovo» counted; `reviewStop.ts`: «Hai ripassato 4 schede:
restano registrate. Le altre ti aspettano in “Oggi”.»); going on is the evident action (`emphasis="cancel"`:
«Continua il ripasso» filled and on the right, the focus on it, Esc), «Interrompi» outlined — nothing is destroyed,
so no red — and going on gives the focus back to the card (`focusBack`), where Space shows the answer.
**The lesson** (Gymnasium spec `docs/superpowers/specs/2026-10-19-gymnasium-restyle-design.md` §5.4; the Studia screens
spec §6 as rewritten for G2): the session is a screen of its own. `StudiaPage` draws it, with no heading of the area,
in `LessonFrame`: portalled to the body in the `lesson` band (`z-[70]`, over the sidebar, the floating buttons, the
feedback button and the plain toasts — the services' state is the user menu's since S1, out of reach until the lesson is left —; under the overlay band, so the article's sheet, the
confirmation and the toast — at the top, off the bar — cover it), with Tab fenced off from the shell (`#root`)
and the body: a dialog over it, or a popover the article portals to the body (a note being typed), keeps its own.
The shell is not `inert` — the command palette is drawn inside it — so a screen reader's browse mode can still reach
it. While the route's code loads, `LessonLoading` (`App.tsx`'s fallback) gives the frame its close button and Esc. The shell's Focus mode
is not used — it is a saved setting and leaves its own button on screen — and `Layout` is untouched. Three rows: the
header (the close button, «Interrompi», 44 px, and the progress bar, `role="progressbar"`, done of done and remaining,
where done are the cards out of the queue — a «Di nuovo» holds it still —; at each grade that moves it the head runs
ahead in the section's hue (`vlx-lesson-head`, 150 ms), the ink — the hue too, at a step that reads as a colour on its
track (`vlx-lesson-ink`, `--vlx-gymnasium-bar`, G8: it was the ink's near-grey) — catches up 70 ms later on `--ease-catch` (300 ms) and the
bar trembles by a pixel (Web Animations, `PLUCK`), 370 ms in all, all of it `motion-safe:` only; «Restano N»
stays as screen-reader text), the card scrolling in the middle (beside it on desktop the article, `DossierItemReader`,
in a column of its own that scrolls apart; on a phone `ui/Sheet`, marked `data-find-overlay`; the panel closes when the
card changes; the scroll is keyed by step, so each card starts at its top), and `LessonBar` at the foot on every width (above the phone's safe edge, in the `pinnedBar` band inside
the frame), holding the one action: «Mostra risposta» (`LESSON_PRIMARY`, the ink key of «Inizia il ripasso») before the reveal,
the four grades after it — the interval the large text and the grade the small one, every button neutral but
«Di nuovo» (warning tone), 56 px, pressed with `active:scale-[0.97]`. The bar's line above the action says, in this
order, «Non registrato: riprova», «Ripasso di pratica: non registrato» once the answer is shown, or the note after a
grade (`useGradeNote`: «Torna tra 3 giorni» from `anteprima`, «Torna domani», «Torna in coda» for «Di nuovo», «Fatta
per oggi» for a practice pass that takes the card out; one second, `motion-safe:animate-vlx-note`, said politely to a
screen reader, never focused). `useReviewSession` does not say which grade moved the queue and is read only, so
`useGradeNote` reads the grade where it is given — `recordGrade` on a click, a key 1–4 on the window's capture phase,
with the session's own filters and nothing taken while a grade travels; a move with no grade behind it (a skip, a
new read) clears the note; keep its filters in step with the hook's.
The card (`ReviewCard`) is the area's tile — a sheet on the paper, no shadow or gradient — and comes in with each card
(the session keys it by step: opacity and a few pixels, 180 ms, `motion-safe:` only): the anchor's citation small in
slate sans above, question and answer in the reader's serif at a 60ch measure, the question a step larger; the reveal
is the card's own motion (a hairline, then the answer, `motion-safe:` only; the celebration never touches the card);
the articles under the answer are 44 px buttons. Nothing else moves between a grade and the next card. The end (G8): one
card, centred (`lesson-end`), with no bar under it — the sentence («Hai ripassato 23 schede, 4 da rifare. Le prossime:
domani.», focused), the ring and the streak with its strip of the last seven days — the week, said once (`SessionEndProgress`, from the day's read) —,
and one primary action: «Continua», which reads the same session again, when the read of the session's scope still
counts cards for today (`cardsLeft`, `progress/today.ts`: due plus the new ones today allows; for a session narrowed to
one institute, G5, `instituteCardsLeft` over the road's read, `usePercorso`: the institute's due cards and its new ones
up to what the subject's read allows, never the rest of the subject), with «Torna a Oggi» a quiet link under it; else
«Torna a Oggi» alone.

**«Oggi», the home** (`ReviewHome`, Gymnasium's home at `/studia/ripasso`, titled «Oggi» under «Gymnasium · la tua
palestra giuridica» — L-37; the section switcher keeps «Gymnasium»; spec
`docs/superpowers/specs/2026-10-19-gymnasium-restyle-design.md` §5.1–5.2, as rewritten for G1b and G8, over the progress spec
`docs/superpowers/specs/2026-10-13-studia-progress-design.md`, direction D «Registro vivo»). Reads: `useProgress` over
`GET /lingo/srs/progressi` (the last answer of the same subject stays on screen while a new one travels — dimmed
under the subjects only —, an answer is never shown for another subject, and an older one never overwrites a newer one) — once for the whole day, which draws the missions, the statistics and the subjects, and once more
for the subject chosen, made only while one is (`useProgress(materia, enabled)`), which draws the day block. The page is in
the sections' frame (`layout/PageFrame`, G6: the layout's full width, the heading at its left edge; the 768 px column
of G1 is gone). One column up to `xl`, and in Focus mode (its 896 px frame would leave the band too narrow); from `xl` (1280 px) two, a grid of `7fr` and `5fr`: on the left the day block, today's missions
and the full list, on the right the statistics and «Le tue materie» in one box over all the rows (`row-span-full`,
`self-start`; a fourth row of `1fr` takes what the right column has beyond the left, so it never stretches the left's
rows), `sticky` at `top-8` while it fits in the content scroller with 32 px above and below (`useFitsInScroller`, a
`ResizeObserver` on the box and the scroller; taller, its foot must scroll into reach) and the settings are closed. The
document keeps the order the owner fixed (L-24) — missions, statistics, list — with the day first (G8), and the grid only
places the right column; inside the tiles a sentence stops at `max-w-prose`. With no mission once read (a server without
the points, #253, or a failed read) the left column held the day block alone while the right ran past the window (G8c):
«Le tue materie» leaves the box then for the left column, under the day block — from `xl` only, and before the
statistics in the document, so the keyboard follows the eye; below `xl` nothing moves —; while the first read travels it
stays in the box, and after a failed read it stays on the left while «Riprova» reads again. The places held while the
reads travel are as tall as what takes them (P1, phone CLS 0.63 → 0), and only while they travel — no room is kept once
read: the date's line while the day's read travels, also when a subject's read answers first (two lines on a phone with
a subject); the large line on two lines under 390 px, where «23 da ripassare, 15 nuove» wraps, one from there; the cost
on two below `md`, and kept on two there while the subjects' read travels (it says the subjects once they come); the
missions' rows 58, 58 and 84 px on a phone, as theirs (the goal's with its line); «Le tue materie»'s strip held inside a
plain box, so React never keeps the strip, a scroller Chrome measured in its own coordinates, as the list's group. The
heights are a day's with cards to review and missions: a day done or a subject chosen leaves a small shift (CLS ≤ 0.03);
with no mission at all (a server without the points, no card yet) the missions' place goes when the read comes (0.15–0.22,
from 0.48–0.57 before). In that order:
1. **The day block** (`missions/DayBlock`, G8, the page's entry; on a phone «Inizia il ripasso» within the first 400 px
   under the bar): a tile with the section's hue as a 4 px rule down its left edge (`--vlx-section-gymnasium`), a
   visually hidden `h2` «Il ripasso di oggi»; the day small, «lunedì 19 ottobre» (the title says «Oggi»; «lunedì 19
   ottobre · Diritto penale» narrowed to a subject); in Newsreader, 30 px on a phone and 36 from `md`, what is on today, «12 da ripassare, 8 nuove»
   (`todaySentence`, a part that is zero left out); under it «circa 7 minuti · Diritto civile, Diritto penale e altre 2»
   (`estimateLabel` in `studiaLabels.ts`, `ceil(cards × SECONDS_PER_CARD / 60)`, 20 s a card, an estimate; the subjects
   from `todaySubjects` — those with cards due in the road's read by institute, the most first, then while today allows
   new cards those that hold some; nothing until that read answers — and `subjectsPhrase`, two names at most); and
   **«Inizia il ripasso»**, the page's one primary button (48 px, full width on a phone, an ink key; «Continua il ripasso»
   once the goal is met). With nothing left, «Hai finito per oggi.» and `nextDayLine` («Domani: 9 da ripassare.», a later
   day by name with its count, «Domani: altre schede nuove da imparare.» while new cards wait, which `prossimi` does not
   count, or none in the fortnight), and, while new cards wait, «Impara altre schede nuove», a secondary button that
   opens the settings (more of them is a setting: no practice session exists on the server) — narrowed to a subject,
   «Niente da ripassare in questa materia, per oggi.» and «Ripassa tutte le materie». With no card at all, how to start
   from an article (Ricerca, «+ Nuova scheda» under the text — Le mie schede has its own since G4, not named here) and
   «Accendi le schede della comunità» as its button, which opens the settings at the community's subjects; a failed
   first read says «Non riesco a leggere i tuoi progressi.» with «Riprova» and keeps «Inizia il ripasso» (the session
   reads its own cards), a later failed read says it under the last answer. `todayState` and `nextDayLine` decide it,
   pure, in `progress/today.ts`. It enters once, when its content is first drawn, with the sidebar's cascade
   (`fadeInEntries` of `features/sections/useEntriesEntrance.ts`: its children fade in 20 ms apart, opacity only), never
   under reduced motion.
2. **«Le missioni di oggi»** (`missions/TodayMissions`): the day's three missions as compact rows, one under the other,
   each with its mark (drawn, never pressed), «8 di 18», its points («20 XP», «+20 XP» in ink once earned, said as «vale 20 punti» /
   «20 punti guadagnati») — on a phone always under the title, whatever its length, so every row has one shape; at the
   end of the title's line from `md` (`MissionRow`, both lists) — and a bar of 4 px, and the summary «2 di 3» over those with something to do today; no action
   of their own (the day block holds it). **The server
   decides them** (G1c, Gymnasium XP spec `docs/superpowers/specs/2026-10-20-gymnasium-xp-levels-design.md` §5.3): the
   progress read carries `missioni` (`MissioneServer`: state, `progresso`, `punti`, `principale`, `motivo`, `materia`), each
   `fatta` if and only if its credit exists, and `missions/missions.ts` (`missionFrom`, `allMissions`, `todayMissions` —
   the three `principale` —, `missionSummary`, `goalLine`, `soonLine`) only words them: the Italian titles («Impara 5 schede nuove»,
   or the server's lower target when fewer new cards are left; «Proponi una scheda», G-314), and the lines under them
   (`motivo: 'quota'`: «Le nuove al giorno che hai scelto non bastano: alzale per arrivare a 5.» — the quota never lowers
   the target, L-27 choice 5; a goal met for the streak under the mission's 10 reviews says so; the subject of
   «materia-ferma»). Nothing is counted in the browser. A mission
   with nothing to do today (`vuota`) says so and leaves the summary; a goal the server counted with the queue finished
   under it says why. A mission done reads done
   (`.vlx-mission-done`: a quieter ink, struck through in the section's hue) and slides under those still open
   (`missionOrder`), except the due cards', the day block's own count, which stays first; done since this browser last drew
   it, a drop of ink falls into its box and the ink crosses its words first (`MissionMark`'s `drip`,
   `.vlx-mission-inking`, `MISSION_INK_MS`), then it moves (a moving row keeps its padding wherever it lands; the
   list's `-mb-3` takes the last one's back). «Tutte le missioni» keeps to the words. The targets are settings, not
   missions (G8): no «Cambia…» under the bars; one line under the rows, «Obiettivo e nuove al giorno: nelle impostazioni»
   with the gear's icon, opens the study settings in the band and focuses them (at the community's subjects when the
   new cards' mission has none to give). The goal's row keeps its line in sight (the red stamp that covered it is gone,
   G9); the summary counts the missions done and open, and with none to count (every mission empty: nothing due,
   nothing new) says «Oggi non c'è nulla da ripassare», never «0 di 0». While the first read travels the rows hold their places; a failed read, or no card at all, is the day
   block's to say.
3. **«I tuoi progressi»** (`progress/StatsBand`), one band: `StreakBadge compact` (the «§», the count with the bundle
   of five being filled as tally marks beside it, `StreakTally` — the fifth is the stroke across the four in the
   section's hue —, «Il primo giorno comincia oggi» or «giorni di fila · record N») and the current week; no ring of the
   goal (G8: the goal's mission says it, and «Progressi» draws it); under them **the level** (`progress/LevelBar`, G1c: «Livello 4», «oggi +45 XP», a quiet bar of `nelLivello` of `perIlProssimo` and
   «Ancora 138 XP per il livello 5», all from the read's `livello`, which the server computes; the user's alone, G-316 — never
   in the Forum, a public dossier or anything another user sees —, no title, L-27 choice 3, and never a weight of a vote,
   G-318; a read with no `livello`, `missioni` or `crediti` — a server without the points, #253 — draws no level bar and no
   missions: no «Le missioni di oggi» and no «Tutte le missioni», the band takes the goal's ring back (`GoalRing
   compact`) so the goal is still said, and the day block and the rest of «Oggi» and «Progressi» stay as before);
   the gear «Impostazioni dello
   studio» (`progress/StudySettings`: `SettingsGear` with `aria-controls`, and `StudySettingsPanel` — G6, the owner's
   «si estende il tab»: `StudyPreferences open` inside the card under its heading, no window and no veil, in a
   `ui/Collapsible` since U1a; the gear again or Esc inside closes it
   and the focus goes back to the gear; while it is open the right column is not sticky, so its foot can be scrolled to; the
   missions' settings line and the day block's buttons open it and focus it, «Accendi le schede della comunità» with the subjects open; the
   strip over «Da validare» (`StudyStrip`) opens the same panel in place since U1b, the strip growing downward — no
   window any more: `StudySettingsSheet` is gone; mounted at the first opening and kept, so the settings are read only
   once the gear is pressed). `StudyPreferences` saves a number when its field is left or on Enter (an
   unchanged one is not sent; «Salvato» beside it, no «Salva»), keeps the community's subjects one level down, closed
   («Schede della comunità · N di 5», a `ui/Collapsible` of its own since U1b), and sends its saves one after the other, a switch held only while its own
   save travels, so a switch pressed right after a number is neither lost nor overwritten. The week (`layout.ts` `currentWeek`: Monday
   to Sunday from the server's today and `serie.ultimiGiorni`, seven boxes with «LMMGVSD», a day to come dotted, and the
   days before the first one the calendar holds `vuoto`, never missed; each state in words for a screen reader,
   `DAY_STATE_LABEL`; `WeekRow`, its own file), then the cards by state in one line (G8, `StatesLine`:
   «3 nuove · 5 in apprendimento · 2 consolidate», each with its swatch, a list named «Le schede per stato») over the
   bar of the three colours. From `xl` the band is the top of the right column, about 400 to 490 px: `aside` adds the `xl:` classes that stack it as on a phone (the
   week at the column's width). «Tutti i progressi →», a text link (44 px, not a button across the column, G8), leads to `/studia/progressi`: the trend, the
   coming days and the subjects' data live there alone (G3 removed the «Il tuo mese» sheet, so no chart is drawn twice).
   **No text on «Oggi» or «Progressi» is under 11 px** (the goal's mark's date included, words beside the drawing):
   `typeScale.test.tsx` reads the files of `missions/` and `progress/` and fails on a `text-[Npx]` under 11 or an SVG
   `<text>`. `CARD_STATES`, in `tokens.ts`, are the band's, the institutes' and the page's.
4. **«Le tue materie»** (`progress/SubjectList`, G8), under the band in the same box: it took the place of «Cosa ripassi»
   (the chips) and «Il percorso» (the road), which said almost the same thing in two forms. A group «Materia»: on top
   «Tutte le materie», then one row a subject in the road's order (`orderStops`, new plus in learning first, then by
   name — kept so when the institute read answers, which would otherwise move the rows under the reader's hand), each,
   from `md`, a flex row as wide as «Tutte le materie» (a grid's empty column for a subject with no card kept its 8 px
   gap), a 44 px `aria-pressed` choice that takes what «Ripassa» leaves — its hue's dot, its name, «3 oggi» (the cards due today, `dueBySubject` of the read by
   institute; said «3 da ripassare oggi»), a small bar of its consolidated share and the three states in words for a
   screen reader (`stopStates`) — and «Ripassa» for a session narrowed to it (none, and «Nessuna scheda», for a subject
   with no card). The choice narrows the day block and the session it starts, kept in
   `localStorage` under `visualex.studia.ripasso.materia` by `progress/rememberedSubject.ts`, which «Progressi» shares:
   one choice for the area. On a phone the rows are one row of cards that scrolls sideways (`HIDDEN_SCROLLBAR`, snap), from
   `md` a list. The reviews of 30 days are «Progressi»' alone. The rows enter with a 40 ms stagger once per mount
   (`motion-safe:` only). **The institutes (G5):** `progress/usePercorso` reads `GET /lingo/srs/percorso`
   once for every subject, on its own (the day block and the missions never wait on it or fail with it; the day block's
   «Riprova» and a changed setting read it again); while the read travels the counts hold their place, and a failed
   read leaves them out. The subject chosen shows its institutes under the list, «Gli istituti di Diritto civile»
   (`progress/InstituteStops`): one stop per institute joined by a thinner line (none for one institute),
   free, ordered by `orderInstitutes` (most due, then by name in Italian), each one button of 44 px that starts the
   session narrowed to it (`instituteSessionPath`: the label goes back verbatim, never trimmed or rewritten — it is the
   card's content, root rule 23), its name wrapping whole (never cut), its three states as a bar and in words, «N da
   ripassare». The first `INSTITUTES_SHOWN` (8) show, the rest behind «Mostra tutti gli istituti (N)»; only those first 8
   enter with the stagger. Its states: places held while the read travels, «Non riesco a leggere gli istituti di questa
   materia.» with «Riprova» (no alert; its name says which subject), the stops read before kept when a new read fails, a subject with none.
   A failed first progress read says «Non riesco a leggere le tue materie: …» under the heading (no second alert).
5. **«Tutte le missioni»** (`missions/MissionList`): daily, weekly, long-term, without today's three, which item 2
   shows above («Le tre di oggi sono qui sopra.», G6, said only when that card is drawn — not with no card at all): every mission the server lists that is not `principale` and can be
   done, with its state, count, line and points — «convalida» only when the server lists it (a validator's); a `vuota`
   keeps its count beside «Niente oggi» («1 di 2») —; the missions announced and not yet recorded (`in-arrivo`) have no
   row, ring or points: one line in slate 500 at the foot names them (`soonLine`: «In arrivo: caso breve, una settimana
   di serie», G8).

One type language: block headings in Newsreader (`BLOCK_HEADING`), labels in Geist; no small capitals and no double
rule. «Da validare» shows the strip (`progress/StudyStrip`, `dense`: the streak's count without its
line, the ring, the gear) over it (`StudiaPage`); «Le mie schede» none since G8 (the streak and the goal said a third
time); the session shows none. «Contribuisci» (G4, spec §5.5) draws them in
the same tokens: each page's name the frame's title (L-37), its action beside it, a `TILE` per subject (its hue's dot) and
per card, a selected row or a pressed filter marked by an ink edge as well as a tint, `INK_BUTTON` for the one action of
a block, the three verdicts alike in `SECONDARY_BUTTON`; every control of `MyCardsView`, `CardGroups`, `CardFilters`,
`CardDetail`, `ValidationQueueView`, `VoteBar` and the reader's row and peek keeps 44 px at every width
(`contribuisci.test.ts` fails on an `md:` height or minimum size other than 44 px, or text under 11 px). The card
form itself (`CardForm`, shared with the reader) still drops to the desktop's sizes from `md`. While the first read travels the day block,
the missions, the band, the subjects and the list keep their places at their final size; a failed first read stops the pulse, and the
subjects say they could not be read under their heading (no second alert: the day block's «Riprova» reads them again). Colours are the app's tokens through `progress/tokens.ts` (ink is the
primary scale's deep end, the goal's mark ink too (no red since G9), a subject's hue the category palette's CSS variable —
procedura penale's is `--category-penal-procedure`, the violet it had when it borrowed Brocardi's `--brocardi`, now gone;
`theme.test.ts` fails when a subject names a variable `index.css` does not declare in both themes); the charts are
hand-drawn SVG laid out by the pure `progress/layout.ts`, which walks the server's Rome days in UTC and never reads
the browser's zone. **The celebration** (`progress/Celebration.tsx`): once a day per browser
(`useCelebratedToday`, `visualex.studia.festeggiato`, written when a celebration *starts*, so leaving halfway or a new
read never replays it; a convenience, never the streak's source) — on the home when
the goal's mission is done with at least one review (confetti of «§» and «✓» from the goal's mark over the missions and the band — an absolute box on their grid rows, rows 1–2 below `xl` and row 1 across both columns from it —, `confetti.ts` pure, on a canvas,
and the mark written once; whole afterwards), and in the session on the grade
whose answer says `oggi.appenaRaggiunto` (`SessionCelebration`: a notice placed over the lesson's header row (the close button and the progress bar), never over the card
or the grades; 1.5 s; no focus, no pointer, the keys untouched; an `aria-live`
line says it to a screen reader). The confetti step by elapsed time (`confetti.ts`
`stepsAt`), so they last 1.5 s on any screen. Under reduced motion nothing moves: no canvas, the end state only.
**The goal's mark** (`progress/GoalMark`, G9; inspired by a sheet of hand-drawn ticks, written from scratch): a ring, a
tick and a short stroke under it, each the outline of a broad-nib pen stroke generated once and kept as paths (heavier
under 48 px), upright, in the one ink (`INK_TEXT`), with no text inside. It shows only when the goal is met and its
mission done (`goalMissionDone`: `oggi.raggiunto` and the mission `fatta`): a day the streak counts with the mission
empty (nothing due, nothing new) or open (a goal of the user's own under the mission's 10 reviews), or a mission done
under a goal raised since (its credit stays the whole day), says so in the mission's line, with no mark and no
celebration. In the day
block (`DayBlock`, from the whole day's read, so a subject chosen neither hides nor redraws it), on a phone first, 72 px
with «23 ottobre 2026 · giorno 3» beside it, never beside the large line; from `md` at the block's right, 96 px over
those words, the block's right side kept for it. Written (`draw`) only by the celebration: a mask whose pen path is
uncovered stroke by stroke (`.vlx-goal-mark-draw`, about 1 s, motion allowed only; each pen runs 3 units past its
stroke's ends, so its butt ends never shave the thin tips at rest); on WebKit, which may not repaint a
shape whose mask CSS animates (Safari, every browser on an iPhone or an iPad, `writesInMasks`), a short fade of the
mark whole instead (`.vlx-goal-mark-fade`, A3's fallback). A page read again draws it whole. Its name, «Obiettivo raggiunto» (`role="img"`); the date is the words beside it. The
session's notice has the same mark, small, beside its words at every width, on the same rule: only when the grade that
makes the day count also does the goal's mission (its credit in the answer, `GoalMet.missione`); otherwise the words
alone, and the day is not marked celebrated, so «Oggi» writes the mark the first time, once the mission is done. The session's end screen adds the ring and the streak
(`SessionEndProgress`, the same read).
**The small motions** (S2): the tally's new mark (the count pops with it), today's count landing in the ring
(`GoalRing`'s `vlx-digit-land`: the new digit falls into place and takes on its weight, 360 ms, over its own place held
unseen at the final weight, so «di 10» beside it does not move; reaching the goal, the ring closes as it settles) and a mission's ink play **only for what grew since this browser last drew it** —
`progress/seenProgress.ts` (`useStreakGrowth`, `useReviewsGrowth`, `useFreshMissions`, `useXpGrowth`, `recordXpSeen`) keeps
the streak, today's reviews and missions, and the points and the level under `visualex.studia.visto` — forgotten at
every sign-in, sign-up and sign-out (`forgetSeenProgress`, `useAuth`), so the next person on the browser never reads the last
one's points or level —, a convenience like the celebration's, never a number's source; with
nothing stored nothing plays, and what a view draws it records (the dense strip draws no tally and leaves the streak's
growth to «Oggi»). None of them takes a key or the focus or delays a card, and under reduced motion each is drawn at
its end at once. The celebration is unchanged.
**«+20 XP» and a new level** (G1c): what a grade, a proposal or a vote earned comes in its answer (`xp: XpEsito`; a grade
not recorded and the proposal's 409 carry none). The lesson shows it as `progress/XpGain` — an ink chip over the progress
bar's end, inside the header's row and out of the flow (never on the card; while the goal's notice covers the row it
waits for the notice to go), rising 6 px and gone in 1.8 s (`XP_GAIN_MS`; under reduced motion it only appears),
no focus, no pointer, never holding the next card, said in its own polite live region a frame after it is drawn
(«Hai guadagnato 20 punti. Sei al livello 5.», emptied for that frame so the same words twice are heard twice) — and
names the level an event crossed (`nuovoLivello`); a proposal and a vote add it to their message in words a screen
reader reads, saying who earns them — after a vote a bare «+20 punti» would read as what the vote gave the card, a
weight the owners excluded (G-318) — («Scheda proposta alla comunità · hai guadagnato 25 punti», «Voto registrato · hai
guadagnato 20 punti»). Each records only what it
showed (`recordXpSeen`: the event's credits, the level only when it crossed it), so «Oggi» does not show it again: there `LevelBar` shows only what grew since this browser last
drew it (`useXpGrowth`, `xp` and `livello` under `visualex.studia.visto`, kept across days; the bar is a `progressbar` named
«Livello N» with its value in words) — the credits a read wrote, or
another device's — and presses in, once (also one reached while the page is open), a level not yet shown here, announced
politely, at rest under reduced motion; nothing on a first visit. The
points a session read credits silently («obiettivo» on an empty queue) show at the next progress read as `fatta` and in the
level, never as «+XP» in the lesson (spec §5.3).

**«Progressi», the page of the data** (`progress/ProgressPage`, `/studia/progressi`, the sidebar's «Progressi» in
«Studia» after Oggi; Gymnasium spec §5.3, G3). The same read as «Oggi» — `useProgress(undefined)` for the whole day and
`useProgress(materia, enabled)` while a subject is chosen —, no route of its own on the server. Under the area's heading
(in the sections' full-width frame, as «Oggi», G6; `StudiaPage` draws no strip over it) the page's title «Progressi»
(L-37; «I tuoi progressi» stays the section's heading for a screen reader only), then: **the summary** (`StreakBadge compact` and `GoalRing compact`, always the whole
day's, as the server's streak and goal are; the reviews of 30 days are the trend's total only — G7, Bill: the sum of
`materie[].ripassi30`, the review log joined to the cards, and the calendar's daily counters are two counts of one
thing, which part when cards are deleted for good, and read as two answers); **the subject chips** (`SubjectChips`, 44 px at every width, the subject «Oggi» remembers — «Oggi» chooses it in «Le tue materie» since G8 —, and a line saying
what it narrows); **«Il tuo andamento»** (`ReviewTrend`, G7, which replaced the calendar: see below); then, side by side
from `lg`, **«Le schede per stato»** (`CardStatesBar`: the bar's segments are buttons as before, each a 44 px box at every width with its colour
drawn 28 px tall inside on a computer, and under it the
three states by name, count and share — `shares` rounds by the largest remainder so the three add up to 100, and a state
with cards that rounds to none reads «<1%», never «0%»); **«I prossimi 14 giorni»** (`DueForecast`); **«Per materia»**
(`SubjectProgress`, two columns from `lg`: the five subjects in the road's order, `orderStops`, each an `aria-pressed` button that narrows the
page — pressed again it clears —, its share consolidated, a bar of the three states and the states in words,
`stopStates`, and the reviews of 30 days; no «N da ripassare», which the progress read does not carry by subject). Every control on the page is 44 px tall at every width
(`ProgressPage.test.tsx` guards its files against an `md:` height, as `contribuisci.test.ts` does Contribuisci's); the
trend's points and the coming days' columns are the exception the progress spec §6.3 names, reached by the arrows. The
trend, the states and the coming days are the chosen subject's read; the summary and «Per materia» stay the whole
day's. **The trend** (`ReviewTrend`, pure parts in `trend.ts`): the reviews of a period as a line — 7 days, 30 days
(where it opens on a computer; on a phone 7 days — thirty points in some 250 px read as a saw, Bill) or six months, the server's 26 weeks summed by week (`trendSeries`) —, the period's total in
Newsreader and its change on the period before, over whole days — today, only begun, out of both: the days up to
yesterday against as many before them (green 700 up, 4.5:1; ink down, never red; none when those had no reviews,
none for six months); a monotone cubic curve (`resampleMonotone`: no peak between two days,
never under zero) resampled to `CURVE_SAMPLES` (175) points so one period's curve bends into another's
(`curvePaths`) — 174 steps share out over the gaps of 7, 30 and 26 points, so every point is a sample and the curve
passes through each value exactly;
the area a wash of the line's colour through `currentColor` in the gradient's stops (`stop-color` reads no variable
as an attribute); a round scale of four ticks (`trendScale`: steps of 1, 2, 2.5, 5 × 10ⁿ, covering the goal); the
goal a dashed line named «obiettivo» (×7 by week) at its end, in the right margin, over no point; the days not done
(`calendarDayState` `saltato`, after the first day studied) small ticks under the axis, one per week with any on six
months; this week, still going, says «settimana in corso». A subject's line and dot take its hue a fifth darker on
the light card (`color-mix` with `--vlx-trend-shade`, `index.css`; amministrativo is 2.1:1 on white as it is), its
wash the hue itself; `theme.test.ts` checks the twelve hues at 3:1. A cursor follows the pointer or a finger (`touch-action: pan-y`: the page
still scrolls) with a spring, the line full up to it and lighter after, its label «mar 14 ott · 12 ripassi ·
obiettivo raggiunto» (`pointLabel`); one tab stop, the arrows by point, Home and End, a hidden live line
(`describeDay`, or «Settimana dal …» by week) that speaks for the keyboard only (a moving pointer would flood a screen
reader); «Vedi i numeri», a `<details>` with the period's table; the periods
are tabs (arrows, Home, End, the selection follows the focus). The SVG is drawn in the card's real pixels
(`ResizeObserver`), its words the interface's text laid over it at `text-xs`, never SVG `<text>`
(`typeScale.test.tsx`). The period and the opening are the page's (`ProgressPage`): a subject not read yet shows the
skeleton and mounts the chart again, on the same period and with no second opening. Opening: the line draws from the
left (a share drawn from 0 to 1, times the plot's width as it is, so a card measured after the first render draws
whole) in 900 ms while the total counts up, once — back on the same period and value it does not count again; another period, or a subject already read:
the curve bends in 500 ms, the pill slides (`layoutId` in its own `LayoutGroup`), the numbers fade; a resize redraws
at once; reduced motion draws everything at once. A newcomer (no day, no record) reads
the first-day sentence in place of the chart. The coming days' scale is the interface's text in a column beside the drawing, on whole-number
lines (`scaleLines`), the days in a row under it; today's column is tinted and its label set apart; a day with nothing
due is a hollow mark on the base. Counts go through `formatCount` (`Intl.NumberFormat('it-IT')`: «12.345», four
digits whole as Italian writes them). States: while the first read travels every block holds its final size
(`ReviewTrendSkeleton`, `DueForecastSkeleton`, `CardStatesBarSkeleton`); «Il primo giorno comincia oggi» in place of
the trend only for someone with no record (no day after 26 weeks away is not a first day); a failed read says «Non riesco a leggere i
tuoi progressi.» with «Riprova» (44 px, no alert) and keeps what was on screen; a new read of the same subject leaves
the last answer, dimmed. The summary ends with the level (`LevelBar`, G1c), the whole day's.

**Study cards under the article** (`studia/ArticleCardsRow`, behind `VITE_FEATURE_STUDIA`): one quiet
row after the discussion panel and «Chiedi su questo articolo», outside `ArticleBody` and its text root
(find-in-text and the offsets never see it): «Schede su questo articolo (n) · + Nuova scheda». The count
(`useArticleCards`: one read per address from `/api/lingo/articolo`, kept for the session in
`utils/articleCardsCache.ts`, shared between copies, `refresh()` after a save) opens `ArticleCardsPeek` (the reader's own
card is a link to `/studia/schede/:id`; a community card — `comunita: true` — is a 44 px `aria-expanded` button that opens in
place with its answer and explanation as text, because `GET /lingo/cards/:id` answers only the author); the row owns the
`CardFormDialog`, and the selection popup's «Crea scheda» (`SelectionPopup.onCreateCard`, passed through
`ArticleBody.onPopupCreateCard`, offered only by the article surface) reaches it through the row's `ref`
(`createFromPassage`). `articleCardsOffer.ts` is the one rule: a row needs a `urn:` in `norma_data.urn`
(an EU act has none), «+ Nuova scheda» and «Crea scheda» need the text in force (`readOnly` or
`versionInfo.isHistorical` marks the first `aria-disabled`, not `disabled`, so it keeps focus and its
`Tooltip` shows the reason on hover and on focus, and withholds the second). The cache is cleared at
logout (`clearArticleCardsCache`) and invalidated (`invalidateArticleCards`) after every card saved
(`CardForm`), moved to the trash (`MyCardsView`) and restored from it (`useTrash`, a `LINGO_CARDS`
entry); a generation counter keeps a read that began before either from writing what it found. The form's
institute is suggested from the article's rubric (`getRubricText`).

**Passage discussions on the reading surface**: the discussion wiring of a reading surface
lives in one hook, `useDiscussionWiring` (passage threads load and reload, the ones that still
land in the text, the panel's open state, the focused thread, the «Discuti» draft, the text
fingerprint; it returns the props the panel takes), and one status component,
`PassageThreadsStatus` (the loading line, the failed-load alert with its 44 px «Riprova»).
The article and a decision's surface both use them. Under it, `useArticlePassageThreads(anchor,
{ enabled?, plainText? })` loads the passages of one subject: the caller gives the anchor
(`{normaKey, articleId}`; the article folds `Boolean(articleId)` into `enabled`) and the plain
text, and the hook returns `locations`, where `locatePassage` says where each passage lands in
that text (the one place «detached» is computed). A reload reaches every mounted copy of the
subject (the phone view and the desktop panel) and keeps the previous list meanwhile. The result
is counted on the round-B sign (`data-threads`, speech-bubble icon). In the text, words stay clean until a
discussion is opened. The block popover (`BlockAnnotationsPopover`) lists the
block's passage discussions with their quotation, title, author, reply count,
and an «Apri glossa» action that opens the discussion panel (the interface calls
a discussion a «glossa»: «Glosse sull’articolo», «Glosse sulla decisione», «Nuova glossa»,
«Glossa sul passo»; the code keeps `thread` and `discussion`). The discussed
words light up only for the discussion open in the panel (`focusedThreadId` →
`.vlx-thread-focus`), nesting inside any highlight over the same words. When the
article text changes, a discussion whose words moved re-attaches to the new location;
a detached one stays listed in the panel with a notice and its original quotation,
never hidden or deleted. The article surface and a found decision's surface (`DecisionReadingSurface`) use this, the
decision through the same hook and panel with its anchor (`articleId: ''`); its
`renderDecisionHtml` takes `threads` and `focusedThreadId` and the text hash is that of the
projection. A decision found without its text still takes general discussions
(`DecisionDiscussionsWithoutText`: the button and the panel, no «Discuti», no passages, no text
hash). The toolbar's button is the shared `DiscussionButton`. A decision's panel withholds a
withdrawn passage's quotation from every reader but the thread's author and the admins, until an
admin releases it, and fails closed: a passage whose state is not known (loading, reloading,
failed load, a thread missing from the passages list, a decision shown without its text) is
withheld like a detached one. The rule is the panel's alone: the API still returns the stored
quotation to any signed-in caller (spec §8.7), so withholding is presentation, not access control,
and no other view may show a decision thread's `passage.quote` without the same rule. Server-side
withholding is a precondition for opening VisuaLex to the public.

**A court decision takes the same tools** (`DecisionReadingSurface`, PR 4): notes and
highlights are stored under `normaKey = decisionKey(identity)` with `articleId = ''` (wire key
`<key>::art::`), through the store's ordinary actions; the surface mounts the article's own
`SelectionPopup`, `InlineNoteComposer`/`InlineNotePopover`, `NotesPeekPanel`,
`HighlightsActionsPicker`, the round-B signs and `BlockAnnotationsPopover` (a paragraph is the
block; `decisionStructure` names them). `DecisionReadingToolbar` draws the notes and highlights
buttons and the discussion button (`ReadingToolbar` needs an article's props). Anchors that do not land are listed, never dropped
(`UnmatchedAnchors`; a decision found without text hosts it through `DecisionAnchorsWithoutText`).
**Key passages** (spec `docs/superpowers/specs/2026-10-13-decision-key-passages-design.md`; the owner: «Ok
proviamo», then «191-194 va bene»): `utils/decisionKeyPassages.ts` finds by rules, never AI, the principle of law a
Cassazione decision enunciates (its own, never a precedent's or the Prosecutor General's), the operative part of a
Cassazione or Corte costituzionale dispositivo (without costs, «contributo unificato», anonymisation, «Così deciso»),
and the Corte costituzionale's decision on each question in its «considerato in diritto» (opened where the numbering
starts again at «1.»); no other court has rules. The patterns are the ones measured in the spec on real decisions kept
outside the repository: a change to them is a change to measured behaviour, with its tests (synthetic texts, and
timings on long runs of spaces and many passages). They are ranges of `decisionProjection`, computed from the text whenever it is
drawn (memoised per text) and never stored: `renderDecisionHtml` wraps them (`keyPassages`, mark `key` inside the reader's own marks, its label an
empty-of-text `key-head` drawn by CSS), so root rule 23 holds and nothing the user saves, exports or shares carries one.
`DecisionReadingSurface` draws them, hides them with `key-passages-hidden` (`settings.showKeyPassages`, on by default,
persisted in the browser), and puts «Passaggi chiave (n)» in `DecisionReadingToolbar` (`KeyPassagesMenu`: a menu on the
desktop, a `ui/Sheet` on a phone, with the legend «Evidenziati automaticamente: non sono le tue evidenziazioni», one entry
per passage that scrolls to it at once and opens its popover, and the switch). A click on a passage, not on words under a
highlight, a link, a note or a sign, opens `KeyPassagePopover` (fixed-positioned: an absolute one, opened on a passage
still out of view, made the page itself scroll): «Fai tua» is the ordinary `addHighlight` over the passage's words at its
offset, after which the passage, nested in the highlight, loses its underline and label (they come back while the
highlights are hidden); «Nascondi i passaggi chiave».
No MERL-T events, versions or saved-norm watcher. `utils/decisionRender.ts` is the
renderer and the one definition of the layout (`decisionProjection`, `layoutDecision`,
`decisionStructure`, `renderDecisionHtml`, `unmatchedAnchors`); `decisionRender.test.ts` checks
that the rendered text nodes spell the projection (root rule 23). The .txt export of notes and
highlights is shared with the article (`utils/annotationExport.ts`). Only what really
leaves the account carries just the anchors whose words are still in the decision's text: an
archived environment's export file and the Forum (publishing, suggestions), through
`utils/decisionAnchorsTravel.ts` (`travellingAnchors`, `travellingSelection`): «the decision's
current text» is the server's cached copy (up to 30 days, the owner's choice), so words a court
has withdrawn can travel until it expires; lookups run per distinct decision, at most four at a
time, and a failure is not cached. `isAnchoredNote` (`decisionRender.ts`) is the one definition of
a note that quotes words (a note without a quote is free). The decision downloads, the notes and
highlights .txt, an archived environment's file and a dossier's JSON go through `utils/saveBlob.ts` (the
object URL is revoked later, not at once); a few older exports still make their own link. `DecisionTextView` renders a
found decision only for a host that mounts `DecisionView` without the reading surface; a practice's
entry always passes the surface. The personal files are not filtered
either: the .txt export and the PDF «Con le mie evidenziazioni e note» list the anchors that no
longer land (the PDF under «Non ritrovate nel testo attuale»), like the account export — the user's
own data (decided by the owner, 8 Oct 2026).
**Downloads** (`DecisionDownloads`, among `DecisionView`'s actions for a found decision):
«Scarica PDF» is a PDF of ours (`decisionPdf.ts`: `decisionPdfModel` is pure,
`writeDecisionPdf` draws it with jsPDF through `utils/pdfWriter.ts`, the page layout the
dossier's PDF shares; the button waits with the `Button` spinner while jsPDF loads), optionally «Con le mie evidenziazioni e note» (placed by `resolveAnchors`
over the same projection; free notes follow the text; anchors that no longer land are listed under
«Non ritrovate nel testo attuale», switchable with the `includeUnmatched` option of
`decisionPdfModel`); «PDF originale della Corte», for the Cassazione only, is the court's own file
through `/fetch_decision_pdf` (`services/decisionPdfService.ts`, via `legalFetch`). The footer of
the Corte costituzionale's PDF adds «· licenza <fonte.licenza>» (e.g. CC BY-SA 3.0), and the text ends with its
own line «Dati aperti della Corte costituzionale, licenza CC BY-SA 3.0 — <licence address>» (`licenceLine`; the
address from a small table, no line for an unknown licence); the
Cassazione's PDF and the page (`DecisionView` footer) carry no licence line (the owner, 8 Oct 2026).

**The decisions a text cites are links** (spec `docs/superpowers/specs/2026-10-13-decision-citations-in-texts-design.md`).
After `wrapCitationsInHtml`, `wrapDecisionCitationsInHtml` (`utils/decisionCitationMatcher.ts`) wraps each
decision a text cites in `span.decision-cite` (`data-decision-path` is the one source of truth, `data-cache-key`
the same address), per text segment and adding no character (root rule 23: a citation cut by a highlight is
two spans with one key). It reads the visible text with the tags removed and the entities decoded as the browser does
(soft hyphens ignored), so a mark in the middle of a number does not cut the citation, and never claims a range a `.citation-hover` span holds. Two surfaces use it:
`DecisionReadingSurface` (with `within: 'cassazione'` when the decision read is the Cassazione's, and its own
path as `selfPath`, so a decision never links to itself) and `ArticleTabContent` (Normattiva's update notes cite
the Corte costituzionale). `useCitationLinks` takes a `decisions` option (`DecisionLinksOptions`); `useDecisionLinks`
builds it and the popup's props: a click records the way back from the surface's origin, then
`openDecision(reference, { fromLink: true, besideId: <host> })` (the reference is rebuilt from the path with
`decisionReferenceOfPath`; the practice's window rule and the phone's full-screen reader are the store's).
Hover for 400 ms (`useDecisionPreview`) shows `DecisionPreviewPopup`, on the same frame as the norm popup
(`ui/PreviewFrame`, `calculatePreviewPosition`): the decision's heading and first lines from
`fetchDecisionCached` (one request per decision for the session, none without a hover that lasted; the pointer
leaving first drops the pending request), «Con questi estremi esistono N decisioni» for an ambiguous reference. For a
found decision the body is its first key passage — the principle, else the dispositivo — read with its line breaks as
spaces and named with «· evidenziato automaticamente» (`previewKeyPassage`, `keyPassageText`; computed once per answer),
else its first lines (`previewLines`): the first lines of a Cassazione decision are its parties.
**A decision in a list opens its preview** (spec `docs/superpowers/specs/2026-10-13-decision-preview-from-lists-design.md`):
every list that names a decision our reader opens — «Giurisprudenza» under an article (`CaseLawRow`: the
Cassazione, the Court of Justice's judgments; never an order or an opinion, which go to
EUR-Lex), the Massimario's chips, a topic search's window and the Cronologia (a dossier's «Giurisprudenza» reads its
decisions in place since D7a) —
opens the same body (`DecisionPreviewContent`, the hover popup's) at once on a click or Enter, through
`useListDecisionPreview` (`useDecisionPreview().openPreview`, no delay; a second click on the estremi closes it)
and `DecisionPreviewDialog`. On the desktop it is `PreviewFrame` as a non-modal `dialog` («Anteprima di …»)
by the estremi (under them, else over them by its measured height), following them when the list scrolls: the
focus goes to its «Apri accanto», Tab cycles inside, Esc (taken in the capture phase and marked taken, so a
practice's table over the rail or a modal under it stays open), the X or a press outside closes it and the focus
goes back to the estremi without scrolling to them (not after «Apri accanto», which hands it to the decision).
`calculatePreviewPosition` takes the popup's height; when neither under nor over has room it keeps the popup inside
the window, for the hover popups too (on a short window they may now cover the link they preview). On a phone
it is `ui/Sheet` (the backdrop and Esc close it). The estremi carry
`aria-haspopup="dialog"` and `aria-expanded`; ⌘/Ctrl-click and the middle button still follow the `href`.
The palette's single decision is not a list and opens on Enter as before.
«C.d.S.» and «cds» are also the codice della strada: right after an article citation («art. 142 c.d.s.», «art. 142, comma 8, C.d.S.», «art. 142 del cds») or after «del»/«al»/«dal»/«nel» they are the code and no court head, unless «sez.»/«Ad. plen.» follows them («C.d.S., sez. IV» is the court; «dal C.d.S. n. 5/2018» alone stays the code, truly ambiguous) (`isCodiceDellaStrada`, `decisionCitationParser.ts`, used by this scanner and by the find window's marker rule). The scanner never links a court that is not written (D2): a bare «n. 123/2020» stays text everywhere; the one
context rules (the owner, 13 October 2026) are two: inside a Cassazione decision a section without its court
(«Sez. U, n. 9100 del 2015») reads as the Cassazione; inside a Corte costituzionale decision «sentenza/ordinanza
n. N del YYYY» (also «sentenze n. … e n. …», each number its own span) reads as the Court's own, unless a court is
written right before it (the court covers its own citation) or right after it («… della Corte di cassazione», «…, la
Cassazione ha affermato», «… delle Sezioni unite», «… del giudice di legittimità»; a plural list is read whole first), or
when another court (any head, the referring judge, the Sezioni unite, «la Suprema Corte» among them) is the nearest court named
earlier in the same sentence ("questa Corte" or "Corte costituzionale" in between gives it back); a register number
(«reg. ord. n. 120 del 2018») is never a ruling.
`DecisionReadingSurface` passes `within` for these two courts only; no other court has such a rule. «decreto n.» of an administrative court is a known conservative miss.

**A past text is a reading** (round "Testo alla data", spec
`docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`). The server
states, next to `article_text`, the window the source's own page gives
(`ArticleData.validity`: `state`, `valid_from`, `valid_to`, …).
`utils/versionDisplay.ts` is the one table that turns it into what is shown —
the status chip (`VersionStatusChip`: "In vigore dal …", "Testo storico · dal …
al …"), the `VersionBanner`, and what is switched off — and it is tested without
a DOM. `versionInfo.isHistorical` is what was ASKED for (a date, or the original
text), never what came back. On a past text the practice's row, the dossier reader and
Study Mode take no notes, highlights, discussions or quick-norm (the selection
popup offers only "Copia"), and the update notes open;
an article that did not exist yet draws no text, only the way forward. The
"Testo alla data" dialog (`TextAtDateDialog`) replaces the old "Cerca versione"
modal; the result opens as a row of its own in the act, labelled with the day asked for (the text in
force stays another row: `practiceArticleKey` carries the version).
`utils/citation.ts` writes how a lawyer cites it, in the owner's style ("art. 1284
c.c., nel testo in vigore al 29 dicembre 2007"; "art. 2, l. 7 agosto 1990, n. 241,
nel testo in vigore al …"; the golden file is `utils/__fixtures__/citationGolden.ts`),
and a copy of a past text starts with it. A version that does not contain the day
asked for (`request_in_window` false) is shown with a warning and is not cited,
copied, exported or saved (`copyBlockedReason` says why); the update notes of a
past text are open by default and can be closed (the `updatesOpenByDefault` option
of `useArticleTextInteractions`).
**An article that will change says so** (V1, G-355): Normattiva, asked with no date, may answer with a later text
already published (art. 3 d.P.R. 131/1986, read on 21 October 2026, repealed from 1 January 2027); the server serves today's text instead, its
`valid_to` the day before, and adds `ArticleData.upcoming` (`change`: `abrogated` or `amended`, `valid_from`).
`describeVersion(validity, request, upcoming)` then gives the banner `upcoming` («Dal 1° gennaio 2027 questo articolo
è abrogato.» / «… cambia.», «Qui leggi il testo in vigore oggi, dal …» with today's window when the source gave it;
the date through `withPreposition` and
`formatDateForCitation`, `CalendarClock`, the sky tone of `current_in_window`, `role="status"`) and the chip says what the
banner says, the day in full as the banner writes it — «Abrogato dal 1° gennaio 2027», «Cambia dall'8 agosto 2027» —
in the same tone, today's window in its title — only on the text in force asked with no date, and
with nothing else switched off: today's text is cited, copied and annotated as before. `upcoming` without
`validity` (today's page unread, the article read at today) still says it, its chip with no window in the title. A
practice keeps its articles in the browser and never reads them again: past the day (`todayInRome`, the fourth
argument, which the tests give), the same answer says «… è abrogato.» / «… è cambiato.», «Qui leggi il testo in vigore
fino al 31 dicembre 2026: non è più il testo attuale.», the chip «Abrogato dal …» / «Cambiato dal …», and a copy cites
it with its window («nel testo in vigore dal … al 31 dicembre 2026», `VersionDisplay.citeAs`, which every caller of
`formatNormCitation` reads first), never as the text in force. Only `abrogated` and `amended` are read, with an ISO
day: any other `change` (G-357 adds more) or none says nothing, and neither does a text the source puts in force
after today — it is never «in vigore oggi». Every surface that draws the
banner passes `upcoming` (the reader, the dossier reader, Gymnasium's article, the comparison, where it stands above
its column and the article is still compared). It only informs: «Vedi il testo dal …» waits for the server to serve
the later text (G-357).

**«Confronta articoli»** (`features/compare/CompareView`, spec `docs/superpowers/specs/2026-10-13-compare-articles-design.md`):
a full-screen overlay (`data-find-overlay`) over two articles chosen from the practices, a search or the history; a
modal dialog in ARIA terms (`role="dialog"`, `aria-modal`, named by its title «Confronta articoli»), with `Modal`'s focus
(`useDialogFocus`: the focus on «Chiudi il confronto» as it opens, Tab kept inside, the focus back as it closes; Esc
only when it is the top-most and nothing inside took it) but not its scroll lock, and, as `Modal`, it does not make the
page behind inert: what keeps the keyboard out of the page is the trap alone. The dialog is the whole layer, backdrop included, not only the panel: what it
opens is portalled there, not in the body (`CompareDialogRoot`: the update notes' `UpdateNotePopover`, `portalRoot`),
since a modal dialog hides from a screen reader what lies outside it and its trap would pull the focus out; on the
layer the note is bounded by the window, not cut by the panel's edge. A popover portalled inside a dialog keeps its
own Tab (`useDialogFocus` leaves a focus inside `[data-floating-ui-portal]` to floating-ui's guards, which hand it to
the next tabbable after the popover's place, else its reference); should that be outside the dialog, the focus comes
back to the dialog's first control.
`Layout` mounts it — and so fetches its chunk — only from its first opening in the visit (`useCompareOpened`), a
spinner where it will stand while the code arrives, and keeps it mounted after, as before (its full-screen choice
survives a close); the spinner shows only while the comparison is open. Its code that cannot be fetched, or an error
of the comparison in use, closes it instead of taking the page down (`CompareBoundary`; on develop the app went
blank), the error in the console, no words on screen; the next opening asks for the code again, which mends a dropped
connection but not a file a deploy removed (missing until the page is reloaded, as for a lazy route — and for driver.js
and the study packs);
`lazyModules.guard.test.ts` refuses a static import of any module of `features/compare/` outside it. The
body is `CompareBody`: `compareArticles` (`utils/articleCompare.ts`, pure, ranges only) pairs the commi — by printed
number, else by words, else by place (one lone comma facing one) — and labels them (invariato / modificato / riscritto / aggiunto / abrogato) when it is the same
article in two versions, each citable (`describeVersion`; a side whose window misses the day asked for, or that
did not exist yet, makes it two articles, with that side's `VersionBanner` above the rows); two different articles are only set side by side. On the desktop a grid (label, left, right; a
hatched `GapCell` where a side has no comma), on a phone (`useIsDesktop`, one layout per breakpoint) one column with a
44 px switch between the two versions and «Differenze». Each cell is the reader's own markup for that comma:
`renderArticleHtml` with `only` (the range of whole blocks) and `changes` (the word diff's ranges, wrapped in
`.vlx-del`/`.vlx-ins`), so every column still spells its `article_text` minus `\n` (gotcha 23;
`CompareBody.test.tsx` checks it on the 27 real texts). The heading, the rubric and the AGGIORNAMENTO tail are cells of
their own (`compareLayout.ts` `layoutComparison`/`tailRange`), so nothing is left out; «Solo le modifiche» folds the
invariati and a folded comma is not drawn. «(( ))» is a light highlight with the brackets collapsed by CSS (`font-size:
0`), never removed; `(119)` references are not compared and open their note through `useArticleTextInteractions` (one
container for both columns, the note read from the article of the column the chip sits in; the tails' fold is shared).
A comma over `DIFF_WORD_CAP` words that would have been «modificato» is «riscritto» with the line «troppo lungo per il
confronto parola per parola» (`tooLong`). One scroll replaces the old synchronised scrolling (the rows are the
alignment).

**Notes**: a Peek popover (`NotesPeekPanel`) from the toolbar for browsing and
free notes; `InlineNoteComposer` anchored on the selection when creating an
anchored note; `InlineNotePopover` when clicking an existing wavy underline;
the block popover from a sign, for everything one block holds. Deliberately
distinct entry points — don't collapse them.

**Highlights**: created **only** from `SelectionPopup`. The toolbar's Highlighter
button opens `HighlightsActionsPicker`, an action bar that toggles visibility and
exports to `.txt` — it is not a second creator (that was tried and rolled back).
Hiding them also hides the signs' colour dots and the signs that hold only
highlights.

**Discussions**: the toolbar's speech-bubble button opens
`ArticleDiscussionPanel`, a draggable portal whose anchor
(`{normaKey, articleId, articleLabel?, version?}`), `label`, `heading` and
text-changed notice come from the caller (the article's wording is the default;
the load keys on the anchor's fields, so an inline object does not refetch)
(threads, replies, votes, report; moderation
is admin-only, `PATCH /admin/article-discussions/:id`). A new discussion can also
start from a selection via the "Discuti" button in `SelectionPopup`, which opens
the panel composer with a draft passage block and makes the title optional (the
quotation stands in for it). Every new discussion records the `textHash` (SHA-256
fingerprint) of the text on screen, and an article's also its `articleUrn` (a decision
records no URN: the server refuses one). The article and a found
decision's surface mount the panel (the decision's anchor is `articleId: ''`, with its own heading and notice). The panel is mounted
for every rendered article and fetches **only while open** — a load on mount
cost one GET per article of a range.

**Saved-norm change check**: when a *bookmarked* article is shown,
`ArticleTabContent` posts `{norma_data, article_text}` to
`/notifications/normas/check`; the server keeps one snapshot per
`(user, normaKey)` and answers `changed` when the **text** differs, which
the reader toasts. The effect is keyed on `(itemKey, isSavedArticle)` and
reads the body through a ref, so a re-render with the same text as a new
object does not post again; it is separate from the highlights/annotations
load effect, which stays keyed on identity alone.

**The index is a window, the text is not.** `TreeViewPanel` takes a `variant`:
`'window'` on desktop — a draggable, backdrop-less window portalled to
`document.body`, parked where the user left it — and `'drawer'` on mobile, the
old right-side sheet. Neither closes when an article is picked: taking three
articles out of an index without reopening it is the whole point. Ownership of
the desktop window lives in the store as a single `structureWindow.blockId`, so
opening one block's index hands the window over rather than stacking a second.
The floating mechanism belongs to the *tool*, not the content — the owner's own
framing, and the correction that shaped round 2a.

**Opening an act without an article.** `resolveAct` (`utils/actUrn.ts`) resolves
an act's URN structurally, with no text fetched; `addActIndexToPractice` then drops
an article-less act on the active practice (created when there is none) and points the
window at it atomically. The
palette's "Apri l'indice e sfoglia" is the entry point. An act with zero
articles is a legitimate state — guard anything that dereferences the active
article (`StudyMode` is mounted conditionally for exactly this reason).

**Going back.** `readingBackStack` records **citation jumps and the jump from an article to a decision**. Picking from
the index does not lose your place, and a previous/next arrow is undone by the
opposite arrow; recording those would fill the stack with stops nobody wants.
`ReadingBackControl` renders once for the whole app — the stack is global, so a
per-practice copy would sit inside the very place an entry points at. It names its
destination, and it has no keyboard shortcut on purpose: every natural
combination for "back" already belongs to the browser. It floats centred above the bar of practices on the desktop (`bottomOffset`
from the bar's measured height) and, on a phone, a fixed 80 px up; the bottom is the one edge the table's sticky headings and the windows' headers leave free.
The reading surfaces push a `ReadingBackEntry` (`{ tabId, blockId, articleId, articleKey?, label }`: `tabId` names a practice, one of
its windows or the phone's reader, `blockId` an act or a decision) and `pushReadingBack` keeps it as a `PracticeBackEntry`
(`{ practiceId, subject, place }`, spec §6.3) — `table` for a practice's row, `beside` for a window or the reader — the
row named by the entry's `articleKey` when a practice's row gave one (its `readingOrigin.articleKey`,
so a past text comes back as itself), else found through `findPracticeArticle`. An entry that names nothing the
practices hold is not kept. The entry is live while its practice holds the subject, and `popReadingBack` walks back to
it itself (the practice made active, the row revealed or the window reopened, or an open window asked to take focus
through `windowFocusRequest`, a one-shot signal the window takes atomically; a topic-search window is never a target; on a phone the same step opens the full-screen reader on a subject read beside, or closes it for a row of the table, since a phone has no windows).
`moveActToPractice` rewrites the entries that name the moved act.

**The practice.** A practice is the table of one question (spec `2026-10-08-norm-tab-container-design.md`):
acts with their articles, then «Giurisprudenza», and the light windows beside the table. It is UI state saved in
the browser (gotcha 17); the store holds it as `practices` with `activePracticeId`, and every way in routes to it.
A court decision is an entry of a practice, never a tab: one entry per decision per practice (`openDecision`
reuses the entry `sameDecision` matches, and a later citation that adds a section to a still unresolved entry
replaces its reference, so the entry asks again with it). `openDecision(reference, { fromLink: true, besideId })` is
the read from a link — the practice `besideId` names (a practice, one of its windows or the phone's reader),
else the active one, created as «Sentenze» when there is none; on the desktop a window beside the table, the window
the link was clicked in being the asker and so never the one a third window replaces (`besideWith`, T16); on a phone the
full-screen reader. A found answer gives the entry its identity (`setDecisionEntryIdentity`); when another entry already
holds that decision the two merge — the survivor keeps the richer fields, its window, its row, its way-back entries and
the pending reveal follow, and it asks to take keyboard focus (`decisionFocusRequest`). The ways in:
the palette (a citation such as «Cass. civ. 10787/2024» is read by `decisionCitationParser.ts`
before the norm parser, unless the first word is one of the user's alias triggers), `DecisionLink` (a
plain click opens the decision's preview; its «Apri accanto», on the search page, opens the decision beside the
article and, given a `backEntry`, records the jump in `readingBackStack` so «‹ Torna a art. 2043 c.c.» works as
for a citation jump, and elsewhere («Apri la sentenza») goes to the address; any other click follows the real
`href`, which `DecisionAddress` turns into the same entry), the
palette's ⌘K on any page (there is no decisions page), the Cronologia
(`DecisionHistoryRow`, from its preview too) and the address itself (queued in `pendingDecision`, drained by `SearchPanel`). The entry
persists its reference until the route has found it, then the identity (a cited section
travels with the reference to the route, which uses it to tell homonyms apart): the text is fetched again through `utils/decisionFetchCache.ts`.
The entry reads on the reading surface (`DecisionEntryView` over `DecisionAnswerBody`), where highlights and notes work as on an
article (see «A court decision takes the same tools»). «Cerca nella barra di ricerca», on a decision that was not found, opens the
palette with its citation typed in (`openCommandPaletteWith`, taken once). A subject has one mounted reading surface:
a row whose subject a window shows folds and says «Aperto accanto» (desktop only; a phone's reader replaces the table
instead), and the find window, the way back and the index reach the row or the window through the store's reveal actions.

**The host props.** Despite their names, `ArticleTabContent`'s `tabId` and `readingOrigin.tabId`, `DecisionReadingSurface`'s
`hostTabId` and `CaseLawSection`'s `tabId` name the host a surface reads in: a practice (its row) or one of its windows
(or the phone's reader), never a tab. They give the find window the id it registers the text root under (`findHostId` overrides
it with the window's practice), the way-back entry its `tabId`, and the links they render their `besideId`. A surface with no
host (a preview such as the palette's result card, a decision read in the dossier) registers and records nothing, and a
decision's draws no «Cerca nel testo» (`DecisionReadingToolbar` without `onToggleFind`): the find window would have
nothing of it to search. Off the search page (the dossier) its `onLeave` takes the reader to the workspace when a norm or
a decision the text cites is sent there; a host with norms of its own (the dossier, D7d) takes the cited norms instead,
`citedNorms` (`holds`, `open(citation, link)`), and nothing is searched.

### Dossier

A dossier is where the articles needed for a task are aggregated and read.
It is **di lavoro** (a practice: it may hold a client's data; the default, and what every older
dossier is) or **di studio** (a topic studied) — `Dossier.kind`, chosen in `DossierModal` and
«Modifica» (`DossierKindChoice`; a new one starts from the section's kind), listed by section — Opus the
dossiers di lavoro, Gymnasium those di studio, Academia and the Forum the last of the two (`useDossierKind`;
every dossier without Gymnasium); a dossier opened by its address switches to its kind's section
(`showSectionOfDossier`), and «Aggiungi a dossier» lists the section's kind first — and named in
the detail's header line (`kindLabel`, `dossierKinds.ts`); `published` (its copy in the Forum, the owner's alone) and
`forumBlocked` come from the server (spec `docs/superpowers/specs/2026-10-13-environments-into-forum-design.md`).
It is **grouped by act** (spec `docs/superpowers/specs/2026-10-04-dossier-per-atto-design.md`).

- **The page by act**: `dossierLayout.ts` (pure) turns the items into sections —
  the notes first (`DossierNotesSection`), then one `DossierActBlock` per act in
  the order the acts entered the dossier, then «Giurisprudenza»
  (`DossierDecisionsSection`, the decisions in stored order). With acts and decisions both (D7a) they are two
  columns from `lg`, «Norme» | «Giurisprudenza» (`COLUMN_HEADING`, a rule between them, each column in its own
  order), the norms first below `lg`; one kind alone takes the width, untitled as before. From `lg` each of the two
  scrolls on its own, at most the window's height (D7d, `COLUMN_SCROLLS`, `max-h-app-column`: the content area's padding
  and `--page-foot` off it), so a decision read on the right stays put while a norm opens on the left; each is a named
  region («Norme», «Giurisprudenza (n)») and a tab stop with the focus ring, so the keyboard scrolls it. Whatever
  scrolls a text to a passage there moves its own scroller alone (`utils/scrollParent.ts`: `scrollToMiddle` for «Vai al
  passo» and `revealAnnotation`, gotcha 34): `scrollIntoView` would move the page and the other column too. An act's identity is a code's name
  (the codice civile with or without its R.D. is one act) or `tipo_atto|numero_atto|data`;
  its heading is a code's name or the server's `act_citation`, never formatted
  here (a muted fallback until the server answers); its articles sort by annex,
  number and ordinal, the text in force before past texts. A block shows the
  act's title (`/fetch_rubriche` `title`, not for codes; an EU act's subject from
  its EUR-Lex page) and each row «art. N — rubrica» through `useActDetails` (one
  cached call per act; the tree only for an act in parts — `utils/actRubriche.ts`).
  The hook reads the whole act (`act`), never what the dossier's search left of it;
  what it read stays on screen while the act is read again and when a reading
  fails, and a block that mounts again shows it at once (the PDF falls back to it,
  `lastActTitle`). `/fetch_rubriche` answers
  200 even when the source failed, so `actStructureCache` keeps no empty answer:
  until 13 October 2026 one empty answer blanked the act's title for the session,
  and each new annex or search blanked it while it was read. Acts reorder by drag:
  `setDossierItemOrder` saves the whole order and waits, never sending a
  temporary id, while an added item is pending
  (`pendingDossierOrders`). Articles do not drag. **The page is in the planner's shape** (S7c, `dossierStyles.ts`):
  in the sections' frame (`PageFrame`, under one 44 px «Torna ai Dossier»), the dossier's name the `h1` in the reader's
  serif with no icon, wrapping at the column's width, its section's phrase over it (`kicker`: Gymnasium for a dossier
  di studio, else Opus), the description under it; then the tags, one line of the facts («Tra i preferiti · Dossier di
  lavoro · creato il … · 2 atti · 6 articoli · 3 note · 2 sentenze», `countsLine`/`countsParts` in `dossierLayout.ts`,
  which the list's card says alike) and the header's actions in one row (D3) under the title at every width — beside it,
  a long name was squeezed into a narrow column, and before S7c pushed the actions off the page at 1366 px: «Apri
  tutto su Dashboard», «Aggiungi», «Esporta», the Forum's and «⋯» (`ui/MenuButton`; «Seleziona elementi» lives
  there). Every control is 44 px at every width, as the planner's (the search is the planner's `FIELD`); the act
  blocks, the free notes and «Giurisprudenza» are tiles (`SECTION_TILE`, no shadow) headed in the reader's serif, no
  small capitals, and their entries rows of two levels, as the planner's tasks (`ROW`, a rule under each): a title
  (15 px), a grey line (13 px: an article's rubric, else «Aggiunto il …», nothing when neither is known; a note's date
  and who wrote it, under its words; a decision's «Aggiunta il …»), the signs, then the star and the removal (44 px,
  always there) at the right; no hand-written blue.
- **Notes**: every note a dossier gets from the web takes the notes route
  (`addNoteToDossier` → `POST /dossiers/:id/notes`), the one Claude's notes take
  through MCP. A note about an article (`aboutItemId`) sits with it: a count on
  the closed row, the notes above the text when open, «Aggiungi una nota
  all'articolo»; a note whose article is no longer in the dossier shows among
  the free notes. Nothing on the dossier's page draws who wrote an entry (D7b): not the rows of articles and
  decisions, in their name neither, nor the notes, whose application's ones say it by their validation
  (`AiNoteEntryReview`). `createdBy` stays in the database, the account export and the PDF, which writes
  `claudeMarkSentence` («scritta da Claude Code (applicazione collegata)»); `ClaudeMark` is Studia's now. An undone removal
  keeps the ids (question 181): «Annulla» restores the trash entry, so a note stays
  about its article and Claude's mark survives, as in the MCP trash. The note dialog closes only once
  the server has the note, so a refused note keeps its text.
- **«Pubblica nel Forum»** (`DossierForumActions` in the header, spec
  `docs/superpowers/specs/2026-10-13-environments-into-forum-design.md` D3–D7; the owner's answers of
  14 October 2026): a dossier never published shows «Pubblica nel Forum» (disabled, «Ritirato dai dossier
  pubblici», when the admin withdrew its copy: `forumBlocked`); a published one a «Forum» menu naming its state
  («Nel Forum · v N», «Ritirato dai dossier pubblici», «Ritirato dall'amministrazione») with «Aggiorna la versione
  pubblicata», «Ritira dai dossier pubblici» / «Ripubblica nel Forum», «Apri i dossier pubblici» and «Elimina dai
  dossier pubblici» (danger confirmation, «Eliminare la copia pubblicata?»);
  each reads the dossier again (`refreshDossier`). `PublishDossierDialog` (a `ui/Modal`) asks title,
  description, category (`utils/forumCategories.ts`, the one list) and tags, reads the marks once, at
  opening, from the server (`publicationMarks.ts`: `loadPdfMarks`, never the browser's partial cache; a
  decision's anchors only when their words are still in its current text, `travellingSelection`, what is
  left out said in a sentence), and shows the preview built by
  `dossierPublication.ts` (`buildPublication`, pure: one function makes the rows and the payload, so
  nothing leaves that a row did not show). Every entry travels except a norm the rebuild refuses (listed
  as left out); highlights start ticked, every note — the dossier's own, those on its articles and
  decisions — unticked; a row whose article also sits in one of the user's dossiers di lavoro says so
  (the name is never sent). Marks are read under the private item's keys and sent under the rebuilt
  entry's (`rebuildNormEntry` then `buildItemKey`), so a downloader's reader finds them; text and anchors
  as stored (root rule 23). The machine's check (`utils/personalDataPatterns.ts`: codice fiscale,
  partita IVA and IBAN with their check digits, e-mail and PEC, Italian telephone numbers; never names)
  marks what it finds in the fields and the rows, changing no character; the owner's warning, one more
  line for a dossier di lavoro, and the required «Ho controllato: non contiene dati personali» stand
  before «Pubblica». An update starts from what the Forum holds (`getById`, once, never over a field the
  user changed; the minute's `refreshDossier` neither resets it nor reads the marks again) — its ticks too:
  exactly the notes, highlights and note entries the published copy carries (`ticksFromPublished`, by each
  row's `match`), so an update never drops a note sent before nor sends one left out — sends a new
  version and clears an emptied description (`null`); a 409 on «Pubblica» reads the dossier again and the
  dialog becomes the update.
- **The trash** (what a connected application deleted, and the dossiers, the entries removed from a dossier and the study cards the user deleted, 30 days; spec §10-11):
  one `useTrash` in `DossierPage` feeds «Cestino (n)» on the list (shown only
  when there is something), the page `?trash=1` (`TrashPage`: dossiers, entries
  «Da «dossier»», «Schede di studio» by their first questions) and a dossier's
  own «Rimossi di recente (n)» at its bottom (`DossierRecentlyRemoved`). Each
  entry (`TrashEntryRow`, `trashSummary.ts`) is restored whole — a 409 asks
  which dossier to restore into; a 404 drops an entry the server no longer has, and with a dossier
  chosen the trash is read again to tell that from the chosen dossier gone (asked again) — or
  emptied behind a danger confirmation; a
  restore reloads that dossier from the server (`refreshDossier`). A dossier deleted
  from the web goes there (owner, 13 October 2026, question 160): `deleteDossierWithUndo`
  (`dossier/deleteDossierWithUndo.ts`, the list's and the detail's «Elimina») removes it
  from the store, the server answers the trash entry's id, and the toast «Dossier «…»
  spostato nel cestino» has «Annulla», which restores that entry and reads the dossier
  back; a refusal puts it back where it was with a sync error and no toast. «Salva come
  dossier» that saved nothing discards its empty dossier from the trash at once
  (`discardEmptyDossier`, only when the server says it held nothing). Nothing replaces a
  workspace any more: «Sostituisci» went with environments (spec
  `2026-10-13-environments-into-forum`, D10). The page's trash is read again after a deletion and after «Annulla». Entries removed from
  a dossier go there too (owner, 13 October 2026, question 181): one article, a whole act
  («Rimuovi l'atto»), a multiple selection, a note, a decision. `removeItemsWithUndo`
  (`dossier/removeItemsWithUndo.ts`, wired in `DossierDetailView`) calls the store's
  `trashDossierItems(dossierId, ids)`, which removes them from the store and sends ONE
  `POST /dossiers/:id/trash-items`, so one action is one trash entry («3 articoli da «Ricorso
  Rossi»», «Rimosso da te»); the toast («Elemento rimosso», «N articoli rimossi») has «Annulla», which
  restores that entry and reads the dossier back (`refreshDossier`, not quiet); a refusal puts the
  entries back where they were with a sync error and no toast. An entry still saved (a temporary id in
  `pendingDossierItemIds`) refuses the whole removal with «Riprova tra un istante»: nothing is half removed.
  A multiple selection is removed with no confirmation, like the rest: «Annulla» is the way back (K1a). Nothing the web
  reaches deletes an entry for good any more (`removeFromDossier` and `restoreDossierItem`, which
  re-created entries under new ids, are gone). Study cards go through it too: «Elimina» on a draft or an archived card in
  «Le mie schede» (`studiaService.trash`) moves it at once, and the notification's «Annulla» restores the trash entry
  (`trashService.restore`) and lists it again (K1a).
  A decision in the trash is named by the server's citation.
- **What another application changes shows without a reload** (`useDossierRefresh`, mounted by
  `DossierPage`): the open dossier (`refreshDossier(id, { quiet: true })`) or the list
  (`refreshDossiers`) is read again when the window comes back into focus or into view, and every
  minute while visible, at most once in 15 s; the trash joins the focus and the poll. Quiet reads
  only log a failure; they are skipped, or their answer dropped, while any dossier write is on its
  way (`dossierService.writesInFlight()`, counted around every write the service makes) or when the
  dossier (or the list) changed here while they travelled (Immer's new object); a dossier with an
  add, an undo or an order pending is kept as it is, never merged. The pushes a read may have
  beaten (`createDossier`, `importDossier`, `addNoteToDossier`) replace an entry with the same id
  instead of adding it twice. No websockets.
- **Decisions** (`type: 'sentenza'`): the item stores the identity, the attributes the item
  schema accepts and a label, never the text. They are added from the decision's reading surface
  («Aggiungi al dossier», `AddToDossierPopover` with `sentenza`) and listed after the acts under
  «Giurisprudenza» (`DossierDecisionsSection`, D7a: each decision a row as an article's, `DossierDecisionRow` — the
  checkbox while selecting, the arrow, the citation over «Aggiunta il …», the star, the removal, 44 px — opened in
  place by `DossierDecisionReader`: the decision's own reader, `useDecisionAnswer` and `DecisionView` with
  `DecisionReadingSurface`, never another, so notes, highlights and key passages work as anywhere and the text is the
  reader's, gotcha 23; asked for only once opened; a decision without its text opens too and `DecisionView` says how it
  came; «Apri la sentenza», the address, over it whatever came back. No tab holds it: no «Cerca nel testo», and a cited
  decision takes the reader to the workspace, `onLeave` (see «The host props»). A cited norm is the dossier's (D7d,
  `useCitedNorms` through `CitedNormsContext`, the surface's `citedNorms`, on the links the reader already draws, gotcha
  23): one the dossier holds (`citedArticleOf`: a code of `CODE_NAMES` by its name, any other act by its type, then by
  number and year only where both sides give one — «art. 141 c.d.s.» gives neither, its entry may carry 285 and a date;
  the article in any spelling, outside annexes; the text in force first) opens in
  the norms' column — a search hiding it cleared, the link clicked held at its height (`keepLinkAt`: the cleared search
  makes the decision's column a scroller again), its act unfolded, its row opened and scrolled to the column's top, the
  page moving only if the row is still off the window (`bringRowIntoView`, each scroller alone, gotcha 34), focused and
  ringed for 1.6 s (`flashedId`, drawn by React through `DossierActBlock` to `DossierArticleRow`'s `isFlashing`); the
  preview's button says «Apri tra le norme». One it does not hold opens nothing by itself: by the
  link, `CitedNormChoice` offers «Apri su Dashboard» (the search of its text in force, as before) and «Aggiungi al
  dossier» (`AddToDossierPopover` on the norm as `/fetch_article_text` answers it); the preview's button, «Apri su
  Dashboard» there, still goes straight to Dashboard. The links take no keyboard focus, here as anywhere in the
  reader, so the keyboard reaches neither way (as before D7d). The acts' «⋯» opens upwards when the column has no room
  below (`MenuButton`'s `placement="auto"`). The row names the decision, so inside its full name is a quiet line of
  details, not a second and heavier title (`DecisionView`'s `title="line"`; the practice keeps its h4), and the
  opened decision is a region named by the row's citation (`aria-labelledby`, no new words on screen), so a screen
  reader still finds it by its name. The application that filed it is not drawn on the row (D7b, as an article's
  row); the item's `createdBy` stays. No note count: the server takes a note about an article only, `assertArticleOfDossier`, and counting the notes and
  highlights on each text would cost a read per decision.) «Seleziona tutti» takes
  the decisions with the articles; «Apri tutto su Dashboard», on the page and on the list's card, opens a dossier of
  decisions alone too, one practice holding them; «Espandi tutto» opens the articles only, each decision being a request
  to its court's source, and leaves a decision open as it was; «Comprimi tutto» closes every row, the decisions too (in
  a dossier of decisions alone it is all the button offers, once one is open). The block of acts is hidden, still
  mounted, while no act is on screen. In two columns the
  acts' headings are h3 under «Norme» (`headingLevel`); an act's header follows its own width (`@container`): narrower
  than 42 rem (672 px at the default text size) its name wraps, its count following the name's last words on their line (not on a line of its own), its
  actions keeping their icons only; and the page keeps the same elements whatever the search leaves,
  only their classes changing, so an open article is never remounted. The stored `etichetta` is a copy (source convention, D9):
  `decisionCitationOf` recomputes the citation from the identity and the attributes, every write
  sends it (`itemContentFor`, `serverItemFor`), the server recomputes it again on every write
  (`withDecisionLabel`), and every screen shows the recomputed one, never the copy.
  `parseSentenzaContent` (dossierUtils) mirrors `apps/server/src/schemas/decisionItem.ts`:
  change both together. Every switch over item types ends in `assertNever`, so a new type cannot
  fall silently into "note".
- **jsPDF is loaded on the first export** (`utils/loadJsPdf.ts`, a dynamic `import()` kept for the next
  export and retried after a failed load — a chunk a deploy removed keeps failing until the page is
  reloaded, as a lazy route does): with pako and fast-png it is ~120 KB compressed that every page,
  sign-in included, would otherwise download. Its users — `writeDossierPdf`, `writeDecisionPdf`,
  `AdvancedExportModal` — are async and name jsPDF with `import type` only; `loadJsPdf.guard.test.ts`
  refuses, in any source file, a value import or re-export of it or of what it brings. A button that
  writes a PDF shows the wait (spinner, disabled, `aria-busy`) with its own label, no new text; a load
  that fails says what a failed write already said («Download non riuscito: riprova.», which «Esporta
  articolo» borrows; the dossier's toast). «Esporta articolo» cannot be closed or changed while its PDF
  waits, as `DossierPdfDialog`; a host that closes or unmounts it meanwhile (StudyMode's Esc leaves the
  whole mode), or a reader who leaves a decision, cancels the download. `pdfIdentity.test.tsx` holds the bytes of a dossier, a
  decision and an article PDF (date, time zone and `Math.random` fixed), so a change in how jsPDF is
  reached cannot change the file.
- **The PDF** (`dossierPdf.ts`) is grouped the same way and prints each
  article's text as the reader shows it, fetched through `articleFetchCache` —
  never a stored `article_text`, which items added through MCP or «Importa da
  norma» do not have (spec `docs/superpowers/specs/2026-10-13-dossier-pdf-decisions-design.md`).
  «Esporta → PDF» opens `DossierPdfDialog` (a `ui/Modal`), which only asks: «Cosa
  stampare» («Testo completo», the default, or «Solo le parti evidenziate e annotate») and, when the
  dossier holds decisions, «Sentenze» (a checkbox per decision, labelled `decisionCitationOf`, all ticked,
  «Tutte»/«Nessuna»); `DossierDetailView.handleExportPdf({ excerpts, decisionIds })` loads and writes, the
  dialog shows «Preparo il PDF… n di m» (`role="status"`, one count for texts and decisions), cannot be
  closed meanwhile and closes when the file is saved. The chosen decisions are a «Giurisprudenza» section after
  the acts, in the dossier's order: `loadDossierDecisions` reads each through `fetchDecisionCached` (three at a
  time), `decisionPdfModel` lays it out with the reader's highlights and notes exactly as its own PDF
  does and `drawDecisionHead`/`drawDecisionBlocks`/`drawDecisionTail` (`decisionPdf.ts`, the pieces of
  `writeDecisionPdf`) draw it into the dossier's writer; one that cannot be read says
  «Testo non disponibile al momento» and counts in the toast. «Solo le parti» (`pdfExcerpts.ts`, pure)
  prints per article and decision the passages the reader marked: `resolveAnchors` over the projection the
  anchors were made on (`article_text` without `\n`; `decisionProjection`), anchors that overlap or touch
  merged, each passage followed by the notes anchored in it («Nota: …»), «[…]» where text is left out,
  «Nessuna parte evidenziata o annotata» for a text with none. The passage is cut from the stored text
  (`articleTextBetween`, `decisionTextBetween`): no character changes, the `\n` inside an article's passage stays
  and a decision's paragraphs and lines are joined as `decisionPdfModel` joins them (root rule 23). A past text
  takes no marks (gotcha 32); the notes about an article as a whole and a decision's free notes and lost
  anchors print as in the full text. `loadPdfMarks` (`dossierPdfMarks.ts`) reads the marks from the server with the
  store's wire prefix and mappers (`getByNormaKeyPrefix`), not through the store's `load…ForArticle`, which
  swallow a failure and return while a reader's own load is on its way, and keeps those under the readers' keys
  (`buildItemKey` + `uniqueArticleIdFromNorma`; `decisionKey` + no article). A text whose marks could not be
  read prints «Evidenziazioni e note non disponibili al momento» and counts in the toast, never «Nessuna parte
  evidenziata o annotata».
- **Rows expand in place**: clicking a norma row renders `DossierItemReader.tsx`
  inline, reusing the dashboard reading layer (markers, `SelectionPopup`, note
  composer and popover). "Apri su Dashboard" and "Copia citazione" live in the
  expanded footer. `ArticleViewerModal` no longer exists.
- **Fetching**: `utils/articleFetchCache.ts` — session-only cache, in-flight
  de-dup, max 3 concurrent fetches, errors not cached so "Riprova" really
  refetches.
- **Important star**: reading statuses (unread/reading/done) were removed. The
  star persists through a `_dossierMeta` envelope packed into the item's `content`
  JSON — no backend schema change — via `packItemContent`/`unpackItemContent` in
  `dossierUtils.ts`. `updateDossierItemStatus` writes only `'unread' | 'important'`
  and defers the PUT while an item is still in `pendingDossierItemIds` (its
  `addItem` POST hasn't returned a server id yet), replaying it once settled.
  Legacy status values still hydrate and simply render as unstarred.
- **Collection**: `AddToDossierPopover.tsx` is the add-from-reading entry
  point for articles (from `ReadingToolbar`) and for
  decisions (`DecisionView`'s actions, with `sentenza`). It lists recent dossiers,
  guards duplicates, and its inline "Nuovo dossier" waits for the server id
  before adding — `createDossier()` returns `Promise<string | null>`.
  `DossierModal` is create-only.
- **Rows** (`DossierArticleRow`): the expand toggle lives on a header-scoped
  sub-div, never wrapping the reader or the action buttons (see gotcha 22); the
  star and the removal are 44 px at every width (S7c). The accessible name carries the server's
  `citation`, so two laws' art. 3 never read alike.
- **Versions**: an item keeps the version it was added with (`versione`,
  `data_versione`), whichever button added it (`normaForDossier` for the window
  header's), and `dossierContainsArticle` tells two versions of one article apart,
  so both can sit in one dossier. A row shows "Testo al 29/12/2007" for a past
  text; the reader is read-only on it (gotcha 32).
  The item key (`buildItemKey`) carries no version, by contract (annotations are
  keyed on it), so whatever caches, groups or compares items by article adds
  `versionKey` (`utils/versionDisplay.ts`): the reader's fetch cache
  (`articleFetchCache`), `computeNormaGroups`, `dossierContainsArticle`. "Apri tutto"
  and the quick-open of the list view build their searches from a group
  (`searchParamsFromGroup`, `searchesForGroups`) into ONE practice (`dossier/openInPractice.ts`): a
  group asking for a past text lands as rows of its act, beside the text in force; the dossier's
  decisions come too when the whole dossier is opened, unread (`addKnownDecisions`).

## Shared utilities — check before writing a new one

Duplicating any of these is a defect, not a shortcut.

**Frontend**:
- `utils/normaKeys.ts` — `buildItemKey(norma)` (norm + article),
  `buildNormaKey(norma)` (act only, used to group streaming results),
  `uniqueArticleIdFromNorma(norma)`. Both keys share their act-level segments so
  they cannot drift. `buildItemKey` is the annotation/highlight key contract and
  must stay byte-identical across dashboard and dossier.
- `utils/findInText.ts`, `utils/citationSearch.ts`, `utils/findHighlights.ts`, `utils/findScope.ts`, `utils/findTargets.ts`,
  `utils/findWindowControl.ts`, `hooks/useFindWindow.ts`, `hooks/useRegisterFindRoot.ts`,
  `hooks/useFindWindowScopedTo.ts` — find in the text:
  `findMatches`/`collectSearchableText`/`rangesForMatches` (folded, 1:1 offsets; `isSearchableQuery`
  is the one rule for «long enough»), the owner-keyed highlight registry (`setFindRanges`,
  `clearFindRanges`), and the window's scope, targets and hook (debounced typing, the current match
  kept across a redraw, re-search when the text changes). Read-only over the DOM. `features/search/findBarParts.ts` (`counterText`, `ICON_BUTTON`) is the counter and icon button of the window; `features/search/toolbarToggle.ts`
  (`toolbarToggleClass`) is the look shared by the toolbar toggles (`DiscussionButton`,
  `FindInTextButton`): add a toggle with it, not with a copy of the classes.
- `components/features/search/caseLaw/` — case law under an article: `CaseLawRow` (the one row),
  `caseLawYears.ts` (a row's years, the counts, the range, the order — pure), `caseLawFilter.ts` (the text
  filter, folded as the find window folds: `findMatches`), `authorityColor`, `caseLawFiltersContext`. A new
  source of case law draws `CaseLawRow` and reads `useCaseLawFilters`, it does not bring its own filter.
- `utils/actUrn.ts` — `resolveAct(params)`: an act's URN and identity with no article text
  fetched. It sends `article: '1'` because the endpoint refuses to build a
  `NormaVisitata` without one — a probe, not a request for article 1.
- `services/legalFetch.ts` — `legalFetch(path, init)`: `fetch` for the Python routes
  (`/fetch_*`, `/stream_article_text`, `/export_pdf`, `/parse_query`, `/health/detailed`…).
  It sends the login token (refreshing it first when expired, once more on a 401, through
  `api.ts`'s single in-flight refresh) because the production ingress refuses those calls
  without one, and it returns fetch's own `Response`, so the NDJSON stream and the PDF
  work as before. `/version` and `/health` are the two that stay open.
- `utils/decisionCitationParser.ts` — `parseDecisionCitation(input, { aliasTriggers })`: a decision as
  typed in the palette; it reads only an input that starts with a court and needs number and year,
  or a case of the Union («C-634/21», «causa T-612/17»: the letter names the court), or an
  administrative court («Cons. Stato, sez. VI, n. 2270/2019», «TAR Lazio, Roma, ord. n. 1234/2020»;
  a parere is left to the API, which names it as a court it cannot read). The Python
  API's `decisions/citation.py` reads the same words; both assert the golden file's `decision_citations`.
  `readDecisionCitation` returns the reference with where its words are (`headEnd`, `words`), and the
  parser exports its court-head sources (`COURT_HEAD_SOURCE`, `EU_COURT_HEAD_SOURCE`, …) for the scanner.
  `utils/decisionCitationMatcher.ts` — the decisions a running text cites: `extractDecisionCitations(text,
  { within, now })` gives `{ start, end, reference, path }` spans over the text (a court head, a bounded tail
  of 200 characters cut at the next head, at a sentence end, at «;», at a «)» it did not open and at the Gazzetta Ufficiale, handed to
  `readDecisionCitation`; the words between the court and the number must be citation words, no number of
  another, and an «e» right after the court, or an «e la sentenza» / «e la n.» before its number, ends its citation («Consiglio di Stato e la sentenza n. 7»); a list whose
  year is written once at its end («sentenze n. 96 e n. 229 del 2015») is one decision per number, only when nothing
  but citation words stands before it; a section written in words («sezione prima civile») is a citation word
  (the span links without a section: the parser reads the code of «sez. III», not of «terza»); the reference is read again from the span's own words; never inside an act's citation,
  `allActSpans`), and `wrapDecisionCitationsInHtml` (see «The decisions a text cites are links»). Pinned to
  the golden file's `decision_citations_in_text` (web only, no Python twin) by `decisionCitationMatcher.test.ts`.
  `utils/decisionFetchCache.ts` — `fetchDecisionCached`, one request per decision for the session
  (50 answers, least recently used out; a failure is not kept; `clearDecisionCache` at logout). `utils/workspaceOrigin.ts` — the id of the results area
  (`WORKSPACE_AREA_ID`) and its rectangle, which the find window and the row of windows are placed against.
- `utils/decisionLinks.ts` — the addresses of court decisions (`decisionPath`,
  `parseDecisionPath`, `decisionKey`, `identityFromKey` and `isDecisionKey`, which read a key back) and their names (`formatDecisionHeading`,
  `formatDecisionCitation`, and `formatDecisionShort` — «Cass. civ., sez. un., n.
  31310/2024 · Rv. …», for chips and lists — both pinned to
  `conventions/sources/golden.json`). The courts of the Union (`corte_giustizia_ue`,
  `tribunale_ue`) are named by their case (`/sentenze/corte-giustizia-ue/634/2021`, «Corte giust.
  UE, sez. I, sent. 7 dicembre 2023, causa C-634/21»); their closed values and labels live in
  `utils/euCourts.ts`, the twin of the server's `norms/euCourts.ts`. The administrative courts
  (`consiglio_di_stato`, `cgars`, `tar`; design `docs/superpowers/specs/2026-10-12-administrative-courts-design.md`)
  carry the kind (`provvedimento`) and a TAR its seat in the identity
  (`tar:roma:ocau:1234:2020`, `/sentenze/tar-roma/1234/2020?provvedimento=ocau`; a sentenza's path
  names no kind); a reference the words left open is keyed `/sentenze/tar/…?regione=Lazio` and
  `?tipo=ordinanza`, never taken for an identity. Their seats, names and closed values live in
  `utils/adminCourts.ts`, the twin of the server's `norms/adminCourts.ts`, its `SEATS` pinned to
  `conventions/sources/tar-seats.json`. Never write a decision's label inline. The paths
  `/sentenze/<corte>/<numero>/<anno>` are a contract with LibreLex and the MERL-T graph: never
  rename them (spec `docs/superpowers/specs/2026-10-01-sentenze-design.md`). Its first block is
  shared with the Massimario panel (`linkableDecisionPath`); `httpsUrl` keeps a source link to
  https only.
- `services/decisionService.ts` — `fetchDecision(reference)`: `POST /fetch_decision` through
  `legalFetch`. Only the route's six `esito` values are read as its answer: a quota refusal, or
  any other body (the rate limit's, the login gate's, a framework page), is "fonte non
  raggiungibile", and `errore_interno` a generic error; neither is ever "non trovata".
- `utils/decisionText.ts` + `features/decisions/DecisionTextView.tsx` — a decision's text, one
  span per line: the text nodes spell the received text minus `\n` (the same contract as
  gotcha 23), labels and the space between lines come from CSS, and a copy is composed by
  `decisionClipboardText` so it reads as the page does. An epigrafe without a motivazione is
  labelled «Testo» (the owner's decision); a decision found without its text draws no block
  (`hasDecisionText`).
- `utils/returnTo.ts` — where the login sends the reader back: router state or the
  sessionStorage stash, only what the browser's URL parser reads as a path of the app, never a
  URL parameter; a logout forgets it. `authPageTab` names the tab of the sign-in page a path opens
  (`/login`, `/register`, read as the router reads them: case, trailing slashes, percent escapes) and
  `isLoginPage` is either tab: never stashed, never returned to.
- `utils/readingBackStack.ts` — `appendBackEntry`, `peekReadingBack`,
  `findLiveBackIndex` (over the practices), `ReadingBackEntry` (what a surface pushes) and `PracticeBackEntry`
  (what the stack holds) for citation-jump undo.
- `utils/practice.ts` (+ `utils/practiceMigration.ts`) — the practice's model and its rules, pure: `practiceArticleKey`
  (`buildItemKey|versionKey`, what makes a row), `sanitizePractices` (saved state is untrusted input), `addArticles`,
  `findPracticeArticle` (tolerant, gotcha 9), `decisionOrder`, `holdsSubject`/`subjectOfRef`, the row and window
  keys (`articleRowKey`, `decisionRowKey`, `articleWindowId`); `practicesFromTabs` reads the old saved workspace once.
  Reach for these before writing a second comparison of two articles.
- `hooks/useIsDesktop.ts` — viewport check for components that must render
  *structurally* different markup per breakpoint (portal vs. inline). It existed
  as two private copies before round 2a; do not make a third. `useMediaQuery(query)`, beside it, is
  the same check for another breakpoint (the sidebar's `xl`). For anything a CSS
  breakpoint can express, use the CSS breakpoint.
- `utils/articleSuffixes.ts` — `ARTICLE_ORDINAL_SUFFIXES` and
  `ARTICLE_SUFFIX_ALTERNATION`, the one ordinal table behind every article-number
  regex (`citationMatcher`, `citationParser`, `treeUtils`, `articleStructure`).
  Mirrors `services/visualex/visualex_api/tools/article_suffixes.py`, as does
  `apps/server/src/utils/articleSuffixes.ts` — change all three together. Each
  pattern must close the alternation with `\b`.
- `utils/articleIds.ts` — `getUniqueArticleId(article)` (canonical `allN:num`),
  `filterLoadedIdsForAnnex(ids, annex)`, `findArticleByNormalizedId(articles, id)`
  (**tolerant** lookup — required, see gotcha 9).
- `utils/dateUtils.ts` — `parseItalianDate`, `formatDateItalianLong`,
  `expandTwoDigitYear` (the one two-digit-year pivot, same as the backend's
  `_expand_year`: "90" → 1990, "23" → 2023), `formatDateDashed` ("29-12-2007",
  the way Normattiva writes a day), `formatDateForCitation` ("1° ottobre 2026"),
  `withPreposition` (a preposition and the date it governs, elided before 8 and
  11: "dall'11 giugno", "all'8 settembre"; the version banners and the citations
  (`consultato il …`) go through it, and so does any new sentence that
  puts a spelled-out date after "il", "del", "dal", "al" or "nel"),
  `addDaysToIsoDate`, and `todayInRome` (the day the server compares a
  `version_date` with; the browser's own day can differ).
- `utils/versionDisplay.ts` — `describeVersion(validity, request, upcoming?, today?)` (chip, banner,
  what is shown and what is off: `readOnly`, `textVisible`,
  `canCite`, `canCopyOrSave` with its reason `copyBlockedReason`,
  `updateNotesOpen`), `versionKey` (which text a request asks for, as one string),
  `requestedVersion` / `versionLabel` (a request as the original, a day or the text in force, a day winning over
  «originale» as in the tab; «testo al 31 dicembre 2015», «testo in vigore»), `requestIsHistorical` (mirrors the server's
  `is_historical_request`), `deriveVersionInfo`, `isEuropeanAct` (mirrors
  `get_scraper_for_norma`), `buildTextAtDateParams`, `versionTabSuffix`,
  `historicalItemLabel`. Every surface that renders article text goes through
  it (gotcha 32).
- `utils/citation.ts` — `formatNormCitation` (null when there is nothing honest
  to cite: the text in force with no day, an act of the Union, an article that did
  not exist, a version that does not contain the day, a repealed article with no
  repeal day stated; its head is `citeNorm`), `unversionedCitation` (what a copy
  starts with when no version is cited: the text in force's, never on a past text)
  and `withCitation(text, citation, inForce)`, which puts the citation first — the
  version's, else `inForce` (`unversionedCitation`); the wording is the golden file's.
- `utils/euCitation.ts` — the one reading of an EU pair ("2024/2847" is year
  then number, "679/2016" the reverse, "2006/2004" number first), shared by
  the palette parser and the in-text matcher and mirrored by
  `resolve_eu_year_and_number` in `nl_parser.py`, which `citation_linker.py`
  reuses through `build_eu_act_pattern` / `eu_act_from_groups`. Change all
  four together. The two in-text detectors (`citationMatcher.ts`,
  `citation_linker.py`) read the same prose forms: "regolamento (UE)
  2016/679, art. 5", "art. 5 del regolamento (UE) 2016/679", "art. 5, comma
  1, del …", and a list ("articoli 8 e 9 del …") becomes one link per number,
  all towards the EU act. The matcher also reads documents a user drops in, so its patterns read a run of
  spaces in one way only (`\s*(?:,\s*)?`, never `\s*,?\s*`; two adjacent `\s*` are quadratic) and its used
  ranges are a byte map, not a list: `citationMatcher.test.ts` and `citationParser.test.ts` (the palette's parser, `extractArticleRefs`) time 100 000-character runs. The client matcher reads the article-first form
  for numbered national acts too ("art. 7 del d.lgs. 196/2003", with or
  without the preposition), as the server's `_EXPLICIT_CITE_RE` and
  `_ART_DEL_ACT_RE` do, and the codici and the Costituzione named in full
  ("art. 5 del codice civile") through `FULL_ACT_NAMES`, the palette's own
  vocabulary. An article the prose gives to an act no pattern can read
  ("art. 17 della legge 23 agosto 1988, n. 400") gets no link on the
  client rather than one to the act being read.
- `utils/sources/` — how a norm is written, for each use (the source convention,
  `docs/superpowers/specs/2026-10-04-source-convention-design.md`; pinned to
  `conventions/sources/golden.json` by `sources/__tests__/golden.test.ts`):
  `citeNorm` («art. 2, l. 7 agosto 1990, n. 241», «art. 2043 c.c.»), `shortNorm`
  («art. 2 l. 241/1990»: rows of an article, comparison, chips, quick norms),
  `citeAct`, `shortAct` (an act's short label), `actHeading` (a code's name, else the act
  citation: an act block's title), `actSubtitle`, `inForceCitation` (what a copy
  of the text in force starts with, D8), `labelFromParams` (the parsers'
  previews), `normFromUrn` (a Normattiva URN or an ELI read back into a norm; the
  preleggi are never the codice civile). `actTypes.ts` holds the tables; its
  `CODES_TABLE` is a copy of the API's `NORMATTIVA_URN_CODICI`, and `ANNEXED_ACTS` of the
  API's table of acts whose text is their annex (the TULPS), and the golden test fails when
  either differs. A code's default annex, and such an act's annex, are never named in a
  label (G-350, G-351). Never write a norm's label inline: a new surface
  picks one of these.
- `utils/sources/normEntry.ts` — `rebuildNormEntry`: a norm from someone else (a shared
  environment, a file, a share link) rebuilt from closed values — a known act type, fixed forms,
  unknown keys dropped — or refused with an Italian reason. `validateImportedDossier` runs it on
  every imported norm and counts what it leaves out. A copy of the server's, both pinned to
  `conventions/sources/norm-entries.json`.
- `utils/normaMeta.ts` — `formatNormaMeta(norma, articleCount?)`, the line under an act's
  heading (`actHeading`, `utils/sources/`): only
  what the title does not say (a code's decree, an aliased code's name, «Estremi
  non disponibili»), often empty.
- `utils/articleFetchCache.ts` — `fetchArticleForNorma`, cached and capped.
- `utils/articleCompare.ts` — `compareArticles(left, right)`: two articles comma by comma, as ranges (units, pairing,
  labels, per-comma word diff, summary; `summarySentence` writes the sentence). Read its header and
  `features/compare/CompareBody` before writing another comparison of two texts.
- `utils/articleStructure.ts` + `utils/articleRender.ts` — the structured
  reading text (see Reading surface). `parseArticleStructure`, `getRubricText`,
  `getUpdateNoteParagraphs`; `renderArticleHtml` is what `useArticleMarkers`
  calls. Real test texts in `utils/__fixtures__/articleTexts.ts`.
- `utils/selectionOffset.ts` — `getSelectionAnchor(root, selection)` (text and
  plain-text offset of a selection, from the DOM text) and `plainOffsetAt`.
  Every surface that creates a highlight or an anchored note goes through it.
- `hooks/useArticleTextInteractions.ts` — the update-note chips, the
  foldable AGGIORNAMENTO tail and the annotation signs (`openBlock`), for any
  surface that renders structured text.
- `utils/articleAnnotations.ts` — `resolveAnchors`, `groupAnnotationsByBlock`,
  `highlightsWithoutSign`, `describeBlock` (a block named by its printed enumerator or its opening
  words, never a computed number). The renderer and the block popover both
  read it: never re-derive where an anchor lands anywhere else.
- `utils/revealAnnotation.ts` — `revealAnnotation(root, { kind, id }, near?)`:
  scroll to an annotation and make it glow. The block popover and Study
  Mode's summary.
- `utils/floatingOrigin.ts` — `getTransformOrigin(placement)` for a popover's
  entry animation.
- `utils/blockAnchorRect.ts` — `blockAnchorRect` / `signReference`: the
  rectangle and the virtual reference a block's popover is placed against.
- `hooks/useNoteEditing.ts` + `features/search/NoteCard.tsx` — a note edited in
  place; the Notes panel and the block popover.
- `hooks/useArticlePassageThreads.ts` — one signature, `(anchor, { enabled?,
  plainText? })`: the anchor comes from the caller. Loads passage discussions for
  the signs via `GET /article-discussions/passages` and, given `plainText`, returns
  `locations` (the one place a passage is found or `detached`). Used by the article
  surface and the decision's surface.
- `utils/threadPassages.ts` — `buildPassage`, `textFingerprint`, `locatePassage`
  (exact → whitespace-tolerant search → the occurrence whose context agrees;
  never guesses: ambiguous or missing = `detached`).
- `components/features/dossier/dossierUtils.ts` — `searchParamsFromNorma`,
  `packItemContent`/`unpackItemContent`, `dossierItemFromApi`/`serverFieldsFromApi`
  (a server item as the store holds it: citations, `aboutItemId`, `createdBy`), `computeItemCounts`, `dossierRecency`,
  `dossierContainsArticle`, `normaForDossier`, `computeNormaGroups`,
  `formatTimestampLong`.
- `components/features/dossier/dossierLayout.ts` — `layoutDossier`, `actKeyOf`,
  `codeName`, `compareArticles`, `articleLabel`, `foldedArticleList`,
  `dossierItemOrder`, `actsSummary`: the dossier by act.
- `utils/tagLabel.ts` — `tagLabel(tag)`: a dossier's tag as shown, its first letter capitalised and
  the rest as typed («accesso» → «Accesso», «DPO» stays). Display only — the stored tag never changes,
  every filter compares stored values, and the PDF and the editors show the tag as typed. The list's
  card, the dossier's header, the import dialog, the Forum's card and a planner task's labels go through it.
  `tagCategories(tags)` makes the dossier list's category menu (Italian alphabetical order, case and
  accents ignored; values that differ only by case are one category filtering all of them, labelled by
  the spelling with the most capitals) and `hasTagCategory` filters by it.
- `utils/actRubriche.ts` — `matchRubrichePart`, `rubricheFor`, `abrogatiFor`:
  which article titles belong to the articles in view. An act in parts gets the
  part matched by article numbers (on a tie, the one of the annex's size; still
  tied, none) and never the top-level map, which can be an annex's (d.lgs.
  196/2003). The index window and the dossier use it.
- `components/ui/MenuButton.tsx` — the one menu button (arrows, Home/End,
  Escape/Tab, focus return, click outside; clicks never reach the card). Two menus keep their own keyboard,
  for a reason: the sidebar's user menu (portalled, placed from the avatar) and the section switcher (S6: a menu
  that stays a moment after the choice, rolls up, and can be turned back).
- `hooks/useAnnexNavigation.ts` — shared tree fetch + annex switch + load article.
- `utils/deepLinks.ts` — `buildSearchDeepLink(params, articleId)` /
  `parseSearchDeepLink(value)`: the `?norma=` share link (base64url JSON with
  an optional article to focus, which `SearchPanel` focuses even inside a
  range). `SearchPanel` still reads the older `?share=`.
- `utils/searchFilters.ts` — `matchesSearchFilters(article, filters)` for the
  palette's source / historical / year filters, applied
  client-side to each streamed result. `SearchPanel` counts what a filter
  drops and, when nothing got through, says so instead of showing an empty
  search.
- `utils/normaChanges.ts` — `normaFromChangeNotification` /
  `normaChangeLabel`: reopen and label a change notification from the
  snapshot the server stored (null, not a guess, when the snapshot has no
  identity).
- `hooks/useForumNotifications.ts` — the one 30s poller behind the sidebar's
  counts (the Forum's `total`; `normaChanges` on the avatar and the menu's Cronologia).
- `hooks/useServiceHealth.ts` + `ui/ServiceHealthMenuEntry` (the user menu's status; one call, in `Layout`) — probes
  `/api/health/detailed` (Node, a `SELECT 1`) and `/health/detailed` (Python, which reaches
  Normattiva and EUR-Lex for real). Once on mount, then every
  **5 minutes** per visible tab, plus "Ricontrolla"; the Python answer is
  cached server-side for `HEALTH_DETAILED_TTL`. Do not tighten either loop —
  the first version polled every 60s per tab. `cardSourcesAnswer` (`healthService.ts`) reads the same Python
  probe once, for «Le mie schede»'s «+ Nuova scheda» (true only when Normattiva says ok); it never polls.

## UI Conventions

Non-obvious rules baked into the codebase. Follow them so new surfaces stay
coherent.

**Destructive confirmations** — only for what cannot be undone or reaches other
people (K1a, the owner's L-35): an action whose «Annulla» puts everything back on the
server (the 30-day trash, or a write held until the notification is gone, as an import
of more than 100 articles from an act's index) asks nothing and offers «Annulla»
(`showUndoToast`); browser-only state (the practices) likewise. Removing a highlight or a note of the reader's
(`removeHighlight`, `removeAnnotation`) is held behind «Annulla» too, with its own rules (`store/deferredRemovals.ts`,
the D7b bin's pattern, no `beforeunload`): off the screen at once, «Evidenziazione rimossa» / «Nota rimossa», the
`DELETE` sent as the notification closes, or at once as the page goes or is hidden (`pagehide`, `visibilitychange`: a
phone may discard a tab in the background unannounced; a `keepalive` fetch, the token refreshed as it was removed), so
«Annulla» is gone once the tab is hidden. «Annulla» puts it back where it was; a refused `DELETE` puts it back with the
sync error, a 404 is a removal done. One made and removed before the server answered is removed under the id the server
gives it, or not at all if its creation failed; sent by the tab being hidden it still waits for that id (the page lives
on: a desktop's change of tab). A reading meanwhile — the reader's, the PDF's, a Forum publication's
(`loadPdfMarks`) — leaves out what waits or is out (`isRemovalPending`); a logout drops it unsent, and an answer still out for one sent
before puts nothing back in the emptied store (`forgetRemovals` in `clearUserData`). The D7b bin
(`assistantProposals`) sends at `visibilitychange` too, and takes no answer after a logout either (`generation`). A held write checks, when it runs, that
its target is still there (the import does not write into a dossier deleted meanwhile), and while it waits the
browser asks before the page is left (`beforeunload`). Otherwise never
`window.confirm`: use `components/ui/ConfirmDialog` with `variant="danger"`, and word
the message so it names the scope *and* what is not touched ("Segnalibri e dossier non
saranno toccati"). Where the action **leaves you** or **cannot be undone** and comes rarely (K1b, L-35: erasing
the MERL-T data, revoking a connected app, deleting a published copy from the dossier's «Forum» menu or from the
Forum's card), the confirmation is drawn from its button: `components/ui/wireConfirm/WireConfirm` (the same props,
plus `origin`, the button: pass it, `event.currentTarget`, since Safari and a tap do not focus a button they press;
absent, the element focused as it opens, right for a menu's entry — `MenuButton` gives the focus back to its trigger
by code before an entry runs, the Forum's card does the same by hand). A button its action disabled (busy) gets the
focus back once enabled again. A wire leaves the button, meets the card on the edge
that faces it (`wirePath.ts`, pure) and draws its outline both ways; where the ends meet the card appears, its rows
rising one after the other (about 500 ms; the lead fades once it is there). `emphasis="cancel"` makes the cancel the
filled button, on the right, where going back is what one wants most (the lesson's «Interrompere il ripasso?», which
leaves you and comes often); `focusBack` sends the focus elsewhere than the button after a cancel. «Annulla», Esc or a click outside wind it
back into the button (about 300 ms) and give it the focus; leaving, the card is `inert`, so an Enter during the rewind
confirms nothing, and the layer still takes the clicks, which do not fall to the page. Its buttons answer only once
they have risen into sight (`READY_MS`, about 500 ms; `data-ready` on the card): a double tap on a button the card then
covers runs nothing unseen. Confirming folds the card into a line, and `onConfirm` may resolve to the outcome the button then
says, a tick drawing itself over it (`OutcomeTick`, «Eliminata ✓», 1.6 s, seen only: each caller says the outcome in
words where a screen reader hears it); a caller that removes the button (a row, a card) does it in `onOutcomeDone`,
once the tick is gone, and hands the focus to a neighbour; an outcome that gives way to a newer one (two revocations in
a row) is told over at once, so the callers keep a queue of ids, oldest first, and the words a confirmation names until
it is gone. The outline is drawn again when the window changes. The focus opens on «Annulla» and Tab goes between the two buttons. Under reduced
motion the card fades in already drawn, and the outcome comes once it is gone. On a phone the card is the page's
width less 16 px each side.

**Keyboard-accessible collapsibles** — a `div` that toggles on click needs
`role="button"`, `tabIndex={0}`, `aria-expanded`, a dynamic `aria-label`
(espandi/comprimi), and `onKeyDown` for Enter/Space with `preventDefault()`. The
handler must start with `if (e.target !== e.currentTarget) return;` or interactive
children re-trigger the toggle. Always add
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`.
Never nest interactive content inside the element carrying `role="button"` —
scope the role to the header, as `DossierArticleRow` does. A collapsible whose header
is a section heading follows the accordion pattern instead (`DossierActBlock`):
the toggle sits inside the `<h2>`, its name is the heading's own text and its
state is `aria-expanded` alone, with no `aria-label` replacing what it says.

**Popovers with `@floating-ui/react`** — split positioning and animation across
**two** elements: outer div takes `refs.setFloating` + `floatingStyles`, inner div
owns the entry animation. On the same element the scale transform overwrites the
positioning transform. Compute `transformOrigin` from `placement` (`getTransformOrigin`,
`utils/floatingOrigin.ts`). Anchor via a `useState` element,
not a ref object, and pass it at render time (gotcha 13).

**Toggle buttons** — drive the visual from an `isPressed` selector, not a fixed
colour: idle `text-slate-400` + hover accent, active `bg-{accent}-50
text-{accent}` (plus `fill-` when the icon has a body). Toast wording must match
the action actually taken. Always set `aria-pressed` — except on a button that opens a window or a panel, which says
`aria-expanded` instead (the act's «Struttura della norma», R3b).

**Two flavours of pop-up** — *Peek* (header, scrollable body, composer; ~360px,
page-themed) when the surface lists or edits content; *action bar* (thin dark
slate, 2-4 icon buttons with 1px dividers, no chrome) when it only performs
actions. Both use the outer/inner split above.

**Sticky filter rows** — `sticky top-0` alone lets content scroll through. Give
the row an opaque background matching the panel, bleed it edge-to-edge with
negative margins matching the parent padding, add `border-b border-current/10`,
and raise it to `z-20`. A row that pins to the page's top uses
`top-[var(--phone-bar-offset,0px)]` (with `transition-[top]`, still under reduced
motion), or on a phone it pins under the bar at the top (see «The phone's bar»).

**Stacking** — use the bands in `constants/zIndex.ts` (`pinnedBar` 35, `sidebar` 50, `lesson` 70 — Gymnasium's lesson over the shell —, `dock` 80 — the bar of practices —,
overlay band 1000+), never a bare literal. See gotcha 22 before assuming a
z-index will be honoured. An overlay above `findWindow` (110) that covers the
workspace carries `aria-modal="true"` (a real modal dialog) or `data-find-overlay`,
or Cmd/Ctrl+F opens the find window hidden under it.

**Beating inline `style="..."` without `!important`** — when markup you don't
control ships inline styles (e.g. `useArticleMarkers` emits
`<mark style="background-color:hsl(var(--hl-yellow-bg))">`), first try
**redefining the CSS variable in a narrower scope** so the inline `hsl(var(--…))`
resolves differently. Only if the inline style references no variable, fall back
to a single narrowly-scoped `!important` with a comment justifying why every
other route fails.

**Inchiostro everywhere** (Y1, `lib/inchiostro.guard.test.ts` reads the sources): an action and the focus are
`primary-*` (toga), everything else `slate-*` (ink), a section its hue (`--vlx-section-*`); no `blue-*`, `indigo-*`,
`purple-*` or `violet-*` (the first two were aliases of toga, the others hues of no section) but in the colour keys the
test lists with their reason (the courts' chips, the kinds of a suggestion's items, a highlight's four colours); no text
under 11 px (px, a length or rem); elevation by kind — cards `shadow-sm` or a border, menus and popovers `shadow-md`,
windows and dialogs `shadow-lg`, never `xl` or `2xl`; in the dark `index.css` draws `shadow-md` and up as a hairline and a
drop —; flat paper, no gradient but the skeleton's shimmer and the comparison's hatch (`GapCell`); `index.css`'s
`@apply` is read too. `Button` presses to 0.97 in
120 ms; a hover that moves or grows something sits under `[@media(hover:hover)_and_(pointer:fine)]` (`HOVER_LIFT`).

**Colour markers** — for a list mirroring something already coloured in the
article body, use a 4px stripe down the card's leading edge rather than
re-applying a saturated background behind the text.

**Mobile-first** — interactive controls keep a 44px touch target on mobile.
`TOUCH_TARGET_RESPONSIVE` in `constants/interactions.ts` covers the height only
(`min-h-[44px] md:min-h-0`); icon-only buttons need the width too, so they carry
`min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0` explicitly. The pages in the
planner's shape keep 44 px at every width instead: the planner, and the dossier's
page since S7c (`dossierStyles.ts`: `ROW_ICON` for a row's star and removal). A text field or a select is at least 16 px below
`md` (`FIELD_TEXT`, `text-[length:max(1rem,16px)] md:text-sm`, in `constants/interactions.ts`):
Safari on an iPhone zooms the page into a field under 16 px as it takes the focus, and
`text-base` is not enough — the text size «piccolo» makes 1 rem 14 px. `ui/Input` and
`ui/FormSelect` carry it, and so do the searches of «Le mie schede» and of the Cronologia, the
planner's `FIELD` (its tasks' fields, the dossier's search since S7c)
(`ui/__tests__/fieldText.test.tsx`), the search page's field and the palette's fields (its box
is `max(1.125rem,16px)`); about sixty fields written by hand do not yet (the find
window, the index filter, the case-law filters, the dossier pickers,
the notes): a field written by hand takes it, and a `text-*` class after it in `cn` undoes it.

## Common Patterns

**New frontend component** — compose the `ui/` primitives and the interaction
constants; import types from `types/index.ts`; reach state through
`useAppStore()`; Tailwind v4 for styling.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Frontend core** — `store/useAppStore.ts` · `types/index.ts` · `services/api.ts` ·
`services/legalFetch.ts` · `utils/normaKeys.ts` · `utils/articleIds.ts` · `utils/articleSuffixes.ts` ·
`utils/articleStructure.ts` · `utils/articleRender.ts` ·
`utils/articleAnnotations.ts` · `utils/dateUtils.ts` ·
`utils/normaMeta.ts` · `utils/articleFetchCache.ts` · `utils/actUrn.ts` ·
`utils/readingBackStack.ts` · `hooks/useAnnexNavigation.ts` ·
`hooks/useIsDesktop.ts` · `constants/zIndex.ts` · `constants/interactions.ts`.

**Frontend features** — each of these folders was split out of a monolith and is
meant to stay split; add new features as new files, not inside the shells:

- `features/dossier/` — `DossierPage.tsx` is a thin shell routing list/detail via
  `?dossier=<id>`; `DossierListView.tsx` (grid, context menu, shortcuts `n` `/`
  `i`; the search, then two menus — the order and «Filtra per categoria», one
  category at a time, «Tutte le categorie» first («Tutte» on a phone, by `useIsDesktop`), the categories of the section's dossiers, absent when
  there are none — on one row on a computer, half and half under the search on
  a phone; on a phone the title keeps its row with «⋯» — «Importa da file JSON», «Cestino (n)» — and «+», M1; the cards since S7c: a Newsreader title, the
  counts in one line from `countsParts`, «Creato il …», the quick open and «⋯»
  always there at 44 px; with no dossier, a composed empty state with
  `DossierMark.tsx`), `DossierDetailView.tsx` (sections and header), `DossierActBlock.tsx`
  (an act and its rows), `DossierArticleRow.tsx` (row + star + expand),
  `DossierNotesSection.tsx`, `DossierDecisionsSection.tsx`, `dossierStyles.ts`
  (the page's tokens, in the planner's measures), `DossierItemReader.tsx` (in-place article),
  `AddToDossierPopover.tsx`, one file per modal, shared helpers in
  `dossierUtils.ts`, `dossierLayout.ts`, `dossierPdf.ts`, `pdfExcerpts.ts`, `dossierPdfMarks.ts`, `DossierPdfDialog.tsx`, `useActDetails.ts`.
- `features/bulletin/` — the Forum. Its area «Dossier pubblici»: «I dossier di studio pubblicati dalla comunità» (spec
  `docs/superpowers/specs/2026-10-13-environments-into-forum-design.md`; it absorbed «Ambienti»). Folder and
  component names stay `bulletin` and `SharedEnvironment*` because they match the backend model; the route is
  `/forum`, the page's `h1` «Dossier pubblici», and what leaves it says so («Ritira dai dossier pubblici», toast
  «Dossier ritirato»; in the dossier's header «Copia pubblicata ritirata»), never «dal Forum»: the Forum is the section, which also holds «Community»
  (`ForumCommunityPage`, `/forum/community`, a placeholder: an empty state composed for the page, S7a — centred in the
  column, `CommunityMark`, line art in the manner of the section's mark in the Forum's hue, «Le discussioni arrivano
  presto», two lines on what it will be, and «Esplora i dossier pubblici», a link drawn as the one button). `BulletinBoardPage.tsx` is a shell over three dumb views, the tabs «Esplora · I miei pubblicati ·
  Suggerimenti» (`ForumTabs`, drawn by `ui/SegmentedTabs`: short labels «Esplora · Miei · Suggeriti» sharing the row in
  equal parts below `sm`, whole from it — at 320 px the last was cut, S7a; the views, `ForumExploreView`,
  `ForumMyEnvironmentsView`, `ForumSuggestionsView`, in its `SegmentedTabPanel`, their order in `forumSections.ts`); the titles of «Dossier pubblici» and «Community» come from `features/sections/pageNames.ts`; Explore's filters are one row
  from `sm` and, on a phone, the search across with the category («Tutte»), the order and the 44 px refresh under it, M1. While
  Explore's read travels the count's line is kept, empty, and the cards held are as tall as a card that came (P1, CLS 0.12
  on a phone and 0.04 at 1920 → 0; the height of a full card, a title on two lines, a description and labels: a short
  card that comes leaves a smaller shift upwards). «Pubblica un dossier»
  is `PublishDossierPicker` (the user's dossiers not yet in the Forum, then the dossier's own
  `PublishDossierDialog`; the Forum never publishes a workspace); «Modifica» on a published dossier
  (`EditSharedEnvironmentModal`) edits its name, description, category and tags only — what it holds changes
  from the dossier. Content becomes the user's dossiers di studio through one dialog, `StudyImportDialog` (the
  dossiers listed, notes and highlights as switches, one server request, never an existing dossier changed;
  the toast is `studyImportSentence`): «Ai miei dossier» on a card (`AddToMyDossiersDialog`, `POST
  /shared-environments/:id/download`, then `forum_download` unless the item is the user's own), an environment
  of the archive (`ArchivedEnvironmentsSection` under «I miei pubblicati»: «Ambienti salvati (archivio)», «Recupera
  i dossier» through `POST /environments/:id/recover`, «Esporta JSON», «Elimina»; absent for a user with none; no
  environment is created any more) and an old share link (`SharedLinkImport`, reading `?import=`, through `POST
  /dossiers/import-study`, quick norms and aliases left out). Explore shows **the community's dossiers first** (S7a,
  the Forum's reason), under a visually hidden `h2` «Dalla comunità»: a grid of `SharedEnvironmentCard`s (`CARD_GRID`,
  «I miei pubblicati»' too: one column, two from `md`, three from `xl`, a row's cards one height, `h-full`), each an
  `article` with its title in Newsreader 18 px, a plain line «● Civile · v1 · autore · 2 giorni fa» (the category's hue
  from its token `--category-*`, never a hand-written colour; one line where the card has room, wrapped between its parts
  on a narrow one, a long username cut, whole on hover), two tags then «+N», «Mi piace» a heart with its number
  (`aria-pressed`, named «Mi piace: N»; on a computer 36 px tall) and one action, «Aggiungi ai miei dossier», outlined
  («Aggiungi» below `sm`, as the packs' cards, its name whole); a withdrawn card is a dashed edge on a quieter paper and
  the badge, never an opacity (it would trap the «⋯» menu in a stacking context, gotcha 22, and fade the text under AA).
  Beside the like, small, «aggiunto da 12» (nothing at 0); the views are the author's alone, beside it in «I miei
  pubblicati» (`showOwnerActions`), never on Explore; where a card is too narrow the action goes under them, whole. «I
  più aggiunti» is an `h2`, last on the page. Then «Pronti da VisuaLex» (`StudyPacksBand`, over
  `utils/studyPacks.ts`: the 20 packs of `data/exampleEnvironments.ts`, each a pack's dossiers plus «‹pack›: articoli
  chiave»; `loadStudyPacks` imports the data, ~60 KB, when the band first asks, so it is not in the chunk every page
  loads — meanwhile the heading and five cards drawn like the packs' (a name on two lines, the count, the 44 px
  button) hold their place, `aria-busy`, every category holding packs; once loaded, a band drawn again shows them at
  once (`peekStudyPacks`); a load that fails leaves the band out): one row of compact cards that scrolls sideways (`#pronti`, `tabIndex 0`, so the keyboard scrolls it past
  packs already added), every pack in it — on a computer after the grid and its pages; on a phone right after the
  community's first two dossiers (or their places while a read travels, or the empty state), in a fixed place so it is
  never mounted again while a new read travels, the rest under a hidden `h2` «Altri dossier della comunità»
  (`useIsDesktop`, one place or the other); it follows Explore's category and adds a pack through `import-study`; the
  empty dossier list's «Pronti da VisuaLex» goes to `/forum#pronti`, where Explore, once read and once the band says its
  packs are shown (`onShown`), scrolls the content
  scroller alone to the strip under the phone's bar (`scroll-padding-top`, gotcha 34) and focuses it, once: the fragment
  then leaves the address (`history.replaceState`, the router's state kept), so another tab and back, or a reload, do not
  jump again. One list of categories, `utils/forumCategories.ts`. `EnvironmentContentViewer` (the tree of a
  content's dossiers, quick norms, aliases, notes and highlights), `useLeftOutNotice` and `annotationLabels` serve
  the suggestions. The suggestion flow adds `SuggestionReviewDialog`, `EditSuggestionDialog`,
  `SuggestionItemCard` (all five itemTypes), `AliasConflictDialog`,
  `AddItemsDialog` and `AttributionChip` (see gotchas 20-21).
- `features/search/` — `ArticleTabContent.tsx` (the reading surface),
  `ArticleBody.tsx`, `NotesPeekPanel.tsx`, `InlineNoteComposer.tsx`,
  `InlineNotePopover.tsx`, `UpdateNotePopover.tsx` (a Normattiva update note,
  opened from its `(119)`), `BlockAnnotationsPopover.tsx` (a block's notes and
  highlights, opened from its sign), `NoteCard.tsx`, `LooseHighlightsList.tsx`, `HighlightsActionsPicker.tsx`, `ReadingToolbar.tsx`,
  `SearchPanel.tsx` (streaming merge logic), `CommandPalette.tsx` (no text under 11 px and its steps, «Gestisci»,
  the close button and the filters 44 px on a phone — `CommandPalette.test.tsx` reads the file; its colours are
  checked in `theme.test.ts`), `SearchField.tsx` (the search page's field)
  and `GlobalSearch.tsx` (the palette and the managers it opens, mounted by `Layout` — see gotcha 27),
  `TreeViewPanel.tsx` (the article index window).
- `features/settings/` — `AliasManager.tsx` and nothing else. Named for what it
  edits, not for where it opens: it is reached from the command palette, not
  from Settings (gotcha 27). See the Aliases section above.
- `features/workspace/` — what a practice's rows borrow from the old workspace: `LazyStudyMode` (the
  `StudyMode/` bundle behind `lazy()`; `PDFViewer` and `CompareView` are lazy the same way) and
  `ArticleNavigation` (an act's previous/next arrows). The floating tabs, their dock and their panels are gone
  (round 6 of the norm-tab redesign).
- `features/practice/` — the practice, the norm-tab's replacement (spec
  `2026-10-08-norm-tab-container-design.md`): `PracticeTable` (the active practice on the desktop:
  header in the page frame's type — the name in `PAGE_TITLE`, the count line under it, «Salva come dossier» and «⋯» on
  its right —, the streaming bar, then
  `PracticeColumn`; the topic searches are windows beside it on the desktop and the full-screen reader's
  subject on a phone); `PracticeColumn` (the acts, dragged
  into order, then «Giurisprudenza»; it takes the reveal once) of `PracticeActBlock` (an act, R3: a section
  with no card around it — its sticky heading, the act's name in Newsreader 22 px over a hairline, with Studio,
  Struttura, PDF and «⋯» as neutral quiet buttons — on a phone one row, the title and «⋯», which holds Studio,
  Struttura and PDF, and the meta line only when it says more than the count —; the index line of its rows, drawn only
  for an act of more than one article, its chips in slate, on a phone one row that scrolls sideways beside the arrows;
  the rows; the structure window on the desktop, the drawer on a phone), `PracticeArticleRow` (an article, its reader mounted
  only while open) and `PracticeDecisionsSection` (the decisions, newest first, read in place through
  `DecisionEntryView`, under «Giurisprudenza (n)» in the act's type, no card), both rows on `PracticeRowShell` (the header-scoped toggle, «Togli dal tavolo»,
  «Apri accanto» (on the desktop a row whose subject a window shows folds and says «Aperto accanto ·
  Chiudi la finestra», so one subject has one mounted reading surface, T5; on a phone it opens the
  full-screen reader, icon-only so the row's name keeps its width, and no row ever folds));
  `PracticeBar` + `PracticeChip` (the bar of practices, `fixed bottom-6` at the column's left, beside the sidebar
  (`--sidebar-width`), not over the middle of the text, R3; `Z_INDEX.dock`, `#tour-practice-bar`; a «⋯» per chip);
  `PracticePhoneView` (the phone's table: its head, `PhonePracticeHead`, one row, is the practice's name with «▾» — a
  tap lists the practices with «Nuova pratica»; R3 took the carousel's chevrons and dots away —, the count after it,
  which gives way first, «Salva come dossier» as a 44 px icon and its «⋯» (`usePracticeSaveActions`); with all of R3
  the text of «art. 1453 c.c.», one article of an act whose title takes one line, starts 251 px under the bar at the
  top at 390 and 360 px (each more line of title or meta, about 25 px more); R3b: below `md` neither `ReaderLayout`, the
  column, a row nor the text root steps in — the layout's 16 px are the edge, the text runs from 16 to 16 —, the icons
  on the column's right edge reach 12 px into that margin (`-mr-3`: the row's ✕, the act's and the head's «⋯», the
  reading bar's tools, so the status keeps one line at 320 px), and a row shows a bolt when its article is among the
  quick norms, said in its toggle's name,
  over the same column; while `phoneReader` is set it draws `ReadingFullScreen` in the column's place
  — the column is not kept mounted under it, gotcha 26 — and gives the column back at the scroll
  position of the page's content scroller it left, asked for again while the remounted column grows
  until reached, the user scrolls or 3 s pass) and `ReadingFullScreen` (the phone's reader, T19:
  «‹ Pratica» at 44 px, the title, and `ReadingWindow`'s own body — `ReadingWindowBody` — for what
  `phoneReader` names: an article, a decision or a topic search). `phoneReader` (`{ practiceId, ref }`)
  is session state of its own, never saved and never the desktop's `beside`: `openPhoneReader`,
  `closePhoneReader`; on a phone `openDecision(…, { fromLink: true })` and `openTopicSearch` set it and touch
  neither `beside` nor the rows, the way back sets or clears it, a screen that widens clears it
  (`SearchPanel`), a reload starts on the table; every reveal of a row, the act's index and any other
  practice coming on screen (`activate`) clear it in their own update, and it is drawn only for the
  active practice. The practice list (a tap on the name) has «⋯» per practice: Rinomina, and Chiudi la
  pratica, at once with «Annulla» (`practiceUndo.ts`, K1a: the practice back at its index with its rows and its being
  active; «Chiudi tutte» and «Rimuovi l'atto» the same way, through the store's `reopenPractices` and
  `restorePracticeAct`: what was opened meanwhile stays, the windows come back only while the row has room for two,
  and the same act added again meanwhile takes the removed articles instead of a second copy; the structure window
  and the phone's reader are not brought back);
  `PracticeParts` (the migration's notice, taken once and mounted by `SearchPanel` over both layouts, in
  the toast band; the empty practice; the name editor); `practiceView.ts` (helpers kept out of the
  component files). `ReadingRow` (the table and the active practice's windows beside it, `ReadingWindow` each, on widths
  from the pure `besideLayout`: half and half, thirds from 420 px a column, else a 48 px rail that opens
  the table as an overlay closed by Esc or a click outside; `SearchPanel` mounts it on the desktop in
  place of the bare table, and with a window beside it reaches past the search page's `ReaderLayout` cap (`max-w-5xl`, about 960 px) to the scroller's
  width, measured, for that row only) and `ReadingWindow` (the light window: title, «Chiudi», a scrolling body with
  the column's bottom padding, the body by kind; it reads under its own id and passes its practice as
  `findHostId`, and an article as `ArticleTabContent variant="beside"`: the compact `ReadingToolbar`
  (notes and highlights in words, and behind «⋯» discussions, the find window and copy), and no Studio,
  Studia row, MERL-T entry or graph rail; the `row` variant is the table's). «Salva come dossier» and «Aggiungi a un dossier…» (spec §7): `practiceDossierItems`
  (pure: the items in table order, each article from its own `norma_data`, a code's search and index
  copies one item; `dossierHoldsArticle`), `useSavePracticeAsDossier` (create first, add, order once,
  wait for the items to settle and count them; one save at a time per practice, `usePracticeSaving`),
  `usePracticeSaveActions` (the header's button, the «⋯» entries, the picker and the outcome's toast,
  portalled in the toast band: inside the bar a `fixed` child would be placed against it, gotchas 22
  and 26) and `PracticeDossierPicker` (a `ui/Modal`). Three CSS variables carry measured heights:
  `--practice-head` (the act block's heading, sticky from `md` up over the open rows' toolbars
  (`Z_INDEX.stickyHead`); on a phone it wraps and scrolls with the block, and the variable is 0; the
  rows' scroll margin reads it, and an open row passes it on as `--reading-toolbar-top`, which
  `ReadingToolbar` reads with a `0px` fallback, so the toolbar pins under the heading and is unchanged
  elsewhere) and `--practice-bar-height` (the bar's
  height, set by `SearchPanel` on the workspace area: the column's bottom padding keeps its last row
  clear of the bar).
  The tours start here: `PracticeTable` asks for the `practice` tour once (the bar, the header, «Salva come dossier», an act)
  and, when it is done, for the `practiceAct` tour, which the practice's first `PracticeActBlock` also asks for once the
  table's has been seen (`config/tourConfig.ts`; their targets are `#tour-practice-bar`, `#tour-practice-header`,
  `#tour-practice-save`, `.practice-act`, `.practice-act-head`, `.practice-act-index`, `.practice-row-beside`,
  `.practice-act-study`, `.practice-act-structure`, plus the reading bar's `.glass-toolbar`;
  `tourConfig.practice.test.tsx` fails when one is missing, and when a tour points at a Brocardi surface). Tours never overlap: `useTour` keeps one driver on screen
  module-wide, so a tour asked while another shows is not started (it is asked again the next time its
  surface mounts, and a tour not seen stays unseen), and `tryStartTour` looks at «seen» again when its delay ends;
  `practiceAct` is asked only for a practice that has an act. `tourConfig.targets.test.tsx` fails when a tour's
  target is written nowhere in the sources, and checks the search tour against the search page. The popover
  (`visualex-tour-popover` in `index.css`) draws every button 44 px with a focus ring — the label centred by its
  line height, since driver.js writes `display` on the buttons inline —, and `useTour` renames
  driver.js's «×» «Chiudi» in `onPopoverRender` (driver.js writes «Close» and has no option for it; `TOUR_UI`). A tour is closed, unseen (asked again next time), when the window
  passes to another layout (768 and 1024 px) or the element of its step is no longer drawn: driver.js redrew the veil at
  its old size (Y1); and a focus driver.js gives its buttons with no key pressed shows no ring (`data-pointer-focus`).
  driver.js and its stylesheet are fetched when a tour first starts (`loadDriver` in `useTour`), not with every page —
  ahead, while the tour waits for its delay (`prepareTour`: `tryStartTour`, `resetAndStartTour`, `Layout`'s welcome);
  the steps, the guards and the screen are read once it is here, and a `stopTour` or the surface unmounting meanwhile
  cancels the start;
  `lazyModules.guard.test.ts` refuses a static import of it. `index.css` still overrides its stylesheet, which lands
  after it as before.
  `SearchPanel` mounts them (imported statically: the table is the app's main surface; `PDFViewer`, Study Mode and
  `CompareView` stay behind `lazy()`), one layout per breakpoint (`useIsDesktop`); a decision opened from any link lands in its practice
  and opens beside on the desktop (the window a link was clicked in is never the one a third window
  replaces) or in the full-screen reader on a phone (`isDesktopViewport`), a norm cited in a window (or
  in the reader) enters its act and opens beside that window (in the reader, on a phone; `SearchPanel`:
  `besideId` naming a window or the reader's subject), and searches, the index, topic searches and
  the dossier's «Apri tutto» (`dossier/openInPractice.ts`: one practice, its decisions unread, identified
  from what the dossier kept, `addKnownDecisions`, so «Salva come dossier» saves them back) land in
  the practices.
- `features/planner/` — Opus's planner: pages and views (`OpusPage`, `OpusViews`), the row and its list, the
  task sheet (`TaskSheet`, `TaskSheetFields`, `DossierPicker`, `TaskSheetScope`), the groups (`TaskGroup`,
  `InlineAddTask`), `WeekStrip`, `StudyTodayRow`, the new task's dialog, the quick add, `PlannerHost` (mounted by `Layout`), the dossier's panel; the pure helpers
  (`taskDates`, `taskTree`, `taskDraft`, `splitLinks`, `moveBetweenRows`) apart from the components. See «The planner».
- `features/history/` — `HistoryView.tsx`, `DecisionHistoryRow.tsx` (a decision's row) plus
  `NormaChangesSection.tsx` (see History above). The page is in the sections' frame (W2): one `h1`, «Cronologia», on
  every width, with the one search field (`#tour-history-search`, «/» focuses it) and «Svuota cronologia» beside it
  — until W2 a phone's and a computer's header were both drawn, one hidden by CSS, and «/» focused the hidden field
  on a phone; the saved norms that changed come under the title, then the card. On `/dossier` the `h1` is the visible
  title of the list, of the open dossier and of «Cestino», and what sits under it is `h2` (a dossier's card; an open
  dossier's notes, acts, «Giurisprudenza» and «Rimossi di recente»).
- `features/documents/` — `DocumentReviewPage.tsx` (the page), `DropZone.tsx` (the box), `DocumentRow.tsx`
  (the document's row and `SheetFlight`), `documentJob.ts`, `DocumentText.tsx`, `CitationList.tsx`,
  `citationGroups.ts`, `documentFile.ts`; invented sample files for the tests in `__tests__/fixtures.ts`.

## Gotchas

9. **Article id formatting (`-bis` / `-ter`)** — the tree API and the scraper
   disagree (`"1-bis"` vs `"1 bis"`). Server-side both are now canonicalised
   through `normalize_article_key` (`services/akn_parser.py`), which reads the
   ordinal from `tools/article_suffixes.py` and falls back to "any alphabetic
   tail" for anything that table does not list — Normattiva goes well past
   `decies` ("2409 octiesdecies" c.c.). On the frontend the tolerant
   `findArticleByNormalizedId` is still required: a naive `===` silently misses
   and falls back to the first article. Always use it, then canonicalise with
   `getUniqueArticleId(match)` before storing in state. The accepted forms now
   include the dotted sub-number (`270-bis.1`, `171-octies.1`), the slash
   (`314/2`) and multi-token ordinals (`135-sex-decies`), on both the server
   normaliser and the archive (`tools/archivio-normativo/archivio_normativo/hierarchy.py`).
   The web's comparisons go through `normalizeArticleId` (`utils/treeUtils.ts`, never a
   key that is stored or sent), which joins a two-word ordinal the table holds joined, as
   the API's `comparable_article_key` does («135 sex decies», «135sexdecies» and
   «135-sexdecies» are one: the dossier's row of that article had no title, since
   `/fetch_rubriche` keys it `135-sex-decies`), and puts the dash in a suffix written
   against its number («2bis»). `TreeViewPanel`'s private copy is gone: do not make another.
10. **Popover positioning vs entry animation** — floating-ui positions with an
    inline `transform`; an `animate-in zoom-in-95` on the *same* element
    overwrites it and the popover flies from (0,0). Split across two elements.
11. **`set-state-in-effect`** — prefer deriving the value during render over
    silencing the rule. Silence only for effects synchronising with an external
    signal *and* mutating external state in the same transaction, and always
    leave the justification on the disable line.
12. **A practice and its windows have no pin** — the old tab pin only suppressed
    bring-to-front, which contradicted the word "pin", and the floating tabs it
    belonged to are gone: a practice is a table and its windows are placed by
    `besideLayout`, not dragged and raised. Don't reintroduce without a product
    reason. `Dossier.isPinned` is unrelated and stays.
13. **Popover first paint at (0,0)** — floating-ui computes position
    asynchronously. Registering the reference in a layout effect leaves the first
    paint uncoordinated. For DOM anchors pass
    `useFloating({ elements: { reference: anchorEl } })` at render time. For
    **virtual** elements that path throws, so use `refs.setPositionReference()`
    plus `visibility: isPositioned ? 'visible' : 'hidden'`.
14. **StrictMode double-invoke + multi-step store actions** — an effect issuing
    two separate mutations runs both twice against the same closure value.
    Collapse them into one atomic store action (`drainNextSearch` is the
    canonical example) so the second invocation finds the precondition already
    satisfied and no-ops.
15. **Dossier "apri tutte le norme"** — `triggerSearch` overwrites the trigger, so
    a loop keeps only the last. The flow queues params and drains them one at a
    time; each carries `tabLabel` (cosmetic) and `targetPracticeId` (load-bearing —
    names the practice every search lands in, and keeps a reveal off the queue).
    The destination practice is created synchronously before `navigate('/')`
    (`searchesIntoOnePractice`, which passes its id on every search). Without
    `targetPracticeId` the results land in whichever practice is active when each
    arrives.
16. **Capture the selection rect eagerly** — before `hidePopup()` /
    `removeAllRanges()`, because the selection is gone immediately after. The rect
    travels through `onAddNote(text, startOffset, rect)`.
17. **Every user-owned slice is server-backed** — every create/update/delete must
    round-trip the backend. The canonical regressions were `importDossier` and
    `applyEnvironment` (since removed), which pushed a local `uuidv4()` into the store; the UI
    looked fine until the first `addItem` 404'd on a ghost entity. Creation goes
    through `service.create()` first so the store holds server ids; mutations are
    optimistic + sync + revert. The one deliberate
    exception is the practices (spec D6): UI state, browser-only, saved in
    localStorage and never sent to the server.
18. **Never silently swallow errors in load paths** — `.catch(() => [])` in
    `fetchUserData` once hid a backend restart behind an empty UI for a whole
    session. Log with context before any fallback.
19. **Atomic usage counters** — `usageCount` bumps go through `POST /:id/use`
    (`increment: 1`), never a read-modify-write PUT. Client pattern: bump locally
    for instant feedback, then fire-and-forget `service.use(id)`; the next
    `fetchUserData` is the source of truth.
20. **SuggestionItem payloads are server-trusted, except a dossier's entries** —
    the `take` handler trusts the stored shape, so any rename must happen before
    storage. That is why the alias Rename path is deferred; Replace and Skip cover
    the flows. A dossier proposal is the exception: the server rebuilds each entry from
    closed values when it is stored and when it is taken
    (`apps/server/src/utils/suggestionEntries.ts`: a norm of a known act type, a decision
    through the item schema) and, if any is not accepted, refuses the whole proposal with an
    Italian 400 naming the entry and the field, and applies nothing.
21. **`sourceSuggestionId` + `originalAuthorId` are the attribution contract** —
    never mutate or filter them out. If a row has an author, the UI shows the
    `AttributionChip`; a deleted author renders "@utente-rimosso" by design.
22. **A z-index is inert on a `static` element, and `backdrop-filter` traps its
    descendants.** The sidebar was `lg:static` with `z-50` (never applied) *and*
    `backdrop-blur-xl`, which creates a stacking context — so its hover tooltips
    could not escape it no matter how high their own z-index went, and page
    content painted over them. Before reaching for a bigger number, check that the
    element is positioned and that no ancestor sets `backdrop-filter`, `filter`,
    `transform`, `opacity < 1` or `isolation`. Fix the ancestor or portal out;
    raising the child's value does nothing.
    The sidebar's navigation scrolls on its own in a low window (`overflow-y-auto`, which clips what hangs
    out of it) and the document never scrolls (`Layout`'s root is `h-app overflow-hidden`: `index.css`'s utility, `100dvh` with a `100vh` fallback; the practice row's columns are `h-app-row`, that less the content area's 4 rem of padding and the search page's field, `--search-bar-height`), so its
    labels are portalled to the body (`SidebarTooltip`), placed from the control's rectangle; they show
    for a mouse pointer and on keyboard focus-visible (never after a tap or a click), and go with Esc, a scroll
    or a resize.


26. **A portal escapes `hidden md:block`, so a CSS breakpoint cannot gate it.**
    `display: none` hides descendants, but a portal re-parents to `document.body`
    and leaves the hidden subtree behind — the desktop renderer would surface its
    window on a phone, next to the mobile one. Anything portalled that exists in
    only one breakpoint needs a real viewport check (`useIsDesktop`), not a
    wrapper class. Conversely, a non-portalled `fixed` element inside a
    transformed ancestor is positioned against *that ancestor*, not the viewport
    (see gotcha 22) — which is why the structure window portals at all. The practice
    is the standing example: `SearchPanel` mounts `ReadingRow` (the table and the
    windows beside it) on the desktop and `PracticePhoneView` below `md`, one of the
    two by `useIsDesktop`, never both under a CSS class; the phone's reader is
    `phoneReader` state, not a hidden copy of a window.

27. **A store flag only opens a modal that is actually mounted.** `AliasManager`
    and the palette used to render inside `SearchPanel`, so `aliasManagerOpen` and
    ⌘K were inert on `/dossier`, `/history` or any route that is not the search page —
    the flag flipped and nothing appeared until the reader came back to `/`. The palette,
    `QuickNormsManager` and `AliasManager` now live in `Layout` (`GlobalSearch`); the
    alias manager is still reached only from the palette, and the Settings entry that
    used to open it was removed rather than kept as a second door. What the palette opens
    lands in the practices, which only `/` draws: `useSearchActions` navigates there.
    Before adding a global-looking "open X" button, check where X is mounted.

29. **A Tailwind class whose token is undeclared fails in total silence.**
    `apps/web/tailwind.config.js` is a v3-style config and Tailwind v4 never
    loads it — there is no `@config` in `src/index.css`. Every
    `primary-<number>` class the app wrote therefore generated no CSS at all:
    568 of them across 60 files, including 38 buttons carrying `text-white` on
    a `bg-primary-600` that painted nothing, and the
    `focus-visible:ring-primary-500` this file prescribes for accessibility.
    No build error, no lint warning, no visual difference from a typo. The
    scale now lives in the `@theme` block of `index.css`, which is the only
    place v4 reads; `src/theme.test.ts` compiles the real stylesheet and fails
    if a step stops resolving. **`--color-primary` and `--color-primary-500`
    are different tokens** — `bg-primary` (213 uses) comes from the first and
    must keep working. Everything else the config declares — `font-sans`,
    `shadow-glow`, `animate-shimmer` — is still inert.
    The entrance classes of `tailwindcss-animate` (`animate-in`, `fade-in`,
    `zoom-in-95`, `slide-in-from-*`; 33 uses in 25 files) were inert the same
    way — no plugin was ever installed — until 18 October 2026: they are now
    `@utility` rules at the end of `index.css` that move with the individual
    `translate` and `scale` properties, so they compose with floating-ui's
    positioning `transform` instead of replacing it (gotcha 10), last at
    most 200 ms and fill `backwards` only (each `slide-in-from-*` writes both axes: the offsets are
    inherited custom properties, and an error box sliding from the top inside a panel that slid from
    the side came in on the diagonal): a `both` fill keeps the element a
    containing block and a stacking context after the entrance (gotcha 22). `theme.test.ts` checks they generate CSS. The palette is the
    «Inchiostro» one (spec `2026-10-18-redesign-inchiostro`): `slate`, `gray`,
    `zinc`, `neutral` are aliases of `ink`, `blue`, `indigo`, `primary-<n>` of
    `toga`; motion curves for Framer Motion live in `lib/motion.ts`.
    A `dark:` variant `@apply`'d inside a pseudo-element's rule is just as silent:
    it compiles to `::-webkit-scrollbar-thumb:where(.dark, .dark *)`, which the
    browser drops (until 19 October 2026 every dark scrollbar kept its light
    thumb). Write the dark scope before the pseudo-element,
    `:where(.dark, .dark *)::…`, as `index.css` does; `theme.test.ts` checks it.
    A short sideways row of controls on a phone draws no bar at all (`HIDDEN_SCROLLBAR` in
    `constants/interactions.ts`, both engines; a swipe, the trackpad and focus still scroll it): the
    subject chips' row still showed a light one in dark mode on the owner's pass, 19 October 2026. Such a row is
  `relative`: an absolute piece inside it (a card's `sr-only` words) takes the nearest positioned box as its own, and
  beyond the row the row clips nothing — «Oggi»'s strip of subjects made the whole page scroll sideways to its last
  card's `sr-only` (1316 px at 390, G8b); and a grid that holds one declares its column (`grid-cols-1`, a
  `minmax(0,1fr)`), or its implicit track grows to the row's full width. `studia/phoneWidth.test.ts` reads Gymnasium
  for both.

30. **A bare `fetch` to a scraping route works in development and answers 401 in
    production.** Vite proxies those routes to the Python API with no login; the ingress
    does not. Call them through `legalFetch`. `services/__tests__/legalFetch.guard.test.ts`
    reads the route list from `vite.config.ts` and fails on a bare `fetch('/fetch_…'`,
    the way `infra/ingress/paths.test.mjs` keeps the ingress in step with the same list.

28. **Two vocabularies name the same act, and they disagree on case.**
    `constants/actTypes.ts` spells it `Regolamento UE`; the backend resolver
    answers `regolamento ue`. A `===` between the two silently produced an act
    with no name in the palette ("· n. 1689 del 2024") and skipped the step
    that collects an act's number and date. Compare case-insensitively and fall
    back to the raw value: the resolver knows 389 names against `ACT_TYPES`'
    40, so a miss is the normal case, not the exception. Same trap as
    `codice_urn` on the backend.

32. **"Vigente" is never a default, and a past text is read-only.** The status of
    a text comes from `ArticleData.validity` (what the source's page says) and
    from nothing else: `versionInfo` and `norma_data.data_versione` are what was
    ASKED for, an echo, and must never be shown as a fact ("Aggiornato al" once
    printed the typed date as if Normattiva had said it); a label built from
    them (a row's "testo al 29/12/2007", a dossier row's "Testo al …") says what
    was asked for, and only that. With no `validity` the toolbar shows no status.
    A text the source says is past, one whose window does not contain the day
    asked for, and one asked for by date or as the original that is repealed or
    whose page could not be read, takes no notes, highlights or discussions:
    `buildItemKey` has no version segment, so anything made on it would appear
    on the text in force, on the wrong words. A new surface that renders
    article text passes it through `describeVersion` and honours `readOnly`
    and `textVisible`, and asks `canCopyOrSave` (showing
    `copyBlockedReason`) and `canCite` before it copies, exports, saves or
    cites, the way `ArticleTabContent` and `DossierItemReader` do; and anything
    that caches, groups or compares texts by article adds `versionKey` to the
    item key, which has no version, and one that labels a text for another
    surface (a practice's row, a dossier row, the comparison) names its version
    (`versionTabSuffix`, `historicalItemLabel`); the banner and the chip sit
    beside the text, never in it (root rule 23).

33. **Tailwind v4's `scale-*` and `translate-*` are not `transform`.** They write the
    individual `scale` and `translate` properties, so a `transition-[…,transform,…]` list
    leaves `active:scale-[0.97]` or a `-translate-y-px` lift snapping, with no warning;
    name `scale` and `translate` (as `TRANSITION` does) or use `transition-transform`, which
    lists all four. The same split is what lets the entrance utilities (gotcha 29) compose with
    floating-ui's positioning `transform`, and what breaks them on an element that also writes
    a translate or scale class of its own (the keyframe replaces it while it runs): none does
    today. `theme.test.ts` compiles `TRANSITION` and checks its rule.

34. **`scrollIntoView` scrolls every ancestor that can scroll, `overflow: hidden` ones included.** The page's
    content scroller sits inside `Layout`'s `main` and root, both `overflow: hidden`: when the scroller is already at
    its end, `scrollIntoView({ block: 'start' })` goes on to scroll them, and the whole page — the sticky week strip of
    «Prossimi giorni» with it — slides up with no scrollbar to bring it back (seen in a headless pass at 390 and 1366
    px, 21 October 2026). To bring a block under a sticky row, scroll the scroller alone (`scrollParentOf`, then
    `scrollTo` with the row's `top` and height subtracted), as `UpcomingView` does.
