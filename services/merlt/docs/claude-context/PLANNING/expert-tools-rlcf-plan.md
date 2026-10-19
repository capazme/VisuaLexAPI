# Piano Integrato: Expert Tools + RLCF Multilivello + Retrieval Stratificato

> **Versione**: 1.0 | **Data**: 10 Dicembre 2025 | **Status**: Design Completo

## Executive Summary

Questo piano implementa **RQ5 (Expert Tools)** e **RQ6 (RLCF Multilivello)** come sistema integrato, fondato sull'**epistemologia giuridica italiana** (Art. 12 Preleggi).

### Architettura a Colpo d'Occhio

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MERL-T v2 ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   QUERY ──► θ_gating (REASONING) ──► [Expert Weights]                       │
│                     │                                                        │
│        ┌───────────┼───────────┬───────────┐                                │
│        ▼           ▼           ▼           ▼                                │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                          │
│   │LITERAL  │ │SYSTEMIC │ │PRINCIPLES││PRECEDENT│   ← 4 Expert (Art.12)    │
│   │θ_trav_L │ │θ_trav_S │ │θ_trav_P │ │θ_trav_R │   ← θ_traverse (RETRIEVAL)│
│   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘                          │
│        │           │           │           │                                │
│        └───────────┴─────┬─────┴───────────┘                                │
│                          ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    STORAGE LAYER                                     │   │
│   │  API (VisualEx) ◄──► Graph (FalkorDB) ◄──► Vectors (Qdrant)         │   │
│   │     ↑ Norme           ↑ Relazioni           ↑ Embeddings            │   │
│   │                       └─── Bridge Table ────┘                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                   │
│                          ▼                                                   │
│              θ_rerank (SYNTHESIS) ──► RESPONSE                              │
│                          │                                                   │
│                          ▼                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    RLCF MULTILIVELLO                                 │   │
│   │                                                                      │   │
│   │  Feedback ──► A(user,level,domain) × R(f) ──► ∇θ                    │   │
│   │                                                                      │   │
│   │  Layer      │ Parametri    │ Feedback                               │   │
│   │  ──────────────────────────────────────                             │   │
│   │  RETRIEVAL  │ θ_traverse   │ sources_relevant, relations_useful    │   │
│   │  REASONING  │ θ_gating     │ best_expert, {expert}_correct         │   │
│   │  SYNTHESIS  │ θ_rerank     │ final_correct, ranking_correct        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### I 3 Parametri Apprendibili

| Parametro | Layer | Funzione | Prior |
|-----------|-------|----------|-------|
| **θ_traverse** | RETRIEVAL | Peso relazioni nel grafo (per Expert) | Schema LKIF |
| **θ_gating** | REASONING | Peso attivazione Expert | Uniform |
| **θ_rerank** | SYNTHESIS | Ranking finale risultati | ListNet |

### I 4 Expert (Art. 12 Preleggi)

| Expert | Canone | Source | Relazioni Chiave |
|--------|--------|--------|------------------|
| **Literal** | Interpretazione letterale | API + Qdrant(norma) | contiene, definisce |
| **Systemic** | Interpretazione sistematica | Graph(relazioni) | modifica, deroga |
| **Principles** | Interpretazione teleologica | Qdrant(ratio,spieg) | commenta, bilancia |
| **Precedent** | Diritto vivente | Qdrant(massima) + Graph | interpreta, precedente_di |

---

## Obiettivo
Implementare **RQ5 (Expert Tools)** e **RQ6 (RLCF Multilivello)** come sistema integrato, con retrieval stratificato come infrastruttura sottostante.

---

## Fondamento Epistemologico: Art. 12 Preleggi

I 4 Expert corrispondono ai **canoni interpretativi del diritto italiano** (Art. 12 Preleggi, Codice Civile):

```
GERARCHIA INTERPRETATIVA (subsidiaria)
═══════════════════════════════════════
1. LETTERALE    → "significato proprio delle parole"
       ↓ (se insufficiente)
2. LOGICA       → "intenzione del legislatore"
       ↓ (se insufficiente)
3. SISTEMATICA  → "connessione" tra le norme
       ↓ (se lacuna)
4. ANALOGICA    → "casi simili" e "principi generali"
```

**Principio fondamentale**: "In claris non fit interpretatio" - si passa al livello successivo solo se quello precedente è insufficiente.

---

## Mapping Expert ↔ Canone Interpretativo ↔ Scuola Giuridica

| Expert | Canone Art. 12 | Scuola Giuridica | Epistemologia |
|--------|----------------|------------------|---------------|
| **LiteralExpert** | Interpretazione letterale | Positivismo (Kelsen, Del Vecchio) | Verba legis, lex scripta |
| **SystemicExpert** | Interpretazione sistematica | Finalismo (Ascarelli) | Collocazione nel sistema |
| **PrinciplesExpert** | Interpretazione teleologica | Costituzionalismo (Mortati) | Ratio legis, valori |
| **PrecedentExpert** | Diritto vivente | Empirismo giuridico | Prassi consolidata |

---

## Struttura Codificata Civil Law (Exploitable)

```
GERARCHIA CODICE (Tree Structure)
═════════════════════════════════
CODICE
  └── LIBRO (es. "Delle obbligazioni")
        └── TITOLO (es. "Dei contratti in generale")
              └── CAPO (es. "Dei requisiti del contratto")
                    └── SEZIONE (es. "Della forma del contratto")
                          └── ARTICOLO (es. "Art. 1350")
                                └── COMMA / NUMERO / LETTERA

GERARCHIA FONTI
═══════════════
Costituzione > Leggi Ordinarie > Regolamenti > Consuetudine
        ↓
    lex superior derogat inferiori
    lex specialis derogat generali
    lex posterior derogat priori
```

---

## Mapping Expert ↔ Source Types ↔ Tools

### 1. LiteralExpert - Interpretazione Letterale

**Fondamento**: "In claris non fit interpretatio" - Il significato proprio delle parole secondo la connessione di esse.

| Tool | Operazione | Fondamento Epistemologico | Source/Storage |
|------|-----------|---------------------------|----------------|
| `get_exact_text(urn)` | Recupera testo integrale norma | Lettera della legge (verba legis) | Qdrant: `source_type=norma` |
| `get_definitions(term)` | Trova definizioni legali codificate | Definizioni legislative esplicite | Graph: nodi con `tipo=definizione` |
| `parse_commi(article)` | Struttura in commi/numeri/lettere | Analisi sintattica del disposto | Pipeline: CommaParser |
| `follow_rinvii(urn)` | Segue rinvii espliciti (art. X) | Connessione testuale diretta | Graph: relazioni `RINVIA_A` |

**theta_traverse** (pesi relazioni grafo):
```python
theta_traverse_literal = {
    "contiene": 1.0,     # struttura gerarchica Norma→Comma (ESISTENTE)
    # Relazioni da aggiungere in futuro:
    # "definisce": 0.95,   # definizioni esplicite
    # "rinvia_a": 0.90,    # rinvii espliciti
}
```

### 2. SystemicExpert - Interpretazione Sistematica

**Fondamento**: Art. 12 comma 1 - "connessione" tra le norme. La norma va letta nel contesto del sistema.

| Tool | Operazione | Fondamento Epistemologico | Source/Storage |
|------|-----------|---------------------------|----------------|
| `get_system_context(urn)` | Posizione nella gerarchia Libro→Titolo→Capo→Sezione | Collocazione sistematica | Graph: `contiene` (Norma→Norma) |
| `find_related_norms(urn)` | Norme collegate per materia | Interpretazione per contesto | Graph: traversal `contiene` |
| `get_legislative_history(urn)` | Storia delle modifiche | Evoluzione sistematica | Graph: (da implementare) |
| `get_rubrica_context(urn)` | Titoli e rubriche dei contenitori | Rubrica legis non est lex, sed orientat | Graph: attributi nodo Norma |

**theta_traverse**:
```python
theta_traverse_systemic = {
    "contiene": 0.95,     # gerarchia Norma→Norma (ESISTENTE: 1003)
    # Relazioni da aggiungere in futuro:
    # "modifica": 0.90,     # storia legislativa
    # "deroga": 0.95,       # lex specialis
}
```

### 3. PrinciplesExpert - Interpretazione Teleologica/Costituzionale

**Fondamento**: Art. 12 comma 2 - "principi generali dell'ordinamento". La ratio legis e i valori costituzionali.

