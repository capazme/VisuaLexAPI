# LegalDisagreementNet - Specifica Architetturale

> **Versione**: 1.0 | **Data**: 28 Dicembre 2025
> **Autori**: MERL-T Team
> **Status**: Design Approvato - Pronto per Implementazione

---

## Executive Summary

**LegalDisagreementNet** è un modello neurale multi-task per rilevare, classificare e spiegare le divergenze interpretative nel diritto italiano. A differenza dei sistemi esistenti che trattano il disagreement come rumore da eliminare, questo modello lo tratta come **informazione giuridica di valore**.

### Valore Scientifico

1. **Primo modello** specifico per divergenze dottrinali nel diritto italiano
2. **Tassonomia fondata** sui canoni interpretativi delle Preleggi (art. 12-14 disp. prel. c.c.)
3. **Explainability nativa** - non solo classifica, ma spiega *perché* c'è disagreement
4. **Active Learning integrato** con sistema RLCF esistente

---

## Parte I: Fondamenta Teoriche

### 1.1 I Canoni Interpretativi (Preleggi)

La tassonomia del modello è radicata nei canoni ermeneutici codificati:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ART. 12 DISP. PREL. C.C.                                  │
│                    "Interpretazione della legge"                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  "Nell'applicare la legge non si può ad essa attribuire altro senso che    │
│   quello fatto palese dal SIGNIFICATO PROPRIO DELLE PAROLE secondo la      │
│   CONNESSIONE DI ESSE, e dalla INTENZIONE DEL LEGISLATORE."                │
│                                                                             │
│  Se una controversia non può essere decisa con una precisa disposizione,   │
│  si ha riguardo alle disposizioni che regolano CASI SIMILI o MATERIE       │
│  ANALOGHE; se il caso rimane ancora dubbio, si decide secondo i            │
│  PRINCIPI GENERALI DELL'ORDINAMENTO giuridico dello Stato."                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
    │   LETTERALE   │      │  SISTEMATICA  │      │  TELEOLOGICA  │
    │               │      │               │      │               │
    │ "significato  │      │ "connessione  │      │ "intenzione   │
    │  proprio"     │      │  di esse"     │      │  legislatore" │
    │               │      │               │      │               │
    │ LiteralExpert │      │SystemicExpert │      │PrinciplesExp. │
    └───────────────┘      └───────────────┘      └───────────────┘
```

### 1.2 Mapping Expert → Canone Interpretativo

| Expert | Canone | Fondamento Normativo | Cosa cerca |
|--------|--------|---------------------|------------|
| **LiteralExpert** | Letterale | "significato proprio delle parole" | Significato testuale, definizioni legali |
| **SystemicExpert** | Sistematico | "connessione di esse" | Posizione nel sistema, relazioni tra norme |
| **PrinciplesExpert** | Teleologico | "intenzione del legislatore" + "principi generali" | Ratio legis, principi costituzionali |
| **PrecedentExpert** | Applicativo | "casi simili" (analogia) | Giurisprudenza, stare decisis |

### 1.3 Quando gli Expert Divergono

Il **disagreement** tra expert non è un bug, è una feature. Riflette la struttura pluralistica dell'interpretazione giuridica:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FONTI DI DISAGREEMENT LEGITTIMO                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. POLISEMIA NORMATIVA                                                     │
│     "Buona fede" → soggettiva (ignoranza) vs oggettiva (correttezza)       │
│     Canoni diversi → conclusioni diverse, entrambe legittime               │
│                                                                             │
│  2. ANTINOMIE                                                               │
│     Due norme incompatibili sullo stesso fatto                              │
│     Richiedono criteri di soluzione (lex posterior, specialis, superior)   │
│                                                                             │
│  3. LACUNE                                                                  │
│     Caso non previsto → analogia legis vs analogia iuris                   │
│     Diversi expert propongono soluzioni diverse                            │
│                                                                             │
│  4. EVOLUZIONE GIURISPRUDENZIALE                                           │
│     Overruling: nuovo precedente supera il vecchio                         │
│     PrecedentExpert può divergere da sé stesso nel tempo                   │
│                                                                             │
│  5. TENSIONE TRA LIVELLI GERARCHICI                                        │
│     Norma ordinaria vs Costituzione vs CEDU                                │
│     PrinciplesExpert rileva conflitto che LiteralExpert ignora             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Parte II: Tassonomia del Disagreement

### 2.1 Tipi di Disagreement (6 classi)

```python
from enum import Enum

