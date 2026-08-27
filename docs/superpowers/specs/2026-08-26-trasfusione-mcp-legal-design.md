# Transfusion from mcp-legal-it — Design

**Date:** 2026-08-26
**Status:** Approved by owner (chat); scope confirmed, licence decided, citation verification dropped
**Branch:** `feature/mcp-legal-transfusion` (cut from `main`, vanilla — not MERL-T)
**Round:** 1 of the mcp-legal-it → VisuaLex transfusion

## Context

`mcp-legal-it` began as a fork of `visualex_api` and has since diverged and improved.
This round moves back the improvements that are worth having, and — this turned out to
matter more — **declines the ones that measurement showed to be regressions**.

The two products optimise for different consumers. `mcp-legal-it` feeds an LLM through
MCP: text shape is irrelevant, one desktop user, no persisted user annotations.
VisuaLex is a multi-user web product where a lawyer *reads* the text on screen and
*annotates* it. Several things that are improvements in the first are defects in the
second. The design below is the result of taking that seriously rather than porting.

## Method

Recon over both repositories (8 parallel readers, 238 tool calls), then two live
measurements that changed the conclusions. Everything asserted below was measured on
this machine on 2026-08-26, not inferred.

## Baseline (recorded before any change)

| Gate | Command | Result |
|---|---|---|
| Python suite | `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q` | **169 passed** in 0.57s |
| Interpreter | that venv | Python 3.14.2 |
| Frontend deps | `frontend/node_modules` | installed in the worktree |

The interpreter must be named in every command: with the ambient homebrew `python3`
the same suite is 10 failed / 159 passed, because `quart` is not importable there.

## The finding that reshaped the round

The headline candidate was **AKN-first**: replace Normattiva HTML scraping with the
official Akoma Ntoso XML export (`caricaAKN`). `mcp-legal-it` measured 158 HTTP
requests → 1 and 16.8s → 0.45s on whole-act retrieval. Two measurements killed it as a
*text* source.

### 1. Normattiva's AKN export transliterates every accent

Measured directly in the XML:

```
grep -o "attività\|attivita'" legge_241_1990.xml   →   50 × "attivita'",  0 × "attività"
grep -o " è \| e' "          legge_241_1990.xml   →  102 × " e' ",       0 × " è "
grep -o "responsabilità\|responsabilita'" codice_civile.xml → 280 × "responsabilita'"
```

The AKN text of art. 1 L. 241/1990 reads *"L'attivita' amministrativa … ed e' retta da
criteri di economicita', di efficacia, di imparzialita'"*. The HTML rendering reads
*"L'attività amministrativa … ed è retta da criteri di economicità, di efficacia, di
imparzialità"*. This is a property of the source, not of the parser, and it affects
every article of every act.

For a product whose purpose is presenting legal text faithfully to a lawyer, this is a
regression on the most visible dimension there is. Reversing the transliteration
automatically is not safe: Italian uses a genuine word-final apostrophe (`po'`, `da'`,
`sta'`, `di'`, `va'`), so a blind `vocale + '` → `vocale accentata` rule corrupts real
words.

### 2. Changing `article_text` at all silently destroys existing highlights and notes

Highlights and anchored notes are pinned by `(startOffset, text)` where `startOffset`
counts characters in a plain-text projection of `article_text` in which **only `\n` is
invisible**. At render time `useArticleMarkers.ts:59-73` slices the raw text at that
offset and requires a **case-insensitive exact string equality** with the stored text;
on mismatch it does a bare `return` — the marker vanishes with no log, no toast, no
visual difference from "you never made one".

The one fallback (global regex, `useArticleMarkers.ts:134-147`) is gated on the
*absence* of an offset, and `Highlight.startOffset` is a non-null Prisma column that
`highlightApiToStore` always sets — so it can never fire for a record loaded from the
backend. Annotations have no fallback at all. No schema field records the text shape,
so nothing can even detect that a re-serialisation happened.

Measured divergence, AKN vs the current HTML extractor, 19 articles across 5 acts:

```
identici byte-per-byte : 0/19
identici a meno di whitespace : 0/19
similarità per parole : min 0.783   mediana 0.939   max 0.957
```

