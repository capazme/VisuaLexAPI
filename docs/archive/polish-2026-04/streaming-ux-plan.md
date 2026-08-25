# Streaming UX polish — Plan

> Pianificato 2026-04-23 con contesto a fine. Richiesta utente dopo la chiusura di Flow A (commits `d60a305` → `09ad294`).

## Obiettivi richiesti

Tre miglioramenti strettamente connessi al behaviour del tab workspace quando arrivano risultati:

### R1 — Streaming di range: NON auto-selezionare il nuovo articolo

**Scenario**: l'utente cerca "artt. 1-10 cc" (range). Arrivano i risultati uno alla volta in streaming. L'utente comincia a leggere l'art. 1 non appena appare. Oggi, quando arriva l'art. 2, 3, … il tab "salta" a mostrare il nuovo articolo appena ricevuto, distraendo la lettura.

**Comportamento desiderato**: il primo articolo arrivato diventa attivo (UX primo contatto ok), poi gli articoli successivi si aggiungono ai tab ma **l'activeTabId resta fisso** su quello dove l'utente sta leggendo. Lui li potrà aprire manualmente cliccando.

### R2 — Ricerca singolo articolo: SÌ auto-selezionare

**Scenario**: l'utente cerca "art. 2043 cc" (singolo). Oggi funziona correttamente (c'è un solo articolo, viene aperto). Non regredire.

**Comportamento desiderato**: invariato — articolo singolo = auto-attivato. La differenza fra R1 e R2 è "quanti articoli stanno arrivando per questa norma?", non una flag client-side separata.

### R3 — Stessa norma → stessa tab (a meno di tab custom)

**Scenario**: l'utente ha già aperto un tab "Codice Civile 262" con dentro l'art. 2043. Fa una seconda ricerca per l'art. 2059 (stessa norma). Oggi succede X (da investigare: aggiunge al tab esistente? crea un secondo tab?).

