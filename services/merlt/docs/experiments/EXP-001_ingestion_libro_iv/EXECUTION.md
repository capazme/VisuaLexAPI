# EXP-001: Execution Log

> **Inizio esecuzione**: 2025-12-03 ~23:30

---

## Pre-flight Checklist

- [x] Docker containers running (FalkorDB, PostgreSQL)
- [x] `.env` configurato
- [x] Test preprocessing passano (91/91)
- [x] Test storage passano (21/21)
- [x] Spazio disco verificato
- [x] Git commit salvato: 48814f1

---

## Fase 1: Preparazione

### 1.1 Verifica Containers

```bash
# Comando:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**Output:**
```
NAMES            STATUS                    PORTS
qdrant           Up 5 hours (unhealthy)    0.0.0.0:6333-6334->6333-6334/tcp
falkordb         Up 5 hours                0.0.0.0:6380->6379/tcp, 3000/tcp
postgres_bridge  Up 5 hours                0.0.0.0:5433->5432/tcp
```
✅ FalkorDB e PostgreSQL running. Qdrant non necessario per questo esperimento.

### 1.2 Verifica Test Suite

```bash
# Comando:
pytest tests/preprocessing/ tests/storage/test_bridge*.py -v --tb=short
```

**Output:**
```
91 passed in 12.45s
- tests/preprocessing/: 70 tests
- tests/storage/test_bridge*.py: 21 tests
```
✅ Tutti i test passano.

### 1.3 Stato Database Pre-Ingestion

```cypher
-- FalkorDB: count nodi esistenti
MATCH (n) RETURN labels(n) AS tipo, count(*) AS count
```

**Output FalkorDB:**
```
tipo                | count
--------------------|-------
Norma               | 6
ConcettoGiuridico   | 4
```

```sql
-- PostgreSQL: count bridge mappings esistenti
SELECT COUNT(*) FROM bridge_table;
```

**Output PostgreSQL:**
```
count: 0 (tabella vuota pre-ingestion)
```

✅ Database in stato pulito, pronto per ingestion.

---

## Fase 2: Ingestion

### 2.1 Script Esecuzione

**File**: `scripts/batch_ingest_libro_iv.py`

```bash
# Comando eseguito:
python scripts/batch_ingest_libro_iv.py --start 1173 --end 2059 --output logs/exp001_full_ingestion.json
```

**Inizio**: 2025-12-03 23:32:09

### 2.2 Progress Log

| Timestamp | Articoli | Success | Failed | Skipped | Note |
|-----------|----------|---------|--------|---------|------|
| 23:32:09 | 0/887 | 0 | 0 | 0 | Ingestion avviata |
| 23:34:27 | 50/887 | 49 | 0 | 0 | Progress 5.6% |
| 23:44:19 | 260/887 | 259 | 0 | 0 | Progress 29.3% |
| 23:56:54 | 530/887 | 529 | 0 | 0 | Progress 59.8% |
| 00:09:08 | 790/887 | 789 | 0 | 0 | Progress 89.1% |
| 00:13:43 | 887/887 | 887 | 0 | 0 | **COMPLETATO** |

### 2.3 Bug Fix Durante Test

| Timestamp | Problema | Risoluzione |
|-----------|----------|-------------|
| 23:19 | URN duplicato `262:2:2~art` | Fix: `allegato=None` in NormaVisitata (già in map.py) |
| 23:20 | `Unknown function 'datetime'` FalkorDB | Fix: `datetime()` → `$timestamp` param |

### 2.4 Test Preparatori

1. **Dry-run (4 articoli 1453-1456)**: ✅ 13 chunks, 0 nodi (dry-run)
2. **Test reale (4 articoli 1453-1456)**: ✅ 13 chunks, 8 nodi, 4 relazioni, 13 bridge mappings

### 2.5 Nota: Brocardi Enrichment

⚠️ **Scoperta durante esecuzione**: Il BrocardiScraper richiede una knowledge base pre-popolata.
- Attualmente restituisce `(None, {}, None)` per tutti gli articoli
- L'ingestion EXP-001 procede con soli dati Normattiva
- Le massime Brocardi saranno oggetto di EXP-002 (incremental enrichment)
- Il pattern MERGE garantisce aggiornamento non distruttivo

---

## Fase 3: Validazione

### 3.1 Count Nodi per Tipo

```cypher
MATCH (n:Norma) RETURN n.tipo_documento AS tipo, count(*) AS count
ORDER BY count DESC
```

**Output:**
```
tipo       | count
-----------|-------
articolo   | 888    # 887 nuovi + 1 dal test precedente (Art. 1453-1456)
codice     | 1
libro      | 1
-----------+-------
TOTALE     | 890
```

### 3.2 Verifica Relazioni

```cypher
MATCH ()-[r]->() RETURN type(r) AS relazione, count(*) AS count
ORDER BY count DESC
```

**Output:**
```
relazione  | count
-----------|-------
contiene   | 888    # Libro IV -> articoli
disciplina | 4      # Pre-esistenti (ConcettoGiuridico)
```

### 3.3 Bridge Table Stats

```sql
SELECT COUNT(*) as total_mappings FROM bridge_table;
```

**Output:**
```
total_mappings: 2559   # 2546 nuovi + 13 dal test precedente
```

### 3.4 Sample Articolo (Art. 2043)

```cypher
MATCH (a:Norma) WHERE a.URN CONTAINS "~art2043"
RETURN properties(a)
```

**Output:**
```
URN: urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043
tipo_documento: articolo
numero_articolo: 2043
estremi: Art. 2043 c.c.
testo_vigente: "Art. 2043. (Risarcimento per fatto illecito).
               Qualunque fatto doloso o colposo, che cagiona ad altri..."
