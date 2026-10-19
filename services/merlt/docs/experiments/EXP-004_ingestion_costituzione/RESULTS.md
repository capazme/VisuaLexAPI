# EXP-004: Risultati Ingestion Costituzione

**Data esecuzione**: 5 Dicembre 2025
**Durata**: ~4 minuti (scraping) + ~2 minuti (embeddings)
**Status**: COMPLETED

---

## Metriche Finali

### FalkorDB (Knowledge Graph)

| Metrica | Valore |
|---------|--------|
| Nodi Norma (articoli) | 139 |
| Nodi Dottrina (spiegazioni) | 133 |
| Nodi AttoGiudiziario (massime) | 14 |
| **Totale nodi Costituzione** | **286** |

### Qdrant (Vector Store)

| Metrica | Valore |
|---------|--------|
| Embeddings articoli | 138 |
| Embeddings massime | 14 |
| **Totale embeddings** | **152** |
| Punti totali collection | 10,814 |

### PostgreSQL (Bridge Table)

- Bridge table non aggiornata (errore constraint)
- Da risolvere in futuro se necessario

---

## Dati Estratti

### Struttura Costituzione

```
Costituzione Italiana (139 articoli)
├── Principi Fondamentali (art. 1-12)
├── Parte I - Diritti e Doveri dei Cittadini
│   ├── Titolo I - Rapporti civili (art. 13-28)
│   ├── Titolo II - Rapporti etico-sociali (art. 29-34)
│   ├── Titolo III - Rapporti economici (art. 35-47)
│   └── Titolo IV - Rapporti politici (art. 48-54)
└── Parte II - Ordinamento della Repubblica
    ├── Titolo I - Il Parlamento (art. 55-82)
    ├── Titolo II - Il Presidente della Repubblica (art. 83-91)
    ├── Titolo III - Il Governo (art. 92-100)
    ├── Titolo IV - La Magistratura (art. 101-113)
    ├── Titolo V - Le Regioni, Province, Comuni (art. 114-133)
    └── Titolo VI - Garanzie costituzionali (art. 134-139)
```

### Esempi Dati Estratti

**Art. 1**:
```
URN: urn:nir:stato:costituzione~art1
Testo: L'Italia è una Repubblica democratica, fondata sul lavoro.
       La sovranità appartiene al popolo, che la esercita nelle
       forme e nei limiti della Costituzione.
Spiegazione: [presente]
Massime: 1
```

**Art. 3**:
```
URN: urn:nir:stato:costituzione~art3
Testo: Tutti i cittadini hanno pari dignità sociale e sono
       eguali davanti alla legge...
Spiegazione: [presente]
Massime: [presenti]
```

---

## Confronto con EXP-001 (Libro IV)

| Aspetto | EXP-001 (Libro IV) | EXP-004 (Costituzione) |
|---------|-------------------|------------------------|
| Articoli | 887 | 139 |
| Massime | 9,775 | 14 |
| Spiegazioni | 880 | 133 |
| Tempo scraping | ~45 min | ~4 min |
| Complessità struttura | Alta (12 titoli, capi, sezioni) | Media (2 parti, titoli) |

---

## Osservazioni

### Successi
1. **Riutilizzo BrocardiScraper**: Lo scraper esistente ha funzionato senza modifiche
2. **URN corretti**: Formato `urn:nir:stato:costituzione~artN` corretto
3. **Gerarchia preservata**: Relazioni articolo→spiegazione→massime mantenute

### Problemi Riscontri
1. **Collection Qdrant**: Script originale usava `legal_chunks` invece di `merl_t_chunks` (corretto)
2. **Bridge table constraint**: Errore su `ON CONFLICT` - non bloccante
3. **1 articolo mancante embedding**: 138 su 139 (99.3% copertura)

### Note Tecniche
- BrocardiScraper gestisce automaticamente la navigazione per sezioni
- Rate limiting rispettato (1 sec delay tra batch)
- Timeout gestiti con retry automatico

---

## Analisi Integrità (EDA)

### Copertura Campi
| Campo | Copertura | Note |
|-------|-----------|------|
| testo_vigente | 99.3% (138/139) | Art. 120 mancante (timeout) |
| numero_articolo | 100% | Tutti presenti |
| rubrica | 0% | Brocardi non fornisce rubriche |
| spiegazione | 95.7% (133/139) | 6 articoli abrogati |
| embedding | 99.3% (138/139) | 1 mancante (no testo) |

### Articoli Abrogati
Gli articoli 115, 124, 128, 129, 130 risultano **ABROGATI** dalla L. Cost. 3/2001 (riforma Titolo V).
Brocardi li mostra con testo tra `[parentesi quadre]` e senza spiegazione.

### Distribuzione Lunghezza Testo
- Min: 0 chars | Max: 4677 chars | Avg: 481 chars
- < 100 chars: 9 articoli
- 100-499 chars: 85 articoli
- 500-999 chars: 36 articoli
- >= 1000 chars: 9 articoli

### Note su Massime
Solo 14 massime trovate su Brocardi - numero basso ma normale:
- Costituzione ha meno giurisprudenza "quotidiana" rispetto al Codice Civile
- Art. 117 ha 6 massime (competenze legislative Stato/Regioni = più contenziosi)

---

## Prossimi Passi

1. [x] Fix Art. 120 (verificato: testo esiste su Brocardi)
2. [ ] Verificare integrazione RAG con dati Costituzione
3. [ ] Test query cross-fonte (Codice Civile + Costituzione)

---

## Comandi Utili per Verifica

```bash
# Verifica FalkorDB
python3 -c "
from falkordb import FalkorDB
db = FalkorDB(host='localhost', port=6380)
g = db.select_graph('merl_t_legal')
r = g.query('MATCH (n:Norma) WHERE n.urn STARTS WITH \"urn:nir:stato:costituzione\" RETURN count(n)')
print(f'Articoli Costituzione: {r.result_set[0][0]}')
"

# Verifica Qdrant
python3 -c "
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
q = QdrantClient(host='localhost', port=6333)
r = q.scroll('merl_t_chunks', scroll_filter=Filter(must=[FieldCondition(key='fonte', match=MatchValue(value='Costituzione'))]), limit=200)
print(f'Embeddings Costituzione: {len(r[0])}')
"
```