**Comportamento desiderato**: se esiste un tab con norma matching (tipo_atto + numero_atto + data + allegato) **e quel tab non ha label custom**, l'articolo nuovo viene aggiunto al tab esistente e il focus va su quell'articolo (coerente con R2 perché è ricerca singola). Se il tab ha label custom (es. rinominata dall'utente o arrivata da dossier), creare comunque un nuovo tab: il custom label indica che l'utente ha "reservato" quel tab.

---

## Contesto tecnico da investigare (prima riga di attacco dopo compact)

Sono state fatte letture parziali durante il lavoro sui commit di Flow A. Punti che servono verificati:

1. **`SearchPanel.tsx:66-149` — `processResult`**
   - Ramo `isStreaming`: `streamingTabRef.current` tiene traccia del tab in cui stiamo accumulando articoli per la stessa norma durante lo stream. Per ogni nuovo articolo della stessa norma chiama `addNormaToTab`.
   - Ramo batch: usa `resultsBuffer` che poi viene flushato in un `useEffect` (linee ~270-300). Oggi c'è un check `existingTab = workspaceTabs.find(...)` che aggiunge a un tab esistente per match su `(tipo_atto, numero_atto, data, !historical)`.

2. **`SearchPanel.tsx:42-44` — `customTabLabel`**
   - Già esiste uno state `customTabLabel`. Serve capire chi lo setta (cercare `setCustomTabLabel`).
   - Probabilmente viene valorizzato quando l'utente crea una tab da dossier o rinomina (da verificare).
   - Questo è il segnale per R3: se un tab è stato creato con `customTabLabel != null`, è "reservato" — non merge automatico.

3. **`NormaCard.tsx:41-44` — `activeTabId`**
   - State iniziale: `articles[0] ? getUniqueId(articles[0]) : null`.
   - C'è un useEffect (da trovare) che reagisce al cambio di `articles`. Oggi probabilmente setta `activeTabId` al primo articolo — ma bisogna verificare se punta al primo o all'ultimo aggiunto quando arrivano nuovi tramite streaming.
   - Il "salto" che distrae l'utente avviene qui: serve renderlo condizionale.

4. **`useAppStore.ts` — `addNormaToTab`** e **`addWorkspaceTab`**
   - Come gestiscono gli articoli: append? dedup? preservano l'ordine?
   - Il label del tab: quando viene settato? c'è un campo `labelIsCustom` / `customLabel`? Se no, serve aggiungerlo.

5. **`searchTrigger` + handleSearch**
   - Quando una ricerca arriva da `triggerSearch(params)` (es. clic su un brocardi cross-reference), il flow passa attraverso `handleSearch` e genera un nuovo `streamingTabRef`. Per R3 serve che prima di creare un tab nuovo si cerchi un matching non-custom.

---

## Decisioni aperte

### D-1 — Segnale "tab custom"

Come marchiamo un tab come "custom" (non-mergeable)?

- **(a)** Aggiungere `labelIsCustom: boolean` sul `WorkspaceTab` type. Settato a `true` quando: (i) `customTabLabel` è passato in `addWorkspaceTab`, (ii) l'utente rinomina via double-click (oggi esiste questo pattern?).
- **(b)** Inferirlo: se il `label` del tab differisce dal label "canonico" generato da `(tipo_atto, numero_atto, date)`, è custom. Fragile: se la regola di generazione cambia, un tab storico "bruciato" viene considerato custom a sproposito.
- **(c)** Lista esplicita `customTabIds: Set<string>` nello store, aggiornata al rename.

**Raccomandazione senior**: **(a)** — esplicito, persistente, semplice.

### D-2 — "Prima occorrenza vince" in streaming

Nel ramo streaming di R1, quando arriva il **primo** articolo della ricerca, serve auto-attivarlo. Dopo, no. Tre opzioni:

- **(a)** `SearchPanel` passa a `NormaCard` una prop `autoSelectFirstIncoming: boolean` = true al primo append, false dopo. Complica il wiring.
- **(b)** `NormaCard` mantiene internamente un ref `hasAutoSelectedRef` che si setta al primo `activeTabId` dopo mount. Successivi push di articoli lasciano activeTabId invariato (a meno che non sia null, p.es. dopo close article).
- **(c)** Policy: `activeTabId` si aggiorna solo al mount e quando diventa `null` (articoli chiusi); nuovi articoli che arrivano con `articles.length > 0` non toccano mai l'active. Equivale a (b) senza ref — basta che l'useEffect dipenda da `articles.length === 0` o da tabId mount, non da `articles` generico.

**Raccomandazione**: **(c)** — rimuovere il auto-update di `activeTabId` su cambio di `articles`, lasciarlo solo come init state + fallback se diventa null.

### D-3 — Comportamento R3 su ricerca singola vs stessa norma-già-aperta

Se l'utente cerca "art. 2059 cc" e c'è già un tab con art. 2043 cc:

- Il backend ritorna 1 articolo → aggiunto al tab esistente
- `activeTabId` del tab esistente: cambia a 2059 (R2 singolo = auto-select) **o** resta su 2043 (non distrarre)?

Risoluzione: se la ricerca è "singola" (1 articolo atteso, R2), **l'articolo cercato diventa attivo** anche nella tab esistente — è la ragione per cui l'utente ha fatto la ricerca, focusarla non è distrazione ma scopo. È il case R1 dove NON serve.

Segnale: quando `handleSearch` completa, se `expectedTotal === 1` e la ricerca è mergeata in tab esistente, trigger `setActiveArticleInTab(tabId, articleId)`. Serve nuova action store.

### D-4 — Historical vs vigente

`processResult` già tratta gli historical come "sempre nuovo tab" (riga ~263 di SearchPanel, check `isHistorical`). Mantenere: R3 non merge se la ricerca nuova è historical e la tab esistente è vigente (o viceversa). Già ok.

---

## File toccati (pre-stima)

| File | Cambio previsto |
|------|-----------------|
| `frontend/src/types/index.ts` o `WorkspaceTab` type | +`labelIsCustom?: boolean` |
| `frontend/src/store/useAppStore.ts` | `addWorkspaceTab` setta `labelIsCustom = !!customLabel`; nuova action `setActiveArticleInTab(tabId, articleId)`; opzionale `renameTab` aggiorna `labelIsCustom=true` |
| `frontend/src/components/features/search/SearchPanel.tsx` | `processResult` ramo streaming: unificare con `find(tab, !isCustom, !isHistorical)` invece di solo `streamingTabRef`; passare `autoFocus` solo se expectedTotal === 1 |
| `frontend/src/components/features/search/NormaCard.tsx` | `activeTabId` init-only / fallback-on-null (D-2c); rispondere ad event `autoFocusArticleId` per R2+R3 |
| (se serve) un `useEffect` in NormaCard per reagire a `autoFocusArticleId` prop propagata dal parent |

Righe di test da scrivere/adattare: nessun test attualmente. Smoke manuale.

---

## Implementation sketch (dopo compact)

**Step 1** — Scoperta prioritaria (30 min):
- Leggere interamente `useAppStore.ts` sezione workspace (`workspaceTabs`, `addWorkspaceTab`, `addNormaToTab`, eventuale `renameTab`).
- Leggere `SearchPanel.tsx:60-310` (processResult + effect su resultsBuffer) per confermare i punti di decisione.
- Leggere `NormaCard.tsx` (intero, è già dentro il commit recente post-Step-4) per capire quando `activeTabId` si aggiorna.
- Verificare se esiste rename di tab e dove.

**Step 2** — `labelIsCustom` (D-1a), 1 commit:
- Aggiungere campo al type + inizializzazione in `addWorkspaceTab`.
- Se esiste `renameTab`, settare `labelIsCustom = true` lì.
- Solo infrastruttura, nessun cambio UX.

**Step 3** — R1 (no auto-jump), 1 commit:
- `NormaCard`: `activeTabId` resta invariato su cambi di `articles` a meno che non sia `null`. Mantenere il fallback init per articoli vuoti che diventano popolati (tab appena creata = attiva sul primo).

**Step 4** — R3 (merge nella stessa tab), 1 commit:
- `SearchPanel.processResult` ramo streaming: al primo articolo della stream, cercare un tab esistente matching su `(tipo_atto, numero_atto, data, allegato, !historical, !labelIsCustom)`. Se trovato, usarlo come target dello stream invece di creare nuovo. `streamingTabRef` punta al tab esistente.
- Stesso pattern per batch flush (`resultsBuffer` useEffect) — già quasi lo fa, solo da aggiungere il filtro `!labelIsCustom`.

**Step 5** — R2 auto-focus su singolo (D-3), 1 commit:
- Nuova action `setActiveArticleInTab(tabId, articleId)` nello store.
- `SearchPanel.handleSearch`: quando lo stream finisce, se `expectedTotal === 1` e `streamingTabRef.current` valido, chiamare `setActiveArticleInTab`.
- `NormaCard`: ascolta un campo `autoFocusArticleId?: string` nel tab (o prop-drilled) e se matcha uno degli articoli, setta `activeTabId` una sola volta (consuma il signal per non ri-attivarsi).

**Step 6** — Smoke test:
- Cerca "artt. 1-10 cc" → primo articolo attivo, gli altri appaiono senza rubare il focus
- Clicca art. 5 mentre arrivano il 6,7,8 → resti sul 5
- Poi cerca "art. 2043 cc" (stessa norma, singolo) → stesso tab, focus passa a 2043
- Rinomina tab (se possibile) → cerca altro articolo stessa norma → nuovo tab (custom rispettato)
- Cerca articolo con versione storica → nuovo tab sempre (no merge)

---

## Fuori scope esplicito

- Tab reordering / drag & drop behaviour
- Mobile carousel focus (scope diverso)
- Search history / suggestions
- Compare mode interaction

---

## Prima azione dopo compact

1. Leggere questo file.
2. Fare lo Step 1 (scoperta prioritaria) con tool grep/Read sui 3-4 file citati.
3. Confermare o aggiustare le assunzioni di D-1/D-2/D-3 con l'utente prima di codare.
4. Procedere Step 2 → Step 5 in commit separati.

---

_Generato 2026-04-23. Nessun codice modificato._
