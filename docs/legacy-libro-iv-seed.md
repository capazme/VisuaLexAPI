# Legacy Libro IV CC — Graph Seed (how-to)

How the day-0 knowledge-graph seed for MERL-T was recovered and how to reproduce
or extend it. The seed pre-populates FalkorDB (+ optionally Qdrant + the bridge
table) with the Italian Civil Code **Libro IV** (artt. 1173–2059), so the graph
is explorable from the first boot without a cold start.

## What the seed is

Product of experiment **EXP-014_full_ingestion** (multi-source embeddings from
Brocardi). Real numbers (verified against a temp container):

- FalkorDB graph: **27.742 nodes**, **43.936 edges**.
- ~20 legal labels: `Norma` (1539), `Comma`, `Lettera`, `ConcettoGiuridico`,
  `DefinizioneLegale`, `PrincipioGiuridico`, `Dottrina`, `AttoGiudiziario`,
  `Caso`, `FattoGiuridico`, `AttoGiuridicoEntita`, `EffettoGiuridico`,
  `SoggettoGiuridico`, `Ruolo`, `ModalitaGiuridica`, `Eccezione`, `Procedura`,
  `Rimedio`, `Clausola`, `Termine`.
- 15 relation types: `DISCIPLINA`, `interpreta`, `APPLICA_A`, `contiene`,
  `IMPONE`, `commenta`, `ESPRIME_PRINCIPIO`, `ATTRIBUISCE_RESPONSABILITA`,
  `PREVEDE`, `DEFINISCE`, `STABILISCE_TERMINE`, `PREVEDE_SANZIONE`, `modifica`,
  `abroga`, `inserisce` (multivigenza intact, with `data_efficacia` +
  `fonte_relazione`).
- Bridge table: 27.117 rows mapping `graph_node_urn` → chunk metadata.

## Files in this repo

- `merlt/data/seeds/libro-iv-cc-graph.json` (~39 MB) — portable node/edge export.
  **Merge key:** `properties.URN` for `Norma`, `properties.node_id` for everything
  else. NEVER merge on FalkorDB internal id (it changes between instances).
- `merlt/data/seeds/postgres-dumps/bridge-table-data.sql` (~49 MB, COPY format) +
  `bridge-table-schema.sql` (`CREATE TABLE IF NOT EXISTS`, idempotent).
- `merlt/data/seeds/postgres-dumps/rlcf-schema.sql` (36 tables — reused by the
  future Slice 2b "Laboratorio RLCF").
- `merlt/data/legacy-libro-iv/{falkordb,qdrant,postgres}/` — original raw volumes
  (gitignored, ~316 MB), kept for re-export.
- `merlt/scripts/export_legacy_libro_iv.py` — reproducible exporter (verbose
  `GRAPH.QUERY`, NOT `--compact` — compact adds wrapping that broke v1).

## Loader (runs automatically on boot)

`merlt/merlt/scripts/load_seed_libro_iv.py`, hooked into the FastAPI lifespan in
`merlt/merlt/app.py` (~line 132, before `yield`). Verified E2E in the
`visualex-merlt-api` container: 27.741 nodes + 43.935 edges + 27.117 bridge rows
in ~43s (embeddings skipped). Idempotent: skips entirely when the graph already
has >100 nodes.

**Pipeline:**
1. Load `libro-iv-cc-graph.json` → `MERGE` per URN/node_id into FalkorDB, batch 500.
2. Load edges → `MERGE` on `edge_key = hash(start|end|type|disposizione|data_efficacia)`, batch 500.
3. (Optional) regenerate embeddings from node texts (`testo_vigente`/`testo`/
   `descrizione`/`massima_text`) with `intfloat/multilingual-e5-large` (1024-dim)
   → upsert Qdrant `merl_t_legal_chunks`. **Skipped by default** in dev
   (`MERLT_SKIP_EMBEDDINGS=true`): on docker CPU this model runs ~2s/text →
   8+ hours for 17k texts. Pre-compute on the ARM host (~10× faster) or skip.
4. `psql` restore of `bridge-table-{schema,data}.sql` into `rlcf_dev`.
5. Re-align `bridge.chunk_id` with the new Qdrant uuids (match on `chunk_text`).
6. Integrity check: nodes ≥27.700, bridge ≥27.000, zero orphans → else
   `SeedLoadError` and MERL-T refuses to start.

## Re-exhuming the raw FalkorDB volume

```bash
docker run -d --name tmp-falkor -p 6383:6379 \
  -v <legacy>/falkordb:/var/lib/falkordb/data \
  falkordb/falkordb:latest redis-server \
  --loadmodule /var/lib/falkordb/bin/falkordb.so \
  --appendonly yes --dir /var/lib/falkordb/data
```
The container default `dir` is `/var/lib/falkordb/data` (NOT `/data`) and
`appendonly no` — both must be overridden or the dump never loads and
`GRAPH.LIST` returns empty.

## Gotchas (from MERLT-2a.1)

1. `merlt-api` builds the image (no code volume mount): after editing the loader
   run `docker compose build merlt-api && up -d --force-recreate`.
2. The Dockerfile copies `merlt/`, not `data/`: mount `./merlt/data:/app/data:ro`
   and set `MERLT_DATA_DIR=/app/data` (the `Path(__file__).parents[2]/data`
   default breaks in the container — `parents[2]` is `/`).
3. `postgresql-client` (psql) had to be added to the runtime image deps.
4. `postgresql+asyncpg://` DSN is rejected by libpq — `_pg_dsn_to_asyncpg()`
   strips the `+asyncpg` before handing the DSN to the `psql` subprocess.
5. `bridge-table-data.sql` is data-only; pair it with `bridge-table-schema.sql`
   (`CREATE TABLE IF NOT EXISTS` + `DO $$ EXCEPTION` blocks) as a pre-step.
6. **The `ADD CONSTRAINT` DO-blocks must catch `duplicate_table`, not just
   `duplicate_object`.** Re-adding a UNIQUE constraint whose backing index
   already exists raises `relation "…_key" already exists` (`42P07`,
   `duplicate_table`), NOT `42710` (`duplicate_object`). If only the latter is
   caught, a seed re-run (e.g. after `docker compose up --build`) fails with
   `psql exit 3` → `SeedLoadError`. The loader's global skip (`graph >100 nodes
   → skip all`) normally avoids re-running the restore, but a full
   `--force-recreate` that recreates FalkorDB alongside the api can race the
   node-count check, so the DDL must be genuinely idempotent regardless.

## Extending to other Libri (III, V, …)

Run a fresh `EXP-xxx` ingestion over the target article range, export with
`export_legacy_libro_iv.py` (adjust the graph name), drop the new
`*-graph.json` into `merlt/data/seeds/`, and extend the loader to MERGE it. The
URN merge contract guarantees no collisions with the existing Libro IV nodes.
