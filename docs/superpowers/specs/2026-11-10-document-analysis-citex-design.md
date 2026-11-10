# «Analizza documento» reads with the citex model — a model behind the page

**Status:** proposal, 10 November 2026. Nothing here is decided: the owners answer the questions of §12. No product
code, no `infra/` change and no model run is made until they do.
**Asked by:** one owner, 10 November 2026 (G-445): deploy the citex model in «Analizza documento». It changes G-439,
which had kept the model a separate tool, outside VisuaLex.
**The model:** the citex model (a separate project): a token-classification model that finds references to sources
of law in Italian prose and types their parts, plus a deterministic assembler that turns the parts into references.
Release candidate c4. Its code, data and weights live in that project; nothing of it is in this repository today.
**Decisions it rests on:** G-375 (the page goes only when it finds at least as much as Claude through MCP on the same
documents), G-393 (the nine answers of `2026-10-29-document-analysis-design.md` §9, among them Q3, the switch «Riconosci
solo nel browser», and Q5, the promise says what goes out), G-402 (a bare article inherits an act only when the text
says so), I-2 (the page's words and screens are the web owner's).
**Extends:** `2026-10-29-document-analysis-design.md` (here «#376») and `2026-10-31-document-hyperlinks-design.md`
(«#391»). It replaces none of them: today's recognizer stays, as the fallback and as the half of the merge (§5).
**Migration:** none. **Areas a build would touch:** the Python API, the server's quota (authentication's area),
`infra/` (a new module), the web page and its words.

---

## 1. What was asked, in five lines

1. **More found.** Today's recognizer reads the forms its rules know; the model reads forms it has learnt, among them
   decisions, authority acts and references whose act is named elsewhere.
2. **Behind the page,** not as a separate tool: the same page, the same list, the same completion by hand.
3. **It fails safe.** When the model is down, busy or switched off, the page works as today and says so.
4. **Honest about the text.** With the model the text of the document reaches our server. The promise «Il documento
   resta sul tuo computer» is then not true for that document, and the page must say what is.
5. **Measured before it ships** (G-375), on the corpus of #376, against Claude through MCP.

## 2. What exists

### 2.1 The page today (checked on `develop` at f3523d74)

- The file, or the pasted text, is read in the browser (`documentFile.ts`); candidates are found in the browser
  (`documentCandidates.ts`, #376 §4.3), read by the client parser and, for what it cannot settle, by
  `/parse_query_batch` with the query strings alone (`documentServer.ts`); a bare article inherits only when the text
  says so (G-402); what is left goes to «Da completare» (`CompletionPicker.tsx`); «Prepara i link» asks
  `/fetch_norm_links` with the norms alone (#391).
- The promise, in three places (`DocumentReviewPage.tsx` line and badge, `DropZone.tsx` box), pinned by
  `DocumentReviewPage.test.tsx`: «Il documento resta sul tuo computer: a VisuaLex arrivano solo le citazioni trovate,
  come in una ricerca.» With «Riconosci solo nel browser» on: «Tutto nel tuo browser».
- Measured on the corpus of #376 (§3.2 there, 103 article citations): 98 found within the paragraph rule, 0 wrong, 5
  to complete. On the blind corpus the inheritance rule was narrowed (G-402); the page has no figure against Claude
  through MCP yet.

### 2.2 The model, as its project describes it

- **What it reads:** text only. One HTTP route, `POST /api/estrai {"testo": …}`, at most 200,000 characters; one
  inference at a time (a lock); no request body in its log (it logs method and path); the Normattiva and EUR-Lex
  addresses it returns are built locally, never visited. Its own demo binds to the loopback address and warns that it
  has no authentication.
- **What it answers,** per reference: the surface text and its offsets in the text sent (`inizio`, `fine`), a kind
  (`norma`, `giurisprudenza`, `provvedimento`, `non_fonte`, `unknown`), `risolta`, a confidence, the reference's parts
  (for a norm: act type, date or year, number, article; for a decision: court, section, number, date; for a regional
  law its region, for an authority's regulation its issuer), locators (comma, letter, number, paragraph, annex); for a
  resolved norm the four fields VisuaLex's `NormaVisitata` takes; for an unresolved one a reason. Optionally a list of
  **deduced** references (a «del medesimo decreto» linked to its act), each with the act it was linked to and the note
  «dedotta: verifica».
- **Identified, not served.** Regional laws and authority regulations come out «identified, text not available»:
  their identity is read, VisuaLex has no text for them. Its code has a flag for it that its HTTP answer does not yet
  carry; its project offered to add it (§13, PR A).
- **Its tables:** a copy of the act-name tables of mcp-legal-it (Apache-2.0), pinned to a commit. They may differ from
  VisuaLex's own (`preset_aliases.yaml`, `act_resolver.py`); §5.2 says why that cannot produce a wrong link.
- **Measured by its project** (figures as of 9–10 November 2026):
  - on a blind corpus of 398 marked citations, written by a session that had not seen the model: **87.7% right, 3
    harmful** (a well-formed but wrong reference). Two were «T.U.E.» read as the Treaty where the text meant the
    building code — since corrected: with no definition in the document, the model abstains — and one an act named
    inside its own definition. None was a wrong article;
  - with the deduced references on, at its chosen threshold: 86.7% right, 4 harmful, about a third of the references
    «named elsewhere» resolved;
  - the model card lists as limits: regional laws and decreti-legge not resolved by the act tables; trained on
    legislation, judgments and authority decisions, briefs and contracts seen only through the blind corpus.
- **Size:** 287M parameters, 1.1 GB in fp32. A reduced package (vocabulary pruned, weights stored fp16, about 270 MB)
  existed for the previous model of the same architecture; the c4 package is being produced with an equivalence check
  and has no checksum yet. On a CPU the fp16 weights are loaded back into fp32: the package saves disk, memory and
  load time, not inference time.
- **Speed** (per window of 90 words, 25 of overlap): 81 ms on a recent laptop's CPU, measured on the previous model;
  on the deployment host — a 2017 laptop, four cores, 16 GB, shared with the whole stack — **0.3–0.5 s, estimated**,
  to be measured there. Hence, estimated: 10 pages (~5,000 words, ~80 windows) 25–45 s; 20 pages 45–90 s; 100 pages
  (~770 windows) 4–7 minutes. Deduced references add 10–30%.
- **Memory,** estimated, to be measured: 1.0–1.3 GB resident for the reduced package, a peak of about +0.3 GB while it
  loads; 1.8–2.2 GB for the fp32 weights unreduced.

These figures are the model project's. This spec plans on them and marks what the host must confirm (§9.1).

### 2.3 The server's side today

- The Python API (`services/visualex/app.py`) runs as one hypercorn worker (`Dockerfile`: `--workers 1`), in the
  `scrapers` container: on the `app` network only, read-only root, 2 GB ceiling (`infra/compose.scrapers.yml`).
- The ingress routes the scraping paths by prefix behind the login and the quota (`infra/ingress/Caddyfile`, `@legal`,
  a body at most 1 MB); Vite proxies the same prefixes in development (`apps/web/vite.config.ts`), and
  `infra/ingress/paths.test.mjs` keeps the two in step. `/extract_citations*` is one of the prefixes.
- The quota prices a path (`apps/server/src/middleware/scrapeGate.ts`, `DEFAULT_SCRAPE_COSTS`: `/parse_query_batch` 3,
  `/fetch_norm_links` 5; 300 points a minute).
- `/parse_query_batch`'s log line holds a count and a duration, never a string, and a test asserts it (#376 §6.2).

## 3. Design in one picture

```
browser                          ingress                 Python API (scrapers)              citex (internal)
───────                          ───────                 ─────────────────────              ────────────────
file ─▶ text
  │
  ├─ today's path (#376), always ──────────────────────▶ /parse_query_batch (query strings)
  │
  └─ «Leggi con il modello» (§6), per document
       text cut into parts (§7) ─▶ login + quota ──▶ POST /extract_citations_model ──▶ POST /api/estrai
       one part at a time          (1 MB body)          timeout, queue of 2, no log of text   one at a time
       ◀──────────────── rows for that part: each reference re-read by VisuaLex (§5.2) ◀──────┘
  │
  ▼
merge (§5): model first, today's path fills its gaps, a disagreement goes to «Da completare»
  ▼
list: resolved · dal contesto · dedotte, da verificare · identificate, testo non disponibile · da completare · non norme
```

## 4. Architecture

### 4.1 A separate internal container (recommended, Q1)

- **`citex`, a compose module of its own** (`infra/compose.citex.yml`, beside `compose.scrapers.yml`), started only when
  the module is switched on (§9.3). It runs the model project's HTTP server, bound to `0.0.0.0:8765` inside the
  container.
- **Not exposed.** No `ports:`, no route in the ingress. It sits on a network of its own, `citex`, declared
  `internal: true`, to which only `scrapers` is joined besides it: the ingress, the server, the databases and MERL-T
  cannot reach it, and it cannot reach the internet — so «no external call» is a property of the network, not only of
  its code. `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` all the same (the model project asks for it: the loader
  must find its tokenizer in the model folder and never look for it online; to be confirmed when the image is built).
- **Hardened as the scrapers are:** read-only root, a `tmpfs` for `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, a
  non-root user, `pids_limit`, `init: true`, `json-file` logging with rotation, and the ceilings of §9.1.
- **A shared secret** between the API and the container (`CITEX_SECRET` in `infra/.env`, sent as a header, refused
  without it): the internal network already isolates it; the secret is the second lock, because the model's server has
  no authentication of its own.
- **Called by the Python API only,** through one client (`visualex_api/services/citex_client.py`): `aiohttp`, one
  connection, a timeout per part (§7.2), the secret.

Why not the others:

| Option | Gains | Costs |
| --- | --- | --- |
| **A. A container of its own** | the model's memory and CPU have their own ceiling; a crash or an out-of-memory kill takes the model down, not the search; torch stays out of the scrapers' image; the model's version is rolled forward and back alone (§9.4) | one more service; a network hop (milliseconds against seconds) |
| B. Inside the Python API | no new service | torch (~550 MB installed) and 1–1.3 GB of weights inside the process every search goes through, under the same 2 GB ceiling; the event loop must hand inference to a thread; an out-of-memory kill stops every scraping route; the model project's code would have to be in this repository (Q6) |
| C. In the browser (ONNX, WebAssembly) | the promise stays literally true: nothing leaves | ~270 MB downloaded per user, impossible on a phone, inference on the user's CPU at the speeds of §2.2 or worse; an ONNX export of this architecture is not measured; the weights become downloadable by any signed-in user (Q7) |

C is the one that would keep today's promise; it is not proposed now, and it stays the answer if the owners decide
that no document text may ever reach the server (Q2).

### 4.2 The route on the Python API

- **`POST /extract_citations_model`**, body `{"text": string, "offset": int, "part": int, "parts": int}`; `text` at most
  30,000 characters (§7.1). The path sits under the `/extract_citations*` prefix, so the ingress routes it behind the
  login and the quota and Vite proxies it **with no change to the Caddyfile, the Vite configuration or the path
  test**, as `/parse_query_batch` did under `/parse_query*`.
- **`GET /extract_citations_model/status`** → `{"available": bool, "model": "c4-…", "max_chars": int}`: whether the
  page offers the model at all (§6.3). It costs nothing in the quota; it says nothing about any document.
- **Its price:** a line of its own in `DEFAULT_SCRAPE_COSTS`, 10 points a part (proposed): a 100-page document is
  about 12 parts, 120 points; one user cannot keep the model busy for more than about 30 parts a minute. Authentication's
  area: its owner reviews it.
- **What it does:** checks the body (a 400 naming the limit otherwise); asks the container; re-reads each reference
  (§5.2); adds `offset` to every span; answers rows in the page's own shape. Nothing is kept once the answer is sent.
- **When it cannot:** module off → 503 `{"reason": "disabled"}`; container down or failing its health → 503
  `{"reason": "unavailable"}`; queue full (§7.3) → 503 `{"reason": "busy"}` with `Retry-After`; a part over its time
  → 504. The page falls back in all four (§8).

## 5. Merging with today's results

### 5.1 The rule (Q3)

Both paths run on a document read with the model. **Recommended: the model first, today's path fills its gaps:**

1. A span both paths read **with the same act and the same article** is one row, drawn as found.
2. A span the model resolves and today's path does not (or leaves to complete) → the model's row.
3. A span today's path resolves and the model misses or leaves unresolved → today's row (this is how a decreto-legge,
   which the model's tables do not resolve today, stays found).
4. A span **both read with a different act or article** → «Da completare», with both readings offered first in the
   picker («Il modello legge: …», «La ricerca legge: …»). Never a silent choice.
5. A span the model types `non_fonte` («art. 5 del contratto») and today's path sends to «Da completare» → «Non sono
   norme», with «Ripristina», as a dismissed row today. If today's path *resolved* it, rule 4.
6. Spans that overlap without matching (a list read as one by one path, two by the other) are compared article by
   article; an article only one of them reads follows rule 2 or 3.

Rows keep their origin for the measure (§10) and for the row's menu («letta dal modello», «letta come nella ricerca»),
not as a badge on every row — the web owner decides whether it shows at all.

Alternatives: the model alone, today's path only as the fallback (simpler, loses what the model misses — the
decreti-legge, today); or today's path first and the model only for what it leaves (keeps today's 0 wrong, gains less).
The measure of §10 is run for all three modes, so the owners choose on figures.

### 5.2 Every reference re-read by VisuaLex

The model's tables are not VisuaLex's. So the API never passes a model reference to the page as it is:

- a norm's four fields are turned into the page's `parsed` (the shape `/parse_query_batch` answers) through the same
  reading the search uses: act type to the convention's spelling (`conventions/sources/`), the predicate
  `identifies_act` on the API's copy of the numbered types; a year-only date stays a year, as `/parse_query_batch`
  leaves it — completing it (`act_dates.complete_year`) asks Normattiva, and the re-reading reaches no network: the
  date is completed when the citation is opened or linked, as today;
- a reference VisuaLex does not identify becomes «Da completare» with the model's reading kept as the picker's first
  suggestion — never a link (#391's rule: a wrong link is worse than none);
- the model's own Normattiva or EUR-Lex address is dropped: «Apri» and «Prepara i link» build theirs as today, so
  there is one source of addresses.

### 5.3 The sections of the list

| Section | What | «Apri» / link |
| --- | --- | --- |
| the act groups (today's) | resolved rows, by either path; inherited rows («dal contesto», G-402) | yes / yes |
| **«Dedotte — da verificare» (N)** | the model's deduced references (§5.4), each with «riferita a: d.lgs. 196/2003» and the phrase it was linked to | «Apri» yes; **no link** until the user confirms it, which moves it to its act's group as «confermata da te» |
| **«Identificate — testo non in VisuaLex» (N)** | regional laws, authority regulations: the identity as read («l.r. Lombardia 12/2005, art. 5») | no / no, the row says why |
| «Da completare» (today's) | unresolved by both, disagreements (rule 4) | «Completa» |
| «Non sono norme» (today's) | dismissed, and `non_fonte` (rule 5) | «Ripristina» |

Decisions and authority decisions (`giurisprudenza`, `provvedimenti`) the model finds are **not** listed in this
round: the page lists norms, and a decision's link has rules of its own (Q9).

### 5.4 Deduced references (Q4)

The model's optional layer links «del medesimo decreto», «della citata legge» to an act named before. The browser's
own inheritance (G-402) already does this when the text says so. Both are kept apart:

- a span the browser inherits and the model deduces to the same act → the inherited row (today's), as found;
- to a different act → «Da completare», rule 4;
- deduced by the model only → «Dedotte — da verificare».

The model project's release configuration has the layer **off**. Recommended: build the section, ship with the layer
off, and switch it on (a per-request flag the model project offered to add, §13 PR A) only when the measure of §10
shows it adds right rows with no more wrong ones than G-402's rule.

### 5.5 Completion by hand, unchanged

The picker, the scope «Solo a questa citazione / Anche alle altre … / A tutte», «Annulla», `beforeunload` (#376 §5)
stay as they are. The model only changes which rows reach it and the first suggestion it shows.

## 6. The text leaves the computer: the promise (Q2, words: the web owner with the other owner, I-2)

### 6.1 What changes

With the model, **the text of the document** (in parts) goes to VisuaLex's server, over TLS, through the login. It is
processed in memory and dropped when the part is answered. This is not «solo le citazioni trovate».

### 6.2 What «not stored, not logged» means, checked on the design

- **Not on disk:** the API writes nothing of a part (no cache, no history — `add_to_history` is for the fetch routes);
  the container's root is read-only and its `/tmp` is in memory.
- **Not in a log:** the API logs `parts`, `chars`, `refs`, duration and the outcome, never a string — a test captures
  the structured log (as `test_akn_fetch.py` and `/parse_query_batch`'s test do) and asserts no part of the text and no
  reference's surface appears, including when the container fails or answers garbage. The container logs method and
  path only (its own rule); its error answers must not echo the text (PR A checks it); the API never forwards the
  container's error text to its own log.
- **Not kept in memory** past the answer: no job store; a part lives for the length of its request (§7).
- **What remains true and should be said plainly** (in the privacy notice, not on the page): the host's operating
  system may page memory to swap; the TLS ends at the ingress, inside the host; the host is run by the owners, not by a
  cloud provider. A document under professional secrecy, or holding health or criminal data, is then processed — briefly —
  on the owners' machine. The privacy notice must say so before the page offers it; that text is the owners' (Q2).

### 6.3 How the page asks (recommended: opt-in per document)

Three ways a document can be read; the page offers the third only when `/status` says the model is available:

| Mode | What reaches VisuaLex | Today |
| --- | --- | --- |
| «Riconosci solo nel browser» (G-393 Q3) | nothing | the switch, off by default |
| as today | the query strings of the citations | the default |
| **«Leggi con il modello»** | the text of the document, in parts | new |

Recommended (Q2): **per document, off by default.** Today's path runs first, as now, and its result shows at once; a
button on the result, «Leggi con il modello», says in one line what it sends and starts the reading (§7.4). The choice
is not remembered across documents: every confidential file is a fresh decision. Alternatives in Q2.

### 6.4 The words, proposed (the web owner decides)

- the button: «Leggi con il modello» and under it «Il testo del documento viene inviato a VisuaLex per la lettura: non
  viene salvato né registrato. Trova più citazioni, anche quelle scritte in forme che la ricerca non conosce.»
- the badge, after the user started it: «Testo letto da VisuaLex» (in place of «Il documento resta sul tuo computer»),
  with on hover and for a screen reader: «Il testo di questo documento è stato inviato a VisuaLex per trovare le
  citazioni, ed è stato scartato subito dopo: non è salvato né registrato.»
- the box and the line of the page stay as today until the user presses the button: before it, they are true.
- the PDF refusal («Il file non è stato inviato al server») stays true and stays.

The three tests that pin the promise (`DocumentReviewPage.test.tsx`) gain the opposite case: after «Leggi con il
modello», «resta sul tuo computer» is nowhere on the page.

## 7. Long documents, latency, limits

### 7.1 Parts, cut in the browser (recommended)

The browser cuts the text at paragraph ends into **parts of at most 30,000 characters** (~4,500 words, ~70 windows,
estimated 20–35 s on the host), never inside a paragraph; a paragraph longer than a part is cut at a sentence end, and
the two parts overlap by that sentence, the overlap's duplicates removed by span. Parts go one after the other.

- **Progress** is the parts done: «Lettura con il modello: parte 3 di 12», a bar, and «Interrompi», which aborts the
  request in flight and keeps what came. Rows of a finished part enter the list as they come.
- **No job on the server.** The API holds a part for the length of its request and nothing between two: no job store
  to secure, to expire or to lose when the single worker restarts, and the text is never on the server longer than a
  part's reading. The cost: the model's deduced references cannot reach back across a part boundary (§5.4: off at
  launch anyway).
- Alternative: a server job (`POST` the whole text, poll its progress). One request, but the whole text held on the
  server for minutes, a job store in a single process, and an expiry to write. Not recommended.

### 7.2 Limits (to set with the host's figures, §9.1)

| Limit | Proposed | Why |
| --- | --- | --- |
| a part | 30,000 characters, body ≤ 128 KB | well under the ingress's 1 MB and the model's 200,000 |
| a document read with the model | 300,000 characters (~120 pages); beyond it the button says the document is too long and today's path stays | about 10 minutes on the host at the estimates: past that, a user waits too long and blocks others |
| a part's time | 90 s at the API, then 504 | a part is 20–35 s estimated; three times that is a stuck model |
| the queue | one part reading and two waiting, across all users; a third → 503 `busy`, `Retry-After: 15` | memory stays flat (one inference at a time is the model's own rule); waits stay bounded |
| per user | the quota: 10 points a part (§4.2) | |

### 7.3 Several users at once

The container reads one part at a time. Parts of different users interleave in the API's queue, first come first
served; a user's next part is sent only when the previous one is answered, so a long document does not lock out a short
one for more than one part (~30 s). The page retries a `busy` part after `Retry-After`, up to 2 minutes, then falls
back (§8) for the parts left.

### 7.4 What the user sees while it reads

Today's result is already on screen and usable (open, complete, links). The model's rows join as each part ends; a
row today's path had «Da completare» and the model resolves moves into its act's group with a short notice
(«Il modello ha letto 6 citazioni in più»). Nothing the user already chose by hand is overwritten: a hand choice wins
over the model's reading of the same span, which then shows only in the picker.

## 8. When the model does not answer

- `/status` says unavailable, or the module is off → the button is not shown; the page is today's.
- A part fails (503, 504, a network error, garbage) after its retries → the parts read stay; the rest keep today's
  result; a line says «Il modello non risponde: per il resto del documento vale il riconoscimento consueto.» with
  «Riprova», which resends the parts left. Nothing is lost, nothing listed twice.
- The badge then says what happened: the parts sent were sent, so it does not go back to «resta sul tuo computer».

## 9. Operations

### 9.1 Budget on the host (figures for the host's operator)

| | Estimated | To confirm on the host before switching on |
| --- | --- | --- |
| model | the reduced c4 package, ~270 MB on disk; only the reduced package is deployed, never the 1.1 GB weights | its checksum (§9.2) |
| memory, idle | 1.0–1.3 GB resident | measured after load |
| memory, peak | +0.3 GB while loading; flat while reading (one inference at a time) | measured over a 100-page document |
| ceiling | `mem_limit: 2g` (`CITEX_MEM_LIMIT`), `pids_limit: 128` | that the host has 2 GB free with the whole stack up |
| CPU | `cpus: 2` (`CITEX_CPUS`), torch threads 2 (`--threads 2`): two of the four cores stay with the stack | that searches stay responsive while it reads |
| load | at most one part (~30 s of two cores) at a time; with the quota, at most ~120 parts an hour in practice | — |
| image | ~550 MB of libraries (torch CPU-only), the weights mounted, not baked in | — |

If the host cannot give 2 GB and two cores, the module stays off: the page works as today.

### 9.2 Where the weights live, and how the host gets them (Q7)

The weights never enter this repository, nor its image. Recommended:

- the model project produces a **versioned package**, `citex-<version>/` (weights, tokenizer, configuration,
  `SHA256SUMS`), and keeps its master copy and a backup off the host;
- an owner copies it to the host into a directory outside the checkout (`CITEX_MODEL_DIR` in `infra/.env`; one
  sub-directory per version, the previous one kept);
- `infra/.env` pins `CITEX_MODEL_VERSION` and `CITEX_MODEL_SHA256` (the checksum of the package's `SHA256SUMS`);
- the container mounts the version **read-only** and, before it loads, checks every file against `SHA256SUMS` and that
  file against the pin; on any mismatch it refuses to start, its health fails, `/status` says unavailable, the page is
  today's. `./start.sh --prod` checks the same before it starts the module and says why it does not;
- the data backup (`scripts/backup.sh`) does not carry the weights: they are not data, they are a release artefact
  with its own master copy.

Alternatives in Q7: a private container image with the weights inside (a registry and its credential on the host);
a download from a private release at deploy time (a token on the host, and the network at deploy).

### 9.3 The off switch

- `CITEX_ENABLED=false` in `infra/.env` (the default): the module is not started, `/status` says
  `available: false`, the button is not shown. `true` and a restart of the module switch it on.
- Switching it off at once, without a deploy: `docker compose … stop citex` — the API sees it down and the page is
  today's within one `/status` (asked when a document is read).
- The page needs no switch of its own: it follows `/status`.

### 9.4 A new model version: rollout and rollback

1. The model project delivers `citex-<new>/` with its `SHA256SUMS` and its measures (on its blind corpora; never on
   this repository's corpus, which is the gate below).
2. The new version is scored on this spec's measure (§10) in all three merge modes; it ships only if it finds at least
   as many and has no more wrong than the version running. The figures go in `CHANGELOG.md` with the release.
3. On the host: copy the directory, set `CITEX_MODEL_VERSION` and `CITEX_MODEL_SHA256`, restart the module (load ~5 s,
   the page meanwhile is today's).
4. **Rollback:** set the previous version and checksum back, restart the module. The previous directory is kept until
   the next version is accepted.
5. The model's tables (the copy of mcp-legal-it's) travel with its version; their update is a new version.

### 9.5 Logging

- The API: one line per part — `extract_citations_model`, `part`, `parts`, `chars`, `refs`, `ms`, `outcome` — and one
  per failure with the error's type, never its message. The test of §6.2.
- The container: method, path, status, duration (its own rule). `json-file`, `max-size 10m`, `max-file 3`.
- No metric holds a document's name, a citation or a user.

## 10. Measure before it ships (G-375)

### 10.1 On this spec's corpus

The six documents of #376 (`2026-10-29-document-analysis/corpus/`, 103 article citations, 9 acts alone, 1 outside
the sources), not a blind corpus.

- **Precondition:** the model project confirms that these six documents were never in its training, development or
  test data. They are public in this repository; if they were seen, the figure is not a measure.
- **The model's answers are recorded once,** on the model project's side (or on the host, with the module up), as JSON
  beside the corpus (`measure/citex/<version>/0N.json`): the documents are invented and public, so their answers can be
  kept. Nobody in this repository runs the model to score.
- **Scored offline:** `score.py` gains three paths read from the recordings — the model alone, the merge of §5.1, and
  today's path first — beside today's, with the same rules (a citation found when a mark overlaps with the same act and
  article; a list's articles one by one). Columns as #376 §3.2: found, wrong, to complete, missed, non-norms dismissed;
  plus deduced (right / wrong) when the layer is on, and «identified» separately.

### 10.2 Against Claude through MCP

As #376 §3.4: each plain document given to Claude with the MCP server the owners use, the same question («Elenca tutte
le norme citate in questo documento: per ciascuna l'atto e l'articolo, nell'ordine in cui compaiono.»), its answer
written as the scorer's predictions with each passage located, scored by `score.py`. Recorded beside the model's
answers, with the date and the client used.

### 10.3 The bar (Q8)

Recommended: the page with the model ships when, on the six documents, **the shipped merge mode finds at least as many
as Claude through MCP with no more wrong ones, and at least as many as today's path with no wrong one more than
today's (0)**. A citation the page put in «Da completare» counts as found only if Claude did not find it either (#376
Q6's rule, kept). Six documents written by one hand are a small corpus: the figure is a gate, not a promise; the
honest line of §11 quotes the model project's blind figures, not this one.

## 11. Honesty to users

One line on the page, under the button, from the measured figures (the web owner's words):

> «Il modello trova circa 9 citazioni su 10 in documenti che non ha mai visto e sbaglia raramente l'atto (3 volte su
> circa 400 nelle prove); le leggi regionali e i regolamenti delle autorità li riconosce, ma il loro testo non è in
> VisuaLex. Controlla sempre le citazioni prima di depositare.»

The figure is updated with each version (§9.4); a version that measures worse changes the words before it ships.

## 12. Questions for the owners

1. **Architecture.** A separate internal container (A), the model inside the Python API (B), or the model in the
   browser (C)? *Trade-offs:* §4.1's table. *Recommendation:* **A** — its own memory and CPU ceiling, a crash that takes
   down only the model, rollout and rollback on its own, no network but to the API. C is the only one that keeps
   «nothing leaves», at the cost of a 270 MB download per user, no phones and public weights.
2. **The privacy promise** (words: the web owner with the other owner, I-2). The text now reaches the server. Per
   document and off by default (a button on today's result), on by default for every document with new words, or a
   setting switched on once? *Trade-offs:* per document keeps every confidential file a fresh decision and today's
   promise true until the user acts, at one click more; on by default finds more for everyone but makes the
   promise false by default for documents under professional secrecy; a setting is a middle way a lawyer forgets
   having switched on. Also: the privacy notice must say that document text is processed on the owners' host (§6.2)
   before the page offers it. *Recommendation:* **per document, off by default**, the words of §6.4, the notice changed
   first.
3. **Merging with today's results.** The model first with today's path filling its gaps (disagreements to complete),
   the model alone, or today's path first? *Trade-offs:* §5.1. *Recommendation:* **the model first, today's filling**,
   confirmed on §10's figures for all three modes; it keeps the decreti-legge the model's tables miss today.
4. **Deduced references.** Ship the «Dedotte — da verificare» section with the layer off, or on from the start?
   *Trade-offs:* on, about a third more of the references «named elsewhere» found, one more harmful on the model's
   blind corpus, 10–30% more time; off, nothing deduced but nothing guessed, and G-402's rule still inherits what the
   text says. *Recommendation:* **built, off at launch**, on when §10 shows it adds right rows with no wrong one more.
5. **Limits.** 300,000 characters per document (~120 pages, ~10 minutes estimated), parts of 30,000, a queue of two?
   *Trade-offs:* higher limits read longer briefs and keep others waiting; lower ones send long files back to today's
   path. *Recommendation:* **as proposed**, revised once the host's figures are in (§9.1).
6. **The model's code: licence and delivery.** The model project has no licence file and no remote. Either its
   runtime (the adapter, the assembler, the HTTP server, the vendored tables — not the training code, the data or the
   weights) enters this repository under MPL-2.0, as `services/citex/`, and the host builds its image as it builds the
   others; or the model project builds its own image, kept private, and this repository names it by digest.
   *Trade-offs:* the first keeps `./start.sh --prod` as it is, with no registry credential on the host, but makes the
   runtime public (of little use without the weights); the second keeps everything private, at the price of a private
   registry, a credential on the host and an image this repository's CI cannot build or test. The base model is
   Apache-2.0, the vendored tables Apache-2.0: both compatible with MPL-2.0. Licensing is decided by both owners
   together. *Recommendation:* **the runtime in `services/citex/` under MPL-2.0**, weights outside (Q7).
7. **The weights.** Copied by an owner to a directory on the host with a pinned SHA-256 (§9.2), baked into a private
   image, or downloaded at deploy time from a private release? *Trade-offs:* the copy needs no credential and no
   network, and is one manual step per version; the image makes rollback a tag, with a registry and its credential;
   the download needs a token on the host and the network at deploy. *Recommendation:* **the copy with the pinned
   checksum**, checked by the container and by `start.sh`.
8. **The bar of G-375.** On this spec's six documents: the shipped mode finds at least as many as Claude through MCP
   with no more wrong, and at least as many as today's path with no wrong one more? *Trade-offs:* the corpus is small
   and public; a blind corpus would be stronger but the model project uses its blind corpora for itself, and a corpus
   once used is no longer blind. *Recommendation:* **as stated**, with the precondition that the model never saw the
   six documents.
9. **Decisions and authority acts the model finds.** List them in this round (without a link), or leave them for a
   round of their own? *Trade-offs:* listing them shows the model's reach at once, but a decision's identity, its link
   and its completion by hand have rules this page does not have yet. *Recommendation:* **a round of their own**; this
   one lists norms only.

## 13. The pull requests, in order

| # | Where | What | Waits for |
| --- | --- | --- | --- |
| A | the model project (not this repository) | the `identified` category in the answer; the deduced layer as a per-request flag; `--threads`; a health answer with the version and the package's checksum; error answers that never echo the text; the reduced c4 package with its equivalence check and `SHA256SUMS`; a container image definition (or, under Q6's first answer, the runtime handed over for B) | the package |
| B | `infra/` (reserved in the owners' register first; CODEOWNERS review) | `infra/compose.citex.yml`: the internal network, the hardening, the ceilings, the read-only mount, the secret, `CITEX_ENABLED`; `start.sh --prod`'s checksum check; `infra/.env.example`'s new keys; under Q6's first answer, `services/citex/` with its Dockerfile and its licence header | Q1, Q6, Q7 |
| C | Python API, server quota | `citex_client.py`; `/extract_citations_model` and `/status`; the re-reading (§5.2); the queue and the timeouts; the logging test (§6.2); the price in `DEFAULT_SCRAPE_COSTS` (authentication's area: review asked) | B; tested against a stub container, never the model |
| D | `docs/…/measure/` | the model's recorded answers on the six documents; `score.py`'s three paths; the Claude-through-MCP recording; the table of §10 | A's package; Q8 |
| E | web | the button and its words, the parts and the progress, the merge (§5.1), the two new sections, the fallback (§8), the promise's tests both ways; `apps/web/CLAUDE.md` updated; a browser pass on the six documents | C, D's figure passing the bar, Q2's words |
| F | release | `CHANGELOG.md` with the figures; the privacy notice changed (Q2); the module switched on on the host only after §9.1's checks | E |

Nothing is deployed before the owners' answers, the PRs merged and a release.