class DisagreementType(str, Enum):
    """
    Tipologia del conflitto interpretativo.
    Fondata sui canoni delle Preleggi.
    """

    # ANTINOMIA (ANT)
    # Due norme incompatibili, richiedono criteri di soluzione
    # Es: Art. X dice "vietato", Art. Y dice "consentito" per stesso fatto
    ANTINOMY = "ANT"

    # LACUNA INTERPRETATIVA (LAC)
    # Norma ambigua, multiple letture legittime
    # Es: "Buona fede" → soggettiva vs oggettiva
    INTERPRETIVE_GAP = "LAC"

    # DIVERGENZA METODOLOGICA (MET)
    # Stesso testo, metodi diversi → conclusioni diverse
    # Es: Letterale dice A, teleologico dice B
    METHODOLOGICAL = "MET"

    # OVERRULING (OVR)
    # Precedente superato ma non formalmente abrogato
    # Es: Cass. SS.UU. 2020 supera Cass. 2015
    OVERRULING = "OVR"

    # CONFLITTO GERARCHICO (GER)
    # Norma inferiore vs superiore nella piramide Kelseniana
    # Es: Legge ordinaria vs Costituzione
    HIERARCHICAL = "GER"

    # SPECIALIZZAZIONE (SPE)
    # Non conflitto vero, ma raffinamento/estensione
    # Es: "Si applica ANCHE quando..." - complementare
    SPECIALIZATION = "SPE"
```

### 2.2 Livelli di Disagreement (4 classi)

```python
class DisagreementLevel(str, Enum):
    """
    A quale livello di analisi si manifesta il disagreement.
    Corrisponde ai 4 Expert del sistema.
    """

    # SEMANTICO - Cosa dice il testo?
    # LiteralExpert diverge su significato parole
    SEMANTIC = "SEM"

    # SISTEMATICO - Come si colloca nel sistema?
    # SystemicExpert diverge su relazioni tra norme
    SYSTEMIC = "SIS"

    # TELEOLOGICO - Qual è lo scopo?
    # PrinciplesExpert diverge su ratio legis
    TELEOLOGICAL = "TEL"

    # APPLICATIVO - Come si applica al caso?
    # PrecedentExpert diverge su sussunzione
    APPLICATIVE = "APP"
