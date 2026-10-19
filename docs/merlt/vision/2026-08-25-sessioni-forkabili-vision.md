# Sessioni forkabili — un sistema di precedenti per il ragionamento LLM

*Documento di visione · 25 agosto 2026 · stato: concetto teorico, nessun impegno implementativo*

---

## Il concetto in una frase

Una piattaforma dove le sessioni agentiche con LLM sono oggetti pubblici e **forkabili come repository git**, la cui validazione comunitaria — tipizzata, pesata per autorevolezza, governata per dominio — produce come effetto collaterale **il miglior dataset esistente di preferenze sul ragionamento**.

## Origine

L'idea nasce dentro il percorso MERL-T/VisuaLex e ne è l'estensione naturale. Oggi il RLCF (Reinforcement Learning from Community Feedback) di MERL-T raccoglie feedback su *risposte*: trace Q&A, voti su entità pending, segnali impliciti d'uso. Questa visione alza il livello: la comunità valida **traiettorie di ragionamento intere** — sessioni agentiche, o loro singoli passaggi — e può ripartire da qualunque punto di una traiettoria altrui invece di rifare il lavoro da zero.

Il fork è la mossa chiave: trasforma il consumo passivo («leggo la sessione di un altro») in costruzione incrementale («riparto dal suo contesto e devio nel punto esatto in cui non sono d'accordo»). Il risparmio di token è l'incentivo economico che manca a quasi tutte le piattaforme sociali: qui condividere *costa meno* che rifare.

Il terreno naturale sono i **grandi temi** — diritto, medicina, ricerca — non i progetti personali. Non è un caso: sono i domini a fonti citabili e versionate, dove la qualità di un ragionamento è verificabile e la conoscenza si accumula per stratificazione.

## L'oggetto: la sessione come repository

Una sessione LLM *è già* una sequenza di turni (messaggi, tool-call, risultati). Prendere il **turno come atomo** del sistema significa che il "grafo dei ragionamenti" smette di essere una metafora e diventa la struttura dati letterale:

- ogni sessione è un cammino di turni dalla radice;
- forkare al turno N significa creare un ramo il cui genitore è il turno N, ereditando il prefisso di contesto fino a lì;
- i fork condividono fisicamente il prefisso — e i provider LLM scontano il prompt caching sui prefissi condivisi, quindi il risparmio del fork non è figurato: è tariffario;
- l'insieme delle sessioni su un tema forma un albero (in generale un DAG) che *è* il grafo dei ragionamenti.

L'obiezione del rumore («nessuno commenta la singola tool-call») si risolve come la risolve git: l'atomo è fine, ma il segnale sociale si aggrega su **viste derivate**. Le *fasi semantiche* (inquadramento, ricerca fonti, analisi, sintesi) sono viste calcolate sopra i turni — anche da un segmentatore automatico — non struttura di storage. Un voto su un turno risale alla fase e alla sessione. Fork chirurgico, lettura per fasi.

## Le sette decisioni fondanti

Le decisioni prese in fase di esplorazione, ciascuna con la sua motivazione. Sono il nucleo normativo del concetto: chi riprende in mano questo documento riparte da qui.

### 1. L'atomo è il turno

Non la sessione intera (troppo grossa: il valore del fork è deviare nel punto esatto del disaccordo), non la fase (utile ma derivabile), non un checkpoint dichiarato dall'autore (dipende dalla sua disciplina). Il turno: grana massima per il fork, con aggregazione a posteriori per la leggibilità.

### 2. «Riproducibile» significa ripartibile, con stalezza calcolata

Con un LLM non deterministico, riproducibilità non può voler dire «rieseguibile con esito identico». I tre livelli possibili:

- **rileggibile** — la traccia completa è leggibile (è il livello dei link condivisi di ChatGPT: un documento, non una sessione);
- **ripartibile** — chiunque può *continuare* dallo stato esatto di contesto a un certo turno; le tool-call e i loro risultati sono congelati nella traccia: il fork eredita le *prove* raccolte, non le ricalcola;
- **rieseguibile** — rilanci e ottieni esiti comparabili: quasi impossibile in generale (il web cambia, i modelli cambiano).

La promessa fondante è la seconda, **più il tracciamento della stalezza**: le fonti nei grandi temi sono versionate (nel diritto, la multivigenza), quindi la dipendenza di un ramo da una fonte è registrabile e — quando la fonte cambia — i rami che ci poggiano vengono marcati «potenzialmente stali». Il fork propaga premesse congelate; la stalezza calcolata è l'antidoto.

### 3. Si valida il processo, non solo l'esito

Nel diritto lo si sa da sempre: si può arrivare alla conclusione giusta con una motivazione sbagliata, e viceversa. Un like indistinto confonde «condivido la conclusione» con «il ragionamento regge» — e per un grafo dei *ragionamenti* conta la seconda. Il voto è quindi **tipizzato su quattro dimensioni**: metodo / premesse / fonti / conclusione. Il grafo sa così distinguere un «cammino con metodo validato ma conclusione contestata».

Sotto i voti espliciti, la gerarchia dei segnali dal più economico al più prezioso:

1. **impliciti** — il fork è il segnale più forte: chi forka dal tuo turno ha investito token e tempo sul tuo prefisso; è una citazione costosa, difficile da falsificare. Dove si forka-da indica i turni portanti; dove si *devia* marca i turni contestati;
2. **voti tipizzati leggeri** — un click in più di frizione, molto più segnale;
3. **revisione profonda** — thread di dissenso motivato su un turno: raro, prezioso, pesato per autorevolezza. Il dissenso motivato è informazione, non rumore (le dissenting opinions).

### 4. Autorità duale: credenziali + track record

Un'apertura totale fa vincere il rumore nei domini tecnici; il solo peso delle credenziali fa gatekeeping e uccide il cold start. La soluzione è quella già adottata dal RLCF di MERL-T, portata su scala aperta: **baseline da credenziali verificabili opt-in** (per il diritto: l'albo) **più reputazione guadagnata in piattaforma** (i tuoi rami vengono riusati, i tuoi voti anticipano il consenso). Nessuna delle due da sola basta.

