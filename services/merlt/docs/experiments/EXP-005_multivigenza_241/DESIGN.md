# EXP-005: Multivigenza con L.241/1990 Capo I

> **Status**: RUNNING
> **Created**: 2025-12-05

## Obiettivo

Validare l'implementazione della multivigenza (versioning temporale) delle norme italiane usando la L.241/1990 Capo I come dataset di test.

## Ipotesi

1. Il sistema di parsing delle modifiche da Normattiva funziona per tutti i tipi di modifica (abroga, sostituisce, modifica, inserisce)
2. Gli articoli bis/ter/quater vengono correttamente identificati come "inseriti"
3. La catena delle modifiche è completa e tracciabile nel grafo
4. Le versioni storiche possono essere recuperate con il parametro `!vig=YYYY-MM-DD`

## Dataset

**L. 7 agosto 1990, n. 241** - Nuove norme sul procedimento amministrativo
URN: `urn:nir:stato:legge:1990-08-07;241`

### Capo I - Principi (9 articoli target)

| Articolo | Tipo | Note |
|----------|------|------|
| Art. 1 | Originale (1990) | Principi generali - molte modifiche |
| Art. 1-bis | Inserito | Aggiunto successivamente |
| Art. 1-ter | Inserito | Aggiunto successivamente |
| Art. 2 | Originale (1990) | Conclusione procedimento - 70+ modifiche |
| Art. 2-bis | Inserito | Conseguenze per ritardo |
| Art. 2-ter | Inserito | Aggiunto successivamente |
| Art. 2-quater | Inserito | Aggiunto successivamente |
| Art. 3 | Originale (1990) | Motivazione - poche modifiche |
| Art. 3-bis | Inserito | Uso telematica |

## Metodologia

### Fase 1: Setup ambiente test
1. Eseguire `scripts/init_environments.py` per creare grafici test/prod
2. Verificare che `merl_t_test` sia vuoto e pronto

### Fase 2: Ingestion articoli base
1. Fetch 9 articoli da Normattiva
2. Creare nodi Norma nel grafo test
3. (Opzionale) Enrichment da Brocardi se disponibile

### Fase 3: Applicazione multivigenza
1. Per ogni articolo, eseguire `MultivigenzaPipeline.ingest_with_history()`
2. Verificare creazione relazioni di modifica
3. Contare atti modificanti creati

### Fase 4: Validazione
1. Query grafo per verificare catena modifiche
2. Test recupero versioni storiche
3. Confronto versione originale vs vigente

## Metriche attese

| Metrica | Valore atteso |
|---------|--------------|
| Nodi Norma (articoli) | 9 |
| Nodi Norma (atti modificanti) | 40-60 |
| Relazioni :modifica | 100-150 |
| Relazioni :inserisce | 5+ (bis/ter) |
| Relazioni :abroga | 5-10 |
| Errori parsing | < 5% |

## Query di validazione

```cypher
-- 1. Catena modifiche Art. 2
MATCH (atto:Norma)-[r]->(art:Norma)
WHERE art.URN CONTAINS 'legge:1990-08-07;241~art2'
AND type(r) IN ['modifica', 'sostituisce', 'abroga', 'inserisce']
RETURN atto.estremi, type(r), r.data_efficacia
ORDER BY r.data_efficacia

-- 2. Articoli inseriti (bis/ter)
MATCH (atto:Norma)-[:inserisce]->(art:Norma)
WHERE art.URN CONTAINS 'legge:1990-08-07;241'
RETURN art.numero_articolo, atto.estremi

-- 3. Conteggio relazioni per tipo
MATCH ()-[r]->()
WHERE type(r) IN ['modifica', 'sostituisce', 'abroga', 'inserisce']
RETURN type(r), count(r)
ORDER BY count(r) DESC
```

## Rischi e mitigazioni

| Rischio | Probabilità | Mitigazione |
|---------|-------------|-------------|
| Timeout Normattiva | Media | Retry con backoff esponenziale |
| Parsing estremi fallisce | Bassa | Fallback su regex più permissivo |
| Articoli bis/ter non trovati | Media | Ricerca esplicita per pattern |
| Sessione Normattiva scade | Media | Ricarica pagina articolo |

## Ambiente

- **Grafo**: `merl_t_test`
- **Collection Qdrant**: `merl_t_test_chunks`
- **Script**: `scripts/ingest_241_multivigenza.py`
