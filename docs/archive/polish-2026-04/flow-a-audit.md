# Flow A — Audit Cerca e Leggi una Norma

> Ricognizione pre-intervento. Nessun codice toccato. Da qui decidiamo insieme le strategie di decomposizione e le priorità dei fix, poi procediamo in step isolati come per Spike 1.

---

## 1. Flow end-to-end — stato attuale

Il flow si compone di due entry point (uno visibile, uno nascosto), un orchestratore di streaming, una card di rendering, e un "mega-componente" per il testo dell'articolo. Le chiamate backend sono 5 endpoint distinti, che producono 7 shape di risposta diverse (debito noto, da Spike 2).

```
[SearchForm]       ────┐
(sticky top, visible)  │  SearchParams   ┌──────────────────────────────┐
                       ├────────────────►│  SearchPanel                 │
[CommandPalette]   ────┘                 │  - orchestrazione streaming  │
(⌘K, hidden)                             │  - gestione tab workspace    │
                                         │  - progress indicator        │
                                         └──────────────┬───────────────┘
                                                        │ articles in streaming
                                                        ▼
                                         ┌──────────────────────────────┐
                                         │  NormaCard                   │
                                         │  - header norma              │
                                         │  - tab articoli (desktop)    │
                                         │  - lista espansibile (mobile)│
                                         └──────────────┬───────────────┘
                                                        │ singolo articolo
                                                        ▼
                                         ┌──────────────────────────────┐
                                         │  ArticleTabContent (895 LOC) │
                                         │  - toolbar 15+ bottoni       │
                                         │  - rendering testo + brocardi│
                                         │  - highlight picker          │
                                         │  - 4 modali inline           │
                                         │  - citation preview          │
                                         │  - footnote tooltips         │
                                         └──────────────────────────────┘
```

**File e dimensioni:**

| File | LOC | Hook calls | Responsabilità principali |
|------|-----|-----------|---------------------------|
| `SearchForm.tsx` | 617 | 9 | Form strutturato, 2 fetch inline, alias resolver |
| `CommandPalette.tsx` | 599 | 18 | Multi-step cmdk, NL parser integration, alias trigger |
| `SearchPanel.tsx` | 794 | 15 | Streaming orchestration, tab lifecycle, workspace glue |
| `NormaCard.tsx` | 652 | 11 | Header desktop/mobile, tab articoli, study mode |
| `ArticleTabContent.tsx` | 895 | 18 | Toolbar, testo, brocardi, highlights, modali, preview |
| **Totale core** | **3.557** | **71** | |

Backend endpoints attraversati: `/api/parse_query`, `/api/fetch_norma_data`, `/api/fetch_tree`, `/stream_article_text`, `/api/fetch_all_data`, `/api/extract_citations`, `/api/fetch_brocardi_info`.

---

## 2. Gap rilevati — classificati

Ogni gap ha citazione esatta `file:linea` per verifica rapida. Severità: **C**ritico (utente perde dati / flow visibilmente rotto), **M**edium (UX degrada ma non rompe), **L**ow (debt che rallenta lavoro futuro).

### 2.1 Bug critici di sistema (C)

| # | File:linea | Bug | Impatto |
|---|-----------|-----|---------|
| **C-1** | `CommandPalette.tsx:198` | `z-[130]` invece di `Z_INDEX.commandPalette` (`z-[1250]`). `130` è nella **base band** (limite 100), non nella **overlay band** (1000+). | Modali, drawer, study mode e toast si stratificano SOPRA la palette. Il ⌘K può risultare parzialmente coperto. |
| **C-2** | `SearchPanel.tsx:151-248` | Nessun `AbortController` sul `fetch('/stream_article_text')`. Se l'utente avvia una seconda ricerca prima che la prima concluda, il `setResultsBuffer({})` alla linea 155 cancella il buffer della prima, ma il reader della prima continua a chiamare `processResult` scrivendo nel workspace. | Race condition: articoli della ricerca A appaiono nel tab della ricerca B. Memory leak se SearchPanel unmount durante stream. |
| **C-3** | `BrocardiDisplay.tsx:13-30` | `BrocardiSectionErrorBoundary` con commento esplicito `// Silently fail - don't show broken section`. Al crash rende `null`, `componentDidCatch` scrive solo in console. | L'utente vede la sezione brocardi sparire senza sapere se: (a) non esistono brocardi per questa norma, (b) API ha fallito, (c) dati corrotti. |
| **C-4** | `SearchForm.tsx:141, 160` | Due `fetch` inline diretti a `/fetch_norma_data` e `/fetch_tree`, bypassano `services/api.ts`. Errori vanno solo in `console.error` (linea 177-178). | Fetch scoperto da interceptor errori, debug difficile, niente toast di errore utente. |

