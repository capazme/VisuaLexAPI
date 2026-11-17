# EU recitals (considerando) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** A lawyer types «considerando 26 GDPR» or opens an EU act's index and reads, highlights, annotates and
files a recital, which is never mistaken for an article.

**Architecture:** The Python API settles and freezes the recital text, gives a recital its identity
(`celex:…~rct26`) and reads recital citations. The ingress opens `/fetch_recitals` to the browser. A recital in a
dossier is a `norm` entry with one more field, `considerando` (G-538), and every part of the server, the MCP and
the web that reads a `norm` entry learns the field, each with a test. The web reads recitals into the act's
block, the index, the marks and the dossier.

**Tech Stack:** Python 3 / Quart / BeautifulSoup (services/visualex); Express + Prisma + zod (apps/server);
the MCP server (apps/mcp); React 19 + Vite + TypeScript + Vitest (apps/web); Caddy (infra/ingress).

**Spec:** `docs/superpowers/specs/2026-11-17-eu-recitals-design.md`. Read it with this plan: § numbers below are
the spec's.

**Decided:** the spec is approved (G-536). The server-side pieces (PR 1a, 1b, 2, 3) run now; PR 4a and 4b sit
where the web owner places them in the web plan (G-537). The dossier entry is a `norma` entry with `considerando`,
no migration (G-538). The line of §5.2 stands as proposed (G-539). The citation of EU acts before 2015 is fixed
in a pull request of its own, outside this plan (G-540).

## Global Constraints

- Six pull requests into `develop`, in the order 1a → 1b → 2 → 3 → 4a → 4b (1a and 1b may swap). Each merges
  on its own; branch names `feat/recitals-<piece>`.
- **Tasks 12–18 are `apps/web`: the other owner's area.** His side builds them or approves them before merge.
  Task 7 touches one line of `apps/web/vite.config.ts`, which he approves too.
- **Shared files.** `infra/ingress/Caddyfile` (Task 7) and the rule 23 sentence of the root `CLAUDE.md` (Task 3)
  are reserved in the owners' coordination register before the branch touches them. **No migration** (G-538):
  the Prisma schema does not change.
- **Identity:** `celex:<CELEX>~rct<N>` (e.g. `celex:32016R0679~rct26`). Marks use `normaKey` = identity and
  `articleId` = `""`.
- **Labels:**
  - citation «considerando 26, reg. (UE) 2016/679»;
  - short «considerando 26 reg. (UE) 2016/679»;
  - unit «Considerando 26».

  «considerando» is always written out; «art.» never appears on a recital.
- **Field names:** `norma_data.considerando` (the number, digits, no leading zero); `/parse_query`
  `parsed.recital` and top-level `refusal` (`"recital_not_eu"` | `"recital_with_article"`); web
  `ParsedCitation.recital` and `.refusal`; a dossier entry `itemType: 'norm'` (server) / `type: 'norma'` (web)
  whose content has the key `considerando` and no `numero_articolo`. The key decides: a content with it is a
  recital, whatever its value.
- **Copy (Italian, exact):**
  - «Considerando: non è una disposizione vincolante, orienta l'interpretazione degli articoli.»
  - «Solo i regolamenti e le direttive dell'Unione hanno considerando numerati.»
  - «Cerca un articolo o un considerando alla volta.»
  - «Non trovo considerando numerati nella pagina della Gazzetta ufficiale di questo atto.»
  - «Il reg. (UE) 2016/679 ha 173 considerando: il 200 non c'è.» (the act's short citation, the count, the
    missing numbers)
  - «Una voce resta un articolo o un considerando: aggiungila di nuovo.»
  - «I considerando non si possono ancora proporre nel Forum.»
  - «un considerando non si può ancora citare in un percorso»
  - «Il testo di un considerando non si legge ancora da qui: aprilo nel lettore di LexCraft.»
  - «Un considerando si aggiunge al dossier dal lettore di LexCraft, non da qui.»
- **Rule 23 (root `CLAUDE.md`).** After Task 15 merges (PR 4a) the recital text is frozen. A golden is never
  re-recorded to make a test pass.
- **Tests.** A failing test first. Locally, run only the tests of the task; CI runs the full suites. No bulk
  fetching from EUR-Lex: Task 2 makes the plan's only live request (Task 15 may make one more, for `#rct_N`).
- **The repository is public:** no private notes, infrastructure addresses, personal paths or names in code,
  commits or PR bodies.
- **Docs move with the code.** Each pull request updates its area's `CLAUDE.md` wherever it documents the
  behaviour the PR changes. The last task of each PR (3, 6, 7, 11, 15, 18) has a docs step; between them they cover:
  - the Python API's entries for `/fetch_recitals` and `/parse_query`;
  - the server's `norm` entry with `considerando`, and its readers;
  - the web's search, index, reader and dossier;
  - the MCP's tool list.

## Review Focus

1. **A recital's number dropped or misread on the way.** «GDPR» resolves only on the server, so the web's copy
   of the server reading must carry `recital`. Pinned in Task 13 (`citationFromServer` keeps `recital`).
2. **«Cons. St.» still opens the Consiglio di Stato** while «cons. 26» never does. Pinned in Task 6 (Python) and
   Task 13 (web).
3. **«Analizza documento» and «Confronta articoli» unchanged.** The batch answers a recital as not recognised,
   and `isSearchReady` is untouched. Pinned in Task 6 (batch) and Task 13 (`isSearchReady` cases unchanged).
