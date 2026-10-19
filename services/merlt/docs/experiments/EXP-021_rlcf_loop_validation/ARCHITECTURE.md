# Architettura del Simulatore RLCF

> **Documentazione tecnica completa del sistema di simulazione**

## Diagramma di Alto Livello

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         RLCF SIMULATOR                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │   UserPool       │    │   Expert System  │    │   Evaluation     │   │
│  │   (20 utenti)    │───▶│   (4 expert)     │───▶│   Engine         │   │
│  │                  │    │                  │    │                  │   │
│  │  - strict_expert │    │  - LiteralExpert │    │  - Objective     │   │
│  │  - specialist    │    │  - SystemicExpert│    │  - LLM Judge     │   │
│  │  - student       │    │  - Principles    │    │  - Synthesizer   │   │
│  │  - random        │    │  - Precedent     │    │                  │   │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘   │
│           │                       │                       │              │
│           ▼                       ▼                       ▼              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    RLCFExperiment Runner                          │   │
│  │                                                                    │   │
│  │   Phase 1: BASELINE ──▶ Phase 2: TRAINING ──▶ Phase 3: POST      │   │
│  │   (no feedback)         (feedback + learn)    (same queries)      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Statistical Analyzer                           │   │
│  │                                                                    │   │
│  │   H1: Persistence ─── H2: Authority ─── H3: Weights ─── H4: Quality│  │
│  │   (binomial test)     (paired t-test)   (CV + trend)   (Wilcoxon)  │  │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│                                    ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Thesis Output Generator                        │   │
│  │                                                                    │   │
│  │   JSON ──── CSV ──── LaTeX ──── PDF ──── Markdown                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Struttura dei File

```
merlt/rlcf/simulator/
├── __init__.py              # Export pubblici
├── users.py                 # Profili utente sintetici
├── objective_metrics.py     # Metriche calcolabili automaticamente
├── llm_judge.py             # Valutazione LLM-as-Judge
├── feedback_synthesizer.py  # Combina metriche in feedback
├── experiment.py            # Runner 3 fasi
├── statistics.py            # Test statistici
├── outputs.py               # Generatore output thesis
├── config.py                # Loader configurazione YAML
├── integration.py           # Integrazione componenti reali
└── config/
    └── simulation.yaml      # Configurazione default
```

---

## Componenti Dettagliati

### 1. UserPool - Utenti Sintetici

**File**: `merlt/rlcf/simulator/users.py`

Il simulatore crea un pool di 20 utenti sintetici con 4 profili distinti:

| Profilo | % | Authority Base | Bias | Rumore | Descrizione |
|---------|---|----------------|------|--------|-------------|
| `strict_expert` | 15% | 0.85 | -0.1 clarity | 0.05 | Professori universitari, valutazione rigorosa |
| `domain_specialist` | 25% | 0.70 | -0.05 utility | 0.08 | Avvocati specializzati, precisi sul dominio |
| `lenient_student` | 40% | 0.25 | +0.2 accuracy | 0.15 | Studenti, tendono a sovrastimare |
| `random_noise` | 20% | 0.10 | 0.0 | 0.40 | Utenti casuali, feedback inaffidabile |

**Classe principale**:

```python
@dataclass
class SyntheticUser:
    user_id: int
    profile_type: str
    baseline_authority: float      # Authority iniziale (0-1)
    current_authority: float       # Authority attuale (evolve)
    evaluation_bias: Dict[str, float]  # Bias per dimensione
    noise_level: float             # Varianza nelle valutazioni
    feedback_probability: float    # Probabilità di dare feedback
    track_record: float            # Qualità storica feedback
    feedback_history: List[Dict]   # Storico feedback dati
```

**Comportamenti simulati**:

1. **Bias di valutazione**: Gli esperti tendono a essere più severi sulla chiarezza, gli studenti più generosi sull'accuratezza
2. **Rumore gaussiano**: Simula la variabilità naturale nelle valutazioni umane
3. **Track record**: Gli utenti con feedback di qualità vedono aumentare la loro authority
4. **Probabilità feedback**: Non tutti gli utenti danno feedback su ogni query

---

### 2. ObjectiveEvaluator - Metriche Automatiche

**File**: `merlt/rlcf/simulator/objective_metrics.py`

Calcola metriche senza richiedere LLM:

```python
@dataclass
class ObjectiveMetrics:
    source_grounding: float      # % fonti verificate nel DB (0-1)
    hallucination_rate: float    # % fonti inventate (0-1)
    citation_accuracy: float     # Precisione citazioni (0-1)
    coverage_score: float        # Copertura fonti rilevanti (0-1)
    response_length: int         # Lunghezza risposta (tokens)
    execution_time_ms: float     # Tempo esecuzione
```

**Source Grounding (SG)**:
```python
def _compute_sg(self, response, context) -> float:
    """Percentuale di fonti citate che esistono nel database."""
    valid_urns = set(context.get("valid_urns", []))
    cited = [s.source_id for s in response.legal_basis]
    verified = sum(1 for c in cited if c in valid_urns)
    return verified / max(len(cited), 1)
```

