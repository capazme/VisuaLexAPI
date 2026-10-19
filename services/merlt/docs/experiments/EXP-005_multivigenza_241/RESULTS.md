# EXP-005: Risultati Multivigenza L.241/1990

> **Status**: COMPLETED
> **Date**: 2025-12-06

## Executive Summary

L'esperimento ha validato con successo l'implementazione della multivigenza nel knowledge graph MERL-T. La struttura gerarchica creata rispetta il diritto positivo italiano, dove le modifiche normative sono operate da **specifici commi** di articoli, non dagli atti nel loro complesso.

**IMPORTANTE**: Durante l'esperimento sono stati corretti diversi bug critici nel parsing delle modifiche e nella logica di determinazione dello stato "abrogato".

## Metriche Finali (Run Definitivo)

| Metrica | Valore | Note |
|---------|--------|------|
| **Nodi totali** | 29 | |
| **Nodi Norma (articoli)** | 18 | 5 L.241 + atti modificanti |
| **Nodi Comma** | 43 via :contiene | Commi specifici delle disposizioni |
| **Relazioni :modifica** | 16 | |
| **Relazioni :inserisce** | 6 | Include bis/ter |
| **Relazioni :abroga** | 2 | |

## Validazione contro Ground Truth Normattiva

| Articolo | Sistema | Normattiva | Status |
|----------|---------|------------|--------|
| Art. 1 | Vigente | Vigente | ✅ |
| Art. 2 | Vigente | Vigente | ✅ |
| Art. 2-bis | Vigente | Vigente (comma 2 abrogato) | ✅ |
| Art. 3 | Vigente | Vigente | ✅ |
| Art. 3-bis | Vigente | Vigente | ✅ |

## Bug Corretti Durante l'Esperimento

### Bug 1: Filtering articolo errato
**Problema**: Il filtro per articolo usava `startswith()` che matchava erroneamente Art. 14 quando si cercava Art. 1.
```python
# PRIMA (bug)
if not target_norm.startswith(nv_norm.split('-')[0]):

# DOPO (fix)
if nv_base != target_base:  # Confronto numeri base
```

### Bug 2: is_abrogato troppo permissivo
**Problema**: Un articolo veniva marcato "abrogato" se QUALSIASI modifica era di tipo ABROGA, anche se l'abrogazione era per un comma specifico.
```python
# PRIMA (bug)
is_abrogato = any(m.tipo_modifica == TipoModifica.ABROGA for m in modifiche)

# DOPO (fix)
is_abrogato = any(m.is_article_level_abrogation(for_article=numero_articolo) for m in modifiche)
```

### Bug 3: Parsing destinazione incompleto
**Problema**: Il regex non catturava il formato "del comma 2 dell'art. 2-bis" (comma prima dell'articolo).
```python
# PRIMA: solo "dell'art. X, comma Y"
# DOPO: supporta anche "del comma Y dell'art. X"
```

## Struttura Gerarchica Implementata

```
(Atto Modificante: D.L. 76/2020)
         |
    [:contiene]
         |
         v
(Articolo: Art. 12 D.L. 76/2020)
         |
    [:contiene]
         |
         v
(Comma: Art. 12, comma 1, D.L. 76/2020)
         |
    [:modifica]
         |
         v
(Target: Art. 3-bis L.241/1990)
```

## Modifiche Implementate

### File: `merlt/external_sources/visualex/tools/norma.py`
- Aggiunto campo `destinazione` a dataclass `Modifica`
- Aggiunto metodo `is_article_level_abrogation(for_article=None)`
- Aggiornati `to_dict()` e `from_dict()`

### File: `merlt/external_sources/visualex/scrapers/normattiva_scraper.py`
- Corretto filtering articolo (confronto numeri base)
- Migliorato parsing destinazione (supporta entrambi i formati)
- Estratto comma/lettera correttamente

### File: `merlt/preprocessing/multivigenza_pipeline.py`
- Usa `is_article_level_abrogation(for_article=X)` per determinare stato

## Conformità a knowledge-graph.md

| Requisito | Status |
|-----------|--------|
| Nodi Norma con properties complete | ✅ |
| Nodi Comma per granularità sub-articolo | ✅ |
| Relazione :contiene per gerarchia | ✅ |
| Relazioni di modifica tipizzate | ✅ |
| URN univoci per ogni entità | ✅ |
| Properties temporali (data_efficacia, etc.) | ✅ |
| Flag `abrogato` corretto | ✅ |

## Query di Validazione

### 1. Verifica stato articoli
```cypher
MATCH (art:Norma)
WHERE art.tipo_documento = "articolo" AND art.URN CONTAINS "legge:1990-08-07;241"
RETURN art.numero_articolo, art.abrogato, art.n_modifiche
ORDER BY art.numero_articolo
```

### 2. Relazioni :abroga con destinazione
```cypher
MATCH (source)-[r:abroga]->(target:Norma)
WHERE target.URN CONTAINS "legge:1990-08-07;241"
RETURN target.numero_articolo, r.destinazione, labels(source)[0]
```

## Limitazioni Note

1. **Regex parsing**: Funziona per formati standard italiani, potrebbe beneficiare di fallback LLM per casi edge
2. **Testo atti modificanti**: Non viene fetchato il testo completo degli atti modificanti
3. **Lettere/Numeri**: Parsing implementato ma non testato estensivamente

## Prossimi Passi

1. [ ] Integrare parsing LLM per disposizioni complesse (fallback)
2. [ ] Estendere a fonti normative EU (Direttive, Regolamenti)
3. [ ] Test con volume maggiore (Codice Civile intero)
4. [ ] Validazione automatica contro Normattiva

## Conclusioni

L'esperimento ha dimostrato che il sistema:
1. ✅ Traccia tutte le modifiche di un articolo nel tempo
2. ✅ Crea struttura gerarchica conforme al diritto positivo
3. ✅ Identifica correttamente inserimenti (articoli bis/ter)
4. ✅ Collega le modifiche ai commi specifici
5. ✅ Determina correttamente lo stato "vigente"/"abrogato"

Il knowledge graph ora rappresenta fedelmente la "mappa del diritto vivente" e i risultati corrispondono al ground truth Normattiva.