### 2.2 Streaming & rendering gaps (M)

| # | File:linea | Gap | Impatto |
|---|-----------|-----|---------|
| **M-1** | `SearchPanel.tsx:43, 155, 251-301` | `resultsBuffer` state è gestito in effect post-stream ma non viene ripulito in `useEffect` cleanup. | Se l'utente unmount SearchPanel (raro ma possibile via routing) durante il flush del buffer, alcuni articoli restano in memoria non renderizzati. |
| **M-2** | `SearchPanel.tsx:198-226` | Catch sul `JSON.parse` di ogni linea NDJSON scrive solo in console (linea 211). Se lo stream si corrompe a metà, nessun toast/banner. | Partial render silenzioso. |
| **M-3** | `SearchPanel.tsx:681-718` | Progress bar esiste (contatore `loadingProgress.loaded/total`) ma è un toast top-center generico. Non c'è indicatore *dentro* la `NormaCard` in riempimento. | Su norme grandi (range "1-50") l'utente vede il toast scomparire ma non sa quali articoli mancano ancora nel tab. |
| **M-4** | `SearchPanel.tsx:651-679` | Skeleton sempre 2 card fisse, indipendente dal conteggio articoli atteso (già calcolato in `calculateExpectedArticles`). | Skeleton non informativo. |
| **M-5** | `SearchPanel.tsx` / `NormaCard.tsx` | Nessun `aria-live` su progress, errori, risultati in arrivo. | Screen reader user non ricevono annunci durante streaming. |

### 2.3 ArticleTabContent bloat (M)

Componente da 895 LOC con **13 responsabilità distinte** identificate:

1. Badge versione/allegato (400-432)
2. Quick actions mobile (433-478)
3. Toolbar desktop 15+ bottoni (479-655)
4. Notes panel sticky (657-696)
5. Rendering testo articolo (699-717)
6. Summary highlights desktop (718-736)
7. BrocardiDisplay wrapper (738-766)
8. SelectionPopup inline (701-706)
9. CitationPreviewPopup overlay (875-890)
10. 4 modali: Dossier, Copy, AdvancedExport, VersionInput (791-872)
11. Toast locale (782-789)
12. Pipeline di trasformazione HTML (highlights → dictionary → citations, useMemo 296-322)
13. 10+ event handler inline (202-292)

| # | File:linea | Gap | Impatto |
|---|-----------|-----|---------|
| **M-6** | `ArticleTabContent.tsx:1-895` | Responsabilità intrecciate, 18 hook call in un solo file, modifiche puntuali richiedono navigazione in una spaghetti di state e handler. | Modifiche future (es. nuova azione toolbar, nuovo tipo annotation) toccano lo stesso file → conflitti di merge, test difficili. |
| **M-7** | `ArticleTabContent.tsx:49` | `const [highlightColor] = useState<...>('yellow')` — **senza setter**, lo useState è destrutturato a valore solo. Il valore non cambia mai. | Dead state. |
| **M-8** | `ArticleTabContent.tsx:854` | `console.log('🔎 Triggering version search...')` debug in produzione. | Log spam in console utente. |

### 2.4 Z-index residui dopo Spike 1 (M)

Lo Spike 1 ha introdotto `constants/zIndex.ts` a 2 band e migrato i dialog principali. In Flow A ci sono residui hardcoded:

| # | File:linea | Attuale | Dovrebbe essere |
|---|-----------|---------|-----------------|
| **M-9a** | `CommandPalette.tsx:198` | `z-[130]` | `Z_INDEX.commandPalette` (= `z-[1250]`) — vedi C-1 |
| **M-9b** | `ArticleTabContent.tsx:403` | `z-10` (sticky toolbar) | `Z_INDEX.sticky` (= `z-20`) |
| **M-9c** | `ArticleTabContent.tsx:532` | `z-50` (highlight picker) | `Z_INDEX.dropdown` (= `z-30`) |
| **M-9d** | `ArticleTabContent.tsx:580-581` | `z-40`/`z-50` (more menu backdrop + popup) | `Z_INDEX.dropdown` (= `z-30`) |
| **M-9e** | `ArticleTabContent.tsx:815` | `z-50` (VersionInput modal custom) | `Z_INDEX.modal` (= `z-[1100]`) — **overlay band** |
| **M-9f** | `SelectionPopup.tsx:176` | `z-50` | `Z_INDEX.floating` (= `z-40`) |
| **M-9g** | `FootnoteTooltip.tsx:154` | `z-50` (portale a `document.body`) | `Z_INDEX.tooltip` (= `z-[1400]`) |

`CitationPreviewPopup.tsx:106` già usa `Z_INDEX.citationPreview` ✓.

### 2.5 Inconsistenze design system (M)

| # | File:linea | Gap |
|---|-----------|-----|
| **M-10** | `SelectionPopup.tsx:20-25` | Color picker hardcoded Tailwind (`bg-yellow-200`, `border-yellow-400`, ...). `ArticleTabContent.tsx:307,728` rende i mark con `HIGHLIGHT_STYLES` da `utils/highlightColors.ts` (CSS custom props). **Picker e rendering mostrano tinte diverse**: l'utente sceglie giallo-chiaro nel popup ma vede giallo-HSL nel testo. |
| **M-11** | `ArticleTabContent.tsx:814-873` | VersionInput modal re-implementato inline con `fixed inset-0 z-50` invece di consumare `Modal` base (esteso in Spike 1). Manca Escape handler, body scroll lock, focus management. |

### 2.6 Dead code (L)

| # | File:linea | Dead |
|---|-----------|------|
| **L-1** | `NormaCard.tsx:20` | `onPinArticle: (articleId: string) => void; // Placeholder for future use` — dichiarato, mai invocato. Passato da `SearchPanel.tsx:520` come `() => { }`. |
| **L-2** | `NormaCard.tsx:22, 37` | `onCompareArticle` già aliasato come `_onCompareArticle` (convention TS di scarto) — hint: l'autore *sapeva* che non si usa. Ma Flow D (Compare) è nella roadmap, quindi la rimozione va valutata. |
| **L-3** | `ArticleTabContent.tsx:49` | `highlightColor` state mai settato (vedi M-7). |

### 2.7 UX gaps minori (L)

| # | Gap |
|---|-----|
| **L-4** | Entry point discovery: CommandPalette (⌘K) non ha affordance visiva. Utenti al primo uso non la trovano. |
| **L-5** | `NormaCard.tsx:197-201` mobile header senza `truncate`, overflow su numeri atto lunghi. |
| **L-6** | Nessuna virtualizzazione in `NormaCard` (`articles.map` linea 505-575). Degradazione su 100+ articoli. |
| **L-7** | Nessun scroll restoration fra switch tab. |
| **L-8** | `NormaCard.tsx:100-164` handler `handleQuickAddArticle`, `handleArticleSelect` non memoizzati (passati a children). |
| **L-9** | Copy granulare mancante: non si può copiare una singola massima/footnote senza selezione manuale. |

---

## 3. Decisioni aperte — da sciogliere prima di procedere

Lo Spike 1 ci ha insegnato che è meglio sciogliere 4-5 nodi architetturali **prima** di scrivere codice. Questi sono i nodi di Flow A.

### D-1 — Decomposizione di `ArticleTabContent` (895 LOC)

Il componente è il cuore del Flow A ma il bloat è reale. Tre strategie:

- **(a) Decomposizione aggressiva** in 6 componenti: `ReadingToolbar`, `NotesPanel`, `ArticleBody`, `HighlightsSummary`, `BrocardiSection` (wrapper già esiste), `VersionModal`. Ogni subcomponente sotto 200 LOC, tutti i modali estratti. Richiede 1 commit grosso o 2-3 medi.
- **(b) Decomposizione leggera**: solo `ReadingToolbar` (250 LOC) e `VersionModal` (60 LOC, in realtà è custom-modal che va su `Modal` base). Lascia resto intatto. Minor rischio di regressioni.
- **(c) Custom hook + decomposizione selettiva**: estrae `useArticleContent()` (la pipeline `processedContent` + gli event handler text-selection) come hook dedicato, poi estrae solo `ReadingToolbar` + `VersionModal`. Il file scende a ~500 LOC ma restano le 4 modali inline.

