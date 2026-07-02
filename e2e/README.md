# Harness E2E + Stress — VisuaLex

Suite di collaudo end-to-end e di carico per lo stack locale (API Python :5000,
BFF Node :3001, sidecar MERL-T :8000). E' un pacchetto Python autonomo in `e2e/`:
**non tocca il codice dell'app**, parla solo HTTP. Non usa pytest: ogni "flow" e'
un percorso utente reale (login → azione → verifica) con asserzioni proprie e
report finale. Unica dipendenza extra: `aiohttp` (Python ≥ 3.11).

Gli utenti di test NON nascono da `/auth/register` (uscirebbero inattivi): li crea
l'admin via `POST /api/admin/users`. Serve quindi l'admin seedato.

## Prerequisiti

1. Stack acceso, in un terminale separato (l'harness non avvia processi):

```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI
# prima volta / dopo modifiche a merlt/ (il codice e' cotto nell'immagine):
docker compose -f docker-compose.merlt.yml --profile api-in-docker build

# stack completo CON worker — tutti e tre i flag a true:
MERLT_ENABLED=true MERLT_COMPOSE_ENABLED=true MERLT_API_IN_DOCKER=true \
ADMIN_PASSWORD='<admin-pw>' OPENROUTER_API_KEY='<key-o-vuota>' ./start.sh
```

2. `ADMIN_PASSWORD`: obbligatoria (seed dell'admin `admin@visualex.it` e login harness).
3. `OPENROUTER_API_KEY` sui container MERL-T: serve SOLO ai flussi LLM
   (`flow_qa`, estrazione di `flow_contrib`). Senza chiave quei flussi vengono
   marcati SKIPPED, non FAIL.

## Variabili d'ambiente

| Variabile | Default | Uso |
|---|---|---|
| `E2E_ADMIN_PASSWORD` (o `ADMIN_PASSWORD`) | — (obbligatoria) | login admin |
| `E2E_ADMIN_EMAIL` (o `ADMIN_EMAIL`) | `admin@visualex.it` | email admin |
| `E2E_USER_PASSWORD` | `E2ePass1x` | password utenti di test |
| `E2E_PY_API` | `http://localhost:5000` | API Python |
| `E2E_BFF` | `http://localhost:3001/api` | backend Node |
| `E2E_MERLT` | `http://localhost:8000` | MERL-T diretto |
| `MERLT_INTERNAL_SECRET` | vuota (opzionale) | abilita il check negativo sul callback interno |
| `E2E_DEFAULT_TIMEOUT` / `E2E_SEARCH_TIMEOUT` / `E2E_QA_TIMEOUT` / `E2E_PDF_TIMEOUT` | 15 / 60 / 180 / 90 s | timeout richieste |
| `E2E_POLL_INTERVAL` / `E2E_INGEST_POLL_MAX` / `E2E_EXTRACT_POLL_MAX` / `E2E_NER_TRAIN_POLL_MAX` | 2 / 120 / 300 / 600 s | polling job asincroni |
| `E2E_STRESS_USERS` / `E2E_STRESS_DURATION` | 10 / 60 | default dello stress |
| `E2E_RUN_ID` | uuid corto auto | suffisso di ogni entita' creata (idempotenza) |

## I 3 modi d'uso

```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI

# 1) Solo diagnosi: verifica lo stack e mappa i problemi sui gap dell'audit, poi esce
E2E_ADMIN_PASSWORD='...' python3 -m e2e.runner --preflight-only

# 2) Suite completa (scraper esterni + worker + LLM se disponibili)
E2E_ADMIN_PASSWORD='...' python3 -m e2e.runner

# 3) Subset rapido (<60s): niente scraper, niente LLM, niente worker
E2E_ADMIN_PASSWORD='...' python3 -m e2e.runner --fast
```

Altri filtri: `--skip slow`, `--skip costs_money`, `--only graph` (nomi corti
del registro: `auth`, `consent`, `search`, `dossier`, `forum`, `tracking`,
`graph`, `ner`, `qa`, `contrib`, `validate`, `ops`; `auth` viene sempre incluso),
`--wait-for-stack 300` (attende che lo stack diventi verde mentre `start.sh`
parte in parallelo). Opzionali extra: `--include-refine` (follow-up Q&A, seconda
chiamata LLM) e `--include-ner-training` (training spaCy, lento, richiede worker).
Exit code = numero di flussi falliti.

## Stress

```bash
E2E_ADMIN_PASSWORD='...' python3 -m e2e.stress --users 10 --duration 60
# opzionale: warm-up di 5 articoli + re-hit SOLO su cache a <=0.5 rps globali
E2E_ADMIN_PASSWORD='...' python3 -m e2e.stress --users 10 --duration 60 --include-search-cached
```

**Regola d'oro: gli scraper esterni (Normattiva, EUR-Lex, Brocardi) non si
stressano MAI.** Sono siti terzi: il rate limit interno di :5000 non protegge
loro, e il rischio concreto e' il ban dell'IP. Lo stress colpisce solo endpoint
locali (eventi MERL-T, letture grafo, CRUD Prisma). Con `--include-search-cached`
gli unici hit scraper sono i 5 del warm-up iniziale; poi si rilegge la cache.
Guardrail fissi: max 50 utenti, max 600s (`--i-know-what-im-doing` li alza, ma
NON riattiva mai gli scraper). Soglie: err% < 1, p95 tracking < 500ms,
grafo < 1500ms, CRUD < 800ms — sforate ⇒ exit ≠ 0. Report: `e2e/out/stress-<run>.json`.

## Flussi

| Flow | Cosa prova | Tag | Costo |
|---|---|---|---|
| `flow_auth` | login admin, creazione utenti attivi, contratto register→inattivo | — | — |
| `flow_search` | ricerca :5000 (norma, testo, stream, albero, PDF) | `external_scraper`, `slow` | ~6 hit Normattiva/Brocardi — max 1 run |
| `flow_dossier` | CRUD dossier/item/note/evidenze/quick-norm/alias + IDOR | — | — |
| `flow_forum` | pubblica ambiente, like, download, suggerimenti take/decline | — | — |
| `flow_consent` | ciclo consenso none→basic→full→revoke→full | — | — |
| `flow_tracking` | i 5 eventi RLCF + profilo | `needs_merlt` | — |
| `flow_graph` | lettura grafo seed + lazy ingestion + poll job | `needs_merlt`, `needs_worker`, `slow` | — |
| `flow_qa` | domanda agli esperti + 4 canali di feedback | `needs_merlt`, `needs_full_consent`, `needs_llm`, `slow`, `costs_money` | ~0,01–0,10 € OpenRouter/run |
| `flow_contrib` | upload appunti → estrazione → gate copyright → promozione | `needs_merlt`, `needs_full_consent`, `needs_worker`, `needs_llm`, `slow` | 1 passata LLM sull'appunto |
| `flow_validate` | voto su proposte pendenti (secondo utente) | `needs_merlt`, `needs_full_consent` | — |
| `flow_ner` | feedback NER + stats/training admin | `needs_merlt`, `needs_full_consent`, `needs_admin` (training gated da `--include-ner-training`) | — |
| `flow_ops` | avvio training RLCF (tollera buffer < 50) | `needs_merlt`, `needs_admin` | — |

## Interpretare il report

Fine run: tabella a console (PASS/FAIL/SKIPPED per flow) + `e2e/out/report-<run>.json`.
Nel JSON: `flows[]` con esito e durata, `steps[]` con ogni richiesta HTTP
(metodo, URL, status, latenza, dettaglio d'errore). Uno SKIPPED e' sempre
motivato (`detail`), mai silenzioso. `known_issue` marca i difetti noti
dell'audit (es. `B` = bookmarks snake/camel, `H` = profile 503): non contano
come regressioni nuove.

## Mappa preflight → gap dell'audit

| Check preflight | Gap | Significato se rosso |
|---|---|---|
| #2 BFF→MERL-T, #3 MERL-T diretto, #4 container, #5 worker su 3 code | **D** | stack MERL-T spento o worker fermo → flussi MERL-T skippati; se manca la coda `merlt_ner_train` il training NER resta `queued` per sempre |
| #6 `RQ_REDIS_URL` sul container api | **E** | l'api non riesce ad accodare i job (ingest/extract): 202 ma nessun progresso |
| #7 `MERLT_API_KEY` nel BFF | **G** | `/ops/rlcf/training/start` risponde 503 |
| #8 `MERLT_INTERNAL_SECRET` coerente BFF↔worker, #9 grafo seminato (>100 nodi) | **I** | i callback del worker vengono rifiutati (job mai `completed`) / letture grafo vuote |

## Troubleshooting

- **Job ingestion/extraction fermo su `pending`** → worker fermo o coda
  sbagliata: `docker logs visualex-merlt-worker --tail 50` e rilancia il
  preflight (check 5 e 6). Il worker deve ascoltare `merlt_ingest merlt_extract
  merlt_ner_train`.
- **503 da `/ops/rlcf/training/start`** → `MERLT_API_KEY` mancante o errata in
  `backend/.env` (gap G): impostala e riavvia il BFF. Nota: `{success:false,
  "Buffer insufficiente (N/50)"}` NON e' un errore — e' il comportamento atteso
  finche' non c'e' abbastanza feedback.
- **Spinner ingestion infinito / side rail che non si popola** → preflight 5/6:
  o il worker e' giu' (D) o l'api non ha `RQ_REDIS_URL` (E). Se il grafo e'
  vuoto (check 9) il seed non e' stato caricato (file gitignored su clone fresco).
- **Login admin fallisce** → `ADMIN_PASSWORD` non passata a `start.sh` (l'admin
  non e' stato seedato) oppure `E2E_ADMIN_PASSWORD` diversa da quella del seed.
- **`flow_qa`/`flow_contrib` SKIPPED-llm** → manca `OPENROUTER_API_KEY` sui
  container MERL-T: atteso, non e' un fallimento.
