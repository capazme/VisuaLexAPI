# Case law in VisuaLex — Design

Round opened 2026-08-29. Owner asked for every jurisdictional body carried by
`mcp-legal-it`, linked to the norm being read, searchable and readable one by
one.

## Context

VisuaLex reads norms. It fetches them live from Normattiva, EUR-Lex and Brocardi
and stores no legal content — only user-owned data lives in Prisma. This round
adds decisions: what the courts have made of the article on screen.

The sibling repo `mcp-legal-it` already talks to seven sources. Five are courts
(Cassazione, Corte costituzionale, CGUE, TAR/Consiglio di Stato, tributaria); two
are administrative authorities (Garante privacy, Consob) and are a different kind
of thing.

## Method

Every claim below was checked against the live source before it was written
down. Where a check failed or was not run, it says so.

## What was measured

### Verified working

**CGUE — EUR-Lex CELLAR.** Public SPARQL endpoint, no authentication. A judgment
carries `cdm:work_cites_work`, a citation graph declared by the publisher. The
query "which CJEU decisions cite the GDPR" returns CELEX + ECLI directly:

```sparql
?norma cdm:resource_legal_id_celex '32016R0679' .
?sent  cdm:work_cites_work ?norma .
```

12 results on a `LIMIT 12`, spanning 2016 to 2026. **The norm → decision link is
structural here**, not inferred. No coverage cut-off.

**Cassazione — Italgiure.** The Solr endpoint answers a request that identifies
itself honestly (`User-Agent: VisuaLex/1.5 (…; +https://visualex.org)`) with TLS
verification fully enabled: 1594 civil decisions citing "art. 2043". The
"anti-bot check" is a session cookie obtained by fetching the homepage first —
ordinary client behaviour, not circumvention. No spoofing is needed.

### The TLS finding, which corrects the source repo

`mcp-legal-it` uses `verify=False` for Italgiure and states its CA is absent from
`certifi`. That is wrong. The chain is:

```
CN=www.italgiure.giustizia.it, O=Ministero della Giustizia   (to 2027-03-28)
  └─ CN=TI Trust Technologies OV CA
       └─ CN=USERTrust RSA Certification Authority           ← present in certifi
```

The server omits the intermediate, which is why verification fails with "unable
to get local issuer certificate" — from Python, under both `certifi` and the
system store. Fetching the intermediate from the certificate's own AIA URI
(`http://tiTrust.crt.sectigo.com/TITrustTechnologiesOVCA.crt`) and adding it to
the bundle makes verification pass completely. Measured.

`curl` on macOS succeeds without this because it uses the Keychain, whose roots
differ. That false negative is worth remembering: **test TLS the way the server
will, not the way the laptop does.**

### Coverage, and why it is not a choice

Italgiure's public archive (SentenzeWeb) publishes the **last five years on a
rolling window**. The "2020+" limit in `mcp-legal-it` is not its own decision, and
it moves: decisions age out. A silent empty result therefore means "nothing in
the last five years", never "nothing".

### The open-data portals, and why they lose to live querying here

| Body | Official route | Coverage | Licence |
|---|---|---|---|
| Corte costituzionale | `dati.cortecostituzionale.it` | 1956 → today, ~20 000 | CC BY-SA 3.0 |
| TAR / Consiglio di Stato | OpenGA (CKAN) | from Dec 2024, 31 bodies | CC BY 4.0 |
| CGUE | CELLAR | complete | EUR-Lex reuse |
| Cassazione | none documented | 5 rolling years | undeclared |

Three of the four courts publish licensed open data, and it is better material
than the sites they scrape. But CKAN indexes **datasets**, not decisions — a
search for "sentenze" returns "CDS - Sentenze, 12 resources", not a list of
rulings — and the Corte costituzionale client in `mcp-legal-it` downloads
**decade bundles**, unzips them and caches per year on disk.

The owner ruled out downloading anything, on freshness grounds. That rules the
portals out for everything except one case, below.

### Not measured

- The live search shape of TAR / Consiglio di Stato. The portal was reorganised
  in 2026; the source client documents 404s on old paths and a portlet id that
  must be read at runtime. Fragile, and unverified by us.
- The live search shape of the tributaria source (`def.finanze.it`).
- Whether the Corte costituzionale exposes a per-decision live route. Its SPARQL
  endpoint answers 200 but returned nothing to the queries tried.
- Whether the norm link for TAR/CdS and tributaria is structured or textual.

### The link quality problem

`giurisprudenza_su_norma` in the source repo is a full-text search over the OCR
of decisions. `build_norma_variants("art. 2043 c.c.")` becomes

```
ocr:("art. 2043" OR "articolo 2043" OR "2043 c.c." OR "2043 codice civile" …)
```

Three weaknesses, all read from the code:

1. `"art. 2043"` appears **without the code**, so a decision citing art. 2043
   c.p.c. lands in the results for art. 2043 c.c.
2. The ordinal suffix list stops at `decies` — the same bug fixed twice in this
   repo (gotcha 9). Normattiva goes past it.
3. Nothing separates a decision that turns on the article from one that mentions
   it in passing.

This is the nature of the mechanism, not a defect to fix first. It is why the
design labels the link rather than hiding it.

## Goals

- The article on screen carries the decisions that bear on it (owner priority 1).
- A cited decision can be pulled up by body, number and year (priority 2).
- Decisions can be searched by text (priority 3).
- The reader can always tell how strong the link to the norm is.

## Non-goals

- Storing a searchable corpus of decisions. Live retrieval only (D3).
- Ranking decisions from different bodies against each other (see D2).
- Judging whether a decision says what the citing text claims. Existence and
  metadata only.
- Garante privacy and Consob. Their acts are administrative, not jurisdictional;
  including them by inertia would blur the distinction.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Five bodies: Cassazione, CGUE, TAR/CdS, tributaria, Corte costituzionale.** Garante and Consob are out. | Owner asked for the jurisdictional bodies. The two authorities are a separate product question. |
| D2 | **One adapter per body; the link's provenance is shown, never averaged away.** Each row carries `cited` (declared by the source) or `matched` (found in the text). No cross-source relevance ranking. | Ranking a declared CELLAR citation against an OCR hit pretends they are the same evidence. The difference is exactly what a lawyer needs in order to know how far to trust the row. |
| D3 | **Live retrieval, nothing stored** — one narrow exception. Corte costituzionale years that are closed are immutable, so their official distribution file may be fetched and held in the existing cache manager under a TTL, like any other cached fetch. The current year is always live. No index is built, nothing is written outside the cache, and no other body gets this exception. | The freshness objection is sound for rolling datasets. It does not apply to 1956–2025, and refusing it would cost the only source covering seventy years. Bounding it to "a cached fetch of a closed year" keeps it from becoming a corpus by degrees. |
| D4 | **TLS verification stays on for every source.** Italgiure gets the AIA intermediate added to its bundle. `verify=False` does not enter this repo. | Verification was re-enabled repo-wide in the previous round. Measured: pinning the intermediate is sufficient. |
| D5 | **Honest User-Agent everywhere**, naming VisuaLex with a contact URL. No spoofed browser strings. | Verified to work against Italgiure, the hardest case. A production server pretending to be Chrome is a different posture from a personal tool. |
| D6 | **Every adapter goes through `ThrottledHttpClient`.** | It brings the throttle, retry, backoff, circuit breaker and the egress allowlist for free — the same reasoning as D7 of the previous round. |
| D7 | **Port the source clients, do not rewrite them.** ~2400 lines across the five. | They are already written against the live sites and carry hard-won notes about breakage. Rewriting would rediscover the same traps. |
| D8 | **Ship in the order the evidence allows**: the implementation plan that follows this spec covers **CGUE and Cassazione only**, plus the interface, the panel and the failure behaviour. TAR/CdS, tributaria and Corte costituzionale get their own plans once their recon lands. | Both are verified today. TAR/CdS carries the most unknowns and must not hold the rest hostage; and a plan covering five unverified sources would be fiction for three of them. |

## Detailed design

### The port boundary

One interface, five implementations:

```
cerca_per_norma(norma)        -> [Decisione]   # owner priority 1
leggi(organo, numero, anno)   -> Decisione     # priority 2
cerca_libera(testo, filtri)   -> [Decisione]   # priority 3
```

`Decisione` carries: body, number, year, section, deposit date, ECLI where the
source publishes one, the URL of the official source, the passage that matched,
and `link_kind` ∈ {`cited`, `matched`}.

`link_kind` is not decoration. It is the one field that must survive from the
adapter to the rendered row.

### Failure

A source that is down must not empty the panel. Each adapter returns its own
outcome, and the panel renders per-body: results, "nothing found", or "source
unreachable" — never a silent absence. This is the same rule as gotcha 18: a
backend that stopped answering stays visible.

Each body also declares its coverage next to its results, so an empty Cassazione
section reads "nothing in the last five years", not "nothing".

### Surfaces

The reading panel groups by body and labels the link. The search page serves
priority 3 with the body as a filter. Direct lookup serves priority 2 and is the
simplest path: body, number, year.

Detailed UI work belongs to the implementation plan, not here.

## Verification

Per adapter: a live test behind the `live` marker (`pytest -m live`) proving the
source still answers, plus offline tests over recorded fixtures for the parsing.
The live tests are the early warning for gotcha 1 — when a source changes shape,
they fail before a user notices.

Before the round closes: the reading panel on a real article, with one body up
and one deliberately unreachable, showing that a dead source degrades to a
labelled message instead of an empty list.
