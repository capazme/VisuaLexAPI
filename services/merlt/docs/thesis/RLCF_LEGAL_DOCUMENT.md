# MERL-T: Apprendimento Collettivo per l'Interpretazione Giuridica

## Documento per la Commissione Giuridica

> **Autore**: Giuseppe Puzio
> **Data**: Dicembre 2025
> **Titolo Tesi**: Sociologia Computazionale del Diritto
> **Progetto**: MERL-T - Multi-Expert Reinforcement Learning for Legal Text

---

## Sommario

Questo documento presenta **MERL-T**, un sistema di intelligenza artificiale per l'interpretazione di testi normativi che implementa i canoni ermeneutici dell'**Art. 12 delle Preleggi al Codice Civile**. Il sistema utilizza un approccio di **apprendimento collettivo** (*Reinforcement Learning from Community Feedback* - RLCF) dove il feedback di esperti giuridici guida il miglioramento continuo dell'interpretazione automatica.

**Rilevanza giuridica:**
- Implementazione computazionale dei criteri interpretativi dell'Art. 12 Preleggi
- Sistema multi-esperti che replica il processo dialettico dell'interpretazione
- Meccanismo di validazione basato sull'autorevolezza della fonte
- Preservazione del dissenso interpretativo come valore epistemico

---

## 1. Fondamento Giuridico: L'Art. 12 delle Preleggi

### 1.1 Il Testo Normativo

> *"Nell'applicare la legge non si può ad essa attribuire altro senso che quello fatto palese dal significato proprio delle parole secondo la connessione di esse, e dalla intenzione del legislatore."*
>
> — Art. 12 Disposizioni sulla legge in generale (Preleggi)

### 1.2 I Canoni Ermeneutici

L'Art. 12 codifica quattro criteri interpretativi fondamentali:

| Criterio | Descrizione | Implementazione MERL-T |
|----------|-------------|------------------------|
| **Interpretazione letterale** | *"significato proprio delle parole"* | **LiteralExpert** |
| **Interpretazione sistematica** | *"connessione di esse"* | **SystemicExpert** |
| **Interpretazione teleologica** | *"intenzione del legislatore"* | **PrinciplesExpert** |
| **Interpretazione evolutiva** | Applicazione giurisprudenziale | **PrecedentExpert** |

### 1.3 La Gerarchia Tradizionale

Nella dottrina classica, i canoni si applicano secondo una gerarchia:

```
1. Interpretazione LETTERALE (primaria)
        ↓ se insufficiente
2. Interpretazione SISTEMATICA (contestuale)
        ↓ se persistono dubbi
3. Interpretazione TELEOLOGICA (ratio legis)
        ↓ per conferma/integrazione
4. Interpretazione GIURISPRUDENZIALE (applicativa)
```

MERL-T implementa questa gerarchia come **pesi dinamici** che il sistema apprende dai feedback degli esperti.

---

## 2. Il Sistema Multi-Esperto

### 2.1 I Quattro Interpreti

MERL-T replica il processo interpretativo attraverso quattro "esperti virtuali", ciascuno specializzato in un canone ermeneutico:

#### 2.1.1 LiteralExpert — Interpretazione Letterale

> *"Il significato proprio delle parole"*

**Funzione**: Analizza il testo normativo nel suo significato letterale, considerando:
- Il significato comune delle parole
- Il significato tecnico-giuridico ove applicabile
- La struttura sintattica della norma

**Esempio di output**:
```
Query: "Cos'è la mora del debitore?"

LiteralExpert:
"L'art. 1219 c.c. definisce la mora come il ritardo nell'adempimento
dell'obbligazione. Il termine 'mora' deriva dal latino 'mora' (ritardo,
indugio). Il testo letterale distingue tra:
- mora ex re (automatica, comma 2)
- mora ex persona (su costituzione, comma 1)"
```

#### 2.1.2 SystemicExpert — Interpretazione Sistematica

> *"La connessione di esse [parole]"*

**Funzione**: Colloca la norma nel sistema giuridico, analizzando:
- Relazioni con altre norme (riferimenti incrociati)
- Posizione nel Codice (libro, titolo, capo, sezione)
- Coerenza con principi generali