```

### 2.3 Matrice Tipo × Livello

|  | SEM | SIS | TEL | APP |
|--|-----|-----|-----|-----|
| **ANT** | Raro | Comune | Raro | Comune |
| **LAC** | Molto comune | Comune | Comune | Comune |
| **MET** | Comune | Comune | Molto comune | Comune |
| **OVR** | Raro | Raro | Raro | Molto comune |
| **GER** | Raro | Comune | Molto comune | Raro |
| **SPE** | Comune | Molto comune | Comune | Comune |

---

## Parte III: Architettura del Modello

### 3.1 Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     LegalDisagreementNet v2                                   │
│                     con Explainability e Active Learning                      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  INPUT                                                                       │
│  ─────                                                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Query: "Il venditore può recedere dal contratto?"                   │   │
│  │                                                                       │   │
│  │  Expert Responses:                                                    │   │
│  │  ┌─────────────┬─────────────┬─────────────┬─────────────┐          │   │
│  │  │ Literal     │ Systemic    │ Principles  │ Precedent   │          │   │
│  │  │ "No, art.   │ "Dipende    │ "Sì, se     │ "Cass. 2020 │          │   │
│  │  │  1372 c.c.  │  dal tipo   │  viola      │  afferma... │          │   │
│  │  │  vincola"   │  contratto" │  buona fede"│             │          │   │
│  │  └─────────────┴─────────────┴─────────────┴─────────────┘          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  ENCODER                                                                     │
│  ───────                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Legal-BERT-IT (dlicari/Italian-Legal-BERT)                          │   │
│  │  + LoRA Adapters (rank=8, α=16)                                      │   │
│  │                                                                       │   │
│  │  Output: h_i ∈ R^768 per ogni interpretazione                        │   │
│  │          + attention weights per explainability                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  CROSS-EXPERT ATTENTION                                                      │
│  ──────────────────────                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                                                                       │   │
│  │  Per ogni coppia (i,j):                                              │   │
│  │    attention_ij = softmax(Q_i · K_j^T / √d)                          │   │
│  │    contrast_ij  = h_i - h_j                                          │   │
│  │    interact_ij  = h_i ⊙ h_j                                          │   │
│  │                                                                       │   │
│  │  Output:                                                              │   │
│  │    A ∈ R^(4×4)     - Matrice attenzione tra expert                   │   │
│  │    C ∈ R^(4×4×768) - Feature di contrasto per coppia                 │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  PREDICTION HEADS                                                            │
│  ────────────────                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │  HEAD 1: Binary      P(disagree) ∈ [0,1]                            │    │
│  │  HEAD 2: Type        P(type) ∈ [ANT,LAC,MET,OVR,GER,SPE]           │    │
│  │  HEAD 3: Level       P(level) ∈ [SEM,SIS,TEL,APP]                  │    │
│  │  HEAD 4: Intensity   intensity ∈ [0,1]                              │    │
│  │  HEAD 5: Resolvability  resolv ∈ [0,1]                              │    │
│  │  HEAD 6: Pairwise    M_ij ∈ R^(4×4) - quali coppie in conflitto    │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  EXPLAINABILITY MODULE                                                       │
│  ────────────────────                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │  1. Token Attribution (Integrated Gradients)                        │    │
│  │     → Quali parole causano il disagreement                          │    │
│  │                                                                      │    │
│  │  2. Expert Pair Attribution                                          │    │
│  │     → Quale coppia di expert è più in conflitto                     │    │
│  │                                                                      │    │
│  │  3. Reasoning Template                                               │    │
│  │     → Genera spiegazione in linguaggio naturale                     │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  OUTPUT                                                                      │
│  ──────                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  DisagreementAnalysis:                                                │   │
│  │    disagreement_detected: True                                        │   │
│  │    type: "MET" (Divergenza Metodologica)                             │   │
│  │    level: "TEL" (Teleologico)                                        │   │
│  │    intensity: 0.72                                                    │   │
│  │    resolvability: 0.45                                                │   │
│  │    conflicting_pairs: [(Literal, Principles)]                        │   │
│  │                                                                       │   │
│  │  Explanation:                                                         │   │
│  │    "Il disagreement è di tipo METODOLOGICO: LiteralExpert applica    │   │
│  │     una lettura restrittiva dell'art. 1372 c.c. ('il contratto ha    │   │
│  │     forza di legge'), mentre PrinciplesExpert invoca il principio    │   │
│  │     di buona fede (art. 1375 c.c.) che potrebbe giustificare il      │   │
│  │     recesso. La divergenza riguarda il BILANCIAMENTO tra pacta sunt  │   │
│  │     servanda e tutela della parte debole."                           │   │
│  │                                                                       │   │
│  │  Key Tokens: ["art. 1372", "forza di legge", "buona fede",          │   │
│  │               "recesso", "vincola"]                                   │   │
│  │                                                                       │   │
│  │  Uncertainty: 0.23 (model confidence)                                 │   │
│  │  → Active Learning: CANDIDATE for annotation                         │   │
│  │                                                                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Modulo Explainability

```python
class ExplainabilityModule(nn.Module):
    """
    Genera spiegazioni per le predizioni di disagreement.

    Tre livelli di explainability:
    1. Token-level: quali parole causano disagreement
    2. Expert-pair-level: quali expert sono in conflitto
    3. Natural language: spiegazione leggibile
    """

    def __init__(self, model: LegalDisagreementNet):
        super().__init__()
        self.model = model

        # Template per generazione spiegazioni
        self.explanation_templates = {
            DisagreementType.ANTINOMY: (
                "Il disagreement è di tipo ANTINOMIA: {expert_a} e {expert_b} "
                "identificano norme incompatibili. {norm_a} afferma '{claim_a}', "
                "mentre {norm_b} afferma '{claim_b}'. Criteri di soluzione: "
                "{resolution_criteria}."
            ),
            DisagreementType.INTERPRETIVE_GAP: (
                "Il disagreement è di tipo LACUNA INTERPRETATIVA: il termine "
                "'{ambiguous_term}' ammette multiple letture legittime. "
                "{expert_a} interpreta come '{interpretation_a}', "
                "{expert_b} come '{interpretation_b}'. "
                "Entrambe le interpretazioni sono difendibili."
            ),
            DisagreementType.METHODOLOGICAL: (
                "Il disagreement è di tipo METODOLOGICO: {expert_a} applica "
                "un'interpretazione {method_a}, mentre {expert_b} applica "
                "un'interpretazione {method_b}. La divergenza riguarda "
                "{contention_point}."
            ),
            DisagreementType.OVERRULING: (
                "Il disagreement è di tipo OVERRULING: {new_precedent} "
                "ha superato {old_precedent}. La giurisprudenza attuale "
                "afferma '{current_position}', in contrasto con la posizione "
                "precedente '{old_position}'."
            ),
            DisagreementType.HIERARCHICAL: (
                "Il disagreement è di tipo GERARCHICO: {lower_norm} è in "
                "potenziale conflitto con {higher_norm}. Secondo la gerarchia "
                "delle fonti (piramide Kelseniana), {resolution}."
            ),
            DisagreementType.SPECIALIZATION: (
                "Non si tratta di un vero disagreement ma di SPECIALIZZAZIONE: "
                "{expert_b} estende/specifica quanto affermato da {expert_a}. "
                "Le due posizioni sono complementari."
            ),
        }

    def explain(
        self,
        inputs: Dict[str, torch.Tensor],
        predictions: DisagreementPrediction,
        expert_responses: List[ExpertResponse]
    ) -> DisagreementExplanation:
        """
        Genera spiegazione completa.

        Returns:
            DisagreementExplanation con:
            - token_attributions: importanza di ogni token
            - expert_pair_scores: score di conflitto per coppia
            - natural_explanation: testo leggibile
            - key_tokens: token più rilevanti per il disagreement
        """

        # 1. Token Attribution via Integrated Gradients
        token_attr = self._compute_token_attribution(inputs, predictions)

        # 2. Expert Pair Attribution dalla matrice pairwise
        pair_scores = self._extract_pair_conflicts(predictions.pairwise_matrix)

        # 3. Genera spiegazione naturale
        template = self.explanation_templates[predictions.type]
        natural_expl = self._fill_template(
            template,
            predictions,
            expert_responses,
            pair_scores
        )

        # 4. Estrai key tokens
        key_tokens = self._extract_key_tokens(token_attr, top_k=5)

        return DisagreementExplanation(
            token_attributions=token_attr,
            expert_pair_scores=pair_scores,
            natural_explanation=natural_expl,
            key_tokens=key_tokens,
            confidence=predictions.confidence
        )

    def _compute_token_attribution(
        self,
        inputs: Dict[str, torch.Tensor],
        predictions: DisagreementPrediction
    ) -> Dict[str, List[Tuple[str, float]]]:
        """
        Integrated Gradients per token attribution.

        Per ogni expert response, calcola quali token
        contribuiscono maggiormente al disagreement.
        """
        attributions = {}

        for expert_name, input_ids in inputs.items():
            # Baseline: zero embedding
            baseline = torch.zeros_like(input_ids)

            # Integrated gradients
            ig = IntegratedGradients(self.model)
            attr = ig.attribute(
                inputs=input_ids,
                baselines=baseline,
                target=predictions.disagree_logit,
                n_steps=50
            )

            # Map back to tokens
            tokens = self.tokenizer.convert_ids_to_tokens(input_ids[0])
            token_scores = attr[0].sum(dim=-1).tolist()

            attributions[expert_name] = list(zip(tokens, token_scores))

        return attributions
