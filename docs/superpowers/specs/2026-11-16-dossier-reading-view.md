# La vista «Lettura» dentro il dossier — proposta (LC49, tempo 1)

Data: 16-11-2026. Stato: proposta da scegliere, nessun codice. Base letta: `develop` a `a0f54cd8` (prima di LC48: nel
codice la Ricerca si chiama ancora «Corpus»). Fonte: la specifica di prodotto del 16-11 su Ricerca e Dossier (§4, §11,
§13, §14).

Segni: **[V]** verificato nel codice, con file e riga; **[I]** mia inferenza o proposta. I percorsi senza prefisso sono
sotto `apps/web/src/`.

## In breve

**Proposta: la via (c), «un tavolo di lettura legato al dossier, che vive solo nella sessione».** La vista «Lettura» del
dossier usa la stessa macchina della lettura del Corpus (tavolo, finestre accanto, telefono). La pratica che la regge
porta un `dossierId`, non si salva nel browser e si ricostruisce dal dossier a ogni apertura. Il dossier sul server
resta l'unica copia. Sul server scrivono solo tre gesti espliciti: «Aggiungi al dossier», «Togli dal dossier» e il
riordino degli atti. Sfogliare, aprire accanto e seguire una citazione mettono testi sul tavolo, non nel dossier: ogni
riga dice se è «Nel dossier» o no.

Perché: riusa quasi tutto il codice di lettura così com'è. Non crea una seconda copia del dossier nel browser, quindi
niente doppie scritture e niente disallineamento. Ed è già la forma che servirà alla Ricerca nei pezzi d ed e: un tavolo
senza `dossierId`, con lo stesso pulsante «Aggiungi al dossier».

## 1. Su cosa si appoggia la vista

### Cosa c'è oggi

- La pratica del Corpus vive solo nel browser. Contiene gli atti con **il testo intero** degli articoli, le sentenze e le
  finestre accanto. Non ha un campo che la leghi a un dossier. [V `utils/practice.ts:18-29`]
- Si salva nel browser (`partialize`) [V `store/useAppStore.ts:2950-2953`]. All'uscita viene messa da parte come
  «unica copia» [V `services/sessionEnd.ts:99`].
- Il dossier sul server è una riga per articolo, con una posizione; non ha atti come oggetti [V
  `apps/server/prisma/schema.prisma:585-607`]. Il server riordina ricevendo l'elenco intero degli id [V
  `apps/server/src/controllers/dossierController.ts:591-612`].
- «Apri tutto nel Corpus» crea una pratica e poi rilancia le ricerche dalla pagina di ricerca: `navigate('/')` più
  `triggerMultiSearch` [V `components/features/dossier/DossierDetailView.tsx:323-329`,
  `components/features/dossier/openInPractice.ts:14-21`]. Il caricamento dei risultati nella pratica passa da
  `SearchPanel` [V `components/features/search/SearchPanel.tsx:169-230`]. Lì stanno anche il PDF e la norma citata [V
  `SearchPanel.tsx:571`, `:606`].
- I contenitori della lettura leggono la pratica **attiva** dallo store, non una pratica ricevuta come parametro [V
  `PracticeTable.tsx:35`, `ReadingRow.tsx:98`, `PracticePhoneView.tsx:47-50`, `ReadingFullScreen.tsx:23-24`].
- Il lettore dell'articolo (`ArticleTabContent`) riceve già l'articolo come parametro [V
  `components/features/search/ArticleTabContent.tsx:118`]. I suoi legami con la pratica sono tre identificativi
  (`readingOrigin`, `tabId`, `findHostId`) e i collegamenti che apre. Una sentenza aperta da un link entra nella pratica
  del luogo; se non ce n'è, nella pratica attiva o in una nuova «Sentenze» [V `store/useAppStore.ts:1155-1164`].
- Nel dossier c'è un lettore ridotto, `DossierItemReader`. È l'unico che mostra le proposte di un'app collegata su un
  passo (D7b) [V `components/features/dossier/DossierItemReader.tsx:161`, `useEntryProposals`].

### Le tre vie a confronto