| Tool | Operazione | Fondamento Epistemologico | Source/Storage |
|------|-----------|---------------------------|----------------|
| `get_ratio_legis(urn)` | Recupera ratio/scopo della norma | Intenzione del legislatore | Qdrant: `source_type=ratio` (877 vettori) |
| `get_spiegazione(urn)` | Dottrina e spiegazioni | Interpretazione dottrinale | Qdrant: `source_type=spiegazione` (751 vettori) |
| `get_dottrina(urn)` | Recupera nodi Dottrina collegati | Commento dottrinale | Graph: `commenta` (ESISTENTE: 2609) |
| `check_principle_conflicts(urn)` | Conflitti tra principi | Bilanciamento valori | Graph: (da implementare) |

**theta_traverse**:
```python
theta_traverse_principles = {
    "commenta": 1.0,         # Dottrina→Norma (ESISTENTE: 2609)
    # Relazioni da aggiungere in futuro:
    # "bilancia": 0.95,      # bilanciamento principi
    # "attua_principio": 0.90, # attuazione costituzionale
}
```

### 4. PrecedentExpert - Interpretazione Giurisprudenziale

**Fondamento**: La giurisprudenza come "diritto vivente" - interpretazione consolidata nella prassi.

| Tool | Operazione | Fondamento Epistemologico | Source/Storage |
|------|-----------|---------------------------|----------------|
| `search_massime(query)` | Cerca massime giurisprudenziali | Giurisprudenza consolidata | Qdrant: `source_type=massima` (2815 vettori) |
| `get_atti_giudiziari(urn)` | Recupera nodi AttoGiudiziario | Sentenze che interpretano | Graph: `interpreta` (ESISTENTE: 11223) |
| `get_citation_chain(urn)` | Catena citazionale | Evoluzione interpretativa | Graph: (da implementare) |
| `find_conformi_difformi(massima)` | Precedenti conformi/difformi | Consolidamento vs. contrasto | Graph: (da implementare) |

**theta_traverse**:
```python
theta_traverse_precedent = {
    "interpreta": 1.0,   # AttoGiudiziario→Norma (ESISTENTE: 11223)
    # Relazioni da aggiungere in futuro:
    # "conferma": 0.95,  # precedente conforme
    # "overrules": 0.95, # revirement
}
```

---

## Stato Attuale del Grafo (Verificato)

```
NODI ESISTENTI
══════════════
Norma:           1,004 nodi (articoli Libro IV CC)
Comma:           2,546 nodi (commi degli articoli)
Dottrina:        2,609 nodi (spiegazioni Brocardi)
AttoGiudiziario: 9,827 nodi (massime giurisprudenziali)
─────────────────────────────
TOTALE:         15,986 nodi

RELAZIONI ESISTENTI
═══════════════════
interpreta:  AttoGiudiziario → Norma   11,223 (per PrecedentExpert)
commenta:    Dottrina → Norma           2,609 (per PrinciplesExpert)
contiene:    Norma → Comma              2,546 (per LiteralExpert)
contiene:    Norma → Norma              1,003 (per SystemicExpert)
─────────────────────────────────────────────
TOTALE:                                17,381 relazioni

VETTORI QDRANT (exp_libro_iv_cc)
════════════════════════════════
source_type=norma:       887 (per LiteralExpert)
source_type=spiegazione: 751 (per PrinciplesExpert)
source_type=ratio:       877 (per PrinciplesExpert)
source_type=massima:   2,815 (per PrecedentExpert)
─────────────────────────────────────────────
TOTALE:                5,330 vettori

PROPERTIES DEI NODI (utili per tools)
═════════════════════════════════════
Norma:
  - URN, node_id, url, tipo_documento
  - titolo, autorita_emanante
  - vigenza, efficacia, ambito_territoriale
  - fonte, created_at

Comma:
  - URN, node_id, numero, testo, token_count

AttoGiudiziario:
  - node_id, estremi, organo_emittente
  - numero_sentenza, anno, massima
  - tipo_atto, fonte, confidence

Dottrina:
  - node_id, titolo, descrizione
  - tipo_dottrina, fonte, autore, confidence

BRIDGE TABLE (PostgreSQL: 14,965 mappings)
══════════════════════════════════════════
Struttura:
  - chunk_id (UUID) ↔ graph_node_urn (VARCHAR)
  - node_type, relation_type, confidence
  - source, metadata (JSONB), weight (apprendibile)

Mapping esistenti:
  - part_of:      10,709 (chunk appartiene a norma)
  - contained_in:  4,256 (chunk contenuto in sezione)
```

---

## Schema KG Completo (da docs/archive/02-methodology/knowledge-graph.md)

Lo schema target prevede **23 tipi di nodo** e **65 tipologie di relazioni** in 11 categorie semantiche (LKIF-compliant).

### Relazioni Implementate (nel grafo attuale)
| Relazione | Direzione | Count | Expert |
|-----------|-----------|-------|--------|
| `interpreta` | AttoGiudiziario → Norma | 11,223 | PrecedentExpert |
| `commenta` | Dottrina → Norma | 2,609 | PrinciplesExpert |
| `contiene` | Norma → Comma | 2,546 | LiteralExpert |
| `contiene` | Norma → Norma | 1,003 | SystemicExpert |

### Schema Completo 65 Relazioni per Categoria

#### §3.2 Structural Relations (5)
| # | Relazione | Sorgente → Target | Expert Primario |
|---|-----------|-------------------|-----------------|
| 1 | `contiene` | Norma → Comma | LiteralExpert |
| 2 | `parte_di` | Comma → Norma | LiteralExpert |
| 3 | `versione_precedente` | Versione → Versione | SystemicExpert |
| 4 | `versione_successiva` | Versione → Versione | SystemicExpert |
| 5 | `ha_versione` | Norma → Versione | SystemicExpert |

#### §3.3 Modification Relations (9)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 6 | `sostituisce` | Sostituzione testo | SystemicExpert |
| 7 | `inserisce` | Aggiunta contenuto | SystemicExpert |
| 8 | `abroga_totalmente` | Abrogazione totale | SystemicExpert |
| 9 | `abroga_parzialmente` | Abrogazione parziale | SystemicExpert |
| 10 | `sospende` | Sospensione temporanea | SystemicExpert |
| 11 | `proroga` | Estensione termine | SystemicExpert |
| 12 | `integra` | Integrazione | SystemicExpert |
| 13 | `deroga_a` | Deroga (lex specialis) | SystemicExpert |
| 14 | `consolida` | Testo unico | SystemicExpert |

#### §3.4 Semantic Relations (6)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 15 | `disciplina` | Norma governa Concetto | PrinciplesExpert |
| 16 | `applica_a` | Norma si applica a Soggetto | LiteralExpert |
| 17 | `definisce` | Norma definisce termine | LiteralExpert |
| 18 | `prevede_sanzione` | Norma prevede Sanzione | LiteralExpert |
| 19 | `stabilisce_termine` | Norma stabilisce Termine | LiteralExpert |
| 20 | `prevede` | Norma prevede Procedura | SystemicExpert |

#### §3.5 Dependency Relations (3)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 21 | `dipende_da` | Dipendenza logica | SystemicExpert |
| 22 | `presuppone` | Prerequisito implicito | PrinciplesExpert |
| 23 | `species` | Gerarchia is-a | PrinciplesExpert |

#### §3.6 Citation & Interpretation Relations (3)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 24 | `cita` | Citazione esplicita | LiteralExpert |
| 25 | `interpreta` | Interpretazione giudiziaria | PrecedentExpert |
| 26 | `commenta` | Commento dottrinale | PrinciplesExpert |

#### §3.7 EU/International Relations (3)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 27 | `attua` | Attuazione direttiva UE | SystemicExpert |
| 28 | `recepisce` | Recepimento | SystemicExpert |
| 29 | `conforme_a` | Conformità | SystemicExpert |

#### §3.8 Institutional Relations (3)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 30 | `emesso_da` | Atto emesso da Organo | PrecedentExpert |
| 31 | `ha_competenza_su` | Competenza territoriale | SystemicExpert |
| 32 | `gerarchicamente_superiore` | Gerarchia organi | SystemicExpert |

#### §3.9 Case-based Relations (3)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 33 | `riguarda` | Atto riguarda soggetto/caso | PrecedentExpert |
| 34 | `applica_norma_a_caso` | Applicazione a caso | PrecedentExpert |
| 35 | `precedente_di` | Precedente giurisprudenziale | PrecedentExpert |