```

### 3.3 Active Learning Integration

```python
class ActiveLearningManager:
    """
    Gestisce Active Learning per migliorare il modello con annotazioni mirate.

    Strategia:
    1. Identifica samples con alta uncertainty
    2. Prioritizza per diversità (non annotare samples simili)
    3. Richiede annotazione tramite UI RLCF
    4. Aggiorna modello con nuovi dati
    """

    def __init__(
        self,
        model: LegalDisagreementNet,
        uncertainty_threshold: float = 0.3,
        diversity_weight: float = 0.5
    ):
        self.model = model
        self.uncertainty_threshold = uncertainty_threshold
        self.diversity_weight = diversity_weight

        # Pool di samples candidati per annotazione
        self.candidate_pool: List[AnnotationCandidate] = []

        # Buffer di samples già selezionati (per diversità)
        self.selected_embeddings: List[torch.Tensor] = []

    def compute_uncertainty(
        self,
        predictions: DisagreementPrediction
    ) -> float:
        """
        Calcola uncertainty del modello su una predizione.

        Combina:
        - Entropy delle probabilità di classe
        - Margine tra top-2 probabilità
        - Confidence del modello
        """
        # Type classification entropy
        type_probs = F.softmax(predictions.type_logits, dim=-1)
        type_entropy = -torch.sum(type_probs * torch.log(type_probs + 1e-10))

        # Margin tra top-2
        sorted_probs, _ = torch.sort(type_probs, descending=True)
        margin = sorted_probs[0] - sorted_probs[1]

        # Combina
        uncertainty = (
            0.4 * type_entropy.item() +
            0.3 * (1 - margin.item()) +
            0.3 * (1 - predictions.confidence)
        )

        return uncertainty

    def compute_diversity(
        self,
        embedding: torch.Tensor
    ) -> float:
        """
        Calcola quanto un sample è diverso da quelli già selezionati.

        Evita di annotare samples troppo simili.
        """
        if not self.selected_embeddings:
            return 1.0

        # Distanza media dai samples già selezionati
        distances = [
            F.cosine_similarity(embedding, sel, dim=0).item()
            for sel in self.selected_embeddings
        ]

        # Più alta la distanza media, più diverso è il sample
        avg_distance = 1 - (sum(distances) / len(distances))

        return avg_distance

    def score_for_annotation(
        self,
        sample: DisagreementSample,
        predictions: DisagreementPrediction,
        embedding: torch.Tensor
    ) -> float:
        """
        Score combinato per priorità di annotazione.

        Alto score = alta priorità per annotazione umana.
        """
        uncertainty = self.compute_uncertainty(predictions)
        diversity = self.compute_diversity(embedding)

        # Combinazione pesata
        score = (
            (1 - self.diversity_weight) * uncertainty +
            self.diversity_weight * diversity
        )

        return score

    async def select_for_annotation(
        self,
        batch_size: int = 10
    ) -> List[AnnotationCandidate]:
        """
        Seleziona i top-k samples da annotare.
        """
        # Ordina per score
        self.candidate_pool.sort(key=lambda x: x.score, reverse=True)

        # Seleziona top-k
        selected = self.candidate_pool[:batch_size]

        # Aggiorna embeddings selezionati
        for candidate in selected:
            self.selected_embeddings.append(candidate.embedding)

        # Rimuovi da pool
        self.candidate_pool = self.candidate_pool[batch_size:]

        return selected

    async def on_new_prediction(
        self,
        sample: DisagreementSample,
        predictions: DisagreementPrediction,
        embedding: torch.Tensor
    ):
        """
        Hook chiamato dopo ogni predizione.
        Valuta se aggiungere a candidate pool.
        """
        uncertainty = self.compute_uncertainty(predictions)

        if uncertainty > self.uncertainty_threshold:
            score = self.score_for_annotation(sample, predictions, embedding)

            candidate = AnnotationCandidate(
                sample=sample,
                predictions=predictions,
                embedding=embedding,
                score=score,
                uncertainty=uncertainty
            )

            self.candidate_pool.append(candidate)

            log.info(
                f"Added to annotation pool: "
                f"uncertainty={uncertainty:.3f}, score={score:.3f}"
            )