| | (a) Pratica del browser legata e salvata | (b) Componenti indipendenti dalla pratica | (c) Tavolo legato, solo di sessione (proposta) |
| --- | --- | --- | --- |
| Idea | Pratica con `dossierId`, salvata nel browser come le altre, che scrive anche nel dossier | I componenti ricevono atti, articoli e azioni da chi li usa (dossier o Ricerca) | Pratica con `dossierId`, **non salvata e non messa da parte**, ricostruita dal dossier a ogni apertura; scrive nel dossier solo con i tre gesti espliciti |
| Codice toccato | Store, tutte le azioni che cambiano il contenuto (circa 12), `SearchPanel` | I contenitori della pratica (circa 12 file), le azioni dello store legate alla pratica (finestre, righe, rivelazione, lettore del telefono, struttura, ricerca nel testo, `openDecision`) e i loro test (`ReadingRow.test` 739 righe, `PracticePhoneView.test` 517, `PracticeActBlock.test` 472…) | Store (un campo, un'azione che costruisce il tavolo, esclusioni), 4 contenitori che prendono la pratica come parametro, una nuova scheda nel dossier, il segno «Nel dossier» sulle righe |
| Grandezza [I] | media | grande | media, in 5-6 PR |
| Dati del browser | Restano due copie dello stesso dossier: il browser e il server | Nessun rischio | Nessuna copia: il tavolo è una vista; i testi caricati stanno nella cache in memoria [V `utils/articleFetchCache.ts:24`] |
| Doppie scritture e disallineamento | Sì. Ogni azione scrive in due posti; un cambio fatto altrove (un'app via MCP) non arriva nella copia del browser finché qualcuno non riconcilia | No | No: il server è l'unica verità; il tavolo si riallinea a ogni `refreshDossier` [I] |
| Sfogliare l'atto | Ogni articolo sfogliato entrerebbe nel dossier (oggi sfogliare aggiunge righe alla pratica [V `PracticeActBlock.tsx:162-164`]): sporca il contesto che Claude legge | Da decidere componente per componente | Sfogliare aggiunge al tavolo, non al dossier; la riga dice «Non nel dossier» |
| Funziona fuori dalla pagina di ricerca | No, senza estrarre il caricamento da `SearchPanel` | Sì, ma va riscritto il caricamento | Sì: il tavolo si riempie con `fetchArticleForNorma` e `addArticlesToPractice`, senza `SearchPanel` [I] |
| Pezzo d (Aggiungi al dossier dalla Ricerca) | Da costruire a parte | Da costruire sulla nuova interfaccia | Lo stesso pulsante della riga, su un tavolo senza `dossierId` |
| Pezzo e (via le pratiche, Dossier → Pratiche, riquadro del §5) | Il riquadro deve distinguere le pratiche legate da quelle libere | Si possono togliere le pratiche, ma solo a riscrittura finita | Il riquadro ignora le pratiche legate: non sono salvate. Si toglie il contenitore (barra, più pratiche, salvataggio nel browser), non la macchina della lettura |

**Raccomandazione: (c).** La (a) crea proprio il problema che la specifica vuole togliere: due copie della stessa
pratica. La (b) è la forma più pulita, ma oggi è un lavoro grande e senza un vantaggio visibile per l'utente. Il
coordinamento delle finestre, delle righe aperte e del telefono è tutto nello store, con la pratica come chiave. La (c)
tiene quella chiave e cambia solo chi è la verità. Se un giorno servirà la (b), si potrà arrivarci un contenitore alla
volta.

**Rischi della (c)** [I], con il rimedio:
- *Pratica attiva.* Lo store rende attiva una pratica in molti punti: `activate(...)` in una decina di azioni, più
  alcune assegnazioni dirette [V `store/useAppStore.ts:942`, `:971`, `:1208`, `:1303`, `:3049`]. Se diventasse attiva la
  pratica del dossier, il Corpus mostrerebbe quella. Rimedio: i contenitori ricevono la pratica come parametro, e la
  pratica legata non diventa mai «attiva» per il Corpus (un controllo in `activate` e nelle assegnazioni dirette).
- *Esclusioni.* La pratica legata va tolta da `partialize`, da `PARKED_STORE_FIELDS`, dalla barra delle pratiche, dalle
  destinazioni di «Sposta in un'altra pratica», da «Salva come dossier» e dal futuro riquadro del §5.
- *Dossier grandi.* All'apertura ogni articolo va chiesto alla fonte. La cache limita le richieste in parallelo [V
  `utils/articleFetchCache.ts:33-35`]. Con molti articoli conviene caricare il testo solo quando la riga si apre: va
  misurato nella PR 1.
- *Cronologia di una sentenza.* Il segno «già registrata» vive sulla voce della pratica [V CLAUDE.md di `apps/web`,
  «How the collections differ»]. Sul tavolo di sessione si perde a ogni riapertura, quindi la Cronologia può registrare
  di nuovo: è un difetto minore, da accettare.

## 2. Cosa scrive cosa

| Azione | Oggi nel Corpus | Oggi nel dossier | Proposta: «Lettura» del dossier | Proposta: Ricerca |
| --- | --- | --- | --- | --- |
| Aggiungere un articolo (ricerca, indice, frecce) | browser (pratica) [V `practice.ts:17`] | server, `addToDossier` [V `useAppStore.ts:1824`] | tavolo (sessione); server solo con «Aggiungi al dossier» | tavolo (sessione) |
| Togliere un articolo o un atto | browser | server, nel cestino con «Annulla» [V `dossier/removeItemsWithUndo.ts`] | riga nel dossier: server, cestino con «Annulla»; riga solo sul tavolo: niente | niente |
| Riordinare gli atti | browser (`reorderActs`) | server, `setDossierItemOrder` [V `DossierDetailView.tsx:268`] | server, stessa funzione (ordine degli atti tradotto nelle posizioni degli articoli) | tavolo |
| Aprire accanto, righe aperte | browser (finestre salvate con la pratica, righe di sessione) [V `practice.ts:28`, `useAppStore.ts:259-264`] | — | sessione, niente sul server [I] (vedi le domande aperte) | sessione |
| Note, evidenziazioni, glosse, penna | server, dell'utente sull'articolo (`normaKey`, `userId`) [V `schema.prisma:404`, `:435`] | idem | idem, invariato | idem |
| Note del dossier su un articolo | — | server (`aboutItemId`) [V `schema.prisma:602`] | server; mostrate sotto l'articolo | — |
| Stella / stato | — | server (`updateDossierItemStatus`) | server | — |
| PDF dell'atto, Struttura, Studio | niente sul server; nel browser solo la posizione della finestra della struttura [V `useAppStore.ts:2949`] | PDF del dossier: niente | niente | niente |
| «Chiedi su questo articolo» | porta al grafo di MERL-T, niente qui [V `search/AskMerltEntry.tsx:60`] | — | invariato | invariato |
| Schede di Learn («Nuova scheda») | server (`/api/lingo/articolo`) [V `studia/useArticleCards.ts:13`] | — | invariato | invariato |
| Aprire una sentenza dalla Giurisprudenza | browser (`openDecision` nella pratica) [V `useAppStore.ts:1155`]; Cronologia sul server una volta | lettore della sentenza nella riga | tavolo, segnata «Non nel dossier» | tavolo |
| Grafo | niente: riquadro laterale sotto flag [V `plugins/registry.tsx:34-39`, `ArticleTabContent.tsx:1000`] | — | invariato | invariato |

## 3. Le funzioni del §4, una per una

| Funzione | Componente di oggi | Nella «Lettura» |
| --- | --- | --- |
| Testo, rubrica, «In vigore dal…», fonte ufficiale su Normattiva | `ArticleTabContent`, `ReadingToolbar`, `VersionStatusChip` [V `ArticleTabContent.tsx:818`, `:1037`] | così com'è |
| Scorrere gli articoli (numeri, frecce «1299 / 3250») | `PracticeActBlock` con `ArticleNavigation` e `useAnnexNavigation` [V `PracticeActBlock.tsx:17`, `:168`] | così com'è; l'articolo sfogliato va sul tavolo, non nel dossier |
| Studio, Struttura, PDF | `PracticeActBlock` (`StudyMode`, `TreeViewPanel`, `onViewPdf`) [V `PracticeActBlock.tsx:338-346`] | Studio e Struttura così come sono; il PDF va estratto da `SearchPanel` in un piccolo hook [V `SearchPanel.tsx:606`] |
| Note, evidenziazioni, penna, glosse | `AnnotationMargin` dentro `ArticleTabContent` [V `ArticleTabContent.tsx:900`] | così com'è (sono dell'utente sull'articolo) |
| «Chiedi su questo articolo» | `AskMerltEntry` [V `ArticleTabContent.tsx:977`] | così com'è |
| Schede di Learn | `ArticleCardsRow` [V `ArticleTabContent.tsx:991`] | così com'è |
| Giurisprudenza sotto l'articolo | `CaseLawSection` [V `ArticleTabContent.tsx:1019`] | così com'è; una sentenza aperta va sul tavolo legato, perché il luogo della lettura è la sua pratica |
| «Apri accanto» | `ReadingRow`, `ReadingWindow`, `openBeside` | così com'è; `ReadingRow` prende la pratica come parametro |
| Grafo | `PluginSlot` `article_sidebar` [V `ArticleTabContent.tsx:1000`] | così com'è |
| Norma citata nel testo | `handleCrossReferenceNavigate` in `SearchPanel` [V `SearchPanel.tsx:571`] | da riscrivere per il tavolo legato: carica l'articolo e lo apre accanto, senza passare dalla ricerca [I] |
| Solo del dossier: proposte di un'app su un passo (D7b) | solo in `DossierItemReader` [V `DossierItemReader.tsx:161`] | da portare in `ArticleTabContent`, quando la riga è nel dossier (riceve l'id della voce) |
| Solo del dossier: note su un articolo, stella | `DossierActBlock` (`attachedNotes`), `DossierArticleRow` | sotto l'articolo letto; è anche il primo passo verso «l'articolo mostra le note che lo citano» (§14) |