**Raccomandazione senior**: **(a) decomposizione aggressiva**. Motivazioni:
1. Le 13 responsabilità sono **reali**, non arbitrarie — ogni sub-componente serve a una visualizzazione distinta.
2. Spike 1 ha dato l'infrastruttura (`Modal` esteso) per estrarre VersionInput → consumer.
3. I commit seguono lo stesso pattern di Spike 1 (1 commit per sub-componente, ognuno isolato).
4. La presenza di 4 modali inline è un'infrazione al pattern "tutti i modali usano Modal base" stabilito in Spike 1.

**(b)** è troppo cauto: lasciare 895 LOC - 310 (toolbar+modal) = 585 LOC ancora bloated. **(c)** introduce un hook che complica senza risolvere il problema visivo (file resta monolitico nella JSX).

### D-2 — Empty / error state per brocardi

Oggi `BrocardiDisplay` silenzia errori (C-3) e non ha empty state visibile. Tre strategie:

- **(a) Empty state dedicato + error toast + retry button**: se `brocardi_info === null` ma il backend ha risposto 200, mostra card grigia "Nessun approfondimento disponibile per questa norma". Se API fallisce, l'ErrorBoundary mostra banner rosso inline con bottone "Riprova".
- **(b) Solo toast errore, empty state silenzioso**: l'assenza di brocardi è normale per molti atti (EUR-Lex, decreti recenti). Non serve banner. L'errore sì.
- **(c) Fallback inline minimale**: un piccolo testo grigio "Brocardi non disponibili" sia in caso di `null` sia in caso di errore (indistinti dal punto di vista utente).

**Raccomandazione senior**: **(b) toast errore + empty state silenzioso**. Motivazioni:
1. Per il 40-60% delle norme non esistono brocardi (EUR-Lex, regolamenti, allegati). Mostrare empty state ovunque è rumore visivo.
2. L'errore invece è patologico: va sempre comunicato (C-3 risolto).
3. Pattern coerente con l'app: altri campi opzionali (tree, PDF) non mostrano "not available" quando assenti.

**(a)** è over-engineered per un'assenza semanticamente valida. **(c)** indistingue informazione operativa da mancanza naturale, cattivo pattern.

### D-3 — Migrazione fetch inline di `SearchForm`

`SearchForm` ha 2 fetch inline (C-4). La roadmap prevede uno Spike 2 (API Contract) che creerà `services/normaService.ts` centralizzato. Domanda: migriamo ora o aspettiamo?

- **(a) Migrare ora** creando `services/normaService.ts` anche solo con `fetchNormaData` + `fetchTree`. Spike 2 amplierà.
- **(b) Migrare ora in `services/api.ts`** (file esistente, non creare ancora `normaService.ts`). Spike 2 rifattorizzerà la separazione.
- **(c) Lasciare inline, aggiungere solo toast errore**. Spike 2 migrerà per davvero.

**Raccomandazione senior**: **(b) `services/api.ts`**. Motivazioni:
1. Il file esiste già (altri fetch lo usano). Aggiungere 2 funzioni è 20 righe di codice.
2. Rende visibile il problema di Spike 2 (duplicazione fra `api.ts` e altri use site) senza anticiparne lo scope (creazione di `normaService.ts` separato).
3. Ci dà error handling centralizzato ora — risolve C-4 senza aspettare.

**(a)** crea un file nuovo che Spike 2 potrebbe ristrutturare comunque → lavoro sprecato. **(c)** lascia un bug aperto che tutti gli step successivi eviteranno di toccare.

### D-4 — Race condition streaming (C-2)

`SearchPanel` non aborta il fetch streaming precedente quando parte uno nuovo. Tre strategie:

- **(a) AbortController semplice**: cancella il fetch precedente quando parte il nuovo. Il lettore del precedente riceve AbortError e esce silenziosamente.
- **(b) Coda ordinata**: se c'è un fetch in volo, il nuovo si mette in coda e parte quando il precedente finisce.
- **(c) Debounce input + Abort**: debounce 200ms su trigger, poi abort + fetch. Protegge anche da submit multipli accidentali.

