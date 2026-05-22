# MERL-T Slice 1 — Smoke E2E Checklist

**Scope:** end-to-end manual verification per ogni Story di Slice 1.
**Frequency:** dopo ogni chiusura di Story con AC "smoke verde".
**Target environment:** dev locale (VisuaLex + MERL-T sidecar Docker).

Salva log/screenshot di ogni esecuzione in `docs/smoke-evidence/YYYY-MM-DD-merlt-slice1/`.

---

## Setup (una volta per sessione)

1. Reset Postgres MERL-T (clean slate):
   ```bash
   docker compose -f docker-compose.merlt.yml --profile api-in-docker down -v
   ```

2. Start full stack:
   ```bash
   MERLT_ENABLED=true MERLT_COMPOSE_ENABLED=true MERLT_API_IN_DOCKER=true ./start.sh
   ```
   Aspetta:
   - `[1/3] Starting VisuaLex API (port 5000)…`
   - `[2/3] Starting Platform Backend (port 3001)…`
   - `[3/3] Starting Frontend (port 5173)…`
   - `[4/4] Starting MERLT stack (deps + API in Docker)…`
   - `MERLT /health OK after Ns`

3. Verifica container UP:
   ```bash
   docker ps --filter "name=visualex-merlt" --format "table {{.Names}}\t{{.Status}}"
   ```
   Tutti i 5 container devono essere `Up X (healthy)`.

4. Verifica MERL-T reachable:
   ```bash
   curl http://localhost:8000/health
   curl http://localhost:3001/api/merlt/health
   ```
   Entrambi 200, e il secondo include `"merlt":"reachable"`.

---

## Story MERLT-1.5 — `article:viewed` end-to-end

### 1. Login + accept consent

- Apri `http://localhost:5173`
- Login con `admin@visualex.it` + password (vedi `backend/.env`)
- Trigger accept consenso `basic`:
  ```bash
  TOKEN=$(... obtain JWT ...)
  curl -X POST http://localhost:3001/api/merlt/consent \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"level":"basic"}'
  ```
  Risposta 200 con `level:"basic"`, `graphEnabled:true`.

  Verifica DB:
  ```bash
  psql postgresql://gpuzio@localhost:5432/visualex_platform \
       -c "SELECT user_id, consent_level FROM merlt_user_preferences;"
  ```

### 2. Open article → trigger article:viewed

- Cerca un articolo (es. `art. 2043 c.c.`)
- Lascia visibile in viewport ≥3s (oppure scrolla ≥30%)
- Chiudi la tab o naviga via

### 3. Verify trace in MERL-T Postgres

```bash
docker exec -it visualex-merlt-postgres \
  psql -U merlt -d merlt \
  -c "SELECT id, event_type, user_id, payload::jsonb -> 'article_urn' AS article_urn,
             payload::jsonb -> 'dwell_ms' AS dwell_ms, created_at
      FROM qa_traces ORDER BY created_at DESC LIMIT 5;"
```

Atteso: una riga con
- `event_type = 'article_viewed'`
- `user_id` = il tuo UUID di admin
- `article_urn` = URN dell'articolo aperto (con `-bis`/`-ter` normalizzati)
- `dwell_ms ≥ 3000`
- `created_at` recente

### 4. Revoke consent → no new event

```bash
curl -X DELETE http://localhost:3001/api/merlt/consent \
     -H "Authorization: Bearer $TOKEN"
```

Apri di nuovo l'articolo, leggi 5s, chiudi. Ripeti la query SQL del passo 3.
Atteso: nessuna nuova riga (il countdown dei record non cambia).

### 5. Stop MERL-T → degraded gracefulness

```bash
docker stop visualex-merlt-api
```

Apri di nuovo l'articolo (con consent attivo). UI non si blocca.
Verifica dead-letter log:
```bash
tail backend/logs/merlt-dead-letter.jsonl
```
Atteso: una riga con `event: "article-viewed"` e `error` che riporta MerltServerError o MerltTimeoutError.

```bash
docker start visualex-merlt-api
```

### 6. Feature flag verification

In `frontend/.env`:
```
VITE_FEATURE_MERLT=false
```
Restart frontend (`Ctrl+C` poi `./start.sh`). L'app deve girare normalmente; nessuna chiamata `/api/merlt/*` dal browser.

Riimposta a `true` e riavvia.

---

## Story MERLT-1.7 — highlight + annotation

*(da compilare quando Story 1.7 è chiusa)*

---

## Story MERLT-1.8 — dossier + bookmark

*(da compilare quando Story 1.8 è chiusa)*

---

## Story MERLT-1.9 — citation:clicked

*(da compilare quando Story 1.9 è chiusa)*

---

## Story MERLT-1.10 — forum signals

*(da compilare quando Story 1.10 è chiusa)*

---

## Troubleshooting comune

| Sintomo | Cause probabile | Fix |
|---------|------------------|-----|
| `curl /api/merlt/health` → 401 | merltRoutes non mountato prima dei router auth catch-all | Vedi gotcha "Express mount order" in CLAUDE.md |
| MERL-T `ImportError: No module named 'merlt.models'` | sub-package escluso da rsync | Vedi commit `ef2bd25` + `docs/merlt-upstream-sync.md` |
| MERL-T 503 al startup container | env vars `ENRICHMENT_DB_*` / `RLCF_DATABASE_URL` mancanti | Vedi commit `1fdb3d5` |
| Health gate timeout in start.sh | MERL-T tarda al primo boot (~30-60s per migrations + model load) | Aumenta `MERLT_HEALTH_TIMEOUT=120` |
| Frontend mostra 404 su `/api/merlt/features` | endpoint legacy non ancora reimplementato | Out of scope Slice 1 — sarà coperto in Slice 2 |