**Esempio di output**:
```
Query: "Cos'è la mora del debitore?"

SystemicExpert:
"L'art. 1219 c.c. si colloca nel Titolo I (Obbligazioni in generale),
Capo III (Dell'inadempimento). Va letto in connessione con:
- Art. 1218 c.c. (responsabilità del debitore)
- Art. 1220 c.c. (mora del creditore)
- Art. 1224 c.c. (danni nelle obbligazioni pecuniarie)

La sistematica rivela che la mora è presupposto del risarcimento
del danno da ritardo (art. 1223 c.c.)."
```

#### 2.1.3 PrinciplesExpert — Interpretazione Teleologica

> *"L'intenzione del legislatore"*

**Funzione**: Ricerca la *ratio legis*, ovvero:
- La finalità della norma
- I lavori preparatori (ove disponibili)
- L'evoluzione storica dell'istituto

**Esempio di output**:
```
Query: "Cos'è la mora del debitore?"

PrinciplesExpert:
"La ratio della mora è tutelare il creditore dal danno derivante
dal ritardo. Il legislatore del 1942 ha inteso:

1. Sanzionare l'inadempimento temporaneo (funzione punitiva)
2. Fissare il momento da cui decorrono gli interessi (funzione
   di certezza)
3. Trasferire il rischio del perimento della cosa (art. 1221 c.c.)

L'intenzione emerge dalla Relazione al Re, che sottolinea la
necessità di 'punire il debitore negligente'."
```

#### 2.1.4 PrecedentExpert — Interpretazione Giurisprudenziale

> *Applicazione evolutiva*

**Funzione**: Analizza l'interpretazione giurisprudenziale:
- Massime della Cassazione
- Orientamenti consolidati
- Eventuali contrasti giurisprudenziali

**Esempio di output**:
```
Query: "Cos'è la mora del debitore?"

PrecedentExpert:
"La giurisprudenza ha precisato che:

- Cass. SS.UU. 18128/2005: la mora automatica opera solo nei casi
  tassativamente previsti dall'art. 1219, comma 2
- Cass. 15669/2019: l'intimazione può essere anche stragiudiziale
- Cass. 8989/2021: la costituzione in mora richiede la liquidità
  del credito

Orientamento consolidato: la mora ha natura recettizia e richiede
la conoscenza del debitore."
```

### 2.2 La Sintesi Interpretativa

I quattro esperti producono interpretazioni che vengono **aggregate** in una sintesi finale. Crucialmente, il sistema **preserva il dissenso** quando le interpretazioni divergono:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROCESSO DI SINTESI                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LiteralExpert ────┐                                            │
│  (peso: 0.35)      │                                            │
│                    │     ┌──────────────┐                       │
│  SystemicExpert ───┼────▶│  Aggregatore │                       │
│  (peso: 0.30)      │     │              │                       │
│                    │     │  Convergenza │───▶ Sintesi Unitaria  │
│  PrinciplesExpert ─┤     │     vs       │                       │
│  (peso: 0.20)      │     │  Divergenza  │───▶ Dissenso Esposto  │
│                    │     └──────────────┘                       │
│  PrecedentExpert ──┘                                            │
│  (peso: 0.15)                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Modalità Convergente**: Quando gli esperti concordano, la sintesi è unitaria.

**Modalità Divergente**: Quando emerge dissenso, il sistema:
1. Espone le diverse posizioni
2. Quantifica il grado di dissenso
3. Preserva la pluralità interpretativa

---

## 3. L'Apprendimento dalla Community Giuridica

### 3.1 Il Feedback come Fonte di Validazione

Il cuore di MERL-T è il meccanismo di **apprendimento collettivo**: il sistema migliora attraverso il feedback di esperti giuridici (avvocati, magistrati, docenti universitari).