@dataclass
class AnnotationCandidate:
    """Candidato per annotazione umana."""
    sample: DisagreementSample
    predictions: DisagreementPrediction
    embedding: torch.Tensor
    score: float
    uncertainty: float
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class AnnotationRequest:
    """
    Richiesta di annotazione mostrata all'utente.

    UI presenta:
    1. Query originale
    2. Risposte degli expert
    3. Predizione del modello (con confidence)
    4. Domande specifiche per l'annotatore
    """
    candidate: AnnotationCandidate

    # Domande per l'annotatore
    questions: List[AnnotationQuestion] = field(default_factory=lambda: [
        AnnotationQuestion(
            id="disagree_confirm",
            text="C'è effettivamente disagreement tra gli expert?",
            type="boolean"
        ),
        AnnotationQuestion(
            id="type",
            text="Che tipo di disagreement è?",
            type="single_choice",
            options=[t.value for t in DisagreementType]
        ),
        AnnotationQuestion(
            id="level",
            text="A quale livello si manifesta?",
            type="single_choice",
            options=[l.value for l in DisagreementLevel]
        ),
        AnnotationQuestion(
            id="intensity",
            text="Quanto sono distanti le posizioni? (1-5)",
            type="scale",
            min=1, max=5
        ),
        AnnotationQuestion(
            id="resolvability",
            text="È risolvibile con criteri oggettivi? (1-5)",
            type="scale",
            min=1, max=5
        ),
        AnnotationQuestion(
            id="explanation",
            text="Spiega brevemente perché c'è disagreement",
            type="text"
        ),
    ])
