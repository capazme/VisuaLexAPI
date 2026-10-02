# MERL-T experiments (December 2025) — read this first

These are the experiments run on MERL-T before it joined VisuaLex, imported on
1 October 2026 from the owner's earlier monorepo (ALIS_CORE, `merlt/docs/experiments/`).
They are **history and measurements, not guidance**: the stack, the scrapers and the
graph vocabulary have changed since. The vocabulary in force is the one in
`docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md`; where an experiment
names a relation, a label or a URN form, that spec wins.

**What the graph round uses from here** (cited in the spec above):

| Experiment | Use |
| --- | --- |
| EXP-006 (c.p. Libro I) | pilot predictor: 263 articles, 6,195 massime, ~4 s/article cold; `ground_truth.json` as the article list |
| EXP-001, EXP-014 (c.c. Libro IV) | how the seed was built; hierarchy and massime counts; MPS embedding throughput |
| EXP-014 `validation/validation_framework.py` | template for the phase 2 shape checks |
| EXP-005 (L. 241/1990) | multivigenza ground truth and the parser bugs it found |
| EXP-009 (Costituzione) | the lettere-split-into-commi pitfall |
| EXP-013, EXP-014 | how the concept layer `manuale:Torrente-libroiv` was produced |
| EXP-015, EXP-016 | the gold standards, already in code at `merlt/benchmark/gold_standard.py` |

**Changed on import**

- Author and operator lines naming a person were removed (the repository is public).
- `EXP-006_libro_primo_cp/ground_truth.json`: the code's articles now carry the canonical
  URN `…;1398:1~artN`. The original `…;1398~artN` collided with the promulgation decree's
  own articles 1–3, which keep `…;1398~artN`.

**Left in ALIS_CORE** (too large, or raw data with no reading value): EXP-013
`backup_pre_test.json`, EXP-014 `backup/falkordb_export_*.json`, EXP-020 `trace_*.json`,
EXP-021 `results/experiment_results_*.json`, `results/experiment_trace_*.json` and the two PDFs.

**Read with care**

- EXP-006 `ground_truth.json`: the `position` field is wrong for many articles (the
  two-levels-per-heading parsing bug of spec §5.1); do not use it as a hierarchy gold.
- EXP-009 README (7 min, 0 errors) disagrees with its own `metrics.json` (1 h 38 min,
  5 errors); EXP-006 says 263 articles where its metrics count 251; EXP-001 ANALYSIS uses
  numbers from before a fix. Trust the JSON over the prose.
- EXP-016: an NDCG@10 of 1.02 is a bug — `merlt/benchmark/metrics.py` scores each
  chunk of one article separately — not "relevant articles nobody annotated".
- EXP-018 and EXP-019 are void runs (the experts never ran); EXP-020's hallucination metric
  means "not in our database", so it holds by construction; EXP-021–024 are simulations
  with synthetic users. In EXP-023 the noisy users' authority grows by ~380%: that shows
  the authority model failing to filter noise, not working.

---

# Experiments Documentation

> **Sistema di documentazione esperimenti per MERL-T**
> Ogni esperimento significativo viene documentato per la tesi e il percorso argomentativo.

---

## Struttura

```
docs/experiments/
├── README.md                    # Questo file
├── TEMPLATE.md                  # Template per nuovi esperimenti
├── INDEX.md                     # Indice cronologico esperimenti
│
├── EXP-001_ingestion_libro_iv/  # Primo esperimento: ingestion 887 articoli
│   ├── DESIGN.md                # Design e metodologia
│   ├── EXECUTION.md             # Log esecuzione
│   ├── RESULTS.md               # Risultati e metriche
│   └── ANALYSIS.md              # Analisi e conclusioni
│
├── EXP-002_xxx/                 # Esperimenti successivi...
└── ...
```

---

## Convenzioni

### Naming
- **EXP-NNN**: Numero progressivo a 3 cifre
- **Nome descrittivo**: snake_case, max 30 caratteri
- Esempio: `EXP-001_ingestion_libro_iv`

### Documenti per Esperimento

| File | Contenuto | Quando |
|------|-----------|--------|
| `DESIGN.md` | Ipotesi, metodologia, setup | Prima dell'esperimento |
| `EXECUTION.md` | Log real-time, comandi, errori | Durante l'esperimento |
| `RESULTS.md` | Metriche, output, dati grezzi | Subito dopo |
| `ANALYSIS.md` | Interpretazione, conclusioni, next steps | Post-elaborazione |

### Status Esperimento

```
[PLANNED]    → Design completato, pronto per esecuzione
[RUNNING]    → In corso
[COMPLETED]  → Terminato con successo
[FAILED]     → Terminato con errori (documentare cause)
[ABANDONED]  → Abbandonato (documentare motivazione)
```

---

## Best Practices

### 1. Riproducibilità
- Documentare **tutti** i comandi eseguiti
- Salvare versioni esatte delle dipendenze
- Includere git commit hash di partenza
- Screenshot/log per risultati non deterministici

### 2. Tracciabilità Accademica
- Collegare a Research Questions (RQ) della tesi
- Citare papers/metodologie di riferimento
- Distinguere fatti da interpretazioni
- Documentare anche i fallimenti (valuable per tesi)

### 3. Metriche Quantitative
Preferire metriche oggettive:
- Tempo di esecuzione
- Numero di record processati
- Errori/warning count
- Memory/CPU usage
- Copertura dataset

### 4. Versionamento
- Ogni esperimento in sottocartella dedicata
- Non modificare esperimenti passati (append-only)
- Se si ripete un esperimento, creare nuovo EXP-NNN

---

## Research Questions (RQ) di Riferimento

Dalla metodologia (`docs/08-iteration/INGESTION_METHODOLOGY.md`):

| RQ | Domanda |
|----|---------|
| RQ1 | Il chunking comma-level preserva l'integrità semantica? |
| RQ2 | La struttura gerarchica (Libro→Titolo→Articolo) migliora il retrieval? |
| RQ3 | L'enrichment Brocardi aggiunge valore informativo misurabile? |
| RQ4 | La Bridge Table riduce latenza rispetto a join runtime? |

---

## Quick Start

```bash
# Creare nuovo esperimento
cp -r docs/experiments/TEMPLATE.md docs/experiments/EXP-NNN_nome_esperimento/
cd docs/experiments/EXP-NNN_nome_esperimento/

# Rinominare e compilare
mv TEMPLATE.md DESIGN.md
# Editare DESIGN.md con ipotesi e metodologia

# Durante esecuzione
touch EXECUTION.md
# Documentare comandi e output

# Post-esecuzione
touch RESULTS.md ANALYSIS.md
# Compilare risultati e analisi
```

---

## Esperimenti Attivi

| ID | Nome | Status | Data | RQ |
|----|------|--------|------|-----|
| EXP-001 | ingestion_libro_iv | PLANNED | 2025-12-03 | RQ1, RQ2, RQ3 |

---

*Ultimo aggiornamento: 3 Dicembre 2025*
