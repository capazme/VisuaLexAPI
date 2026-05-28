# Piano Esecutivo `visualex-merlt-main`

Questo piano guida il branch `visualex-merlt-main`, separato dalla Visualex vanilla in produzione. L'obiettivo non e' una demo MERLT, ma una linea prodotto completa che riusa cio' che esiste gia' in `merlt`, `merlt-models` e `visualex-merlt`.

## Regole Di Branch

- `main` resta la linea vanilla/production.
- `visualex-merlt-main` e' la linea prodotto MERLT/RLCF.
- Tutto cio' che riguarda MERLT entra in questo branch o in branch figli basati su questo branch.
- Nessun endpoint MERLT viene esposto direttamente al browser: il browser usa sempre il BFF Node `/api/merlt/*`.
- Nessuna feature MERLT e' "done" senza build, test e smoke con MERLT acceso.

## Asset Esistenti Da Non Dimenticare

### `ALIS_CORE/merlt`

Da riusare come backend canonico MERLT:

- `merlt/app.py`: FastAPI completa con router e health aggregata.
- `merlt/api/experts_router.py`: Q&A multi-expert, feedback inline/detailed/source/preference/router/refine, trace.
- `merlt/api/enrichment_router.py`: check article, live enrichment, pending queue, propose/validate entity/relation, issue voting, NER feedback, dossier training export.
- `merlt/api/graph_router.py`: check article, article entities/relations, node detail, subgraph, graph search.
- `merlt/api/profile_router.py`: full profile, authority domains, detailed contribution stats.
- `merlt/api/rlcf_router.py`, `training_router.py`, `quarantine_router.py`: training, buffer, policy weights, aggregation, moderation.
- `merlt/api/dashboard_router.py`, `pipeline_router.py`, `regression_router.py`: ops, pipeline monitoring, regression.
- `merlt/api/document_router.py`: upload/parse/list documenti e amendments.
- `docker-compose.dev.yml`, `Dockerfile`, `start_dev.sh`: base runtime, da rendere coerente con VisuaLex.

Rischi da chiudere:

- Decidere una sola app FastAPI da shipparre: preferenza `merlt.app:app`; `visualex_bridge.py` va considerato legacy/bridge o va allineato.
- Allineare porte/env tra Docker compose MERLT e VisuaLex.
- Verificare tool wiring dell'orchestrator, altrimenti Q&A rischia di partire senza RAG/graph tools.
- Sostituire stub di tracking se si usa `visualex_bridge.py`; meglio usare router reali `feedback_api.py` e `tracking_router.py`.

### `ALIS_CORE/merlt-models`

Da riusare come fonte modelli/config:

- `config/experts/experts.yaml`: expert config e traversal weights.
- `config/experts/prompts.yaml`: prompt esperti e output contracts.
- `config/task_config.yaml`: schemi task/feedback/ground truth.
- `config/model_config.yaml`: authority, modelli AI, config generale.
- `config/rlcf_training.yaml`: training RLCF.
- `weights/config/weights.yaml`: retrieval, expert traversal, RLCF, gating weights.
- `weights/store.py`, `weights/learner.py`, `weights/experiment.py`: storage/learning/experiment tracking.

Rischi da chiudere:

- Esistono configurazioni duplicate in `merlt`; serve fonte canonica e CI check anti-drift.
- `weights` non e' pacchettizzato come modulo installabile solido; va sistemato prima della produzione.
- Il Dockerfile di `merlt-models` ha possibili mismatch `MODELS_DIR`/copy layout.
- VisuaLexAPI non deve importare `merlt-models`; il flusso corretto e' VisuaLexAPI -> MERLT -> merlt-models.

### `ALIS_CORE/visualex-merlt`

Da adattare nel nuovo VisuaLexAPI:

- `frontend/src/plugin/index.ts`: manifest plugin, initialize, slot components, event handlers.
- `frontend/src/types/platform.d.ts`: base types per plugin host, da riconciliare con VisuaLexAPI.
- Slot componenti: article toolbar/sidebar/content overlay, graph view, profile tabs, admin dashboard, dossier actions, bulletin board.
- `frontend/src/services/merltInit.ts`, `tracking.ts`, `merltService.ts`: init, WebSocket/tracking/API surface.
- `frontend/src/plugin/__tests__/merltPlugin.test.ts` e mock EventBus.
- `PLUGIN_QUICK_REFERENCE.md`, `docs/PLUGIN_ARCHITECTURE.md`, `migration/merlt-imports-map.json`.

Rischi da chiudere:

- Docs e codice divergono; usare il codice come sorgente, docs come checklist.
- `merlt_contribution` e `merlt_validation` sono documentati ma non pienamente applicati come fine-grained gates.
- Non copiare `rlcf-web` dentro VisuaLexAPI: usarlo come riferimento UI, non come secondo frontend.

## Piano Di Esecuzione

### Fase 0 - Baseline E Sicurezza Branch

Obiettivo: rendere il branch lavorabile senza contaminare `main`.

Da fare:

- Confermare `git branch --show-current == visualex-merlt-main`.
- Committare o almeno separare in un primo changeset lo scaffolding MERLT attuale.
- Documentare gap tra scaffolding attuale e architettura target.
- Definire criteri "done" per prodotto completo.

Acceptance:

- Branch dedicato attivo.
- `main` non viene toccato.
- Build/test baseline verdi o failure note e tracciate.

### Fase 1 - Runtime MERLT Reale

Obiettivo: un comando avvia VisuaLex + MERLT completo.

Da fare:

- Scegliere app canonica MERLT: `merlt.app:app`.
- Creare `docker-compose.merlt.yml` o integrare `merlt/docker-compose.dev.yml` con VisuaLex.
- Allineare env: Postgres MERLT, Redis, FalkorDB, Qdrant, OpenRouter/API keys, `VISUALEX_API_URL`.
- Aggiungere health/deep health BFF che chiama MERLT `/health` e `/api/v1/dashboard/health`.
- Aggiornare `start.sh` per usare porte corrette e controlli robusti.

Acceptance:

- `./start.sh` o comando documentato avvia Visualex API, Node, frontend, MERLT, FalkorDB, Qdrant, Redis, DB.
- `curl /api/merlt/health` risponde con MERLT reale.
- `curl /api/merlt/ops/dashboard/health` mostra dipendenze reali.

### Fase 2 - Plugin Host In VisuaLexAPI

Obiettivo: sostituire componenti hardcoded con plugin/slot system.

Da fare:

- Portare/adattare il modello di `visualex-merlt/frontend/src/plugin/index.ts`.
- Implementare plugin registry in VisuaLexAPI.
- Implementare slot host: article toolbar, sidebar, content overlay, graph view, profile tabs, admin dashboard, dossier actions, bulletin/community.
- Portare EventBus tipizzato.
- Portare manifest e feature flags: `merlt`, `merlt_contribution`, `merlt_validation`, `merlt_graph`, `merlt_ops`.
- Rendere la MERLT UI registrata tramite plugin, non importata direttamente da `ArticleTabContent`.

Acceptance:

- Disabilitando `merlt`, spariscono tutti gli slot MERLT senza cambiare codice articolo.
- Test plugin host e slot registry passano.
- `ArticleTabContent` non conosce componenti MERLT concreti.

### Fase 3 - Consenso, Audit, Feature Flags Persistenti

Obiettivo: consenso e abilitazioni sono dati prodotto, non `localStorage`.

Da fare:

- Aggiungere modello DB Prisma per preferenze MERLT utente e audit consenso.
- Endpoint BFF per leggere/scrivere consenso.
- Eventi audit per consenso base/full/revoca.
- Gating lato BFF: niente tracking o contribution senza consenso.
- Gating admin ops con ruolo admin + feature flag.

Acceptance:

- Consenso sopravvive logout/login.
- Revoca consenso blocca tracking RLCF.
- Audit consenso consultabile lato admin/dev.

### Fase 4 - BFF API Contract Forte

Obiettivo: proxy MERLT robusto, non pass-through fragile.

Da fare:

- Zod schema per ogni endpoint critico.
- Mappatura payload camelCase frontend -> snake_case MERLT.
- Response adapters TypeScript.
- Error mapping coerente.
- Retry/timeout policy per long-running.
- Multipart support per document upload.
- WebSocket/SSE proxy se richiesto da MERLT.

Acceptance:

- Test unitari BFF con MERLT mock.
- Test negativi per payload invalidi.
- Nessun endpoint critico accetta `Record<string, unknown>` senza schema.

### Fase 5 - Sprint 1 Product Core: Enrichment E Validation

Obiettivo: prima release funzionale MERLT utile su articolo reale.

Da fare:

- Check automatico articolo nel KG quando viene aperto.
- Stati UI: presente, assente, pending, enriching, errore.
- Live enrichment batch + streaming progress se disponibile.
- Graph preview leggibile: entita, relazioni, confidenza, stato validazione.
- Pending queue ergonomica.
- Validation UI con authority weight e spiegazione voto.
- Proposal UI per entita/relazioni.

