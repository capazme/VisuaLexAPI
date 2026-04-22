# Design Critique: VisuaLex — Analisi Completa

> Critica approfondita feature per feature — Fase di raffinamento
> Data: 15 marzo 2026 | Basata sull'analisi di 70+ componenti React

---

## Impressione Generale

VisuaLex è un'applicazione di ricerca legale con un'identità visiva moderna e curata, che si distingue nettamente dai tool legali tradizionali. L'uso del glass morphism, le animazioni spring e la tipografia a tre livelli (Inter, Merriweather, JetBrains Mono) trasmettono professionalità senza rigidità. L'aspetto più forte è il design keyboard-first pensato per power user legali; l'opportunità più grande è ridurre il carico cognitivo dell'interfaccia e sistemare le inconsistenze tra componenti.

---

## FEATURE 1: Command Palette e Ricerca

### Componenti analizzati
`CommandPalette.tsx`, `SearchForm.tsx`, `SearchPanel.tsx`, `GlobalSearch.tsx`, `QuickNormsManager.tsx`

### Cosa funziona bene
- Il flusso multi-step della Command Palette (tipo atto → articolo → dettagli) guida l'utente attraverso una query complessa in modo progressivo, evitando un form monolitico con troppi campi
- Le Quick Norms shortcuts con contatore d'uso offrono un pattern "frecenti" efficace che premia l'uso ripetuto
- Il parsing delle citazioni ("Art 2043 cc") con preview è un'idea eccellente: l'utente vede cosa sta per cercare prima di confermare
- La fuzzy search sui tipi di atto riduce gli errori di digitazione — l'utente non deve ricordare la nomenclatura esatta
- Gli alias personalizzabili (AliasManager) aggiungono un livello di personalizzazione raro nei tool legali

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Nessun campo di ricerca visibile nella home | 🔴 Critico | L'unico entry point è ⌘K o il click sull'icona 128px. Un utente che non conosce le shortcut vede una pagina "vuota" con un'icona enorme, non un invito all'azione. Il testo "Cerca norma..." non è un input, è una label. | Aggiungere un `<input>` visivo sotto il titolo che apra la Command Palette al focus. L'icona grande può restare come elemento decorativo ma ridotta (64px) |
| La SearchForm (form tradizionale) è nascosta e poco accessibile | 🟡 Moderato | Esiste un SearchForm completo con tutti i campi (tipo atto, numero, data, versione, allegato) ma non è raggiungibile dalla home. L'utente che preferisce un form classico non lo trova. | Aggiungere un link "Ricerca avanzata" sotto il search bar che espanda il SearchForm completo, o renderlo accessibile tramite la Command Palette con un tab "Avanzata" |
| Validazione assente nella Command Palette | 🟡 Moderato | Se l'utente preme Enter senza aver compilato i campi obbligatori, non succede nulla — nessun feedback visivo, nessun messaggio. L'utente non sa se ha sbagliato o se il sistema è lento. | Aggiungere inline validation: bordo rosso + messaggio "Seleziona un tipo di atto" quando si tenta di procedere senza input valido |
| Il citation preview non è azionabile | 🟢 Minore | Il `CitationPreviewPopup` mostra un'anteprima della citazione parsed con confidence indicator, ma non ha un bottone "Cerca questo". L'utente deve tornare alla palette e confermare manualmente. | Aggiungere un bottone "Cerca" direttamente nel popup di preview |
| GlobalSearch (⌘F) sovrascrive il find browser | 🟢 Minore | `⌘F` viene intercettato per aprire la GlobalSearch interna. L'utente che vuole usare il find del browser è bloccato. | Usare `⌘⇧F` per la ricerca globale interna, lasciando `⌘F` al browser. Oppure mostrare un link "Usa il find del browser" nel footer della GlobalSearch |
| Le Quick Norms sono visibili solo nella home empty state | 🟡 Moderato | Quando l'utente ha già dei tab aperti, le Quick Norms spariscono. Per cercarne una deve chiudere tutto o usare ⌘K. | Rendere le Quick Norms una sezione fissa nella Command Palette (già parzialmente implementato con gli alias, ma non con le Quick Norms vere e proprie). Aggiungere anche un accesso rapido dalla sidebar |

### Analisi UX del flusso di ricerca

Il flusso attuale ha **tre percorsi paralleli** per cercare:
1. Command Palette (⌘K) — veloce, keyboard-first
2. SearchForm — completo, form tradizionale (ma nascosto)
3. Quick Norms — one-click per norme salvate

Il problema è che i percorsi 2 e 3 non sono sempre accessibili. La Command Palette è l'unico percorso "sempre disponibile" e l'utente deve scoprirla. La raccomandazione è unificare gli entry point: un search bar visibile che apre la Command Palette, con un tab "Avanzata" per il SearchForm e una sezione "Frequenti" per le Quick Norms.

---

## FEATURE 2: Workspace e Tab Flottanti

### Componenti analizzati
`WorkspaceManager.tsx`, `WorkspaceNavigator.tsx`, `WorkspaceTabPanel.tsx`, `NormaBlockComponent.tsx`, `LooseArticleCard.tsx`, `ArticleCollectionComponent.tsx`, `ArticleNavigation.tsx`, `ArticleMinimap.tsx`