Concretely: AKN prefixes `### Art. 3. (Motivazione del provvedimento)` where the HTML
emits `Art. 3\n(( (Motivazione del provvedimento) ))`. That header alone shifts every
offset in the article by ~24 characters, which means **100% of the highlights and
anchored notes on every Normattiva article disappear from the text body**, while still
being listed in the side panel. Silently.

### Consequence

**AKN is not the article-text source. It is a structure and fallback source.**
The reading text keeps coming from the HTML path, byte-for-byte unchanged. This is the
inverse of `mcp-legal-it`'s design, and it is correct for this product.

What AKN is still worth having for:

- **an authoritative article index** — the list of article keys of an act, correctly
  spelled (`2-bis`, never `2 bis`), in 2 HTTP requests, cached;
- **a second, independent source** for when Normattiva's HTML changes shape — which
  CLAUDE.md names as this codebase's primary fragility. A transliterated article beats
  an error page;
- `normalize_article_key` — a pure function that closes gotcha 9 with no network at all.

Cost, measured: parse is cheap (10.6 MB c.c. → **241 ms**, whole Costituzione → 7 ms);
the download is what costs (c.c. cold ≈ 4.8 s for 10.6 MB). Retained memory per parsed
act is small (c.c. = 1.86 MB of text), and storing **only the index** — which is what
this design does — cuts that to ~40 KB.

## The correctness bug this round actually fixes

Measured on live Normattiva through VisuaLex's own scraper:

```
c.c. art. 99999 (inesistente) → 592 char: "Art. 1  È approvato il testo del Codice civile, …"
c.c. art. 7000  (inesistente) → 592 char: "Art. 1  È approvato il testo del Codice civile, …"
c.c. art. 2-bis (inesistente) → 592 char: "Art. 1  È approvato il testo del Codice civile, …"
```

Asking for an article that does not exist returns **Art. 1 of the enacting royal
decree, presented as if it were the answer**. No error, no warning. A lawyer citing
from that screen cites the wrong thing. Fixing this needs no AKN: `get_tree` already
enumerates the real articles and is already cached — the request just has to be checked
against it. This is the highest-value item in the round.

## Goals

1. Resolve act names the way a lawyer writes them — "statuto dei lavoratori",
   "legge fornero", "TUSL", "disp. att. c.p.c.", "del D.Lgs. 231/2001".
2. Never answer a request for a non-existent article with a different article.
3. Put a machine-checked safety net under the scrapers: an egress allowlist, offline
   fixtures, and CI that actually fails.
4. Make Brocardi extraction stop losing data to selector fragility, and surface the
   sections that are missing.
5. Keep every stored highlight and note exactly where it is.

## Non-goals

- Replacing the reading text with AKN (see above).
- Citation verification — the owner dropped it from this round.
- New external sources (Cassazione, Corte cost., Gazzetta, CGUE, TAR/CdS, GPDP,
  CeRDEF, DDL). Separate product decision.