Acceptance:

- Su articolo reale si vede stato KG.
- Se assente, si puo' arricchire.
- Si possono validare entita/relazioni.
- Voti arrivano a MERLT con `user_id`, `article_urn`, authority metadata.

### Fase 6 - Expert Q&A Completo

Obiettivo: Q&A multi-expert da prodotto.

Da fare:

- UI conversazionale per articolo/workspace.
- Mode convergent/divergent.
- Alternative interpretative e confronto.
- Reasoning steps e expert weights.
- Fonti cliccabili che aprono articolo/nodo.
- Feedback inline/detailed/source/preference/router.
- Refine conversazionale.
- Salvataggio `trace_id` e collegamento dossier/workspace.

Acceptance:

- Query su articolo reale produce sintesi, esperti, confidence, fonti, reasoning.
- Feedback multipli finiscono nel loop RLCF.
- Risposta puo' essere salvata in dossier.

### Fase 7 - Graph View E Semantic Search

Obiettivo: FalkorDB/Qdrant visibili e navigabili.

Da fare:

- Graph workspace interattivo.
- Graph search semantico.
- Article relations e subgraph per URN.
- Click nodo/arco con detail panel.
- Neighbor exploration.
- Citation linker -> nodo MERLT.
- Stato pending/validated/rejected su nodi/archi.

Acceptance:

- Da articolo si apre sottografo.
- Ricerca semantica mostra nodi e relazioni.
- Click nodo apre dettagli e navigazione articolo.

### Fase 8 - RLCF Implicito E Authority

Obiettivo: comportamento utente alimenta RLCF in modo verificabile.

Da fare:

- Eventi: article viewed, scroll depth, long read, quick close.
- Eventi: search performed, result clicked.
- Eventi: highlight, annotation, selection, citation detected.
- Eventi: bookmark/quicknorm created/deleted.
- Eventi: dossier export training.
- Eventi: forum issue viewed/reported/voted.
- Batch/session flush.
- Profile UI con authority globale, domain authority, stats, badge, track record.

Acceptance:

- Ogni evento ha test o smoke.
- MERLT riceve `user_id`, `article_urn`, `trace_id` quando applicabile.
- Profile authority mostra dati reali da MERLT.

### Fase 9 - Admin, Training Ops, Monitoring

Obiettivo: MERLT gestibile in produzione.

Da fare:

- Dashboard admin MERLT.
- RLCF buffer/training status.
- Policy weights/history.
- Pipeline run history, errors, retry.
- LLM cost/latency stats se disponibili.
- Trigger training manuale.
- Regression runner.
- Feedback quarantine/moderation.

Acceptance:

- Admin vede stato runtime e training.
- Admin puo' avviare/fermare training se MERLT lo supporta.
- Errori pipeline e regressioni sono consultabili.

### Fase 10 - Documenti, Dossier, Community Avanzata

Obiettivo: chiudere feature avanzate senza secondo frontend.

Da fare:

- Multipart/PDF upload via BFF.
- Parse/extraction UI.
- Dossier export come training dataset.
- Compare divergent responses.
- Annotation/highlight come fine-tuning signals.
- Bulletin/community RLCF con consensus pesato da authority.

Acceptance:

- Documento caricato viene tracciato e parsato.
- Dossier esportabile in training set.
- Community signals arrivano a MERLT.

### Fase 11 - Release Candidate

Obiettivo: branch pronto da promuovere.

Da fare:

- Backend build/test.
- Frontend build/test.
- MERLT tests mirati.
- BFF integration tests con MERLT mock.
- E2E con MERLT reale acceso.
- Browser smoke su articolo reale.
- Documentazione runbook.
- Decisione deploy: branch long-lived, PR verso branch staging o release separata.

Acceptance:

- Test suite verde.
- Smoke reale verde.
- Runbook ripetibile.
- Nessuna feature core dichiarata "done" senza verifica runtime.

## Primo Slice Da Fare Ora

La prossima slice non deve aggiungere UI. Deve stabilizzare le fondamenta:

1. Rendere `visualex-merlt-main` la linea di lavoro ufficiale.
2. Creare runtime MERLT reale e verificabile.
3. Sostituire l'integrazione hardcoded attuale con plugin host minimo.
4. Spostare il consenso da `localStorage` a backend/DB.
5. Aggiungere test BFF per i primi endpoint: features, health, experts query, feedback interaction.

Solo dopo questa slice ha senso rifinire UI graph, Q&A e dashboard.