**Hallucination Rate (HR)**:
```python
def _compute_hr(self, response, context) -> float:
    """Percentuale di fonti citate che NON esistono."""
    return 1.0 - self.source_grounding
```

---

### 3. LLMJudge - Valutazione Soggettiva

**File**: `merlt/rlcf/simulator/llm_judge.py`

Utilizza un LLM (configurabile via OpenRouter) per valutare le risposte con Chain-of-Thought:

```python
@dataclass
class SubjectiveMetrics:
    accuracy: int           # 1-5: Correttezza giuridica
    clarity: int            # 1-5: Chiarezza espositiva
    utility: int            # 1-5: Utilità pratica
    reasoning_quality: int  # 1-5: Qualità ragionamento
    overall_assessment: str # Valutazione testuale
    judge_reasoning: Dict[str, str]  # Reasoning per dimensione
```

**Prompt di valutazione**:

```
Sei un valutatore esperto di risposte legali. Valuta la seguente risposta.

## QUERY ORIGINALE
{query}

## RISPOSTA DA VALUTARE
{response}

## RUBRICA DI VALUTAZIONE

### 1. ACCURATEZZA GIURIDICA (accuracy)
- La risposta è giuridicamente corretta?
- Le interpretazioni sono conformi alla dottrina prevalente?
Scala: 1=errori gravi, 2=errori minori, 3=parziale, 4=corretto, 5=eccellente

### 2. CHIAREZZA ESPOSITIVA (clarity)
- La risposta è ben strutturata?
- Il linguaggio è appropriato al contesto giuridico?
Scala: 1=confuso, 2=poco chiaro, 3=accettabile, 4=chiaro, 5=cristallino

### 3. UTILITÀ PRATICA (utility)
- La risposta aiuta concretamente l'utente?
- Fornisce indicazioni operative?
Scala: 1=inutile, 2=poco utile, 3=parziale, 4=utile, 5=molto utile

### 4. QUALITÀ RAGIONAMENTO (reasoning)
- I passaggi logici sono espliciti?
- Le conclusioni seguono dalle premesse?
Scala: 1=assente, 2=debole, 3=sufficiente, 4=buono, 5=eccellente
```

**Modelli supportati** (via OpenRouter):
- `google/gemini-2.5-flash` (default, economico)
- `google/gemini-2.5-pro` (più accurato)
- `anthropic/claude-3.5-sonnet` (alternativa)
- `openai/gpt-4o-mini` (alternativa economica)

---

### 4. FeedbackSynthesizer - Generazione Feedback

**File**: `merlt/rlcf/simulator/feedback_synthesizer.py`

Combina metriche oggettive e soggettive per generare feedback realistico:

```python
@dataclass
class SimulatedFeedback:
    user_id: int
    rating: float              # 0-1 rating complessivo
    accuracy_score: int        # 1-5
    utility_score: int         # 1-5
    transparency_score: int    # 1-5
    quality_score: float       # 0-1 qualità del feedback
    feedback_details: Dict     # Dettagli completi
```

**Formula di sintesi**:

```python
def synthesize(self, user, objective, subjective) -> SimulatedFeedback:
    # 1. Score oggettivo (40%)
    objective_score = (
        0.4 * objective.source_grounding +
        0.3 * (1 - objective.hallucination_rate) +
        0.2 * objective.citation_accuracy +
        0.1 * objective.coverage_score
    )

    # 2. Score soggettivo (60%)
    subjective_score = (
        0.35 * (subjective.accuracy / 5) +
        0.25 * (subjective.clarity / 5) +
        0.25 * (subjective.utility / 5) +
        0.15 * (subjective.reasoning_quality / 5)
    )

    # 3. Combina con pesi configurabili
    base_rating = 0.4 * objective_score + 0.6 * subjective_score

    # 4. Applica bias del profilo utente
    biased_rating = self._apply_user_bias(base_rating, user)

    # 5. Aggiungi rumore gaussiano
    final_rating = self._add_noise(biased_rating, user.noise_level)

    return SimulatedFeedback(rating=clip(final_rating, 0, 1), ...)
```

---

### 5. RLCFExperiment - Runner Esperimento

**File**: `merlt/rlcf/simulator/experiment.py`