### 5. Il prodotto è il segnale RLCF

Dall'aggregato emergono quattro artefatti: la **mappa navigabile** dello spazio degli argomenti (tronchi validati, rami contestati, vicoli ciechi), le **distillazioni canoniche** (le «massime» dei cammini meglio validati), il **seed operativo** (le nuove sessioni su un tema partono dai cammini validati pertinenti), e il **dataset di preferenze sul ragionamento**.

La decisione: il prodotto che definisce il successo è **l'ultimo**. Mappa, massime e seed non spariscono — sono gli *incentivi* che attirano la comunità la quale, usando la piattaforma, produce il segnale. Come reCAPTCHA digitalizzava libri come effetto collaterale, qui la gente risparmia token e costruisce un bene comune, e l'effetto collaterale è il dataset.

L'implicazione tecnica che rende la scelta potente: **ogni fork divergente crea una coppia di preferenza naturale su prefisso identico**. Quando qualcuno devia dal turno N e il suo ramo ottiene validazione migliore del ramo originale, esistono due continuazioni alternative *dello stesso identico prefisso*, con giudizio comparativo pesato per autorevolezza. È la struttura dati della preference optimization (DPO e famiglia) — che di solito si fabbrica artificialmente campionando due risposte dal modello — qui prodotta organicamente, con continuazioni *umano-guidate intere*. I voti tipizzati a livello di turno sono inoltre materiale da *process reward model*: la comunità diventa, senza saperlo, un'annotatrice di ricompense di processo pesata per competenza. Nessun laboratorio ha questi dati su scala.

### 6. Il dataset è federato per dominio

Se il prodotto è il segnale, «di chi è il dataset?» è *la* domanda politica. Una comunità di professionisti che lavora gratis per addestrare il modello proprietario di qualcuno si sentirebbe tradita — e avrebbe ragione. L'assetto scelto: **ogni comunità epistemica governa la propria fetta** — licenza, rilasci, eventuale monetizzazione condivisa. È più complesso di un commons aperto o di un modello proprietario con revenue share, ma è l'unico che regge la fiducia dei professionisti. Ed è coerente con la governance RLCF già immaginata per MERL-T. La parola «community» acquista così un contorno preciso: non un social indistinto ma comunità epistemiche (i giuristi, i medici…) ciascuna con la propria governance.

### 7. Il cancello verso il dataset è a livelli

Non tutto ciò che vive nel grafo entra nel segnale. Tre livelli:

- **bronze** — grezzo, soli segnali impliciti;
- **silver** — voti tipizzati sopra soglia;
- **gold** — fonti machine-verificate *e* validazione autorevole.

Chi addestra sceglie il livello; il gold è il prodotto di punta. Principio annesso, che è il filtro anti-allucinazione: **ciò che è verificabile a macchina va verificato a macchina** (nel diritto: le citazioni si groundano a URN — VisuaLex lo fa già); la comunità valida solo ciò che le macchine non possono.

## La chiave di volta: l'epistemologia della giurisprudenza resa macchina

Il parallelo non è decorativo — è il modello operativo dell'intero sistema:

| Giurisprudenza | Piattaforma |
|---|---|
| Sentenze | Sessioni |
| Precedente richiamato | Fork |
| Orientamento consolidato | Tronco validato |
| Contrasto giurisprudenziale | Rami divergenti dallo stesso prefisso |
| Massime | Distillazioni canoniche |
| Dissenting opinion | Thread di dissenso motivato |
| Sezioni Unite | Governance federata di dominio |
| Abrogazione / ius superveniens | Cascata di stalezza |

Il diritto non è solo il primo verticale: è il dominio che ha già inventato questa epistemologia — conoscenza che si accumula per stratificazione di casi, con meccanismi espliciti per consolidare, dissentire e superare. La piattaforma è una macchina per produrre conoscenza di tipo giurisprudenziale in qualunque dominio.

