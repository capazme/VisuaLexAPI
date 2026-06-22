# VisuaLex — Audit di prontezza locale (swarm 26 feature)

> Generato da uno swarm multi-agente (26 agenti di assessment + 1 di sintesi, read-only).
> Branch `visualex-merlt-main`. Sotto, in testa, l'**overlay di verifica manuale**:
> i claim più gravi sono stati ricontrollati a mano contro il codice e lo stack live.

## Overlay di verifica (controllato a mano dopo lo swarm)

**Confermati come bug di codice REALI (mordono anche con setup perfetto):**
- ✅ **merlt-ner — `ner_router` NON montato in `merlt/app.py`** (30 `include_router`, nessuno è NER). Tutte le `/api/v1/ner/*` → 404. La feature `article_xref` appena cablata su FE+BFF è **morta end-to-end** lato MERL-T. Fix: 1 import + 1 `include_router` + rebuild immagine.
- ✅ **bookmarks — create rotto + nessuna UI**: lo store invia `norma_key/norma_data` (snake) contro schema `normaKey/normaData` (camel) → 400 a ogni create; e `addBookmark` non ha **alcun** chiamante reale (solo un commento). Nessuna rotta/sidebar.
- ✅ **merlt-qa — `confirm-source` inesistente**: in `merlt/api/` c'è solo un commento, nessuna route reale → "Ricorda nel grafo" 404.
- ✅ **merltClient — header `Authorization: Bearer`** (riga 145) invece di `X-API-Key`.

**Calibrazione (dove il verdetto statico va contestualizzato sulla TUA macchina):**
- ⚠️ Molti "blocker" sono sul **percorso di default di `start.sh`** (DB non migrato, `MERLT_ENABLED=false`, worker non avviato, segreti vuoti in `.env.example`). Sulla tua macchina attuale: il DB di piattaforma è su `:5432`, lo stack gira con `--profile api-in-docker` (worker incluso), i segreti sono nel `.env` reale, il seed è presente. Quindi questi **non ti bloccano oggi** — ma bloccano un *clone pulito* e il *deploy*. Sono problemi di **riproducibilità**, non di runtime corrente.
- ⚠️ **merltClient `Bearer`**: latente in locale. `MERLT_API_KEY` è vuoto → nessun header inviato → MERL-T usa `optional_api_key` (auth rilassata) → lo smoke dava infatti `profile 200`. Diventa un **bug attivo** appena si abilita l'auth con chiave reale. "Bomba a orologeria", non rottura attuale.

**Limite onesto dell'audit:** analisi statica + test esistenti. Non è stato fatto uno smoke E2E browser contro lo stack acceso → il comportamento esatto delle feature MERL-T "con tutti i flag giusti" non è stato verificato a runtime in questa sessione.

---

Sintetizzo i risultati nel report consolidato richiesto.

# Report di prontezza locale — VisuaLex (piattaforma vanilla + integrazione MERL-T)

## 1. Verdetto sintetico

**Conteggio per verdetto (23 feature totali):**
- ✅ **complete**: 9 (auth, workspace, quicknorms, aliases, history, forum, notifications, admin, feedback, pdf, merlt-consent) → **11 complete**
- 🟡 **partial**: 11 (search, bookmarks, dossiers, environments, annotations, highlights, folders, merlt-tracking, merlt-graph, merlt-contrib, merlt-validation, merlt-qa, merlt-ops, merlt-profile-health) → **11 partial**
- 🔴 **broken**: 1 (merlt-ner)

(Totale: 11 complete + 11 partial + 1 broken = 23.)

**Local runnable (`local_runnable: true`): 13 su 23.**
Le 10 NON eseguibili end-to-end in locale oggi: search, bookmarks, dossiers, folders, merlt-tracking, merlt-graph, merlt-contrib, merlt-qa, merlt-ops, merlt-profile-health, merlt-ner.

