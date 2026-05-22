# Strategia Embedding Multi-Source

> **Data**: 8 Dicembre 2025
> **Problema**: Gli embeddings solo del testo normativo limitano la ricerca semantica

---

## Problema Attuale

Un utente cerca: *"quando è legittima la difesa personale"*

**Risultato attuale**: Nulla (il testo dell'Art. 52 CP non contiene quelle parole)

**Risultato desiderato**: Art. 52 CP trovato tramite la spiegazione Brocardi

---

## Strategia: Multi-Source Embeddings

### Fonti da Embeddare

| Source | Descrizione | Link a | Priorità |
|--------|-------------|--------|----------|
| **Norma** | Testo ufficiale articolo | article_urn | ✅ Alta |
| **Spiegazione** | Spiegazione Brocardi | article_urn | ✅ Alta |
| **Ratio** | Ratio legis | article_urn | ✅ Alta |
| **Massima** | Massime giurisprudenziali | article_urn | 🔶 Media |
| **Brocardi** | Brocardo latino correlato | article_urn | ⚪ Bassa |

### Schema Payload Embedding

```json
{
  "id": "uuid",
  "vector": [0.1, 0.2, ...],
  "payload": {
    "article_urn": "urn:nir:stato:codice.penale:1930~art52",
    "article_number": "52",
    "tipo_atto": "codice penale",
    "source_type": "spiegazione",  // norma | spiegazione | ratio | massima
    "text": "La legittima difesa è una causa di giustificazione...",
    "brocardi_url": "https://www.brocardi.it/..."
  }
}
```

---

## Vantaggi

### 1. Ricerca Concettuale
```
Query: "responsabilità del debitore per inadempimento"
→ Trova Art. 1218 CC via spiegazione anche se testo dice solo
  "Il debitore che non esegue esattamente..."
```

### 2. Ricerca per Principio
```
Query: "principio di proporzionalità nella difesa"
→ Trova Art. 52 CP via ratio legis
```

### 3. Ricerca per Precedente
```
Query: "contratto nullo per illiceità della causa"
→ Trova Art. 1343 CC via massime che discutono casi concreti
```

---

## Implementazione

### Modifica a `LegalKnowledgeGraph.ingest_norm()`

```python
async def _create_embeddings(self, result: IngestionResult, brocardi_info: dict):
    embeddings_to_create = []

    # 1. Embedding del testo normativo
    if result.article_text:
        embeddings_to_create.append({
            "text": result.article_text,
            "source_type": "norma",
            "article_urn": result.article_urn,
        })

    # 2. Embedding della spiegazione
    spiegazione = brocardi_info.get("Spiegazione", "")
    if spiegazione and len(spiegazione) > 50:
        embeddings_to_create.append({
            "text": spiegazione,
            "source_type": "spiegazione",
            "article_urn": result.article_urn,
        })

    # 3. Embedding della ratio
    ratio = brocardi_info.get("Ratio", "")
    if ratio and len(ratio) > 50:
        embeddings_to_create.append({
            "text": ratio,
            "source_type": "ratio",
            "article_urn": result.article_urn,
        })

    # 4. Embedding delle massime (opzionale)
    for massima in brocardi_info.get("Massime", [])[:5]:  # Limit to 5
        if massima.get("testo") and len(massima["testo"]) > 50:
            embeddings_to_create.append({
                "text": massima["testo"],
                "source_type": "massima",
                "article_urn": result.article_urn,
            })

    return embeddings_to_create
```

---

## Retrieval Modificato

### Query Flow

```
1. User query → embed → vector search
2. Results contain multiple source_types for same article
3. Deduplicate by article_urn
4. Rank by: max(scores per article)
5. Return article with context from matching source
```

### Esempio Response

```json
{
  "article_urn": "urn:nir:stato:codice.penale:1930~art52",
  "article_number": "52",
  "tipo_atto": "codice penale",
  "rubrica": "Difesa legittima",
  "match_source": "spiegazione",
  "match_text": "La legittima difesa è una causa di giustificazione che esclude...",
  "score": 0.89
}
```

---

## Metriche Attese

| Metrica | Solo Norma | Multi-Source |
|---------|------------|--------------|
| Recall@5 | ~0.5 | ~0.8 |
| MRR | ~0.4 | ~0.7 |
| Ricerche concettuali | ❌ Falliscono | ✅ Funzionano |

---

## Piano Implementazione

1. [ ] Modificare `_create_embeddings()` in `legal_knowledge_graph.py`
2. [ ] Aggiungere `source_type` al payload Qdrant
3. [ ] Modificare retriever per deduplicare per article_urn
4. [ ] Test con query concettuali
5. [ ] Benchmark vs approccio attuale

---

## Stima Embeddings

| Corpus | Articoli | Embeddings Norma | + Spiegazione | + Ratio | + Massime | Totale |
|--------|----------|------------------|---------------|---------|-----------|--------|
| Costituzione | 139 | 139 | ~130 | ~100 | ~50 | ~420 |
| Libro IV CC | 887 | 887 | ~850 | ~700 | ~4000 | ~6400 |
| Libro I CP | 263 | 263 | ~250 | ~200 | ~1000 | ~1700 |

**Stima totale**: ~8500 embeddings vs ~1300 attuali (6.5x)