- Collapsing the two Quart controllers into one (see Decision D3).
- Any Prisma schema change.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Licence: MIT, relicensed by the owner.** Ported files carry no Apache header; one provenance line goes in `README.md`. | Owner holds copyright on both repos and chose this explicitly. |
| D2 | **AKN is a structure/fallback source, never the display text.** | Accent transliteration + anchor destruction, both measured. |
| D3 | **Shared modules, not duplicated routes.** Everything lands in `visualex_api/tools/` and `visualex_api/services/`, so both controllers inherit it. Only root `app.py` (the one the frontend and `start.sh` actually use) gets handler-level changes; `visualex_api/app.py` is left alone. | Avoids writing every change twice and avoids a risky deletion; the twin already has 6 divergences and is out of scope. |
| D4 | **Table merge is additive.** Every shared key has an identical value in both repos (verified programmatically, zero conflicts), so `A ∪ B` is safe. B-only keys are preserved: 2 in `NORMATTIVA_URN_CODICI`, 1 in `BROCARDI_CODICI`, the whole `NORMATTIVA` table, and 43 preset aliases. The 3 casing collisions in `NORMATTIVA_SEARCH` keep **both** spellings. | A wholesale replacement would silently delete working resolutions. |
| D5 | **`jobs act` keeps VisuaLex's meaning** (d.lgs. 81/2015) — it is pinned by an existing test and is current product behaviour. `jobs act tutele crescenti` is added for d.lgs. 23/2015. | Both decrees belong to the Jobs Act package; neither owns the name. Changing existing behaviour needs a reason, and there is none. |
| D6 | **`nuovo codice appalti` and `codice ambiente` keep the codice-name shape.** | `generate_urn` keys the allegato off the codice name; resolving to the underlying decree bypasses it. |
| D7 | **New Python dependency: `lxml` only.** No `httpx` — the AKN fetch goes through the existing `ThrottledHttpClient` (aiohttp), which gives it the throttle, retry, backoff and the circuit breaker for free. | Verified: `lxml 6.1.2` ships a `cp314` wheel, so `deploy.sh` step 2 installs it without a compiler. |
| D8 | **XML parsing is hardened**: `resolve_entities=False`, `no_network=True`, no `huge_tree`. | `recover=True, huge_tree=True` with default entity resolution is an XXE / billion-laughs surface. |
| D9 | **`akn_hits.json` is not ported.** | A per-key log of which laws were consulted, unpartitioned in a shared directory, is professional-secrecy-adjacent on a multi-user server. It existed for a pre-warm feature that is not in scope. |
| D10 | **The AKN cache stores the index only** (title, article keys, order, structure), never article texts, keyed `(codiceRedaz, dataGU, dataVigenza)` with in-flight de-duplication. | Bounds memory and disk; removes the "4 MB per act per day, forever" growth of the original. |
| D11 | **`get_tree` stays the article enumerator.** AKN cross-checks it; it does not replace it. | Two enumerations that disagree would reproduce gotcha 9 server-side, where no tolerant lookup exists. |
| D12 | **Brocardi `Dispositivo` is not extracted.** `Glossario` is. `RelatedArticles` — already emitted by the backend and typed in TS but rendered nowhere — gets rendered. | Brocardi's *dispositivo* is the article text, which the reading surface already shows from Normattiva; showing it twice reads as a bug. |
| D13 | **CI config goes in `pytest.ini`, not `pyproject.toml`.** `pip-audit` runs against `requirements.txt`. | A `[project]` table would change how the app installs, and `deploy.sh` installs with `pip install -r requirements.txt`. |

## Detailed design

### WS1 — Act-name resolver

New `visualex_api/tools/act_resolver.py` holding the resolution logic; the data tables
merge into the existing `visualex_api/tools/map.py`.

Ported tables: `ATTI_NOTI` (63 aliases: GDPR, DORA, AI Act, NIS2, TUB/TUF/TUIR, the EU
treaties) and `ATTI_DENOMINATI` (200 aliases over 80 acts, built from a reviewable
`_ATTI_DENOMINATI_SPEC` list of `(tipo_atto, data, numero_atto, [alias…])` rows), plus
the 22 new `NORMATTIVA_SEARCH` keys and `_URN_CODICI_LOWER`.

Ported functions: `codice_urn`, `resolve_atto`, `strip_leading_particles`,
`known_act_names`, and the private `_normalize_key` / `_strip_leading_words` /
`_candidate_keys` / `_lookup_key` chain. `resolve_atto` never guesses: an unrecognised
name returns `None` so the caller can report it rather than cite the wrong act.

`mcp-legal-it`'s one-argument `normalize_act_type` is **not** ported under that name —
VisuaLex already has an incompatible three-argument `text_op.normalize_act_type`. The
ported one lands as a private `_normalize_search_type`.

Integration seams, both additive and both after the existing exact-match paths:
- `alias_resolver.resolve_alias` — chain `resolve_atto` when the YAML has no exact key;
- `nl_parser._identify_act_type` — chain `resolve_atto` before the substring scan.

Near-miss suggestions (`difflib.get_close_matches` over `known_act_names()`, cutoff
0.7) ride along so "legge fallimentre" can answer "forse cercavi: legge fallimentare".

**Two latent bugs are fixed here** because they are in the files being touched:
- `text_op.normalize_act_type:224` does `.replace(" ", "")` on the lookup key while the
  tables' keys contain spaces — 62 of 111 `NORMATTIVA` keys are unreachable today
  (`normalize_act_type("cod. civ.")` misses). `generate_urn` compensates with its own
  `.replace(' ', '.')`, so the fix must not double-apply.
