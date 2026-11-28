# The norms and decisions collectors: fast, and holding the load of every user

28 November 2026. Measure first, write the targets, then hit them. The constraints:

- **Rule 23.** Not one character of what the collectors return may change: `article_text`, the
  decision texts, the EU texts. Every change here is checked with `collector_timing.py --compare`
  (byte for byte) and the frozen-text tests.
- **The sources are not ours to load.** The real sources were asked once, politely (about 50
  requests, the harness's fixed list). Every load test runs on their recorded answers, served
  locally (`scripts/replay_*.py`). No change raises the requests any source receives.
- **Rewrites are the owners' call** (a collector in Rust, a new store, a throttle, a lifetime).

## How it is measured

| tool | what it does |
|---|---|
| `scripts/collector_timing.py` | the fixed list of real requests (now 21: a whole act and a Consiglio di Stato decision added), cold then warm, where each one's time goes; `--record <dir>` keeps every source answer; `--replay <dir>` answers from them; `--compare` checks the texts byte for byte |
| `scripts/replay_net.py` | records the sources' answers at the one door every collector uses (`aiohttp.ClientSession`), and serves them back after each one's recorded latency. Our throttle, retries, caches and parsing run as in production |
| `scripts/replay_server.py` | the API as production runs it (Hypercorn, one worker) on the recorded answers; `GET /__replay/stats` counts what would have reached each source |
| `scripts/replay_load.py` | N users at once: `warm` (a reading mix, every cache filled), `cold-same` (N users, one article, empty cache), `cold-distinct` (N users, N articles of the c.c.); p50/p95/p99, reads per second, errors, source requests per 100 reads |

The replay reproduces the real run: the same 21 requests replayed take the same time as live
(art. 2043 c.c. cold 13.57 s replayed, 13.67 s live) and return the same 72 texts, byte for byte.

Recorded answers are the sources' content (decisions carry personal data the source left): they
stay in a scratch folder, never in the repository.

## Baseline (develop at f710929f, a development Mac, load average 3–6)

### One read at a time, real sources

| read | cold s | requests | warm s |
|---|---|---|---|
| art. 2043 c.c. (first of the code: index + article page) | 13.67 | 2 | 0.06 |
| art. 2044 c.c. (index cached) | 5.52 | 1 | 0.11 |
| art. 183 c.p.c. | 4.54 | 2 | 0.04 |
| art. 612-bis c.p. | 3.56 | 2 | 0.03 |
| l. 241/1990 artt. 1-3 (5 articles) | 4.64 | 6 | 0.08 |
| d.lgs. 231/2001 art. 5, year only | 3.57 | 3 | 0.01 |
| art. 1284 c.c. at 1 Jan 2010 | 3.03 | 1 | 0.03 |
| l. 24/2017, the whole act (18 articles) | 10.79 | 19 | 0.27 |
| art. 6 GDPR (CELLAR) | 1.60 | 2 | 0.11 |
| Cass. civ. 12449/2024 | 1.11 | 2 | 0.001 |
| Corte cost. 242/2019 (the bundle kept locally) | 0.02 | 0 | 0.001 |
| CGUE C-634/21 | 1.61 | 2 | 0.001 |
| Cons. Stato 2270/2019 | **503** | 3 | 503 |

- **A cold read is Normattiva's wait.** Its answer time grows with the page: about 2.5 s per MB.
  An article page of a code weighs 1.2–2.6 MB, because it embeds the code's whole index: 1.4–6.6 s.
  An ordinary act's page weighs 75–180 KB: 0.3–0.9 s. Our parsing is 0.2–0.5 s of a cold read.
- **The Consiglio di Stato does not open.** The portal now answers the decision's document as HTML
  where the reader asks for XML (`text_from_document`: «documento senza provvedimento»), so every
  administrative decision answers 503. A source change, outside this work: reported apart.

### Where the warm time goes (in-process profile, 105 warm requests of the mix)

53 ms per request on average (profiled). 62 % of the CPU is BeautifulSoup re-reading pages the
service already read:

- **An EU article: 274 ms.** The act's page (824 KB for the GDPR) is parsed again for every article.
- **An article of a code: 73 ms.** Each read takes the 2.6 MB page from the disk cache three times
  and parses it again for the validity (14 ms), the update notes and the parts (22 ms), and decodes
  the code's index from JSON for the existence check.
- An ordinary act's article: 27–33 ms, for the same reasons on a smaller page. A decision: 1.3 ms.

### Under load (replayed sources, one worker as in production)

| scenario | users | reads/s | p50 s | p95 s | errors | source requests per 100 reads |
|---|---|---|---|---|---|---|
| warm mix | 10 | 28.0 | 0.36 | 0.57 | 0 | 0 |
| warm mix | 50 | 31.5 | 1.61 | 2.23 | 0 | 0 |
| warm mix | 200 | 30.8 | 6.69 | 7.92 | 0 | 0 |
| warm mix | 500 | 33.1 | 16.18 | 21.75 | 103 refused connections | 0 |
| cold, 50 users, one article (art. 2043 c.c.) | 50 | — | 122.8 | 170.0 | 27 of 50 timed out | **158** |
| cold, 50 users, 50 articles of the c.c. | 50 | — | 122.3 | 168.6 | 27 of 50 timed out | 158 |

Server memory after the warm runs: 493 MB.

- **Warm, the service saturates at about 30 reads per second**, all of it CPU in one process.
- **Cold, nothing is shared.** Fifty users opening the same article send 79 requests to Normattiva
  (fifty article pages and twenty-nine copies of the code's index), queued behind our own limit (3
  at once, 0.5 s apart): the last user waits three minutes, half of them get the time-out.

## Targets

Server side, the Python API, one Hypercorn worker, measured with the tools above.

| | baseline | target |
|---|---|---|
| T1 warm, one read: article of a code | 73 ms | ≤ 15 ms |
| T1 warm, one read: EU article | 274 ms | ≤ 15 ms |
| T1 warm, one read: article of an ordinary act | 27–33 ms | ≤ 10 ms |
| T2 warm mix, throughput | 31 reads/s | ≥ 120 reads/s |
| T2 warm mix, p95 at 50 / 200 / 500 users | 2.2 / 7.9 / 21.7 s, 103 refused | ≤ 0.5 / 2 / 5 s, none refused |
| T3 cold, 50 users on one article: requests to Normattiva | 79 | ≤ 2 |
| T3 cold, 50 users on one article: p95 | 170 s, 27 timed out | ≤ 16 s (one cold read is 13.6 s), none timed out |
| T4 cold, 50 users on 50 articles: requests to Normattiva | 79 | 51 (one page each, the index once) |
| T5 text | — | 0 characters changed (`--compare`, frozen tests) |
| T6 load on the sources | — | never more requests per 100 reads than today, in any scenario |

T4's latency is set by the limit toward Normattiva (3 requests at once, 0.5 s apart) and by the
2.6 MB page: at 6.4 s a page, three at a time, fifty pages take about 110 s whatever our code
does. Moving it is an owners' decision; the plan gives what each option buys.

## Plan, by gain per risk

Items 1–6 change no text and no limit toward a source: pull requests into develop, one each.
Items 7–11 need the owners.

| # | change | expected gain | risk to rule 23 | cost |
|---|---|---|---|---|
| 1 | the measurement tools above | the numbers, reproducible | none (scripts) | done |
| 2 | **one fetch for concurrent identical reads**: the shared client's identical GETs, a Normattiva document, an act's index share one run | T3: 79 → 2 requests, p95 170 → ~14 s | none: the same page through the same extractor | small |
| 3 | **a Normattiva page's validity, notes and parts computed once per stored page** (keyed by the entry's write time, the article and, for the validity, the day) | code article warm 73 → ~15 ms | none: `article_text` is not touched; the same functions on the same page | small |
| 4 | **an EU article's text extracted once per stored page** | EU article warm 274 → < 10 ms | none: the extractor's output kept, keyed by the page's write time and the article; the EU frozen test | small |
| 5 | parsing off the event loop (a Normattiva article page, an EU page) | warm reads stop waiting behind a cold 2.6 MB parse | none | small |
| 6 | the existence check without decoding the code's index from JSON on every read | ~8 ms per code article | none | small |
| 7 | owners: check an article on the index its own page carries (T17's proposal; identical on 3282 of 3282 c.c. articles) | first article of a code of the day: −6.6 s, one request less | none for the text | small |
| 8 | owners: the limit toward the sources per source instead of one queue for all, and Normattiva's concurrency | T4's ceiling (≈ 0.47 code pages/s today) | none | small, but it is the sources' load |
| 9 | owners: lifetimes. A dated text (a past day, the original) does not change: 30 days, as the decisions, instead of 24 h | fewer cold reads of the same page | none | small |
| 10 | owners: the article fragment Normattiva serves (`caricaArticolo`) instead of the article page that embeds the code's index, if a handful of polite requests show the extractor's text identical byte for byte | code article cold 6.4 → < 1 s, Normattiva's bytes / 100 | **to be proven** before anything is built | medium |
| 11 | owners: Rust | see below | | |

### Rust, by the profile

- **Cold:** our CPU is 3–7 % of a read (0.2–0.5 s of parsing against 1.4–6.6 s of Normattiva's
  wait). A faster language cannot shorten a network wait.
- **Warm:** 62 % of the CPU is parsing the same page again for every read. Items 3–4 remove the
  repetition itself; a faster parser would only make the waste cheaper.
- **Rule 23:** the frozen texts are what Python's `html.parser` and BeautifulSoup make of broken
  markup. Another parser repairs it differently: T17 measured `lxml` one space off on art. 524 c.p.,
  which would drop every anchor after it. A Rust parser (html5ever, lol_html) would have to
  reproduce `html.parser`'s repairs exactly, on every page Normattiva serves.
- **When to look again:** if, after items 2–6, the profile under load is still parsing-bound in
  our code, a PyO3 module for that one function is the route, proven on the frozen tests and on
  every page of the harness. Until then the answer is no.

## Production

One Hypercorn worker, the filesystem cache (no Redis), 2 GB and 30 days for the Normattiva pages.
Items 2–6 hold their state in the process's memory, bounded (item 3–4: an LRU of a few thousand
entries, a few tens of MB at most); a restart empties them and the pages on disk fill them again
without a request. Nothing changes in the persistent cache's files, the limits toward the sources,
or the workers.
