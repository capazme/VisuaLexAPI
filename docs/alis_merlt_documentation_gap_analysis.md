# ALIS / MERLT Documentation Gap Analysis

Questo documento confronta lo stato del branch `visualex-merlt-main` con la documentazione letta in:

- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/core_docs`
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/docs`
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/docs`
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/visualex-merlt`
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/_bmad-output/planning-artifacts`
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/_bmad-output/analysis`

## Sintesi Onesta

Lo stato attuale e' uno scaffolding funzionante per collegare VisuaLexAPI a MERLT, non ancora il prodotto ALIS descritto dai documenti.

La documentazione non descrive solo "MERLT dentro VisuaLex", ma un sistema completo:

1. Browse in VisuaLex.
2. Analyze con pipeline MERL-T sequenziale secondo Art. 12 Preleggi.
3. Traceability totale: Expert -> Sources -> Reasoning.
4. Feedback RLCF con authority weighting.
5. Learn: buffer, training, policy evolution e audit.
6. Knowledge Graph reale con 1k+ norme, bridge chunk->node e Qdrant/Falkor integrati.
7. Plugin completo a 8 slot, non un box articolo e una workspace tecnica.

## Non Negoziabili Dai Docs

### Prodotto

- **4 profili utente**: Consultazione Rapida, Ricerca Assistita, Analisi Esperta, Contributore Attivo.
- **IDE per giuristi**: command palette, peek definition su citazioni, split view, problems panel, keyboard-first.
- **Workflow integrato**: Browse -> Analyze -> Feedback -> Learn.
- **MVP thesis**: demo funzionante, 1k+ norme nel KG, RLCF operativo anche con dati sintetici, tracciabilita' completa.

### Architettura

- Tre livelli: presentation, application, data.
- Quattro storage: PostgreSQL, FalkorDB, Qdrant, Redis.
- MERLT come sidecar FastAPI, non esposto direttamente al browser.
- VisuaLexAPI come fonte di testo/struttura normativa.
- `visualex-merlt` come plugin/integration layer.
- `merlt-models` come fonte configurazioni/pesi, da non dimenticare.

### MERL-T

- Quattro Expert: Literal, Systemic, Principles, Precedent.
- Sequenza Art. 12 da rendere visibile o giustificata se eseguita in parallelo.
- Synthesizer con pesi dipendenti da domanda, fonti e RLCF.
- Output citabile in atti: ogni affermazione deve essere fonte/verificabile.
- Trace completa, esportabile e riproducibile.

### Knowledge Graph / Retrieval

- Ingestion path: testo -> chunk -> embedding -> bridge table -> graph node.
- Hybrid retrieval: semantico Qdrant + grafo Falkor.
- Relazioni giuridiche navigabili: RINVIA, MODIFICA, DEROGA, ABROGA, ATTUA, DEFINISCE, INTERPRETA.
- Graph view vera, non JSON dump.

### RLCF

- Feedback su retrieval, reasoning, synthesis e source/bridge quality.
- Authority weighting basato su background, coerenza, consenso, dominio.
- Audit trail e consenso su ogni azione di learning.
- Buffer, aggregation, policy weights/history, training trigger.
- Export dataset per validazione accademica.

### Plugin / UI

Docs e `visualex-merlt` parlano di almeno 8 slot MERLT:

- `article-toolbar`
- `article-sidebar`
- `article-content-overlay`
- `profile-tabs`
- `admin-dashboard`
- `bulletin-board`
- `dossier-actions`
- `graph-view`

Lo stato attuale ha solo un plugin host minimo e un vero slot (`article_content_after`).

## Stato Attuale Del Branch

### Gia' Fatto

- Branch separato `visualex-merlt-main`.
- Runtime locale con MERLT + PostgreSQL + FalkorDB + Qdrant + Redis.
- BFF Node `/api/merlt/*` con forwarding e alcuni adapter.
- Feature flags e consenso persistente lato DB.
- Primo EventBus leggero.
- Box articolo MERLT/RLCF.
- Workspace MERLT tecnica su `/merlt`.
- Test BFF per consenso, forwarding, alcuni contratti, graph path, validation payload.
- Smoke live dei servizi.
- Fix in MERLT per:
  - `article_text` su live enrichment;
  - cache path che non deve restituire `[Caricato da cache]`;
  - Qdrant client `query_points`.