- `extract_codice_details` lowercases the lookup but 6 `NORMATTIVA_URN_CODICI` keys
  carry capitals, so `codice del Terzo settore` resolves to nothing. Same for the
  case-sensitive `in NORMATTIVA_URN_CODICI` tests at `urngenerator.py:111`,
  `app.py:416` and `app.py:780`.

Guard: `citation_linker.py:22-30` rebuilds three regexes from `NORMATTIVA_SEARCH` keys
at import, so adding 22 keys widens the alternation by ~20%. `tests/test_citation_linker.py`
is the gate and must be run against the merged table before the task closes.

### WS2 — Article existence check

`create_norma_visitata_from_data` already calls `get_tree` for ranges and for the smart
annex lookup, and the result is cached. Before building a `NormaVisitata`, the requested
article is checked against the tree's article numbers, compared through
`normalize_article_key` on both sides. A miss returns a structured error —
`{"error": "Articolo N non presente in <atto>", "norma_data": {…}}` — instead of
scraping and returning Art. 1.

The check is skipped (fail-open) when the tree is unavailable, returns an error string,
or is empty: a Normattiva outage must not turn into "article does not exist".

### WS3 — AKN as structure and fallback

- `visualex_api/services/akn_parser.py` — the ported pure parser, hardened per D8,
  plus `normalize_article_key`. No network, fully testable against fixtures.
- `visualex_api/services/akn_fetch.py` — the two-request flow (landing page for the
  session + export params, then `caricaAKN`) on `http_client` with `source="normattiva"`,
  storing only the index (D10), with an `asyncio` in-flight registry keyed on
  `(codiceRedaz, dataGU, dataVigenza)` so N concurrent cold requests download once.
  Parsing runs in `asyncio.to_thread` (gotcha 2). Failures log with structlog and
  context (gotcha 18) — never `print` to stderr, never a bare silent `return None`.
- Wired in two places only: as a **cross-check** for `get_tree`, and as the **text
  fallback** when HTML extraction fails. Governed by `AKN_ENABLED` (default `true`),
  read at call time.

The AKN text fallback is the one place a differently-shaped `article_text` can reach the
UI. It fires only when the alternative is an error, and the response carries
`"source": "normattiva-akn"` so the surface can say where the text came from.

### WS4 — Brocardi

The recon inverted this one too: `mcp-legal-it`'s Brocardi client is a fork of
VisuaLex's and is **worse** in six respects (no throttling, no HTML cache, footnote
pattern 4 dropped, `tipo` dropped, `numero_paragrafo` dropped, no per-section error
isolation). So this is not a port — it is five bug fixes plus one new section.

Fixes, all with a `mcp-legal-it` counterpart to copy from:
1. `_extract_position` uses a hardcoded `[17:]` slice to strip `"Brocardi.it >"` →
   anchored regex.
2. The corpo selector is an exact four-class string match; **one class added on
   brocardi.it and every section silently returns empty** → substring predicate.
3. Cross-reference `tipo_atto` tests `/codice-procedura-civile/` and
   `/codice-procedura-penale/`; the real paths are `/codice-di-procedura-civile/` and
   `/codice-di-procedura-penale/` — two dead branches → fixed, plus consumo and privacy.
4. `_find_article_link` resolves relative hrefs against the bare domain instead of the
   resolved page URL, so `libro-quarto/titolo-ix/art2043.html` resolves wrong.
5. The sub-page crawl has no same-domain filter and no exclusion of the base page — it
   can re-fetch the index or follow off-site links.
6. Footnote `tipo` emits `'nota_dispositivo'`, which is not in the TS union
   `'nota' | 'riferimento' | 'footnote'`.

New: `Glossario` — links to Brocardi's legal dictionary for terms appearing in the
article, `{termine, url, dizionario_id}`. Rendered as a new collapsible section in
`BrocardiDisplay.tsx`, added to the `hasContent` gate (omitting it there is a silent
failure mode on sparse articles), typed in `types/index.ts`, and whitelisted in **all
three** `brocardi_info` wire literals in `app.py` (227, 722, 793) — a key missing from
any one of them never reaches the frontend.

`RelatedArticles` gets its renderer and its `hasContent` entry.

