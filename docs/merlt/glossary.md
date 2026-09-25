# Glossario MERL-T: VisuaLexAPI

Termini ricorrenti nel codice e nei doc di **VisuaLexAPI**, con il punto in cui vivono nel repo. Per il quadro d'insieme vedi [system-map.md](./system-map.md).

## Runtime & integrazione (VisuaLexAPI)
- **BFF**: il layer Node/Express (`backend/`). **Unico** canale verso MERL-T: tutto passa per `/api/merlt/*`; il frontend non chiama mai `:8000`.
- **Sidecar MERL-T**: lo stack `docker-compose.merlt.yml`, 7 servizi. Sempre attivi: `merlt-postgres`, `merlt-redis`, `merlt-falkordb`, `merlt-qdrant`. Sotto il profilo `api-in-docker`, default di `start.sh`: `mcp-legal-it` (:8011), `merlt-api` (:8000), `merlt-worker`. Gate: `MERLT_ENABLED`.
- **`merlt/` (vendored)**: copia selettiva del Python upstream `ALIS_CORE/merlt`; **baked nell'immagine** al build (i cambi richiedono rebuild). Vedi `upstream-sync.md`.
- **Plugin host**: il registro di slot FE (`frontend/src/plugins/`) che monta le superfici MERL-T senza accoppiarle al core (`article_content_after`, `article_sidebar`, `global`).
- **Feature flag**: `MERLT_ENABLED` accende lo stack in `start.sh` ed è anche il kill switch del BFF su tutto `/api/merlt`. Nel BFF ci sono poi i sotto-flag `MERLT_GRAPH_ENABLED`, `MERLT_CONTRIBUTION_ENABLED`, `MERLT_VALIDATION_ENABLED` e `MERLT_OPS_ENABLED` (default `true`, filtrano per prefisso di path). Nel FE: `VITE_FEATURE_MERLT` / `VITE_FEATURE_MERLT_GRAPH` (default ON).

## I due loop RLCF
- **RLCF** (*Reinforcement Learning from Community Feedback*): il feedback della comunità, **pesato per authority**, guida l'apprendimento.
- **Loop α, arricchimento del grafo (co-autorialità)**: proposta → voto pesato → consenso → scrittura nel grafo. ✅ chiuso E2E in VisuaLexAPI.
- **Loop β, ragionamento (qualità risposte)**: query → esperti → sintesi → feedback multilivello → REINFORCE sui pesi. ✅ integrato su `/grafo` (Slice 4), con Q&A asincrona progressiva e training avviato a mano da admin.