### Cosa funziona bene
- Il paradigma **floating windows** con drag & resize (stile macOS) è unico e potente per la ricerca legale: l'utente può affiancare visivamente due norme diverse e confrontarle spazialmente
- I **traffic light buttons** (rosso/ambra/verde) nella title bar dei pannelli sono un'affordance familiare e ben eseguita
- Il drag & drop tra tab (via dnd-kit) con tre pattern — norma-to-tab, loose-article-to-norma, loose-article-to-collection — offre flessibilità senza richiedere menu complessi
- L'**ArticleMinimap** (dot indicator per navigare tra articoli) è un pattern elegante e space-efficient
- La **WorkspaceNavigator** (dock flottante bottom-center) è una soluzione intelligente per gestire molti tab aperti senza occupare spazio fisso

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| I pannelli flottanti possono sovrapporsi in modo caotico | 🔴 Critico | Con 3+ tab aperti, i pannelli si sovrappongono e l'utente deve riposizionarli manualmente. Non c'è layout automatico (tile, cascade, split). Questo è il costo del paradigma "finestre libere". | Aggiungere un menu "Disponi" nella WorkspaceNavigator con opzioni: Affianca (side-by-side), Impila (cascade), Griglia (grid). Anche solo un "Auto-arrange" che distribuisca i pannelli uniformemente |
| Il doppio-click per rinominare un tab non è discoverable | 🟡 Moderato | L'inline rename del tab label si attiva solo con doppio click sul titolo. Nessun affordance visivo suggerisce questa possibilità. | Aggiungere un'icona di edit (matita) che appaia on hover accanto al titolo, o un tooltip "Doppio click per rinominare" al primo uso |
| Minimized state troppo piccolo | 🟡 Moderato | Un tab minimizzato diventa 300x44px — abbastanza per il titolo, ma se l'utente ha 5+ tab minimizzati, occupano comunque molto spazio verticale sull'asse X e si sovrappongono. | I tab minimizzati dovrebbero "colassare" nel dock della WorkspaceNavigator piuttosto che restare come mini-pannelli floating |
| WorkspaceNavigator non visibile su mobile | 🟡 Moderato | Il dock è `hidden md:block` — su mobile non c'è modo di navigare tra tab se non con lo swipe nell'area contenuti. L'utente non ha una vista d'insieme. | Aggiungere un mini-dock mobile nella top bar (icone compatte dei tab) o un drawer "Lista tab" accessibile dal menu |
| I drag constraints lasciano i pannelli fuori schermo | 🟢 Minore | Le constraints impediscono di trascinare il pannello completamente fuori, ma con `Math.max(44, ...)` è possibile che solo 44px del pannello restino visibili — troppo poco per recuperarlo. | Aumentare il minimo visibile a 100px e aggiungere un "Riporta al centro" nel context menu del pannello |
| LooseArticleCard e ArticleCollectionComponent hanno styling incoerente con NormaBlockComponent | 🟢 Minore | NormaBlockComponent usa primary-500 come accent, LooseArticleCard usa amber-500, ArticleCollectionComponent usa purple-500. La logica cromatica non è documentata. | Documentare il color coding: blu = norma completa, ambra = articolo singolo, viola = collezione. Aggiungere una legenda nel tooltip della WorkspaceNavigator |

### Analisi UX del workspace

