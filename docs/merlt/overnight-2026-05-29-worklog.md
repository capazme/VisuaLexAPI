# Overnight worklog — 2026-05-29 (notte → mattina)

**Obiettivo (dato dall'utente prima di dormire):** rendere la piattaforma pienamente
funzionante con tutte le feature documentate (VisuaLexAPI + ALIS_CORE), con focus su
MERL-T / RLCF, framework SOTA, test E2E robusti che simulino l'interazione umana.
Branch: `visualex-merlt-main`. Regola ferma: **commit locali, NIENTE push / PR**.

Questo file è il diario di bordo: lo aggiorno man mano, così al risveglio hai il quadro.

---

## Fase 0 — Baseline & verità (stato all'avvio)

### Stack MERL-T (Docker) — SANO
- 6 servizi UP e healthy da ~17-20h (`merlt-api`, `merlt-worker`, `merlt-postgres`,
  `merlt-redis`, `merlt-falkordb`, `merlt-qdrant`).
- DB reale = **`merlt`** (la nota `rlcf_dev` in CLAUDE.md è STALE → da correggere).
- Grafo reale = **`merl_t_legal`**: **27.759 nodi / 43.954 relazioni** — seed Libro IV intatto. ✅
- **Trigger di consenso INSTALLATI** nel DB live (`trigger_entity_vote_consensus`,
  `trigger_relation_vote_consensus`, `trigger_amendment_vote_consensus`). Il fix
  root-cause della chiusura Loop α è attivo. ✅
- Tabelle RLCF tutte presenti: `extraction_candidates`, `pending_entities/relations`,
  `tracking_events`, `qa_traces`, `entity_votes`, `relation_votes`, ecc.

### Test baseline
- **Frontend (vitest+jsdom): 197 passed / 34 file — VERDE** ✅
- **Backend (vitest+supertest, DB `visualex_test` su :5432): in corso.**
- **merlt (pytest): girano nel container** (`docker exec -w /app visualex-merlt-api
  python -m pytest`). pytest non preinstallato + `tests/` non nell'immagine → vanno
  iniettati. In preparazione.

### Lavoro NON committato (da capire + committare pulito)
37 file modificati + nuovi: ops routes/opsClient/jobWatchdog (BFF), relation extractor +
consensus_triggers (merlt), MyContributionsCard/NormaPicker/EdgeDetailsDrawer + ops UI (FE),
vari test. Corrisponde alla chiusura Loop α (A1–A5) + B1 + ops/watchdog descritta in
memoria come "fatta+testata, non committata".

---

## Piano della notte (priorità)

1. **Baseline verde** — far girare le 3 suite, fixare TUTTO ciò che è rosso (anche
   preesistente: regola utente). [in corso]
2. **Verifica Loop α E2E reale** — contribuisci → voto → consenso (trigger) → nodo nel
   grafo, via HTTP reale sullo stack live + check DB/FalkorDB.
3. **Allineamento immagine↔codice** — capire se le immagini Docker (17h) sono stale
   rispetto al Python non committato; se sì, rebuild + recreate api+worker.
4. **Commit puliti** (locali) in commit logici Conventional + aggiornare docs/memoria.
5. **E2E browser** (chrome-devtools MCP) che simula l'avvocato: consenso → grafo →
   contribuzione → validazione.
6. **Frontiera** (stretch): fix pipeline Loop β (GraphSearchTool `.execute_query`→`.query`,
   retrieval per-esperto, grounding) e/o UX co-autorialità (provenienza in NodeDetailsDrawer).

## Decisioni prese in autonomia (l'utente dormiva)
- Commit locali sì (per non perdere lavoro), push/PR NO (regola del branch).
- Priorità a "funziona e verificato" sulle slice già costruite, prima della frontiera Q&A
  (che la doc dichiara bloccata su bug di pipeline).

---

## Stato test (baseline raggiunta) — TUTTO VERDE
- Frontend: **197** test + `npm run build` ✅ + `npm run lint` ✅
- Backend (BFF): **226** test + `tsc` build ✅
- merlt (pytest, nel container): **30** test ✅
- Totale: **453 test verdi**, build+lint puliti.

## Lavoro committato stanotte (locale, branch `visualex-merlt-main`, NO push)
17 commit Conventional sopra `3ccb4d5`:
- `chore`: gitignore (node_modules/backend logs/scratch)
- 5× `fix/feat(merlt)`: A1 tracking-persistence, A2 consensus-triggers, A3/A4 authority+promotion,
  B1 relation-extractor, worker-resilience+RQ-safe-id+canonical-urn
- 3× `fix/feat(merlt-bff)`: urn-norm, contrib/graph shapes, A5 ops+watchdog
- 5× `fix/feat(merlt-fe)`: validate-shapes, dead-code-removal, multipart, parse_query(api), FE-features
- `chore(dev)`: ngrok/host-API wiring
- **`fix(merlt)`: graph reads match the seed (vedi sotto) ← bug reale trovato+fixato stanotte**

## 🐞 BUG REALE trovato e risolto: grafo seedato invisibile
`normalizeGraphUrn` (BFF) + `_canonical_urn` (worker) strippavano il wrapper URL
`https://...N2Ls?` riducendo l'URN a forma bare `urn:nir:...`. Ma il seed (27.7k nodi),
VisuaLex `/parse_query` e `meta.to_urn()` usano TUTTI la forma URL completa, e MERL-T
matcha per uguaglianza esatta. Risultato: OGNI articolo del Libro IV ritornava
`exists:false`/subgraph vuoto → side-rail e `/grafo` in spin infinito su lazy-ingest.
`parse_urn` del worker legge l'articolo dalla forma URL completa senza problemi (verificato),
quindi il wrapper non andava mai strippato. **Fix: strippare solo il marker `!vig=`.**
Verificato LIVE: `GET /api/merlt/graph/article/<art2043>` → **26 nodi / 25 archi** reali
(Art. 2043, Cassazione 6023/2001, "domanda giudiziale", "datore di lavoro"...).

## Diario (append-only)
- **00:00** — Ricognizione completata. Stack sano, seed+trigger live, FE verde. Avvio
  baseline backend + setup test Python + inventario lavoro non committato.
- **+1h** — Baseline 453 verdi (fixati 2 test stale `ingest:`→`ingest-`). Tutto committato
  in 15 commit logici. Red flag sistemati (ngrok in .env.example, gitignore, commenti).
- **+2h** — E2E live BFF→MERL-T (i test mockano MERL-T con nock → integrazione live mai
  provata). Trovato+fixato il bug URN del grafo (sopra). 16° commit. Avvio rebuild immagine
  merlt per durabilità; recreate a fine sessione.
- **+3h** — Script `scripts/merlt-live-smoke.sh` (live BFF→MERL-T, **9/9 verde**) committato
  (17° commit). Immagine merlt ricostruita + **api/worker ricreati dal codice committato**
  (durabilità): seed 27.759 nodi + 3 trigger intatti dopo recreate. Smoke 9/9 anche post-recreate.
- **+3h30** — **E2E browser** (chrome-devtools, simula l'avvocato): login OK → `/grafo`
  renderizza la ego-network reale dell'art. 2043 (force layout, filtri popolati da dati reali) →
  hub `/merlt` con **Authority 0.44 reale**, consenso "Completo", tutte le card; card Ops admin
  correttamente nascosta (utente non-admin). Unico warning console: artefatto StrictMode di G6
  in dev (non-bloccante, non in produzione). Screenshot in `backend/logs/` (gitignored), inviati.
  CLAUDE.md aggiornato con anti-regressione URN (gotcha #6). Memoria aggiornata.

## Verifica LIVE dell'intero percorso utente Loop α (RLCF) — tutto E2E
Eseguito contro lo stack reale via BFF (utente con consenso `full`):
1. Consenso none→full (persistito) ✅
2. Lettura grafo art. 2043 seedato (26 nodi) ✅
3. Upload nota .txt ✅
4. Estrazione LLM async → **16 candidati** (7 entità + 9 relazioni, B1 attivo) ✅
5. Promozione candidato col **copyright gate** (fonte+riformulazione+attestazione) → `pending_entity` ✅
6. Coda di validazione mostra le proposte (`/validate/pending`) ✅
7. **Voto `approve`** → net_score 0→0.5 via trigger PG, consenso non ancora raggiunto (0.5<2.0) ✅
   (Il tratto consenso→scrittura grafo era già provato: nodo `id=20` "Risoluzione del contratto…"
   approved/net_score=2/consensus_reached=t dalla chiusura loop precedente.)

## 🐞 TRE bug reali trovati esercitando il sistema live (tutti fixati+testati+committati)
1. **Grafo seedato invisibile** — `normalizeGraphUrn`/`_canonical_urn` strippavano il wrapper URL →
   ogni articolo Libro IV `exists:false` → `/grafo` vuoto + lazy-ingest infinito. Fix: strip solo `!vig=`.
2. **Job estrazione bloccato su `pending`** — il callback di completamento worker→BFF dava 400 perché
   lo schema usava `.optional()` invece di `.nullish()` (il worker manda `error:null`). UI "in corso"
   all'infinito. Fix: `.nullish()`.
3. **Promote ritornava `{}` + bug latente dedup** — il BFF leggeva `pending_id` inesistente (lo shape
   reale è `pending_entity.id` per entità / `relation_id` per relazioni); inoltre marcava il candidato
   "promosso" anche quando MERL-T differiva per duplicato (contributo perso). Fix + test col mock reale.

## STATO FINALE (per il risveglio)
✅ Piattaforma **funzionante e verificata end-to-end**: stack sano, **227 test BE + 197 FE + 30 merlt
verdi** (454 totali), build+lint puliti, integrazione live BFF→MERL-T provata (smoke 9/9 + intero
Loop α + E2E browser), immagine merlt ricostruita/durevole.
✅ Tutto il lavoro **committato in locale** (~20 commit Conventional su `visualex-merlt-main`),
**nessun push / PR** (regola del branch).
🧹 Cruft dev (eliminabile): utente `e2e-overnight@test.local`, doc/candidati di prova in MERL-T
(2 `pending_entity` reali ora in coda di validazione: "Interesse negativo", "Responsabilità
precontrattuale" — innocui, anzi utili come demo), screenshot in `backend/logs/` (gitignored).
➡️ Frontiera NON iniziata di proposito (richiede tue scelte UX / è bloccata): provenienza
co-autorialità nel `NodeDetailsDrawer` (brainstorm→spec→plan prima) + fix pipeline Loop β
(`GraphSearchTool .execute_query`→`.query`, retrieval per-esperto, grounding) prima del Q&A (Slice 3).
Vedi `system-map.md` §5/§8. Lascio a te la decisione su quale frontiera aprire.
