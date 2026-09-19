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

## Transport

Certificate verification is enabled for every outbound request.

## Reporting

Open a private issue or contact the maintainer directly.