```
┌─────────────────────────────────────────────────────────────────┐
│                 CICLO DI APPRENDIMENTO                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. QUERY                                                       │
│     L'utente pone una domanda giuridica                         │
│     "Cos'è la buona fede nell'esecuzione del contratto?"        │
│                                                                 │
│  2. INTERPRETAZIONE                                             │
│     I 4 esperti producono le loro analisi                       │
│     Il sistema genera una sintesi                               │
│                                                                 │
│  3. FEEDBACK                                                    │
│     L'esperto giuridico valuta la risposta su 3 livelli:        │
│     - Qualità delle FONTI (retrieval)                           │
│     - Correttezza del RAGIONAMENTO (reasoning)                  │
│     - Chiarezza della SINTESI (synthesis)                       │
│                                                                 │
│  4. APPRENDIMENTO                                               │
│     Il sistema aggiorna i pesi degli esperti                    │
│     Prossime query simili avranno interpretazioni migliori      │
│                                                                 │
│  5. ITERAZIONE                                                  │
│     Il ciclo si ripete, il sistema migliora continuamente       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Il Feedback Multi-Livello

Il feedback è strutturato su **tre livelli** che riflettono le componenti dell'attività interpretativa:

#### Livello 1: Retrieval (Reperimento Fonti)

Valuta la qualità delle fonti normative recuperate:

| Campo | Descrizione | Esempio |
|-------|-------------|---------|
| **Precisione** | Fonti rilevanti / Fonti totali | "4 su 5 articoli citati pertinenti" |
| **Completezza** | Fonti trovate / Fonti necessarie | "Manca riferimento all'art. 1375 c.c." |
| **Ranking** | Ordine di rilevanza | "Art. 1337 dovrebbe precedere art. 1338" |

#### Livello 2: Reasoning (Ragionamento Giuridico)

Valuta la correttezza del ragionamento interpretativo:

| Campo | Descrizione | Esempio |
|-------|-------------|---------|
| **Coerenza logica** | Assenza di contraddizioni | "Argomentazione lineare" |
| **Correttezza giuridica** | Aderenza al diritto vigente | "Interpretazione conforme a Cass. SS.UU." |
| **Qualità citazioni** | Pertinenza dei riferimenti | "Citazioni appropriate e contestualizzate" |

#### Livello 3: Synthesis (Sintesi Finale)

Valuta la qualità della risposta complessiva:

| Campo | Descrizione | Esempio |
|-------|-------------|---------|
| **Chiarezza** | Comprensibilità espositiva | "Linguaggio accessibile" |
| **Completezza** | Esaustività della risposta | "Copre tutti gli aspetti rilevanti" |
| **Utilità pratica** | Applicabilità professionale | "Utile per parere legale" |

### 3.3 L'Authority degli Esperti

Non tutti i feedback hanno lo stesso peso. MERL-T implementa un sistema di **autorevolezza dinamica** che pesa i contributi in base a:

#### 3.3.1 Credenziali di Base (Baseline)

| Qualifica | Peso Base |
|-----------|-----------|
| Studente di giurisprudenza | 0.2 |
| Laureato in giurisprudenza | 0.3 |
| Praticante avvocato | 0.4 |
| Avvocato | 0.6 |
| Avvocato specializzato | 0.7 |
| Magistrato | 0.8 |
| Docente universitario | 0.8 |
| Giudice Corte Suprema | 0.9 |

#### 3.3.2 Track Record (Storico)

L'autorevolezza evolve nel tempo in base alla **qualità dei feedback passati**:

```
Authority(t) = 0.3 × Baseline + 0.5 × TrackRecord + 0.2 × Performance(t)

Dove:
- Baseline: credenziali fisse (es. avvocato = 0.6)
- TrackRecord: media esponenziale dei feedback passati
- Performance(t): qualità del feedback corrente
```

**Esempio**:
```
Avv. Mario Rossi:
- Baseline: 0.6 (avvocato)
- TrackRecord: 0.75 (feedback passati di alta qualità)
- Performance corrente: 0.85