### Perche' Non Basta

- Non c'e' ancora la **pipeline MERL-T product-grade** visibile all'utente.
- Non c'e' **Expert Accordion UI** con contribution per expert.
- Non c'e' **trace viewer** completo.
- Non c'e' **citation-ready export** della traccia.
- Non c'e' **Knowledge Graph popolato 1k+ norme**.
- Non c'e' ingestion completa con bridge table.
- Non c'e' **Graph View interattiva**.
- Non c'e' **4-profile system**.
- Non c'e' **GDPR export/erasure** per dati MERLT/RLCF.
- Non c'e' **audit immutabile 7 anni**.
- Non c'e' **policy evolution dashboard** seria.
- Non c'e' **RLCF training loop automatizzato**.
- Non c'e' **Devil's Advocate UX**.
- Non c'e' **test design system** con Testcontainers/k6/E2E.

## Gap Per Epic

### Epic 1 - Foundation, Profili, Consent, Authority

Stato: parziale.

Manca:

- 4 profili prodotto.
- Invitation/onboarding.
- GDPR export/erasure.
- Audit trail append-only/tamper-evident.
- Authority explanation UI.
- Consent levels coerenti coi docs: Basic/Learning/Research o mapping esplicito col nostro none/basic/full.

### Epic 2a/2b/2c - Corpus, KG, Qdrant, Bridge

Stato: quasi tutto mancante lato prodotto.

Manca:

- Ingestion target documentato: almeno Libro IV / 1k+ norme.
- Scraping schedules.
- Manual ingest trigger admin.
- Bridge table chunk -> graph node.
- Qdrant collection popolata.
- FalkorDB popolato con schema coerente.
- Test coverage su graph/vector/bridge.

### Epic 3 - Norm Browsing + KG Awareness

Stato: VisuaLex vanilla copre browsing/search, ma non ALIS KG awareness.

Manca:

- KG coverage indicator per norma.
- Norm modification awareness.
- Temporal validity nel percorso MERLT.
- Problems panel per conflitti / norme modificate.
- Collegamento citazioni -> nodi KG.

### Epic 4 - MERL-T Pipeline

Stato: endpoint MERLT esiste, UI e contratto prodotto non completi.

Manca:

- Pipeline sequenziale Art. 12 esplicita o giustificazione architetturale parallel/gating.
- Expert routing/gating visibile.
- Circuit breaker per Expert in UI/ops.
- Gold standard regression runner integrato.
- Temporal query.
- Precedent database reale.

### Epic 5 - Traceability

Stato: molto insufficiente.

Manca:

- Trace storage robusto.
- Expert Accordion.
- Source navigation.
- Citation-ready export.
- Reproduce historical query.
- Validita' temporale delle fonti.
- Zero unsourced statements come criterio enforceable/testato.

### Epic 6 - RLCF Collection

Stato: tracking embrionale.

Manca:

- Feedback granularity F1-F8.
- NER confirm/correction inline.
- Expert output feedback per componenti.
- Synthesizer feedback.
- Bridge quality feedback: "Fonti usate".
- PII anonymization prima storage.
- Feedback history utente.
- Audit RLCF vero.

### Epic 7 - Authority, Aggregation, Training Buffer

Stato: endpoint/status presenti, prodotto incompleto.

Manca:

- Authority domain-specific reale.
- Aggregazione per componenti.
- Training buffer governato da soglie.
- F2 router feedback per high-authority.
- F8c expert_affinity.
- F8d TraversalPolicy training.

### Epic 8 - Research / Policy Evolution / Devil's Advocate

Stato: quasi tutto UI/research mancante.

Manca:

- Policy evolution visualization.
- Dataset export accademico.
- Baseline vs RLCF comparison.
- Devil's Advocate panel e feedback.
- Reproducibility package.

### Epic 9/10 - Admin/Ops/API