4. **A part that reads a `norma` entry and was not taught `considerando`** shows the recital as an article
   (G-538's cost). The spec's §6.3 lists every part with its test; Task 10's and Task 18's last step greps for
   any part the table misses.
5. **A recital moved through every door** (export and import, share link, publication, trash, study import,
   suggestions, «Salva come dossier») stays a recital or is refused in words, never an article or the whole act.
   Pinned in Task 10 (server) and Task 16 (web).
6. **A recital and an article in one query** («art. 4 e considerando 26 GDPR») is refused and never opens art.
   4. Pinned in Task 5 (the rest keeps the article), Task 6 (`refusal`) and Task 15 (Enter does not call
   `actions.search`).

---

## PR 1a — API: the text settled and frozen (`services/visualex`)

### Task 1: Paragraph text without spaces of our own

**Files:**
- Modify: `services/visualex/visualex_api/services/eurlex_scraper.py` (`_strip_footnote_marks`,
  `_extract_recitals_modern`, `_extract_recitals_legacy`)
- Test: `services/visualex/tests/test_eurlex_recitals.py`

**Interfaces:**
- Produces: `_paragraph_text(p) -> str`, used by both extractors.
- Produces: the rules of §7.2.1.
  - A removed footnote call takes the whitespace before it.
  - Text nodes are joined with no separator, and a `<br>` counts as whitespace.
  - Runs of ASCII whitespace become one space.
  - The paragraph is trimmed of ASCII whitespace at its edges.
  - The NBSP is kept.

- [ ] **Step 1: Write the failing tests** (synthetic HTML in the test file, modern `div#rct_N` markup)

```python
def test_a_footnote_call_before_a_comma_leaves_no_space():
    # <p>… del Consiglio\xa0<a>(<span class="oj-note-tag">19</span>)</a>, compresi …</p>
    assert recitals[0]["text"] == "… del Consiglio, compresi …"

def test_a_footnote_call_before_a_word_leaves_one_space():
    # «Consiglio\xa0(18) ha come» → «Consiglio ha come»
    ...

def test_an_italic_before_a_comma_adds_no_space():
    # <p>l'<span class="oj-italic">acquis</span>, che</p> → «l'acquis, che»
    ...

def test_a_br_inside_a_paragraph_is_one_space():
    # <p>prima<br/>seconda</p> → «prima seconda»
    ...

def test_a_line_break_inside_a_paragraph_is_one_space():
    # <p>prima\n   seconda</p> → «prima seconda» (no \n)
    ...

def test_gdpr_recital_173_reads_consiglio_comma():
    assert "del Consiglio, compresi" in by_number(GDPR)["173"]
    assert "Consiglio , " not in by_number(GDPR)["173"]
```

- [ ] **Step 2: Run them and see them fail**
  - Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_eurlex_recitals.py -q)`
  - Expected: the five new tests FAIL; «Consiglio , compresi» shows in the diff.
- [ ] **Step 3: Implement** `_paragraph_text`. Use `"".join(p.strings)` after the calls are removed (each
  removed call also strips the trailing whitespace of the text node before it), then
  `re.sub(r"[ \t\r\n]+", " ", …)` and `.strip(" \t\r\n")`. Both extractors use it.
- [ ] **Step 4: Run the file again.** Expected: PASS, the old tests included.
- [ ] **Step 5: Run the archive's tests**, which consume the route.
  - Run: `(cd tools/archivio-normativo && ../../services/visualex/.venv/bin/python -m pytest tests/ -q)`
  - Expected: PASS.
- [ ] **Step 6: Commit** `fix(eurlex): recital text keeps the source's spacing (spec §7.2.1)`

### Task 2: Legacy continuation paragraphs, one more legacy act

**Files:**
- Create: `services/visualex/tests/fixtures/eurlex/<act>_oj_legacy_preamble_trimmed.html`: one legacy OJ act,
  captured once through CELLAR. Choose a pre-2014 directive whose preamble is numbered and long.
- Modify: `services/visualex/tests/fixtures/eurlex/README.md` (the capture: date, CELEX, CELLAR URL form,
  trimming)
- Modify: `services/visualex/visualex_api/services/eurlex_scraper.py` (`_extract_recitals_legacy`)
- Test: `services/visualex/tests/test_eurlex_recitals.py`

**Interfaces:**
- Produces: the rule of §7.2.3.
  - A paragraph without «(N)» between recitals N and N+1 joins recital N with `\n`, but only once N+1 arrives.
  - Paragraphs after the last recital stay out.
  - Empty paragraphs are ignored.
  - A «(k)» paragraph out of sequence is still skipped.

- [ ] **Step 1: Capture the fixture.** One request, through CELLAR, with `Accept-Language: it`. Trim it to
  `<title>` and the preamble, following the README's existing method. Record the capture in the README.
- [ ] **Step 2: Write the failing tests**

```python
def test_a_legacy_paragraph_without_a_number_joins_the_recital_before_it():
    # synthetic: «considerando quanto segue:», «(1) Primo.», «Seguito del primo.», «(2) Secondo.», «HANNO ADOTTATO»
    assert recitals == [{"number": "1", "text": "Primo.\nSeguito del primo."}, {"number": "2", "text": "Secondo."}]

def test_a_footnote_paragraph_out_of_sequence_is_still_skipped():
    ...

def test_paragraphs_after_the_last_recital_stay_out_without_an_enacting_formula():
    # synthetic: «(1) Primo.», «Articolo 1», «Testo dell'articolo.» and no «HANNO ADOTTATO»
    assert recitals == [{"number": "1", "text": "Primo."}]

def test_an_empty_paragraph_adds_no_newline():
    # «(1) Primo.», <p></p>, «(2) Secondo.» → recital 1 is «Primo.»
    ...

def test_the_new_legacy_fixture_reads_every_recital_in_sequence():
    numbers = [r["number"] for r in recitals_of(NEW_FIXTURE)]
    assert numbers == [str(n) for n in range(1, len(numbers) + 1)]
```

- [ ] **Step 3: Run them.** Expected: the first one FAILS (today the continuation paragraph is dropped).
- [ ] **Step 4: Implement.** In `_extract_recitals_legacy`, a non-empty paragraph that does not match
  `_LEGACY_RECITAL` goes into a buffer. When recital N+1 arrives, the buffer joins recital N with `\n`; at the end
  the buffer is dropped. It uses Task 1's `_paragraph_text`.
- [ ] **Step 5: Run the file.** Expected: PASS. Note in the PR body whether the captured act had continuation
  paragraphs.
- [ ] **Step 6: Commit** `fix(eurlex): a legacy recital keeps its later paragraphs (spec §7.2.3)`

### Task 3: The frozen tests, recitals and EU articles

**Files:**
- Create: `services/visualex/tests/test_recitals_text_frozen.py`
- Create: `services/visualex/tests/fixtures/eurlex/frozen_recitals.json`
- Create: `services/visualex/tests/test_eurlex_article_text_frozen.py`
- Create: `services/visualex/tests/fixtures/eurlex/frozen_eu_articles.json`
- Modify: `services/visualex/CLAUDE.md` (the `/fetch_recitals` entry: the contract and the freeze)

