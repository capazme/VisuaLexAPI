# EXP-020: Valutazione Scientifica Expert System vs LLM Generico

## Obiettivo

Valutare rigorosamente il sistema Multi-Expert RAG confrontandolo con un LLM generico (baseline) sulle stesse query del Libro IV del Codice Civile.

## Ipotesi

**H1**: Il sistema Multi-Expert produce risposte con maggiore *source grounding* (fonti verificabili) rispetto a un LLM generico.

**H2**: Il sistema Multi-Expert ha maggiore *faithfulness* (fedeltà alle fonti) rispetto a un LLM generico.

**H3**: Il sistema Multi-Expert evita *hallucinations* (invenzione di articoli inesistenti) grazie al constraint SOURCE OF TRUTH.

## Metriche

### 1. Source Grounding (SG)
Percentuale di affermazioni supportate da fonti verificabili nel database.

```
SG = (affermazioni_con_fonte / affermazioni_totali) * 100
```

### 2. Faithfulness (F)
Grado in cui le citazioni corrispondono esattamente al testo delle fonti.

```
F = (citazioni_esatte / citazioni_totali) * 100
```

Valutazione:
- 1.0 = citazione esatta (copia letterale)
- 0.5 = parafrasi fedele
- 0.0 = citazione inventata o errata

### 3. Hallucination Rate (HR)
Percentuale di fonti citate che NON esistono nel database.

```
HR = (fonti_inventate / fonti_citate) * 100
```

Target: HR < 5% per Expert System, HR > 20% previsto per LLM generico

### 4. Legal Accuracy (LA)
Correttezza giuridica delle interpretazioni (valutazione manuale).

Scala 1-5:
- 5 = Interpretazione corretta e completa
- 4 = Interpretazione corretta ma incompleta
- 3 = Interpretazione parzialmente corretta
- 2 = Interpretazione con errori significativi
- 1 = Interpretazione errata

### 5. Response Latency (RL)
Tempo di risposta in millisecondi.

## Metodologia

### Dataset
20 query sul Libro IV del Codice Civile (da `test_queries.yaml`).

### Condizioni

| Condizione | Descrizione |
|------------|-------------|
| **EXPERT** | Sistema Multi-Expert con RAG e constraint SOURCE OF TRUTH |
| **BASELINE** | LLM generico (stesso modello) senza retrieval, prompt semplice |

### Protocollo

1. Per ogni query:
   a. Esegui con sistema EXPERT → salva risposta
   b. Esegui con BASELINE → salva risposta
   c. Valuta metriche per entrambe

2. Valutazione:
   - SG, F, HR: automatica (confronto con database)
   - LA: manuale (campione di 10 query)

3. Analisi statistica:
   - Test t paired per confronto medie
   - p-value < 0.05 per significatività

## Implementazione

### Script

```python
# scripts/exp020_scientific_evaluation.py

async def run_experiment():
    # 1. Carica query
    # 2. Per ogni query:
    #    - EXPERT: kg.interpret(query)
    #    - BASELINE: llm.generate(query, no_retrieval=True)
    # 3. Calcola metriche
    # 4. Salva risultati
```

### Output

```
docs/experiments/EXP-020_scientific_evaluation/results/
├── expert_responses.json
├── baseline_responses.json
├── metrics_comparison.json
├── statistical_analysis.md
└── figures/
    ├── sg_comparison.png
    ├── hr_comparison.png
    └── latency_distribution.png
```

## Risultati Attesi

| Metrica | EXPERT (atteso) | BASELINE (atteso) |
|---------|-----------------|-------------------|
| Source Grounding | > 90% | < 50% |
| Faithfulness | > 85% | < 40% |
| Hallucination Rate | < 5% | > 30% |
| Legal Accuracy | > 4.0 | 3.0-3.5 |
| Latency | ~15s | ~5s |

## Note

- Il BASELINE ha latenza minore perché non fa retrieval
- Il tradeoff latency/accuracy è accettabile per uso professionale
- Focus su SOURCE GROUNDING: il valore principale del sistema è la verificabilità delle fonti

---

## Aggiornamenti (22/12/2025)

### Miglioramenti Implementati

1. **Token Tracking**: Ora il sistema traccia i token usati per ogni chiamata LLM
   - Stima basata su lunghezza testo (~3 chars/token per italiano)
   - Costo stimato per modello (Gemini Flash: $0.15/1M tokens)

2. **ReAct Pattern**: Tutti e 4 gli expert supportano il pattern ReAct
   - LLM decide dinamicamente quali tool usare
   - Opt-in via config (`use_react=True`)

3. **RLCF Feedback Loop**: UI completa per feedback
   - Batch feedback per tutti gli expert
   - Authority score tracking
   - Weight update suggestions
   - Export feedback in JSON

4. **Enhanced Tracing**: Tab "Full Trace" con:
   - Timeline esecuzione
   - Token breakdown per expert
   - Raw data viewer
   - Export multipli (Full, Expert, Stats, LLM)

### File Modificati

| File | Modifica |
|------|----------|
| `merlt/rlcf/ai_service.py` | Token usage tracking |
| `merlt/experts/base.py` | `metadata` field in ExpertResponse |
| `merlt/experts/react_mixin.py` | Fix parsing risposta string |
| `apps/expert_debugger.py` | Enhanced UI completa |

### Prossimi Passi

Vedi **EXP-021**: Test completo pipeline con RLCF loop attivo