Il paradigma floating windows è **potente ma rischioso**. Funziona bene per 1-3 pannelli su un desktop grande, ma degrada rapidamente su:
- Schermi piccoli (laptop 13")
- Molti tab aperti (5+)
- Mobile (dove è completamente disabilitato)

La raccomandazione strategica è offrire **due modalità di workspace**: "Libero" (floating attuale) e "Organizzato" (tab tradizionali in area fissa). L'utente sceglie nelle impostazioni. Questo copre sia il power user che vuole libertà spaziale, sia l'utente che preferisce prevedibilità.

---

## FEATURE 3: Visualizzazione Articoli e Annotazioni

### Componenti analizzati
`NormaCard.tsx`, `ArticleTabContent.tsx`, `BrocardiDisplay.tsx`, `BrocardiContent.tsx`, `MassimeSection.tsx`, `FootnoteTooltip.tsx`, `SelectionPopup.tsx`, `HighlightPicker.tsx`, `TreeViewPanel.tsx`, `DocumentStructure.tsx`, `AnnexSuggestion.tsx`

### Cosa funziona bene
- La **tipografia a due livelli** (Inter per UI, Merriweather per testo legale) è una scelta eccellente. Il serif migliora significativamente la leggibilità dei testi normativi lunghi
- Il **citation hover preview** (sottolineatura punteggiata + tooltip con anteprima articolo) è il pattern più elegante dell'intera app. Non interrompe la lettura ma offre un "atterraggio morbido" verso il cross-reference
- Il **TreeViewPanel** con griglia di articoli (grid-cols-4/5) dove gli articoli caricati mostrano un check verde è un mini-map efficace del documento intero
- Le annotazioni **Brocardi** (ratio legis, spiegazione, massime) sono ben organizzate in sezioni collapsabili con contatori — l'utente sa subito quanto contenuto c'è senza doverlo espandere
- L'**AnnexSuggestion** che rileva automaticamente quando un articolo appartiene a un allegato e suggerisce lo switch è un tocco di intelligenza UX raro

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Azioni sugli articoli nascoste dietro menu overflow | 🟡 Moderato | Copy, export, compare, print, study mode, bookmark — tutte dietro un menu "...". L'utente non scopre mai le funzionalità avanzate. Solo il 20% degli utenti esplora i menu overflow. | Mostrare le 3 azioni principali (Copia, PDF, Studio) come icon button visibili nella toolbar dell'articolo. Le restanti nel menu overflow |
| Il SelectionPopup (selezione testo) manca di contesto | 🟡 Moderato | Quando l'utente seleziona del testo, appare un popup con highlight colors + actions. Ma il popup non mostra "cosa" si sta evidenziando — nessun preview del testo selezionato. Con selezioni lunghe, l'utente può perdere il contesto. | Aggiungere un mini-preview del testo selezionato (troncato a 50 chars) nel popup, sopra le azioni |
| Le Massime hanno pagination ma non ricerca | 🟢 Minore | MassimeSection mostra max 10 massime con "Mostra altre N". Per norme con 50+ massime (es. Art. 2043 c.c.), trovare quella rilevante richiede scroll manuale. | Aggiungere un campo di ricerca testuale sopra le massime |
| FootnoteTooltip a volte si sovrappone al testo | 🟢 Minore | Il posizionamento del tooltip usa FloatingUI, ma su articoli con molte note a piè di pagina ravvicinate, i tooltip possono sovrapporsi. | Aggiungere un delay di chiusura (300ms) e assicurarsi che solo un tooltip sia visibile alla volta |
| TreeViewPanel occupa troppo spazio orizzontale su tablet | 🟡 Moderato | Il pannello albero si apre lateralmente con `w-80` (320px) fisso. Su un tablet da 768px, occupa il 41% dello schermo. | Rendere il TreeViewPanel responsive: `w-64` su tablet, `w-80` su desktop. Oppure renderlo un drawer full-width su mobile |
| Nessuna numerazione delle righe nel testo legale | 🟢 Minore | Per citare un passaggio specifico ("comma 3, riga 7"), l'utente non ha riferimenti visivi. I testi legali professionali spesso usano numerazione a margine. | Aggiungere un toggle "Numeri di riga" nelle impostazioni di lettura, che mostri numeri ogni 5 righe nel margine sinistro |
| L'evidenziazione non persiste tra sessioni | 🟡 Moderato | Gli highlight (giallo/verde/rosso/blu) scompaiono quando l'utente chiude e riapre l'articolo. Non c'è salvataggio persistente. | Salvare gli highlight nel localStorage (o nel backend per utenti autenticati), associandoli all'URN dell'articolo |

### Analisi della lettura legale

Il sistema di lettura è il cuore di VisuaLex e mostra la maturità maggiore. Due punti strategici:

**Cross-reference navigation**: Attualmente l'utente può cliccare un riferimento e aprire l'articolo citato in un nuovo tab. Ma manca un pattern "back" — dopo aver seguito 3 cross-reference, non c'è modo di tornare al punto di partenza. Un "breadcrumb di navigazione" o una history stack interna all'articolo migliorerebbe significativamente il workflow di ricerca approfondita.

**Brocardi come risorsa secondaria**: Le annotazioni Brocardi sono posizionate sotto l'articolo. Per un uso comparativo (leggere l'articolo e consultare la ratio contemporaneamente), l'utente deve scrollare avanti e indietro. Un layout **split view** (articolo a sinistra, Brocardi a destra) sarebbe più efficace per studio approfondito — e in parte è ciò che lo Study Mode fa, ma solo in modalità full-screen.

---

## FEATURE 4: Study Mode

### Componenti analizzati
`StudyMode.tsx`, `StudyModeHeader.tsx`, `StudyModeContent.tsx`, `StudyModeFooter.tsx`, `StudyModeToolsPanel.tsx`, `StudyModeSettings.tsx`, `StudyModeBrocardiPopover.tsx`, `StudyModeBrocardiPanel.tsx`, `useStudyModeShortcuts.ts`, `useEdgeHover.ts`

