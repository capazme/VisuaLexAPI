# Metodologia Scientifica

> **Protocollo sperimentale per la validazione del loop RLCF**

## Fondamento Teorico

### Il Problema

Come validare un sistema di **Reinforcement Learning from Community Feedback** quando non si dispone di una community reale di utenti?

### La Soluzione

Simulare una community attraverso:
1. **Profili utente realistici** basati su archetipi del dominio giuridico
2. **Valutazione duale** (oggettiva + soggettiva) per feedback bilanciati
3. **Rumore controllato** per simulare la variabilità umana
4. **Test statistici rigorosi** per validazione scientifica

---

## Design Sperimentale

### Variabili

| Tipo | Variabile | Descrizione |
|------|-----------|-------------|
| **Indipendente** | Numero iterazioni training | 1-10 cicli di feedback |
| **Indipendente** | Composizione user pool | Mix di profili utente |
| **Dipendente** | Authority convergence | Δ% authority media |
| **Dipendente** | Response improvement | Δ% qualità risposte |
| **Controllo** | Random seed | Riproducibilità |
| **Controllo** | Query set | Stesso set baseline/post |

### Ipotesi Sperimentali

#### H1: Feedback Persistence
> Il sistema persiste correttamente tutti i feedback ricevuti

- **Metrica**: Feedback Persistence Rate (FPR)
- **Formula**: `FPR = persisted / submitted`
- **Target**: 100%
- **Soglia critica**: ≥95%
- **Test**: Binomial exact test

#### H2: Authority Convergence
> L'authority score degli utenti affidabili aumenta nel tempo

- **Metrica**: Authority Increase (ΔA)
- **Formula**: `ΔA = (mean_post - mean_baseline) / mean_baseline`
- **Target**: >20%
- **Soglia critica**: >10%
- **Test**: Paired t-test con correzione Bonferroni

#### H3: Weight Stability
> I traversal weights convergono verso valori stabili

- **Metrica**: Weight Delta Consistency (WDC)
- **Formula**: `WDC = std(deltas) / mean(deltas)`
- **Target**: <0.5
- **Soglia critica**: <1.0
- **Test**: Coefficient of Variation + trend analysis

#### H4: Response Improvement
> La qualità delle risposte migliora dopo il training

- **Metrica**: Response Improvement (RI)
- **Formula**: `RI = (quality_post - quality_baseline) / quality_baseline`
- **Target**: >10%
- **Soglia critica**: >5%
- **Test**: Wilcoxon signed-rank test

---

## Protocollo Sperimentale

### Fase 1: Baseline (Pre-Training)

**Obiettivo**: Stabilire le metriche di riferimento

**Procedura**:
1. Seleziona 10 query dal Libro IV del Codice Civile
2. Esegui ogni query attraverso il sistema multi-expert
3. Registra per ogni risposta:
   - Confidence score
   - Source Grounding rate
   - Hallucination rate
   - Execution time
4. **NON raccogliere feedback**
5. Salva snapshot di pesi e authority iniziali

**Query di esempio**:
```
Q1: "Quali sono i requisiti essenziali del contratto?"
Q2: "Quando il debitore è in mora?"
Q3: "Come si determina il risarcimento del danno?"
Q4: "Quali sono le cause di risoluzione del contratto?"
Q5: "Quando è ammessa la compensazione tra debiti?"
...
```

### Fase 2: Training (Feedback Collection)

**Obiettivo**: Raccogliere feedback e aggiornare il sistema

**Procedura** (per N iterazioni):
1. Seleziona 20 query diverse
2. Per ogni query:
   a. Esegui attraverso il sistema multi-expert
   b. Calcola metriche oggettive (SG, HR)
   c. Valuta con LLM-as-Judge (accuracy, clarity, utility, reasoning)
   d. Genera feedback sintetico per ogni utente attivo
   e. Registra feedback nel sistema RLCF
   f. Aggiorna authority utenti
   g. Aggiorna traversal weights
3. Salva snapshot pesi e authority dopo ogni iterazione

**Parametri default**:
- Iterazioni: 5
- Query per iterazione: 20
- Utenti attivi per query: ~60% del pool

### Fase 3: Post-Training (Evaluation)

**Obiettivo**: Misurare il miglioramento

**Procedura**:
1. Esegui le **stesse 10 query** della Fase 1
2. Registra le stesse metriche
3. **NON raccogliere feedback**
4. Confronta con baseline

---

## Profili Utente Sintetici

### Razionale

I profili sono basati su archetipi reali del dominio giuridico italiano:

### 1. Strict Expert (15%)

```yaml
profile: strict_expert
description: "Professore universitario di diritto civile"
authority_baseline: 0.85
characteristics:
  - Valutazione rigorosa e precisa
  - Tendenza a penalizzare mancanza di chiarezza
  - Basso rumore nelle valutazioni
  - Alta credibilità del feedback
evaluation_bias:
  accuracy: 0.0      # Nessun bias
  clarity: -0.10     # Più severo sulla chiarezza
  utility: 0.0
noise_level: 0.05    # Molto consistente
```

