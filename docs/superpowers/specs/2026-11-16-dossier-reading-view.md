# La vista «Lettura» dentro il dossier — proposta (LC49, tempo 1)

Data: 16-11-2026. Proposta da scegliere, nessun codice. Base letta: `develop` a `a0f54cd8`, prima di LC48: nel codice la
Ricerca si chiama ancora «Corpus». Fonte: la specifica di prodotto del 16-11 su Ricerca e Dossier (§4, §11, §13, §14).
**[V]** = verificato nel codice (file e riga, sotto `apps/web/src/` salvo diverso prefisso); **[I]** = inferenza o
proposta mia.

## In breve

**Propongo la via (c): un tavolo di lettura legato al dossier, che vive solo nella sessione.** La «Lettura» del dossier
usa la stessa macchina della lettura del Corpus: tavolo, finestre accanto, telefono. La pratica che la regge porta un
`dossierId`, non si salva nel browser e si ricostruisce dal dossier a ogni apertura. Il dossier sul server resta l'unica
copia. Sul server scrivono solo tre gesti espliciti: «Aggiungi al dossier», «Togli dal dossier» e il riordino degli atti.
Sfogliare, aprire accanto e seguire una citazione mettono testi sul tavolo, non nel dossier. Ogni riga dice se è «Nel
dossier».

Perché: riusa quasi tutto il codice di lettura. Non crea una seconda copia del dossier nel browser, quindi niente doppie
scritture e niente disallineamento. Ed è la forma che servirà alla Ricerca nei pezzi d ed e: un tavolo senza
`dossierId`, con lo stesso pulsante.

## 1. Su cosa si appoggia la vista

Fatti che decidono la scelta [V]:
- La pratica del Corpus vive solo nel browser, con il **testo intero** degli articoli, e non ha un campo che la leghi a
  un dossier (`utils/practice.ts:18-29`). Si salva nel browser (`store/useAppStore.ts:2950-2953`) e all'uscita viene
  messa da parte come «unica copia» (`services/sessionEnd.ts:99`).
- Il dossier sul server è una riga per articolo con una posizione, senza atti come oggetti
  (`apps/server/prisma/schema.prisma:585-607`). Il riordino riceve l'elenco intero degli id
  (`apps/server/src/controllers/dossierController.ts:591-612`).
- I contenitori della lettura leggono la pratica **attiva** dallo store (`practice/PracticeTable.tsx:35`,
  `ReadingRow.tsx:98`, `PracticePhoneView.tsx:47-50`, `ReadingFullScreen.tsx:23-24`).
- Il lettore dell'articolo riceve già l'articolo come parametro (`search/ArticleTabContent.tsx:118`). Però sei suoi gesti
  passano da `triggerSearch`: la norma citata di un altro atto, «testo al…», «vai al vigente» e altri
  (`ArticleTabContent.tsx:593`, `:684`, `:690`, `:697`, `:788`; `decisions/DecisionReadingSurface.tsx:298`). La ricerca
  la esegue solo `SearchPanel` (`search/SearchPanel.tsx:515-520`), montato sulla pagina di ricerca. **Dentro il dossier,
  oggi, quei gesti non farebbero niente** finché non si torna alla ricerca. Anche PDF e norma citata dello stesso atto
  stanno in `SearchPanel` (`:571`, `:606`).
- «Apri tutto nel Corpus» funziona solo andando alla ricerca: `navigate('/')` più `triggerMultiSearch`
  (`dossier/DossierDetailView.tsx:323-329`, `dossier/openInPractice.ts:14-21`).