**Raccomandazione senior**: **(a) AbortController**. Motivazioni:
1. È il pattern canonico React per fetch cancellabile.
2. L'utente si aspetta che "ricerca più recente vince" — (b) produrrebbe attese strane con code di secondi.
3. Il debounce (c) è overkill: l'utente non batte Enter 10 volte al secondo.
4. Fix minimale: 10 righe di codice, zero cambio di UX.

### D-5 — Progress indicator per streaming

Oggi esiste toast top-center con progress bar (linea 681-718). Il gap M-3 è l'assenza di feedback *dentro* la card. Tre strategie:

- **(a) Inline-card progress**: aggiungere progress bar thin sopra/sotto la `NormaCard` attiva mentre riceve articoli. Mantenere toast top-center.
- **(b) Skeleton pre-riempiti**: quando parte lo stream di "articoli 1-10", renderizzare subito 10 skeleton card che vengono sostituiti progressivamente dai real article.
- **(c) Solo toast top-center + aria-live polite**: attuale + accessibilità. Minimo intervento.

**Raccomandazione senior**: **(a) inline-card progress + aria-live**. Motivazioni:
1. Risolve M-3 (user-visible), M-5 (accessibility), M-4 indirettamente (skeleton già informativo).
2. L'approccio skeleton pre-riempito (b) è elegante ma richiede di conoscere in anticipo il numero di articoli, che è già noto ma non sempre esatto (es. per `tutti gli articoli`).
3. Il toast top-center è già buono come progress macro, l'inline serve come "dove sta arrivando".

**(b)** è il più rewarding visivamente ma aumenta il raggio d'intervento in `SearchPanel` + `NormaCard`. Da valutare come iterazione futura se il feedback è positivo.

### D-6 — Destino dei dead prop

- **(a) Rimuovere tutto**: `onPinArticle`, `_onCompareArticle`, `highlightColor` state, `console.log` debug. Se servono in futuro, si riaggiungono allora.
- **(b) Rimuovere solo `onPinArticle` e `highlightColor`**, tenere `onCompareArticle` perché Flow D (Compare) è roadmap. Il commento "_onCompareArticle" è hint che "arriverà".
- **(c) Documentare tutto come `@deprecated` senza rimozione**.

**Raccomandazione senior**: **(a) rimuovere tutto**. Motivazioni:
1. "Plan for future" è pattern vietato nella sezione "Doing tasks" del system prompt: "Don't add features, refactor, or introduce abstractions beyond what the task requires".
2. Flow D aggiungerà la prop quando serve, con la giusta signature per il suo use case. Tenerla ora vincola decisioni future.
3. `@deprecated` (c) è il peggiore: aumenta rumore senza risolvere.

---

## 4. Entry point discovery (L-4) — decisione minore ma emersa

La roadmap cita come gap: "Command Palette è l'unico sempre-disponibile ma nascosto dietro ⌘K". 
Verificato: nessun bottone visibile che la apra.

Opzioni:
- (a) Bottone floating `⌘K` in sidebar footer.
- (b) Tooltip hint in SearchForm header ("Prova anche ⌘K per ricerca rapida").
- (c) Onboarding tour che la mostra al primo uso.

**Raccomandazione**: **(a) bottone sidebar**. È lo spot più naturale, zero intrusione, 15 righe di codice. (b) è rumore visivo sulla form, (c) richiede gestione del "first use" state che non abbiamo per altro.

**Impatto**: fuori dal core-5. Tocca `Sidebar.tsx`. Valutare se dentro o fuori scope di Flow A.

---

## 5. Sommario decisioni per il via libera

| # | Decisione | Raccomandazione |
|---|-----------|-----------------|
| D-1 | Decomposizione ArticleTabContent | **(a)** aggressiva: 6 sub-componenti |
| D-2 | Brocardi empty/error state | **(b)** toast errore + empty silenzioso |
| D-3 | Fetch inline SearchForm | **(b)** migrazione a `services/api.ts` esistente |
| D-4 | Race condition streaming | **(a)** AbortController |
| D-5 | Progress indicator | **(a)** inline-card progress + aria-live |
| D-6 | Dead props | **(a)** rimuovere tutto |
| extra | Entry point ⌘K discovery | (a) bottone sidebar — decidere se dentro scope |

---

## 6. Step implementativi (dopo approvazione decisioni)

Stesso pattern Spike 1: un commit per step, commit message Conventional, pausa per feedback fra uno e l'altro.