**Chiamata complessiva:** la piattaforma vanilla è quasi pronta in locale — il nucleo (auth, ricerca articoli, workspace, dossier, ambienti, forum, admin, PDF, history, note, evidenze) funziona o richiede solo correzioni mirate. Il vero ostacolo trasversale è **l'assenza di automazione del bootstrap del DB** (migrazioni + seed admin) in `start.sh`, che da solo blocca quasi tutto ciò che è server-backed al primo avvio. Il sottosistema **MERL-T è in larga parte non operativo out-of-the-box**: spento per default, dipende da un worker RQ che non parte nel percorso predefinito, da chiavi/segreti vuoti in `.env.example`, e contiene un router NER non registrato. Considerare la piattaforma vanilla "a portata di poche fix", MERL-T "richiede una sessione dedicata di hardening del setup".

---

## 2. 🔴 Blocker — ciò che impedisce il "tutto funzionante in locale"

### A. Bootstrap del database non automatizzato (impatto trasversale, è il blocker #1 di fatto)
Pur essendo classificato "major" nei singoli feature, l'effetto combinato è **bloccante per l'intera app autenticata**.
- **`start.sh:109-114`** non esegue `prisma migrate` / `prisma generate` / `db:seed`. Nessun docker-compose fornisce il DB di piattaforma (`docker-compose.merlt.yml` espone solo `merlt-postgres` sulla porta 5436 — DB diverso).
- **Conseguenza:** un `./start.sh` su clone pulito lascia il backend Node senza schema su `localhost:5432/visualex_platform`; inoltre `register()` crea utenti `isActive:false` (`authController.ts:57`) e il login blocca gli inattivi (`authController.ts:88-90`), quindi **zero account loginabili** e nessun admin per approvare.
- **Cosa fare:** aggiungere a `start.sh` (per il backend, prima di `npm run dev`): `npm run prisma:migrate` + `npm run db:seed` (con `ADMIN_PASSWORD` documentato). In alternativa un `predev` in `backend/package.json`. Questo sblocca da solo: bookmarks, dossiers, environments, annotations, highlights, quicknorms, aliases, history, forum, notifications, admin, feedback, merlt-consent.

### B. Bookmarks — nessuna UI + create rotto (feature: bookmarks)
- **Nessuna UI** per creare/elencare/taggare/spostare/eliminare un segnalibro. `addBookmark/removeBookmark/updateBookmarkTags/isBookmarked` hanno **zero call-site** fuori dallo store; nessuna route `/bookmarks` in `App.tsx:48-78`; i pulsanti "segnalibro" visibili (StudyMode `handleBookmark`, ArticleTabContent `handleToggleQuickNorm`) attivano in realtà **QuickNorm**.
  - **Location:** `frontend/src/App.tsx:48-78` + `frontend/src/store/useAppStore.ts:1078-1169`
- **Create rotto da mismatch snake/camel:** lo store invia `{norma_key, norma_data}` (`useAppStore.ts:1096-1099`, `types/api.ts:146-152`) ma lo schema Zod backend richiede `normaKey/normaData` (`bookmarkController.ts:7-14`), senza layer di trasformazione → **ogni POST 400** e l'optimistic add viene annullato silenziosamente.
- **Cosa fare:** decidere se la feature è in scope; se sì, (1) allineare il body a camelCase (o aggiungere transform), (2) costruire una UI minima (route + sidebar + toggle reale). Se non in scope per il rilascio locale, rimuovere i pulsanti fuorvianti e marcare la feature come differita.

