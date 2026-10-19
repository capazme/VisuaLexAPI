# MERL-T Data Quality — Fix Plan (approved 2026-07-02)

> Root fix for the D4 "dirty data in community surfaces" problem from the
> slice3-ux review. Grounded in live sampling of the running stack.
> **Owner decisions**: full plan (Fase 1 + Fase 2) + a one-time backfill of
> existing data. MERL-T Python is baked into the Docker image at build →
> ⚠️ REBUILD marks changes needing `docker compose --profile api-in-docker
> build` + recreate.

## Diagnosis (live-sampled)

- **Labels**: FalkorDB Norma nodes carry no `label` prop. The serializer
  `_parse_graph_node_v2` (`merlt/merlt/api/graph_router.py:1813-1819`) tries
  `nome→estremi→rubrica→titolo` then falls back to the raw URN. Comma nodes
  (only `testo`) and ~500 Norma + all lazy stubs have none of those → raw URL.
  Root cause of empty stubs: `entity_writer._create_entity_relation`
  (`merlt/merlt/storage/graph/entity_writer.py:475-489`) `MERGE`s a Norma node
  with no `estremi`/`numero_articolo`/`rubrica` when the article was never
  ingested (also `multivigenza.py:863,1211`).
- **Junk**: `pending_entities.entity_text` written with no quality gate by 3 of
  4 paths (mechanistic `mechanistic.py:194,258`; `propose_entity`
  `enrichment_router.py:2002`; confirm-source); `GET /enrichment/pending`
  (`enrichment_router.py:1530-1601`) returns everything `pending` unfiltered.
  Live junk: `live:<id>` leaked node ids, tool error strings (`**Errore**...`,
  `Nessuna sentenza CGUE trovata...`), test artifacts (`...test massima...`).
- **Concepts**: `handleSelect` (`GraphExplorerPage.tsx:166-168`) treats every
  search result as an article URN → concept clicks trigger article
  lazy-ingestion that spins forever then shows "Articolo non indicizzabile".

## Fixes

### Fase 1 — FE/BFF, NO rebuild
- **C1-C4** (`GraphExplorerPage.tsx:90-100,166-168,311-322` + `GraphSearchBox.tsx`):
  thread node type through `handleSelect`; only trigger ingestion when the
  center is a Norma/article; concept empty-state → "Concetto non collegato nel
  grafo" (no infinite spinner); hide non-openable `live:` search results.
- **B3** (`backend/src/schemas/merlt/experts.ts:47`): make `entityText`
  required in confirm-source; reject a name starting with the `live:` nodeId.
  **Verify the FE "ricorda nel grafo" call-site passes entityText first** (qa
  feature) — update it if not.

### Fase 2 — MERL-T Python, ⚠️ REBUILD (one rebuild bundles all)
- **A1** (`graph_router.py:1813-1819`): extend label chain with
  `numero_articolo`/`testo` (truncated ~50-60 chars, last before fallback);
  for Norma synth `"Art. {numero_articolo} — {rubrica}"`; final fallback =
  regex `~art(\d+)` → "Art. N", never the raw URL.
- **A2** (`entity_writer.py:475-489`, `multivigenza.py:863,1211`): `ON CREATE
  SET` (never unconditional) `estremi`/`numero_articolo` derived from the URN
  (handle `-bis/-ter`). No migration.
- **B1** (`enrichment_router.py:1562-1568`): exclude junk-signature rows in
  `get_pending` (defensive, protects the existing queue).
- **B2**: shared `is_valid_entity_name(name, type)` (generalize
  `base.py:279` + reuse `experts/base.py:44-62`) called at all 4 write sites
  (`mechanistic.py:194,258`; `enrichment_router.py:2002,606-646,1030-1045`;
  confirm-source). Root gate.
- **C5** (`graph_router.py:547-601` search): emit `urn` + node `type` per
  result so the FE can route; optionally filter unopenable ids.

**Junk signatures** (case-insensitive, trimmed; substring/regex, NOT
exact-match): starts `live:`; starts `**errore**` / contains `non
riconosciuto`; starts `nessun(a)` AND contains `trovat`; contains `Formato:`;
test markers `\btest\b`/`example`/`esempio`/`lorem`/`placeholder`/`xxx`/`tbd`;
len `<3` or `>` per-type max; raw identifier (`live:`/`pending:`/`urn:`/`http`);
markdown/control noise (`**`, `#`, `hint:` prefix).

### Backfill — one-time script (owner-approved)
`merlt/merlt/scripts/backfill_data_quality.py` (run once post-rebuild):
1. Delete `pending_entities` rows whose `entity_text` matches the junk
   signatures (reuse `is_valid_entity_name`).
2. Repopulate `estremi`/`numero_articolo` on existing empty Norma stubs in
   FalkorDB, deriving from `URN` (reuse the A2 derivation).
Idempotent; logs counts; dry-run flag.

## Not touched
RLCF vote model, consent (levels/guards), BFF contracts (except the local
`entityText`-required tightening), entities-first (no relation extraction),
the legacy sync `parse_document` path, `PendingEntity` schema (no required
new columns).

## Order
Fase 1 (FE/BFF quick wins) → Fase 2 (one Python rebuild bundling A1/A2/B1/B2/C5)
→ recreate → run backfill → live verify.

## Verification (live)
- **Labels**: FalkorDB `MATCH (n:Norma) WHERE n.estremi IS NULL RETURN n.URN`
  before/after; open art467 in side-rail + /grafo → label is "Art. 467 — …"
  not the URL; after A2, a fresh community entity on a never-ingested article
  has `estremi`/`numero_articolo` on the stub.
- **Junk**: re-GET `/api/merlt/validate/pending` → the 4 known junk rows gone;
  a `propose-entity` with a junk-signature name is rejected; unit tests on the
  8 signatures (legit names pass).
- **Concepts**: /grafo click on a concept → renders neighbours OR "Concetto non
  collegato" with no infinite spinner / no "Articolo non indicizzabile"; article
  click unchanged; `live:` results not selectable.
- **Harness**: add a `flow_graph` concept-center case; BFF integration test for
  B3; smoke-checklist lines for concept-click + clean validation queue.