Stato: BFF proxy c'e', prodotto no.

Manca:

- Admin dashboard strutturata.
- Pipeline monitoring con error log/costi/latency.
- Regression runner.
- Quarantine feedback UX.
- API docs/versioning/developer access.
- MERLT API keys workflow.

## Vecchia Codebase Da Riusare

Da `visualex-merlt`:

- Plugin manifest e slot wiring.
- `MerltSidebarPanel`, `MerltToolbar`, `MerltContentOverlay`.
- `GraphViewSlot`.
- `ProfilePage`.
- `AcademicDashboard`.
- `DossierActionsSlot`.
- `BulletinBoardSlot`.
- `tracking.ts`.
- `merltService.ts` completo come checklist API.
- Tests plugin/service.

Da `rlcf-web`:

- FeedbackPanel.
- RouterFeedbackPanel.
- Policy/analytics/admin UI.
- ExportHub.
- Trace/Execution viewers.

Da `merlt-models`:

- Experts YAML.
- Prompts YAML.
- Task config.
- RLCF training config.
- Weights config/store/learner.

## Ordine Corretto Da Ora

### Fase A - Rendere Il Runtime Scientifico, Non Solo Avviato

1. Importare/ingestare corpus minimo reale.
2. Popolare FalkorDB.
3. Popolare Qdrant.
4. Creare/verificare bridge table.
5. Smoke: graph search deve tornare risultati reali, non subgraph vuoto.
6. Smoke: Q&A deve citare fonti reali.

Done: query su art. 1218/1453/2043 c.c. produce retrieval reale, fonti e trace.

### Fase B - Portare La Plugin Architecture Vera

1. Portare 8 slot da `visualex-merlt`.
2. Rimuovere box monolitico come unica UI.
3. Article toolbar: "Analizza con MERL-T".
4. Article sidebar: Expert analysis.
5. Content overlay: citations/NER feedback.
6. Graph view: graph UI.
7. Profile tabs: authority/contributions.
8. Admin dashboard: ops/RLCF.

Done: MERLT e' plugin disabilitabile/abilitabile, non hardcoded.

### Fase C - Expert Q&A Product

1. Query UX da articolo e workspace.
2. Expert Accordion.
3. Trace viewer.
4. Sources panel.
5. Citation export.
6. Convergent/divergent compare.
7. Feedback inline/detailed/source/router/refine.

Done: output usabile in una memoria, con fonti e reasoning.

### Fase D - RLCF Product

1. 4 profili.
2. Feedback F1-F8.
3. Authority UX e spiegazione.
4. Feedback history.
5. Policy evolution.
6. Training buffer.
7. Synthetic feedback tooling.
8. Export dataset.

Done: "Feedback -> Learn" dimostrabile, anche con dati sintetici.

### Fase E - Admin/Ops/Research

1. Ingest manuale.
2. KG freshness.
3. Pipeline monitoring.
4. Regression runner.
5. Quarantine feedback.
6. k6 baselines.
7. Reproducibility docs.

Done: demo thesis ripetibile e difendibile.

## Nuovo Criterio Di Done

Una feature ALIS/MERLT e' done solo se:

1. Ha UI coerente col profilo utente.
2. Passa da BFF, non chiama sidecar direttamente.
3. Produce dati reali o segnala chiaramente che mancano corpus/chiave/dataset.
4. Ha trace/log/test.
5. Ha smoke E2E.
6. Non ritorna placeholder spacciati per risultato.

## Prossima Slice Raccomandata

Non aggiungere altri pulsanti.

Fare invece:

1. **Corpus/KG/Qdrant bootstrap** per un dominio piccolo ma reale: Costituzione + Libro IV campione.
2. **Graph search reale**: niente collection vuota.
3. **Expert Q&A reale con trace/source** su 3 query gold.
4. **Smoke E2E script** che fallisce se trova placeholder, graph vuoto dove non dovrebbe, o fonti mancanti.

Questa slice chiude il gap piu' grave: oggi il sistema e' acceso, ma non ancora scientificamente/produttivamente significativo.