| | (a) Pratica legata e salvata nel browser | (b) Componenti indipendenti dalla pratica | (c) Tavolo legato, solo di sessione |
| --- | --- | --- | --- |
| Idea | Pratica con `dossierId`, salvata come le altre, che scrive anche nel dossier | I componenti ricevono contenuto e azioni da chi li usa | Pratica con `dossierId`, non salvata, ricostruita dal dossier; scrive solo con i tre gesti |
| Codice | store (una dozzina di azioni che cambiano il contenuto), `SearchPanel` | circa 12 contenitori, le azioni dello store con la pratica come chiave (finestre, righe, telefono, struttura, ricerca nel testo, `openDecision`) e i loro test (`ReadingRow.test` 739 righe, `PracticePhoneView.test` 517, `PracticeActBlock.test` 472) | store, 4 contenitori con la pratica come parametro, i gesti di ricerca dati a chi ospita la lettura, una scheda nuova, il segno «Nel dossier» |
| Grandezza [I] | media | grande | grande in tutto, in 5 PR medie o grandi |
| Dati del browser | due copie dello stesso dossier | nessun rischio | nessuna copia: il tavolo è una vista |
| Doppie scritture e disallineamento | sì: ogni gesto scrive in due posti; ciò che un'app aggiunge via MCP non arriva al browser senza riconciliare | no | no: il server è la verità; il tavolo si riallinea a ogni `refreshDossier` [I] |
| Sfogliare l'atto | ogni articolo sfogliato entra nel dossier (sfogliare aggiunge righe: `PracticeActBlock.tsx:162-164`) | da decidere | va sul tavolo, «Non nel dossier» |
| Pezzo d | da costruire a parte | sulla nuova interfaccia | lo stesso pulsante, su un tavolo senza `dossierId` |
| Pezzo e | il riquadro del §5 deve separare legate e libere | si toglie la pratica solo a riscrittura finita | il riquadro ignora le legate (non salvate); si toglie il contenitore, non la macchina |

**Raccomandazione: (c).** La (a) crea il problema che la specifica vuole togliere: due copie della pratica. La (b) è la
più pulita, ma è grande e oggi non dà niente in più all'utente. La (c) tiene la pratica come chiave dello store e cambia
solo chi è la verità. Alla (b) si potrà arrivare dopo, un contenitore alla volta.

**Rischi della (c) e rimedi** [I]:
- *Pratica attiva.* Molte azioni rendono attiva la pratica su cui lavorano, tramite `activate`
  (`store/useAppStore.ts:3047-3050`, chiamata per esempio a `:942`, `:971`, `:1303`). Se diventasse attiva la pratica del
  dossier, il Corpus mostrerebbe quella. Rimedio: i contenitori ricevono la pratica come parametro, e la pratica legata
  non diventa mai «attiva» per il Corpus.
- *Esclusioni.* La pratica legata va tolta da: `partialize`, `PARKED_STORE_FIELDS`, barra delle pratiche, «Sposta in
  un'altra pratica», «Salva come dossier», il passaggio alla vicina quando si chiude una pratica (`useAppStore.ts:902`),
  «Chiudi tutte» (`:916`), «Annulla» della chiusura (`practice/practiceUndo.ts`), «Tutte le pratiche» della ricerca nel
  testo (`utils/findScope.ts:113`, `hooks/useFindWindow.ts`), e il futuro riquadro del §5.
- *Gesti di ricerca dentro il lettore.* I sei `triggerSearch` vanno dati a chi ospita la lettura. Nel Corpus restano
  come oggi; nel dossier caricano l'articolo sul tavolo legato. Questo tocca `ArticleTabContent` e
  `DecisionReadingSurface`.
- *Dossier grandi.* All'apertura ogni articolo va chiesto alla fonte. La cache limita le richieste in parallelo
  (`utils/articleFetchCache.ts:33-35`). Con molti articoli conviene caricare il testo quando la riga si apre.
- *Cronologia.* Oggi una sentenza letta nel dossier non entra nella Cronologia (`dossier/DossierDecisionReader.tsx:28-29`).
  Letta nella «Lettura», sì (`DecisionEntryView`), e di nuovo a ogni riapertura, perché il segno «già registrata» sta
  sulla voce della pratica. È un difetto minore.

## 2. Cosa scrive cosa