`BrocardiSelectors` in `selectors.py` is instantiated and never read, and its values are
already stale. It is deleted.

### WS5 — Safety net

- `visualex_api/tools/egress.py` — `ALLOWED_HOSTS` (www.normattiva.it, eur-lex.europa.eu,
  brocardi.it, www.brocardi.it) and `NON_NETWORK_HOSTS` (localhost from the CORS
  defaults; `www.normattiva.it.evil.com`, which appears only inside the comment
  explaining the SSRF guard). `is_allowed(url)` is **wired into
  `ThrottledHttpClient.request`**, so it is an enforcement point and not an ornament —
  this is where it differs from `mcp-legal-it`, where the same function is never called.
- `tests/test_egress_allowlist.py` — walks `visualex_api/` **and** the root `app.py`
  (which `start.sh` actually launches and which the package walk would miss), with
  `ROOT = parents[1]` for VisuaLex's flat `tests/` layout.
- Offline fixtures under `tests/fixtures/`, covering the scenario matrix rather than the
  happy path: the four Normattiva extractor branches (`art-comma-div-akn`,
  `art-just-text-akn`, `attachment-just-text`, fallback) plus the abrogated-article case;
  a Brocardi article page; AKN flat and component structures. Only the small AKN
  fixtures are committed (L. 241, Costituzione, D.Lgs. 231 ≈ 0.85 MB); the component
  structure gets a trimmed fixture generated from the codice penale rather than 14 MB of
  codici.
- `pytest.ini` with `testpaths`, `asyncio_mode = auto` and a `live` marker excluded by
  default.
- `.github/workflows/ci.yml` — Python tests on 3.12 and 3.14, frontend
  `npm run build` + `npm run test` + `npm run lint`, backend `npm run test`.
  `.github/workflows/security-audit.yml` — `pip-audit` against `requirements.txt` plus
  `npm audit`, on PRs and weekly, with the SHA-pinned action.

### WS6 — TLS verification (flagged, in scope)

`services/http_client.py:44` builds `aiohttp.TCPConnector(ssl=False)`: **certificate
verification is disabled for every request the server makes**, and
`treextractor.py:91-94` opens its own session the same way. Against a document that
promises an auditor where the data goes, unauthenticated transport to those same hosts
is not defensible (OWASP A02/A07). Verification is turned on and the three sources are
checked live; if a source genuinely presents a broken chain, that is recorded per-host
rather than disabled globally.

## Bugs found during recon, fixed because they are in the files being touched

| Bug | Location | Effect today |
|---|---|---|
| `logger` is undefined | `normattiva_scraper.py:145,173,200,227` (module defines `log`) | Every extraction error path raises `NameError` instead of the real cause; the user sees "name 'logger' is not defined" |
| `parse_article_input`'s error dict is not checked | root `app.py:386` | A malformed `article` iterates the dict's **keys**, producing a URN `~arterror` and a confusing scrape failure instead of a 400 |
| No input validation | root `app.py:344` | Missing `act_type` → generic 500 |
| Module-level side effect | `norma.py:161-162` | Importing the models module builds a `Norma` and `print()`s to stdout |
| Offset/text asymmetry | `SelectionPopup.tsx:54` vs `:81` | The selected text is `.trim()`ed, the offset is not — a selection starting on whitespace stores an anchor that fails against **unchanged** text, so the highlight never appears |

## Deliberately left alone (recorded, not fixed)

- Root `app.py` has no circuit breaker, so the live server has none. Wiring it needs a
  `get_scraper_for_norma` signature change across three call sites.
- Rate limiting is keyed on the client-controllable `X-Forwarded-For` with no eviction.
- `treextractor` bypasses `http_client` entirely and spawns a Chromium per EUR-Lex call.
- `NormaVisitata.__hash__` omits `allegato` while `__eq__` includes it.
- `generate_urn` drops the third segment of `1-bis-1` and raises `IndexError` on `1-`.
- The two controllers keep diverging.

## Verification

Per task: `pytest` on the touched area, then the full suite. Frontend work adds
`npm run test` and `npm run build` (`tsc -b` — a bare `tsc --noEmit` reports a false
green). Before the branch closes: a real browser pass on the reading surface with an
existing highlight and an existing note on a Normattiva article, confirming both still
render — that is the check that the central design decision held.