## L'architettura della fiducia

Se il dataset è il prodotto, avvelenare il dataset è *l'attacco*. Quattro minacce più una questione deontologica, ciascuna con la sua difesa strutturale:

1. **Propagazione dell'errore ereditato.** Un voto autorevole «premessa errata» su un turno deve *cascare* sui discendenti come warning — la ritrattazione scientifica resa computabile. Il grafo rende la cascata calcolabile; è parente stretto dei meccanismi di igiene/decay già presenti nel grafo MERL-T.
2. **Iniezione nel contesto.** Minaccia specifica di questa piattaforma: chi forka *eredita il contesto*, e il contesto può contenere istruzioni avversarie nascoste (in un turno, o in un finto risultato di tool). Difesa strutturale: i tool girano sull'infrastruttura della piattaforma, quindi i risultati sono **attestati** (firmati); il contenuto incollato dall'utente è etichettato come non-attestato. **La provenienza di ogni blocco di contesto è di prima classe.**
3. **Gaming del segnale.** Anelli di collusione che gonfiano i propri rami. Difese: autorità duale, il fork come segnale costoso (falsificarlo costa token veri), voti pubblici e auditabili.
4. **Riciclaggio di allucinazioni.** Una citazione inventata che sopravvive alla validazione entra nel dataset con patente di legittimità. Difesa: il principio del cancello gold — verifica a macchina prima del giudizio umano.
5. **Privacy e deontologia.** Un professionista che forka una sessione nata da un caso reale rischia di pubblicare fatti di un cliente. Le sessioni **nascono private**; la *pubblicazione* è un atto separato con passaggio di scrub/anonimizzazione. Nei grandi temi la norma sarà la questione astratta, ma il guardrail serve.

## Cosa questa piattaforma NON è

- **Non è un archivio di trascrizioni.** I link condivisi di ChatGPT sono sola lettura: documenti, non sessioni. Qui l'oggetto condiviso è *ripartibile*.
- **Non è un'arena di confronto modelli.** Le arene (LMSYS) confrontano risposte secche; qui si costruiscono traiettorie incrementali.
- **Non è peer review classica.** OpenReview valida ma non forka; qui la validazione più forte è *costruire sopra*.
- **Non è consulenza legale** (né medica, né altro). Un ragionamento pubblicato e validato dalla comunità resta un artefatto epistemico, non un parere professionale — e la piattaforma lo dichiara.
- **Non è un social generalista.** I meccanismi sociali (voti, commenti) sono al servizio del segnale, non dell'engagement.

## Rischi dichiarati

- **Cold start.** Il valore richiede community e viceversa. Il bootstrap ovvio è MERL-T/VisuaLex come primo verticale: esistono già le sessioni Q&A con trace, il grafo giuridico, il modello di consenso, l'autorità RLCF. Il diritto italiano è il banco di prova con la comunità più motivata.
- **UX del DAG.** Git è ostico per sviluppatori; un DAG di ragionamenti per giuristi lo sarebbe di più. L'interfaccia deve *nascondere* il grafo (fasi, cammini consigliati, «riparti da qui»), non esibirlo. La complessità strutturale è per la macchina, non per il lettore.
- **Costo della moderazione.** La governance federata distribuisce il carico, ma le comunità di dominio vanno costruite e curate — non emergono da sole.
- **Nessun precedente diretto.** Nessuna piattaforma esistente combina fork-con-contesto + validazione comunitaria + dataset governato. È insieme l'opportunità e la prova che è difficile.

## Da qui a un MVP (non impegnativo)

Una scala di verifiche progressive, ciascuna falsificabile a basso costo — nessuna delle quali è oggi pianificata:

1. **Fork interno.** Rendere ripartibili le sessioni Q&A di MERL-T (`/merlt/chiedi`) per lo stesso utente: «riparti da questo passaggio». Verifica la meccanica del prefisso congelato senza alcuna componente sociale.
2. **Condivisione read-only con voto tipizzato.** Una sessione pubblicata, leggibile per fasi, votabile su metodo/premesse/fonti/conclusione. Verifica se il voto tipizzato viene usato o ignorato.
3. **Fork pubblico.** Chiunque (con consenso `full`) riparte dalla sessione di un altro. Verifica l'incentivo del risparmio e produce le prime coppie di preferenza naturali.
4. **Cascata di stalezza.** Collegare i rami alle fonti versionate di VisuaLex e propagare l'invalidazione. Verifica la promessa «ripartibile + stalezza».
5. **Primo rilascio dataset (bronze).** Solo a valle di tutto, con la governance di dominio definita.

Ogni gradino ha valore autonomo per VisuaLex anche se la visione piena non si realizzasse mai.

---

*Documento generato a valle di una sessione di esplorazione concettuale (brainstorming) del 25 agosto 2026. Le sette decisioni riflettono scelte esplicite dell'autore; gli insight tecnici (coppie di preferenza da fork, economia del prompt caching, provenienza attestata) sono argomentazioni a supporto, da riverificare in fase di design.*