| Gesto | Oggi nel Corpus | Oggi nel dossier | «Lettura» del dossier | Ricerca |
| --- | --- | --- | --- | --- |
| Aggiungere un articolo (ricerca, indice, frecce) | browser | server, `addToDossier` (`useAppStore.ts:1824`) | tavolo; server solo con «Aggiungi al dossier» | tavolo |
| «Aggiungi a dossier» del lettore (scelta del dossier o uno nuovo) | server (`dossier/AddToDossierPopover.tsx:148-193`, aperto da `ArticleTabContent.tsx:841`) | — | diventa «Aggiungi a questo dossier», con la stessa funzione | resta il popover (base del pezzo d) |
| Togliere un articolo o un atto | browser | server, cestino con «Annulla» (`dossier/removeItemsWithUndo.ts`) | nel dossier: server, cestino con «Annulla»; solo sul tavolo: niente | niente |
| Riordinare gli atti | browser (`reorderActs`) | server, `setDossierItemOrder` (`DossierDetailView.tsx:268`) | server, stessa funzione | tavolo |
| Aprire accanto, righe aperte | browser (`practice.ts:28`, `useAppStore.ts:259-264`) | — | sessione [I] (domanda 1) | sessione |
| Note, evidenziazioni, glosse, penna | server, dell'utente sull'articolo (`schema.prisma:404`, `:435`) | idem | idem | idem |
| Note del dossier su un articolo, stella | — | server (`schema.prisma:602`; `updateDossierItemStatus`) | server, mostrate sotto l'articolo | — |
| PDF dell'atto, Struttura, Studio | niente sul server; nel browser solo la posizione della finestra della struttura (`useAppStore.ts:2949`) | PDF del dossier: niente | niente | niente |
| «Chiedi su questo articolo» | niente: porta al grafo di MERL-T (`search/AskMerltEntry.tsx:60`) | — | invariato | invariato |
| Nuova scheda di Learn | server (`/api/lingo/cards`, `services/studiaService.ts:26`) | — | invariato | invariato |
| Sentenza aperta dalla Giurisprudenza | browser: pratica del luogo, poi attiva, poi nuova «Sentenze» (`useAppStore.ts:349`, `:1160-1164`); Cronologia una volta | — | tavolo, «Non nel dossier» | tavolo |
| Grafo | niente (`plugins/registry.tsx:34-39`) | — | invariato | invariato |

## 3. Le funzioni del §4

| Funzione | Componente di oggi | Nella «Lettura» |
| --- | --- | --- |
| Testo, rubrica, «In vigore dal…», fonte su Normattiva | `ArticleTabContent`, `ReadingToolbar` (`:818`, `:1037`) | così com'è |
| Scorrere gli articoli (numeri, frecce) | `PracticeActBlock` con `ArticleNavigation`, `useAnnexNavigation` (`:17`, `:168`) | così com'è; l'articolo sfogliato va sul tavolo |
| Studio, Struttura, PDF | `PracticeActBlock` (`:338-346`) | Studio e Struttura così come sono; PDF estratto da `SearchPanel` |
| Note, evidenziazioni, penna, glosse | `AnnotationMargin` (`ArticleTabContent.tsx:900`) | così com'è |
| «Chiedi su questo articolo» | `AskMerltEntry` (`:977`) | così com'è |
| Schede di Learn | `ArticleCardsRow` (`:991`) | così com'è |
| Giurisprudenza sotto l'articolo | `CaseLawSection` (`:1019`) | così com'è: il luogo di lettura è la pratica legata |
| «Apri accanto» | `ReadingRow`, `ReadingWindow`, `openBeside` | così com'è, con la pratica come parametro |
| Grafo | `PluginSlot` `article_sidebar` (`:1000`) | così com'è |
| Norma citata, «testo al…», «vai al vigente» | `triggerSearch`, eseguito da `SearchPanel` | **cambia**: ogni gesto va a chi ospita la lettura |
| Solo del dossier: proposte di un'app (D7b) | articolo: solo `DossierItemReader` (`:161`); sentenza: `DecisionReadingSurface` con `dossierItemId` (`:94`, `:150`) | articolo: da portare in `ArticleTabContent`; sentenza: `DecisionEntryView` deve passare `dossierItemId` |
| Solo del dossier: norme citate da una sentenza (D7d) | `DecisionReadingSurface` con `citedNorms` (`:89`, `:297`) | `DecisionEntryView` deve passare `citedNorms` |
| Solo del dossier: note su un articolo, stella | `DossierActBlock` (`attachedNotes`), `DossierArticleRow` | sotto l'articolo letto; primo passo verso «l'articolo mostra le note che lo citano» (§14) |

Da nascondere nel dossier: «Salva come dossier», «Nuova pratica», «Rinomina», «Chiudi la pratica», «Sposta in un'altra
pratica», i giri guidati della pratica, lo spazio in fondo per la barra (`PracticeTable.tsx:134-160`,
`PracticeActBlock.tsx:349`, `PracticeColumn.tsx:101`).

