# Glossario MERL-T — VisuaLexAPI

Termini ricorrenti nel codice e nei doc di **VisuaLexAPI**, con il punto in cui vivono nel repo. Per il quadro d'insieme vedi [system-map.md](./system-map.md).

## Runtime & integrazione (VisuaLexAPI)
- **BFF** — il layer Node/Express (`backend/`). **Unico** canale verso MERL-T: tutto passa per `/api/merlt/*`; il frontend non chiama mai `:8000`.
- **Sidecar MERL-T** — lo stack `docker-compose.merlt.yml`: `merlt-api :8000` + `merlt-postgres` + `merlt-redis` + `merlt-falkordb` + `merlt-qdrant` + `merlt-worker`. Gate: `MERLT_ENABLED`.
- **`merlt/` (vendored)** — copia selettiva del Python upstream `ALIS_CORE/merlt`; **baked nell'immagine** al build (i cambi richiedono rebuild). Vedi `upstream-sync.md`.
- **Plugin host** — il registro di slot FE (`frontend/src/plugins/`) che monta le superfici MERL-T senza accoppiarle al core (`article_content_after`, `article_sidebar`, `global`).
- **Feature flag** — `MERLT_ENABLED` (stack), `VITE_FEATURE_MERLT` / `VITE_FEATURE_MERLT_GRAPH` (FE, default ON).

## I due loop RLCF
- **RLCF** — *Reinforcement Learning from Community Feedback*: il feedback della comunità, **pesato per authority**, guida l'apprendimento.
- **Loop α — arricchimento del grafo (co-autorialità)** — proposta → voto pesato → consenso → scrittura nel grafo. ✅ chiuso E2E in VisuaLexAPI.
- **Loop β — ragionamento (qualità risposte)** — query → esperti → sintesi → feedback multilivello → REINFORCE sui pesi. 📦 in libreria, non integrato (Slice 3).

## Authority & consenso
- **Authority `A_u`** — `A_u = α·B + β·T + γ·P`. **Calcolata lato VisuaLex** (da qualifica + track record) e **iniettata a ogni chiamata** verso MERL-T (`user_authority`). Cache: `authorityCache.ts`.
- **net_score** — somma dei voti **pesata per authority**; al raggiungimento di **±2.0** scatta il consenso (Loop α).
- **`consensus_reached`** — flag acceso da un **trigger PostgreSQL** al net_score; sblocca la promozione nel grafo. *(Era l'anello mancante: i trigger non erano installati.)*
- **δ / τ (disaccordo)** — entropia di Shannon normalizzata `δ∈[0,1]`; `τ=0.4` soglia di consenso, `>0.6` discussione strutturata (Loop β).
- **Devil's Advocate** — valutatori critici assegnati per contrastare il groupthink (upstream, non in VisuaLex).

## Storage & grafo
- **FalkorDB** — il grafo giuridico (Cypher); seed Libro IV CC ~27.7k nodi (`seed-libro-iv.md`).
- **Qdrant** — embedding vettoriali (`multilingual-e5-large`, 1024-dim).
- **Bridge table** — mapping `chunk_id ↔ graph_node_id` con peso apprendibile (Postgres).
- **URN** — identificatore NIR della norma. Per le chiamate al grafo va strippato il marcatore versione (`!vig=`) via `normalizeGraphUrn()` (gotcha).

## Contribuzione & validazione (Loop α)
- **Extraction candidate / staging** — candidati **effimeri** da estrazione note (`extraction_candidates`, TTL 48h). Il **verbatim non entra mai** nei `pending_*`.
- **Copyright gate** — `promotionGate.ts`: promuovibile solo con *fonte* + *riformulazione ≠ verbatim* + *attestazione*; ri-verificato server-side contro il verbatim autorevole.
- **`pending_entity` / `pending_relation`** — proposte in coda di validazione comunitaria.
- **Voto (approve / reject / edit)** — voto pesato per authority su una proposta (`/merlt/valida`).

## Ragionamento & esperti (Loop β — upstream)
- **I 4 esperti** — Literal / Systemic / Principles / Precedent (canoni art. 12 Preleggi).
- **GatingPolicy / TraversalPolicy** — reti che instradano agli esperti / pesano le relazioni del grafo; addestrate via REINFORCE.
- **AdaptiveSynthesizer** — combina gli esperti in modo *convergent* (accordo) o *divergent* (preserva il disaccordo).
- **ExecutionTrace** — log delle azioni con `log_probs`; è il dato che abilita il policy gradient.

## UX & consenso utente
- **Consenso (`none` / `basic` / `full`)** — modello VisuaLex (`MerltUserPreference`). Mappa all'upstream `Basic/Learning/Research` (Learning≈basic, Research≈full).
- **AttributionChip** — chip sobrio «`da @utente`» (`features/bulletin/AttributionChip.tsx`); pattern di attribuzione da riusare per la co-autorialità sul grafo.
- **Lazy ingestion** — se un articolo non è nel grafo, un job **RQ** lo indicizza al volo (poll lato FE).
- **RQ worker** — `merlt-worker`: estrazione note + ingest grafo. *Gotcha:* i job id non possono contenere `:` (usare `-`).