Gestisce l'esecuzione completa dell'esperimento in 3 fasi:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EXPERIMENT FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1: BASELINE                                                   │
│  ─────────────────                                                   │
│  • 10 query sul Libro IV c.c.                                        │
│  • NO feedback collection                                            │
│  • Registra metriche iniziali                                        │
│  • Snapshot pesi e authority                                         │
│                                                                      │
│                        ▼                                             │
│                                                                      │
│  PHASE 2: TRAINING (N iterazioni)                                    │
│  ────────────────────────────────                                    │
│  Per ogni iterazione:                                                │
│  • 20 query diverse                                                  │
│  • Raccolta feedback da utenti sintetici                             │
│  • Aggiornamento authority utenti                                    │
│  • Aggiornamento traversal weights                                   │
│  • Tracking evoluzione pesi                                          │
│                                                                      │
│                        ▼                                             │
│                                                                      │
│  PHASE 3: POST-TRAINING                                              │
│  ──────────────────────                                              │
│  • STESSE 10 query del baseline                                      │
│  • NO feedback collection                                            │
│  • Confronto metriche finali vs iniziali                             │
│  • Calcolo improvement                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Risultati prodotti**:

```python
@dataclass
class ExperimentResults:
    experiment_id: str
    config: Dict[str, Any]
    baseline: PhaseResults          # Risultati fase 1
    training: List[PhaseResults]    # Risultati per iterazione
    post_training: PhaseResults     # Risultati fase 3
    weight_evolution: List[Dict]    # Storia pesi
    authority_evolution: List[Dict] # Storia authority
    total_duration_seconds: float
    total_feedbacks: int
    total_feedbacks_persisted: int
```

---

### 6. StatisticalAnalyzer - Test Statistici

**File**: `merlt/rlcf/simulator/statistics.py`

Esegue test statistici rigorosi per ogni ipotesi:

| Ipotesi | Test | Motivazione |
|---------|------|-------------|
| H1: Persistence | Binomial test | Rate = 100% target |
| H2: Authority | Paired t-test | Before/after, stesso campione |
| H3: Weights | Coefficient of Variation + trend | Misura convergenza |
| H4: Improvement | Wilcoxon signed-rank | Non-parametrico, robusto |

**Correzioni applicate**:
- **Bonferroni**: α = 0.05/4 = 0.0125 per test multipli
- **Bootstrap CI**: Intervalli di confidenza 95%
- **Effect Size**: Cohen's d per significatività pratica

---

### 7. ThesisOutputGenerator - Output Thesis-Ready

**File**: `merlt/rlcf/simulator/outputs.py`

Genera output pronti per inclusione in tesi:

| Formato | File | Contenuto |
|---------|------|-----------|
| JSON | `experiment_trace_*.json` | Trace completo riproducibile |
| CSV | `metrics_*.csv` | Metriche per analisi esterna |
| LaTeX | `hypothesis_results_*.tex` | Tabella risultati |
| PDF | `authority_evolution_*.pdf` | Grafici evoluzione |
| Markdown | `analysis_*.md` | Report narrativo |

---

### 8. Integration - Componenti Reali

**File**: `merlt/rlcf/simulator/integration.py`

Collega il simulatore ai componenti reali di MERL-T:

```python
# Adapter per LegalKnowledgeGraph
class RealExpertSystemAdapter:
    async def interpret(self, query: str) -> AdaptedExpertResponse:
        result = await self.kg.interpret(query, ...)
        return AdaptedExpertResponse.from_interpretation_result(result)

# Adapter per RLCFOrchestrator
class RealRLCFAdapter:
    async def record_expert_feedback(self, ...) -> Dict:
        return await self.orchestrator.record_expert_feedback(...)

# Factory per creare esperimento integrato
async def create_integrated_experiment(config, use_real_components=True):
    kg = LegalKnowledgeGraph(config)
    await kg.connect()
    return RLCFExperiment(
        expert_system=RealExpertSystemAdapter(kg),
        rlcf_orchestrator=RealRLCFAdapter(rlcf),
        ...
    )
```

---

## Flusso Dati Completo

```
Query                  Expert System              Evaluation
  │                         │                          │
  ▼                         ▼                          ▼
"Cos'è la mora?"  ───▶  4 Expert paralleli  ───▶  Objective: SG, HR
                        - Literal                  Subjective: LLM Judge
                        - Systemic                      │
                        - Principles                    ▼
                        - Precedent             FeedbackSynthesizer
                              │                         │
                              ▼                         ▼
                     AggregatedResponse          SimulatedFeedback
                              │                    per ogni utente
                              │                         │
                              └────────────┬────────────┘
                                           │
                                           ▼
                                  RLCFOrchestrator
                                  - Update authority
                                  - Update weights
                                  - Persist feedback
                                           │
                                           ▼
                                  StatisticalAnalyzer
                                  - Test H1, H2, H3, H4
                                  - Bonferroni correction
                                  - Effect sizes
                                           │
                                           ▼
                                  ThesisOutputGenerator
                                  - JSON, CSV, LaTeX
                                  - PDF figures
                                  - Markdown report
```

---

## Dipendenze

```
numpy>=1.24.0       # Calcoli numerici
scipy>=1.10.0       # Test statistici
matplotlib>=3.7.0   # Visualizzazioni
pandas>=2.0.0       # Data manipulation
python-dotenv       # Caricamento .env
pyyaml              # Configurazione YAML
```

---

*Documentazione generata per EXP-021 - RLCF Simulator*
