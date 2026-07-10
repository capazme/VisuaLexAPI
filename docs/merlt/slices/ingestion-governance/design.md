# MERL-T — Ingestion Governance (staging + cancello admin)

> Design doc — 2026-07-10 · branch `visualex-merlt-main`
> Stato: **DRAFT, in attesa di approvazione owner prima dell'implementazione**

## 1. Problema & obiettivo

Vogliamo un'**ingestion meccanica** (deterministica, zero LLM) del corpus normativo nel
knowledge graph — Codice Civile via VisuaLex tree-extractor, corpus via italia-corpus.
Ma l'ingestion **non deve mai sporcare il grafo live prima della validazione**.

La scoperta che motiva tutto: la CC in italia-corpus è frammentata sui decreti-origine
(URN `1938;1852`, `1939;1586`…) mentre il grafo usa il consolidato `1942;262`. Un'ingestion
naïve avrebbe creato nodi-articolo scollegati e non citabili. **Serve un cancello che
intercetti conflitti di URN, orfani e duplicati PRIMA della promozione.**

Non-goal: la governance del layer **interpretativo** (concetti/principi), che resta sul
percorso RLCF community-vote esistente (`pending_*` → quorum authority-weighted).

## 2. Principio: governance a due tier (specchia l'ingestion a due tier)

| Tier | Contenuto | Governance | Stato |
|---|---|---|---|
| **Meccanico** | Norma, gerarchia, rinvii (fatti deterministici, bulk) | **admin-gated per BATCH** | **da costruire (questo doc)** |
| **Interpretativo** | Concetti, principi (claim, per-item) | community RLCF (`pending_*` + quorum) | esiste già |

Motivo: non si fa votare la community su 2969 nodi-articolo fattuali. I fatti non hanno
bisogno di *consenso*, ma di **revisione admin del batch** (fonte, allineamento URN,
copertura) prima della promozione in blocco.

## 3. Architettura & topologia

```
[Parser meccanico (MERL-T Python)]                  input adapters:
   ├─ VisuaLex tree-extractor + scraper  → CC/CP     (URN 1942;262, allineato al seed)
   └─ italia-corpus Markdown             → corpus    (URN proprio dell'atto)
        │
        ▼  produce {nodes, edges} (seed-JSON shape) + conflict report
[MerltIngestionBatch]  (MERL-T Postgres, status=pending_review)   ← IL GRAFO LIVE NON È TOCCATO
        │
        ▼  admin ispeziona (report conflitti + sample), decide
   approve ──► promote: MERGE bulk su FalkorDB (riusa _merge_nodes/_merge_edges del seed loader)
   reject  ──► scarta (status=rejected)
```

- **Parsing + staging + promozione = MERL-T** (possiede FalkorDB + il parsing). Nuovo modulo
  `merlt/ingestion/mechanical/`.
- **BFF** = route admin `/api/merlt/ops/ingestion/*` (requireAdmin) che proxano a MERL-T con la
  `X-API-Key` (come `opsClient`).
- **Frontend** = sezione dentro l'**AdminPage esistente** (non una route nuova) — coerente col
  pannello RuntimeConfig + ops training già lì.

## 4. Data model — `MerltIngestionBatch` (MERL-T Postgres)

| Campo | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `source` | varchar | `visualex_tree` \| `italia_corpus` |
| `source_ref` | varchar | es. URN atto / path file italia-corpus |
| `scope_label` | varchar | descrizione umana ("Codice Civile — tutti i libri") |
| `status` | enum | `pending_review` \| `promoted` \| `rejected` \| `failed` |
| `nodes` | jsonb | `[{labels, properties}]` (seed-JSON shape) |
| `edges` | jsonb | `[{start, end, type, properties}]` |
| `conflict_report` | jsonb | vedi §5 |
| `stats` | jsonb | `{nodes_new, nodes_update, edges_new, edges_orphan, coverage_pct, duplicates}` |
| `created_at` | ts | |
| `created_by` | varchar(100) | user_id admin che ha triggerato |
| `reviewed_by` | varchar(100) | user_id admin che ha promosso/rifiutato |
| `promoted_at` / `rejected_at` | ts | |
| `error` | text | se `failed` |

Idempotenza: la promozione riusa il MERGE per URN/`_seed_key` del seed loader → ri-promuovere
lo stesso batch non duplica. Un batch `pending_review` scade dopo N giorni (TTL, config).

## 5. Conflict report (il cuore del cancello — calcolato PRIMA dello staging)

Per ogni batch, prima di salvarlo, si interroga il grafo live (read-only) e si calcola:

- **`urn_conflicts`** — nodi il cui URN esiste già ma con `estremi`/`tipo_documento` divergenti
  (il caso CC 1942;262 vs 1938;1852). **Blocca la promozione** finché non risolto/forzato.
- **`node_updates`** — URN già presenti: il MERGE farà `SET +=` (update). Elencati per revisione.
- **`node_new`** — URN nuovi.
- **`orphan_edges`** — archi il cui `start`/`end` non è né nel batch né nel grafo → verrebbero
  scartati dal merge. Elencati (segnale di parsing incompleto).
- **`duplicates`** — URN duplicati dentro il batch stesso.
- **`coverage`** — % articoli attesi vs estratti (per la CC: 2969 attesi).

Severità (**confermato**, adversarial review 10 Lug 2026): solo `urn_conflicts` blocca la
promozione (409 salvo `force` esplicito, motivazione loggata). `orphan_edges` resta un
**warning** — segnala parsing incompleto ma non impedisce la promozione (gli archi orfani
vengono comunque scartati dal merge, mai creano nodi stub).

## 6. API

