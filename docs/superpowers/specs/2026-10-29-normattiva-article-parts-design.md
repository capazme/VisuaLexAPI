# Articles split into parts, each its own entry (G-387 (a))

Status: agreed. The owner answered Q1–Q4 as recommended (G-389, 30 October 2026); the Python API, the server and
the MCP go ahead, the web (index, tabs, labels) waits for the other owner's ok.
Decision G-387: «(a): each part becomes its own entry («art. 1 (commi 701-800)») with its own text and
highlights; a request for a comma gets the part that holds it; part 1 stays as it is.» Shape agreed with the
mcp-legal-it side (3.0.x): `ParteArticolo(progressivo, commi_dal, commi_al, url)`.

## 1. What exists after PR 1 and PR 2

- Normattiva splits a very long article into parts, entries of the act's tree: art. 1 l. 296/2006 is
  «1 (commi 1-100)» … «1 (commi 1301-1364)», `art.progressivo` 1…14, comma 773 in part 8. The article's URN
  (`…;296~art1`) serves part 1 only. A part's page is `/atto/caricaArticolo?…&art.progressivo=k` and opens only
  in the session (cookies) of the article's page.
- PR 2 reads the parts from the cached page (`normattiva_parts.extract_parts`) and answers `parti` and
  `testo_parziale` beside the text. Nothing fetches a part yet.
- Found while writing this: `/fetch_tree` already lists the 14 parts as 14 «articles» numbered literally
  `"1 (commi 101-200)"`, each with a URL built as if that were an article number. The web index shows them and a
  click asks for an article that does not exist. This round fixes that (§5).

## 2. Identity of a part

- A part is **the article plus its comma range**, never its `progressivo` (Normattiva can re-split the article
  after an amendment, and a page may count from 0).
- `norma_data` gains one optional field, `parte`: the range as the tree writes it, lower case, `"701-800"`.
  `numero_articolo` stays `"1"`.
- **Part 1 has no `parte`.** An article asked with no part is what its URN serves, today and after: the same
  request, the same cache key, the same `article_text` byte for byte, the same `norma_data`, so every saved
  norm, note, highlight, dossier entry and watched norm keeps its key (rule 23). **Q1** (recommendation:
  as said; the alternative, `parte: "1-100"` written for part 1 too, is more uniform but re-keys nothing
  already saved only if every reader treats a missing `parte` and `"1-100"` alike, a rule that would live in five
  copies of `buildItemKey`).
- A request names a part in one of two ways, on the article routes (`/stream_article_text`,
  `/fetch_article_text`, `/fetch_all_data`) and `/fetch_norma_data`:
  - `parte: "701-800"`: that part, which must be in the article's current list (§6);
  - `comma: "773"`: the part whose range holds it; the answer's `norma_data.parte` is that part's range, so the
    client stores the part, not the comma. A comma in part 1 answers part 1 with no `parte`.
  - Both at once: refused (400). Either on an article that is not split: `comma` is accepted and answers the
    article (a comma of a whole article is in it); `parte` is a 404.
  - A range of articles (`"1-3"`) is unchanged: each article's first part, with the notice of PR 2.
- Keys, as the web writes them and the server, the MCP and MERL-T copy them:
  - `buildItemKey`: one more segment after the article, `c701-800`, only when `parte` is set:
    `legge--296--2006-12-27--1--c701-800`. Part 1's key is today's.
  - `uniqueArticleIdFromNorma`: `1~c701-800` (annex form `all2:1~c701-800`); `~` is not in any article
    number today. Low-impact call, stated here.
  - The server's copy pinned to the web's by its tests, `apps/server/src/assistant/entryText.ts`, changes with it;
    the server's other readers of a stored key (`studyImport.wireNormaKey`, the saved-norm watcher, LingoLex
    anchors, the trash) are inventoried in 3b. MERL-T keeps no copy of the key.

## 3. The convention for sources (`conventions/sources/`)

- Identity: the article's NIR URN stays the identity of the article (`urn:nir:stato:legge:2006-12-27;296~art1`);
  a part's identity is that URN plus `parte` (a new optional key `identity.part`, `"701-800"`). No NIR URN names
  a part.
- A citation of a comma, «art. 1, comma 773, l. 296/2006», and its NIR form `~art1-com773`, read back to the
  article plus `comma: "773"`, which the API turns into the part (§2). Today `nl_parser` reads the comma clause and
  drops it: it will keep it as `comma`.
- Labels for a part (**Q2**, recommendation): citation «art. 1, commi 701-800, l. 296/2006»; short
  «art. 1 (commi 701-800) l. 296/2006»; the tab and the dossier entry «Art. 1 (commi 701-800)», as Normattiva
  labels it. Part 1 keeps today's labels («art. 1, l. 296/2006»), with the PR 2 notice beside its text.