#### §3.10 Classification Relations (2)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 36 | `fonte` | Norma appartiene a fonte | LiteralExpert |
| 37 | `classifica_in` | Classificazione EuroVoc | Tutti |

#### §3.11 LKIF-Aligned Modality Relations (28)
| # | Relazione | Significato | Expert Primario |
|---|-----------|-------------|-----------------|
| 38 | `impone` | Norma impone obbligo/divieto | LiteralExpert |
| 39 | `conferisce` | Norma conferisce potere/diritto | LiteralExpert |
| 40 | `titolare_di` | Soggetto titolare di diritto | PrinciplesExpert |
| 41 | `riveste_ruolo` | Soggetto assume ruolo | PrecedentExpert |
| 42 | `attribuisce_responsabilita` | Attribuzione responsabilità | PrecedentExpert |
| 43 | `responsabile_per` | Soggetto responsabile | PrecedentExpert |
| 44 | `esprime_principio` | Norma esprime principio | PrinciplesExpert |
| 45 | `conforma_a` | Conformità a principio | PrinciplesExpert |
| 46 | `deroga_principio` | Deroga a principio | PrinciplesExpert |
| 47 | `bilancia_con` | Bilanciamento principi | PrinciplesExpert |
| 48 | `produce_effetto` | Fatto produce effetto | PrinciplesExpert |
| 49 | `presupposto_di` | Fatto prerequisito | PrinciplesExpert |
| 50 | `costitutivo_di` | Fatto costitutivo | PrinciplesExpert |
| 51 | `estingue` | Fatto estingue diritto | PrinciplesExpert |
| 52 | `modifica_efficacia` | Fatto modifica efficacia | PrinciplesExpert |
| 53 | `applica_regola` | Atto applica regola | PrecedentExpert |
| 54 | `implica` | Implicazione logica | PrinciplesExpert |
| 55 | `contradice` | Contraddizione | SystemicExpert |
| 56 | `giustifica` | Giustificazione | PrinciplesExpert |
| 57 | `limita` | Limitazione diritto | PrinciplesExpert |
| 58 | `tutela` | Norma tutela diritto | PrinciplesExpert |
| 59 | `viola` | Fatto viola norma | PrecedentExpert |
| 60 | `compatibile_con` | Compatibilità | SystemicExpert |
| 61 | `incompatibile_con` | Incompatibilità | SystemicExpert |
| 62 | `specifica` | Specificazione | SystemicExpert |
| 63 | `esemplifica` | Esemplificazione | PrecedentExpert |
| 64 | `causa_di` | Causalità | PrecedentExpert |
| 65 | `condizione_di` | Condizione | PrinciplesExpert |

### Distribuzione Relazioni per Expert

| Expert | Relazioni Primarie | Count |
|--------|-------------------|-------|
| **LiteralExpert** | 1-2, 16-19, 24, 36, 38-39 | 11 |
| **SystemicExpert** | 3-14, 20-21, 27-29, 31-32, 55, 60-62 | 22 |
| **PrinciplesExpert** | 15, 22-23, 26, 40, 44-52, 54, 56-58, 65 | 19 |
| **PrecedentExpert** | 25, 30, 33-35, 41-43, 53, 59, 63-64 | 13 |

---

## theta_traverse Completo (Schema 65 Relazioni)

```python
# Pesi per traversal grafo - basati su schema KG completo

theta_traverse_literal = {
    # ===== IMPLEMENTATE =====
    "contiene": 1.0,           # §3.2.1 Norma→Comma (struttura articolo)

    # ===== DA IMPLEMENTARE =====
    # Structural
    "parte_di": 0.90,          # §3.2.2 inverso di contiene

    # Semantic
    "applica_a": 0.85,         # §3.4.16 Norma si applica a Soggetto
    "definisce": 0.95,         # §3.4.17 definizioni legali
    "prevede_sanzione": 0.90,  # §3.4.18 sanzioni
    "stabilisce_termine": 0.85,# §3.4.19 termini

    # Citation
    "cita": 0.90,              # §3.6.24 citazione esplicita

    # Classification
    "fonte": 0.80,             # §3.10.36 fonte del diritto

    # LKIF Modality
    "impone": 0.95,            # §3.11.38 obblighi/divieti
    "conferisce": 0.90,        # §3.11.39 poteri/diritti
}

theta_traverse_systemic = {
    # ===== IMPLEMENTATE =====
    "contiene": 0.95,          # §3.2.1 Norma→Norma (gerarchia)

    # ===== DA IMPLEMENTARE =====
    # Versioning
    "versione_precedente": 0.90, # §3.2.3
    "versione_successiva": 0.90, # §3.2.4
    "ha_versione": 0.85,         # §3.2.5

    # Modification (cruciali per interpretazione sistematica)
    "sostituisce": 0.95,       # §3.3.6
    "inserisce": 0.90,         # §3.3.7
    "abroga_totalmente": 1.0,  # §3.3.8 (massima rilevanza)
    "abroga_parzialmente": 0.95, # §3.3.9
    "sospende": 0.85,          # §3.3.10
    "proroga": 0.80,           # §3.3.11
    "integra": 0.85,           # §3.3.12
    "deroga_a": 0.95,          # §3.3.13 lex specialis
    "consolida": 0.90,         # §3.3.14

    # Semantic
    "prevede": 0.80,           # §3.4.20 Norma→Procedura

    # Dependency
    "dipende_da": 0.90,        # §3.5.21 dipendenza logica

    # EU/International
    "attua": 0.85,             # §3.7.27 attuazione direttiva
    "recepisce": 0.85,         # §3.7.28
    "conforme_a": 0.80,        # §3.7.29

    # Institutional
    "ha_competenza_su": 0.75,  # §3.8.31
    "gerarchicamente_superiore": 0.90, # §3.8.32

    # LKIF
    "contradice": 0.95,        # §3.11.55 antinomie
    "compatibile_con": 0.80,   # §3.11.60
    "incompatibile_con": 0.90, # §3.11.61 conflitti
    "specifica": 0.85,         # §3.11.62
}

theta_traverse_principles = {
    # ===== IMPLEMENTATE =====
    "commenta": 1.0,           # §3.6.26 Dottrina→Norma

    # ===== DA IMPLEMENTARE =====
    # Semantic
    "disciplina": 0.95,        # §3.4.15 Norma→Concetto

    # Dependency
    "presuppone": 0.85,        # §3.5.22 prerequisito implicito
    "species": 0.80,           # §3.5.23 gerarchia concettuale

    # LKIF Modality (principi e effetti)
    "titolare_di": 0.85,       # §3.11.40
    "esprime_principio": 1.0,  # §3.11.44 (centrale per principles)
    "conforma_a": 0.90,        # §3.11.45
    "deroga_principio": 0.95,  # §3.11.46
    "bilancia_con": 1.0,       # §3.11.47 (bilanciamento costituzionale)
    "produce_effetto": 0.85,   # §3.11.48
    "presupposto_di": 0.85,    # §3.11.49
    "costitutivo_di": 0.90,    # §3.11.50
    "estingue": 0.85,          # §3.11.51
    "modifica_efficacia": 0.80, # §3.11.52
    "implica": 0.90,           # §3.11.54 implicazione logica
    "giustifica": 0.95,        # §3.11.56 giustificazione
    "limita": 0.90,            # §3.11.57 limitazione diritti
    "tutela": 0.95,            # §3.11.58 tutela diritti
    "condizione_di": 0.80,     # §3.11.65
}

theta_traverse_precedent = {
    # ===== IMPLEMENTATE =====
    "interpreta": 1.0,         # §3.6.25 AttoGiudiziario→Norma

    # ===== DA IMPLEMENTARE =====
    # Institutional
    "emesso_da": 0.75,         # §3.8.30 Atto→Organo

    # Case-based
    "riguarda": 0.80,          # §3.9.33 Atto→Caso/Soggetto
    "applica_norma_a_caso": 0.95, # §3.9.34
    "precedente_di": 1.0,      # §3.9.35 (stare decisis)

    # LKIF
    "riveste_ruolo": 0.80,     # §3.11.41
    "attribuisce_responsabilita": 0.90, # §3.11.42
    "responsabile_per": 0.85,  # §3.11.43
    "applica_regola": 0.90,    # §3.11.53
    "viola": 0.95,             # §3.11.59 violazione
    "esemplifica": 0.85,       # §3.11.63
    "causa_di": 0.90,          # §3.11.64 causalità
}
```

