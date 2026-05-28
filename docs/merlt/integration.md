# MERLT / RLCF Integration

VisuaLex integra MERLT come sidecar FastAPI, ma il browser parla solo con il BFF Node su `/api/merlt/*`. Il modulo non e piu una slice "query + feedback": espone feature flags, consenso utente, article slot, MERLT workspace, enrichment, validation, graph, profile/authority, document training e ops.

> ⚠️ **Doc parzialmente storico (pre-Slice 1→2c).** Questo runbook descrive una superficie *intesa* più ampia di quella montata oggi: in particolare **non** esiste `GET /api/merlt/features` (i flag sono derivati lato client da `useMerltFeatures`) e la **Q&A multi-expert** (`/api/merlt/experts/*`) **non è montata** (rinviata a Slice 3). Stato reale → **[README.md](../README.md)** + **[system-map.md](./system-map.md)**; route effettive → `backend/src/routes/merlt/`.

## Local Stack

Run the normal VisuaLex stack:

```bash
./start.sh
```

Run VisuaLex with MERLT enabled:

```bash
MERLT_ENABLED=true \
MERLT_COMPOSE_ENABLED=true \
MERLT_ROOT="$(pwd)/merlt" \
MERLT_PORT=8000 \
MERLT_PYTHON=python \
./start.sh
```

`MERLT_COMPOSE_ENABLED=true` starts `docker-compose.merlt.yml`, which provides the local MERLT dependencies:

- PostgreSQL on `5436`
- Redis on `6381`
- FalkorDB on `6382`
- Qdrant on `6343`

The Node backend reads these MERLT settings:

```bash
MERLT_ENABLED=true
MERLT_API_URL=http://localhost:8000
MERLT_API_KEY=
MERLT_TIMEOUT_MS=60000
MERLT_CONTRIBUTION_ENABLED=true
MERLT_VALIDATION_ENABLED=true
MERLT_GRAPH_ENABLED=true
MERLT_OPS_ENABLED=true
```

`MERLT_API_KEY` can stay empty when running the full MERLT app from `merlt.app`, which makes regular user endpoints API-key optional for browser integrations. Set it in production or when using MERLT routes that enforce admin roles.

## Feature Flags E Superfici UI

I flag sono **derivati lato client** (`frontend/src/features/merlt/useMerltFeatures.ts`); **non** esiste un endpoint `/api/merlt/features`. I gate logici:

- `merlt`: abilita il modulo base.
- `merlt_contribution`: abilita proposte entita/relazioni e training export.
- `merlt_validation`: abilita pending queue e validazione community.
- `merlt_graph`: abilita graph workspace e preview articolo.
- `merlt_ops`: abilita dashboard ops solo per admin.

Superfici implementate:

- article slot modulare sotto il testo articolo, con check articolo, live enrichment, graph preview, Q&A multi-expert, feedback dettagliato/fonte/refine e tracking eventi;
- MERLT workspace su `/merlt`, con pending queue, validation, graph search, authority profile, ops/training e feature avanzate;
- EventBus frontend per segnali RLCF impliciti, attivo solo dopo consenso utente locale.
- Consenso MERLT persistito lato backend/DB con audit trail minimo.

Il gateway injecta `user_id`, inoltra il bearer token e invia `X-API-Key` quando configurata. La matrice completa endpoint-per-endpoint vive in [`contract-matrix.md`](./contract-matrix.md).

## Verification

After starting VisuaLex and MERLT:

```bash
curl http://localhost:3001/api/health
curl http://localhost:8000/health
```

Authenticated checks require a VisuaLex access token:

```bash
# Health del modulo MERL-T (montato, no-auth lato BFF)
curl http://localhost:3001/api/merlt/health

# Consenso utente (montato)
curl http://localhost:3001/api/merlt/consent \
  -H "Authorization: Bearer $VISUALEX_ACCESS_TOKEN"

# Ricerca nel grafo (montato)
curl "http://localhost:3001/api/merlt/graph/search?q=responsabilità" \
  -H "Authorization: Bearer $VISUALEX_ACCESS_TOKEN"
```

Per verificare le superfici UI:

1. Apri `/merlt` e controlla feature flags, pending queue, graph search e profile.
2. Apri un articolo reale, abilita il consenso MERLT e prova check articolo, live enrichment e Q&A divergente.
3. Come admin, controlla ops/training su `/merlt` con `MERLT_OPS_ENABLED=true`.