Authority = 0.3 × 0.6 + 0.5 × 0.75 + 0.2 × 0.85 = 0.725
```

#### 3.3.3 Domain Authority (Specializzazione)

L'autorevolezza varia per **ambito giuridico**:

```
Un civilista avrà:
- Authority alta su diritto delle obbligazioni
- Authority media su diritto di famiglia
- Authority bassa su diritto penale
```

Il sistema traccia l'attività dell'utente per dominio e calcola un'authority specifica.

---

## 4. Il Valore Epistemico del Dissenso

### 4.1 Il Dissenso come Ricchezza

A differenza dei sistemi tradizionali che cercano una "risposta corretta", MERL-T **preserva e quantifica il dissenso interpretativo**. Questo riflette la natura del diritto:

> *"L'interpretazione giuridica è intrinsecamente plurale. Non esiste una sola interpretazione 'corretta', ma un dialogo tra interpretazioni legittime."*

### 4.2 Tipi di Dissenso Rilevati

| Tipo | Descrizione | Esempio |
|------|-------------|---------|
| **Dissenso letterale-teleologico** | Tensione tra testo e ratio | "La lettera dice X, ma la ratio suggerisce Y" |
| **Dissenso dottrina-giurisprudenza** | Posizioni divergenti | "Dottrina maggioritaria vs orientamento Cassazione" |
| **Dissenso evolutivo** | Interpretazioni temporalmente diverse | "Orientamento tradizionale vs recente revirement" |

### 4.3 Quantificazione del Dissenso

Il sistema calcola un **indice di entropia** che misura il grado di dissenso:

```
Entropia = -∑ (peso_i × log(peso_i))

Dove peso_i è il peso normalizzato di ciascun esperto.

Entropia bassa (< 0.5): Consenso forte
Entropia media (0.5-1.0): Dissenso moderato
Entropia alta (> 1.0): Dissenso significativo
```

### 4.4 Presentazione del Dissenso

Quando l'entropia supera una soglia (τ = 0.4), il sistema presenta le interpretazioni divergenti:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚖️ DISSENSO INTERPRETATIVO RILEVATO                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Query: "La buona fede è clausola generale o norma cogente?"    │
│                                                                 │
│  📖 INTERPRETAZIONE LETTERALE (peso 0.35):                      │
│  "L'art. 1375 c.c. parla di 'esecuzione secondo buona fede',    │
│  suggerendo una clausola generale integrativa."                 │
│                                                                 │
│  🔗 INTERPRETAZIONE SISTEMATICA (peso 0.30):                    │
│  "La collocazione nel Capo V (effetti del contratto) indica     │
│  una funzione correttiva, dunque norma imperativa."             │
│                                                                 │
│  📊 Indice di dissenso: 0.67 (moderato)                         │
│                                                                 │
│  💡 NOTA: Le due interpretazioni non sono incompatibili.        │
│  La giurisprudenza recente (Cass. SS.UU. 2018) propende         │
│  per la natura di clausola generale con effetti cogenti.        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Il Knowledge Graph Giuridico

### 5.1 Struttura del Grafo

MERL-T organizza il diritto come un **grafo di conoscenza** dove:

- **Nodi**: Articoli, commi, principi, concetti giuridici
- **Relazioni**: Riferimenti, modifiche, abrogazioni, deroghe

```
                    ┌─────────────┐
                    │ Art. 1337   │
                    │ c.c.        │
                    │ (Trattative)│
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
     [RIFERIMENTO]   [RIFERIMENTO]   [INTERPRETATO_DA]
           │               │               │
           ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌─────────────────┐
    │ Art. 1175 │   │ Art. 1338 │   │ Cass. 14188/2016│
    │ (Corrett.)│   │ (Conosc.) │   │ (Responsabilità │
    │           │   │           │   │  precontrattuale)│
    └───────────┘   └───────────┘   └─────────────────┘
```

### 5.2 Tipi di Relazioni

| Relazione | Significato | Esempio |
|-----------|-------------|---------|
| **RIFERIMENTO** | Rimando esplicito | Art. 1337 → Art. 1175 |
| **CITATO_DA** | Citazione inversa | Art. 1175 ← Art. 1337 |
| **MODIFICA** | Novella legislativa | L. 69/2009 → Art. 183 c.p.c. |
| **DEROGA** | Eccezione | Art. 1229 deroga art. 1218 |
| **ABROGA** | Abrogazione | D.Lgs. 28/2010 abroga L. 29/1993 |
| **INTERPRETA** | Interpretazione autentica | L. 27/2012 interpreta art. 32 Cost. |
| **APPLICA** | Applicazione giurisprudenziale | Cass. 2019 applica art. 1337 |

### 5.3 Navigazione Interpretativa

Gli esperti "navigano" il grafo seguendo le relazioni rilevanti per il canone interpretativo:

```
LiteralExpert:
  Segue: testo articolo principale
  Ignora: interpretazioni evolutive

SystemicExpert:
  Segue: RIFERIMENTO, CITATO_DA (connessioni normative)
  Peso alto: norme stesso Titolo/Capo