Da nascondere nel dossier: «Salva come dossier», «Nuova pratica», «Rinomina», «Chiudi la pratica», «Sposta in un'altra
pratica», i giri guidati della pratica e lo spazio in fondo per la barra delle pratiche [V `PracticeTable.tsx:134-160`,
`PracticeActBlock.tsx:349`, `PracticeColumn.tsx:101`].

## 4. Il telefono

`PracticePhoneView` oggi fa tre cose: la riga con il nome e l'elenco delle pratiche, «Salva come dossier» con «⋯», e la
colonna degli atti, con le righe che si aprono sul posto e il lettore a schermo intero (`ReadingFullScreen`, montato solo
lì [V `PracticePhoneView.tsx:124`]). Nel dossier [I]:
- via l'elenco delle pratiche e «Salva come dossier»: il titolo è quello del dossier, già in testa alla pagina;
- restano la colonna, le righe sul posto e il lettore a schermo intero, che riceve la pratica legata come parametro
  invece di quella attiva;
- su ogni riga, nel suo «⋯», «Aggiungi al dossier» oppure «Togli dal dossier»; il segno «Nel dossier» si legge in parole,
  non solo con un'icona;
- le schede «Fonti · Lettura · Atti · Compiti» a 390 px vanno provate: oggi sono tre e stanno nella riga [V
  `DossierDetailView.tsx:697-700`].