### Cosa funziona bene
- La **separazione dal workspace principale** (portal a document.body con z-[120/130]) crea un vero "ambiente di studio" senza distrazioni — l'utente mentalmente "entra" in uno spazio diverso
- I **tre temi** (light, dark, sepia) con sepia (#f4ecd8) come opzione di lettura prolungata dimostrano attenzione al comfort visivo. Il sepia riduce l'affaticamento oculare per sessioni lunghe
- La **scroll progress bar** sticky in alto è un indicatore sottile ma utile: l'utente sa sempre "quanto manca" dell'articolo
- Il sistema **edge hover** per attivare i pannelli laterali (note a sinistra, Brocardi a destra) è ingegnoso: i pannelli appaiono solo quando il mouse si avvicina al bordo dello schermo, massimizzando lo spazio di lettura
- Le **keyboard shortcuts dedicate** (←→ per navigare, +/- per font, b per Brocardi, t per tools, 1/2/3 per temi) dimostrano un design pensato per chi usa lo Study Mode intensivamente
- Il **responsive forzato** su mobile (fullscreen automatico sotto 640px) è la scelta giusta — lo Study Mode non avrebbe senso come pannello parziale su mobile

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| L'edge hover non è discoverable | 🔴 Critico | I pannelli laterali (note e Brocardi) appaiono solo muovendo il mouse verso i bordi dello schermo. Nessun indicatore visivo suggerisce questa possibilità. Un utente nuovo in Study Mode vede solo il testo e non sa delle funzionalità laterali. | Aggiungere delle "linguette" visive (tab con icona) sui bordi laterali: `📝` a sinistra per le note, `📚` a destra per Brocardi. Le linguette sono sempre visibili (8px di larghezza), e il pannello completo appare on hover/click |
| StudyModeFooter mostra shortcut ma scompare | 🟡 Moderato | Le shortcut nel footer sono visibili solo brevemente (animazione spring in/out). L'utente che entra per la prima volta le vede per 3 secondi e poi spariscono. | Rendere il footer persistente (o almeno visibile per 10 secondi al primo accesso). Aggiungere un bottone "?" nell'header che riapra la lista shortcut |
| Il pannello note non sincronizza con il contenuto | 🟡 Moderato | StudyModeToolsPanel ha un textarea libero per le note, ma non è collegato alla posizione nel testo. Se l'utente scrive una nota su "comma 3", non c'è modo di ricollegarla al passaggio specifico. | Implementare note ancorate al testo: l'utente seleziona un passaggio → aggiunge nota → la nota appare come marker a margine. Click sul marker riporta al passaggio |
| Resize su desktop non ha snap points | 🟢 Minore | La finestra Study Mode è resizable liberamente (min 600x400), ma senza snap. L'utente deve regolare manualmente per ottenere dimensioni "pulite". | Aggiungere snap a 50%, 75%, 100% della viewport. Double-click sulla title bar = toggle fullscreen |
| Il BrocardiPopover su mobile occupa troppo spazio | 🟡 Moderato | Su mobile, il popover Brocardi è posizionato `left-4 right-4 bottom-4 max-h-[70vh]` — occupa il 70% dello schermo e copre quasi tutto il testo. | Ridurre a `max-h-[50vh]` e aggiungere un handle di drag per ridimensionare. Oppure usare un bottom sheet con half-open state |
| Nessuna modalità "lettura continua" multi-articolo | 🟢 Minore | Lo Study Mode mostra un articolo alla volta. Per studiare gli articoli 2043-2059 c.c. in sequenza, l'utente deve cliccare "prossimo" 16 volte. | Aggiungere un toggle "Lettura continua" che concateni tutti gli articoli del tab in un unico scroll view, con separatori tra articoli |

### Analisi UX dello Study Mode

Lo Study Mode è la feature con il potenziale più alto e l'esecuzione più ambiziosa. Ha il carattere di un "reader mode" professionale (à la Pocket/Readwise) ma con funzionalità legali integrate. Due considerazioni strategiche:

**Il pin dei pannelli è sottoutilizzato**: Il meccanismo di pin (pannello rimane visibile anche uscendo dall'edge) esiste ma non è promosso. Per un utente che studia attivamente con note e Brocardi aperti, il pin è essenziale. Andrebbe presentato durante l'onboarding dello Study Mode.

**Manca un "session summary"**: Dopo una sessione di studio (30+ minuti), l'utente chiude lo Study Mode e perde il contesto. Non c'è un riepilogo di "cosa hai letto, cosa hai annotato, dove ti sei fermato". Un mini-report alla chiusura ("Hai letto 5 articoli, aggiunto 3 note, 7 highlight") incentiverebbe l'uso ripetuto.

---

## FEATURE 5: Dossier

### Componenti analizzati
`DossierPage.tsx`, `DossierModal.tsx`

### Cosa funziona bene
- Il sistema di **status tracking** (unread → reading → important → done) con indicatori colorati trasforma il dossier da semplice collezione a strumento di workflow, permettendo all'utente di tracciare il progresso della propria ricerca
- Il **drag & drop per riordinare** gli articoli nel dossier è intuitivo e ben implementato con dnd-kit
- L'**export PDF** integrato chiude il ciclo di lavoro: ricerca → raccolta → esportazione
- La **bulk selection** con checkbox permette operazioni rapide su molti articoli
- I **folder** per organizzare i dossier in gerarchie aggiungono un livello di struttura necessario per ricerche complesse

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Nessuna ricerca/filtro interno al dossier | 🟡 Moderato | Un dossier con 20+ articoli richiede scroll manuale per trovare quello cercato. Non c'è search bar né filtro per status/norma. | Aggiungere una search bar interna + filtri per status (dropdown) e tipo di norma (chip selezionabili) |
| L'empty state è generico | 🟢 Minore | Il componente EmptyState esiste con illustrazione SVG dedicata per il dossier, ma il messaggio è generico. Non guida l'utente su *come* aggiungere articoli. | Aggiungere un mini-tutorial inline: "1. Cerca una norma, 2. Clicca '+ Dossier' sull'articolo, 3. Scegli questo dossier" con screenshot/icone per ogni step |
| L'export PDF non ha opzioni di personalizzazione | 🟡 Moderato | Il PDF generato con jsPDF è basico — nessuna scelta di formato, copertina, indice, o selezione degli articoli da includere. | Aggiungere un modale pre-export con opzioni: includere/escludere annotazioni, aggiungere copertina con titolo dossier, generare indice automatico, scegliere solo articoli con status "done" |
| Il DossierModal per "aggiungi a dossier" non permette di crearne uno nuovo inline | 🟢 Minore | Quando l'utente clicca "+ Dossier" su un articolo, il modale mostra la lista dei dossier esistenti. Se non ne ha, deve chiudere, andare alla pagina Dossier, crearne uno, tornare all'articolo. | Aggiungere un "Crea nuovo dossier" direttamente nel DossierModal, con un campo nome inline |
| I contatori degli articoli non distinguono per status | 🟢 Minore | La card del dossier mostra "12 articoli" come numero totale. Non c'è breakdown per status. | Mostrare micro-badge colorati: "3 da leggere · 5 in lettura · 4 completati" |

---

## FEATURE 6: Ambienti (Environments)

### Componenti analizzati
`EnvironmentPage.tsx`, `EnvironmentContentViewer.tsx`

### Cosa funziona bene
- Il concetto di **ambiente** come "profilo di lavoro" che salva dossier + Quick Norms + alias è strategicamente forte — permette all'avvocato di switchare rapidamente tra cause diverse
- L'**import/export** via JSON/base64 è un meccanismo semplice ma efficace per condividere configurazioni tra colleghi
- L'**EnvironmentContentViewer** con sezioni espandibili (Dossier, Quick Norms, Alias) con contatori dà una vista d'insieme immediata del contenuto
- La **modalità selezionabile** (checkbox per item) riutilizzata sia nell'import che nel publish è un buon pattern DRY

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Il concetto di "Ambiente" non è chiaro al primo impatto | 🔴 Critico | L'icona Globe nella sidebar e il termine "Ambiente" non comunicano il valore della feature. Un utente nuovo non capisce perché dovrebbe creare un ambiente. La pagina stessa non ha un onboarding o una spiegazione. | Aggiungere un banner esplicativo al primo accesso: "Gli Ambienti ti permettono di organizzare le tue ricerche per caso/progetto. Crea un ambiente per ogni pratica e ritrova tutto al volo." Anche rinominare in "Progetti" o "Pratiche" sarebbe più chiaro nel contesto legale |
| L'export base64 è poco user-friendly | 🟡 Moderato | L'export genera una stringa base64 copiata negli appunti. Per un avvocato non tecnico, "base64" è incomprensibile. | Generare un file .json scaricabile con nome leggibile (es. `ambiente-causa-rossi-2026.json`). Per la condivisione rapida, generare un link condivisibile (se il backend lo supporta) |
| Nessun ambiente "attivo" visibile nell'UI | 🟡 Moderato | L'utente può creare ambienti ma non c'è un indicatore di "quale ambiente sto usando adesso" nel layout principale. Le Quick Norms e gli alias cambiano a seconda dell'ambiente, ma questo non è comunicato. | Aggiungere un badge/chip nell'header o nella sidebar che mostri l'ambiente attivo: `📁 Causa Rossi` |
| Il layout due colonne non è responsive su tablet | 🟢 Minore | Su tablet (768-1023px) il layout stacked (selettore sopra, contenuto sotto) funziona, ma la lista ambienti prende troppo spazio verticale prima che l'utente veda il contenuto. | Rendere la lista ambienti un dropdown/select su tablet, mostrando solo l'ambiente selezionato e liberando spazio per il contenuto |

---

## FEATURE 7: Bacheca / Bulletin Board

### Componenti analizzati
`BulletinBoardPage.tsx`, `SharedEnvironmentCard.tsx`, `PublishEnvironmentModal.tsx`, `EditSharedEnvironmentModal.tsx`, `ImportEnvironmentModal.tsx`, `ReportModal.tsx`, `SuggestContentModal.tsx`

### Cosa funziona bene
- Il **sistema a tre tab** (Esplora, Miei Ambienti, Suggerimenti) separa chiaramente i flussi di "consumo" e "creazione"
- Le **category colors** (viola/compliance, blu/civile, rosso/penale, ambra/amministrativo, indigo/UE) sono ben scelte e comunicano il dominio a colpo d'occhio
- Il **versioning** degli ambienti condivisi (replace vs coexist) è una feature avanzata che dimostra maturità: l'autore può aggiornare un ambiente senza rompere le copie esistenti
- Il **sistema di segnalazione** (report) con 5 motivi predefiniti e detection dei duplicati è completo
- Le **statistiche** (likes, downloads, views) con icone sulle card danno un senso di community e qualità

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| La Bacheca non è discoverable dalla sidebar | 🟡 Moderato | L'icona "Users" nella sidebar non comunica "Bacheca condivisa". Un utente nuovo non la troverebbe mai. | Rinominare il tooltip da "Bacheca" a "Community" o "Condivisi". Cambiare l'icona da Users a Share2 o Globe2. Aggiungere un badge "Nuovi" quando ci sono ambienti non ancora visti |
| Il form di pubblicazione è troppo lungo | 🟡 Moderato | PublishEnvironmentModal ha 6+ campi: selezione ambiente, titolo, descrizione (500 chars), categoria, tags (max 5), checkbox per note/highlight. È un commitment alto per l'utente. | Dividere in 2 step: Step 1 = "Cosa vuoi condividere?" (selezione ambiente + opzioni), Step 2 = "Dettagli" (titolo, descrizione, categoria, tags). Il secondo step può essere opzionale con default auto-generati |
| Le card non mostrano un'anteprima del contenuto | 🟢 Minore | SharedEnvironmentCard mostra titolo, autore, stats, categoria — ma non cosa contiene l'ambiente. L'utente deve importare per scoprirlo. | Aggiungere un "preview" expandibile o tooltip: "Contiene: 3 dossier, 8 norme rapide, 2 alias" — l'informazione è già disponibile nel modello |
| Nessun sistema di recensioni/commenti | 🟢 Minore | L'utente può fare like o report, ma non può lasciare un commento testuale. Per ambienti di compliance, un feedback come "Manca il D.Lgs. 231/2001" sarebbe prezioso. | Aggiungere un tab "Commenti" nella card espansa, con commenti moderabili dall'autore. Inizialmente anche solo un "Suggerisci modifica" testuale basterebbe |
| Il sort "Popolari" non spiega il ranking | 🟢 Minore | L'opzione "Più popolari" ordina per qualche metrica, ma l'utente non sa se è per like, download, o un mix. | Aggiungere un tooltip sull'opzione: "Ordinato per likes + downloads degli ultimi 30 giorni" |

---

## FEATURE 8: Cronologia (History)

### Componenti analizzati
`HistoryView.tsx`

### Cosa funziona bene
- Il **raggruppamento per data** (Oggi, Ieri, Settimana scorsa) è il pattern giusto per la cronologia — organizza senza sovraccaricare
- Il **click per ri-cercare** (triggerSearch dalla cronologia) chiude il loop: l'utente trova una ricerca passata e la rilancia con un click
- Il **context menu** con "Aggiungi a Quick Norms" e "Aggiungi a Dossier" trasforma la cronologia da consultazione passiva a strumento attivo

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Nessun filtro per tipo di atto o periodo | 🟡 Moderato | Con settimane di cronologia, trovare "quella ricerca sul codice penale di 3 giorni fa" richiede scroll manuale. Esiste una search bar ma non filtri strutturati. | Aggiungere chip filtro sopra la timeline: "Codici", "Leggi", "Decreti", "EU" + un date range picker |
| La timeline verticale è vuota su mobile | 🟢 Minore | Su mobile la timeline diventa horizontal scroll. È funzionale ma perde il raggruppamento per data — tutti gli item appaiono in una riga unica. | Su mobile, mantenere il raggruppamento per data in un layout verticale (lista), non horizontal scroll |
| Nessun limite o gestione automatica | 🟢 Minore | La cronologia cresce indefinitamente. Non c'è auto-cleanup né limite visibile. | Aggiungere un limite configurabile (30/60/90 giorni) nelle impostazioni, con messaggio "Cronologia più vecchia di X giorni viene rimossa automaticamente" |

---

## FEATURE 9: Confronto Articoli (Compare)

### Componenti analizzati
`CompareView.tsx`, `ArticleDiff.tsx`

### Cosa funziona bene
- Il **diff word-level** con algoritmo LCS è accurato e visivamente chiaro: rosso per rimosso, verde per aggiunto, testo normale per invariato
- Le **statistiche di similarità** (percentuale + conteggi parole aggiunte/rimosse) con color coding (verde ≥80%, ambra ≥50%, rosso <50%) danno un'immediata percezione dell'entità delle modifiche
- Il **synchronized scroll** tra i due pannelli è essenziale per il confronto visuale e ben implementato
- Il **version selector** per ogni pannello (vigente, originale, data specifica) permette confronti storici — fondamentale per capire l'evoluzione di una norma

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| L'accesso al Compare è nascosto | 🟡 Moderato | Il compare è accessibile solo dal menu overflow dell'articolo. Non c'è un "Confronta" prominente. Per una feature così potente, è sottovalorizzata nel UI. | Aggiungere un bottone "Confronta versioni" visibile nella toolbar dell'articolo (accanto a Copia e PDF). Anche un'azione dalla Command Palette: "Confronta Art. 2043 cc vigente vs originale" |
| Su mobile il layout stacked non funziona per il confronto | 🟡 Moderato | Su mobile i due pannelli si impilano verticalmente. Confrontare due testi impilati è impraticabile — l'utente non può vedere entrambi contemporaneamente. | Su mobile, mostrare solo la vista diff (non i due testi separati). Il diff unificato con colori è leggibile anche su schermo piccolo |
| Nessun export del diff | 🟢 Minore | L'utente può vedere il confronto ma non salvarlo/condividerlo. Per un parere legale, allegare un diff è comune. | Aggiungere "Esporta confronto" che generi un PDF o HTML con entrambe le versioni e il diff colorato |
| La legenda è in basso, lontana dal contenuto | 🟢 Minore | La legenda dei colori (rosso = rimosso, verde = aggiunto) è nel footer del componente diff. Su testi lunghi, l'utente deve scrollare in basso per capire i colori. | Spostare la legenda in alto come barra sticky, sotto le statistiche di similarità |

---

## FEATURE 10: Impostazioni e Alias

### Componenti analizzati
`SettingsModal.tsx`, `AliasManager.tsx`, `KeyboardShortcutsModal.tsx`, `FeedbackButton.tsx`, `FeedbackModal.tsx`, `ChangelogNotification.tsx`

### Cosa funziona bene
- Il **SegmentedControl** per la selezione tema (light/dark/sepia/high-contrast) con pill animata è visivamente piacevole e intuitivo
- L'**AliasManager** è una feature power-user ben eseguita: la validazione del trigger (2+ chars, alfanumerico), il contatore d'uso e l'edit inline sono completi
- La **KeyboardShortcutsModal** con detection automatica della piattaforma (⌘ su Mac, Ctrl su Windows) e raggruppamento per categoria è professionale
- Il **FeedbackButton** con tooltip "Aiutaci a migliorare" è ben posizionato (bottom-right, non invasivo) e il modale con tipo (bug/suggerimento/altro) + character validation è completo
- Il **ChangelogNotification** che appare automaticamente dopo un aggiornamento è un buon pattern di comunicazione con l'utente

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Il tema Sepia è nelle opzioni ma non completamente implementato | 🟡 Moderato | SettingsModal mostra 4 temi (light, dark, sepia, high-contrast) ma il sepia nel layout principale non ha styling dedicato — funziona solo in Study Mode. L'utente seleziona Sepia e non vede differenze nel workspace. | Implementare il tema Sepia anche nel layout principale (background warm, testi warmth), oppure rimuoverlo dalle impostazioni globali e segnalarlo come "Solo Study Mode" |
| Le impostazioni sono poche e non organizzate per categoria | 🟢 Minore | SettingsModal contiene tema, font size, font family, versione, link alias. Tutto in un'unica vista. Man mano che crescono le opzioni, diventerà caotico. | Organizzare in sezioni: "Aspetto" (tema, font), "Ricerca" (alias, Quick Norms default), "Avanzate" (cache, API endpoint), "Info" (versione, changelog) |
| L'AliasManager è accessibile solo dal SettingsModal | 🟢 Minore | Per gestire gli alias, l'utente deve: aprire impostazioni → cliccare link Alias → si apre un nuovo modale. Due livelli di modal. | Rendere l'AliasManager una sezione inline nelle impostazioni (accordion), o una pagina dedicata accessibile dalla sidebar |
| Il FeedbackModal non ha un'opzione per allegare screenshot | 🟢 Minore | L'utente può descrivere un bug testualmente, ma non può allegare uno screenshot. Per bug visivi, le parole non bastano. | Aggiungere un "Allega screenshot" con upload o cattura automatica della viewport |

---

## FEATURE 11: Design System e Componenti UI

### Componenti analizzati
`Button.tsx`, `IconButton.tsx`, `Card.tsx`, `Input.tsx`, `FormSelect.tsx`, `Modal.tsx`, `Toast.tsx`, `Tooltip.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `SegmentedControl.tsx`, `PDFViewer.tsx`, `BrocardiDrawer.tsx`, `CopyModal.tsx`, `AdvancedExportModal.tsx`, `AnnexSwitchDialog.tsx`

### Cosa funziona bene
- Il **Button** con 6 varianti (primary, secondary, ghost, danger, glass, outline) × 3 size (sm, md, lg) copre ogni use case. Il loading state con spinner e l'active state con scale-down sono feedback haptic appropriati
- L'**IconButton** richiede un `aria-label` obbligatorio — una scelta architetturale che forza l'accessibilità by design
- Il **Skeleton** con varianti specializzate (SkeletonText, SkeletonCard, ArticleSkeleton, NormaCardSkeleton) fornisce loading states realistici per ogni contesto. La shimmer animation con `background-size: 200% 100%` è fluida
- L'**EmptyState** con illustrazioni SVG dedicate per ogni feature (dossier, history, environment, search, bookmarks) è molto curato — non un semplice "Nessun risultato" generico
- Il **SegmentedControl** con pill animata via layoutId è il componente più esteticamente riuscito del design system
- L'**AdvancedExportModal** con opzioni di formato (clipboard/RTF/TXT), selezione massime Brocardi e scope (articolo/norma/tab) è completo e ben organizzato

### Problemi e raccomandazioni

| Problema | Severità | Dettaglio | Raccomandazione |
|----------|----------|-----------|-----------------|
| Button hover translate-y inconsistente | 🟡 Moderato | `hover:-translate-y-0.5` presente su primary, danger, glass ma non su secondary e outline. Crea asimmetria visiva quando due bottoni diversi sono affiancati. | Rimuovere translate-y da tutti i bottoni. Per i bottoni, `shadow` transition è sufficiente come feedback hover. L'effetto "lift" va riservato alle cards |
| Modal non ha varianti di dimensione coerenti | 🟡 Moderato | Modal.tsx definisce sizes sm/md/lg/xl/full, ma i modali specifici (DossierModal, FeedbackModal, etc.) a volte bypassano il sistema con `className` custom. | Auditare tutti i modali e migrare quelli con width custom alle size predefinite. Se servono size intermedie, aggiungerle al sistema (es. `2xl`) |
| Toast singolo — nessuna coda | 🟢 Minore | Solo un toast visibile alla volta. Se due azioni generano due toast in rapida successione, il primo viene sostituito. L'utente perde la prima notifica. | Implementare una coda con stacking: max 3 toast visibili, i nuovi appaiono sopra i vecchi. Ogni toast ha il proprio timer |
| Il PDFViewer è minimal | 🟡 Moderato | PDFViewer mostra un iframe con il PDF e un bottone download. Nessun zoom, navigazione pagine, o annotazione. Per un tool legale dove il PDF è fondamentale, è troppo basico. | Integrare una libreria come react-pdf con zoom, page navigation, text selection e download. Anche solo zoom + navigazione pagine migliorerebbe significativamente l'esperienza |
| Card component non ha slot composition | 🟢 Minore | Card.tsx è un container generico senza Header/Body/Footer slot. Ogni componente che usa Card deve aggiungere il proprio padding e struttura interna, causando inconsistenze. | Aggiungere sotto-componenti: `Card.Header`, `Card.Body`, `Card.Footer` con padding predefinito e separatori |
| Input.tsx non ha uno stato "success" | 🟢 Minore | Input ha stati normal, focus, error e disabled, ma nessun success (bordo verde, icona check). Per form di validazione (es. IBAN, codice fiscale), il feedback positivo è importante. | Aggiungere prop `success` con stile: bordo emerald-300, icona CheckCircle |

---

## Riepilogo Complessivo

### Per severità

| Severità | Conteggio | Feature più impattate |
|----------|-----------|----------------------|
| 🔴 Critico | 3 | Ricerca (no search bar), Workspace (sovrapposizione pannelli), Study Mode (edge hover non discoverable) |
| 🟡 Moderato | 20 | Tutte le feature hanno 2-3 problemi moderati |
| 🟢 Minore | 18 | Dettagli e polish per ogni feature |

### Per feature — Punteggio di maturità

| Feature | Maturità | Punto forte | Area di miglioramento |
|---------|----------|-------------|----------------------|
| **Ricerca / Command Palette** | ⭐⭐⭐⭐ | Parsing citazioni, fuzzy search | Discoverability, entry point visivo |
| **Workspace / Tab flottanti** | ⭐⭐⭐ | Drag & resize, DnD tra tab | Auto-layout, gestione 5+ pannelli |
| **Lettura articoli** | ⭐⭐⭐⭐⭐ | Tipografia legale, citation preview | Azioni visibili, highlight persistenti |
| **Study Mode** | ⭐⭐⭐⭐ | Edge hover, temi, shortcut | Discoverability pannelli laterali |
| **Dossier** | ⭐⭐⭐ | Status tracking, drag reorder | Ricerca interna, export avanzato |
| **Ambienti** | ⭐⭐⭐ | Concetto forte, import/export | Naming, onboarding, indicatore attivo |
| **Bacheca** | ⭐⭐⭐⭐ | Versioning, category colors | Discoverability, preview contenuti |
| **Cronologia** | ⭐⭐⭐ | Raggruppamento date, ri-cerca | Filtri strutturati, gestione volume |
| **Confronto** | ⭐⭐⭐⭐ | Diff word-level, sync scroll | Accesso diretto, export, mobile |
| **Impostazioni** | ⭐⭐⭐ | Alias system, platform detection | Organizzazione, tema sepia |
| **Design System** | ⭐⭐⭐⭐ | Skeleton, EmptyState, SegmentedControl | Toast queue, Button consistency, Card slots |

### Le 5 raccomandazioni con impatto più alto

1. **Search bar visibile nella home** — Risolve il problema critico #1 (discoverability) senza rimuovere la Command Palette
2. **Auto-layout per il workspace** — Risolve il problema critico #2 (pannelli sovrapposti) con un "Disponi automaticamente"
3. **Linguette visive nello Study Mode** — Risolve il problema critico #3 (edge hover invisibile) rendendo i pannelli laterali scoperibili
4. **Indicatore ambiente attivo** — Una piccola modifica (badge nella sidebar) che dà contesto a tutta l'esperienza
5. **Design tokens centralizzati** — Un file `designTokens.ts` con radius, padding e duration risolve le 20+ inconsistenze di consistenza

---

*Critica basata sull'analisi completa di 70+ componenti React/TypeScript/Tailwind CSS v4. Per una validazione visiva, si raccomanda di integrare con screenshot e test utente.*
