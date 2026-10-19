# Graph API — Riferimento per il team BFF

Endpoint del knowledge graph di MERL-T, montati sotto `prefix="/api/v1"`.
Tutti i path qui sotto sono quindi raggiungibili come `/api/v1/graph/...`.

Autenticazione: header API key (`verify_api_key`). In ambiente di sviluppo
la verifica è resa opzionale dall'app, ma in produzione fornire la chiave.

---

## POST `/api/v1/graph/ingest-article`

Accoda un job di ingestion lazy per un articolo non ancora presente nel grafo.
Il BFF chiama questo endpoint quando un utente apre un articolo non ingerito;
il job è processato in background da un worker RQ (Redis Queue) sulla coda
`merlt_ingest` — la funzione target è `merlt.worker.tasks.ingest_article`.
Il worker (`rq worker merlt_ingest`) arriva in MERLT-2a.3.

**Status code:** `202 Accepted`

### Request

```json
{
  "urn": "urn:lex:it:codice.civile:1942;art2043",
  "options": {
    "force_refresh": false,
    "bff_job_id": "merlt-ingestion-job-uuid"
  }
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|--------------|-------------|
| `urn` | string | sì | URN dell'articolo da ingerire |
| `options.force_refresh` | bool | no (default `false`) | Re-ingest anche se l'articolo è già nel grafo |
| `options.bff_job_id` | string \| null | no | ID del job lato BFF (`MerltIngestionJob`) per il callback |

### Response (`202`)

```json
{
  "task_id": "ingest:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b",
  "status": "queued",
  "urn": "urn:lex:it:codice.civile:1942;art2043"
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `task_id` | string | ID del job RQ accodato (chiave derivata da sha256 dell'URN — vedi sotto) |
| `status` | string | `"queued"` se nuovo job, `"already_queued"` se idempotency hit |
| `urn` | string | URN normalizzato |

### Idempotenza

Il job è accodato con `job_id = "ingest:" + sha256(urn)[:40]`. L'URN è una URL
Normattiva completa contenente `?`, `~`, `:`, `;`: usarlo grezzo come chiave
Redis rischierebbe problemi di key-encoding e bypass dell'idempotenza per
percent-encoding, quindi viene hashato. **I caller non devono dipendere dalla
forma esatta del `task_id`** — è una chiave opaca derivata; l'URN originale resta
disponibile nel campo `urn` della response.

A differenza di altre code, RQ sovrascrive i job con lo stesso id invece di
deduplicarli, quindi l'endpoint fa un pre-check esplicito: se esiste già un job
per quell'URN con stato `queued`, `started`, `deferred` o `scheduled`, non ne
accoda un altro e la response resta `202` ma con `status = "already_queued"`. Il
BFF può quindi ritentare la chiamata in sicurezza senza generare ingestion
multiple per lo stesso articolo. Con `options.force_refresh = true` il pre-check
viene bypassato e una re-ingestion viene sempre accodata (`status = "queued"`).

### Errori

| Status | Quando |
|--------|--------|
| `422` | Body non valido (es. `urn` mancante) |
| `503` | Job queue non disponibile (Redis irraggiungibile o enqueue fallito) — `{"detail": "Job queue non disponibile"}` |

---

## GET `/api/v1/graph/check-article`

Verifica se un articolo esiste nel knowledge graph.

### Query params

| Param | Tipo | Obbligatorio | Descrizione |
|-------|------|--------------|-------------|
| `article_urn` | string | sì | URN dell'articolo (es. `urn:lex:it:codice.civile:1942;art1218`) |

### Response (`200`)

Articolo presente:

```json
{
  "exists": true,
  "node_id": "art:1218:cc",
  "pending_validation": false
}
```

Articolo assente:

```json
{
  "exists": false
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `exists` | bool | `true` se l'articolo è nel grafo |
| `node_id` | string | Presente solo se `exists = true` |
| `pending_validation` | bool | Presente solo se `exists = true` |

Errore `500` se la query al grafo fallisce.

---

## GET `/api/v1/graph/subgraph`

Recupera il sottografo intorno a un nodo radice, per la visualizzazione.

### Query params

| Param | Tipo | Default | Descrizione |
|-------|------|---------|-------------|
| `root_urn` | string | — (obbligatorio) | URN o ID del nodo radice (articolo o entità) |
| `depth` | int | `2` | Profondità di traversamento, clampata a 1–3 |
| `relation_types` | string \| null | `null` | Tipi di relazione separati da virgola (es. `DISCIPLINA,ESPRIME_PRINCIPIO`) |
| `entity_types` | string \| null | `null` | Tipi di entità separati da virgola (es. `principio,concetto`) |
| `include_metadata` | bool | `true` | Include score di approvazione, voti, timestamp |
| `max_nodes` | int | `100` | Numero massimo di nodi, clampato a max `200` |

### Response (`200`) — `SubgraphResponse`

```json
{
  "nodes": [
    {
      "id": "art:1453:cc",
      "urn": "urn:nir:stato:codice.civile:1942;art1453",
      "type": "Norma",
      "label": "Art. 1453 c.c.",
      "properties": {},
      "metadata": {}
    }
  ],
  "edges": [
    {
      "id": "art:1453:cc-DISCIPLINA-concetto:risoluzione",
      "source": "art:1453:cc",
      "target": "concetto:risoluzione",
      "type": "DISCIPLINA",
      "properties": {}
    }
  ],
  "metadata": {
    "total_nodes": 15,
    "total_edges": 20,
    "depth_reached": 2,
    "root_node_id": "urn:nir:stato:codice.civile:1942;art1453",
    "query_time_ms": 42.5
  }
}
```

**`nodes[]`** (`SubgraphNode`)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | Identificatore univoco del nodo |
| `urn` | string \| null | URN se disponibile |
| `type` | string | Tipo nodo (`Norma`, `Entity`, `Principio`, …) |
| `label` | string | Etichetta visualizzata |
| `properties` | object | Proprietà del nodo |
| `metadata` | object | Metadati del nodo |

**`edges[]`** (`SubgraphEdge`)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | string | Identificatore univoco dell'arco |
| `source` | string | ID nodo sorgente |
| `target` | string | ID nodo destinazione |
| `type` | string | Tipo di relazione |
| `properties` | object | Proprietà dell'arco |

**`metadata`** (`SubgraphMetadata`)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `total_nodes` | int | Numero di nodi restituiti |
| `total_edges` | int | Numero di archi restituiti |
| `depth_reached` | int | Profondità effettivamente raggiunta |
| `root_node_id` | string | ID/URN del nodo radice |
| `query_time_ms` | float \| null | Tempo di query in millisecondi |

Errore `500` se il traversamento fallisce.
