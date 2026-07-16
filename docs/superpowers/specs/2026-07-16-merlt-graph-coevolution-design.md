# MERL-T — Il loop di co-evoluzione del grafo (design)

**Data:** 2026-07-16 · **Branch:** `visualex-merlt-main` · **Stato:** design approvato dall'owner.

## Visione

Il knowledge graph giuridico deve **crescere spontaneamente con l'uso e con la community**, invece che solo per ingestione manuale. Quando una risposta recupera live una norma non ancora nel grafo, quella norma deve poter entrare (a bassa fiducia), guadagnarsi fiducia dai segnali d'uso, e — se matura — diventare parte confermata del grafo; i casi dubbi vanno alla review umana. Il grafo diventa così un artefatto vivo che co-evolve col ragionamento di MERL-T e con i giuristi che lo usano.

**Decisioni owner (dal brainstorming):**
- **Modello di validazione: IBRIDO** — sedimentazione automatica immediata a bassa fiducia, promozione a "confermato" gated da segnali impliciti + review esplicita per i casi dubbi.
- **Segnali di promozione impliciti (scelti):** (1) feedback positivo sulla risposta, (2) ri-recupero ricorrente, (3) citazione da nodi confermati. *Escluso*: convergenza multi-canone (troppo rumorosa).

## Modello di dati — il ciclo di vita della fiducia

Un nodo del grafo porta:
- `provenance`: `seed` | `live_unconfirmed` | `confirmed` (+ i valori storici già presenti).
- `trust`: float. Seed/confirmed ≈ 1.0; `live_unconfirmed` parte a 0.6 (già così in `provisional_writer`).
- Contatori di segnale (nuovi, additivi, mai distruttivi):
  - `usage_count`: quante volte il nodo è stato ri-recuperato dopo la sedimentazione.
  - `positive_feedback_count`: quante risposte 👍 lo hanno usato.
  - `has_confirmed_citation`: bool — un nodo confermato rinvia a questo.
  - `first_seen_at` / `last_used_at`: per l'igiene (decadimento).

Il retriever già applica un fattore di sfiducia ai `live_unconfirmed` (trust 0.6 → factor 0.8), quindi i provvisori restano subordinati ai confermati finché non sono promossi. **Invariante**: la promozione può solo ALZARE la fiducia; la demozione/decadimento è un percorso separato ed esplicito (Slice C).

---

## Slice A — Il grafo assorbe *(prerequisito; oggi rotto)*

**Problema.** La sedimentazione è interamente cablata (`orchestrator._sediment_live_sources` gira fire-and-forget dopo la sintesi; `pipeline/provisional_writer.write_provisional_sources` scrive i nodi `live_unconfirmed` + chunk Qdrant), ma raccoglie le fonti da `expert._live_sources_retrieved`, popolato SOLO da `base._retrieve_live_legal_sources` — chiamato solo nel path NON-ReAct. Sotto ReAct (la modalità profonda di default) gli strumenti live girano dentro il loop ma i loro risultati non entrano nel buffer → **0 nodi `live_unconfirmed`** (verificato live: `MATCH ... count=0`). È la stessa classe del bug del cammino-grafo (il ReAct bypassa i buffer che i metodi legacy popolavano).

**Fix.** Dopo il `react_loop`, filtrare le fonti raccolte per quelle provenienti da **strumenti live** (mcp-legal-it: `cerca_giurisprudenza`, `cite_law`, `cerca_brocardi`, `leggi_sentenza`, …) **che hanno risolto a una URN canonica**, e accodarle a `self._live_sources_retrieved` (dedupe per URN). Non ri-scrapare: i risultati sono già in `all_sources`. Il resto della catena (sedimentazione → provisional_writer) è già pronto e scatta.

**Punti di intervento (da confermare in implementazione):**
- `experts/base.py` e/o `experts/react_mixin.py`: identificare le fonti live nelle `all_sources` del ReAct (tag `source`/`provenance` impostati da `_extract_sources_from_result` o dagli adapter MCP) e popolare `_live_sources_retrieved`. Riusare i criteri di `_retrieve_live_legal_sources` (provenance, URN risolta) senza rifare le chiamate.
- Nessun nuovo flag: la sedimentazione è già attiva; va solo alimentata.

**Verifica live.** Query che scatena uno strumento live con URN (es. su giurisprudenza o su una norma non in-graph) → `MATCH (n) WHERE n.provenance='live_unconfirmed' RETURN count(n)` > 0; il nodo ha `trust≈0.6` e chunk su Qdrant.

**Rischi.** Rumore (norme irrilevanti sedimentate) — mitigato dal basso trust (subordinati nel ranking) e dall'igiene di Slice C. Doppioni — `provisional_writer` fa MERGE idempotente su node_id deterministico.

---

## Slice B — Il grafo impara *(il motore di co-evoluzione)*

Strumentare i 3 segnali e un job di promozione. Tutto sul nodo del grafo.

1. **Feedback risposta → nodi usati.** Sui canali di feedback esperti (`experts_router` `/feedback/inline` positivo), risalire dal `trace_id` alla risposta (`qa_traces` / la risposta cachata) → estrarre le URN dei `live_unconfirmed` che l'hanno prodotta (da `retrieved_sources` + `graph_traversal`) → `positive_feedback_count++` su quei nodi. Fire-and-forget, failure-isolated.
2. **Ri-recupero.** Nel retriever, quando un nodo `live_unconfirmed` entra nei risultati serviti a un esperto, `usage_count++` + `last_used_at=now` (batch/async, non nel percorso critico della query).
3. **Citazione da confermati.** Quando si scrive/aggiorna un arco `confirmed → live_unconfirmed`, settare `has_confirmed_citation=true` sul target (in `entity_writer`/`provisional_writer`).