**Interfaces:**
- Produces: `projection(text: str) -> str` (`text.replace("\n", "")`) and `fingerprint(text) -> {"sha256",
  "length"}`, the shape of `test_decisions_text_frozen.py`.

- [ ] **Step 1: Write the tests.** The JSON maps `"<fixture>#<number>"` to `{sha256, length}`.
  - Recitals: every recital of `gdpr_oj_trimmed.html`, `eprivacy_oj_legacy.html` and Task 2's fixture.
  - `cellar_eprivacy_oj_legacy.html` must give the same fingerprints as `eprivacy_oj_legacy.html`.
  - Articles: the same map, keyed `"<fixture>#art<N>"`, for the GDPR's trimmed articles and every article of
    `eprivacy_oj_legacy.html`, read through the existing article extractor.
  - Each docstring states rule 23, the projection, «never the text», and that the recitals' freeze binds from
    PR 4a.
- [ ] **Step 2: Record the JSON once.** Use a throwaway script in the scratchpad, never kept, and run it after
  Tasks 1–2.
- [ ] **Step 3: Check that the tests catch a change.** Change one character in the extractor's output by hand;
  both tests FAIL. Revert.
  - Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_recitals_text_frozen.py tests/test_eurlex_article_text_frozen.py -q)`
  - Expected after the revert: PASS.
- [ ] **Step 4: Root `CLAUDE.md`, rule 23.** Reserve the file in the register, then add one sentence after the
  decisions' paragraph. It says that recital texts (`/fetch_recitals`) are held to the same contract, that the
  projection is the text without `\n`, that the guard is `test_recitals_text_frozen.py`, and that the freeze
  binds from PR 4a. It also names EU article text's new guard, `test_eurlex_article_text_frozen.py`.
- [ ] **Step 5: Commit** `test(eurlex): freeze recital and EU article text (spec §7.3)`, then open **PR 1a**.

---

## PR 1b — API: identity, labels, the search clause (`services/visualex`, `conventions/sources`)

### Task 4: Identity, citation and the golden `recitals` section

**Files:**
- Modify: `services/visualex/visualex_api/tools/sources.py` (`eu_identity`, new `cite_recital`)
- Modify: `conventions/sources/golden.json` (new top-level `recitals`)
- Modify: `conventions/sources/README.md` (the section's shape; the table of who reads it)
- Test: `services/visualex/tests/test_sources_golden.py`

**Interfaces:**
- Produces:
  - `eu_identity(tipo_atto, data, numero_atto, articolo=None, considerando=None) -> Optional[str]`, which writes
    `~rct<N>`; an article and a recital together raise `ValueError`;
  - `cite_recital(norm: Mapping) -> str`, which writes «considerando 26, reg. (UE) 2016/679» and «considerando
    26 e 27, …» for a list, «considerando 26-30, …» for a range.
- Produces: the golden section of spec §2.3. It has three cases (`gdpr-cons-26`, `nis2-cons-1`,
  `eprivacy-cons-2`), with `input`, `identity.act`, `identity.recital`, and `labels.citation/short/unit`, all
  `proposed`; `eprivacy-cons-2` has the identity only.

- [ ] **Step 1: Write the failing tests:** the identity of every `recitals` case equals `eu_identity(…,
  considerando=…)`; every citation equals `cite_recital(input)`; `eu_identity("regolamento ue", "2016", "679",
  "5", "26")` raises.
- [ ] **Step 2: Run** `(cd services/visualex && .venv/bin/python -m pytest tests/test_sources_golden.py -q)`.
  Expected: FAIL (no section, no function).
- [ ] **Step 3: Implement** both functions and write the section and the README.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run the other golden tests once to confirm they
  ignore the new section:
  - `npm --prefix apps/web run test -- --run src/utils/__tests__/sourcesGolden.test.ts`
  - `npm --prefix apps/server test -- tests/norms/sourcesGolden.test.ts`
  - `npm --prefix apps/mcp run build && npm --prefix apps/mcp test -- tests/sourcesGolden.test.ts`
  - MERL-T's `tests/unit/test_sources_golden.py`, in CI only (`services/merlt/CLAUDE.md`)

  Expected: PASS, unchanged.
- [ ] **Step 5: Commit** `feat(sources): a recital's identity and citation (spec §2)`

### Task 5: The recital clause

**Files:**
- Create: `services/visualex/visualex_api/tools/recital_clause.py`
- Test: `services/visualex/tests/test_recital_clause.py`

**Interfaces:**
- Produces: `split_recital_clause(text: str) -> tuple[Optional[str], str]`. It returns the recital spec (`"26"`,
  `"26,27"`, `"26-30"`) and the rest of the text, or `(None, text)`. It reads the forms of §3.1:
  - heads `considerando|cons\.?|consid\.`;
  - an optional `n\.|n°|nr\.`;
  - a number, which may be in brackets;
  - a list with `,`/`e`, or a range with `-`;
  - the clause anywhere in the text; it is removed with the «e» or comma just before it, and what is left is the
    rest;
  - connectors «del», «del regolamento», «della direttiva» and a comma, which are left to the act;
  - a head with no number after it is no clause.

  ASCII digits only, no leading zero, and at most `MAX_ARTICLES_PER_REQUEST` (150) numbers once a list or a range
  is expanded.
- Produces: `expand_recital_spec(spec: str) -> list[str]`, beside it.

- [ ] **Step 1: Write the failing tests.** One parametrised case per row of the spec's §3.1 table: the input,
  the expected spec, and the rest. Also:
  - «art. 4 e considerando 26 GDPR» gives `("26", "art. 4 GDPR")`;
  - `split_recital_clause("Cons. St., sez. VI, n. 2270/2019") == (None, …)`;
  - `split_recital_clause("considerando il contratto")` is `(None, …)`;
  - `split_recital_clause("considerando 026 GDPR")` is `(None, …)`;
  - `split_recital_clause("considerando 26")` is `("26", "")`;
  - `expand_recital_spec("26-28") == ["26", "27", "28"]`, and a range of more than 150 is `(None, …)` at the
    split.
- [ ] **Step 2: Run** `(cd services/visualex && .venv/bin/python -m pytest tests/test_recital_clause.py -q)`.
  Expected: FAIL (no module).