fonte: VisualexAPI
autorita_emanante: Regio Decreto
data_pubblicazione: 1942-03-16
stato: vigente
```
✅ Testo completo preservato, encoding UTF-8 corretto.

---

## Metriche Finali

| Metrica | Valore | Note |
|---------|--------|------|
| Tempo totale | **41 min 34 sec** | 23:32:09 → 00:13:43 |
| Articoli processati | **887/887** | 100% |
| Articoli falliti | **0** | ✅ |
| Articoli skipped | **0** | ✅ |
| Chunks creati | **2546** | ~2.87 chunks/articolo |
| Nodi Norma (articoli) | **888** | +1 da test precedente |
| Nodi Norma (totali) | **890** | +codice +libro |
| Relazioni contiene | **888** | Libro IV → articoli |
| Bridge mappings | **2546** | 1:1 con chunks |
| Brocardi enriched | **0** | Knowledge base vuota |
| Error rate | **0%** | Zero errori |
| Throughput | **~2.8 sec/articolo** | Include rate limiting |

---

## Note Esecuzione

1. **Rate limiting rispettato**: 1s Normattiva, 0.5s Brocardi (non usato)
2. **MERGE idempotente**: Re-run non crea duplicati
3. **Encoding**: UTF-8 preservato correttamente (verificato con Art. 2043)
4. **Scoperta**: BrocardiScraper richiede knowledge base pre-popolata → EXP-002

---

## Run 2: Con Brocardi Enrichment (4 dicembre 2025)

### Contesto

Dopo la scoperta che BrocardiScraper non funzionava nella Run 1, è stato ampliato per:
1. Estrarre **Relazioni Guardasigilli** (1941/1942) via AJAX
2. Parsing strutturato di **massime giurisprudenziali**
3. Estrazione **Ratio** e **Spiegazione**

Durante la preparazione della Run 2, si è verificato un **data loss** dovuto alla chiusura accidentale di Docker Desktop. Tutti i dati della Run 1 sono stati persi.

### Fix Applicati

| Problema | Soluzione |
|----------|-----------|
| Data loss Docker | Local bind mounts (`./data/`) invece di Docker volumes |
| FalkorDB non persistente | `--save 10 1 --appendonly yes` |
| Mount path errato | `/var/lib/falkordb/data` corretto |
| `'str' object has no attribute 'get'` | `isinstance(brocardi_info, dict)` checks |
| Massime come stringhe | Conversione automatica `str → dict` |
| Bridge Table non esistente | `psql -f schema.sql` |

### Esecuzione Run 2

**Inizio**: 2025-12-04 02:17:00
**Fine**: 2025-12-04 02:24:00
**Durata**: ~7 minuti

```bash
# Comando eseguito:
source .venv/bin/activate && python scripts/batch_ingest_libro_iv.py > logs/exp001.log 2>&1
```

### Progress Log Run 2

| Timestamp | Articoli | Note |
|-----------|----------|------|
| 02:17:00 | 0/887 | Ingestion avviata |
| 02:20:00 | ~400/887 | ~45% - Brocardi enrichment attivo |
| 02:24:00 | 887/887 | **COMPLETATO** - 0 errori |

### Metriche Finali Run 2

| Metrica | Run 1 | Run 2 | Delta |
|---------|-------|-------|-------|
| Tempo totale | 41 min | **7 min** | -83% (cache) |
| Articoli processati | 887 | 887 | - |
| Errori | 0 | 0 | - |
| **Nodi totali** | 890 | **3,346** | +274% |
| - Norma | 890 | 889 | - |
| - Dottrina | 0 | 1,630 | +∞ |
| - AttoGiudiziario | 0 | 827 | +∞ |
| **Relazioni totali** | 892 | **25,574** | +2,768% |
| - :contiene | 888 | 888 | - |
| - :commenta | 0 | 1,630 | +∞ |
| - :interpreta | 0 | 23,056 | +∞ |
| Bridge mappings | 2,546 | 2,546 | - |

### Validazione Run 2

```cypher
-- Count nodi per tipo
MATCH (n) RETURN labels(n)[0] as tipo, count(n) as count ORDER BY count DESC

