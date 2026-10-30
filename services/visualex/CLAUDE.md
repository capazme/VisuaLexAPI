# Python API — services/visualex

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

### Python API (`services/visualex`)

- **`app.py`** (this folder): main server, UI + API. **`services/visualex/visualex_api/app.py`**:
  alternative server with `/api/*` prefix and Swagger. It is not deployed (`asgi.py` serves
  the root app) and it does **not** apply the in-force rules: no `validity`, no
  `reject_future_version_date`, an undated request served as Normattiva answers it (G-355,
  G-357, G-358 are the root app's). Never deploy it as it is; its `/api/export_pdf` follows
  the root app's. Retiring or porting it goes with the move to the mcp-legal-it shell.
- **`services/`** — `normattiva_scraper.py`, `eurlex_scraper.py`, `eurlex_fetch.py` (where an
  EU act's page comes from: CELLAR first, by CELEX through the shared client — `source="cellar"`,
  the 303 followed by hand over https and re-checked against the allow-list — and EUR-Lex's site
  through Playwright second, since eur-lex.europa.eu answers a server with an AWS WAF challenge,
  202 plus `x-amzn-waf-action` (`is_waf_challenge`); a page with no act's marker, `is_act_page`, is
  neither served nor kept; the URL the app holds and the copies' key stay EUR-Lex's),
  `brocardi_scraper.py` (switched off, below), `pdfextractor.py` (Playwright pool),
  `http_client.py` (the shared throttled aiohttp client — TLS verification on;
  `request(..., session=s)` sends one request on the caller's own session, for a page that
  opens only with the cookies of the page before it, with the same rate limit, host check
  and retries; `request(..., max_retries=n)` lowers the retry budget for a caller that paces
  itself, `None` keeps `HTTP_MAX_RETRIES`; once the budget is spent it gives up at once,
  without the backoff or the `Retry-After` no attempt would follow — but a rate-limit
  answer (429/503) that states a `Retry-After` pauses its `source` for that wait, so the
  next request to the same source, from any caller, waits it out first, or is refused at
  once (429) when more than `MAX_PAUSE_WAIT` (30 s) is left; our own backoff never pauses
  the source; the pause lives in the client instance).
  - `brocardi_scraper.py` is **switched off**: Brocardi is no longer a source
    (D-078). No route calls it, no answer carries `brocardi_info` or
    `brocardi_error` (a client's `show_brocardi_info` is ignored),
    `/fetch_brocardi_info` answers 410, and its hosts are out of
    `ALLOWED_HOSTS`, so `ThrottledHttpClient` refuses them. The scraper, its
    tables in `map.py`, its tests and fixtures stay until they are deleted.
  - `akn_parser.py` / `akn_fetch.py` — Normattiva's Akoma Ntoso export.
    **Structure and fallback only, never the display text**: the export
    transliterates every accent ("attivita'", "e'"), and `article_text` is the
    offset space every stored highlight and note is anchored to. Used to answer
    "does this article exist" when the HTML tree is unusable
    (`fetch_act_index`), and as a last-resort article text when HTML extraction
    fails outright (`fetch_act_article`, from `NormattivaScraper.get_document`).
    Only the article INDEX is cached — in memory, capped at
    `AKN_CACHE_MAX_ACTS`, and through the shared cache manager, with an
    in-flight registry so N concurrent cold requests download the act once.
    Article texts are never cached. `ParsedPart.dates` carries each article's
    FRBRWork date (component acts only), and `AktIndex.fingerprints` a sha256
    per article — both are metadata about the text, not the text. The hash
    is of the RENDERED AKN text (the markdown `akn_parser` produces,
    AGGIORNAMENTO blocks included), so a renderer change moves every hash — a
    harmless full refetch. The top-level map covers the dominant part only;
    an annex such as the preleggi or the disposizioni di attuazione must be
    read from `parts_fingerprints` (served as `parts` by
    `/fetch_act_fingerprints`), which is kept apart from `parts_detail` so
    the hashes do not ride along on every `/fetch_rubriche` answer. With
    the fingerprints a codice's in-memory index is a few hundred KB.
    `AKN_ENABLED=false` disables the whole path and is read at call time.
    `normalize_article_key` in `akn_parser.py` is the pure canonicaliser for
    article numbers and needs no network; `comparable_article_key` is the same with an
    ordinal split in two words joined («135 sex decies», as the tree and the codice del
    consumo's export write it, is «135-sexdecies»), for comparing two spellings only —
    the keys `/fetch_rubriche` and the fingerprints answer keep the split. A component
    act's rubrica is read in brackets, or, in a part that writes them in brackets,
    without them when an amendment rewrote it so (`_unbracketed_rubrica`; the codice
    civile: 2840 of 3249 before, 3039 since 21 October 2026, the rest repealed, notices, or
    articles with no rubrica).
  - `normattiva_validity.py` — what a Normattiva article page says about its own
    validity: the window ("Testo in vigore dal … al …"), the version number, the
    act's last update, and a state (`current`, `historical`, `not_yet`,
    `abrogated`; `historical` means the window ended before today in Rome, a
    window ending today or later is `current` with its `valid_to` kept). Read
    from the raw page the scraper already keeps in its persistent cache (the key
    is the URN `get_document` returns), so it costs no request and never
    touches `article_text` (gotcha 23). A repealed article keeps its update notes
    and their markers on the page and they are not its text (art. 183-bis c.p.c.),
    so `abrogated` does not require an empty body; a whole-article or whole-act notice
    ("ARTICOLO ABROGATO", "PROVVEDIMENTO ABROGATO") is recognised by its words in any
    `ins-akn`, not by the `art_abrogato-akn` class (the class only matters to the structural
    fallback). Best effort: a page it cannot read yields no `validity` key at all, never a
    guess. It also holds the request guard `reject_future_version_date`, and
    `is_historical_request`, which guarded the Brocardi calls and has no caller since
    they stopped (D-078).
  - `normattiva_notes.py` — the update notes («AGGIORNAMENTO (N)», `div.art_aggiornamento-akn`) of a
    Normattiva article page (G-386), read like `normattiva_validity` from the page the scraper keeps in its
    persistent cache: no request, `article_text` never touched (gotcha 23). The comma formats' extractor leaves
    them out (art. 3 d.lgs. 23/2015 lost its note on C. cost. 194/2018); the codes' format and the fallback append
    them to the text, so there they ride in both places with `note_nel_testo: true`. A note is `{numero, testo,
    ordine, corte_costituzionale}`, the shape mcp-legal-it 3.0.x writes: `numero` as written («129a»), `testo` with
    whitespace collapsed and links as their text, `corte_costituzionale` a word match («Corte costituzionale» or
    «C. cost.», and «sentenza»), never a legal reading. A block with no heading or number, or a «((n))» marker
    with no note n on a page that has notes, sets `note_non_lette` (a plain «(n)» does not: the text has those for
    other reasons; the portal also brackets amended words, «entro ((30)) giorni», so the notice can be a cautious
    one, never a lost note; «((2)).» opening a line is a renumbered comma, art. 117 TUB, and «((2027))» a year: neither
    counts, as in mcp-legal-it's reader), and so does an «AGGIORNAMENTO (n)» heading the reader did not take as a
    note (more headings on the page than notes read). A reader that raises gives `note_aggiornamento: null` and
    `note_non_lette: true`, never an error for the article. The page must be the article asked, as for `validity`. Normattiva's editorial `note-akn`
    notes are out of scope.
  - `normattiva_parts.py` — the parts of an article Normattiva splits (G-387): art. 1 l. 296/2006 is 14 entries
    of the page's tree, «1 (commi 1-100)» … «1 (commi 1301-1364)», linked with `art.progressivo=k`, and its URN
    serves the first only (comma 773 is in part 8). Read from the tree of the cached page, like the notes: no
    request, the text untouched; only the entries labelled «<article> (commi a-b)» count (the tree lists an
    article's earlier versions split the same way, «agg.149 (commi 1-100)»), the article compared by
    `comparable_article_key`. A part is `{progressivo, commi_dal, commi_al, url}` (mcp-legal-it 3.0.x's shape;
    `url` is the part's `caricaArticolo` page, which opens only in the article page's session). It also names a
    part from a request (`normalize_range`, `normalize_comma`, `range_holding`) and keys its page
    (`part_cache_key`: «<URN>#commi701-800»)
  - A part as an entry of its own (G-387 (a), G-389; spec `docs/superpowers/specs/2026-10-29-normattiva-article-parts-design.md`):
    the article plus its comma range, `NormaVisitata.parte` ("701-800"), written in `norma_data` only for a part.
    The first part has no `parte`: what the URN serves, with the request, keys and text of before (rule 23). A
    request names a part by `parte` or by a `comma` it holds (`_part_request`, `_name_the_part`: the ranges from the
    act's tree the existence check has just read; a comma of part 1 or of a whole article is the article; a comma
    past the last range, or a range the tree does not list, is a 404 in words; an unreadable tree is never «does
    not exist»; EUR-Lex articles have no parts). `NormattivaScraper.get_document` reads a part with `_get_part`:
    the page kept under its key, else `read_part_page`, which reads the article page (the request's URN, its date)
    and then the part's `caricaArticolo` page in one aiohttp session with its own cookie jar (Normattiva answers
    500 without the article page's cookies; the shared session's single jar would mix two parts read at once), the
    address from the article page's tree, the shared client's rate limit and retries. A range the page no longer
    lists is refused with today's parts (Q3), never another range served. The text is the same extractor's on the
    part's page, checked to open on the part's first comma; never the AKN export (the whole article). The answer's
    `url` is the key, «<URN>#commi701-800» (on Normattiva it opens the article); `validity` and the notes are read
    from the part's page (it states its window but not the act's `act_updated`), `parti` from the article page;
    `testo_parziale` is true. After a restart a part's page is read again in its session, never requested by its
    key (`_page_left_the_cache`)
  - `massimario_portal.py` — internal (MERL-T only): one element of the Massimario
    portal, behind a firewall, so paced (≥ 1.5 s, the environment can only slow it
    down), the client's own retries off, a 403 or 429 is a stop (`429` to the caller).
  - `act_dates.py` — acts cited by year only → their full date, through Normattiva's
    resolver, verified by the page's title (type, year and number; State acts of nine
    kinds only, because the resolver answers a regional URN with the State's act of the
    same number), found dates cached a year. `complete_year` serves a search
    (see Date System); `resolve_many` serves MERL-T (`/resolve_act_dates`).
  - `decisions/` (in `services/`) — court decisions behind `POST /fetch_decision`:
    `model.py` (identity and reference), `citation.py` (a decision cited in words → its
    reference, the palette's patterns in Python, pinned to the golden file's `decision_citations`),
    `italgiure.py` (Cassazione, Italgiure's Solr),
    `pdf_text.py` (the Cassazione's text from the court's PDF), `corte_cost.py` (Corte
    costituzionale open data, range bundles on disk), `curia.py` (the Court of Justice and the
    General Court from the Publications Office's repository, CELLAR: a SPARQL query finds the
    case's judgment, joined cases included, then its Italian XHTML or, before about 2009, the
    former HTML; design 2026-10-12 §4), `giustizia_amministrativa.py` and `tar_seats.py` (the
    Consiglio di Stato, the C.G.A.R.S. and the TAR from giustizia-amministrativa.it: the portal's
    search form, read from the page each time, then the court's XML document; the 29 seats, a copy
    of `conventions/sources/tar-seats.json`; design 2026-10-12-administrative-courts), `resolver.py` (one outcome, lookups
    cached per archive), `http.py` (the readers' own `ThrottledHttpClient` and honest
    User-Agent); behind `POST /search_decisions` and `POST /fetch_decision_pdf`: `search.py`
    (an article or a topic as one Solr query), `search_route.py`, `pdf_route.py`; behind
    `POST /search_eu_case_law`: `eu_case_law.py` (the Union's courts' decisions that cite an article,
    from CELLAR).
- **`tools/`**:
  - `norma.py` — core models `Norma` / `NormaVisitata` (both with
    `to_dict()`/`from_dict()`; `NormaVisitata` implements hash/equality and is
    the primary container across the API)
  - `urngenerator.py` — URN generation · `treextractor.py` — article trees. One page, one
    download: a Normattiva tree is parsed once in its widest form (section labels and
    metadata, key `…|details=True|metadata=True`) and every other variant is cut from it
    (`_narrow`: drop the labels, drop the metadata), so the existence check, a range and the
    index the web opens no longer fetch the same page three times. A EUR-Lex tree reads the
    page from the scraper's own copy (namespace `eurlex`, same URL) and leaves the page it
    visited there, only when it parsed into articles: one browser visit serves the tree, the
    rubriche and the articles (`tests/test_tree_variants.py`). The Normattiva page comes
    through the shared client (its rate limit and host check, one attempt as before), and
    no URL is visited, by the client or the browser, unless `is_allowed` and its host is
    Normattiva's or EUR-Lex's (`_source_of`): `POST /fetch_tree` passes the caller's URL here
  - `text_op.py` — text parsing **and** date handling (see Date System)
  - `article_suffixes.py` — the ordinal table (`bis` … `vicies`) every
    article-number regex reads, longest-first so a short entry cannot claim the
    head of a longer one. A leaf module, imported by `nl_parser`,
    `citation_linker`, `alias_resolver` and `services/akn_parser`; mirrored by
    `apps/web/src/utils/articleSuffixes.ts`. Nine private copies each stopped at
    `decies`, so "art. 25-terdecies" resolved to art. 25-ter — an article that
    exists, which is why nothing looked broken. `ORDINAL_SPELLINGS` pairs the two
    spellings of 9, 15, 16, 18, 19 and 20 (`other_ordinal_spelling`): Normattiva uses one
    per act («391 novies» c.p.p., «21 nonies» l. 241/1990), so `create_norma_visitata_from_data`
    takes the act's spelling when the other one was asked (`_source_spelling`) and the URN
    is the act's; `normalize_article_key` keeps the spelling it is given, since its keys
    are what `/fetch_rubriche` and the fingerprints answer
  - `sys_op.py` — `PlaywrightManager` singleton (browser pooling), reached through
    `get_playwright_manager()`
  - `config.py` — rate limiting, cache size, Redis (`REDIS_ENABLED`, `REDIS_URL`)
  - `map.py` — act-type mappings, plus the act tables the resolver reads
    (`ATTI_NOTI` 64 aliases, `ATTI_DENOMINATI` 202 aliases over 81 acts, built
    from the reviewable `_ATTI_DENOMINATI_SPEC` rows) and `codice_urn(name)`,
    the **case-insensitive** lookup into `NORMATTIVA_URN_CODICI` — six keys
    carry capitals ("codice del Terzo settore"), so a bare `in` test missed
    them and those codici lost their default annex. `ANNEXED_ACTS` (with
    `act_default_annex`) does the same for an act cited by type, date and number whose text
    is its annex: the TULPS is annex 1 of r.d. 773/1931 (G-351), so «r.d. 773/1931, art. 86»
    is stored and keyed with `allegato: "1"` and its URN is `…;773:1~art86`; so are the legge
    fallimentare (r.d. 267/1942), the c.p.p. minorile (d.P.R. 448/1988) and the testo unico sulle
    successioni e donazioni (d.lgs. 346/1990), whose decree's own art. 1 approves the annexed text
    (found on 25 October 2026; no other act of the codes table or of `ATTI_DENOMINATI` has that shape). A code's
    default annex and such an act's annex are never named in a citation (`sources.py`, and
    the server's, the web's and MERL-T's copies); the TS mirrors and MERL-T's copy of
    `ANNEXED_ACTS` are pinned to this one by their tests. `ANNEX_SIGLE` / `ANNEX_HEADINGS`
    (keyed «<decree>:<annex>») give an annex of a code's decree, or an act of the codes table,
    a sigla and a heading of its own (G-369: «disp. att. c.p.a.», «c.p.m.g.», «disp. att. c.p.p.»);
    `sources._named` reads the sigla by the annex a norm sits in, so another annex of a code's
    decree is never the code, and an annex with no sigla is cited by the decree with
    «(Allegato N)». The parser reads each sigla back as the code and its annex; the same
    copies are pinned the same way
  - `map.py` also holds `BROCARDI_CODICI` (label → page, one row per source at
    brocardi.it/fonti.html) and `find_brocardi_url(tipo, numero, data)`, which
    `brocardi_scraper.do_know` asks — unused since Brocardi was switched off (D-078). The lookup is **by identity**: every label
    embeds the act's extremes ("Statuto dei lavoratori(L. 20 maggio 1970, n.
    300)"), `parse_brocardi_estremi()` reads them once into (tipo esteso, anno,
    numero), and a norma matches only its own triple — the year is what tells
    D.lgs. 81/2008 from D.lgs. 81/2015, so without one the number must be unique
    for that tipo. Only the labels without extremes (Costituzione, Preleggi,
    CCNL) match by name, and they win: Preleggi share the codice civile's R.D.
    262/1942. Codici go through the extremes of their Normattiva URN, which is
    how "codice in materia di protezione dei dati personali" reaches the page
    Brocardi calls "Codice della privacy". **Never match a label as a
    substring**: `do_know` used to look for "D.lgs. 2001-06-08, n. 231" inside
    "(D.lgs. 8 giugno 2001, n. 231)", so no act outside the codici ever got its
    dottrina and massime (69 of 100 sources). An act that is not on Brocardi
    returns `None`, never the nearest label.
  - `act_resolver.py` — `resolve_atto(name)` maps an act named the way a lawyer
    writes it ("statuto dei lavoratori", "TUSL", "del D.Lgs. 231/2001") to
    `{tipo_atto, data, numero_atto}`, over the `ATTI_NOTI` / `ATTI_DENOMINATI`
    tables in `map.py`. It **never guesses**: an unrecognised name returns `None`
    and `suggest_acts()` offers near misses. Chained after the exact-match paths
    in `alias_resolver` and `nl_parser`, so nothing that resolved before changes.
  - `egress.py` — `ALLOWED_HOSTS` plus `is_allowed(url)`, checked in
    `ThrottledHttpClient.request`; it refuses a backslash, a control character,
    credentials before the host and a scheme other than http(s), which Chromium would
    read as another host than `urlparse` does. `tests/test_egress_allowlist.py` fails the
    build when a URL literal names an undeclared host. The runtime check covers
    every `ThrottledHttpClient` (the shared one and the decision readers' own)
    and the check before EUR-Lex's browser (`eurlex_fetch.fetch_with_playwright`, for the
    scraper and the tree alike) — `SECURITY.md` lists what it does not cover (the PDF
    export's Playwright, what a page then loads, redirect targets except CELLAR's).
  - `tls.py` — the verifying SSL context for Italgiure, which serves an incomplete chain:
    the missing intermediate ships in `tools/certs/` and is trusted only under its SHA-256
    pin. Never "simplify" it into turning verification off (`tests/test_tls_italgiure.py`
    fails).
  - `sources.py` — the convention for legal sources as this API holds it (spec
    `docs/superpowers/specs/2026-10-04-source-convention-design.md`, golden file
    `conventions/sources/golden.json`, `tests/test_sources_golden.py`):
    `normalize_norm_urn` (any spelling of a norm → its identity: the resolver wrapper,
    version markers cut, Normattiva's alias form of a code, `decreto legislativo` /
    `decreto-legge` tokens, a ministry-form decree), `eu_identity` (`celex:32016R0679~art5`;
    `generate_urn` keeps building the EUR-Lex page) and `cite_article` / `cite_act`, the
    owner's citation style with every form he decided (the web's `utils/citation.ts` and
    the server's `norms/citation.ts` take the forms decided on 4 October, and the golden
    file, with the plan's PRs 1 and 2). `/parse_query`'s `display` is `cite_article`, or
    `cite_act` for a query with no article. A year-only URN and anything that is not a NIR
    URN pass through `normalize_norm_urn` unchanged
  - `nl_parser.py` — natural-language query parser ("art. 3 cc" → params),
    exposed at `POST /parse_query`. Every label the source convention writes reads
    back to the norm it was written from (`tests/test_nl_parser_convention.py`, driven
    by the golden file): «d.l.», «l. cost.», «r.d.l.», «d.lgs.lgt.», «1° settembre»,
    and «(Allegato A)» / «(All. A)», sent on as `annex`. A single article's comma
    («art. 1, comma 773, l. 296/2006», «co. 773») is sent on as `comma`, a part's
    label («art. 1, commi 701-800, …», «art. 1 (commi 701-800) …») as `parte`; after a
    list or a range of articles neither. The Costituzione has no
    number and no date: a type that reads as it next to either is refused, never
    guessed («l. cost.» was once read as `cost.`)
  - `alias_resolver.py` + `preset_aliases.yaml` — preset aliases (`gdpr` →
    Regolamento UE 2016/679); runs before the NL parser
  - `norm_query.py` — `read_norm_query(query)`: the search's reading, the preset aliases then the
    parser, which `/parse_query` and `/parse_query_batch` share so they cannot drift; and
    `act_names()`, the names that name an act on their own (`/fetch_alias_catalog`'s `act_names`)
  - `act_identity.py` — `identifies_act(params)`: a reading names an act when its type needs no
    number, or has its number and its date («art. 2 d.m.» reads and names none). The types that
    need them are a copy of `conventions/sources/numbered-act-types.json`
    (`tests/test_act_identity.py` compares them); the citation linker's context reads the same list
  - `article_clause.py` — the clause after an article («comma 1», «secondo comma», «par. 1», «n. 3»,
    «lett. b)»), one source for `nl_parser` and `citation_linker`: a clause is the article's, never
    the act's («art. 4, n. 7, GDPR» was regulation n. 7; «art. 82, par. 1, GDPR» read as nothing).
    A «n.» followed by «/» or «del» is an act's number and is left to the act
  - `act_resolver.AMBIGUOUS_NAMES` — spellings that name two acts, refused by the resolver and the
    parser so the search asks instead of guessing; kept by hand and short («T.U.E.»: the testo unico
    edilizia or the Treaty; «TUE» without dots stays the Treaty)
  - `citation_linker.py` — citation detection in article text, emits
    `{start, end, display_text, article, act_type, date, act_number}`; exposed at
    `POST /extract_citations`. EU acts ("regolamento (UE) 2016/679, art. 5",
    "art. 5 del regolamento (UE) 2016/679", "direttiva 2002/58/CE") go
    through `nl_parser`'s shared pattern, with the marker mandatory for
    regulations — a bare "regolamento n. 5/2020" in a text is a national
    one. A bare "art. 7" after a numbered act inherits its number and year,
    not only its type. An ordinal suffix is read spaced, joined or hyphenated
    («615 bis», «615bis», «615-bis») and always emitted as `615-bis`; before
    2026-10-07 only the hyphen was read and the other two came out as art. 615,
    so MERL-T's citation edges built from them may point at the wrong article
  - `circuit_breaker.py` — per-source breaker. **State is in-memory
    per-instance** — single-instance deployment only. Status at
    `GET /api/circuit-breakers`
  - `redis_cache.py` + `cache_manager.py` — Redis cache with automatic
    filesystem fallback; startup warns when Redis is disabled or missing. The filesystem
    cache deletes an expired entry only when its key is read again, so a namespace nobody
    sweeps only grows. The Normattiva pages (2.6 MB for an article of a code) are pruned at
    start and every six hours with the decision caches (`prune_normattiva_cache`): the
    expired pages go (G-344: `get` refuses them anyway, so the scraper and
    `normattiva_validity` never read one), then the pages not read for 30 days and the
    least recently read down to 2 GB (G-338), a ceiling for a longer TTL or a busy day. A
    read refreshes the file's modification time, which is what `prune` reads; the TTL
    still counts from the write. `sweep_expired` reads an entry's write time from its
    first bytes (`_HEAD`), not by decoding a 2.6 MB page. An entry is written to
    `<digest>.<random>.tmp` and renamed over `<digest>.json` (`os.replace`), so a reader or
    a sweep never meets one half written; a temporary a crash left goes after an hour

**Timing harness** — `scripts/collector_timing.py` runs a fixed list of real requests
in-process, cold then warm, and prints where each one's time goes (network per host, our
throttle and retry waits, parsing, Playwright, cache); `--compare <earlier run>` checks the
returned article and decision texts byte for byte (root rule 23). It talks to the real
sources: a few runs, never a loop, never on the deployment host.

## Key API Endpoints

POST unless noted, JSON bodies.

- `/fetch_norma_data` — build norm structure from params
- `/fetch_article_text` — fetch article text (array response)
- `/stream_article_text` — stream results as NDJSON, one object per line
- `/fetch_brocardi_info` — 410 Gone: Brocardi is no longer a source (D-078)
- `/fetch_all_data` — article text and `norma_data` (and `validity`) in one call
- `/fetch_tree` — article tree for a complete URN. An article Normattiva splits into parts is one
  article with its parts: «1 (commi 1-100)» … «1 (commi 1301-1364)» are entries `{numero: "1", parte,
  commi, label}`, the first with `parte: null` (the article), each other with its range («101-200»),
  the article's URL for all; `count` and the annex's `article_numbers` count the article once. They
  were 14 «articles» numbered «1 (commi 101-200)» (and the existence check found no art. 1); the
  persistent keys carry `|parts`, so a tree stored before is read again
- `/parse_query`, `/extract_citations` — NL parsing and citation detection. `/parse_query`
  answers `identifies_act` beside `recognized` (`act_identity.py`)
- `/parse_query_batch` — `{"queries": [...]}`, 1 to 200 strings of 1 to 200 characters, the body
  at most 48 KB (anything else a 400 that names the limit) → `{"results": [{recognized, parsed,
  source, identifies_act}]}` in order: each read as `/parse_query` reads one (`read_norm_query`),
  and no further — no URN, so no request leaves, nothing cached or kept. It logs the count, the
  failures and the duration, never a string, and an error by its type only: the strings are the
  citations of a document the user may hold confidential (`tests/test_parse_query_batch.py`
  captures the records). Priced 3 points by the server's scrape gate; routed by the ingress's
  `/parse_query*` and Vite's prefix. For «Analizza documento»
  (`docs/superpowers/specs/2026-10-29-document-analysis-design.md` §4.4)
- `/fetch_rubriche` — article titles and repealed articles for an act, from the
  AKN index, and the act's `title` (`presentable_title`: no Gazzetta code, no
  amendment brackets, accents restored; `''` when there is none), so the
  dossier names an act with one call. An EU act's title is its subject («relativo
  alla protezione delle persone fisiche …») from the page the tree is read from
  (`_extract_eurlex_title`: the OJ's `eli-main-title`, the consolidated
  `title-doc-last`, the legacy page's `DC.description`; a run with no date line, a
  Treaty's, gives none). `get_tree` keeps no failed or empty tree, in memory as on
  disk (`_no_tree`), so a page EUR-Lex's firewall refused is asked again. Always 200: a failure is
  an empty answer (with `error` when the handler itself failed), which the web
  does not cache. Structure only: it never carries the
  display text
- `/fetch_recitals` — every considerando of an EU act (`regolamento ue` /
  `direttiva ue`) in one call: `{recitals: [{number, text}], count, url}`.
  Reads the OJ page the tree already uses; a consolidated text has no
  preamble and answers an empty list. Normattiva acts get a 400
- `/fetch_act_fingerprints` — `{urn}` → a sha256 per article of the act's
  AKN text plus, for the codici, the FRBRWork date of each article (the day
  its current text came into force). `urn` is the act's full URL as
  `norma_data.url` gives it (`https://www.normattiva.it/uri-res/N2Ls?urn:nir:…`),
  not a bare `urn:nir:` string; an article suffix (`~art2`) is stripped. A
  change detector, never the text: a client refetches only the articles
  whose hash moved. `available: false` with empty maps when there is no AKN
  index, or an index without fingerprints — the caller must then refetch
  everything, not conclude nothing changed
- `/fetch_decision` — one court decision: `{corte: cassazione | corte_costituzionale |
  corte_giustizia_ue | tribunale_ue, numero, anno, archivio?, sezione?}` (the two courts of the Union
  by their case, C-634/21 as 634 and 2021, decided by the owner, Q10 of the 2026-10-12 design; a joined case answers the first case's judgment with the notice `causa_riunita`, two
  judgments of one case are `ambigua`; `consiglio_di_stato | cgars | tar` with `provvedimento?` (the
  kind, the ECLI's suffix: `sent`, `ocau`…), `tipo?` (`sentenza | ordinanza | decreto`), and for a TAR
  `sede` (a slug of `tar_seats.py`) or `regione`: no kind named is a sentenza, and a year holding
  none is `ambigua` with what it holds; a region is searched at each of its seats, the seat found
  told by the notice `sede_dedotta`; pareri left out) → `esito` trovata (identity, attributes, whole text,
  source) and ambigua 200, non_trovata 404 (with the reason and the archive's start),
  fonte_non_raggiungibile 503, richiesta_non_valida 400, errore_interno 500 (a bug: a fixed
  body). That is every answer the handler writes; the others carry no `esito`: the per-IP
  rate limit's 429 `{"error": …}` and the login gate's 401/429 through the ingress (both
  before the handler), and the framework's own 405 (a method other than POST or OPTIONS),
  408 (a stalled body) and 413 (over 16 MB; 1 MB behind the ingress, whose own page
  answers). Italgiure (TLS pinned, own client) and the Corte costituzionale open data
  (bundle on disk; when its refresh fails, the copy on disk still confirms a decision it
  holds for an earlier year, and a number it does not hold is a 503, never `non_trovata`).
  The Corte costituzionale's decisions link to the court's page; the
  Cassazione's have no source link. Lookups cached per archive: found 30 days, absent 1
  hour, a decision found without its text 24 hours (with the notice
  `testo_non_disponibile`; `attributi.testo_assente` says why only when the source did:
  `oscuramento` or `valutazione_oscuramento`), a text read from the archive's field
  instead of the PDF 24 hours too (notice `testo_da_archivio`), errors never. Expired entries are swept at
  start and every six hours (`sweep_decision_caches`). Design:
  docs/superpowers/specs/2026-10-01-sentenze-design.md
- `/search_decisions` — the Cassazione decisions that mention an article or a topic:
  `{norma?, tema?, archivio?: civile | penale, modo?: indice | testo, pagina?, anno_dal?, anno_al?}`
  → `esito` risultati (a page of 20 with `totale`, `modo`, `archivio_dal`, `anni` (`[{anno, n}]`,
  the matches per year of the decision's number (its deposit year), newest first, over every year
  whatever the range; absent when the archive sent no facet), and per decision its identity, attributes, `trovata` and `frammento`; cached a
  day; the range bounds the deposit year as a filter query, 1900 to this year, one bound alone is
  open), non_supportata, richiesta_non_valida
  400, fonte_non_raggiungibile 503, errore_interno 500 (a bug: a fixed body). Italgiure only,
  the last five years; the index serves codes and the Constitution, any other act goes to the
  text search, and an act no way can phrase (an EU act among them) answers non_supportata. Design:
  docs/superpowers/specs/2026-10-05-norms-decisions-search-design.md
- `/search_eu_case_law` — the decisions of the Court of Justice and the General Court that cite an
  article of a regulation, a directive or a decision of the Union: `{celex, articolo}` (the act's CELEX,
  `32016R0679`; the article as digits, 1 to 9999; both checked against strict patterns before they enter
  the SPARQL query) → `esito` risultati (`decisioni`: `{corte, causa, ecli, data, tipo, celex, identita}`
  newest first, `identita` = `{corte, numero, anno}` as `/fetch_decision` takes it, `tipo` JUDG | ORDER |
  OPIN_AG, the Advocates General's opinions included; `totale`; `troncato` when the query hit its 500-row
  limit; cached 3 days per act and article, `cache_manager.EU_CASE_LAW_TTL`), non_supportata 200 (a
  well-formed CELEX that is not `3YYYY[RLD]NNNN`: a treaty such as `12012E/TXT` gave no row on 13 October
  2026 and an empty list would read as «no case law»; never queried, never cached), richiesta_non_valida
  400, fonte_non_raggiungibile 503 (`fonte: curia`; a timeout, a partial, malformed or unreadable answer:
  never an empty list, never cached), errore_interno 500 (a bug: a fixed body).
  CELLAR reifies a decision's citation of an act as an `owl:Axiom` (`owl:annotatedSource` the decision,
  `owl:annotatedTarget` the act, `annotation:fragment_cited_target` a literal such as `A06P1L1LB`); the
  fragment is matched `^A0?<n>($|[PL])`, so article 6 never finds `A60`. The list is not complete: the
  fragments arrive late for recent cases and are thin before 2021. Decisions of other types (a notice,
  an opinion under art. 218 TFEU) and of the Civil Service Tribunal (closed 2016) are left out.
  Only a judgment opens with `/fetch_decision`'s CGUE reader (it finds CELEX types CJ and TJ by case):
  an order or an Advocate General's opinion opens on EUR-Lex by its `celex` (decided 13 October 2026).
  Measured on 13 October 2026 for a regulation or a directive: 0.06 to 0.8 s, 35 to 114 decisions
  (5 to 25 KB with `identita`). Design: docs/superpowers/specs/2026-10-12-case-law-section-design.md
- `/fetch_decision_pdf` — `{corte: cassazione, archivio, numero, anno}` → the court's original
  PDF of a decision as `application/pdf` bytes (an attachment), the ones a lookup cached or
  fetched once; `non_disponibile` 404, fonte_non_raggiungibile 503, richiesta_non_valida 400.
  Served only behind the login
- `GET /fetch_alias_catalog` — `act_names` (the names that name an act on their own, no bare
  type word: what «Analizza documento» looks for in the browser), the presets we ship plus the act names the
  resolver already understands. A GET, like `/fetch_massimario`; a POST answers 405
- `GET /fetch_massimario?kind=index|capitolo|sezione&id=<n>` — internal (MERL-T): one element of the Massimario portal, raw; paced at ≥1.5 s; 429 when the portal's firewall refuses (a 403 or 429 from the portal, or its "Request Rejected" page); a 5xx or a timeout is retried a few times by the module, then 500.
- `POST /resolve_act_dates {"urns": [...]}` — internal (MERL-T): up to 20 year-only URNs (`urn:nir:stato:legge:1983;184`) → full URNs, through Normattiva's resolver; found dates cached a year. Only State acts of the nine kinds in
  `act_dates._TITLES` are resolved; any other URN, a page whose title is not that act's, a network failure and
  everything after the batch's first 120 s answer `null` for that act.
- `POST /parse_decision {"citazioni": [...]}` — internal (the server's `POST /api/dossiers/:id/decisions`;
  not routed by the ingress, not proxied by Vite): 1–10 decisions cited in words (at most 300
  characters each) → one reading each, in order: `{riferimento}` (what `/fetch_decision` takes),
  `{corte_non_supportata: "<court>"}` (a court recognised that VisuaLex cannot read: the Consiglio di
  Stato's pareri, the Garante, the Corte EDU, the Corte di giustizia tributaria) or `{non_riconosciuta: true}`.
  The Consiglio di Stato, the C.G.A.R.S. and a TAR are read with the section, the family the words
  name (`tipo`) and, for a TAR, the seat or the region (a region with one seat gives its seat; a
  T.R.G.A. needs its seat): design 2026-10-12-administrative-courts §4.
  The Court of Justice and the General Court are read by their case («CGUE, C-634/21», a bare
  «T-612/17», «Corte giust., causa 26/62»: a case before 1989 only after the court's name): the case's letter names the court, whatever name precedes it.
  No request leaves. Anything else is a 400 `richiesta_non_valida`. Design:
  docs/superpowers/specs/2026-10-12-decisions-mcp-and-eu-courts-design.md §2.1
- `/export_pdf` — PDF via Playwright (rejects non-Normattiva URNs — SSRF guard). An
  undated URN is exported as the text in force today, `!vig=<today>` in Europe/Rome
  (`export_url`, G-355); a dated one or `@originale` as asked, and a day after today is a
  400, as for an article. The file is cached in `download/` under the act's authority, type,
  date, number, annex and version, each in its place joined by «_», which no part of a URN
  holds (`urn_to_filename`; until 21 October 2026 the number and the year alone, until 25
  October without the authority and with «:» and «;» read alike); a name over 150
  characters is a 400, never cut. The PDFs there older than two days are deleted on the
  six-hour sweep (`sweep_exported_pdfs`, top-level `.pdf` files only)
- `GET /history` — server-side search history
- `GET /health/detailed` — probes Normattiva, EUR-Lex's site and CELLAR **for
  real**, on the shared client, one request each and no browser. `services.eurlex` is
  `error` only when both EU hosts are down (the acts are read from either), and carries each
  one's own state: `eurlex` (`ok`, `challenge`, `error`) and `cellar` (`ok`, `error`: the
  GDPR's CELEX answers its 303). One result is cached
  for `HEALTH_DETAILED_TTL` seconds (120) behind an `asyncio.Lock`, so N
  concurrent cold callers run one probe; the body carries `cached` and the
  status stays 503 while a source fails. Never wire it to a tight loop

The update notes ride next to `article_text` in the same three handlers, for a Normattiva article
(`_page_extras_for`; an EU act has none of the keys): `note_aggiornamento` (the list, `[]` when the page has none,
null when the page cannot be read or the text is the AKN export's, which opens with «### » and holds its notes),
`note_non_lette` (true when some note, or the page, could not be read: «note di aggiornamento non lette: verificare
su Normattiva») and `note_nel_testo` (true when `article_text` already holds them: the codes, the AKN export). They
are read from the served page, today's when a later version was set aside.

So are, for an article Normattiva splits into parts (G-387), `parti` (`[{progressivo, commi_dal, commi_al, url}]`
ordered by `progressivo`, `[]` for an article listed whole, null when the page has no tree, cannot be read (a
dated request's page after a restart: no notice then, unlike the notes) or the text is the AKN export's, which holds
the whole article) and `testo_parziale` (true when the text is one part: the first, the one the
article's URN serves, or the part asked, whose `norma_data.parte` names it). A client says so: «testo
parziale: commi 1-100 di 1364 (diviso in 14 parti)», or «commi 701-800 di 1364» for part 8
(`normattiva_parts.partial_notice`). The page is read once for both (`_page_extras_for`), and one reader's failure
leaves the other's answer.

`validity` rides next to `article_text` in `/stream_article_text`,
`/fetch_article_text` and `/fetch_all_data` (Normattiva only; absent when the page
cannot be read): `{state, valid_from, valid_to, version_number, act_updated,
request_in_window}`, dates in ISO form. It is the source's own statement of which
version came back; `norma_data.data_versione` is only the date the caller sent (except for
`upcoming: true`, below, where it is the later text's first day). A
`version_date` after today (Europe/Rome) is a 400 — Normattiva would answer with the
current text and say nothing — and so is one that cannot be read as a date, and one with
`version: "originale"` (a date asks for the text in force that day, G-353; mcp-legal-it refuses the pair too).

A date always asks for the text in force on that day, with or without «vigente» (owner,
G-353; a request pairing it with «originale» is refused, above, and inside the API the date
still wins: `append_version_info` writes `!vig=<day>`, and the AKN
fallback reads the export at that day, never the original from today's). A request
with no date is the text in force: Normattiva answers it with its latest version, also
one not in force yet (art. 3 d.P.R. 131/1986 on 21 October 2026: repealed from 1
January 2027). When the page's window starts after today (`starts_after_today`), the
handlers read the article at today (`!vig=<today>`) and serve that text, its `url` and
its `validity`, with the later version in `upcoming` (owner, G-355;
`NormaController._document_in_force`): `{change: "abrogated" | "amended" | "inserted",
valid_from, version_number}`, absent otherwise, with `versions_between: n` when the version
numbers show `n` other versions not in force yet before it: Normattiva's undated page is the
latest version and a date after today answers today's text, so those cannot be read, and a
request for a day they cover says so («Non so dire quale versione … sia in vigore il …»). `norma_data` stays the request's (no
date), so the key notes and highlights are stored under does not move. When nothing is
in force today (today's page is `not_yet`: an article inserted from a later day) the
later text is served as before, with `upcoming.change` `"inserted"` and `not_in_force:
true` (G-358): it is the text that will come into force, so the request's key stays. The
first page stands as before, its `validity` saying when it starts, when today's cannot
be read or itself starts after today. The later text of an article can be asked for
explicitly with `upcoming: true` (G-357; alone, or with a `version_date` after today, which
is otherwise a 400): the undated page, always with `not_in_force: true`, `upcoming`
describing it (`change` `null` when today's page cannot be read, since an amendment then
cannot be told from an insertion), its `validity` with `request_in_window: true`, and
`norma_data` dated to the day it comes into force (`versione: "vigente"`, `data_versione:
valid_from`; `norma_data.urn` stays the undated page's, as `url`), so it reads as a text at
a day, never as the text in force. None published, none in force on the day named, or a
page that cannot be read is the article's error, in a 200 like any other («Nessuna
versione non ancora in vigore …», «… entra in vigore il …», «Non riesco a leggere la
vigenza …»). `upcoming` with «originale», or with a day up to today, is a 400. A web that
reopens a saved text dated after today must send `upcoming: true` with it, and must not
cache the answer under the key of an undated request. The text comes from
the scraper's memory and the page from the persistent cache, which can expire first after a restart: for an undated request whose
page has left the cache it is read once more, so a later version is never served
unrecognised (and a watched norm does not flip between two texts).

Root `app.py` maps failures through `_error_response`, so the status now carries
meaning: `ValidationError` → 400 (missing `act_type`/`article`, malformed article
input), `ResourceNotFoundError` → 404 (the article is not in the act; a request whose ranges
find no article in the act's index and that names nothing else), `RateLimitExceededError` → 429, `IndexUnavailableError` → 503 (a
range, or a whole act, whose index `get_tree` could not read answers
«Non riesco a leggere ora l'indice di quest'atto, quindi non posso aprire gli artt. 1-5: …»;
`parse_article_input` returns its error dict with a `kind`, turned into the exception by
`article_input_error`; until 13 October 2026 `get_tree`'s failure, a message and 0, was read as a
list of characters and an EU range came back empty with no error), everything else 500, except `/fetch_decision`,
whose handler answers every failure with `esito` and never with the exception's text.
What the handler does not write is not its own, on that route too: the per-IP rate
limit's 429 `{"error": …}`, the login gate's 401/429 through the ingress, and the
framework's own 405, 408 and 413 pages.
Before, every failure was a 500 — and `stream_article_text` raised through to
Quart and answered an HTML error page instead of NDJSON.

```json
{
  "act_type": "codice civile",
  "date": "1990-08-07",         // optional
  "act_number": "241",           // optional
  "article": "2043",             // required: single, list "1,2", or range "3-5"
  "version": "vigente",          // optional: "vigente" | "originale"
  "version_date": "2024-01-15",  // optional
  "annex": "A",                  // optional (allegato)
  "celex_consolidated": "02002L0058-20091219"  // optional, EU acts only: serve this consolidated version
}
```

Request fields are `act_type/act_number/date`; the `norma_data` in responses uses
`tipo_atto/numero_atto/data`. The mismatch is real — map, don't assume.

## Date System

Two complementary paths, chosen by whether you need speed or truth.

**Backend** (`services/visualex/visualex_api/tools/urngenerator.py`):
- `complete_date_or_parse(date, act_type, act_number)` — **sync, approximate**.
  Year-only dates become `YYYY-01-01`. Used by `generate_urn` so URN generation
  never blocks on a lookup (the source convention's PR 3b is to stop writing it).
- `complete_request_date(act_type, date, act_number)` — **async**, the date a
  request names, as `create_norma_visitata_from_data` (both servers) builds the
  `Norma` with it. A year with a number goes to `act_dates.complete_year`: one
  request to Normattiva's resolver, the date read from the act's own title only
  when its type, year and number are the ones asked (cached a year). When the act
  cannot be told for certain (a kind outside `act_dates._TITLES`, a number that is
  not digits, another act's page, a failure, past `LOOKUP_BUDGET` = 15 s) the year
  stands: never another act's date. A full date is read into ISO for `legge`,
  `decreto legge`, `decreto legislativo`, `d.p.r.` and `regio decreto` (a malformed
  one is a 400) and passed on as given for the others.
- Until 9 October 2026 the year was completed by `complete_date`, which typed the
  act into the portal's search with Playwright and took the first hit without
  reading it: d.lgs. 231/2001 came back dated 2025-12-31, another act's day, and a
  failed lookup was a 500. A norm saved from that answer (a tab, a dossier item, a
  quick norm, a watched norm, an environment, a share link) keeps the wrong full
  date and sends it back, which skips the lookup; the date is also part of
  `buildItemKey`, so correcting it would orphan the notes made on it.

**Frontend** (`apps/web/src/utils/dateUtils.ts`):
- `parseItalianDate(dateStr)` — parses while preserving the original precision.
- `formatDateItalianLong(date)` — "7 agosto 1990". Use this for every displayed
  date; never `toLocaleDateString()`.

**The principle**: synthetic `YYYY-01-01` exists for URNs only. The UI shows the
precision the backend actually has — a year-only entry displays as a year, and
that is correct, not a bug to normalise away.

If date completion feels slow, you are probably calling `complete_request_date`
in a loop: each act it cannot find costs a request (a miss is not cached).

## Scraping Architecture

1. **Routing**: `NormaController.get_scraper_for_norma()` picks the source —
   EUR-Lex for TUE/TFUE/CDFUE/Regolamento UE/Direttiva UE, Normattiva for Italian
   state law.
   EU acts come from the Official Journal page (fetched from CELLAR, else from EUR-Lex:
   `eurlex_fetch`) unless the request names a
   `celex_consolidated` (sector-0 CELEX, `02002L0058-20091219`): then the
   tree, rubriche and article text are read from that consolidated page,
   whose markup is different (`title-article-norm`, `modref` markers) and
   handled by its own branch in `eurlex_scraper.py` / `treextractor.py`.
   Consolidated texts carry no preamble — recitals always come from the OJ
   page of the base act.
2. **Parallel fetching** via `asyncio.gather()`.
3. **Streaming**: `/stream_article_text` uses a Quart `Response` generator.
4. **Browsers**: always through the `PlaywrightManager` singleton.

Scrapers parse third-party HTML. When one breaks, the site changed — expect to
update selectors, not logic.

### Async rules (Python)

Every scraper method is async (`get_document()`, `get_info()`). Quart routes are
async by default. Never block the loop: wrap blocking I/O in
`asyncio.to_thread()`. Playwright is async throughout — `WebDriverManager` is a
deprecated alias of `PlaywrightManager`; Selenium is gone.

Errors use the hierarchy in `services/visualex/visualex_api/tools/exceptions.py`
(`ValidationError`, `ResourceNotFoundError`, `RateLimitExceededError`), surfaced
by `NormaController.handle_error()`. Logging is structlog.

## Shared utilities — check before writing a new one

Duplicating any of these is a defect, not a shortcut.

**Python**: `urngenerator.py` (URNs) · `sources.py` (identity and citation of a source) · `text_op.py` (text parsing + dates) ·
`treextractor.py` (trees) · `PlaywrightManager` (browsers) ·
`article_suffixes.py` (the ordinal suffix table).

## Common Patterns

**New scraper** — add the class in `services/`, implement async
`get_document(normavisitata) -> Tuple[str, str]`, register the act type in
`NormaController.get_scraper_for_norma()`, extend `tools/map.py` if needed.

**New API endpoint** — route in `NormaController.setup_routes()`, async handler,
`await request.get_json()`, return `jsonify()`, log with structlog.

**Playwright work** —

```python
from visualex_api.tools.sys_op import get_playwright_manager

manager = get_playwright_manager()
browser = await manager.get_browser()
page = await browser.new_page()
# ... work
await page.close()
```

The manager owns the lifecycle; don't tear browsers down yourself.

## Environment Variables

**Python API** — `HOST` (`0.0.0.0`), `PORT` (`5000`), `REDIS_ENABLED` (`false`;
filesystem cache when off, warned at startup), `REDIS_URL`,
`REDIS_CACHE_PREFIX` (`vlx`), `PERSISTENT_CACHE_TTL` (`86400`),
`HTTP_MAX_CONCURRENCY` / `HTTP_TIMEOUT` / `HTTP_MAX_RETRIES`,
`ALLOWED_ORIGINS` (**unset means localhost only — production must set it**),
`RATE_LIMIT` / `RATE_LIMIT_WINDOW` (`1000` / `600` per IP),
`TRUSTED_PROXIES` (`0` — how many reverse proxies sit in front; `X-Forwarded-For` is
believed only that far, and not at all at 0), `VISUALEX_LOG_FILE` (unset keeps
`norma.log` / `visualex_api.log` in the working directory; **empty** means console
only, which a read-only container needs),
`AKN_ENABLED` (`true` — kill switch for the whole Akoma Ntoso path, read at
call time), `AKN_CACHE_MAX_ACTS` (`40` — parsed article indexes held in memory;
a few tens of KB for an ordinary act, a few hundred KB for a codice because of
the per-article fingerprints), `HEALTH_DETAILED_TTL` (`120` — seconds the
`/health/detailed` probe is cached, read at call time). Template in
`.env.example`.

Runtime dependency worth knowing: `lxml` (`requirements.txt`) is what the AKN
parser uses; it ships a `cp314` wheel, so installing it needs no compiler.

## Container image

`services/visualex/Dockerfile`, built from the **repository root** (it reads
`version.txt`): `docker build -f services/visualex/Dockerfile -t visualex-scrapers .`.
`infra/compose.scrapers.yml` is the module that runs it.

- **Hypercorn, one worker** (`asgi:app`). The rate limiter, the circuit breaker and the
  fetch queue keep their state in memory, per process: more workers would each have
  their own. `python app.py` is still the development server.
- **It mirrors the repository layout** (`/repo/services/visualex`, `/repo/version.txt`)
  because `/version` and the `data/` and `download/` paths are computed relative to the
  source tree. `data/` (the search history and dossier file this service keeps) and
  `download/` (the cache and the exported PDFs) are volumes.
- **Chromium runs as a normal user** with every capability dropped and no `--shm-size`.
  Measured: about 280 MiB idle, about 1.06 GiB and 195 processes with four PDF exports at
  once; Docker's default 64 MB `/dev/shm` is enough (Playwright's Chromium avoids it).
- **No Redis.** MERL-T's job queues live in Redis as pickled objects, so a scraper able
  to write there could get code run by the worker. The cache is the filesystem.
- **Behind the ingress set `TRUSTED_PROXIES=1`.** At 0 every client shares the ingress's
  address, and one rate-limit bucket.
- **Behind the ingress the scraping routes need a login.** The Caddyfile asks the server
  (`GET /api/auth/verify`) before it passes a request on, except `/version` and `/health`.
  The Python API itself stays unauthenticated inside the network (the ingress is its only
  door) and never sees the login token (`header_up -Authorization`). The login check is
  timed out after ten seconds (a `504`), so a server that hangs fails the request instead
  of holding it.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Python** — `services/visualex/visualex_api/app.py` (controller) · `tools/norma.py` (models) ·
`tools/text_op.py` (parsing + dates) · `tools/sys_op.py` (browser pool) ·
`services/*_scraper.py` (fragile HTML parsers).

## Gotchas

1. **Scraper fragility** — every scraper depends on third-party HTML. Breakage
   means the site changed.
2. **Async context** — never block the Python event loop; wrap blocking calls in
   `asyncio.to_thread()`.
3. **Rate limiting** — per-IP, configured in `config.py`; 429 when exceeded.
4. **Playwright** — needed for PDF export (`playwright install chromium`);
   always via `PlaywrightManager`. Date completion no longer uses it.
5. **Dates** — sync for URNs (approximate), `complete_request_date` for the
   norm a request names (the act's own date, or its year); never render a
   synthetic `YYYY-01-01`. See Date System.
6. **CORS/proxy** — the Vite dev server proxies to the Python API; check
   `vite.config.ts`. `ALLOWED_ORIGINS` unset means localhost only.
7. **Annex handling** — codici carry a default annex in the URN; see
   `create_norma_visitata_from_data()`.
8. **Selenium is gone** — Playwright only.
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
   `parse_article_input` also takes a table suffix joined to its number, as
   Normattiva's URNs spell it (`615bis` → `615-bis`); a joined word outside the
   table (`5a`) is still refused.
24. **A missing article gets you a different one.** Normattiva answers a request
    for a nonexistent article with the act's Art. 1 and HTTP 200. The existence
    check in `create_norma_visitata_from_data` is what turns that into a 404
    ("Articolo N non presente in …", through `_error_response`); it fails open,
    so a Normattiva outage is never reported as "does not exist". A range where
    *some* articles exist keeps those and drops the rest. Normattiva numbers an
    act's annexes by position, not as the act names them (the c.p.a. is «Allegato 1»
    of d.lgs. 104/2010 and annex 2 on Normattiva), and that number stays the identity
    (owner, 11 October 2026); so when an annex the caller named does not hold the
    article, the refusal names the annex it looked in and adds where the article is
    («Articolo 29 non presente nell'allegato 1 di …: su Normattiva l'art. 29 si trova
    nell'allegato 2»), from the tree just read (`_where_else_in_tree`). Never for a
    code's default annex: another annex of a code is another code. Every code in
    `NORMATTIVA_URN_CODICI` whose URN ends in `:N` is bound to that annex (the c.c. and
    the c.p.a. at 2, the c.p., the c.p.c., the cod. nav. and the others at 1; since
    G-350 also the codice del turismo, the disp. att. c.p.p., the reg. navigazione and
    the codici penali militari), so an article missing there is «non presente» in the
    code, with no hint: the preleggi are annex 1 of the c.c.'s decree, their own row.
    The one exception is a row of the table that names more than one code (`CODE_ROWS_OF_SEVERAL_CODES` in
    `map.py`, read by `create_norma_visitata_from_data`): its other annex is the other
    code of the same row (the war code is annex 2 of r.d. 303/1941), so the refusal
    names the default annex and says where the article is. A request that asks
    for the dispositivo explicitly (`annex: ""`) is checked against the dispositivo alone,
    and its refusal reads «non presente nel testo di …» with the same hint: before, an
    article found only in an annex passed and came back as the act's art. 1.

30. **A path built from the URN is untrusted.** The guard on `/export_pdf` checks the
    host (`normattiva.it`), so everything after it is the caller's: `;../../x` used to
    become a directory part of the cached PDF's path, read from and copied to.
    `urn_to_filename` now returns a bare file name (`[A-Za-z0-9._-]`, never hidden), and
    `pdf_cache_path(urn, directory)` is the only way a cache path is built: a file
    directly inside `download/`. The name is read from the query of a `/uri-res/N2Ls`
    address alone (`_exported_urn`; any other path, a path parameter or a fragment is a 400):
    the browser reads the path too and resolves its `..`, so a name read from anywhere in
    the address let one act be cached, for everyone, under another's name. The query is
    read whole against a strict grammar (`_EXPORTABLE_URN`: one URN, one version marker)
    and the browser opens the address rebuilt from it (`export_url`). Each export
    downloads to a name of its own (`export-<uuid>.pdf`) and is moved to the cache name, so
    two exports at once never take each other's file. Any new path derived from a request
    goes through the same kind of gate; `tests/test_pdf_cache_path.py` lists the attempts.

31. **The window a page states is the only statement of which version came back.**
    `NormaVisitata.data_versione` is the date the caller *sent*, echoed (a request for the
    later text, `upcoming: true`, answers its first day instead). Normattiva
    answers a date after today with the current text and no sign (hence
    `reject_future_version_date`), and a date before an article existed with a page
    whose text reads "NON ANCORA ESISTENTE O VIGENTE". Read the window from the page
    (`normattiva_validity.py`), never from the request, and say nothing when the page
    cannot be read. A closed window is `historical` only when its last day is before
    today (Europe/Rome): a window ending today or later is the text in force, `current`
    with `valid_to` as stated, and `request_in_window` still judges the request against it.
    A repealed article keeps its update notes and their markers on the page and they are
    not its text (art. 183-bis c.p.c.): `abrogated` does not require an empty body. The
    whole-article and whole-act notices ("ARTICOLO ABROGATO", "PROVVEDIMENTO ABROGATO") are
    recognised by their words in any `ins-akn`: the portal does not always give them the
    `art_abrogato-akn` class (art. 155-ter c.c., every article of a repealed act).
    The window says which text was in force, not which discipline
    governs a fact: transitional provisions and retroactive rules are not on the page.
    `version` is read stripped and lower-cased wherever it is read
    (`is_historical_request`, `append_version_info`): a spelling read as a past
    text must also build the URN of the past text, or the text in force goes out
    labelled as a past one.
    `tests/test_normattiva_validity_live.py` (`-m live`) re-checks the extraction
    against the portal.

33. **A decision found is not a text found.** Italgiure answers many decisions with its own
    notice in place of the text, while personal data are being removed (counted on
    2026-10-04, archive-wide): "La sentenza richiesta è in fase di oscuramento" (10,789
    civil and 32,898 penal records), "in fase di valutazione oscuramento" (21,168 civil and
    17,175 penal), and rarely a stub such as "Oscuramento disposto Numero registro generale
    …" (85 characters). The rule is «at most 300 characters and mentions oscuramento»: such
    a text is never the court's. `decisions/italgiure.py` returns the decision with
    `testo == {}` and `testo_assente` `"oscuramento"`, `"valutazione_oscuramento"` or, for
    the stub, none, which travels in `attributi` and through the caches: the decision's tab reads why
    from it. A record with neither a text nor a notice (a missing `ocr`, a renamed field)
    comes back with `testo == {}`, no `testo_assente` and a logged warning: never present it
    as the source's anonymisation. The resolver keeps a decision without its text 24 hours
    (`decisions_pending`), never 30 days, and adds the notice `testo_non_disponibile`; one read
    from the archive's field instead of the PDF is kept the same way. Never
    pass a notice on as `motivazione`: the decision's tab would show it as the court's reasons and a
    note could anchor to it (the first reader did, with the second notice and the stub, and
    the caches kept them 30 days). The decision caches hold whole texts, with whatever
    personal data the source left: `sweep_decision_caches` deletes their expired entries at
    start and every six hours, since the filesystem cache deletes one only when its key is
    read again.
    The Cassazione's text is read from the court's original PDF (`decisions/pdf_text.py`, then
    `italgiure.py`): one more request per decision found, with a budget of its own (one try, 8 s,
    parse 6 s, the whole step 15 s of the resolver's 25) so a slow PDF falls back instead of
    failing the lookup. The PDF is refused when its filename or its first-page header names
    another decision (a filename without tags or a PDF without a header is accepted; a damaged
    PDF is never accepted); it must also be at least 70% of the field's length and share 10 of
    the field's first 20 words with its first 250 (`_plausible`). Otherwise (no filename, a PDF
    that cannot be fetched or parsed, or one that fails these checks) the field's text
    stands, `testo_origine` is `"archivio"`, a warning logs the reason, and the resolver adds the
    notice `testo_da_archivio` and keeps the decision 24 hours in `decisions_pending`, so the PDF
    is tried again soon; a text from the PDF is kept 30 days and its bytes under `decisions_pdf`
    (30 days). A suggestion (the penal next year) reads the record only and keeps nothing. The
    field's text is one line (45 of 45 sampled texts): `paragraphs` inserts blank lines
    before the headings, «P.Q.M.» and the numbered points and changes nothing else (a combined
    heading, «RITENUTO IN FATTO E CONSIDERATO IN DIRITTO», stays one; a point keeps the words
    it opens, so there is no break between «3.» and a «P.Q.M.» right after it), and line
    breaks are invisible to anchors (root rule 23), so a note never moves when the rule is
    refined. Italgiure's `ocr` already ends with the dispositivo that `ocrdis` repeats (36 of
    the 36 sampled texts that have one): `split_dispositivo` cuts it off, so a decision reads
    it once. The Corte costituzionale's open data break lines two ways, and `line_paragraphs`
    turns a line break into a paragraph break unless it is a typewriter wrap of at most 80
    characters (the texts before about 2001): the page draws a paragraph only between blank
    lines, so without it a block is one paragraph. Both add line breaks and nothing else.
    Whatever changes the shape of what a reader returns must raise the version in its cache
    key (`italgiure:v4:…`, `corte_cost:v2:…`, `curia:v1:…`, one answer per case: the list of its
    judgments; `ga:v1:…`, a measure's text by its key, and `ga:v1:search:…`, what a seat lists for a
    number and year, kept a day), or the entries cached before are served for up to 30 days. The `v2` keys (`v3` for the Cassazione since the PDF, 2026-10-05; `v4`: carriage returns normalised, 7 October) cover the readers of Tasks 7a to 7c, none of which had shipped,
    so Task 7c raised no version of its own.
    The characters of a decision's text are to be frozen like an article's (root rule 23): the readers
    may add or move `\n` and move a boundary between blocks, never change another character, and a
    cache version bump is for shape only. `tests/test_decisions_text_frozen.py` (synthetic PDFs
    and records in CI; real ones in the `_local` twin) pins the projection (blocks stripped,
    concatenated, `\n` removed) as a SHA-256 and a length in `fixtures/decisions/frozen_projections.json`.
    The CGUE reader is in it too (`curia_synthetic_*`, documents written for the test; real
    judgments as `private/curia_<CELEX>.xhtml` or `.html` in the `_local` twin). It keeps the source's
    characters, U+2011 included; it drops the footnote calls and the procedure-language note (which
    becomes `lingua_processuale`; any other footnote stays, at the end), the former format's keywords
    and summary, and the General Court's closing index. `tests/test_decisions_curia_live.py` (`-m live`) re-reads three real judgments.
    The administrative courts' reader is in it too (`ga_synthetic_document`; real documents as
    `private/ga_<key>.xml`): each `h:div` of the court's XML is a line, a div inside a div is read
    once, ASCII whitespace runs become one space; it leaves out the metadata block and the German
    twins (`…Ted`), and reads the bytes in the encoding the document declares. Its search never
    drops a result row in silence: a row it cannot read, fewer rows than the portal's count, a
    seat the form does not offer or an answer for another seat is `fonte_non_raggiungibile`.
    The freeze binds now that notes and highlights on decisions are stored (PR 4): a change to a
    reader that moves the projection's hash is a bug in the reader, never a reason to re-record the
    golden. The web app reads the same projection (`decisionProjection` in
    `apps/web/src/utils/decisionRender.ts`) and its `decisionRender.test.ts` checks the rendered
    text against it.