- [ ] **Step 3: Implement** the function as a leaf module: no import from the parsers.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(nl_parser): read a recital clause (spec §3.1)`

### Task 6: `read_norm_query`, `/parse_query` and the batch

**Files:**
- Modify: `services/visualex/visualex_api/tools/norm_query.py` (`read_norm_query`)
- Modify: `services/visualex/app.py` (`parse_query`, `parse_query_batch`)
- Test: `services/visualex/tests/test_nl_parser.py`, `test_nl_parser_convention.py`,
  `test_parse_query_batch.py`, `test_decision_citation.py`

**Interfaces:**
- Consumes: `split_recital_clause` (Task 5), `cite_recital` (Task 4).
- Produces:
  - `read_norm_query` adds `recital` to the parameters, or `refusal`, by the rules of §3.2;
  - `/parse_query` answers `recognized: true`, `parsed.recital` and, when there is one, a top-level `refusal`.
    Its `display` is `cite_recital(…)` when ready, «considerando 26» when incomplete, and absent when refused;
  - `/parse_query_batch` answers a reading with `recital` or `refusal` as not recognised.

- [ ] **Step 1: Write the failing tests:**
  - «considerando 26 GDPR» (the alias path) and «cons. 26 reg. 2016/679» (the parser path) give `act_type
    "regolamento ue"`, `act_number "679"`, `recital "26"` and no `article`;
  - «considerando 3 l. 241/1990» gives `refusal "recital_not_eu"` with `recognized: true`;
  - «art. 4 e considerando 26 GDPR» gives `refusal "recital_with_article"`;
  - «considerando 26» gives `recognized: true`, `parsed: {recital: "26"}`, `identifies_act: false` and `display
    "considerando 26"` (today it reads as nothing);
  - `test_nl_parser_convention.py` reads every `recitals` case's citation and short label back to its `input`;
  - the batch answers «considerando 26 GDPR» with `recognized: false`;
  - `/parse_decision` answers null for «cons. 26 GDPR», and a decision for «Cons. St., sez. VI, n. 2270/2019».
- [ ] **Step 2: Run them.** Expected: FAIL.
  - Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_nl_parser.py tests/test_nl_parser_convention.py tests/test_parse_query_batch.py tests/test_decision_citation.py -q)`
- [ ] **Step 3: Implement.** `read_norm_query` calls `split_recital_clause` first and reads the rest with
  today's two paths. The refusal is decided from the act type the rest resolves to, and from an `article` in it.
- [ ] **Step 4: Run** the same command. Expected: PASS. Update the `/parse_query` entry of
  `services/visualex/CLAUDE.md`.
- [ ] **Step 5: Commit** `feat(parse_query): read recital citations (spec §3.2)`, then open **PR 1b**.

---

## PR 2 — The route reachable (`infra/ingress`, one line of `apps/web`)

### Task 7: `/fetch_recitals` through Vite and the ingress

**Files:**
- Modify: `infra/ingress/Caddyfile` (`@legal`: add `/fetch_recitals*`)
- Modify: `apps/web/vite.config.ts` (proxy: `'/fetch_recitals': PYTHON_API`), **web owner approves**
- Test: `infra/ingress/paths.test.mjs`, `apps/web/src/services/__tests__/legalFetch.guard.test.ts` (both read
  the lists: no new case unless they fail)

- [ ] **Step 1: Reserve `infra/` in the owners' coordination register** (ask the orchestrating session).
- [ ] **Step 2: Add the Vite line only**, then run `node --test infra/ingress/paths.test.mjs`. Expected: FAIL,
  since the lists differ.
- [ ] **Step 3: Add the Caddy path.** Run `node --test infra/ingress/paths.test.mjs` and `npm --prefix apps/web
  run test -- --run src/services/__tests__/legalFetch.guard.test.ts`. Expected: PASS.
- [ ] **Step 4: Docs.** Add `/fetch_recitals` to the route lists the area docs keep: `services/visualex/CLAUDE.md`
  (routed by the ingress and Vite) and the web's gotcha 30 if it lists routes.
- [ ] **Step 5: Commit** `feat(ingress): /fetch_recitals behind the login (spec §8)`, then open **PR 2** and ask
  the web owner to approve the Vite line.

---

## PR 3 — Server and MCP (`apps/server`, `apps/mcp` tests, `conventions/sources`) — no migration (G-538)

A recital is a `norm` entry whose content has the key `considerando` (spec §6.2). Nothing in the Prisma schema
changes. The whole PR is the server's rows of the spec's §6.3 table, each with its test.

### Task 8: The entry's shape, the identity and labels on the server

**Files:**
- Create: `conventions/sources/recital-entries.json` (the cases of spec §2.4: input → kept entry or Italian
  reason), and its row in `conventions/sources/README.md`
- Create: `apps/server/src/schemas/recitalEntry.ts`
- Create: `apps/server/src/norms/recital.ts`
- Test: `apps/server/tests/schemas/recitalEntry.test.ts`, `apps/server/tests/norms/sourcesGolden.test.ts`

**Interfaces:**
- Produces, in `schemas/recitalEntry.ts`:
  - `interface RecitalEntry { tipo_atto: string; numero_atto: string; data: string; considerando: string }`;
  - `isRecitalContent(raw: unknown): boolean`: an object with an own key `considerando`, read after
    `_dossierMeta` is set aside. The key decides, whatever its value (spec §6.2);
  - `rebuildRecitalEntry(raw: unknown): { ok: true; entry: RecitalEntry; star?: { important: boolean } } | { ok:
    false; reason: string }`, with the fixture's Italian reasons. `_dossierMeta` is accepted only as `{ important:
    boolean }`.
- Produces, in `norms/recital.ts`: `recitalIdentity(e: RecitalEntry): string`, `citeRecital(e): string`,
  `shortRecital(e): string` and `recitalUnitLabel(e): string`. The act half comes from the existing `citeAct`;
  the CELEX from a helper of the same file, `actCelex(e): string`.

- [ ] **Step 1: Write the failing tests.**
  - Every case of `recital-entries.json` is kept or refused with its reason by `rebuildRecitalEntry`.
  - `isRecitalContent({considerando: null})` and `isRecitalContent({considerando: '', _dossierMeta: {important:
    true}})` are true; `isRecitalContent({numero_articolo: '5'})` is false.
  - Every `recitals` case of `golden.json` has `recitalIdentity`, `citeRecital`, `shortRecital` and
    `recitalUnitLabel` equal to its values (the `norms` block of the test is unchanged).
- [ ] **Step 2: Run** `npm --prefix apps/server test -- tests/schemas/recitalEntry.test.ts
  tests/norms/sourcesGolden.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema and the functions.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): a recital entry's shape and labels (spec §2.4)`