### MERL-T (`/api/v1/ingestion/mechanical/*`, X-API-Key admin)
- `POST /run` — body `{source, source_ref, scope_label}` → enqueue RQ job che parsa + calcola
  conflict report + crea il batch `pending_review`. Risposta `{batch_id, job_id}`.
- `GET /batches?status=` — lista (id, source, scope, status, stats, created_at).
- `GET /batches/{id}` — dettaglio: conflict_report + sample nodi/archi (paginati).
- `POST /batches/{id}/promote` — body `{force?: bool, reason?}` → MERGE bulk su FalkorDB,
  status=promoted. 409 se `urn_conflicts` e non `force`.
- `POST /batches/{id}/reject` — body `{reason}` → status=rejected.

### BFF (`/api/merlt/ops/ingestion/*`, authenticate + requireAdmin, proxy con opsClient)
Mirror 1:1 dei 5 endpoint MERL-T. Riusa `requireAdmin` + il pattern `opsClient` (X-API-Key).

## 7. Frontend — sezione "Ingestion" nell'AdminPage

- **Trigger run**: form (sorgente: VisuaLex-CC / italia-corpus-atto; scope) → `POST /run`.
- **Coda batch** `pending_review`: tabella (scope, sorgente, stats sintetiche, età).
- **Dettaglio batch** (drawer/pagina):
  - **Conflict report** in evidenza (badge rossi su `urn_conflicts`/`orphan_edges`).
  - **Sample** nodi/archi (prime N righe, paginato).
  - Azioni: **Promuovi** (danger `ConfirmDialog` che elenca cosa entra + i conflitti;
    checkbox "forza" se conflitti) · **Rifiuta** (con motivazione).
- **Storico**: promossi/rifiutati con chi/quando.
- Gating: `useMerltFeatures().opsVisible` (admin). Route: tab dentro AdminPage.

## 8. Il parser meccanico (input adapters — dettaglio in un doc separato)

Output comune = seed-JSON `{nodes:[{labels,properties}], edges:[{start,end,type,properties}]}`.
- **VisuaLex tree adapter** (CC/CP): `/fetch_tree` → lista articoli → per articolo `Norma` node
  (URN `…1942;262…~artN`, testo_vigente dallo scraper, rubrica, gerarchia in properties).
  Edge `contiene` articolo→comma dove disponibile.
- **italia-corpus adapter** (corpus): Markdown → frontmatter=attributi, `### Art. N`=Norma,
  `## TITOLO`=gerarchia (properties), link-URN=edge `RINVIA` (NUOVO tipo — additivo). I nodi
  articolo emessi portano `estremi`/`tipo_documento` a livello di ARTICOLO ("Art. N ...",
  `tipo_documento='articolo'`), non i valori act-level del frontmatter — per allinearsi allo
  schema reale del grafo (`data/seeds/libro-iv-cc-graph.json`).

Il parser NON scrive mai su FalkorDB: emette solo il batch. La scrittura è solo la promozione.

**Limite noto (KNOWN LIMITATION, adversarial review 10 Lug 2026):** l'adapter italia-corpus
**rifiuta** esplicitamente i decreti-origine frammentari della Codice Civile/Codice Penale
consolidati (Libro I `1938;1852`, Libro II `1939;1586`, Libro VI `1941;18`, Codice Penale
`1930;1398` — blocklist in `parser._CC_CP_FRAGMENT_ACTS`, non esaustiva) con un errore che
porta il batch a `status=failed`. Costruire una overlap-detection URN-indipendente generale è
esplicitamente FUORI SCOPE: la CC/CP consolidata va ingerita SOLO tramite l'adapter
`visualex_tree` (§9 step 2), allineato per costruzione all'URN `1942;262` del seed.

## 9. Sequenza di implementazione

1. **MERL-T**: modello `MerltIngestionBatch` + migration; `conflict_report` builder; endpoint
   `/ingestion/mechanical/*`; RQ job di parse+report; promote=MERGE (riusa seed loader).
2. **Adapter VisuaLex-CC** (primo, per l'obiettivo "ingerire la CC").
3. **BFF**: `opsIngestionClient` + route `/ops/ingestion/*` + test.
4. **FE**: sezione Ingestion in AdminPage + client + test.
5. **Ingest CC**: run → review batch → promote → verifica grafo (2969 art. sotto 1942;262).
6. **Poi**: adapter italia-corpus, sync giornaliero, attacco Brocardi strutturato.

## 10. Decisioni aperte per l'owner
- [x] Staging = Postgres per batch (opzione A) — **confermato**.
- [ ] Placement FE: **sezione dentro AdminPage** (proposto) vs route dedicata `/merlt/admin/ingestion`.
- [x] `urn_conflicts` → promozione **bloccata salvo force** — **confermato**; `orphan_edges`
  resta solo warning (vedi §5).
- [x] TTL batch `pending_review` — **confermato: 14 giorni** (`PENDING_REVIEW_TTL_DAYS`),
  enforced come 409 sull'endpoint `/promote` se `expires_at < now`.
- [x] CC/CP via italia-corpus — **rifiutato esplicitamente** (blocklist decreti-origine, §8);
  la CC/CP consolidata passa SOLO dall'adapter `visualex_tree`.
- [x] Endpoint `/ingestion/mechanical/*` — **admin-gated con `require_role("admin")`**
  (non il generico `verify_api_key` di ogni chiave valida — fix adversarial review item #1).
- [x] Batch `failed` post-promote (es. crash worker a metà MERGE) — **ri-promuovibile**: le
  MERGE di `_merge_nodes`/`_merge_edges` sono idempotenti, quindi il retry è sicuro. La
  transizione `pending_review`/`failed` → `promoting` è un `UPDATE ... WHERE status=<snapshot>`
  atomico (non un read-then-write) per evitare la doppia promozione concorrente.