### Note sui Pesi
- **1.0**: Relazioni fondamentali per l'expert (massima rilevanza)
- **0.95**: Relazioni molto rilevanti
- **0.90**: Relazioni rilevanti
- **0.85**: Relazioni moderatamente rilevanti
- **0.80**: Relazioni utili ma non centrali
- **0.75**: Relazioni accessorie

---

## Architettura Integrata

```
Query
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│                    GATING NETWORK                            │
│              theta_gating (apprendibile)                     │
│    Output: [w_literal, w_systemic, w_principles, w_precedent]│
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐─────────────────┐
         ▼                 ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
   │ LITERAL  │     │ SYSTEMIC │     │PRINCIPLES│     │PRECEDENT │
   │  Expert  │     │  Expert  │     │  Expert  │     │  Expert  │
   │ + tools  │     │ + tools  │     │ + tools  │     │ + tools  │
   │ θ_trav_L │     │ θ_trav_S │     │ θ_trav_P │     │ θ_trav_R │
   └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
        │                │                │                │
        ▼                ▼                ▼                ▼
   ┌────────────────────────────────────────────────────────────┐
   │              STRATIFIED RETRIEVER (Infrastruttura)          │
   │  _search_by_source(source_type, theta_traverse)            │
   │                                                             │
   │  ┌─────────┐    ┌─────────┐    ┌─────────┐                │
   │  │  norma  │    │spiegaz. │    │ massima │                │
   │  │  filter │    │+ ratio  │    │ filter  │                │
   │  └─────────┘    └─────────┘    └─────────┘                │
   └─────────────────────────┬──────────────────────────────────┘
                             │
   ┌─────────────────────────▼──────────────────────────────────┐
   │                QDRANT + BRIDGE + FALKORDB                   │
   │                      Storage Layer                          │
   └────────────────────────────────────────────────────────────┘
```

---

## Fonti Dati: Architettura Teorica

### Principio Fondamentale

```
┌─────────────────────────────────────────────────────────────────┐
│                         FONTI API                                │
│         (Dati ufficiali, aggiornati, autoritativi)              │
├─────────────────────────────────────────────────────────────────┤
│  NORME         → VisualEx (Normattiva API)                      │
│  ENRICHMENT    → VisualEx (Brocardi integrato) [supporto veloce]│
│  SENTENZE      → [FUTURO: API ufficiale quando disponibile]     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         GRAFO (KG)                               │
│         (Relazioni, struttura, dottrina autorevole)             │
├─────────────────────────────────────────────────────────────────┤
│  RELAZIONI     → Struttura normativa, modifiche, citazioni      │
│  DOTTRINA      → Manuali universitari, commentari autorevoli    │
│  SENTENZE      → AttoGiudiziario (unica fonte attuale)          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      QDRANT (Embeddings)                         │
│         (Ricerca semantica per source_type)                     │
├─────────────────────────────────────────────────────────────────┤
│  norma         → Testi normativi (887)                          │
│  spiegazione   → Dottrina/spiegazioni (751)                     │
│  ratio         → Ratio legis (877)                              │
│  massima       → Massime giurisprudenziali (2,815)              │
└─────────────────────────────────────────────────────────────────┘
```

### Mapping Fonti per Expert

| Expert | Testo Normativo | Relazioni | Dottrina/Enrichment |
|--------|----------------|-----------|---------------------|
| **LiteralExpert** | VisualEx API | Grafo | - |
| **SystemicExpert** | VisualEx API | Grafo | - |
| **PrinciplesExpert** | VisualEx API | Grafo | Grafo (Dottrina) + Qdrant |
| **PrecedentExpert** | - | Grafo | Grafo (AttoGiudiziario) + Qdrant |

### Stato Attuale vs Futuro

**Ora (con dati disponibili)**:
- Norme: VisualEx API (Normattiva)
- Enrichment veloce: VisualEx API (Brocardi integrato)
- Sentenze/Massime: Grafo + Qdrant (unica fonte)
- Dottrina: Grafo (da Brocardi, per convenienza)

**Futuro (architettura target)**:
- Dottrina: Grafo con manuali universitari autorevoli
- Sentenze: API ufficiale quando disponibile
- Brocardi: Solo supporto veloce via API

---

## Tools che Sfruttano API + Grafo + Bridge

### LiteralExpert Tools (dettaglio implementativo)

```python
class GetExactTextTool:
    """
    Recupera il testo esatto di una norma da FONTE UFFICIALE.

    Sfrutta:
    - VisualEx API: testo ufficiale Normattiva (FONTE PRIMARIA)
    - Graph: solo per relazioni e metadata
    - Bridge Table: per collegare a chunks Qdrant
    """
    async def execute(self, urn: str) -> NormaText:
        # 1. FONTE PRIMARIA: API Normattiva via VisualEx
        from merlt.external_sources.visualex import NormattivaScraper

        scraper = NormattivaScraper()
        norma_ufficiale = await scraper.fetch_by_urn(urn)

        # 2. Arricchimento dal grafo (solo metadata/relazioni)
        graph_metadata = await graph.query(f"""
            MATCH (n:Norma {{URN: '{urn}'}})
            RETURN n.titolo, n.vigenza, n.efficacia
        """)

        # 3. Bridge Table per chunks correlati (per RAG)
        chunks = await bridge.get_chunks_for_node(urn)

        return NormaText(
            urn=urn,
            testo_ufficiale=norma_ufficiale.testo,  # DA API
            titolo=graph_metadata.titolo,
            vigenza=norma_ufficiale.vigenza,  # DA API (più aggiornato)
            related_chunks=chunks
        )

class ParseCommiTool:
    """
    Analizza la struttura sintattica di un articolo.

    Sfrutta:
    - VisualEx API: testo ufficiale con parsing strutturale
    - Graph: solo come fallback o per metadata aggiuntivi
    """
    async def execute(self, urn: str) -> StructuredArticle:
        # FONTE PRIMARIA: API con parsing strutturale
        from merlt.external_sources.visualex import NormattivaScraper
        from merlt.pipeline.parsing import CommaParser

        scraper = NormattivaScraper()
        norma = await scraper.fetch_by_urn(urn)

        # Parsing strutturale del testo ufficiale
        parser = CommaParser()
        commi = parser.parse(norma.testo)

        return StructuredArticle(
            urn=urn,
            commi=commi,
            fonte="normattiva_api"  # Tracciabilità fonte
        )
```

### SystemicExpert Tools (dettaglio implementativo)

```python
class GetSystemContextTool:
    """
    Recupera la posizione sistematica di una norma.

    Sfrutta:
    - VisualEx API: gerarchia ufficiale (Libro→Titolo→Capo→Sezione)
    - Graph: per relazioni tra norme (modifica, abroga, etc.)
    """
    async def execute(self, urn: str) -> SystemContext:
        # 1. FONTE PRIMARIA: Gerarchia da API
        from merlt.external_sources.visualex.tools import TreeExtractor

        extractor = TreeExtractor()
        hierarchy = await extractor.get_hierarchy(urn)

        # 2. Arricchimento da grafo: relazioni sistemiche
        relations = await graph.query(f"""
            MATCH (n:Norma {{URN: '{urn}'}})-[r]->(related:Norma)
            WHERE type(r) IN ['modifica', 'abroga', 'deroga_a', 'sostituisce']
            RETURN type(r) as rel_type, related.URN, related.titolo
        """)

        return SystemContext(
            hierarchy=hierarchy,           # DA API
            systematic_relations=relations, # DA GRAFO
            position_info=self._describe_position(hierarchy)
        )

class GetLegislativeHistoryTool:
    """
    Recupera la storia legislativa di una norma.

    Sfrutta:
    - VisualEx API: multivigenza (versioni temporali)
    - Graph: relazioni di modifica
    """
    async def execute(self, urn: str) -> LegislativeHistory:
        # 1. FONTE PRIMARIA: Versioni da API
        from merlt.external_sources.visualex import NormattivaScraper

        scraper = NormattivaScraper()
        versions = await scraper.fetch_all_versions(urn)

        # 2. Arricchimento: atti modificanti dal grafo
        modifying_acts = await graph.query(f"""
            MATCH (modifier:Norma)-[r:modifica|sostituisce|abroga_parzialmente]->(n:Norma {{URN: '{urn}'}})
            RETURN modifier.URN, modifier.titolo, type(r) as tipo_modifica
            ORDER BY modifier.data_pubblicazione DESC
        """)

        return LegislativeHistory(
            versions=versions,           # DA API
            modifying_acts=modifying_acts # DA GRAFO
        )
```

