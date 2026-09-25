# Security

## Where your queries go

VisuaLex sends no telemetry and has no analytics endpoint. These are the only
hosts the server is *meant* to contact — read the next section for how far that
is actually enforced today:

| Host | Operator |
|---|---|
| `www.normattiva.it` | Normattiva — Istituto Poligrafico e Zecca dello Stato |
| `eur-lex.europa.eu` | EUR-Lex — Ufficio delle pubblicazioni UE |
| `brocardi.it` | Brocardi.it — annotazioni dottrinali (fonte privata) |
| `www.brocardi.it` | Brocardi.it — annotazioni dottrinali (fonte privata) |

The list lives as data in `visualex_api/tools/egress.py`.

## How that claim is enforced

Two mechanisms, with different guarantees:

- **Static.** `tests/test_egress_allowlist.py` walks every `.py` file under
  `visualex_api/` plus the root `app.py` and fails if a URL literal names a host
  that is not declared. It checks what is *written in the code*. It would not
  catch a URL assembled from fragments at runtime, and nothing here claims
  otherwise.
- **Runtime.** `is_allowed()` is checked in `ThrottledHttpClient.request` before
  every request made **through the shared HTTP client**, so a host that is not on
  the list is refused there even if the URL was built dynamically. That client
  carries the scrapers' document fetches; it is not the only way this process
  opens a socket.

### Not yet covered

Three paths reach the network without passing `is_allowed()`. They are known and
open, not oversights:

- **`POST /fetch_tree`.** The caller-supplied `urn` goes to
  `tools/treextractor.get_tree`, which opens its own `aiohttp` session
  (`treextractor.py`, the `aiohttp.ClientSession` in `get_tree`) instead of using
  the shared client. An arbitrary URL in that field is fetched — including one
  pointing at a host on the deployment's internal network. Routing this call
  through `ThrottledHttpClient` is the fix and is not done yet.
- **Playwright navigation.** `page.goto()` in `tools/treextractor.py`,
  `services/eurlex_scraper.py` and `services/pdfextractor.py` drives a real
  browser and never consults the allowlist. `POST /export_pdf` has its own,
  narrower guard (`is_allowed_pdf_urn`, Normattiva URNs only); the other two do
  not.
- **Redirects.** The shared client checks the host of the URL it is given.
  `aiohttp` follows redirects by default and the client does not re-check the
  target, so an allowed host that answers with a 302 can move the request
  somewhere unlisted.

If you are evaluating this server for client work, treat the table above as the
list of sources it consults on its own initiative, and this section as the list
of ways a crafted request could still make it fetch something else.

## MERL-T (branch `visualex-merlt-main` only)

Everything above describes the product on `main`, and it still holds for the
Python API on this branch. On `visualex-merlt-main`, with `MERLT_ENABLED=true`,
user data also leaves the Node BFF for the MERL-T sidecar, and from there for
two more destinations. None of them is in `egress.py`, and `is_allowed()`
checks none of them.

| Destination | What it is | What it receives |
|---|---|---|
| MERL-T (`merlt-api`, `merlt-worker`) | FastAPI + RQ containers on the same host (`docker-compose.merlt.yml`). Every port is bound to `127.0.0.1` | Everything listed per consent level below, stored in its own Postgres, FalkorDB, Qdrant and the `merlt_uploads` volume |
| OpenRouter (`openrouter.ai`) | The LLM API the experts, the synthesizer and the note extractor call, with `OPENROUTER_API_KEY` | Q&A questions with the retrieved legal context, and the text of uploaded notes during extraction |
| `mcp-legal-it` | An MCP server of Italian legal tools, vendored as the git submodule `vendor/mcp-legal-it` and run as a container | Tool arguments the LLM derives from the question (search terms, references). The public sources it queries in turn are defined by the submodule, not by this repository |

What leaves depends on the consent level. The BFF stores it
(`MerltUserPreference`: `none`, `basic`, `full`) and enforces it on every
route. The frontend copy is only a cache.

- **Any level, including `none` (reading is free).**
  - Opening the graph side rail or `/grafo` sends the article URN and any graph
    search terms to MERL-T, without a user id.
  - The hub's profile card sends the VisuaLex user id
    (`/api/v1/profile/full?user_id=`).
- **`basic`.**
  - The five tracking signals, each with the user id and the cached authority
    score:
    - article views: URN, dwell time, scroll depth;
    - highlights: the selected text and its colour;
    - anchored notes: the note text and the selected text;
    - bookmark and dossier additions: URN and dossier id;
    - citation clicks: the citation text;
    - forum signals: shared-environment id and author ids.
  - Q&A questions (sync, async and follow-ups), with the user id. MERL-T
    stores every question verbatim in `qa_traces`; the consent level only
    redacts it when a trace is read back. MERL-T sends each question to
    OpenRouter and may pass derived arguments to `mcp-legal-it`.
  - Lazy ingestion requests for the articles opened (the URN only).
- **`full`, everything above plus:**
  - **Uploaded notes.** The file stays on the `merlt_uploads` volume until
    extraction, and stays longer when nothing was staged, so a retry is
    possible. Its text goes to OpenRouter. The extracted candidates, verbatim
    excerpts included, sit in `extraction_candidates` for 48 hours.
  - **Contributions.** Promoted proposals (the reformulated text and the
    user's source reference) and votes.
  - **Q&A feedback.** Ratings, comments, preferences and "ricorda nel grafo".
  - **NER feedback.** Up to 1200 characters of context around a citation, from
    the article text or from an answer.
  - **`search_mining`.** Legal references mined from the user's own questions.

Revoking consent stops new sends. It does not delete what MERL-T already
stores.

On the VisuaLex side, the BFF keeps:

- `merlt_qa_jobs`: the question and the full result. Finished rows are purged
  after `MERLT_QA_RETENTION_DAYS`, default 30.
- The consent level and its audit trail, and the authority cache.
- `backend/logs/merlt-dead-letter.jsonl`: the full payload of every tracking
  event that failed to reach MERL-T. It is capped at 50 MB and never rotated.

**The trust boundary is the BFF.** MERL-T makes its API key optional on every
route except those behind `require_role("admin")`. Its admin configuration and
graph-hygiene routes are therefore open to anyone who can reach port 8000. The
BFF authenticates the user, checks consent and admin rights, and injects the
user id; MERL-T trusts it. Keep every MERL-T port bound to `127.0.0.1`, as
the compose file does, and never publish `:8000`. Callbacks from MERL-T to the
BFF must carry `X-Internal-Secret`.

## Transport

Certificate verification is enabled for every outbound request.

## Reporting

Open a private issue or contact the maintainer directly.