```

---

## Parte IV: Dataset e Training

### 4.1 Fonti di Training Data

```python
class DisagreementDataset:
    """
    Dataset per training LegalDisagreementNet.

    Fonti:
    1. RLCF Feedback (esistente)
    2. Overruling dal grafo (ground truth)
    3. Synthetic (LLM-generated)
    4. Expert Annotations (gold standard)
    """

    sources = {
        "rlcf": {
            "type": "automatic",
            "volume": "ongoing",
            "quality": "silver",  # Inferito da feedback
            "labels": ["disagreement_score", "contention_points"],
        },
        "overruling": {
            "type": "automatic",
            "volume": "depends on graph",
            "quality": "gold",  # Ground truth
            "labels": ["type=OVR", "intensity=1.0"],
        },
        "synthetic": {
            "type": "generated",
            "volume": "configurable",
            "quality": "bronze→silver",  # Richiede validazione
            "labels": ["all fields"],
        },
        "expert": {
            "type": "manual",
            "volume": "limited",
            "quality": "gold",
            "labels": ["all fields + explanation"],
        },
    }
```

### 4.2 Schema del Sample

```python
@dataclass
class DisagreementSample:
    """
    Singolo sample per training/inference.
    """
    # === INPUT ===
    sample_id: str
    query: str
    expert_responses: Dict[str, ExpertResponseData]

    # === LABELS ===
    # Binary
    has_disagreement: bool

    # Classification
    disagreement_type: Optional[DisagreementType]
    disagreement_level: Optional[DisagreementLevel]

    # Regression
    intensity: Optional[float]  # [0-1]
    resolvability: Optional[float]  # [0-1]

    # Pairwise
    conflicting_pairs: Optional[List[Tuple[str, str]]]

    # Explanation (per training explainability)
    explanation: Optional[str]
    key_terms: Optional[List[str]]

    # === METADATA ===
    source: str  # "rlcf", "overruling", "synthetic", "expert"
    annotator_id: Optional[str]
    annotation_confidence: Optional[float]
    legal_domain: str
    created_at: datetime


@dataclass
class ExpertResponseData:
    """Dati di una risposta expert per il sample."""
    expert_type: str
    interpretation: str
    confidence: float
    sources_cited: List[str]
    reasoning_pattern: Optional[str]  # "literal", "teleological", etc.