### Task 9: The routes and the stored citation

**Files:**
- Modify: `apps/server/src/norms/citation.ts` (`storedAct`, `citeStoredNorm`)
- Modify: `apps/server/src/controllers/dossierController.ts` (`addDossierItem`, `updateDossierItem`)
- Test: `apps/server/tests/norms/citation.test.ts`, `apps/server/tests/dossiers.recital.test.ts` (new),
  `apps/server/tests/dossierNotes.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces:
  - `citeStoredNorm('norm', content)` is `citeRecital(…)` for a content that `rebuildRecitalEntry` keeps, and
    null for one with both `considerando` and `numero_articolo`. `citeStoredItem` and `serializeItem.citation`
    follow; `citeStoredAct` is unchanged;
  - `POST /dossiers/:id/items` with `itemType: 'norm'` and a recital content stores `rebuildRecitalEntry`'s entry
    (with the star, if sent) and `title = citeRecital(entry)`; a refused one is 400 with the reason;
  - `PUT /dossiers/:id/items/:itemId` on a recital entry, or carrying a recital content, does the same. A PUT
    that would turn an article into a recital, or a recital into an article, is 400: «Una voce resta un articolo
    o un considerando: aggiungila di nuovo.» A `title` sent alone on a recital entry is dropped.

- [ ] **Step 1: Write the failing tests.**
  - `citation.test.ts`: the stored citation of `{tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016',
    considerando: '26'}` is «considerando 26, reg. (UE) 2016/679», and its act citation «reg. (UE) 2016/679».
  - `dossiers.recital.test.ts`:
    - a create stores the title «considerando 26, reg. (UE) 2016/679» whatever title was sent, and the list
      answers that `citation`;
    - a create with `numero_articolo` beside `considerando`, or with `allegato`, is 400 with the fixture's
      reason;
    - a star PUT (`_dossierMeta`) is accepted and keeps the title;
    - a PUT with a forged `title` alone keeps the citation;
    - a PUT that sends an article's content to a recital entry, and one that sends a recital's content to an
      article entry, are 400;
    - an article entry is stored and titled as today (a pin).
  - `dossierNotes.test.ts`: a note about a recital entry is accepted (a pin).
- [ ] **Step 2: Run** `npm --prefix apps/server test -- tests/norms/citation.test.ts
  tests/dossiers.recital.test.ts tests/dossierNotes.test.ts`. Expected: FAIL, except the pins.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): a recital entry is checked and cited (spec §6.2)`

### Task 10: Every server reader of a `norm` entry

