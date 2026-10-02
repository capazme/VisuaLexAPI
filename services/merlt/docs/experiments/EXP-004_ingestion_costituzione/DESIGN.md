# EXP-004: Ingestion Costituzione Italiana

**Status**: PLANNED
**Data inizio**: 2025-12-05
**Data fine stimata**: 2025-12-05

---

## Obiettivo

Testare la generalizzabilità della pipeline di ingestion v2 su un corpus diverso dal Codice Civile: la Costituzione italiana (139 articoli + 18 disposizioni transitorie).

---

## Ipotesi

1. **H1**: La pipeline esistente può gestire la Costituzione con minime modifiche
2. **H2**: La struttura della Costituzione (principi, parti, titoli) richiede un mapping URN diverso
3. **H3**: Le massime costituzionali hanno caratteristiche diverse da quelle civilistiche

---

## Dataset

### Fonte
- **Normattiva**: `urn:nir:stato:costituzione`
- **Brocardi**: `https://www.brocardi.it/costituzione/`

### Struttura Costituzione
```
Principi Fondamentali (Art. 1-12)
├── /costituzione/principi-fondamentali/art{N}.html

Parte I: Diritti e Doveri dei Cittadini (Art. 13-54)
├── Titolo I: Rapporti Civili (Art. 13-28)
├── Titolo II: Rapporti Etico-Sociali (Art. 29-34)
├── Titolo III: Rapporti Economici (Art. 35-47)
└── Titolo IV: Rapporti Politici (Art. 48-54)

Parte II: Ordinamento della Repubblica (Art. 55-139)
├── Titolo I: Il Parlamento
│   ├── Sezione I: Le Camere (Art. 55-69)
│   └── Sezione II: La Formazione delle Leggi (Art. 70-82)
├── Titolo II: Il Presidente della Repubblica (Art. 83-91)
├── Titolo III: Il Governo (Art. 92-100)
├── Titolo IV: La Magistratura (Art. 101-113)
├── Titolo V: Le Regioni, Province, Comuni (Art. 114-132)
└── Titolo VI: Garanzie Costituzionali (Art. 133-139)

Disposizioni Transitorie e Finali (I-XVIII)
```

### Volume stimato
| Tipo | Quantità |
|------|----------|
| Articoli | 139 |
| Disposizioni Transitorie | 18 |
| **Totale norme** | **157** |
| Massime (stima) | ~500-1000 |

---

## Metodologia

### Fase 1: Analisi struttura Brocardi
1. Verificare URL pattern per tutti gli articoli
2. Identificare presenza di: Dispositivo, Spiegazione, Massime, Dottrina
3. Verificare formato massime (identico a Codice Civile?)

### Fase 2: Mapping URN
```python
# URN Normattiva per Costituzione
"urn:nir:stato:costituzione~art1"  # Articolo 1
"urn:nir:stato:costituzione~art139" # Articolo 139
# Disposizioni Transitorie?
"urn:nir:stato:costituzione~disptrans1"  # Da verificare
```

### Fase 3: Ingestion
1. Scraping articoli via BrocardiScraper esistente
2. Creazione nodi grafo (Norma, Dottrina, AttoGiudiziario)
3. Creazione relazioni gerarchiche
4. Embedding articoli (article-level)
5. Embedding massime

### Fase 4: Validazione
1. Count nodi/relazioni creati
2. Verifica integrità dati
3. Test retrieval su query costituzionali

---

## Metriche

| Metrica | Target |
|---------|--------|
| Articoli ingeriti | 139/139 (100%) |
| Disposizioni transitorie | 18/18 (100%) |
| Massime estratte | >80% di quelle disponibili |
| Errori ingestion | 0 |
| Tempo totale | <10 minuti |

---

## Rischi

1. **R1**: URL pattern diversi per alcune sezioni → Mappare manualmente
2. **R2**: Massime assenti per articoli costituzionali → Documentare
3. **R3**: Disposizioni Transitorie con formato diverso → Gestire separatamente

---

## Dipendenze

- EXP-001 (Libro IV): Pipeline v2 testata e funzionante
- BrocardiScraper: già supporta Costituzione
- FalkorDB/Qdrant: operativi

---

## Note

La Costituzione è un test ideale perché:
1. Corpus chiuso e stabile (poche modifiche)
2. Alta rilevanza giuridica
3. Struttura diversa dal Codice Civile
4. Permette di validare la generalizzabilità del sistema