```

### 4.3 Training Pipeline

```python
class DisagreementTrainer:
    """
    Trainer per LegalDisagreementNet.

    Features:
    - Multi-task learning con loss pesate
    - Curriculum learning (binary → type → full)
    - Class balancing per tipi rari
    - Gradient accumulation per batch grandi
    - Early stopping con patience
    """

    def __init__(
        self,
        model: LegalDisagreementNet,
        config: TrainingConfig
    ):
        self.model = model
        self.config = config

        # Optimizer con learning rates differenziati
        self.optimizer = self._create_optimizer()

        # Loss function multi-task
        self.loss_fn = DisagreementLoss(
            task_weights=config.task_weights,
            class_weights=config.class_weights
        )

        # Scheduler
        self.scheduler = get_linear_schedule_with_warmup(
            self.optimizer,
            num_warmup_steps=config.warmup_steps,
            num_training_steps=config.total_steps
        )

    def _create_optimizer(self) -> torch.optim.Optimizer:
        """
        Optimizer con learning rate differenziati:
        - Encoder (frozen o low LR)
        - LoRA adapters (medium LR)
        - Prediction heads (high LR)
        """
        param_groups = [
            {
                "params": self.model.encoder.parameters(),
                "lr": self.config.encoder_lr,  # 1e-6 o 0 se frozen
            },
            {
                "params": self.model.lora_adapters.parameters(),
                "lr": self.config.lora_lr,  # 1e-4
            },
            {
                "params": self.model.prediction_heads.parameters(),
                "lr": self.config.heads_lr,  # 1e-3
            },
        ]

        return torch.optim.AdamW(
            param_groups,
            weight_decay=self.config.weight_decay
        )

    async def train_epoch(
        self,
        dataloader: DataLoader,
        epoch: int
    ) -> Dict[str, float]:
        """Training di una epoch."""
        self.model.train()

        epoch_losses = defaultdict(float)

        for batch in tqdm(dataloader, desc=f"Epoch {epoch}"):
            # Forward
            predictions = self.model(batch)

            # Compute losses
            losses = self.loss_fn(predictions, batch.labels)

            # Backward
            losses["total"].backward()

            # Gradient clipping
            torch.nn.utils.clip_grad_norm_(
                self.model.parameters(),
                self.config.max_grad_norm
            )

            # Optimizer step
            self.optimizer.step()
            self.scheduler.step()
            self.optimizer.zero_grad()

            # Accumulate losses
            for k, v in losses.items():
                epoch_losses[k] += v.item()

        # Average
        for k in epoch_losses:
            epoch_losses[k] /= len(dataloader)

        return dict(epoch_losses)

    async def evaluate(
        self,
        dataloader: DataLoader
    ) -> DisagreementMetrics:
        """Valutazione su validation set."""
        self.model.eval()

        all_predictions = []
        all_labels = []

        with torch.no_grad():
            for batch in dataloader:
                predictions = self.model(batch)
                all_predictions.append(predictions)
                all_labels.append(batch.labels)

        # Compute metrics
        return compute_disagreement_metrics(all_predictions, all_labels)
```

---

## Parte V: Integrazione con Sistema MERL-T

### 5.1 Posizione nel Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MERL-T Interpretation Pipeline                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. QUERY                                                                   │
│     │                                                                       │
│     ▼                                                                       │
│  2. ROUTING (θ_gating neurale)                                             │
│     │                                                                       │
│     ▼                                                                       │
│  3. EXPERT EXECUTION (parallel)                                            │
│     ├── LiteralExpert ──────────────────┐                                  │
│     ├── SystemicExpert ─────────────────┤                                  │
│     ├── PrinciplesExpert ───────────────┼──────┐                           │
│     └── PrecedentExpert ────────────────┘      │                           │
│                                                 │                           │
│                                                 ▼                           │
│  4. ╔═══════════════════════════════════════════════════════╗              │
│     ║  DISAGREEMENT DETECTION (LegalDisagreementNet)         ║              │
│     ║                                                         ║              │
│     ║  Input: 4 ExpertResponse                               ║              │
│     ║  Output: DisagreementAnalysis + Explanation            ║              │
│     ║                                                         ║              │
│     ║  → Determina: CONVERGENT vs DIVERGENT mode             ║              │
│     ╚═══════════════════════════════════════════════════════╝              │
│                                                 │                           │
│                                                 ▼                           │
│  5. SYNTHESIS                                                               │
│     ├── IF convergent: integra prospettive                                 │
│     └── IF divergent:  presenta alternative con explanation                │
│                                                 │                           │
│                                                 ▼                           │
│  6. RLCF FEEDBACK                                                          │
│     │                                                                       │
│     ├── User valuta risposta                                               │
│     ├── Active Learning seleziona per annotazione                          │
│     └── Online Learning aggiorna modello                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 API del Modulo

```python
# merlt/disagreement/__init__.py

from merlt.disagreement.detector import LegalDisagreementNet
from merlt.disagreement.explainer import ExplainabilityModule
from merlt.disagreement.active_learning import ActiveLearningManager
from merlt.disagreement.types import (
    DisagreementType,
    DisagreementLevel,
    DisagreementAnalysis,
    DisagreementExplanation,
)

__all__ = [
    "LegalDisagreementNet",
    "ExplainabilityModule",
    "ActiveLearningManager",
    "DisagreementType",
    "DisagreementLevel",
    "DisagreementAnalysis",
    "DisagreementExplanation",
]


