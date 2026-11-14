# «Analizza documento» reads with the citex model — a model behind the page

**Status:** approved by one owner, 10 November 2026 (G-446 … G-449): all nine questions of §12 answered as
recommended. Q2 (the promise) and Q6 (the licence of the model's runtime) wait for the other owner's answer — the
page's words are the web owner's (I-2), and a licence is decided by both owners together. No product code, no
`infra/` change and no model run is made before that answer; §14 records a study the owner asked for, not a
commitment.
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
  - its limits: regional laws and authority regulations are identified, not served (above); trained on
    legislation, judgments and authority decisions, briefs and contracts seen only through the blind corpus.
    **Decreti-legge resolve:** «d.l.», «D.L.», «decreto-legge» and «decreto legge» with a date and a number, since a
    correction of its assembler of 9 November (G-440), with a unit test; the earlier model card that lists them among
    the limits predates it.
- **Size:** 287M parameters, 1.1 GB in fp32. **The reduced c4 package** (vocabulary pruned, weights stored fp16):
  136.8M parameters, **274 MB**, SHA-256 of its `model.safetensors`
  `c38f5eb908a4bcbb2fb2403e929d0c3eb2f6521d48ba5f9725fe3e21778e6641`. Equivalent to the fp32 weights on its project's
  checks: the test set's components identical (F1 0.9736), its blocks 0.9411 against 0.9409, its older blind corpus
  identical (97.2%, 0 harmful). On a CPU the fp16 weights are loaded back into fp32: the package saves disk, memory and
  load time, not inference time.
- **Speed and memory, measured** on an 8-core desktop CPU, 4 threads, the whole pipeline, torch's CUDA build (windows
  of 90 words, 25 of overlap):

  | | Reduced package | fp32 |
  | --- | ---: | ---: |
  | load | 4.6 s | — |
  | resident before loading (mostly torch's CUDA build) | 511 MB | — |
  | resident, idle | 1,209 MB | 2,118 MB |
  | resident, peak | 1,805 MB | 3,183 MB |
  | a window of ~400 characters | 0.17 s | the same |
  | ~20 pages (60,360 characters, 166 windows) | 36.5 s | the same |

- **On the deployment host,** a 2017 laptop with four cores and 16 GB, shared with the whole stack — **estimated** at 2–3
  times the desktop, to be measured there: 0.35–0.5 s a window; 10 pages 35–55 s, 20 pages 75–110 s, 100 pages
  (~300,000 characters) 6–9 minutes; with torch's CPU-only build about 1.0–1.2 GB resident idle, about 1.6 GB at the
  peak. Deduced references add 10–30%, estimated, not measured.

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

### 4.1 A separate internal container (decided: G-446)

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

C is the one that would keep today's promise. It is not built now; the owner asked for it to be studied after the
server path ships (§14).

### 4.2 The route on the Python API

- **`POST /extract_citations_model`**, body `{"text": string, "offset": int, "part": int, "parts": int}`; `text` at most
  30,000 characters (§7.1). The path sits under the `/extract_citations*` prefix, so the ingress routes it behind the
  login and the quota and Vite proxies it **with no change to the Caddyfile, the Vite configuration or the path
  test**, as `/parse_query_batch` did under `/parse_query*`.
- **`GET /extract_citations_model/status`** → `{"available": bool, "model": "c4-…", "max_chars": int}`: whether the
  page offers the model at all (§6.3). It costs nothing in the quota; it says nothing about any document.
- **Its price:** a line of its own in `DEFAULT_SCRAPE_COSTS`, 10 points a part (proposed): a 100-page document is
  about 10 parts, 100 points; one user cannot keep the model busy for more than about 30 parts a minute. Authentication's
  area: its owner reviews it.
- **What it does:** checks the body (a 400 naming the limit otherwise); asks the container; re-reads each reference
  (§5.2); adds `offset` to every span; answers rows in the page's own shape. Nothing is kept once the answer is sent.
- **When it cannot:** module off → 503 `{"reason": "disabled"}`; container down or failing its health → 503
  `{"reason": "unavailable"}`; queue full (§7.3) → 503 `{"reason": "busy"}` with `Retry-After`; a part over its time
  → 504. The page falls back in all four (§8).

## 5. Merging with today's results

### 5.1 The rule (Q3, decided: G-449)

Both paths run on a document read with the model. **The model first, today's path fills its gaps:**

1. A span both paths read **with the same act and the same article** is one row, drawn as found.
2. A span the model resolves and today's path does not (or leaves to complete) → the model's row.
3. A span today's path resolves and the model misses or leaves unresolved → today's row (the model misses about one
   citation in eight on its blind corpus; today's rules, written for briefs, keep those that they read).
4. A span **both read with a different act or article** → «Da completare», with both readings offered first in the
   picker («Il modello legge: …», «La ricerca legge: …»). Never a silent choice.
5. A span the model types `non_fonte` («art. 5 del contratto») and today's path sends to «Da completare» → «Non sono
   norme», with «Ripristina», as a dismissed row today. If today's path *resolved* it, rule 4.
6. Spans that overlap without matching (a list read as one by one path, two by the other) are compared article by
   article; an article only one of them reads follows rule 2 or 3.

Rows keep their origin for the measure (§10) and for the row's menu («letta dal modello», «letta come nella ricerca»),
not as a badge on every row — the web owner decides whether it shows at all.

Alternatives: the model alone, today's path only as the fallback (simpler, loses what the model misses); or today's path first and the model only for what it leaves (keeps today's 0 wrong, gains less).
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

### 5.4 Deduced references (Q4, decided: G-449)

The model's optional layer links «del medesimo decreto», «della citata legge» to an act named before. The browser's
own inheritance (G-402) already does this when the text says so. Both are kept apart:

- a span the browser inherits and the model deduces to the same act → the inherited row (today's), as found;
- to a different act → «Da completare», rule 4;
- deduced by the model only → «Dedotte — da verificare».

The model project's release configuration has the layer **off**. Decided: build the section, ship with the layer
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

### 6.3 How the page asks (one owner: per document, G-447; the other owner's answer pending)

Three ways a document can be read; the page offers the third only when `/status` says the model is available:

| Mode | What reaches VisuaLex | Today |
| --- | --- | --- |
| «Riconosci solo nel browser» (G-393 Q3) | nothing | the switch, off by default |
| as today | the query strings of the citations | the default |
| **«Leggi con il modello»** | the text of the document, in parts | new |

One owner's answer (Q2, G-447): **per document, off by default.** Today's path runs first, as now, and its result shows at once; a
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

### 7.1 Parts, cut in the browser (decided: G-449)

The browser cuts the text at paragraph ends into **parts of at most 30,000 characters** (~10 pages, ~83 windows:
~18 s measured on the desktop, 35–55 s estimated on the host), never inside a paragraph; a paragraph longer than a part is cut at a sentence end, and
the two parts overlap by that sentence, the overlap's duplicates removed by span. Parts go one after the other.

- **Progress** is the parts done: «Lettura con il modello: parte 3 di 12», a bar, and «Interrompi», which aborts the
  request in flight and keeps what came. Rows of a finished part enter the list as they come.
- **No job on the server.** The API holds a part for the length of its request and nothing between two: no job store
  to secure, to expire or to lose when the single worker restarts, and the text is never on the server longer than a
  part's reading. The cost: the model's deduced references cannot reach back across a part boundary (§5.4: off at
  launch anyway).
- Alternative: a server job (`POST` the whole text, poll its progress). One request, but the whole text held on the
  server for minutes, a job store in a single process, and an expiry to write. Not recommended.

### 7.2 Limits (Q5, decided: G-449; revised with the host's figures, §9.1)

| Limit | Proposed | Why |
| --- | --- | --- |
| a part | 30,000 characters, body ≤ 128 KB | well under the ingress's 1 MB and the model's 200,000 |
| a document read with the model | 300,000 characters (~100 pages); beyond it the button says the document is too long and today's path stays | 6–9 minutes on the host at the estimates: past that, a user waits too long and blocks others; 150,000 if the host's measure is slower |
| a part's time | 90 s at the API, then 504 | a part is 35–55 s estimated on the host; past 90 s the model is stuck or the host overloaded |
| the queue | one part reading and two waiting, across all users; a third → 503 `busy`, `Retry-After: 15` | memory stays flat (one inference at a time is the model's own rule); waits stay bounded |
| per user | the quota: 10 points a part (§4.2) | |

### 7.3 Several users at once

The container reads one part at a time. Parts of different users interleave in the API's queue, first come first
served; a user's next part is sent only when the previous one is answered, so a long document does not lock out a short
one for more than one part (under a minute). The page retries a `busy` part after `Retry-After`, up to 2 minutes, then falls
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

| | Measured on a desktop (§2.2) | Estimated on the host | To confirm on the host before switching on |
| --- | --- | --- | --- |
| model | the reduced c4 package, 274 MB on disk; only the reduced package is deployed, never the 1.1 GB weights | — | its checksum (§9.2) |
| load | 4.6 s | ~10 s | — |
| memory, idle | 1.21 GB resident (torch's CUDA build) | 1.0–1.2 GB (CPU-only build) | measured after load |
| memory, peak | 1.81 GB (CUDA build) | ~1.6 GB; flat while reading (one inference at a time) | measured over a 100-page document |
| ceiling | — | `mem_limit: 2g` (`CITEX_MEM_LIMIT`), `pids_limit: 128`: ~0.4 GB over the estimated peak | that the peak stays under 1.7 GB, else 2.5g; that the host has the ceiling free with the whole stack up |
| CPU | 4 threads of 8 cores: 0.17 s a window | `cpus: 2` (`CITEX_CPUS`), torch threads 2 (`--threads 2`): 0.35–0.5 s a window; two of the four cores stay with the stack | the seconds a window with two threads; that searches stay responsive while it reads |
| a part (30,000 characters) | ~18 s | 35–55 s | under the 90 s timeout (§7.2) |
| load over time | — | at most one part at a time; with the quota, at most ~60–100 parts an hour in practice | — |
| image | — | ~550 MB of libraries (torch CPU-only), the weights mounted, not baked in | — |

If the host cannot give the ceiling and two cores, the module stays off: the page works as today.

### 9.2 Where the weights live, and how the host gets them (Q7, decided: G-449)

The weights never enter this repository, nor its image:

- the model project produces a **versioned package**, `citex-<version>/` (weights, tokenizer, configuration,
  `SHA256SUMS`), and keeps its master copy and a backup off the host;
- an owner copies it to the host into a directory outside the checkout (`CITEX_MODEL_DIR` in `infra/.env`; one
  sub-directory per version, the previous one kept);
- `infra/.env` pins `CITEX_MODEL_VERSION` and `CITEX_MODEL_SHA256` (the checksum of the package's `SHA256SUMS`). The
  first package is c4's: its `model.safetensors` has the SHA-256 given in §2.2; its `SHA256SUMS` is written when the
  package is handed over (PR A);
- the container mounts the version **read-only** and, before it loads, checks every file against `SHA256SUMS` and that
  file against the pin; on any mismatch it refuses to start, its health fails, `/status` says unavailable, the page is
  today's. `./start.sh --prod` checks the same before it starts the module and says why it does not;
- the data backup (`scripts/backup.sh`) does not carry the weights: they are not data, they are a release artefact
  with its own master copy.

The alternatives Q7 weighed, not chosen (G-449): a private container image with the weights inside (a registry and its
credential on the host); a download from a private release at deploy time (a token on the host, and the network at
deploy).

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

- **Precondition, verified (10 November):** the six documents were never in the model's data — training, development,
  test, synthetic examples, rinvio lots, gold sets or its blind corpora. Its project checked it without reading them,
  by counting the 8-word sequences they share with its data: 1–14%, all common legal phrasing or the verbatim text of
  art. 1218 c.c. quoted in a brief, where a document trained on would share nearly all. They are public in this
  repository, so the check is repeated for each new model version before it is scored.
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

### 10.3 The bar (Q8, decided: G-449)

The page with the model ships when, on the six documents, **the shipped merge mode finds at least as many
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

## 12. Questions for the owners — answered by one owner

Answered on 10 November 2026 (G-446 … G-449), each as recommended. Q2 and Q6 also need the other owner's answer, which
is pending; the build of what depends on them waits for it (§13). Kept as asked, with the answer.

1. **Architecture.** A separate internal container (A), the model inside the Python API (B), or the model in the
   browser (C)? *Trade-offs:* §4.1's table. *Recommendation:* **A** — its own memory and CPU ceiling, a crash that takes
   down only the model, rollout and rollback on its own, no network but to the API. C is the only one that keeps
   «nothing leaves», at the cost of a 270 MB download per user, no phones and public weights.
   *Answer (10 November, G-446):* A, a separate container on the deployment host, closed to the outside.
2. **The privacy promise** (words: the web owner with the other owner, I-2). The text now reaches the server. Per
   document and off by default (a button on today's result), on by default for every document with new words, or a
   setting switched on once? *Trade-offs:* per document keeps every confidential file a fresh decision and today's
   promise true until the user acts, at one click more; on by default finds more for everyone but makes the
   promise false by default for documents under professional secrecy; a setting is a middle way a lawyer forgets
   having switched on. Also: the privacy notice must say that document text is processed on the owners' host (§6.2)
   before the page offers it. *Recommendation:* **per document, off by default**, the words of §6.4, the notice changed
   first.
   *Answer (10 November, G-447):* per document, off by default, the privacy notice changed first — with a note: also
   study a way for the model to run on the user's own machine (WebAssembly or another), §14. **The other owner's
   answer is pending** (the page's words are the web owner's, I-2).
3. **Merging with today's results.** The model first with today's path filling its gaps (disagreements to complete),
   the model alone, or today's path first? *Trade-offs:* §5.1. *Recommendation:* **the model first, today's filling**,
   confirmed on §10's figures for all three modes; today's rules keep what the model misses (about one citation in
   eight on its blind corpus). *(Amended 10 November: an earlier draft gave the decreti-legge as an example; the
   model resolves them, §2.2.)*
   *Answer (10 November, G-449):* as recommended.
4. **Deduced references.** Ship the «Dedotte — da verificare» section with the layer off, or on from the start?
   *Trade-offs:* on, about a third more of the references «named elsewhere» found, one more harmful on the model's
   blind corpus, 10–30% more time; off, nothing deduced but nothing guessed, and G-402's rule still inherits what the
   text says. *Recommendation:* **built, off at launch**, on when §10 shows it adds right rows with no wrong one more.
   *Answer (10 November, G-449):* as recommended.
5. **Limits.** 300,000 characters per document (~100 pages, 6–9 minutes estimated on the host), parts of 30,000, a queue of two?
   *Trade-offs:* higher limits read longer briefs and keep others waiting; lower ones send long files back to today's
   path. *Recommendation:* **as proposed**, revised once the host's figures are in (§9.1).
   *Answer (10 November, G-449):* as recommended.
6. **The model's code: licence and delivery.** The model project has no licence file and no remote. Either its
   runtime (the adapter, the assembler, the HTTP server, the vendored tables — not the training code, the data or the
   weights) enters this repository under MPL-2.0, as `services/citex/`, and the host builds its image as it builds the
   others; or the model project builds its own image, kept private, and this repository names it by digest.
   *Trade-offs:* the first keeps `./start.sh --prod` as it is, with no registry credential on the host, but makes the
   runtime public (of little use without the weights); the second keeps everything private, at the price of a private
   registry, a credential on the host and an image this repository's CI cannot build or test. The base model is
   Apache-2.0, the vendored tables Apache-2.0: both compatible with MPL-2.0. Licensing is decided by both owners
   together. *Recommendation:* **the runtime in `services/citex/` under MPL-2.0**, weights outside (Q7).
   *Answer (10 November, G-448):* only the code that runs the model, in this repository under MPL-2.0; training, data
   and weights private. **The other owner's answer is pending** (a licence is decided by both owners together).
7. **The weights.** Copied by an owner to a directory on the host with a pinned SHA-256 (§9.2), baked into a private
   image, or downloaded at deploy time from a private release? *Trade-offs:* the copy needs no credential and no
   network, and is one manual step per version; the image makes rollback a tag, with a registry and its credential;
   the download needs a token on the host and the network at deploy. *Recommendation:* **the copy with the pinned
   checksum**, checked by the container and by `start.sh`.
   *Answer (10 November, G-449):* as recommended.
8. **The bar of G-375.** On this spec's six documents: the shipped mode finds at least as many as Claude through MCP
   with no more wrong, and at least as many as today's path with no wrong one more? *Trade-offs:* the corpus is small
   and public; a blind corpus would be stronger but the model project uses its blind corpora for itself, and a corpus
   once used is no longer blind. *Recommendation:* **as stated**, with the precondition that the model never saw the
   six documents.
   *Answer (10 November, G-449):* as recommended. The precondition is verified (§10.1).
9. **Decisions and authority acts the model finds.** List them in this round (without a link), or leave them for a
   round of their own? *Trade-offs:* listing them shows the model's reach at once, but a decision's identity, its link
   and its completion by hand have rules this page does not have yet. *Recommendation:* **a round of their own**; this
   one lists norms only.
   *Answer (10 November, G-449):* as recommended.

## 13. The pull requests, in order

| # | Where | What | Waits for |
| --- | --- | --- | --- |
| A | the model project (not this repository) | the `identified` category in the answer; the deduced layer as a per-request flag; `--threads`; a health answer with the version and the package's checksum; error answers that never echo the text; the reduced c4 package's `SHA256SUMS` (the package and its equivalence check exist since 10 November, §2.2); the runtime handed over for B (G-448), or a container image definition if the other owner answers Q6 otherwise | — |
| B | `infra/` (reserved in the owners' register first; CODEOWNERS review) | `infra/compose.citex.yml`: the internal network, the hardening, the ceilings, the read-only mount, the secret, `CITEX_ENABLED`; `start.sh --prod`'s checksum check; `infra/.env.example`'s new keys; under Q6's first answer, `services/citex/` with its Dockerfile and its licence header | the other owner's answer to Q6 (Q1, Q7 decided) |
| C | Python API, server quota | `citex_client.py`; `/extract_citations_model` and `/status`; the re-reading (§5.2); the queue and the timeouts; the logging test (§6.2); the price in `DEFAULT_SCRAPE_COSTS` (authentication's area: review asked) | B; tested against a stub container, never the model |
| D | `docs/…/measure/` | the model's recorded answers on the six documents; `score.py`'s three paths; the Claude-through-MCP recording; the table of §10 | A's package; Q8 |
| E | web | the button and its words, the parts and the progress, the merge (§5.1), the two new sections, the fallback (§8), the promise's tests both ways; `apps/web/CLAUDE.md` updated; a browser pass on the six documents | C, D's figure passing the bar, the other owner's answer to Q2 and the page's words |
| F | release | `CHANGELOG.md` with the figures; the privacy notice changed (Q2); the module switched on on the host only after §9.1's checks | E |

Nothing is deployed before both owners' answers, the PRs merged and a release.

## 14. Follow-up study: running the model on the user's machine

Asked by the owner with the answer to Q2 (G-447): study a way for the model to run on the user's own machine, so that a
document need not leave it at all. **A study to do after the server path ships (PR F), not a blocker of it and not a
commitment:** its outcome is a short report with figures and a recommendation, and a decision of its own.

### 14.1 The ways to study

| Way | What it is | What it would change |
| --- | --- | --- |
| in the browser, WebAssembly | the model exported to ONNX and run by a WebAssembly runtime (SIMD and threads) in a Web Worker, as the DOCX reader runs | the promise stays «Il documento resta sul tuo computer» with the model too |
| in the browser, WebGPU | the same export on the graphics card, where the browser offers it | faster where it works; nothing where it does not |
| a desktop app | a future VisuaLex app for the computer, with a native runtime (CPU, or the Mac's GPU) | no download per visit; an installer and its updates to maintain |
| a local service | the model's own demo server, run by the user on their computer, called by the page on the loopback address | already exists for one machine; asks the user to install and run it |

### 14.2 What would have to be measured

- **The export:** that GLiNER2's encoder and its two heads export to ONNX at all, and that the exported model scores as
  c4 on the model project's test set and blind corpus — the same equivalence check the reduced package passed (§2.2),
  no harmful citation more.
- **The download:** 274 MB in fp16 today; what compression gains; the int8 storage its project rejected (~140 MB,
  more harmful errors) stays rejected unless re-measured. Kept in the browser's storage once per version, so a second
  visit downloads nothing; how long the first visit takes on an ordinary office connection.
- **Speed:** seconds a window on WebAssembly and on WebGPU, on the machines lawyers have — a five-year-old Windows
  laptop, a recent Mac — against the server's 0.35–0.5 s (§2.2): a 20-page brief must not take ten minutes.
- **Memory in the tab:** the fp32 weights and the activations inside one browser tab, against what browsers allow.
- **A phone or a tablet:** whether it runs at all; the expectation is no, and the page then keeps the server path or
  today's.
- **The assembler:** the model's assembler and its tables are Python; in the browser they would be ported or run
  under a Python-in-WebAssembly runtime — a cost to measure, and a second copy of rules to keep in step.

### 14.3 What it would decide

- **The weights become public.** A model that runs on the user's machine is a model every signed-in user can copy.
  G-448 keeps the weights private; running in the browser or in a desktop app reverses that, and is the owners'
  decision before anything is built.
- **Which path is the default.** If local runs well enough, «Leggi con il modello» could run locally where the machine
  allows and on the server only where it does not, with the words of §6.4 saying which.