### PrinciplesExpert Tools (dettaglio implementativo)

```python
class GetRatioLegisTool:
    """
    Recupera la ratio legis di una norma.

    Sfrutta:
    - Qdrant: search con source_type=ratio
    - Bridge Table: per collegare ratio al nodo Norma
    """
    async def execute(self, urn: str, query: str = None) -> RatioResult:
        # 1. Cerca embedding della ratio
        if query:
            embedding = await embed(query)
            results = await qdrant.search(
                embedding,
                filter={"source_type": "ratio"},
                limit=5
            )
        else:
            # Usa bridge per trovare ratio collegate al nodo
            chunk_ids = await bridge.get_chunks_for_node(
                urn, relation_type="part_of"
            )
            results = await qdrant.get_by_ids(chunk_ids)

        return RatioResult(rationes=results)

class GetDottrinaTool:
    """
    Recupera commenti dottrinali su una norma.

    Sfrutta:
    - Graph Relations: commenta (Dottrina→Norma)
    - Graph Properties: Dottrina.titolo, descrizione, autore
    - Qdrant: search con source_type=spiegazione
    """
    async def execute(self, urn: str) -> DottrinaResult:
        # 1. Dal grafo
        dottrina_nodes = await graph.query(f"""
            MATCH (d:Dottrina)-[:commenta]->(n:Norma {{URN: '{urn}'}})
            RETURN d.node_id, d.titolo, d.descrizione, d.autore, d.confidence
            ORDER BY d.confidence DESC
        """)

        # 2. Da Qdrant (spiegazioni)
        spiegazioni = await qdrant.search_with_filter(
            filter={"source_type": "spiegazione", "article_urn": urn}
        )

        return DottrinaResult(
            graph_dottrina=dottrina_nodes,
            vector_spiegazioni=spiegazioni
        )
```

### PrecedentExpert Tools (dettaglio implementativo)

```python
class SearchMassimeTool:
    """
    Cerca massime giurisprudenziali.

    Sfrutta:
    - Qdrant: search con source_type=massima
    - Graph Properties: AttoGiudiziario.organo_emittente, anno
    """
    async def execute(self, query: str, filters: dict = None) -> MassimeResult:
        embedding = await embed(query)

        qdrant_filter = {"source_type": "massima"}
        if filters:
            if filters.get("organo"):
                qdrant_filter["organo_emittente"] = filters["organo"]
            if filters.get("anno_min"):
                qdrant_filter["anno"] = {"$gte": filters["anno_min"]}

        results = await qdrant.search(embedding, filter=qdrant_filter, limit=10)

        return MassimeResult(massime=results)

class GetAttiGiudiziariTool:
    """
    Recupera atti giudiziari che interpretano una norma.

    Sfrutta:
    - Graph Relations: interpreta (AttoGiudiziario→Norma)
    - Graph Properties: AttoGiudiziario.estremi, organo_emittente, anno, massima
    """
    async def execute(self, urn: str, limit: int = 10) -> AttiResult:
        result = await graph.query(f"""
            MATCH (a:AttoGiudiziario)-[:interpreta]->(n:Norma {{URN: '{urn}'}})
            RETURN a.node_id, a.estremi, a.organo_emittente,
                   a.anno, a.massima, a.confidence
            ORDER BY a.confidence DESC, a.anno DESC
            LIMIT {limit}
        """)

        return AttiResult(
            atti=result,
            count=len(result),
            interpretation_summary=self._summarize(result)
        )
```

---

## Orchestrazione: Come gli Expert Usano i Tools

### Flow di Esecuzione

```
                              QUERY
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         GATING NETWORK                               │
│                      θ_gating (apprendibile)                         │
│                                                                      │
│   Input: query_embedding                                             │
│   Output: [w_literal, w_systemic, w_principles, w_precedent]        │
│                                                                      │
│   RLCF Layer: REASONING (quale expert attivare?)                    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ LiteralExpert│      │ SystemicExpert│      │PrecedentExpert│
│              │      │              │      │              │
│  Tools:      │      │  Tools:      │      │  Tools:      │
│  - GetText   │      │  - GetContext│      │  - SearchMassime
│  - ParseCommi│      │  - GetHistory│      │  - GetAtti    │
│  - FollowCita│      │  - GetRubrica│      │  - GetChain   │
│              │      │              │      │              │
│ θ_traverse_L │      │ θ_traverse_S │      │ θ_traverse_P │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                     │
       │    RLCF Layer: RETRIEVAL                  │
       │    (tools corretti? relazioni giuste?)    │
       ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    STRATIFIED RETRIEVER                              │
│                                                                      │
│   Ogni Expert chiama:                                                │
│   retriever.search_by_source(                                        │
│       query_embedding,                                               │
│       source_types=[...],      # Filtra per tipo                    │
│       traversal_weights={...}, # θ_traverse dell'expert             │
│   )                                                                  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AGGREGATION + RERANKING                           │
│                      θ_rerank (apprendibile)                         │
│                                                                      │
│   - Combina risultati dei 4 Expert                                   │
│   - Pesa con gating weights                                          │
│   - Rerank finale                                                    │
│                                                                      │
│   RLCF Layer: SYNTHESIS (ranking corretto? risposta giusta?)        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
                           RESPONSE
```

### Pseudo-codice Orchestrazione

```python
class ExpertOrchestrator:
    """
    Coordina gli Expert autonomi con i loro tools.
    """

    def __init__(
        self,
        experts: Dict[str, ExpertWithTools],
        gating_network: GatingNetwork,
        retriever: StratifiedRetriever,
        reranker: LearnedReranker,
    ):
        self.experts = experts
        self.gating = gating_network
        self.retriever = retriever
        self.reranker = reranker

    async def process_query(self, query: str) -> ExpertResponse:
        # 1. Embed query
        query_embedding = await self.embed(query)

        # 2. GATING: Decide pesi Expert (θ_gating)
        expert_weights = self.gating.forward(query_embedding)
        # → [0.3, 0.2, 0.1, 0.4] per [literal, systemic, principles, precedent]

        # 3. Ogni Expert esegue i suoi Tools in parallelo
        expert_results = await asyncio.gather(*[
            expert.analyze(query, query_embedding)
            for expert in self.experts.values()
        ])

        # 4. Ogni Expert.analyze() internamente:
        #    - Chiama i suoi tools (GetExactText, SearchMassime, etc.)
        #    - Ogni tool usa retriever.search_by_source() con θ_traverse
        #    - Ritorna ExpertOpinion con sources + interpretation

        # 5. AGGREGATION: Combina con pesi gating
        aggregated = self._aggregate(expert_results, expert_weights)

        # 6. RERANKING: Ordina risultati finali (θ_rerank)
        final_ranking = self.reranker.rerank(aggregated, query_embedding)

        return ExpertResponse(
            results=final_ranking,
            expert_opinions={
                name: result.opinion
                for name, result in zip(self.experts.keys(), expert_results)
            },
            gating_weights=expert_weights,
            trace=self._build_trace()  # Per RLCF
        )
```

### Expert.analyze() Internals

```python
class LiteralExpert(ExpertWithTools):
    """
    Expert per interpretazione letterale.
    Usa VisualEx API per testi ufficiali.
    """

    async def analyze(
        self,
        query: str,
        query_embedding: List[float]
    ) -> ExpertOpinion:

        # Tool 1: Cerca norme rilevanti
        norms = await self.tools['search_norms'].execute(
            query_embedding,
            source_type='norma',
            traversal_weights=self.theta_traverse  # Pesi appresi
        )

        # Tool 2: Per ogni norma, recupera testo ufficiale
        full_texts = []
        for norm in norms[:3]:  # Top 3
            text = await self.tools['get_exact_text'].execute(norm.urn)
            full_texts.append(text)

        # Tool 3: Analizza struttura (commi)
        structures = [
            await self.tools['parse_commi'].execute(norm.urn)
            for norm in norms[:3]
        ]

        # Costruisci opinione
        return ExpertOpinion(
            expert_type='literal',
            sources=norms,
            full_texts=full_texts,
            interpretation=self._interpret(full_texts, structures),
            confidence=self._compute_confidence(norms)
        )
```

---