### 2. Domain Specialist (25%)

```yaml
profile: domain_specialist
description: "Avvocato specializzato in contratti"
authority_baseline: 0.70
characteristics:
  - Esperto nel suo dominio specifico
  - Preciso sulle questioni tecniche
  - Meno tollerante su imprecisioni pratiche
evaluation_bias:
  accuracy: 0.0
  clarity: 0.0
  utility: -0.05    # Più severo sull'utilità pratica
noise_level: 0.08
```

### 3. Lenient Student (40%)

```yaml
profile: lenient_student
description: "Studente di giurisprudenza"
authority_baseline: 0.25
characteristics:
  - Meno esperienza nel valutare
  - Tendenza a sovrastimare qualità
  - Più variabilità nelle valutazioni
  - Feedback meno affidabile
evaluation_bias:
  accuracy: +0.20   # Tende a sovrastimare
  clarity: +0.10
  utility: +0.15
noise_level: 0.15
```

### 4. Random Noise (20%)

```yaml
profile: random_noise
description: "Utente casuale non esperto"
authority_baseline: 0.10
characteristics:
  - Feedback essenzialmente casuale
  - Nessun pattern consistente
  - Alta variabilità
  - Authority molto bassa
evaluation_bias:
  accuracy: 0.0
  clarity: 0.0
  utility: 0.0
noise_level: 0.40   # Molto variabile
```

---

## Valutazione Duale

### Metriche Oggettive (40%)

Calcolate automaticamente senza LLM:

| Metrica | Peso | Calcolo |
|---------|------|---------|
| Source Grounding | 40% | Fonti verificate / Fonti citate |
| Hallucination Rate | 30% | 1 - Source Grounding |
| Citation Accuracy | 20% | Citazioni corrette / Totale |
| Coverage Score | 10% | Fonti trovate / Fonti gold |

### Metriche Soggettive (60%)

Valutate da LLM-as-Judge:

| Dimensione | Peso | Scala |
|------------|------|-------|
| Accuracy | 35% | 1-5 (correttezza giuridica) |
| Clarity | 25% | 1-5 (chiarezza espositiva) |
| Utility | 25% | 1-5 (utilità pratica) |
| Reasoning | 15% | 1-5 (qualità ragionamento) |

### Formula Combinata

```python
final_score = (
    0.4 * objective_score +  # Metriche automatiche
    0.6 * subjective_score   # Valutazione LLM
)

# Con bias utente
biased_score = final_score + user.bias[dimension]

# Con rumore
noisy_score = biased_score + gaussian_noise(0, user.noise_level)

# Clamp finale
rating = clip(noisy_score, 0.0, 1.0)
```

---

## Validità Scientifica

### Validità Interna

| Minaccia | Mitigazione |
|----------|-------------|
| History effect | Random seed fisso per riproducibilità |
| Testing effect | Query diverse in training vs baseline |
| Instrumentation | Stesse metriche in tutte le fasi |
| Selection bias | Pool utenti stratificato |

### Validità Esterna

| Aspetto | Approccio |
|---------|-----------|
| Generalizzabilità | Profili basati su archetipi reali |
| Ecological validity | Query reali dal Libro IV c.c. |
| Construct validity | Metriche consolidate (SG, HR) |

### Riproducibilità

Tutti gli esperimenti sono riproducibili grazie a:
1. **Random seed** fisso (default: 42)
2. **JSON trace** completo di ogni esecuzione
3. **Configurazione YAML** versionata
4. **Docker environment** per dipendenze

---

## Power Analysis

### Sample Size Calculation

Per rilevare un effect size medio (Cohen's d = 0.5) con:
- Power = 0.80
- α = 0.05

Richiediamo:
- **n ≈ 34** osservazioni per gruppo (paired t-test)

Con la configurazione default:
- 10 query baseline + 10 query post = 20 paired observations
- 5 iterazioni × 20 query = 100 training observations
- 20 utenti × 5 feedback = 100 feedback per iterazione

**Totale**: 120 osservazioni (sufficiente per d > 0.5)

---

## Limitazioni

### Limitazioni del Design

1. **Simulazione vs Realtà**: Gli utenti sintetici non catturano la complessità del comportamento umano reale
2. **LLM-as-Judge bias**: Il modello giudice potrebbe avere bias sistematici
3. **Query set limitato**: Focus sul Libro IV potrebbe non generalizzare

### Mitigazioni

1. Profili basati su ricerca empirica nel dominio giuridico
2. Uso di Chain-of-Thought per ridurre bias del giudice
3. Pianificazione di esperimenti futuri su altri libri

---

## Riferimenti Metodologici

1. Cohen, J. (1988). *Statistical Power Analysis for the Behavioral Sciences*
2. Zheng, L. et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*
3. Bonferroni, C. E. (1936). *Teoria statistica delle classi e calcolo delle probabilità*

---

*Protocollo sviluppato per tesi di laurea in sociologia computazionale del diritto*