# Esempio di utilizzo
async def analyze_expert_disagreement(
    query: str,
    expert_responses: List[ExpertResponse]
) -> Tuple[DisagreementAnalysis, DisagreementExplanation]:
    """
    Analizza disagreement tra expert responses.

    Returns:
        Tuple di (analisi strutturata, spiegazione naturale)
    """
    # Load model (singleton)
    detector = get_disagreement_detector()
    explainer = get_explainability_module()
    active_learning = get_active_learning_manager()

    # Prepare input
    inputs = prepare_inputs(query, expert_responses)

    # Detect disagreement
    predictions = detector(inputs)

    # Generate explanation
    explanation = explainer.explain(inputs, predictions, expert_responses)

    # Check for active learning
    await active_learning.on_new_prediction(
        sample=DisagreementSample.from_responses(query, expert_responses),
        predictions=predictions,
        embedding=detector.get_embedding(inputs)
    )

    return predictions.to_analysis(), explanation
```

---

## Parte VI: Roadmap Implementazione

### Timeline

| Fase | Durata | Deliverable |
|------|--------|-------------|
| **0. Infrastructure** | 1 settimana | Data collection pipeline, schema DB |
| **1. Binary Detection** | 2-3 settimane | Modello base, >85% accuracy |
| **2. Type Classification** | 2-3 settimane | 6 classi, >70% accuracy |
| **3. Explainability** | 2 settimane | Token attribution, template generation |
| **4. Active Learning** | 2 settimane | Integration con RLCF UI |
| **5. Full Multi-Task** | 3-4 settimane | End-to-end training, evaluation |
| **6. Paper** | 4+ settimane | Scrittura, submission |

### File da Creare

```
merlt/
├── disagreement/
│   ├── __init__.py
│   ├── types.py              # Enums, dataclasses
│   ├── detector.py           # LegalDisagreementNet
│   ├── encoder.py            # Legal-BERT + LoRA
│   ├── heads.py              # Prediction heads
│   ├── explainer.py          # ExplainabilityModule
│   ├── active_learning.py    # ActiveLearningManager
│   ├── loss.py               # DisagreementLoss
│   ├── trainer.py            # DisagreementTrainer
│   ├── data/
│   │   ├── collector.py      # Data collection pipeline
│   │   ├── dataset.py        # PyTorch Dataset
│   │   └── augmentation.py   # Data augmentation
│   └── evaluation/
│       ├── metrics.py        # DisagreementMetrics
│       └── human_eval.py     # Human evaluation tools

tests/
├── disagreement/
│   ├── test_detector.py
│   ├── test_explainer.py
│   ├── test_active_learning.py
│   └── test_integration.py
```

---

## Appendice A: Riferimenti Teorici

### A.1 Canoni Interpretativi

- **Art. 12 disp. prel. c.c.** - Interpretazione della legge
- **Art. 13 disp. prel. c.c.** - Applicazione delle leggi penali e delle leggi eccezionali
- **Art. 14 disp. prel. c.c.** - Applicazione delle norme corporative

### A.2 Criteri di Soluzione delle Antinomie

1. **Lex posterior derogat priori** - La legge successiva prevale
2. **Lex specialis derogat generali** - La legge speciale prevale
3. **Lex superior derogat inferiori** - La legge gerarchicamente superiore prevale

### A.3 Letteratura di Riferimento

- Tarello, G. (1980). L'interpretazione della legge. Giuffrè.
- Guastini, R. (2011). Interpretare e argomentare. Giuffrè.
- Betti, E. (1990). Interpretazione della legge e degli atti giuridici. Giuffrè.

---

## Appendice B: Modelli Pre-trained Disponibili

| Modello | Source | Lingua | Domain |
|---------|--------|--------|--------|
| `dlicari/Italian-Legal-BERT` | HuggingFace | IT | Legal |
| `dbmdz/bert-base-italian-xxl-cased` | HuggingFace | IT | General |
| `Musixmatch/umberto-commoncrawl-cased-v1` | HuggingFace | IT | General |
| `nlpaueb/legal-bert-base-uncased` | HuggingFace | EN | Legal |

---

*Documento generato come parte del progetto MERL-T v2 Recovery.*
*Per domande: vedere docs/claude-context/ per contesto aggiornato.*