## RLCF: I Tre Layer di Feedback

### Mapping Layer → Parametri → Feedback

| Layer | Parametri Apprendibili | Feedback Raccolto | Reward Signal |
|-------|----------------------|-------------------|---------------|
| **RETRIEVAL** | θ_traverse (per Expert) | sources_relevant, sources_complete, relations_useful | R_retrieval |
| **REASONING** | θ_gating | literal_correct, systemic_correct, best_expert | R_reasoning |
| **SYNTHESIS** | θ_rerank | final_correct, disagreement_shown, ranking_correct | R_synthesis |

### Dettaglio Layer

#### Layer 1: RETRIEVAL (θ_traverse)

```
COSA MISURA: Gli Expert hanno trovato le fonti giuste?

PARAMETRI:
- theta_traverse_literal = {"contiene": 1.0, "cita": 0.90, ...}
- theta_traverse_systemic = {"modifica": 0.90, "abroga": 1.0, ...}
- theta_traverse_principles = {"commenta": 1.0, "disciplina": 0.95, ...}
- theta_traverse_precedent = {"interpreta": 1.0, "precedente_di": 1.0, ...}

FEEDBACK:
- "Le fonti erano pertinenti?" → sources_relevant
- "Mancava qualcosa?" → sources_complete
- "Quali relazioni erano utili?" → relations_useful

AGGIORNAMENTO:
Se sources_relevant=True per LiteralExpert:
    theta_traverse_literal["contiene"] += learning_rate * authority
```

#### Layer 2: REASONING (θ_gating)

```
COSA MISURA: Abbiamo attivato gli Expert giusti?

PARAMETRI:
- gating_weights: MLP che mappa query → [w_L, w_S, w_P, w_R]

FEEDBACK:
- "Quale interpretazione era più corretta?" → best_expert
- "L'Expert X era corretto?" → {expert}_correct

AGGIORNAMENTO:
Se best_expert="precedent" ma gating dava peso basso:
    Aumenta w_precedent per query simili
```

#### Layer 3: SYNTHESIS (θ_rerank)

```
COSA MISURA: Il ranking finale era corretto?

PARAMETRI:
- reranker: MLP che prende (query, results) → scores

FEEDBACK:
- "La risposta finale è corretta?" → final_correct
- "Il ranking era giusto?" → sources_ranking (ordine corretto)
- "Il disaccordo era visibile?" → disagreement_shown

AGGIORNAMENTO:
Se final_correct=False ma retrieval era buono:
    Il problema è nel reranking → aggiorna θ_rerank
```

### Credit Assignment

```python
def compute_layer_rewards(feedback: MultilevelFeedback) -> Dict[str, float]:
    """
    Assegna reward a ogni layer in base al feedback.
    """
    rewards = {}

    # RETRIEVAL reward (30% del totale)
    retrieval = feedback.retrieval_feedback
    rewards['retrieval'] = 0.3 * (
        0.4 * float(retrieval.sources_relevant) +
        0.3 * float(retrieval.sources_complete) +
        0.3 * ranking_score(retrieval.sources_ranking)
    )

    # REASONING reward (40% del totale)
    reasoning = feedback.reasoning_feedback
    expert_correct = [
        reasoning.literal_correct,
        reasoning.systemic_correct,
        reasoning.principles_correct,
        reasoning.precedent_correct
    ]
    rewards['reasoning'] = 0.4 * (sum(expert_correct) / 4.0)

    # SYNTHESIS reward (30% del totale)
    synthesis = feedback.synthesis_feedback
    rewards['synthesis'] = 0.3 * (
        0.5 * float(synthesis.final_correct) +
        0.25 * float(synthesis.disagreement_shown) +
        0.25 * float(synthesis.confidence_appropriate)
    )

    return rewards


def update_parameters(
    rewards: Dict[str, float],
    trace: ExecutionTrace,
    authority: float
):
    """
    Aggiorna parametri usando policy gradient.
    """
    # θ_traverse ← gradient da R_retrieval
    for expert, expert_trace in trace.expert_traces.items():
        loss = -authority * rewards['retrieval'] * expert_trace.log_prob
        loss.backward()
        optimizer_traverse[expert].step()

    # θ_gating ← gradient da R_reasoning
    loss = -authority * rewards['reasoning'] * trace.gating_log_prob
    loss.backward()
    optimizer_gating.step()

    # θ_rerank ← gradient da R_retrieval + R_synthesis
    combined_reward = rewards['retrieval'] + rewards['synthesis']
    loss = -authority * combined_reward * trace.rerank_log_prob
    loss.backward()
    optimizer_rerank.step()
```

---

## Mappatura Feedback → Parametri Apprendibili (Dettaglio)

### Schema Completo di Propagazione

```
                           FEEDBACK UTENTE
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    PARSING FEEDBACK MULTILIVELLO                        │
│                                                                         │
│  Input: MultilevelFeedback                                              │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │  RETRIEVAL      │  │  REASONING      │  │  SYNTHESIS      │        │
│  │  - sources_rel. │  │  - literal_corr │  │  - final_corr   │        │
│  │  - sources_comp │  │  - systemic_corr│  │  - disagr_shown │        │
│  │  - ranking      │  │  - princ_corr   │  │  - conf_approp  │        │
│  │  - relations_us │  │  - prec_corr    │  │                 │        │
│  └────────┬────────┘  │  - best_expert  │  └────────┬────────┘        │
│           │           └────────┬────────┘           │                  │
└───────────┼────────────────────┼────────────────────┼──────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│   R_retrieval     │  │   R_reasoning     │  │   R_synthesis     │
│                   │  │                   │  │                   │
│  0.4*sources_rel  │  │  Σ(expert_corr)/4 │  │  0.5*final_corr   │
│ +0.3*sources_comp │  │                   │  │ +0.25*disagr      │
│ +0.3*rank_score   │  │                   │  │ +0.25*conf        │
└─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘
          │                      │                      │
          │ ×0.3                 │ ×0.4                 │ ×0.3
          │                      │                      │
          └──────────────────────┴──────────────────────┘
                                 │
                                 ▼
                           R_total = Σ
                                 │
                                 │  × A(user)  (Authority multilivello)
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    GRADIENT ROUTING PER PARAMETRO                       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        θ_traverse                                │   │
│  │                                                                  │   │
│  │  Gradient: -A(user, level=retrieval) × R_retrieval × ∇log π     │   │
│  │                                                                  │   │
│  │  Per ogni Expert E ∈ {literal, systemic, principles, precedent}: │   │
│  │    Per ogni relazione R usata durante retrieval:                 │   │
│  │      θ_traverse[E][R] += lr × A × R_retrieval × log_prob[R]     │   │
│  │                                                                  │   │
│  │  Feedback granulare: relations_useful = {R: True/False}         │   │
│  │    → Aggiorna solo relazioni marcate                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        θ_gating                                  │   │
│  │                                                                  │   │
│  │  Gradient: -A(user, level=reasoning) × R_reasoning × ∇log π     │   │
│  │                                                                  │   │
│  │  Se best_expert = "precedent" ma gating dava [0.3, 0.3, 0.1, 0.3]:│   │
│  │    → Aumenta w_precedent per query embedding simili              │   │
│  │                                                                  │   │
│  │  Aggiornamento MLP:                                              │   │
│  │    loss = -A × R_reasoning × log(gating_weights[best_expert])   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        θ_rerank                                  │   │
│  │                                                                  │   │
│  │  Gradient: -A × (R_retrieval + R_synthesis) × ∇log π            │   │
│  │                                                                  │   │
│  │  Il reranker riceve feedback sia su:                            │   │
│  │    - Ranking delle fonti (da retrieval)                         │   │
│  │    - Correttezza finale (da synthesis)                          │   │
│  │                                                                  │   │
│  │  ListNet/ListMLE loss su sources_ranking                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### Esempio Concreto di Aggiornamento

```python
# SCENARIO: Query "Cosa succede se il debitore non adempie?"
#
# Sistema ha usato:
#   - LiteralExpert: ha trovato art. 1218 (inadempimento) con rel. "contiene"
#   - PrecedentExpert: ha trovato massime Cass. con rel. "interpreta"
#   - Gating: [0.4, 0.1, 0.1, 0.4]
#   - Risposta finale: "Art. 1218 prevede che il debitore..."
#
# FEEDBACK ESPERTO (giurista, authority=0.85):
#   - retrieval:
#       sources_relevant: True
#       sources_complete: False (mancava art. 1453 risoluzione!)
#       relations_useful: {"contiene": True, "interpreta": True}
#   - reasoning:
#       literal_correct: True
#       precedent_correct: True
#       best_expert: "systemic"  # Mancava contesto sistematico!
#   - synthesis:
#       final_correct: False (risposta incompleta)