## Authority & consenso
- **Authority `A_u`**: `A_u = α·B + β·T + γ·P`. **Calcolata da MERL-T** (`GET /api/v1/profile/full`). Il BFF la tiene in cache (`authorityCache.ts`, TTL 1 h, aggiornata quando un voto chiude il consenso) e la allega (`user_authority`) solo agli eventi di tracking. Voti e feedback portano solo `user_id`.
- **net_score**: somma dei voti **pesata per authority**; al raggiungimento di **±2.0** scatta il consenso (Loop α).
- **`consensus_reached`**: flag acceso da un **trigger PostgreSQL** al net_score; sblocca la promozione nel grafo. *(Era l'anello mancante: i trigger non erano installati.)*
- **δ / τ (disaccordo)**: entropia di Shannon normalizzata `δ∈[0,1]`; `τ=0.4` soglia di consenso, `>0.6` discussione strutturata (Loop β).
- **Devil's Advocate**: valutatori critici assegnati per contrastare il groupthink (upstream, non in VisuaLex).

## Storage & grafo
- **FalkorDB**: il grafo giuridico (Cypher); seed Libro IV CC ~27.7k nodi (`seed-libro-iv.md`).
- **Qdrant**: embedding vettoriali (`multilingual-e5-large`, 1024-dim).
- **Bridge table**: mapping `chunk_id ↔ graph_node_id` con peso apprendibile (Postgres).
- **URN**: identificatore NIR della norma. Per le chiamate al grafo va strippato il marcatore di versione (`!vig=`, `!orig=…`, `@originale`) via `normalizeGraphUrn()`, mai il wrapper URL Normattiva con cui il seed indicizza le norme (gotcha).

## Contribuzione & validazione (Loop α)
- **Extraction candidate / staging**: candidati **effimeri** da estrazione note (`extraction_candidates`, TTL 48h). Il **verbatim non entra mai** nei `pending_*`.
- **Copyright gate**: `promotionGate.ts`: promuovibile solo con *fonte* + *riformulazione ≠ verbatim* + *attestazione*; ri-verificato server-side contro il verbatim autorevole.
- **`pending_entity` / `pending_relation`**: proposte in coda di validazione comunitaria.
- **Voto (approve / reject / edit)**: voto pesato per authority su una proposta (`/merlt/valida`).

## Ragionamento & esperti (Loop β)
- **I 4 esperti**: Literal / Systemic / Principles / Precedent (canoni art. 12 Preleggi).
- **GatingPolicy / TraversalPolicy**: reti che instradano agli esperti / pesano le relazioni del grafo; addestrate via REINFORCE.
- **AdaptiveSynthesizer**: combina gli esperti in modo *convergent* (accordo) o *divergent* (preserva il disaccordo).
- **ExecutionTrace**: log delle azioni con `log_probs`; è il dato che abilita il policy gradient.

## UX & consenso utente
- **Consenso (`none` / `basic` / `full`)**: modello VisuaLex (`MerltUserPreference`). Mappa all'upstream `Basic/Learning/Research` (Learning≈basic, Research≈full).
- **AttributionChip**: chip sobrio «`da @utente`» (`features/bulletin/AttributionChip.tsx`); pattern di attribuzione da riusare per la co-autorialità sul grafo.
- **Lazy ingestion**: se un articolo non è nel grafo, un job **RQ** lo indicizza al volo (poll lato FE).
- **RQ worker**: `merlt-worker`, sulle code `merlt_ingest` (ingest lazy degli articoli e ingestion meccanica), `merlt_extract` (estrazione appunti) e `merlt_ner_train` (training NER). *Gotcha:* i job id non possono contenere `:`, quindi si usa `-` (`ingest-…`, `extract-…`). Ogni accodamento fissa un `job_timeout` esplicito.

## Q&A, co-evoluzione e governance
- **Q&A asincrona (`MerltQaJob`)**: submit (`POST /experts/query/async`) → polling (`GET /experts/jobs/:id/status`) → callback per esperto (`/internal/qa-callback`). Il lavoro gira in-process su merlt-api. Contratto: `qa-async-progressive-contract.md`.
- **Chiedere / insegnare**: chiedere richiede consenso `basic` (`consentGuard`); insegnare richiede `full` (`contributionGuard`). Insegnare comprende i feedback sulla risposta, «Ricorda nel grafo», i contributi, i voti e il feedback NER.
- **Canali di steering**: «Mi convince» (preferenza di canone → head di gating), preferenza di relazione (→ traversal) e confirm-source. Il BFF li deduplica in memoria per 10 minuti.
- **Nodo provvisorio (`live:`)**: fonte live recuperata dagli esperti (da `mcp-legal-it`) e sedimentata nel grafo come `live_unconfirmed`, con `URN = node_id = "live:<hash>"`, URL reale in `source_url` e trust 0.6. Con l'uso e il feedback diventa `confirmed`; l'igiene decade, mette in revisione o pota i nodi senza segnale umano.
- **Igiene del grafo**: `pipeline/hygiene.py`: riconcilia i doppioni, decade, mette in quarantena per la revisione (`/merlt/valida`), pota. Tocca solo i nodi `live_unconfirmed`. Gira ogni `MERLT_HYGIENE_INTERVAL_HOURS` (compose 24) o su richiesta dall'hub.
- **Batch di ingestion meccanica**: ingestion deterministica, senza LLM, di corpus normativo (`visualex_tree`, `italia_corpus`), messa in staging con un report di conflitti e promossa o rifiutata da un admin (tab «Ingestione» in `/admin`).