1. **Step 1 — Fix bug critici (z-index + race condition + silent fails + dead code)**
   - Fix C-1 CommandPalette z-index
   - Fix C-2 AbortController su stream (D-4)
   - Fix C-3 Error boundary brocardi con toast (D-2)
   - Fix C-4 Fetch inline SearchForm → `api.ts` (D-3)
   - Rimozione dead code (D-6): `onPinArticle`, `_onCompareArticle`, `highlightColor` state, `console.log`
   - Commit: `fix(flow-a): close critical search path bugs (z-index, race, silent fail)`

2. **Step 2 — Z-index residui**
   - Migrare `ArticleTabContent` toolbar/picker/menu/modal ai token (M-9b-e)
   - Migrare `SelectionPopup` e `FootnoteTooltip` (M-9f-g)
   - Commit: `refactor(flow-a): migrate remaining z-index to layer system`

3. **Step 3 — VersionInput su Modal base + color picker unificato**
   - Riscrivere il modale inline di ArticleTabContent (814-873) come consumer di `Modal` esteso (M-11)
   - Unificare `SelectionPopup` color picker con `HIGHLIGHT_STYLES` (M-10)
   - Commit: `refactor(flow-a): consolidate modals on Modal base, unify highlight picker colors`

4. **Step 4 — Decomposizione ArticleTabContent (D-1 aggressiva)**
   - Estrazione `ReadingToolbar.tsx` (~250 LOC)
   - Estrazione `NotesPanel.tsx` (~40 LOC)
   - Estrazione `ArticleBody.tsx` (~60 LOC: prose + highlights summary)
   - `BrocardiSection` già esiste come wrapper
   - Rimuove 4 modali inline in file dedicati o reuse esistenti
   - `ArticleTabContent` diventa orchestratore ~250 LOC
   - Commit: `refactor(flow-a): decompose ArticleTabContent into purpose-driven components`

5. **Step 5 — Streaming progress & a11y**
   - Progress inline su `NormaCard` attiva (M-3 via D-5)
   - Skeleton count basato su `calculateExpectedArticles` (M-4)
   - aria-live polite su progress + assertive su error toast (M-5)
   - Gestione stream failure mid-payload con banner (M-2)
   - `resultsBuffer` cleanup in unmount (M-1)
   - Commit: `feat(flow-a): inline stream progress and accessibility annotations`

6. **Step 6 — (opzionale) Entry point discovery**
   - Bottone ⌘K in sidebar footer (L-4)
   - Commit: `feat(flow-a): expose command palette trigger in sidebar`

Step 6 è "nice-to-have", decidere se dentro scope o deferrare a Chiusura.

---

## 7. Verifica end-to-end

Dopo tutti gli step:

1. **Smoke manuale**
   - Cerca "art. 2043 cc" da SearchForm → card appare, brocardi visibili.
   - Stesso search da CommandPalette (⌘K) → stesso risultato, palette sopra tutto.
   - Avvia "artt. 1-50 cc", poi avvia "art. 2043" prima della fine → il secondo vince, no articoli misti.
   - Simula 500 su `/fetch_brocardi_info` (devtools network block) → toast errore, testo articolo visibile.
   - Apri version modal → chiudi con Esc, body scroll bloccato.
2. **Typecheck & build**
   - `cd frontend && npm run lint && npm run build`
3. **Test regression**
   - `npm run test`
4. **Backend smoke**
   - `python app.py`, curl su `/api/fetch_norma_data` e `/stream_article_text`.

---

## 8. Fuori scope (deferred)

Questi sono emersi nell'audit ma NON sono Flow A. Ognuno va parcheggiato con ragione esplicita:

- **Virtualizzazione** liste articoli (L-6): non è un bug, è ottimizzazione per casi estremi. Deferrable a Flow B o performance pass.
- **Scroll restoration** tra tab (L-7): tocca workspace lifecycle, è materia di Flow B.
- **Copy granulare** singole massime (L-9): feature minore, decidere in Flow C (dossier) dove export/copy è ripensato.
- **Memoizzazione** handler in NormaCard (L-8): micro-optimization, non crea bug. Riconsiderare in Spike 3 (store refactor).
- **`onCompareArticle`** prop: aspettare Flow D. La decisione D-6 la rimuove; Flow D la riaggiungerà con signature giusta.

---

_Documento di ricognizione. Zero codice modificato. Generato: 2026-04-22._