def process_feedback_example():
    # 1. CALCOLO REWARD
    R_retrieval = 0.4*1.0 + 0.3*0.0 + 0.3*0.5 = 0.55  # Parziale
    R_reasoning = (1+0+0+1)/4 = 0.50                    # 2 su 4
    R_synthesis = 0.5*0.0 + 0.25*0.0 + 0.25*0.5 = 0.125

    R_total = 0.3*0.55 + 0.4*0.50 + 0.3*0.125 = 0.40

    # 2. AGGIORNAMENTO θ_traverse
    A_retrieval = authority.get_authority(level="retrieval") # 0.85

    # LiteralExpert usò "contiene" → useful=True → rinforzo positivo
    theta_traverse_literal["contiene"] += lr * A_retrieval * R_retrieval * 1.0

    # SystemicExpert NON fu attivato → mancava "modifica" per storia art. 1453
    # → Il feedback "sources_complete=False" indica che mancava qualcosa
    # → Il feedback "best_expert=systemic" indica cosa mancava
    # → θ_traverse_systemic["modifica"] verrà rinforzato nei prossimi training

    # 3. AGGIORNAMENTO θ_gating
    A_reasoning = authority.get_authority(level="reasoning")

    # Gating aveva dato [0.4, 0.1, 0.1, 0.4] ma best_expert="systemic"
    # → systemic (index 1) aveva solo 0.1 ma era il migliore
    target = [0.0, 1.0, 0.0, 0.0]  # One-hot per systemic
    gating_loss = cross_entropy(gating_output, target)
    gating_loss *= A_reasoning * R_reasoning

    # 4. AGGIORNAMENTO θ_rerank (non critico in questo esempio)
    # Il problema era a monte (retrieval incompleto), non nel ranking

    # 5. AGGIORNAMENTO AUTHORITY UTENTE
    # L'esperto ha dato feedback utile → aumenta sua authority
    authority.update_from_feedback(MultilevelFeedback(...))
```

### Mapping Feedback Specifici → Parametri

| Feedback | Layer | Parametro Target | Aggiornamento |
|----------|-------|------------------|---------------|
| `sources_relevant=True` | RETRIEVAL | θ_traverse[expert] | ↑ relazioni usate |
| `sources_relevant=False` | RETRIEVAL | θ_traverse[expert] | ↓ relazioni usate |
| `sources_complete=False` | RETRIEVAL | θ_traverse[other] | ↑ altre relazioni |
| `relations_useful[R]=True` | RETRIEVAL | θ_traverse[*][R] | ↑ relazione specifica |
| `relations_useful[R]=False` | RETRIEVAL | θ_traverse[*][R] | ↓ relazione specifica |
| `best_expert=E` | REASONING | θ_gating | ↑ peso per expert E |
| `{expert}_correct=True` | REASONING | θ_gating | ↑ peso per expert |
| `{expert}_correct=False` | REASONING | θ_gating | ↓ peso per expert |
| `sources_ranking=[2,1,3]` | SYNTHESIS | θ_rerank | ListNet loss |
| `final_correct=True` | SYNTHESIS | θ_rerank | ↑ ranking attuale |
| `final_correct=False` | SYNTHESIS | (tutti) | Backprop totale |

### Formula Complessiva Policy Gradient

```
POLICY GRADIENT RLCF v2
═══════════════════════════════════════════════════════════════════

Per ogni parametro θ ∈ {θ_traverse, θ_gating, θ_rerank}:

∇_θ J = E_{feedback} [ A(u, l, d) × R(f) × ∇_θ log π_θ(a|q) ]

dove:
  A(u, l, d) = Authority utente u per livello l e dominio d
             = level_authority[l] × domain_authority[d] × base_authority

  R(f) = Reward calcolato dal feedback multilivello
       = w_r × R_retrieval + w_g × R_reasoning + w_s × R_synthesis

  ∇_θ log π_θ(a|q) = Gradient della log-probability delle azioni
                    = {
                        θ_traverse: log_prob relazioni seguite
                        θ_gating: log_prob pesi expert scelti
                        θ_rerank: log_prob ranking prodotto
                      }

Baseline per riduzione varianza:
  b = MovingAverage(R_total, window=100)
  advantage = R(f) - b

Update rule:
  θ ← θ + η × A(u,l,d) × advantage × ∇_θ log π_θ

  con constraint: 0 ≤ θ_traverse[r] ≤ 1.0 per ogni relazione r
```

### Resilienza: Temporal Decay per θ_traverse

```python
# I pesi decadono verso il prior se non rinforzati da feedback

EXPERT_PRIORS = {
    "literal": {
        "contiene": 1.0,   # Prior alto: strutturale
        "cita": 0.90,
        ...
    },
    "systemic": {
        "modifica": 0.90,
        "abroga_totalmente": 1.0,
        ...
    },
    ...
}

def apply_temporal_decay(theta_traverse, last_feedback_dates):
    """
    θ_new = decay^days × θ_old + (1 - decay^days) × prior

    decay_rate = 0.995 → ~50% verso prior in 6 mesi senza feedback
    """
    for expert, weights in theta_traverse.items():
        for relation, weight in weights.items():
            days = (now - last_feedback_dates[expert][relation]).days
            decay = 0.995 ** days
            prior = EXPERT_PRIORS[expert].get(relation, 0.5)
            theta_traverse[expert][relation] = decay * weight + (1-decay) * prior
```

---

## Fasi di Implementazione

### Fase 0: Infrastruttura Retrieval (Base per Expert Tools)

**File da modificare**: `merlt/storage/retriever/`

#### 0.1 Aggiungere Source-Aware Search a models.py
```python
class SourceType(Enum):
    NORMA = "norma"
    SPIEGAZIONE = "spiegazione"
    RATIO = "ratio"
    MASSIMA = "massima"

@dataclass
class SourceAwareSearchConfig:
    """Config per search filtrata per source_type."""
    source_types: List[SourceType]
    traversal_weights: Dict[str, float]  # theta_traverse per expert
    alpha: float = 0.7
```

#### 0.2 Estendere GraphAwareRetriever con search_by_source()
```python
# In retriever.py
async def search_by_source(
    self,
    query_embedding: List[float],
    source_types: List[str],
    traversal_weights: Dict[str, float],
    top_k: int = 5,
) -> List[RetrievalResult]:
    """Search filtrato per source_type con theta_traverse custom."""
    # Qdrant filter by payload.source_type
    # Graph scoring con traversal_weights dell'expert
```

---

### Fase 1: Expert Tools Infrastructure (RQ5)

**Nuovo file**: `merlt/reasoning/experts/`

#### 1.1 Base Classes
```python
# merlt/reasoning/experts/base.py
class ExpertWithTools:
    """Expert autonomo con tools per retrieval specializzato."""
    expert_type: str
    tools: List[Tool]
    traversal_weights: Dict[str, float]  # theta_traverse

    async def analyze(self, query_context) -> ExpertOpinion:
        """Analizza query usando tools autonomi."""

# merlt/reasoning/experts/tools.py
class RetrievalTool:
    """Tool base che usa StratifiedRetriever."""
    def __init__(self, retriever, source_types, expert_type):
        self.retriever = retriever
        self.source_types = source_types  # Quali source cercare
```

#### 1.2 Expert Implementations
```python
# merlt/reasoning/experts/literal.py
class LiteralExpert(ExpertWithTools):
    """Expert per interpretazione letterale."""
    expert_type = "literal"
    source_types = [SourceType.NORMA]

    tools = [
        GetExactTextTool(),      # Cerca in norma
        GetDefinitionsTool(),    # Cerca definizioni in norma
        FollowReferencesTool(),  # Segue rinvii nel grafo
    ]

# merlt/reasoning/experts/precedent.py
class PrecedentExpert(ExpertWithTools):
    """Expert per giurisprudenza."""
    expert_type = "precedent"
    source_types = [SourceType.MASSIMA]

    tools = [
        SearchCasesTool(),       # Cerca in massime
        GetCitationChainTool(),  # Segue catena citazionale nel grafo
    ]