- New golden cases: a part and part 1, by identity (`identity.part`, decided by Q1). Their labels go into the
  golden file with the web's adoption (3c): every label there is asserted by the web's suite. Until then the API's
  suite checks the citation `cite_article` writes for a part and that the part's and the comma's labels read back
  through `nl_parser`.

## 4. Reading a part (Python API)

- A part's page is read with the article page's session: one short-lived client session with its own cookie
  jar per part read (the shared `ThrottledHttpClient` session has one jar for everything, and two parts of two
  acts read at once would share it), through the same rate limit, egress allow-list and retry budget. The
  article page comes from the persistent cache when it is there; the session still needs one request to it.
- The part's URL is the one the tree gives (`caricaArticolo`, host checked), never built by us.
- Cache: the part's page under `<article URN>#commi<range>` in the scraper's persistent cache, the text in the
  scraper's memory under the same key, never under `progressivo`.
- Text: the same extractor on the part's page, untouched (rule 23). `validity` and the notes: read from the
  part's page when it carries them, else from the article page (to be measured on the 14 parts before PR 3a).
- `parti` and `testo_parziale` ride with a part too (`testo_parziale: true`), so a client always knows where it is.
- Never all parts joined (about 1.3 M characters).

## 5. The tree and the index the web shows

- `/fetch_tree`: the 14 entries become one article with its parts instead of 14 false articles: the first entry
  `{numero: "1", parte: null, commi: "1-100", label: "1 (commi 1-100)", …}` and each following `{numero: "1",
  parte: "101-200", commi: "101-200", label: "1 (commi 101-200)"}`. The annex metadata's `article_numbers` lists `1` once. The earlier versions' entries
  («agg.149 (commi …)») are already skipped.
- The web (with the other owner's ok) shows them as entries under the article and opens one with `parte`.
  `/fetch_rubriche` is unchanged (the AKN index has the article whole).

## 6. The existence check (gotcha 24)

- `parte` must be in the article's current list, read from the article page's tree (cached, no extra request);
  `comma` must fall in a listed range. Otherwise a 404 in words: «Il comma 1400 non è nell'art. 1 della l.
  296/2006 (commi 1-1364)»; «L'art. 1 della l. 296/2006 non ha più la parte commi 701-800: ora è diviso in …».
- A part saved before Normattiva re-split the article (**Q3**, recommendation): that 404 with the new list, never
  the nearest range silently, since its notes and highlights would not land on another text. The web then offers
  the part that now holds the range's first comma, as a new entry.
- Fails open as today: a page whose tree cannot be read is not «does not exist».

## 7. MCP and MERL-T

- MCP (`apps/mcp`, via the server): a reference «art. 1, comma 773, l. 296/2006» in `omnilex_crea_dossier` or
  `omnilex_aggiungi_norme_dossier` stores part 8 (its `parte`), through the API's `comma`; `omnilex_leggi_testo_voce`
  reads the stored part; without a comma the first part with the notice and the list (PR 2). Same behaviour as
  mcp-legal-it 3.0.x: with a comma only the right part, never all parts.
- MERL-T: the graph keeps one node per article (its URN); ingestion of a split article stays as today, part 1
  (**Q4**, recommendation: no parts in the graph this round; the experts read parts through mcp-legal-it's
  `fetch_law_article`, which reads the right part from 3.0.x). The VisuaLex client gains `parte`/`comma` on
  `fetch_article_text`.

## 8. Part 1 byte-identical

- No `parte` → the code path of today, untouched: same URN, same cache key, same extractor, same `norma_data`
  (no `parte` key written). `collector_timing --compare` against develop before each PR, and one test pinning
  art. 1 l. 296/2006's first-part text to its PR 2 output.

## 9. Pull requests

1. **3a, API**: identity (`parte`, `comma`), reading a part (§4), tree (§5), existence (§6), golden cases, `nl_parser`
   keeping `comma`. Rule-23 compare.
2. **3b, server and MCP**: key copies, references with a comma, the text route on a part.
3. **3c, web** (the other owner's ok): entries, tabs, dossier, index, on 3a/3b's contract.
4. MERL-T's client fields go with 3b.

## Questions

- **Q1** Part 1 with no `parte` (recommended) or with `parte: "1-100"`.
- **Q2** Labels of a part: «art. 1, commi 701-800, l. 296/2006» / «Art. 1 (commi 701-800)» (recommended).
- **Q3** A saved part after a re-split: 404 with the new parts, never another range served silently (recommended).
- **Q4** MERL-T: no parts in the graph this round (recommended).
