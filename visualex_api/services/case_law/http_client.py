"""A dedicated, separately-throttled HTTP client for the case-law package.

`visualex_api.services.http_client.http_client` is a single module-level
instance shared by every scraper in the product — Normattiva, EUR-Lex,
Brocardi, and (before this module existed) the four case-law adapters too.
Its throttle is global, not per-source: `HTTP_MAX_CONCURRENCY` bounds the
whole process to 3 concurrent outbound requests, and
`ThrottledHttpClient._respect_min_interval` holds one lock that serialises
every request 0.5s apart, across every source, regardless of which one issued
it.

One `/fetch_case_law` call fans out to four adapters and issues roughly seven
requests between them (CeRDEF and Italgiure each open a session-cookie GET
before their real query). On the shared client alone that burns >=3.5s in the
throttle before a single byte comes back — and `registry._SOURCE_TIMEOUT`
counts that queue time, not just source latency, so a few concurrent panel
opens start reporting healthy sources as timed out.

The half of this that actually matters for the product: reading an article —
Normattiva, EUR-Lex, Brocardi — shares that exact same semaphore and lock, so
every one of those requests queues behind whatever the case-law fan-out is
doing. Opening the case-law panel would make the reading surface slower for
everyone using the app at that moment, not just for the panel itself.

`ThrottledHttpClient` keeps no shared state at the class level — the
semaphore, the min-interval lock, the session and `_last_request_at` are all
instance attributes set in `__init__` — so a second instance is independent
of the first by construction. No change to the class itself; every adapter in
this package (and `tools/tls.py`'s italgiure AIA fetch, which exists only for
this package's `ItalgiureAdapter`) imports `case_law_http_client` instead of
the shared one, so case-law traffic can only ever queue behind itself.
"""
from __future__ import annotations

from ..http_client import ThrottledHttpClient

#: Own semaphore, own min-interval lock, own aiohttp session. Same egress
#: allowlist and retry/backoff behaviour as the shared client (both run
#: `ThrottledHttpClient.request`, unchanged) — only the throttling queue is
#: separate.
case_law_http_client = ThrottledHttpClient()