PrinciplesExpert:
  Segue: DEROGA, MODIFICA (ratio legis)
  Cerca: principi generali (artt. 1-10 Preleggi)

PrecedentExpert:
  Segue: INTERPRETA, APPLICA (giurisprudenza)
  Ordina: per autorevolezza (Cassazione > Merito)
```

---

## 6. Integrazione con VisuaLex

### 6.1 Il Feedback dai Professionisti

MERL-T è progettato per integrarsi con **VisuaLex**, una piattaforma per professionisti del diritto. L'integrazione permette di raccogliere feedback **in contesto**:

```
┌─────────────────────────────────────────────────────────────────┐
│  WORKFLOW INTEGRATO                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Avvocato cerca "responsabilità precontrattuale"             │
│                                                                 │
│  2. MERL-T genera interpretazione                               │
│                                                                 │
│  3. Avvocato salva articolo nei preferiti                       │
│     → Sistema interpreta: "fonte rilevante" (+precision)        │
│                                                                 │
│  4. Avvocato evidenzia passaggio                                │
│     → Sistema interpreta: "contenuto utile" (+usefulness)       │
│                                                                 │
│  5. Popup (opzionale): "L'interpretazione è corretta?"          │
│     → Feedback esplicito su legal_soundness                     │
│                                                                 │
│  6. Sistema aggiorna pesi per query future simili               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Feedback Implicito vs Esplicito

| Tipo | Azione Utente | Feedback Inferito |
|------|---------------|-------------------|
| **Implicito** | Salva in preferiti | Fonte rilevante |
| **Implicito** | Evidenzia testo | Passaggio utile |
| **Implicito** | Tempo lettura > 30s | Contenuto chiaro |
| **Implicito** | Chiude subito (< 5s) | Contenuto non utile |
| **Esplicito** | Rating 1-5 stelle | Soddisfazione generale |
| **Esplicito** | "Manca art. X" | Recall incompleto |
| **Esplicito** | "Interpretazione errata" | Legal soundness bassa |

---

## 7. Implicazioni per la Teoria del Diritto

### 7.1 L'Interpretazione come Processo Sociale

MERL-T implementa una visione dell'interpretazione giuridica come **processo sociale e dinamico**, in linea con la teoria del diritto contemporanea:

> *"L'interpretazione non è un atto solitario del giurista, ma un dialogo continuo con la comunità giuridica."*

Il sistema cattura questo dialogo attraverso:
- **Pluralità di voci** (4 esperti)
- **Validazione collettiva** (feedback community)
- **Evoluzione temporale** (apprendimento continuo)

### 7.2 Autorevolezza e Legittimazione

Il meccanismo di **authority dinamica** riflette la struttura gerarchica della comunità giuridica:

1. **Autorevolezza formale**: Titoli e qualifiche (baseline)
2. **Autorevolezza sostanziale**: Track record di contributi utili
3. **Specializzazione**: Competenza per ambito

Questo evita due rischi:
- **Democrazia dei feedback**: Non tutti i pareri valgono uguale
- **Aristocrazia rigida**: Anche i non-professori possono contribuire

### 7.3 Il Ruolo del Dissenso

Preservando il dissenso, MERL-T evita il rischio di **reificazione interpretativa**:

> *"Un sistema che produce solo 'la risposta corretta' nasconde la natura problematica dell'interpretazione."*

Il dissenso esposto permette all'utente di:
- Comprendere la complessità della questione
- Valutare le diverse posizioni
- Formare un giudizio autonomo

---

## 8. Casi d'Uso

### 8.1 Ricerca per Parere Legale

```
Query: "Responsabilità del vettore per ritardo nella consegna"

Sistema:
- LiteralExpert analizza artt. 1678-1702 c.c.
- SystemicExpert collega a normativa trasporti speciale
- PrinciplesExpert evidenzia ratio protettiva destinatario
- PrecedentExpert cita Cass. 2020 su onere della prova

Sintesi: Risposta completa con fonti normative e giurisprudenziali

Feedback avvocato: "Utile, ma manca riferimento a CMR per trasporto internazionale"

Apprendimento: Sistema aumenta peso SystemicExpert per query simili
```

### 8.2 Studio Accademico