-- Output:
-- Dottrina: 1,630
-- Norma: 889
-- AttoGiudiziario: 827
```

```cypher
-- Count relazioni per tipo
MATCH ()-[r]->() RETURN type(r) as tipo, count(r) as count ORDER BY count DESC

-- Output:
-- :interpreta: 23,056
-- :commenta: 1,630
-- :contiene: 888
```

### Nota sul Tempo di Esecuzione

Il Run 2 è stato significativamente più veloce (7 min vs 41 min) grazie alla **cache di Brocardi**:
- Il BrocardiScraper usa `@cached(ttl=86400)` con `Cache.MEMORY`
- Gli articoli cercati nella Run 1 erano già in cache
- Il tempo reale senza cache sarebbe ~60-90 minuti

---

## Run 3: Aggiornamento Gerarchia (4 dicembre 2025, sera)

### Contesto

Il grafo dopo Run 2 conteneva solo 1 nodo `libro` (Libro IV). Mancavano:
- Nodi `titolo` (9)
- Nodi `capo` (51)
- Nodi `sezione` (56)

È stato sviluppato `treextractor.py` per estrarre la gerarchia completa da Normattiva.

### Esecuzione

**Inizio**: 2025-12-04 19:05
**Fine**: 2025-12-04 19:07
**Durata**: ~2 minuti

```bash
# Comando eseguito:
source .venv/bin/activate && python scripts/update_graph_hierarchy.py
```

### Output

```
============================================================
Update Graph Hierarchy
============================================================

[1/5] Connecting to FalkorDB...
  ✓ Connected

[2/5] Loading NormTree from Normattiva...
  ✓ Loaded tree with 3263 articles

[3/5] Getting articles from graph...
  ✓ Found 887 articles in graph

[4/5] Creating hierarchy nodes...
  Existing hierarchy nodes: 1
  Processing article 1/887...
  ...
  Processing article 801/887...

[5/5] Results
============================================================
  Titoli created:    9
  Capi created:      51
  Sezioni created:   56
  Relations created: 887
  Articles updated:  887
============================================================

Final hierarchy node counts:
  sezione: 56
  capo: 51
  titolo: 9
  libro: 1

✓ Done!
```

### Metriche Finali Run 3

| Metrica | Run 2 | Run 3 | Delta |
|---------|-------|-------|-------|
| **Nodi Norma** | 889 | **1,005** | +116 |
| - codice | 1 | 1 | - |
| - libro | 1 | 1 | - |
| - titolo | 0 | 9 | +9 |
| - capo | 0 | 51 | +51 |
| - sezione | 0 | 56 | +56 |
| - articolo | 887 | 887 | - |
| **Relazioni :contiene** | 888 | **1,891** | +1,003 |
| **Nodi totali** | 3,346 | **3,462** | +116 |
| **Relazioni totali** | 25,574 | **26,577** | +1,003 |

### Validazione Run 3

```cypher
-- Gerarchia Art. 1453
MATCH path = (codice:Norma {tipo_documento: 'codice'})-[:contiene*]->(art:Norma {numero_articolo: '1453'})
RETURN [n in nodes(path) | n.tipo_documento] as hierarchy

-- Output:
-- codice → libro → titolo → capo → sezione → articolo
```

---

*Log aggiornato: 2025-12-04 19:30*
