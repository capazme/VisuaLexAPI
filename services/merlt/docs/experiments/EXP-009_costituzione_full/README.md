# EXP-009: Full Ingestion Costituzione con Comma/Lettera

**Data**: 8 Dicembre 2025
**Stato**: Completato con successo
**Durata**: ~7 minuti (139 articoli)

## Obiettivo

Ingestion end-to-end della Costituzione Italiana completa (139 articoli) con:
- Struttura gerarchica completa (Codice → Parte → Titolo → Articolo → Comma → Lettera)
- Enrichment da Brocardi (Dottrina, Massime giurisprudenziali)
- Embeddings semantici per ricerca
- Bridge table per mapping chunk-nodo
- Tracking multivigenza (modifiche costituzionali)

## Risultati

### Metriche Finali

| Metrica | Valore |
|---------|--------|
| Articoli processati | 139/139 |
| Error rate | 0.0% |
| Nodi FalkorDB | 1201 |
| Relazioni FalkorDB | 1062 |
| Embeddings Qdrant | 139 |
| Bridge mappings PostgreSQL | 1160 |
| Articoli con modifiche | 37 |
| Totale modifiche | 54 |

### Dettaglio Nodi per Label

| Label | Count |
|-------|-------|
| Norma | 209 |
| Comma | 436 |
| Lettera | 6 |
| Dottrina | 253 |
| AttoGiudiziario | 8 |

### Dettaglio Relazioni

| Tipo | Count |
|------|-------|
| contiene | 633 |
| commenta | 253 |
| modifica | 47 |
| interpreta | 14 |
| abroga | 6 |
| inserisce | 1 |

## Componenti Creati

### 1. FalkorDB Graph (`merl_t_dev`)

Struttura gerarchica:
```
Costituzione (Norma)
├── Principi Fondamentali
│   ├── Art. 1 (Norma)
│   │   ├── Comma 1 (Comma)
│   │   └── Comma 2 (Comma)
│   └── ...
├── Parte I - Diritti e doveri dei cittadini
│   ├── Titolo I - Rapporti civili
│   │   ├── Art. 13
│   │   └── ...
│   └── ...
└── Parte II - Ordinamento della Repubblica
    └── ...
```

Relazioni:
- `:contiene` - gerarchia strutturale
- `:commenta` - dottrina Brocardi
- `:interpreta` - massime giurisprudenziali
- `:modifica/:abroga/:sostituisce/:inserisce` - multivigenza

### 2. Qdrant Collection (`merl_t_dev_chunks`)

- 139 vettori (1 per articolo)
- Dimensione: 1024 (multilingual-e5-large)
- Payload: URN, tipo_atto, numero_articolo, testo (troncato)

### 3. PostgreSQL Bridge Table (`rlcf_dev.bridge_table`)

- 1160 mappings chunk → nodo
- Schema: chunk_id, graph_node_urn, node_type, relation_type, confidence

## Note Tecniche

### Fix Applicati Durante l'Esperimento

1. **FalkorDB porta**: Corretto da 6379 (Redis) a 6380 (FalkorDB container)
2. **Bridge table schema**: Aggiunte colonne `node_type`, `relation_type`, `chunk_text`, `source`
3. **LLM service call**: Corretto `generate` → `generate_completion` in `multivigenza.py` e `normattiva.py`
4. **URN legge costituzionale**: Aggiunto mapping `"legge costituzionale" -> "legge.costituzionale"` in `map.py` per generare URN corretti (es. `legge.costituzionale:2001-10-18;3` invece di `legge costituzionale:...`)
5. **Parsing lettere**: Aggiunto metodo `_merge_lettere_paragraphs()` in `CommaParser` per gestire correttamente le lettere a), b), c)... che Normattiva separa con doppio newline. Il metodo le raggruppa correttamente nello stesso comma.

### Test di Regressione Aggiunti

- `tests/pipeline/test_comma_parser.py`: 52 test totali per il parsing comma/lettera
  - `test_article_with_lettere_in_comma_normattiva_format`: Verifica che Art. 117 sia parsato come 3 commi (non 26)
  - `test_article_with_lettere_five_items`: Verifica che comma 2 contenga 5 lettere (a-e)
  - `test_article_with_lettera_intro_preserved`: Verifica che il testo introduttivo (":") sia preservato
- `tests/pipeline/test_multivigenza.py`: Test per `parse_disposizione` e verifica signature LLM
  - `test_llm_called_when_regex_fails`: Verifica che `generate_completion` sia chiamato con parametri corretti

### Limitazioni Note

1. **LLM fallback non attivo**: L'API key OpenRouter non era configurata, quindi il parsing multivigenza ha usato solo regex.

## File Generati

- `docs/experiments/EXP-009_costituzione_full_metrics.json` - Metriche dettagliate per articolo
- `logs/EXP-009_ingestion.log` - Log completo dell'ingestion

## Comandi per Riprodurre

```bash
# Pulizia database
python3 -c "import redis; redis.Redis(host='localhost', port=6380).flushall()"

# Esegui ingestion
python scripts/ingest_costituzione.py --delay 1.0

# Verifica risultati
python scripts/ingest_costituzione.py --dry-run  # per vedere configurazione
```

## Query di Verifica

```cypher
-- Conteggio nodi
MATCH (n:Norma) RETURN count(n)
MATCH (n:Comma) RETURN count(n)
MATCH (n:Dottrina) RETURN count(n)

-- Art. 117 struttura
MATCH (art:Norma {numero_articolo: '117'})-[:contiene]->(comma:Comma)
RETURN comma.numero, comma.testo
ORDER BY comma.numero

-- Articoli con più modifiche
MATCH (art:Norma)<-[:modifica|abroga|sostituisce]-(mod)
WHERE art.numero_articolo IS NOT NULL
RETURN art.numero_articolo, count(mod) as n_modifiche
ORDER BY n_modifiche DESC
LIMIT 10
```

## Prossimi Passi

1. ~~Migliorare parsing lettere dal testo Normattiva~~ ✅ Completato
2. Configurare OpenRouter API key per LLM parsing delle modifiche
3. Re-eseguire ingestion con tutti i fix applicati per ottenere dati corretti
4. Testare ricerca semantica con query reali
5. Estendere a Codice Civile e Codice Penale
