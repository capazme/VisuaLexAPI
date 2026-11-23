# «Rassegne»: a word in every review of the Massimario — Design

**Date:** 2026-11-01
**Status:** approved by the owner (G-404, «Sì, subito»). Short by design: one PR, the route and the
page. The words on the page are to be seen with the other owner after it lands.
**Builds on:** `2026-10-30-rassegne-without-merlt-design.md` (option (a): the API's own store) and
G-399 («sì gli utenti leggono tutto, mostra tutti i volumi, filtrati per articolo di riferimento o
parola chiave»). The article's panel already filters by article and by word; this page searches a
word without starting from an article.

**Not in it** (G-399 left Q3 unanswered, so no): anchors on passages, notes, highlights, «add to
dossier». No ranking by relevance, no year filter, no decision chips: what was approved is a field,
the results with their volume and the articles they cite, and a click that opens the article.

## 1. Where the page lives

- `/rassegne`, a page of **Corpus** (the common core, no section: `docs/superpowers/specs/2026-10-18-sections-switcher-design.md`),
  where case law already lives: «Giurisprudenza» is under the article, in Corpus.
- The sidebar's Corpus entries become «Ricerca», «Analizza documento», «Rassegne»: the third under
  the second, for everyone signed in, with no flag (the reviews have not depended on MERL-T since
  the 30 October design).
- Its title «Rassegne» (`pageNames.ts`), its code loaded with the route (`pageCode.ts`) as
  «Analizza documento»'s.

## 2. The server side

`POST /search_rassegne` on the Python API, beside `/fetch_rassegne`, reading the same file
(`rassegne-v2.sqlite3`) and the same full-text index (`paragraphs_fts`, schema 2). No new schema, so
no rebuild and no release step.

- **Body:** `{q, archivio?, cursor?, limit?}`. `q` is required, with the panel's limits: at most
  200 characters and 8 words of two letters or more (`store.terms`), each read as the start of a
  word, accents and case folded, in a passage's text or where it sits (volume, part, chapter,
  section, authors). `archivio` is `civile` or `penale`; `cursor` an offset; `limit` 1–50,
  default 20. `urn` and `anno` are refused (that is the panel's route).
- **Never in an address:** POST only (a GET is 405), so no access log keeps the words; the route
  never logs them.
- **Behind the login** (ADR-001): the path joins the ingress's `@legal` list, where the server
  checks the session and charges the quota before the API is reached; the Vite proxy names it too;
  `infra/ingress/paths.test.mjs` checks both. Its quota price is the default, 1: it reads a local
  file and asks nothing outside.
- **Order:** newest review first (year, then volume), then the volume's reading order. Predictable,
  and the order the panel uses.
- **Answer:** `{total, volumi, archivi: [{archivio, passi}], items, next_cursor}`.
  `total` counts the matches under the archive chosen; `archivi` counts each archive whatever is
  chosen; `volumi` is how many volumes the store holds. Each item is the panel's passage
  (`RassegnePasso`: provenance, text, decisions, source URL) with no highlight, plus `articoli`:
  the articles the passage cites, each once, in the order the text first cites them
  (`{urn, citazione}`); an act cited without an article is not listed.
- **States:** no store, 200 with `total: 0, volumi: 0`; a store that cannot be read or of an
  unknown schema, 503 `rassegne_non_disponibili`; a bad body, 400 `richiesta_non_valida` with
  `errori`.
- **Cost:** one statement reads the index once for the counts and the page; the page's records
  are read afterwards, so the sort never carries the prose. Measured in §5.

## 3. The page

- **Field:** «Cerca nelle rassegne», a search field with its own label and a «Cerca» button; Enter
  searches. Nothing is asked while typing: a corpus-wide query is not a keystroke's work. A query
  past the limits is not sent, and the page says why. The field takes the focus when the page opens.
- **Before a search:** one line on what the page does and where the text comes from.
- **Results:** «N passi», then the archive filter as three choices («Tutti», «Civile», «Penale»,
  each with its count) when both archives have matches. Each result:
  - the provenance line the panel writes («Rassegna civile 2024 · vol. 1 › CAPITOLO I › § 2 …»)
    and the authors;
  - the passage: the lines around the first word found, the words found marked (`<mark>`,
    text nodes only, never HTML); «Leggi tutto il passo» shows the whole passage, «Mostra meno»
    the excerpt again. A word found only in where the passage sits shows its first lines;
  - «Articoli citati»: one link per article, its label written from the URN by the source
    convention (`citeNorm`), the passage's own words when the URN names no article we can write.
    A click opens the article in the reader as a search would (`navigate('/')` + `triggerSearch`);
  - the credit, as in the panel: «Fonte: Ufficio del Massimario della Corte di cassazione ·
    Apri sul portale del Massimario».
- «Altri passi» loads the next page under the ones shown.
- **Back from an article:** the last search, its filter and the passages loaded are kept in memory
  for the session (not in the address, not in storage), so «Indietro» finds the list as it was.
- **Empty and error states:**
  - no passage: «Nessun passo contiene tutte queste parole.»;
  - no store on this installation: «Le rassegne non sono ancora caricate su questa installazione.»;
  - a 503 or no answer: «Le rassegne non sono disponibili al momento.», with «Riprova»;
  - a 429 (the quota): «Hai fatto molte ricerche in poco tempo: riprova tra qualche minuto.»
- **Keyboard and screen readers:** a form with a labelled field; the count and the states are
  announced (`aria-live="polite"`); results are a list; each toggle says `aria-expanded`; after
  «Altri passi» the focus moves to the first passage it brought.
- **Phone:** one column, controls of 44 px, the field at 16 px (`FIELD_TEXT`); the article links
  wrap.
- Inchiostro tokens: ink for text, toga for actions and the focus, the highlight's amber as the
  panel's.

## 4. Rights

Unchanged from the 30 October design §7: the prose stays in the store, never in the repository;
every passage credits the Office and links to its section on the portal; the route is behind the
login. The tests use the synthetic volume and invented passages.

## 5. Measured

On the 63 volumes (98,840 passages), built from the local archive, on the development Mac:
see the PR for the figures of common queries and of the worst case the limits allow (eight
three-letter starts), and `services/visualex/CLAUDE.md` for what stays.

## 6. Verification

- API: the store's search and the route (order, paging, archive, articles, no store, 503,
  validation, POST only, the words never logged), on the synthetic volume.
- Ingress: `paths.test.mjs` — the path in `@legal`, not open, in the Vite proxy.
- Web: the excerpt and its marks (accents, word starts), the page's states, the archive filter,
  «Altri passi», the click that opens an article, the search kept on return; vitest, build, lint.
- Browser pass on `http://localhost:5173`: a common word, a rare one, nothing found, a phone width,
  the keyboard alone, an article opened and the way back.