**Files** (each row of the spec's §6.3 server table):
- Modify:
  - `apps/server/src/schemas/normEntry.ts` (`rebuildNormEntry` returns `NormEntry | RecitalEntry`; a content
    with the key goes through `rebuildRecitalEntry`). The compiler then lists each caller that reads
    `numero_articolo`;
  - `apps/server/src/utils/environmentDossiers.ts` (keeps it);
  - `apps/server/src/utils/suggestionEntries.ts` (refuses it: «I considerando non si possono ancora proporre nel
    Forum.»);
  - `apps/server/src/lingo/courses.ts` (`resolveCitations` refuses it: «un considerando non si può ancora citare
    in un percorso»);
  - `apps/server/src/services/studyImport.ts` (`itemRow` checks and titles it; a refused one counts in
    `refused`);
  - `apps/server/src/assistant/entryText.ts` (`readEntryText`: a recital throws a new `RecitalHasNoText`) and
    `apps/server/src/routes/assistantPassages.ts` (400 «Il testo di un considerando non si legge ancora da qui:
    aprilo nel lettore di LexCraft.»);
  - `apps/server/src/norms/resolveReference.ts` (`identify`: a `/parse_query` answer with `parsed.recital` or
    `refusal` is `not_recognised`: «Un considerando si aggiunge al dossier dal lettore di LexCraft, non da
    qui.»);
  - `apps/server/src/controllers/notificationController.ts` (`POST /notifications/normas/check` stores no watch
    for a `norma_data` with the key, and answers as it does for an AKN text).
- Test: `trash.test.ts`, `sharedEnvironments.publish.test.ts`, `suggestions.dossier-entries.test.ts`, the course
  citations' test (`grep -ln "resolveCitations\|citazioni" apps/server/tests/lingoCorsi*.ts`),
  `studyImport.test.ts`, `assistant/entryText.test.ts`, `assistant/passages.routes.test.ts`,
  `norms/dossierNorms.test.ts`, `normaNotifications.test.ts`, `lingoCards.test.ts`.

**Interfaces:**
- Consumes: Tasks 8–9.
- Produces: every server row of spec §6.3 as its «After» column says.

- [ ] **Step 1: Write the failing tests**, one per row:
  - the trash summary of a recital entry is its citation, and a restore brings its content back unchanged;
  - a published environment keeps a recital entry with `considerando`, and refuses one with `numero_articolo`
    beside it;
  - a suggestion with a recital is refused with the Forum's sentence;
  - a course module citing a recital entry is refused with the course's sentence;
  - the study import stores a recital entry titled with its citation and its marks under
    `celex:32016R0679~rct26::art::`, and counts a malformed one in `refused`;
  - `readEntryText` on a recital throws `RecitalHasNoText`, and the passages route answers its sentence;
  - `omnilex_aggiungi_norme_dossier`'s route answers «considerando 26 GDPR» `not_recognised` with its sentence
    (stub `/parse_query` answering `parsed.recital: "26"`), and a recital entry already in the dossier never
    matches an article (a pin);
  - `POST /notifications/normas/check` with a recital `norma_data` stores no watch;
  - a LingoLex card on `celex:32016R0679~rct26` is refused (a pin).
- [ ] **Step 2: Run** the listed files with `npm --prefix apps/server test -- <files>`. Expected: FAIL, except the
  pins.
- [ ] **Step 3: Implement**, then `grep -rn "itemType === 'norm'\|'norm'\|numero_articolo" apps/server/src` for
  any reader the table misses. Add it to the table in the PR body, with its test.
- [ ] **Step 4: Run** the same command, then `npm --prefix apps/server run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): every reader knows a recital entry (spec §6.3)`

### Task 11: The MCP, pinned

**Files:**
- No change to `apps/mcp/src` (spec §6.4).
- Test: `apps/mcp/tests/tools.test.ts`, `apps/mcp/tests/delete.test.ts`, `apps/mcp/tests/pratica.test.ts`,
  `apps/mcp/tests/glosses.test.ts`

- [ ] **Step 1: Write the tests** with the stub server answering one `norm` item with `citation` «considerando
  26, reg. (UE) 2016/679» and one note about it:
  - `omnilex_leggi_dossier` lists «considerando 26, reg. (UE) 2016/679» and «Nota su considerando 26, reg. (UE)
    2016/679»;
  - the deletion dialog lists the recital by its citation;
  - `omnilex_leggi_pratica` lists it by its citation;
  - `omnilex_leggi_testo_voce` and `omnilex_glossa_voce` pass on the server's 400 sentence.
- [ ] **Step 2: Run** `npm --prefix apps/mcp run build && npm --prefix apps/mcp test -- tests/tools.test.ts
  tests/delete.test.ts tests/pratica.test.ts tests/glosses.test.ts`. Expected: PASS (pins: the MCP already
  passes the server's citation on). A failure is a reader to fix and list.
- [ ] **Step 3: Docs.** `apps/server/CLAUDE.md` (a recital is a `norm` entry with `considerando`; the readers of
  §6.3) and `apps/mcp/CLAUDE.md` (what the tools say of a recital).
- [ ] **Step 4: Commit** `test(mcp): a recital entry by its citation (spec §6.4)`, then open **PR 3** with the
  §6.3 server table in its body.

---

## PR 4a — Web: search, index, reading, marks (`apps/web`) — **web owner's side**

### Task 12: Identity and labels on the web

**Files:**
- Create: `apps/web/src/utils/sources/recital.ts`
- Modify: `apps/web/src/utils/euCaseLaw.ts` (extract `actCelex(norma)`, used by `euCaseLawQuery` and
  `recital.ts`)
- Test: `apps/web/src/utils/__tests__/sourcesGolden.test.ts` (a `recitals` block)

**Interfaces:**
- Produces: `actCelex(n: Pick<NormaVisitata,'tipo_atto'|'data'|'numero_atto'>): string | null`.
- Produces: `recitalIdentity(n: RecitalRef): string`, `citeRecital(n): string`, `shortRecital(n): string` and
  `recitalUnitLabel(n): string`, where `RecitalRef = Pick<NormaVisitata,'tipo_atto'|'numero_atto'|'data'> &
  { considerando: string }`.

- [ ] **Step 1: Write the failing tests.**
  - Every `recitals` golden case has identity and labels equal to these functions.
  - `euCaseLawQuery`'s existing cases still pass.
- [ ] **Step 2: Run** `npm --prefix apps/web run test -- --run src/utils/__tests__/sourcesGolden.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a recital's identity and labels`

### Task 13: The search reads a recital

**Files:**
- Create: `apps/web/src/utils/recitalClause.ts`
- Modify: `apps/web/src/utils/citationParser.ts` (`ParsedCitation.recital`, `.refusal`, new
  `isRecitalReady`), `apps/web/src/utils/normQuery.ts` (`citationFromServer`)
- Test: `apps/web/src/utils/__tests__/recitalClause.test.ts`, `apps/web/src/utils/citationParser.test.ts`,
  `apps/web/src/utils/__tests__/normQuery.test.ts`, `apps/web/src/utils/__tests__/decisionCitationParser.test.ts`

**Interfaces:**
- Produces: `splitRecitalClause(text: string): { recital: string | null; rest: string }` and
  `expandRecitalSpec(spec: string): string[]`, the Python rules of Task 5. The ceiling is
  `MAX_ARTICLES_PER_SEARCH`.
- Produces: `ParsedCitation.recital?: string` and `ParsedCitation.refusal?: 'recital_not_eu' |
  'recital_with_article'`.
- Produces: `isRecitalReady(p: ParsedCitation | null): boolean`. `isSearchReady` is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - the §3.1 table, row by row, through `parseLegalCitation`. «art. 4 e considerando 26 GDPR» gives the article,
    `recital: '26'` and `refusal: 'recital_with_article'` from the web's parser alone;
  - `citationFromServer({recognized: true, parsed: {act_type: 'regolamento UE', act_number: '679', date:
    '2016', recital: '26'}})` keeps `recital: '26'`;
  - `isSearchReady` is false for a recital reading and every existing case is unchanged;
  - `parseDecisionCitation('cons. 26 GDPR')` is null, and «Cons. St., sez. VI, n. 2270/2019» is still a decision.
- [ ] **Step 2: Run** the four files with `npm --prefix apps/web run test -- --run <files>`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the search reads a recital citation (spec §3.2)`

### Task 14: The recitals cache and the index part

**Files:**
- Create: `apps/web/src/utils/recitalsCache.ts`
- Modify: `apps/web/src/utils/actTree.ts` and `apps/web/src/components/features/search/TreeViewPanel.tsx`.
  `buildActTree` gains a last parameter, `options: { recitals?: boolean } = {}`, and puts a `recitals` node first
  when it is true. The caller sets it for `regolamento ue` and `direttiva ue` only, so every existing call is
  unchanged.
- Test: `apps/web/src/utils/recitalsCache.test.ts`, `apps/web/src/utils/actTree.test.ts`,
  `apps/web/src/components/features/search/TreeViewPanel.test.tsx`

**Interfaces:**
- Produces: `getRecitals(act: RecitalAct): Promise<{ recitals: { number: string; text: string }[] }>`. It calls
  `legalFetch('/fetch_recitals', …)` once per act per session and never caches an empty or failed answer;
  `RecitalAct` holds the act's three fields.
- Produces: the tree node `{ kind: 'recitals' }`.
- Produces: `TreeViewPanel` prop `onRecitalSelect(number: string)`.

- [ ] **Step 1: Write the failing tests.**
  - The cache makes one call for two reads.
  - After an empty answer, a second read calls again.
  - `buildActTree(…, { recitals: true })` puts the part first, and the existing calls give today's tree.
  - The panel shows the part for a `regolamento ue` and never for a treaty or an Italian act.
  - The panel lists «Considerando (4)» on opening the part, shows the empty-answer copy, and has «Riprova» on a
    failure.
  - A click calls `onRecitalSelect('173')`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): an EU act's index lists its recitals (spec §4)`

### Task 15: Opening and reading a recital, with its marks

**Files:**
- Modify:
  - `apps/web/src/utils/practice.ts` (`PracticeAct.recitals`, `addRecitalsToPractice`, the saved state);
  - `apps/web/src/hooks/useSearchActions.ts` (`openRecitals`);
  - `apps/web/src/hooks/useSearchQuery.ts` (a `refusal` is checked before `isSearchReady`);
  - `apps/web/src/components/features/search/CommandPalette.tsx` (the recital row, Enter, the incomplete and
    refused states);
  - `apps/web/src/components/features/practice/PracticeActBlock.tsx` (`onRecitalSelect`: open, or reveal if
    already open).
- Create: `apps/web/src/components/features/practice/RecitalReader.tsx`. It renders the heading, the §5.2 line,
  and the text through `renderArticleHtml`. It mounts `SelectionPopup` without the discussion, card and citation
  handlers, and lists unmatched marks through `UnmatchedAnchors`.
- Create: `apps/web/src/utils/__tests__/recitalRender.test.ts` and its fixture
  `apps/web/src/utils/__tests__/fixtures/recitals.json` (the API fixtures' recitals with their sha256, §7.4)
- Test: `apps/web/src/utils/__tests__/practice.test.ts`,
  `apps/web/src/components/features/search/CommandPalette.test.tsx`,
  `apps/web/src/components/features/practice/RecitalReader.test.tsx`

**Interfaces:**
- Consumes: Tasks 12–14.
- Produces:
  - `openRecitals(act, numbers: string[]): Promise<void>`, which uses `getRecitals`, opens the recitals that
    exist in number order, and names the missing ones with the §5.1 copy;
  - `addRecitalsToPractice(practiceId, act, recitals, {reveal: 'first'})`;
  - marks keyed `normaKey = recitalIdentity(…)`, `articleId = ''`.

- [ ] **Step 1: Write the failing tests:**
  - for each fixture recital, the rendered text nodes spell `text.replace(/\n/g, '')` with marks and signs on;
  - the fixture's sha256 equals the API golden's;
  - Enter on «considerando 26 GDPR» calls `openRecitals` and not `actions.search`;
  - «considerando 200 GDPR» shows the missing-number copy;
  - the two refusal copies show, with no topic search, and Enter on «art. 4 e considerando 26 GDPR» does not call
    `actions.search`;
  - «considerando 26» asks for the act and offers only Regolamento UE and Direttiva UE;
  - a click on recital 26 in the index opens it, and a second click reveals it without opening it twice;
  - a practice saved without `recitals` loads unchanged;
  - the reader shows «Considerando 26» and the §5.2 line, never «Art.»;
  - `SelectionPopup` shows no «Discuti con i colleghi», «Crea scheda» or «Segnala come citazione»;
  - a highlight and an anchored note whose text no longer matches are both listed in `UnmatchedAnchors`;
  - a note written with the inline composer shows in the notes panel, and the highlights export names the
    recital by its short label;
  - «Copia citazione» copies «considerando 26, reg. (UE) 2016/679»;
  - «Copia link EUR-Lex» copies the act's page. `#rct_N` is added only after one live check that EUR-Lex scrolls
    to it, recorded in the PR body.

  «Aggiungi al dossier» on a recital arrives with Task 16 (PR 4b).
- [ ] **Step 2: Run** the four test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `npm --prefix apps/web run build` and `npm --prefix apps/web run lint`.
  Expected: PASS, with no type or lint error.
- [ ] **Step 5: Browser pass** on `http://localhost:5173`, logged in, at 1440 and 390, light and dark: the spec's
  Verification list for 4a. Note what was seen in the PR body.
- [ ] **Step 6: Docs.** `apps/web/CLAUDE.md`: the search's recital clause and refusals, the index part, the
  reader, and the marks' key.
- [ ] **Step 7: Commit** `feat(web): read, highlight and annotate a recital (spec §5, §6.1)`, then open
  **PR 4a**.
  - Its body states that the recital text is frozen from this merge (rule 23).
  - It also needs the web owner's approval.

---

## PR 4b — Web: the dossier (`apps/web`) — **web owner's side**

A recital is a `norma` entry with `considerando` (G-538). The tasks are the web rows of the spec's §6.3 table:
each row gets its test. Paths are under `apps/web/src`.

### Task 16: The entry's type, its checks, and the moves that keep the field

**Files:**
- Create: `utils/sources/recitalEntry.ts`, which asserts `conventions/sources/recital-entries.json`
- Modify:
  - `types/index.ts` (`DossierNormaData` becomes `ArticleNormaData | RecitalNormaData`);
  - `utils/sources/normEntry.ts` (`rebuildNormEntry` keeps the recital shape);
  - `components/features/dossier/dossierUtils.ts` (`dossierItemFromApi`, `validateImportedDossier`,
    `normaForDossier`, `dossierSuggestionPayload`);
  - `components/features/practice/practiceDossierItems.ts` (`itemOf`, `dossierArticleKey`);
  - `utils/normaChanges.ts` (`normaFromChangeNotification`: null for a recital);
  - `AddToDossierPopover.tsx` (from `RecitalReader`, 4a).
- Test: `utils/sources/__tests__/recitalEntry.test.ts`, `dossierUtils.test.ts`, `practiceDossierItems.test.ts`,
  `utils/__tests__/normaChanges.test.ts`

**Interfaces:**
- Consumes: Task 12 (`recitalIdentity`, `citeRecital`, `shortRecital`, `recitalUnitLabel`), PR 3's routes.
- Produces:
  - `isRecitalNorma(d: DossierNormaData): d is RecitalNormaData` (the own key `considerando` decides);
  - `rebuildRecitalEntry(raw: unknown): { ok: true; entry: RecitalNormaData } | { ok: false; reason: string }`;
  - `entryMarksKey(d: DossierNormaData): { normaKey: string; articleId: string }`: for a recital
    `{ normaKey: recitalIdentity(d), articleId: '' }`, for an article today's `buildItemKey` and
    `uniqueArticleIdFromNorma`;
  - adding a recital sends `{ itemType: 'norm', content: { tipo_atto, numero_atto, data, considerando } }`.

- [ ] **Step 1: Write the failing tests.**
  - Every case of `recital-entries.json` is kept or refused with the server's reason.
  - The JSON export of a dossier holding recital 26 and art. 5 of the GDPR imports back equal, `considerando`
    kept; the share link the same.
  - `normaForDossier` and «Salva come dossier» (`itemOf`) keep `considerando`, and recitals 26 and 27 of one act
    stay two entries.
  - `dossierArticleKey` of recitals 26 and 27 differ, and differ from art. 26's.
  - A suggestion payload leaves a recital out with «I considerando non si possono ancora proporre nel Forum.»
  - `normaFromChangeNotification` is null for a recital.
  - Adding recital 26 twice shows the article's «Già presente».
- [ ] **Step 2: Run** `npm --prefix apps/web run test -- --run src/utils/sources/__tests__/recitalEntry.test.ts
  src/components/features/dossier/dossierUtils.test.ts
  src/components/features/practice/practiceDossierItems.test.ts src/utils/__tests__/normaChanges.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement**, then let `npm --prefix apps/web run build` list every reader of `numero_articolo` on
  a `DossierNormaData`. Each one either takes `isRecitalNorma` first or belongs to Task 17 or 18.
- [ ] **Step 4: Run** the files and the build. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): a recital is a norma entry that keeps its field (spec §6.2, G-538)`

### Task 17: Where it shows: labels, layout, reader, «Lettura», PDF, trash

**Files:**
- Modify, in `components/features/dossier/` unless said:
  - `dossierLayout.ts` (`articleLabel`, `foldedArticleList`, `compareArticles`, `layoutDossier`, `countsParts`);
  - `DossierArticleRow.tsx`, `DossierDetailView.tsx` (note heading, search filter), `DossierListView.tsx`
    (search filter);
  - `DossierItemReader.tsx` (text from `recitalsCache.ts`, the §5.2 line, marks under `entryMarksKey`, «Copia
    citazione», «Apri in Ricerca» through `openRecitals`);
  - `utils/citation.ts`, `utils/storeApiMappers.ts` (`articleRootOf` never reached for a recital);
  - `dossierUtils.ts` (`computeItemCounts`, `searchParamsFromNorma`), `utils/environmentUtils.ts` (counts);
  - «Lettura»: `utils/practice.ts` (`addArticles`, `isStoredArticle`), `useRowText.ts`, `syncFromDossier`
    (`store/useAppStore.ts`);
  - `features/practice/PracticeActBlock.tsx` (`chipLabel`), `PracticeArticleRow.tsx`;
  - `dossierPdf.ts`, `dossierPdfMarks.ts`, `trashSummary.ts`.
- Test: the test beside each file (`dossierLayout.test.ts`, `DossierItemReader.test.tsx`, `dossierPdf.test.ts`,
  `dossierPdfMarks.test.ts`, `trashSummary.test.ts`, `practice.test.ts`, …)

**Interfaces:**
- Consumes: Task 16.

- [ ] **Step 1: Write the failing tests**, one per row of the table this task owns:
  - the layout puts «Considerando 26» and «Considerando 27», in that order, before art. 5 in the GDPR's block;
    the counts read «2 considerando, 1 articolo»;
  - no label anywhere reads «art. undefined» or «art. »: the row, its accessible name, the note heading and the
    chip read «Considerando 26»;
  - the reader of recital 26 shows recital 26's text (not 27's), the §5.2 line, and loads its marks under
    `celex:32016R0679~rct26::art::` without throwing;
  - «Copia citazione» copies «considerando 26, reg. (UE) 2016/679»;
  - «Lettura» has one row per recital;
  - the PDF prints «Considerando 26», the line and its own text, and the «solo le parti evidenziate e annotate»
    export does not fail and prints only its marked passages;
  - the trash's summary of a recital is its citation, never «1 voce»;
  - the dossier's search finds «considerando 26».
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `npm --prefix apps/web run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): recitals in the dossier's labels, layout, reader, PDF and trash`

### Task 18: Publication, «already there», the `type === 'norma'` filters, and the browser pass

**Files:**
- Modify:
  - `components/features/dossier/publicationMarks.ts`, `dossierPublication.ts` (`locate`, `markKeyOf`),
    `PublishDossierDialog.tsx`;
  - `dossierUtils.ts` (`dossierContainsArticle`), `inDossier.ts`, `useActItemIds`, `ArticleTabContent.tsx`,
    `CorpusPracticesDialog.tsx`;
  - each other file that `grep -rn "type === 'norma'\|numero_articolo" apps/web/src` lists and Tasks 16–17 did
    not take.
- Test: the test beside each changed file.

- [ ] **Step 1: Write the failing tests:**
  - a dossier holding a recital publishes, with `considerando` and its marks, and two recitals' marks do not
    collide;
  - «Togli dalla pratica» on recital 26 trashes recital 26 alone;
  - «Nel dossier» says recital 26 is there and recital 27 is not;
  - the notes of recital 26 in `ArticleTabContent` are its own;
  - pins for the unchanged rows: `actKeyOf`, `citedNorm.ts`, the MERL-T event, `compareKindOf`.
- [ ] **Step 2: Run** them. Expected: FAIL, except the pins.
- [ ] **Step 3: Implement.** For each `type === 'norma'` filter, decide whether recitals are included (opening,
  counting, «already there») or left out on purpose (comparing, watching). Write the choice in one line in the PR
  body, beside the §6.3 web table.
- [ ] **Step 4: Run** them, then `npm --prefix apps/web run build`, `lint`, and the dossier folder's tests
  (`npm --prefix apps/web run test -- --run src/components/features/dossier`). Expected: PASS.
- [ ] **Step 5: Browser pass** on `http://localhost:5173`: the spec's Verification list for 4b, plus «Togli dalla
  pratica» on one recital, «Lettura», and publishing a dossier holding a recital.
- [ ] **Step 6: Docs.** `apps/web/CLAUDE.md`: a recital is a `norma` entry with `considerando`, and the readers
  of §6.3.
- [ ] **Step 7: Commit** `feat(web): recitals through every dossier filter`, then open **PR 4b** for the web
  owner's approval.