**Promozione.** Un job periodico (RQ, riusa il pattern del seed loader / worker) calcola per ogni `live_unconfirmed`:
`score = w1·min(usage_count,K)/K + w2·min(positive_feedback_count,M)/M + w3·has_confirmed_citation`.
Se `score ≥ soglia` → `provenance='confirmed'`, `trust→1.0` (rank pieno). Pesi/soglia da `RuntimeConfig` (admin-editable, come i modelli). La promozione è monotòna (solo salita).

**Verifica.** Sedimentare un nodo, simulare i segnali (feedback + ri-recupero + citazione), lanciare il job → il nodo diventa `confirmed` e sale nel ranking.

### Note di implementazione e confini MVP (esito review)

- **Granularità del segnale 2 (ri-recupero) — decisione load-bearing.** L'accredito `usage_count` avviene **una volta per domanda**, non per risultato servito. È nell'`Orchestrator._schedule_usage_credit` (post-sintesi, fire-and-forget, dedup sulle URN servite dalla domanda), NON nel `retriever.retrieve()`. Motivo: `retrieve()` gira molte volte per domanda (per tool-call × esperto × iterazione ReAct); accreditare per-risultato saturava `usage_cap` dentro una singola domanda e faceva promuovere un nodo a `confirmed` su una sola ri-domanda con zero feedback umano — tradendo la premessa RLCF. `bump_usage` è no-op sui nodi confermati, quindi passare l'intero insieme delle URN servite accredita solo i genuini ri-recuperi provvisori.
- **Promozione inline anziché job periodico RQ.** `promote_if_ready` è richiamato inline a ogni bump di segnale (retriever→usage, feedback→positive). Più reattivo del job periodico previsto in prima stesura; nessuna sweep persa perché ogni segnale ri-valuta. Se un segnale diventasse aggiornabile fuori-banda, servirà una sweep.
- **Confini MVP consapevoli (documentati, non bug):**
  - *Citazione (segnale 3) fissata alla creazione.* Gli archi `confirmed → live_unconfirmed` sono creati quando il nodo provvisorio nasce (linkato ai confermati co-recuperati in quella risposta). Un provvisorio citato da confermati in risposte **successive** non riceve nuovi archi. Copre il caso principale; il re-link continuo è enhancement futuro.
  - *Feedback (segnale 1) copre `retrieved_sources`, non `graph_traversal`.* Un nodo `live_unconfirmed` presente SOLO come hop del cammino (mai tra le sources) non riceve il `positive_feedback_count++`. Impatto pratico ridotto: il cammino percorre nodi confermati (su cui il bump è no-op) e un live servito è quasi sempre anche una source.
  - *I nodi promossi mantengono la label `LiveSource`.* Restano quindi esclusi come sorgente `c` in `_link_related_urns` (`NOT c:LiveSource`): scelta conservativa (solo seed/confermati genuini citano). La crescita per promozioni a catena è rimandata a Slice C insieme alla dedup provvisorio-vs-confermato per URN.

---

## Slice C — Il grafo si autocorregge *(review + UX + igiene)*

- **Review dei casi dubbi.** Nodi provvisori con segnali conflittuali (es. mai riusati ma con feedback negativo, o flag utente) diventano proposte pending nella review community esistente (`/merlt/valida`, Slice 2c) invece di essere promossi o potati in automatico.
- **UX di trasparenza.** Dopo una risposta: "questa risposta ha aggiunto N norme provvisorie al grafo" (invito implicito a confermarle); il chip "ricorda nel grafo" (già su `NodeDetailsDrawer`/`QaSourceChip`) resta la conferma esplicita puntuale.
- **Igiene / decadimento.** Un job periodico decade il `trust` dei `live_unconfirmed` non riusati oltre una finestra (env-tunable) e pota quelli sotto una soglia minima dopo un TTL — evita l'accumulo illimitato di rumore. Speculare al watchdog dei job. Mai tocca i `confirmed`/`seed`.

**Verifica.** Nodo mai riusato oltre la finestra → trust decade → potato dopo il TTL; nodo dubbio → compare in `/merlt/valida`; UI post-risposta mostra il conteggio.

---

## Sequenza ed esecuzione

**A → B → C.** Ogni slice: implementazione (multi-agente dove sensato) → **verifica live** contro lo stack Docker → commit `feat(merlt): ...` local-only (no push senza richiesta). Slice A sblocca tutto (senza materia provvisoria, B e C non hanno su cosa lavorare) ed è anche un bug-fix (0 nodi oggi).

**Testing per slice:** unit dove i deps lo consentono (pytest non è nell'immagine di produzione — verifica funzionale via query reale + query FalkorDB/Qdrant), più i test BFF/FE (vitest) per le parti che li toccano (B: feedback→segnali; C: UX + review).

**Fuori scope (esplicito):** estendere il grafo oltre il Codice Civile (ingestione di altri codici) — ortogonale; la co-evoluzione lo fa comunque crescere per le norme toccate dalle risposte, ma la copertura di base di altri codici è un lavoro separato.