## 4. Il telefono

`PracticePhoneView` oggi ha tre parti: la riga con il nome e l'elenco delle pratiche, «Salva come dossier» con «⋯», e la
colonna degli atti con le righe che si aprono sul posto. Ha anche il lettore a schermo intero, montato solo lì
(`PracticePhoneView.tsx:124`). Nel dossier [I]:
- via l'elenco delle pratiche e «Salva come dossier»: il nome è quello del dossier, già in testa alla pagina;
- restano la colonna, le righe sul posto e il lettore a schermo intero, con la pratica legata come parametro (oggi
  `activate` chiude il lettore quando cambia la pratica attiva: `useAppStore.ts:3048`);
- nel «⋯» di ogni riga, «Aggiungi al dossier» o «Togli dal dossier»; «Nel dossier» scritto in parole, non solo con
  un'icona;
- le schede «Fonti · Lettura · Atti · Compiti» a 390 px vanno provate: oggi sono tre (`DossierDetailView.tsx:697-700`).

## 5. I pezzi, in ordine (una PR ciascuno)

| # | Cosa | Si prova così | Grandezza [I] |
| --- | --- | --- | --- |
| 1 | Store: `dossierId` sulla pratica; azione che costruisce il tavolo da un dossier (articoli con `fetchArticleForNorma`, sentenze con `addKnownDecisions`, `openInPractice.ts:18`); tutte le esclusioni del §1; la pratica legata mai attiva per il Corpus. Nessuna interfaccia | test dello store: un dossier dà un tavolo; dopo un ricaricamento il browser non ne tiene niente; il Corpus non cambia | medio |
| 2 | I 4 contenitori prendono la pratica come parametro; PDF, norma citata e i sei `triggerSearch` passano da chi ospita la lettura (nel Corpus come oggi) | il Corpus identico: test esistenti verdi | medio-grande |
| 3 | Scheda «Lettura» nel dossier: computer (insieme e lettura con finestre) e telefono, con le voci da pratica nascoste | un dossier con un codice, una legge e tre sentenze; ogni funzione del §3; 1440 e 390, chiaro e scuro | grande |
| 4 | «Nel dossier» / «Non nel dossier» su righe, voci dell'indice e sentenze; «Aggiungi al dossier» (riusa `addToDossier` e il popover) e «Togli dal dossier» con «Annulla»; riordino degli atti sul server; riallineamento a ogni `refreshDossier` | aggiungi, togli e riordina dalla «Lettura»: «Fonti» lo vede; un articolo sfogliato non entra | medio |
| 5 | Le cose del solo dossier: D7b sull'articolo e sulla sentenza, norme citate da una sentenza (D7d), note del dossier sull'articolo, stella | una proposta di un'app e una nota del dossier si vedono in «Lettura» come in «Fonti» | medio |

Dopo questi pezzi la Ricerca non cambia. Il pezzo d mette il pulsante della PR 4 sul tavolo della Ricerca. Il pezzo e
toglie la barra, le pratiche salvate nel browser e «Apri tutto nel Corpus».

## Domande aperte, prima del codice

1. **«Apri accanto» si salva?** Il brief lo mette tra le cose salvate sul server. Il server non ha un campo per le
   finestre, e il server è fuori da questo lavoro. Proposta: resta di sessione.
2. **Ciò che si apre leggendo entra nel dossier?** Vale per una norma citata, una sentenza dalla Giurisprudenza e un
   articolo sfogliato. Proposta: no, va sul tavolo con «Non nel dossier · Aggiungi». Così il dossier che Claude legge via
   MCP contiene solo ciò che l'avvocato ha scelto. In alternativa: entra subito, con «Annulla».
3. **Cosa si carica all'apertura?** Proposta: il testo quando la riga si apre. In alternativa tutto subito: più semplice,
   ma lento con dossier grandi.
4. **Note ed evidenziazioni restano dell'utente sull'articolo?** Lo dice il §11 della specifica: la stessa nota si vede
   in ogni dossier che ha l'articolo. Va confermato che per ora va bene così.
5. **Una sentenza letta nella «Lettura» entra nella Cronologia?** Oggi, letta nel dossier, no.
6. **Base del ramo.** Il codice del tempo 2 va riallineato a `develop` dopo LC48 (nomi «Ricerca» e «Scadenziario»).