```
Query: "Natura giuridica della buona fede oggettiva"

Sistema rileva DISSENSO:
- Dottrina tradizionale: clausola generale integrativa
- Giurisprudenza recente: norma imperativa correttiva

Sintesi: Presenta entrambe le posizioni con riferimenti

Feedback docente: "Eccellente, dissenso ben esposto. Aggiungere Cass. SS.UU. 2018."

Apprendimento: Sistema impara a citare sentenza per query su buona fede
```

### 8.3 Pratica Giudiziaria

```
Query: "Termine per opposizione a decreto ingiuntivo"

Sistema:
- LiteralExpert: 40 giorni (art. 641 c.p.c.)
- SystemicExpert: termine perentorio (art. 152 c.p.c.)
- PrecedentExpert: orientamento su rimessione in termini

Sintesi: Risposta tecnica con indicazione prassi

Feedback magistrato: "Corretto. Aggiungere che il termine decorre da notifica."

Apprendimento: Sistema integra precisazione per query procedurali
```

---

## 9. Limiti e Considerazioni Etiche

### 9.1 Limiti del Sistema

1. **Non sostituisce il giurista**: MERL-T è uno strumento di supporto, non un oracolo
2. **Dipendenza dai dati**: La qualità dipende dalle fonti e dal feedback
3. **Bias potenziali**: L'authority può perpetuare gerarchie esistenti
4. **Aggiornamento**: Richiede manutenzione per novità normative

### 9.2 Considerazioni Etiche

| Rischio | Mitigazione |
|---------|-------------|
| **Deresponsabilizzazione** | Sistema presenta sempre le fonti, mai solo conclusioni |
| **Omologazione interpretativa** | Preservazione esplicita del dissenso |
| **Esclusione voci minoritarie** | Track record permette emersione di nuove autorevolezze |
| **Opacità algoritmica** | Pesi e criteri sono documentati e ispezionabili |

---

## 10. Conclusioni

MERL-T rappresenta un tentativo di **computazionalizzare i canoni ermeneutici** dell'Art. 12 Preleggi, preservando:

1. **La pluralità interpretativa** attraverso il sistema multi-esperto
2. **La validazione sociale** attraverso il feedback della community
3. **La gerarchia delle fonti** attraverso l'authority dinamica
4. **Il valore del dissenso** attraverso la quantificazione dell'entropia

Il sistema non pretende di "risolvere" l'interpretazione giuridica, ma di **supportarla** fornendo:
- Un'analisi strutturata secondo i canoni tradizionali
- Un accesso organizzato alle fonti rilevanti
- Una rappresentazione trasparente del dissenso
- Un miglioramento continuo basato sull'esperienza collettiva

---

## Glossario

| Termine | Definizione |
|---------|-------------|
| **RLCF** | Reinforcement Learning from Community Feedback - apprendimento dai feedback degli esperti |
| **Expert** | Modulo specializzato in un canone interpretativo |
| **Authority** | Peso del feedback basato su credenziali e track record |
| **Entropia** | Misura del grado di dissenso tra interpretazioni |
| **Knowledge Graph** | Rappresentazione a grafo delle relazioni normative |
| **Retrieval** | Fase di recupero delle fonti rilevanti |
| **Reasoning** | Fase di elaborazione del ragionamento giuridico |
| **Synthesis** | Fase di produzione della risposta finale |

---

## Bibliografia Essenziale

### Teoria dell'Interpretazione
- Betti, E. (1949). *Teoria generale dell'interpretazione*. Giuffrè.
- Tarello, G. (1980). *L'interpretazione della legge*. Giuffrè.
- Guastini, R. (2011). *Interpretare e argomentare*. Giuffrè.

### Informatica Giuridica
- Sartor, G. (2005). *Legal Reasoning: A Cognitive Approach to the Law*. Springer.
- Ashley, K. D. (2017). *Artificial Intelligence and Legal Analytics*. Cambridge University Press.

### Sociologia del Diritto
- Ferraris, M. (2012). *Documentalità*. Laterza.
- Catania, A. (2008). *Metamorfosi del diritto*. Laterza.

---

*Documento redatto per la tesi di laurea in Sociologia Computazionale del Diritto*

*"Il diritto non è solo testo, ma dialogo."*