## 5. I pezzi, in ordine (una PR ciascuno)

| # | Cosa | Si prova così | Grandezza [I] |
| --- | --- | --- | --- |
| 1 | Store: `dossierId` sulla pratica; azione che costruisce il tavolo da un dossier (articoli con `fetchArticleForNorma`, sentenze con `addKnownDecisions` [V `openInPractice.ts:18`]); esclusione da salvataggio, uscita, barra, «Sposta», «Salva come dossier»; la pratica legata non diventa mai attiva per il Corpus. Nessuna interfaccia | test dello store: un dossier dà un tavolo; ricaricando non resta niente nel browser; il Corpus non cambia | medio |
| 2 | I quattro contenitori (`PracticeTable`, `ReadingRow`, `PracticePhoneView`, `ReadingFullScreen`) prendono la pratica come parametro; PDF e norma citata estratti da `SearchPanel` in un hook che funziona anche senza la ricerca | il Corpus identico (test esistenti verdi) | medio |
| 3 | Scheda «Lettura» nel dossier: la vista a due tempi su computer e la colonna sul telefono, con le voci da pratica nascoste | apertura di un dossier con un codice, una legge e tre sentenze; tutte le funzioni del §3 sopra; 1440 e 390, chiaro e scuro | grande |
| 4 | «Nel dossier» / «Non nel dossier» su righe, voci dell'indice e sentenze; «Aggiungi al dossier» e «Togli dal dossier» (con «Annulla»); riordino degli atti scritto sul server; riallineamento a ogni `refreshDossier` | aggiungi, togli e riordina dalla «Lettura»: «Fonti» e il server lo vedono; un articolo sfogliato non entra | medio |
| 5 | Le cose del solo dossier nella «Lettura»: proposte D7b, note del dossier sull'articolo, stella | una proposta di un'app e una nota su un articolo si vedono in «Lettura» come in «Fonti» | medio |

Dopo questi pezzi la Ricerca non cambia. Il pezzo d mette il pulsante della PR 4 sul tavolo della Ricerca. Il pezzo e
toglie la barra, le pratiche salvate nel browser e «Apri tutto nel Corpus», che la «Lettura» sostituisce.

## Domande aperte, prima del codice

1. **«Apri accanto» si salva?** Il brief lo mette tra le cose salvate sul server. Il server non ha un campo per le
   finestre aperte, e le modifiche al server sono fuori da questo lavoro. Proposta: resta di sessione.
2. **Ciò che si apre leggendo entra nel dossier?** Parlo di una norma citata, di una sentenza aperta dalla
   Giurisprudenza e di un articolo sfogliato. Proposta: no, va sul tavolo con «Non nel dossier · Aggiungi». Così il
   dossier che Claude legge via MCP contiene solo ciò che l'avvocato ha scelto. In alternativa entra subito, con
   «Annulla».
3. **Che cosa si vede all'apertura?** Proposta: la vista d'insieme della «Lettura», con il testo caricato quando la riga
   si apre. Oppure tutti i testi caricati subito: più semplice, ma lento con dossier grandi.
4. **Le note e le evidenziazioni restano dell'utente sull'articolo?** Lo dicono i fatti verificati della specifica (§11):
   la stessa nota si vede in ogni dossier che ha l'articolo. Va confermato che per ora va bene così.
5. **Base del ramo.** Il ramo parte da `a0f54cd8`, prima di LC48. Il codice del tempo 2 va riallineato a `develop` dopo
   LC48, per i nomi «Ricerca» e «Scadenziario».