# Analogamente per SystemicExpert e PrinciplesExpert
```

---

### Fase 2: RLCF Multilivello (RQ6)

**File da creare/modificare**: `merlt/rlcf/`

#### 2.1 MultilevelAuthority
```python
# merlt/rlcf/multilevel_authority.py
class MultilevelAuthority:
    """Authority multilivello per utente."""
    level_authority: Dict[str, float]  # retrieval/reasoning/synthesis
    domain_authority: Dict[str, float]  # civile/penale/etc.

    def get_authority(self, level: str, domain: str) -> float
    def update_from_feedback(self, feedback: RLCFFeedback)
```

#### 2.2 LearnableSystemParameters
```python
# merlt/rlcf/learnable_params.py
class LearnableSystemParameters:
    """Parametri apprendibili del sistema."""

    # theta_traverse per ogni expert
    traversal_weights: Dict[str, Dict[str, float]] = {
        "literal": {"contiene": 1.0, "disciplina": 0.95, ...},
        "systemic": {"modifica": 0.90, "attuazione": 0.95, ...},
        "principles": {"bilancia": 0.95, "deroga": 0.90, ...},
        "precedent": {"interpreta": 1.0, "applica": 1.0, ...},
    }

    # theta_gating: pesi per selezione expert
    gating_weights: np.ndarray  # [w_literal, w_systemic, w_principles, w_precedent]

    # source_weights: pesi per source type (ora parte di theta_traverse)
    source_weights: Dict[str, float] = {
        "norma": 1.0,
        "spiegazione": 0.9,
        "ratio": 0.85,
        "massima": 0.95,
    }

    def update_weights(self, expert: str, feedback: float, authority: float)
```

#### 2.3 Feedback Collection
```python
# merlt/rlcf/feedback.py
@dataclass
class RLCFFeedback:
    query_id: str
    expert_type: str          # Quale expert ha dato risposta
    level: str                # retrieval/reasoning/synthesis
    domain: str               # civile/penale/etc.
    was_correct: bool
    feedback_score: float     # -1 to 1
    user_authority: float     # Authority dell'utente che ha dato feedback
```

---

### Fase 3: Gating Network (Expert Selection)

**Nuovo file**: `merlt/reasoning/gating/`

#### 3.1 Expert Gating Network
```python
# merlt/reasoning/gating/network.py
class ExpertGatingNetwork:
    """
    Rete che decide quali expert attivare e con che peso.
    Input: query embedding
    Output: [w_literal, w_systemic, w_principles, w_precedent]
    """

    def __init__(self, input_dim=1024, num_experts=4):
        # Simple MLP or just learnable weights for now
        self.weights = nn.Parameter(torch.ones(num_experts) / num_experts)

    def forward(self, query_embedding) -> List[float]:
        """Ritorna pesi per ogni expert."""
        # V1: softmax su pesi fissi
        # V2: MLP su query embedding
        return F.softmax(self.weights, dim=0).tolist()

    def update_from_feedback(self, expert_idx: int, feedback: float):
        """Aggiorna peso dell'expert basandosi su feedback."""
```

---

### Fase 4: Orchestrazione

**Modifica**: `merlt/core/legal_knowledge_graph.py`

#### 4.1 Nuovo metodo search_with_experts()
```python
async def search_with_experts(
    self,
    query: str,
    top_k: int = 5,
    active_experts: Optional[List[str]] = None,
) -> ExpertSearchResult:
    """
    Search usando Expert autonomi.

    Flow:
    1. Encode query
    2. Gating Network decide pesi expert
    3. Ogni Expert cerca con suoi tools
    4. Risultati aggregati con pesi gating
    """

@dataclass
class ExpertSearchResult:
    """Risultato da search con Expert."""
    literal_results: List[RetrievalResult]
    systemic_results: List[RetrievalResult]
    principles_results: List[RetrievalResult]
    precedent_results: List[RetrievalResult]
    gating_weights: List[float]
    expert_opinions: Dict[str, str]  # Optional LLM opinions
```

---

### Fase 5: Validation per Tesi

**Nuovo file**: `scripts/validate_expert_retrieval.py`

#### 5.1 Test Suite per RQ5
```python
TEST_QUERIES_BY_EXPERT = {
    "literal": [
        {"query": "art 1453 codice civile", "expected": ["1453"]},
        {"query": "definizione di contratto", "expected": ["1321"]},
    ],
    "systemic": [
        {"query": "storia dell'art 1453", "expected": ["modifiche", "relazioni"]},
    ],
    "principles": [
        {"query": "ratio della risoluzione contrattuale", "expected": ["1453"]},
        {"query": "principio buona fede", "expected": ["1337", "1375"]},
    ],
    "precedent": [
        {"query": "sentenze inadempimento", "expected_massime": True},
        {"query": "giurisprudenza legittima difesa", "expected_massime": True},
    ],
}
```

#### 5.2 Metriche per Expert
- **Recall@K per Expert**: Ogni expert trova i suoi documenti rilevanti?
- **Expert Routing Accuracy**: Il Gating sceglie l'expert giusto?
- **RLCF Convergence**: I pesi migliorano con feedback?

---

## File da Creare/Modificare

### Nuovi File (da creare)
| File | Descrizione |
|------|-------------|
| `merlt/reasoning/experts/__init__.py` | Package Expert |
| `merlt/reasoning/experts/base.py` | ExpertWithTools base class |
| `merlt/reasoning/experts/tools.py` | RetrievalTool e tool comuni |
| `merlt/reasoning/experts/literal.py` | LiteralExpert |
| `merlt/reasoning/experts/systemic.py` | SystemicExpert |
| `merlt/reasoning/experts/principles.py` | PrinciplesExpert |
| `merlt/reasoning/experts/precedent.py` | PrecedentExpert |
| `merlt/reasoning/gating/__init__.py` | Package Gating |
| `merlt/reasoning/gating/network.py` | ExpertGatingNetwork |
| `merlt/rlcf/multilevel_authority.py` | MultilevelAuthority |
| `merlt/rlcf/learnable_params.py` | LearnableSystemParameters |
| `merlt/rlcf/feedback.py` | RLCFFeedback dataclass |
| `scripts/validate_expert_retrieval.py` | Validation per RQ5/RQ6 |
| `tests/reasoning/test_experts.py` | Test Expert |
| `tests/rlcf/test_multilevel.py` | Test RLCF |

### File da Modificare
| File | Modifiche |
|------|-----------|
| `merlt/storage/retriever/models.py` | Aggiungere SourceType, SourceAwareSearchConfig |
| `merlt/storage/retriever/retriever.py` | Aggiungere search_by_source() |
| `merlt/storage/retriever/__init__.py` | Export nuove classi |
| `merlt/core/legal_knowledge_graph.py` | Aggiungere search_with_experts() |
| `merlt/config/retriever_weights.yaml` | Aggiungere sezione per theta_traverse per expert |

---

## Ordine di Esecuzione

| Fase | Descrizione | Dipendenze | Tempo |
|------|-------------|------------|-------|
| **0** | Infrastruttura Retrieval | - | 2h |
| **1** | Expert Base + Tools | Fase 0 | 4h |
| **2** | RLCF Multilivello | - | 3h |
| **3** | Gating Network | Fase 1, 2 | 2h |
| **4** | Orchestrazione LKG | Fase 1, 3 | 2h |
| **5** | Validation + Tests | Tutto | 3h |

**Tempo totale stimato**: ~16h (2-3 giorni)

---

## Metriche di Successo per Tesi

### RQ5: Expert Tools
- [ ] 4 Expert implementati con tools specializzati
- [ ] Ogni Expert cerca solo nelle sue source_types
- [ ] Recall@5 per expert > 80%

### RQ6: RLCF Multilivello
- [ ] Authority multilivello funzionante
- [ ] theta_traverse apprendibile per expert
- [ ] Convergenza pesi con feedback simulato

### Integrazione
- [ ] Gating Network seleziona expert appropriato
- [ ] search_with_experts() funzionante end-to-end
- [ ] Metriche aggregate per tesi

---

## Note Implementative

1. **Backward Compatibility**: Mantenere `search()` esistente, `search_with_experts()` è nuovo
2. **No LLM in Expert (opzionale)**: Prima implementare tools senza LLM, poi aggiungere reasoning LLM
3. **RLCF simulato**: Per test iniziali, simulare feedback con ground truth
4. **Graduale**: Prima Expert senza Gating, poi aggiungere Gating Network