### C. Folders — backend completo ma frontend morto (feature: folders)
- `folderService.ts` e `useFolders.ts` sono **importati da nulla**; nessuna route `/folders`, nessuna voce sidebar (l'icona "Folder" in `Sidebar.tsx:246` punta a `/dossier`), nessun tree/picker/move.
  - **Location:** `frontend/src/hooks/useFolders.ts` (0 consumer); `frontend/src/services/folderService.ts` (0 consumer); `frontend/src/App.tsx:48-78`
- **Organizzazione bookmark↔folder non cablata:** lo store reale (`useAppStore.ts:449,1096`) non filtra né assegna mai `folderId`; il `useBookmarks.ts` folder-aware è anch'esso dead code.
- **Cosa fare:** dato che i Folders dipendono dai Bookmarks (anch'essi senza UI), trattarli come un'unica decisione di scope. Se inclusi, costruire UI per entrambi; se no, rimuovere il dead code per evitare trappole 404 future.

### D. MERL-T spento per default + worker RQ non avviato (impatto trasversale su MERL-T)
- **`start.sh:17` + `backend/.env.example:26`**: `MERLT_ENABLED` default `false`. Un `./start.sh` non avvia il sidecar `:8000` né lo stack Docker → ogni evento tracking/profile/graph/qa va in connection-refused → 503 + dead-letter.
- **Worker RQ sotto profilo `api-in-docker`:** il percorso default `MERLT_API_IN_DOCKER=false` (`start.sh:131`) fa `docker compose up -d` **senza** `--profile api-in-docker`, quindi `merlt-worker` non parte e `start.sh` non lancia un `rq worker` locale. Code di ingest/extract/ner restano non consumate → spinner infiniti.
  - **Location:** `docker-compose.merlt.yml:226` (worker profile) + `start.sh:130-131,151-162`
- **Cosa fare:** documentare/forzare la combinazione operativa `MERLT_ENABLED=true MERLT_COMPOSE_ENABLED=true MERLT_API_IN_DOCKER=true`, oppure aggiungere a `start.sh` (per il percorso locale) il lancio di un `rq worker merlt_ingest merlt_extract merlt_ner_train`. Senza questo, lazy-ingest grafo, estrazione contrib e training NER sono morti in locale.

### E. MERL-T contrib — enqueue RQ su Redis sbagliato (feature: merlt-contrib)
- Nel percorso uvicorn locale (default), l'API enqueue via `RQ_REDIS_URL` che default a `redis://localhost:6379/1` (`document_router.py:557`), ma `merlt-redis` è su host **6381** (`docker-compose.merlt.yml:43`) e `start.sh` non esporta mai `RQ_REDIS_URL` (`start.sh:137-148`) → enqueue fallisce/orfano.
  - **Cosa fare:** esportare `RQ_REDIS_URL=redis://localhost:6381/1` in `start.sh` per il percorso locale (oltre a usare `MERLT_API_IN_DOCKER=true` che già lo risolve via compose).

### F. MERL-T NER — router non registrato (feature: merlt-ner, VERDETTO: broken)
- `ner_router` non è importato né `include_router`'d in `merlt/merlt/app.py` (blocchi a righe `38-69` e `211-240`), pur essendo esportato in `merlt/api/__init__.py:67,100`. **Ogni `/api/v1/ner/*` → 404**: rompe article_xref feedback, qa_chip feedback, card admin stats e l'intero training. Mascherato dai test BFF che nock-mockano la route inesistente.
  - **Location:** `merlt/merlt/app.py:38-69` e `:211-240`; router definito in `merlt/merlt/api/ner_router.py:38`
- **Cosa fare:** fix di **una riga di import + una riga di include_router** in `app.py` (richiede rebuild immagine `--profile api-in-docker`). Poi cablare la superficie 'implicit' mancante (vedi Major).

### G. MERL-T ops — chiave admin assente/non bootstrappata (feature: merlt-ops)
- `MERLT_API_KEY=""` in `backend/.env.example:32`; `opsClient` senza chiave non invia header → MERL-T 401 → BFF maschera in 503. **Nessun bootstrap automatico:** `POST /api/v1/api-keys/bootstrap` (`api_keys_router.py:114`) non è chiamato da `start.sh`/compose/Dockerfile.
  - **Cosa fare:** automatizzare (o documentare in `start.sh`) il bootstrap della chiave admin e l'iniezione in `backend/.env`. Senza, il trigger di training non funziona mai.

### H. MERL-T profile — header API key errato (feature: merlt-profile-health)
- `merltClient.ts:145` invia la chiave come `Authorization: Bearer` invece di `X-API-Key`. La route profile usa questo client; `/api/v1/profile/full` **richiede `X-API-Key` obbligatorio** (`auth.py:45-46`) → sempre 422 → cache mai popolata → BFF 503 → Hub mostra "authority non disponibili". (Anche con la chiave assente — vedi blocker G correlato.)
  - **Cosa fare:** allineare `merltClient.ts` (e `nerClient.ts`) a `X-API-Key` come già fanno graph/experts/ops; provisionare la chiave (blocker G). Nota: la metà **health** funziona già (no auth).

### I. MERL-T graph + internal secret coordinato (feature: merlt-graph)
- Oltre al worker non avviato (blocker D), il **segreto interno è incoerente**: `backend/.env.example:40` `MERLT_INTERNAL_SECRET=""` mentre il worker default a `dev-internal-secret` (`docker-compose.merlt.yml:282`). `internalAuth` fallisce-chiuso con 500 se vuoto → job-callback 401/500 → job in `pending` per sempre. Inoltre i file di seed (libro-iv 41MB + bridge 51MB) sono **gitignored** (`.gitignore:25`) → clone pulito ha grafo vuoto.
  - **Cosa fare:** impostare lo stesso segreto su BFF e worker; documentare la rigenerazione/recupero dei file di seed (sono major, vedi sotto).

---

## 3. 🟠 Major — pezzi significativi mancanti o difettosi

**Persistenza dati silenziosamente persa (perdita dati utente):**
- **Environments apply/import non persistono quickNorms + customAliases** — pushati nello store con `uuidv4()` senza `service.create()`; svaniscono al refresh. Viola gotcha #17; i commenti "client-only" sono obsoleti. `useAppStore.ts:2285-2315` e `2181-2209`.
- **Dossier tags mai persistiti** — input UI presente, ma `dossierService.update()` invia solo `{name, description}`, nessuna colonna DB, hydration resetta a `[]`. `useAppStore.ts:1226,504` + `schema.prisma:311-333`.
- **Dossier `restoreDossierItem` (undo-delete)** non riconcilia l'id locale con il nuovo id server → status/delete/reorder successivi falliscono in silenzio fino al reload. `useAppStore.ts:1347-1361`.

**Wiring/shape rotto in consumer adiacenti (feature: search):**
- **Vite proxy manca `/parse_query` e `/extract_citations`** → il NormaPicker NL (flusso contrib) è morto in locale. `frontend/vite.config.ts:16-28`.
- **TreeNavigatorModal (import da albero norma) legge campi stale** (`normaData.urn`, `treeData.tree`) che l'API Python non restituisce → sempre errore/albero vuoto. `TreeNavigatorModal.tsx:47,59`.

**Attribution persa su read (viola gotcha #21, sistemico):**
- **Annotations:** controller non include le relazioni `originalAuthor/sourceSuggestion`; mapper FE le scarta → AttributionChip sparisce al reload. `annotationController.ts:46-94`, `storeApiMappers.ts:111-122`.
- **Annotations normaKey suggestion-taken** non wire-encoded → note importate dal forum mai visibili nel reading view. `sharedEnvironmentController.ts:1070-1080`.

**Highlights — capacità backend irraggiungibili (feature: highlights):**
- Campo `note` per highlight completamente orfano (DB/BFF lo supportano, store/mapper/UI no). `storeApiMappers.ts:64-93` + `types/index.ts`.
- Nessun modo per ricolorare/modificare un highlight: PUT route e `useHighlights.ts` esistono ma il hook è **dead code**, store senza azione update. `frontend/src/hooks/useHighlights.ts` + `useAppStore.ts:1617-1699`.

**Forum admin moderation non cablata (feature: forum):**
- Route backend `GET /admin/shared-environments`, `withdraw`, `republish`, `adminDelete` senza alcun caller FE; gli admin possono moderare solo i report. `sharedEnvironments.ts:53-56` + `AdminPage.tsx`.

**Notifications — nessuna notifica lato suggester (feature: notifications):**
- Il badge conta solo ciò che riceve l'owner; chi propone non viene notificato di take/decline. `notificationController.ts:22-36`.

**MERL-T — gate e dipendenze (più feature):**
- **Consent default `none`** su client e server: anche con stack su, zero eventi finché l'utente non concede consenso esplicito → smoke test "non succede nulla". (tracking, qa)
- **merlt-contrib:** `MERLT_INTERNAL_SECRET=""` (callback 500) e **LLM richiede `OPENROUTER_API_KEY` reale** senza fallback mock. `backend/.env.example:32,40` + `ai_service.py:373,520`.
- **merlt-validation:** coda vuota su stack fresco (nessun seed di pending proposals); BFF non inoltra `user_id` a `get_pending` → item già votati riappaiono. `merlt/app.py:145-160`; `contribClient.ts:176-179`.
- **merlt-qa:** **confirm-source rotto end-to-end** — BFF posta a `/api/v1/enrichment/confirm-source`, endpoint inesistente in MERL-T → 404 (mascherato da nock). `expertsClient.ts:147`. Q&A gated su full consent.
- **merlt-ops:** buffer RLCF in-memory (reset a ogni restart, floor 50) → run di training reale di fatto irraggiungibile in locale; il pulsante mostra `success:false` come successo verde. `OpsTrainingButton.tsx:24-31`.
- **merlt-ner:** superficie 'implicit' (1 di 4) **non cablata** — `handleOpenCitationInTab` non chiama mai `sendNerFeedback`. `ArticleTabContent.tsx:486-513`.
- **merlt-profile-health:** nessun test di integrazione su profile/health; il test unit non asserisce l'header auth → bug Bearer invisibile. `merltClient.test.ts:163`.

---

## 4. 🟡 Minor / polish

- **Auth:** nessun `AuthContext` condiviso (9 fetch `/auth/me` ridondanti); `useAuth.changePassword/register` dead code con shape mismatch; validazione password client (≥3) più debole del backend (≥8). (`useAuth.ts`)
- **Workspace:** tab solo in localStorage (no modello DB, persi al logout); nessun guard `QuotaExceededError`; "Drag per riordinare (coming soon)" (`WorkspaceNavigator.tsx:242`); zero test sulla logica merge/drain; `WorkspaceView.tsx` dead code che viola convenzioni.
- **Aliases:** alias tipo `shortcut` irraggiungibili (UI hardcoda `reference`, matcher richiede `searchParams`); `resolveAlias` dead code; 409 su edit annullato senza feedback. (`AliasManager.tsx:106`, `citationParser.ts:240`)
- **QuickNorms / Aliases / Annotations / Highlights:** serializer BFF omette i campi attribution → AttributionChip mai renderizzato su elementi presi dal forum (sistemico).
- **History:** zero test; due implementazioni Python orfane/divergenti (dead); `HistoryView` non rifà fetch dopo il mount; dedup POST ignora `version`.
- **PDF:** cache scritta in CWD (root repo) invece di `download/`; zero test (anche sul guard SSRF); selettori CSS Normattiva fragili con toast generico.
- **Feedback:** mismatch camel/snake sulla response di create (innocuo, FE non la legge); nessun rate-limit specifico.
- **Admin:** errori Zod escono come 500 generico (no branch ZodError in `errorHandler`); doppia auth ridondante sulle route admin shared-env.
- **Forum:** funzione controller `updateSharedEnvironment` dead; `coexist` non scrive `replacedById`; `restoreVersion` senza guard 1MB; AliasConflictDialog "Rinomina" è no-op (gotcha #20).
- **MERL-T consent:** DELETE endpoint + `revokeConsent()` dead (revoca via `setConsent('none')`); FE non rivalida con Zod la response.
- **MERL-T tracking/contrib/ner:** `merltClient`/`nerClient`/`contribClient` usano `Authorization: Bearer` invece di `X-API-Key` (latente, inerte solo perché MERL-T forza `optional_api_key`); fallimenti tutti silenziosi all'utente (fire-and-forget + dead-letter senza indicatore di salute).
- **MERL-T graph:** drift documentale — CLAUDE.md descrive Cytoscape, l'implementazione è `@antv/g6`; search entità senza campo `urn` → recenter fragile; nel path uvicorn locale manca export `MERLT_SKIP_EMBEDDINGS` (seeding lentissimo).
- **MERL-T validation/qa:** shape relazione FE↔MERL-T mismatch (`tipo_relazione` vs `relation_type`) → card relazione illeggibile; vote handler con catch vuoti; confirm-source payload semantico errato (latente).
- **MERL-T ops:** `getMerltOpsOverview()` dead code verso 4 endpoint BFF inesistenti; route collassa ogni `MerltClientError` in 503 mascherando 401/400.
- **Test mancanti diffusi:** bookmarks, dossiers, folders, quicknorms, aliases, history, pdf senza test di route/integrazione.

---

## 5. Trasversali & aree possibilmente assenti/sotto-coperte

1. **Bootstrap DB non automatizzato** è la causa-radice condivisa da ~12 feature server-backed. È citato come "major/minor" in ogni singola scheda ma il suo effetto aggregato è bloccante. Va risolto **una volta** in `start.sh` e ne beneficiano tutte.

2. **Header API-key MERL-T incoerente (`Bearer` vs `X-API-Key`)** ripetuto in `merltClient`, `nerClient`, `contribClient` — già corretto in `graphClient`/`opsClient`/`expertsClient`. È inerte solo perché MERL-T disabilita globalmente l'auth via `optional_api_key` (`app.py:200`). È una **bomba a orologeria**: riabilitare l'auth real-key rompe tracking, profile, NER, contrib, validation in un colpo. I test non asseriscono l'header → invisibili in CI.

3. **Pattern "test verdi su URL inesistente" (gotcha #4 ricorrente):** merlt-ner (router non montato), merlt-qa (confirm-source 404), merlt-profile-health (header non asserito), merlt-validation (mock con shape DB-model). Più feature MERL-T hanno **CI verde su funzionalità rotte in runtime**. La copertura di integrazione MERL-T è di fatto auto-confermante; serve almeno uno smoke E2E reale contro lo stack acceso.

4. **Attribution contract (gotcha #21) sistematicamente violato sulla read-side:** i serializer di quickNorm/customAlias/annotation/highlight non restituiscono `sourceSuggestionId/originalAuthorId`, quindi l'AttributionChip — cablato ovunque — non appare mai per contenuti presi dal forum. È un singolo fix di pattern da replicare su 4 controller.

5. **Contraddizione doc↔codice:** CLAUDE.md afferma "MERL-T tracking è in-memory" (gotcha #3) ma il sidecar ora persiste su `tracking_events` (obsoleto); descrive il grafo come Cytoscape mentre è `@antv/g6`. La documentazione MERL-T è derivata in più punti.

6. **Aree sotto-coperte / potenzialmente assenti:** non emergono feature attese e totalmente mancanti, ma sono **non-funzionali per assenza di UI** due interi domini (Bookmarks, Folders) nonostante backend completi — vanno o costruiti o esplicitamente differiti. Nessuna copertura health/reachability runtime per MERL-T lato FE (`getMerltHealth` esiste ma 0 consumer): l'app appare sana mentre droppa eventi.

7. **Default privacy-first vs "smoke test che sembra rotto":** consent `none` di default su client+server è corretto by-design ma rende invisibile l'intero tracking/qa/contrib finché non si concede consenso — da evidenziare nelle checklist di smoke per non scambiarlo per un bug.

---

## 6. Piano prioritizzato per il "tutto operativo in locale"

Ordine per impatto decrescente (ogni passo riferito ai gap sopra).

**Fase 1 — Sblocco piattaforma vanilla (massimo impatto, basso sforzo)**
1. **Automatizzare il bootstrap DB in `start.sh`** (blocker A): `prisma generate` + `prisma migrate deploy` + `db:seed` (con `ADMIN_PASSWORD`) prima di `npm run dev`. Sblocca login/admin e tutte le slice server-backed (dossiers, environments, annotations, highlights, quicknorms, aliases, history, forum, notifications, feedback, merlt-consent). → rende `local_runnable` dossiers e gran parte del resto.
2. **Aggiungere al Vite proxy `/parse_query` e `/extract_citations`** (search): una riga in `vite.config.ts:16-28`. Sblocca NormaPicker NL.
3. **Fix TreeNavigatorModal** (search): leggere `normaData.norma_data[0].urn` e `treeResponse.articles` come fa SearchForm. `TreeNavigatorModal.tsx:47,59`.

**Fase 2 — Stop perdita dati (correttezza, priorità owner)**
4. **Environments apply/import**: instradare quickNorms/customAliases via `quickNormService.create`/`customAliasService.create` prima del push allo store (gotcha #17). `useAppStore.ts:2285-2315,2181-2209`.
5. **Dossier tags**: aggiungere colonna `tags` allo schema + migrazione, inviarla nell'update, idratarla in `fetchUserData` (oppure rimuovere l'input se fuori scope). `schema.prisma:311-333`, `useAppStore.ts:1226,504`.
6. **Dossier restoreDossierItem**: riconciliare `item.id = created.id` dopo `addItem` come fa `addToDossier`. `useAppStore.ts:1347-1361`.

**Fase 3 — Decisione di scope su Bookmarks + Folders**
7. **Bookmarks** (blocker B): se in scope, fix snake→camel + costruire UI minima (route/sidebar/toggle reale); se no, rimuovere i pulsanti fuorvianti. `useAppStore.ts:1096-1099`, `App.tsx:48-78`.
8. **Folders** (blocker C): dipendono da Bookmarks — stessa decisione; se inclusi, costruire UI + fix shape camel/snake e `bookmark_count`. Altrimenti rimuovere dead code.

**Fase 4 — Attribution e polish read-side (sistemico, un pattern)**
9. **Includere `originalAuthor/sourceSuggestion`** nei serializer di annotation/highlight/quickNorm/customAlias e mapparli nel FE (gotcha #21). Fix normaKey wire-encoded per note suggestion-taken (`sharedEnvironmentController.ts:1070-1080`).
10. **Highlights**: collegare campo `note` (store/mapper/UI) e azione update (riusare `useHighlights` o aggiungere `updateHighlight` allo store); abilitare delete mobile.

**Fase 5 — Hardening setup MERL-T (sessione dedicata)**
11. **Fix header `X-API-Key`** in `merltClient.ts:145`, `nerClient.ts:103`, `contribClient.ts:213` + aggiungere test che asseriscano l'header (chiude la bomba a orologeria #2 e gotcha #4).
12. **Registrare `ner_router`** in `merlt/app.py` (blocker F, 2 righe) + cablare superficie 'implicit' (`ArticleTabContent.tsx:486-513`); rebuild immagine.
13. **Allineare i segreti/chiavi**: `MERLT_INTERNAL_SECRET` identico su BFF e worker; automatizzare/documentare bootstrap `MERLT_API_KEY` admin (blocker G, I).
14. **Avviare il worker RQ nel percorso locale** (blocker D): documentare `MERLT_API_IN_DOCKER=true` come default operativo per MERL-T, oppure lanciare `rq worker` da `start.sh`; esportare `RQ_REDIS_URL=...:6381/1` (blocker E).
15. **Fix `confirm-source`** Q&A: puntare all'endpoint reale esistente (es. `/propose-entity`) o implementarlo lato MERL-T (`expertsClient.ts:147`).
16. **Seed pending proposals** per la validazione (caricare `pending-samples.sql` al boot) + inoltrare `user_id` a `get_pending`; fix shape relazione FE.
17. **OpsTrainingButton**: rispettare `res.success` (no falso verde); rimuovere `getMerltOpsOverview` dead; mappare 401/400 distinti da 503.
18. **Documentare la sequenza operativa MERL-T** (flag + consenso full + chiave) nella smoke checklist, ed eventualmente un indicatore di salute FE (`getMerltHealth`) per non far sembrare l'app sana mentre droppa eventi.

**Fase 6 — Copertura e pulizia (debito)**
19. Aggiungere test di route per bookmarks/dossiers/folders/quicknorms/aliases/history/pdf.
20. Allineare la documentazione (CLAUDE.md: tracking persistente, grafo `@antv/g6`); rimuovere dead code (`WorkspaceView`, `useBookmarks`/`useFolders` se non usati, `updateSharedEnvironment`, history Python orfane, `getMerltProfile` legacy).

**Note finali oneste sull'incertezza:** la maggior parte delle schede ha confidence "high" basata su lettura statica e, per il forum/notifications, test reali passati. I punti più incerti restano quelli MERL-T che dipendono dallo stato del container live del proprietario (chiavi/segreti presenti nel suo `.env` ma non riproducibili da `.env.example`): il giudizio "non runnable di default" è solido, ma il comportamento esatto con lo stack acceso e tutti i flag corretti non è stato verificato E2E in questa audit (manca lo smoke browser contro lo stack Docker).
