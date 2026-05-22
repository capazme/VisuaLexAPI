# Piano Recupero Architettura v2 Completa

> **Versione**: 1.0
> **Data**: 28 Dicembre 2025
> **Obiettivo**: Recuperare TUTTE le feature v2 mantenendo le aggiunte positive v3 (ReAct)

---

## Executive Summary

L'architettura v2 teorica (docs/) è più rigorosa sia dal punto di vista informatico che giuridico rispetto all'implementazione v3 attuale. Questo documento definisce il piano per recuperare TUTTE le feature v2 mancanti.

### Feature da Recuperare

| # | Feature | Importanza Giuridica | Importanza Informatica | Stato |
|---|---------|---------------------|------------------------|-------|
| 1 | RLCF Multilivello | 🔴 CRITICA | 🔴 CRITICA | ⬜ TODO |
| 2 | θ_traverse Apprendibili | 🟡 ALTA | 🔴 CRITICA | ⬜ TODO |
| 3 | θ_gating Neurale | 🟡 ALTA | 🔴 CRITICA | ⬜ TODO |
| 4 | Tools Specifici Expert | 🔴 CRITICA | 🟡 ALTA | ⬜ TODO |
| 5 | Synthesizer Modes | 🟡 ALTA | 🟡 ALTA | ⬜ TODO |
| 6 | Policy Gradient Training | 🟡 ALTA | 🔴 CRITICA | ⬜ TODO |

### Feature v3 da MANTENERE

| Feature | Motivazione |
|---------|-------------|
| ReAct Pattern | Superiore a tools hardcoded - LLM decide dinamicamente |
| Query Analyzer | Buona estrazione entità |
| Source Type Filtering | Specializzazione retrieval per expert |

---

## FASE 1: RLCF Multilivello

### Motivazione Giuridica

Il diritto italiano è diviso in rami specialistici:
- **Civile**: obbligazioni, contratti, famiglia, successioni
- **Penale**: reati, pene, procedura penale
- **Amministrativo**: PA, appalti, urbanistica
- **Costituzionale**: diritti fondamentali, organizzazione stato
- **Lavoro**: rapporto di lavoro, previdenza
- **Commerciale**: società, fallimento, titoli di credito

Un professore di diritto penale NON ha la stessa competenza sul diritto del lavoro. Il feedback deve essere pesato per competenza specifica.

### Motivazione Informatica

Senza multilivello:
- Non distingui "retrieval sbagliato" da "reasoning sbagliato"
- Il sistema non sa COSA migliorare
- Confonde correlazioni spurie
- Feedback granulare impossibile

### Schema Dati

```python
@dataclass
class UserProfile:
    user_id: int
    base_authority: float = 0.5

    # NUOVO: Authority per dominio giuridico
    domain_authority: Dict[str, float] = field(default_factory=lambda: {
        "civile": 0.5,
        "penale": 0.5,
        "amministrativo": 0.5,
        "costituzionale": 0.5,
        "lavoro": 0.5,
        "commerciale": 0.5,
        "tributario": 0.5,
        "internazionale": 0.5,
    })

    # NUOVO: Authority per livello pipeline
    level_authority: Dict[str, float] = field(default_factory=lambda: {
        "retrieval": 0.5,    # Bravo a valutare se le fonti sono rilevanti?
        "reasoning": 0.5,    # Bravo a valutare se l'interpretazione è corretta?
        "synthesis": 0.5,    # Bravo a valutare se la sintesi è chiara?
    })
```

### Formula Calcolo Authority

```python
def calculate_effective_authority(
    user: UserProfile,
    domain: str,
    level: str
) -> float:
    """
    Authority effettiva = base × domain_factor × level_factor

    Es: Un penalista (domain_authority["penale"]=0.9) che dà feedback
    sul retrieval (level_authority["retrieval"]=0.7) per una query penale:

    effective = 0.5 × 0.9 × 0.7 = 0.315

    Lo stesso utente su civile (domain_authority["civile"]=0.3):
    effective = 0.5 × 0.3 × 0.7 = 0.105
    """
    base = user.base_authority
    domain_factor = user.domain_authority.get(domain, 0.5)
    level_factor = user.level_authority.get(level, 0.5)

    return base * domain_factor * level_factor
```

### File da Modificare

- [ ] `merlt/rlcf/simulator/users.py` - UserProfile con domain/level authority
- [ ] `merlt/rlcf/authority.py` - AuthorityModule con calcolo multilivello
- [ ] `merlt/rlcf/database.py` - Schema feedback con domain/level
- [ ] `merlt/rlcf/simulator/experiment.py` - Tracking per domain/level

### Test

- [ ] Test che penalista ha più peso su feedback penale
- [ ] Test che retrieval expert ha più peso su feedback retrieval
- [ ] Test update authority per domain specifico
- [ ] Test persistenza domain/level authority

---

## FASE 2: θ_traverse Apprendibili

### Motivazione Giuridica

Ogni canone ermeneutico privilegia relazioni diverse:
- **Letterale**: DEFINISCE, CONTIENE, RINVIA (testo e struttura)
- **Sistematico**: MODIFICA, ABROGA, DEROGA (evoluzione storica)
- **Teleologico**: ATTUA, ESPRIME, BILANCIA (principi)
- **Precedenti**: INTERPRETA, APPLICA, OVERRULES (giurisprudenza)

I pesi devono ADATTARSI all'esperienza: se un certo tipo di relazione porta sistematicamente a fonti utili, il peso deve aumentare.

### Motivazione Informatica

Pesi statici = sistema che non apprende. Dopo 1000 feedback, il sistema è identico al giorno 1. Viola il principio base del machine learning.

### Architettura

```python
class LearnableTraversalWeights:
    """
    Pesi apprendibili per traversal grafo, specifici per expert.

    Persistiti in WeightStore (PostgreSQL).
    Aggiornati con feedback RLCF.
    """

    RELATIONS = [
        "contiene", "definisce", "disciplina", "rinvia", "cita",
        "modifica", "abroga", "deroga", "sostituisce",
        "interpreta", "applica", "estende", "conferma", "supera",
        "attua", "esprime", "bilancia", "limita"
    ]

    # Prior basati su domain knowledge giuridico
    EXPERT_PRIORS = {
        "literal": {
            "contiene": 1.0, "definisce": 0.95, "disciplina": 0.95,
            "rinvia": 0.90, "cita": 0.75,
            "modifica": 0.70, "interpreta": 0.50,
        },
        "systemic": {
            "modifica": 0.95, "abroga": 0.90, "deroga": 0.90,
            "sostituisce": 0.85, "rinvia": 0.80,
            "contiene": 0.70, "interpreta": 0.75,
        },
        "principles": {
            "attua": 0.95, "esprime": 0.95, "bilancia": 0.95,
            "limita": 0.90, "deroga": 0.85,
            "interpreta": 0.70,
        },
        "precedent": {
            "interpreta": 1.0, "applica": 0.95, "conferma": 0.90,
            "supera": 0.90, "estende": 0.85, "cita": 0.80,
        },
    }

    def __init__(self, expert_type: str, store: WeightStore):
        self.expert_type = expert_type
        self.store = store
        self.weights = self._load_or_init()
        self.update_history = []

    async def update_from_feedback(
        self,
        feedback: TraversalFeedback,
        authority: float
    ):
        """
        Aggiorna pesi basandosi su feedback.

        Args:
            feedback: Quali relazioni erano utili/inutili
            authority: Authority effettiva dell'utente (già multilivello)
        """
        learning_rate = 0.1

        for relation, was_useful in feedback.relations_used.items():
            if relation not in self.weights:
                continue

            # Delta pesato per authority
            if was_useful:
                delta = learning_rate * authority
            else:
                delta = -learning_rate * authority * 0.5  # Penalità minore

            # Applica con clipping
            old_value = self.weights[relation]
            new_value = max(0.1, min(1.0, old_value + delta))
            self.weights[relation] = new_value

            # Track history
            self.update_history.append({
                "timestamp": datetime.now().isoformat(),
                "relation": relation,
                "old_value": old_value,
                "new_value": new_value,
                "delta": delta,
                "authority": authority,
            })

        # Persisti
        await self.store.save_expert_weights(self.expert_type, self.weights)
```

### File da Creare/Modificare

- [ ] `merlt/weights/learnable_traversal.py` - NUOVO: LearnableTraversalWeights
- [ ] `merlt/experts/base.py` - Integrazione con learnable weights
- [ ] `merlt/weights/store.py` - Metodi per expert weights
- [ ] `merlt/rlcf/orchestrator.py` - Trigger update dopo feedback

### Test

- [ ] Test inizializzazione da prior
- [ ] Test update con feedback positivo (peso aumenta)
- [ ] Test update con feedback negativo (peso diminuisce)
- [ ] Test clipping [0.1, 1.0]
- [ ] Test persistenza e reload

---

## FASE 3: θ_gating Neurale

### Motivazione Giuridica

Query diverse richiedono expert diversi:
- "Cos'è il contratto?" → Literal (definizione)
- "Come si è evoluta la disciplina?" → Systemic (storico)
- "È costituzionalmente legittimo?" → Principles
- "Qual è l'orientamento della Cassazione?" → Precedent

Regex cattura casi semplici, ma query complesse richiedono comprensione semantica.

### Motivazione Informatica

Mixture of Experts (MoE) richiede gating neurale per essere un vero MoE. È lo standard architetturale.

### Architettura

```python
class NeuralGatingNetwork(nn.Module):
    """
    Rete neurale per routing query → expert weights.

    Input: Query embedding (1024-dim da E5-large)
    Output: Softmax su 4 expert

    Training: RLCF feedback "quale expert aveva ragione"
    """

    def __init__(self, input_dim=1024, hidden_dim=256, num_experts=4):
        super().__init__()

        # Query encoder
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 512),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(512, hidden_dim),
            nn.ReLU(),
        )

        # Gating head
        self.gate = nn.Linear(hidden_dim, num_experts)

        # Learnable bias per expert (prior giuridico)
        self.expert_bias = nn.Parameter(torch.tensor([
            0.35,  # literal (default più alto)
            0.25,  # systemic
            0.20,  # principles
            0.20,  # precedent
        ]))

        self.optimizer = None  # Inizializzato in setup_training

    def forward(self, query_embedding: torch.Tensor) -> torch.Tensor:
        """
        Args:
            query_embedding: [batch, 1024]

        Returns:
            expert_weights: [batch, 4] (softmax)
        """
        encoded = self.encoder(query_embedding)
        logits = self.gate(encoded) + self.expert_bias
        return F.softmax(logits, dim=-1)

    def predict_with_confidence(self, query_embedding: torch.Tensor):
        """Predizione con confidence score."""
        with torch.no_grad():
            weights = self.forward(query_embedding)
            max_weight = weights.max(dim=-1).values
            entropy = -(weights * weights.log()).sum(dim=-1)
            confidence = max_weight * (1 - entropy / np.log(4))
        return weights, confidence

    def update_from_feedback(
        self,
        query_embedding: torch.Tensor,
        expert_correctness: Dict[str, bool],
        authority: float
    ):
        """
        Training step con feedback RLCF.

        Args:
            query_embedding: Embedding della query
            expert_correctness: {expert_type: True/False}
            authority: Authority dell'utente
        """
        self.optimizer.zero_grad()

        # Forward
        predicted = self.forward(query_embedding.unsqueeze(0))

        # Target: expert corretti = 1.0, sbagliati = 0.0
        target = torch.tensor([
            1.0 if expert_correctness.get(exp, False) else 0.0
            for exp in ["literal", "systemic", "principles", "precedent"]
        ])
        target = F.softmax(target * 2, dim=-1)  # Soft target

        # Loss pesata per authority
        loss = authority * F.kl_div(
            predicted.log(),
            target.unsqueeze(0),
            reduction='batchmean'
        )

        loss.backward()
        self.optimizer.step()

        return loss.item()
```

### Integrazione con ExpertRouter

```python
class HybridExpertRouter:
    """
    Router ibrido: neural + regex fallback.

    Usa neural gating se confidence > threshold,
    altrimenti fallback a regex patterns.
    """

    def __init__(
        self,
        neural_gating: NeuralGatingNetwork,
        regex_router: ExpertRouter,
        confidence_threshold: float = 0.6
    ):
        self.neural = neural_gating
        self.regex = regex_router
        self.threshold = confidence_threshold

    async def route(self, context: ExpertContext) -> RoutingDecision:
        # Step 1: Prova neural
        if context.query_embedding is not None:
            embedding = torch.tensor(context.query_embedding)
            weights, confidence = self.neural.predict_with_confidence(embedding)

            if confidence > self.threshold:
                return RoutingDecision(
                    expert_weights={
                        "literal": weights[0].item(),
                        "systemic": weights[1].item(),
                        "principles": weights[2].item(),
                        "precedent": weights[3].item(),
                    },
                    query_type="neural",
                    confidence=confidence.item(),
                    reasoning="Neural gating",
                )

        # Step 2: Fallback a regex
        return await self.regex.route(context)
```

### File da Creare/Modificare

- [ ] `merlt/experts/neural_gating.py` - NUOVO: NeuralGatingNetwork
- [ ] `merlt/experts/router.py` - HybridExpertRouter
- [ ] `merlt/experts/orchestrator.py` - Integrazione hybrid router
- [ ] `merlt/weights/store.py` - Save/load PyTorch checkpoint

### Test

- [ ] Test forward pass shape
- [ ] Test training step (loss decresce)
- [ ] Test hybrid routing (neural + fallback)
- [ ] Test persistenza checkpoint

---

## FASE 4: Tools Specifici per Expert

### Motivazione Giuridica

Ogni canone ermeneutico (art. 12-14 Preleggi) richiede fonti diverse:

| Canone | Fonti Primarie | Tools Necessari |
|--------|---------------|-----------------|
| Letterale | Testo norma, definizioni | get_exact_text, get_definitions |
| Sistematico | Storia legislativa, norme collegate | get_legislative_history, get_system_context |
| Teleologico | Ratio legis, principi | get_ratio_legis, find_principle_conflicts |
| Precedenti | Giurisprudenza | search_cases, get_citation_chain |

### Motivazione Informatica

Tools specifici permettono retrieval più preciso e riducono rumore.

### Tools da Implementare

#### 4.1 LiteralExpert Tools

```python
class GetExactTextTool(BaseTool):
    """Ottiene il testo esatto di un articolo."""
    name = "get_exact_text"
    description = "Recupera il testo letterale di un articolo di legge dato l'URN"

    async def execute(self, urn: str) -> ToolResult:
        # Query FalkorDB per nodo articolo
        query = """
        MATCH (a:Articolo {urn: $urn})
        RETURN a.testo as testo, a.rubrica as rubrica
        """
        result = await self.graph_db.query(query, {"urn": urn})
        ...

class GetDefinitionsTool(BaseTool):
    """Trova definizioni legali di un termine."""
    name = "get_definitions"
    description = "Cerca definizioni legali di un termine giuridico"

    async def execute(self, term: str) -> ToolResult:
        # Query per nodi Definizione collegati al termine
        query = """
        MATCH (d:Definizione)-[:DEFINISCE]->(c:Concetto)
        WHERE toLower(c.nome) CONTAINS toLower($term)
        RETURN d.testo, d.fonte, c.nome
        """
        ...

class FollowReferencesTool(BaseTool):
    """Segue i rinvii normativi."""
    name = "follow_references"
    description = "Segue i rinvii normativi da un articolo"

    async def execute(self, urn: str, max_depth: int = 2) -> ToolResult:
        query = """
        MATCH path = (a:Articolo {urn: $urn})-[:RINVIA*1..2]->(b:Articolo)
        RETURN path
        """
        ...
```

#### 4.2 SystemicExpert Tools

```python
class GetLegislativeHistoryTool(BaseTool):
    """Ottiene la storia legislativa di una norma."""
    name = "get_legislative_history"
    description = "Recupera le modifiche storiche di un articolo"

    async def execute(self, urn: str) -> ToolResult:
        query = """
        MATCH (a:Articolo {urn: $urn})<-[:MODIFICA|SOSTITUISCE|ABROGA]-(mod)
        RETURN mod ORDER BY mod.data_vigenza DESC
        """
        ...

class GetSystemContextTool(BaseTool):
    """Ottiene il contesto sistematico."""
    name = "get_system_context"
    description = "Trova norme che regolano la stessa materia"

    async def execute(self, urn: str) -> ToolResult:
        # Trova norme nello stesso Capo/Titolo/Libro
        query = """
        MATCH (a:Articolo {urn: $urn})-[:PARTE_DI]->(s:Sezione)-[:PARTE_DI]->(c:Capo)
        MATCH (c)<-[:PARTE_DI]-(s2:Sezione)<-[:PARTE_DI]-(a2:Articolo)
        RETURN a2
        """
        ...
```

#### 4.3 PrinciplesExpert Tools

```python
class GetConstitutionalBasisTool(BaseTool):
    """Trova la base costituzionale."""
    name = "get_constitutional_basis"
    description = "Trova gli articoli della Costituzione rilevanti"

    async def execute(self, concept: str) -> ToolResult:
        # Search semantico su Costituzione + graph per ATTUA
        ...

class FindPrincipleConflictsTool(BaseTool):
    """Identifica principi in conflitto."""
    name = "find_principle_conflicts"
    description = "Trova principi costituzionali potenzialmente in conflitto"

    async def execute(self, situation: str) -> ToolResult:
        # Analisi semantica per individuare diritti in tensione
        ...
```

#### 4.4 PrecedentExpert Tools

```python
class SearchCasesTool(BaseTool):
    """Cerca sentenze per argomento."""
    name = "search_cases"
    description = "Cerca sentenze della Cassazione su un argomento"

    async def execute(
        self,
        query: str,
        court: str = "cassazione",
        years: Optional[Tuple[int, int]] = None
    ) -> ToolResult:
        # Search semantico su massime con filtri
        ...

class GetCitationChainTool(BaseTool):
    """Ottiene la catena di citazioni."""
    name = "get_citation_chain"
    description = "Ricostruisce la catena di precedenti citati"

    async def execute(self, case_id: str) -> ToolResult:
        query = """
        MATCH path = (s:Sentenza {id: $case_id})-[:CITA*1..3]->(p:Sentenza)
        RETURN path
        """
        ...

class FindOverrulingTool(BaseTool):
    """Verifica se una sentenza è stata superata."""
    name = "find_overruling"
    description = "Verifica se un orientamento giurisprudenziale è stato superato"

    async def execute(self, case_id: str) -> ToolResult:
        query = """
        MATCH (s:Sentenza {id: $case_id})<-[:SUPERA|OVERRULES]-(newer:Sentenza)
        RETURN newer ORDER BY newer.data DESC
        """
        ...
```

### File da Creare

- [ ] `merlt/tools/literal/` - get_exact_text.py, get_definitions.py, follow_references.py
- [ ] `merlt/tools/systemic/` - get_legislative_history.py, get_system_context.py
- [ ] `merlt/tools/principles/` - get_constitutional_basis.py, find_principle_conflicts.py
- [ ] `merlt/tools/precedent/` - search_cases.py, get_citation_chain.py, find_overruling.py
- [ ] `merlt/experts/{type}.py` - Integrazione tools specifici

### Test

- [ ] Test per ogni tool (input/output)
- [ ] Test integrazione con ReAct (LLM può chiamare i tools)
- [ ] Test che expert giusto ha tools giusti

---

## FASE 5: Synthesizer Convergent/Divergent

### Motivazione Giuridica

Nel diritto esistono:
- **Questioni pacifiche**: tutti concordano → enfatizza consenso
- **Questioni controverse**: interpretazioni divergenti → il disaccordo è informazione utile!

Forzare consenso quando non c'è è SBAGLIATO giuridicamente.

### Motivazione Informatica

Due modalità permettono risposte più appropriate e calibrazione migliore della confidence.

### Algoritmo Agreement Score

```python
def compute_agreement_score(
    interpretations: List[str],
    embedding_service: EmbeddingService
) -> float:
    """
    Calcola quanto gli expert concordano.

    Metodo: Semantic similarity media tra tutte le coppie.

    Returns:
        0.0 = completo disaccordo
        1.0 = completo accordo
    """
    if len(interpretations) < 2:
        return 1.0

    # Embed tutte le interpretazioni
    embeddings = [
        embedding_service.encode(interp)
        for interp in interpretations
    ]

    # Calcola similarity tra tutte le coppie
    similarities = []
    for i in range(len(embeddings)):
        for j in range(i + 1, len(embeddings)):
            sim = cosine_similarity(embeddings[i], embeddings[j])
            similarities.append(sim)

    return np.mean(similarities)
```

### Modalità Convergent

```python
CONVERGENT_PROMPT = """
Gli Expert CONCORDANO sulla questione. Sintetizza integrando i loro contributi:

- **LiteralExpert**: fornisce BASE TESTUALE (cosa dice la norma)
- **SystemicExpert**: fornisce CONTESTO e RATIO (perché e come si integra)
- **PrinciplesExpert**: fornisce INQUADRAMENTO COSTITUZIONALE (se rilevante)
- **PrecedentExpert**: fornisce CONFERMA GIURISPRUDENZIALE (come applicato)

## Struttura Risposta

1. **Conclusione** (punto di consenso)
2. **Base normativa** (da Literal)
3. **Ratio e contesto sistematico** (da Systemic)
4. **Inquadramento costituzionale** (da Principles, se rilevante)
5. **Conferma giurisprudenziale** (da Precedent)
6. **Confidence**: ALTA (c'è consenso)

## Fonti
Cita le fonti su cui TUTTI gli expert concordano.
"""
```

### Modalità Divergent

```python
DIVERGENT_PROMPT = """
Gli Expert DIVERGONO sulla questione. Il disaccordo è INFORMAZIONE UTILE.

⚠️ NON forzare un consenso artificiale.
⚠️ Presenta onestamente le diverse prospettive.

## Struttura Risposta

1. **Quadro della questione** (cosa si chiede, perché è controversa)

2. **PROSPETTIVA LETTERALE**
   - Interpretazione: ...
   - Fondamento: ...
   - Punti di forza: ...
   - Limiti: ...

3. **PROSPETTIVA SISTEMATICA**
   - Interpretazione: ...
   - Fondamento: ...
   - Punti di forza: ...
   - Limiti: ...

4. **PROSPETTIVA DEI PRINCIPI**
   - Interpretazione: ...
   - Fondamento: ...
   - Punti di forza: ...
   - Limiti: ...

5. **PROSPETTIVA GIURISPRUDENZIALE**
   - Interpretazione: ...
   - Fondamento: ...
   - Punti di forza: ...
   - Limiti: ...

6. **Indicazione**: quale prospettiva appare più solida e PERCHÉ
7. **Confidence**: PIÙ BASSA per riflettere l'incertezza

## Nota
L'utente deve capire che esistono più letture legittime.
La scelta finale spetta all'interprete nel caso concreto.
"""
```

### File da Modificare

- [ ] `merlt/experts/gating.py` - Aggiungere compute_agreement_score
- [ ] `merlt/experts/gating.py` - Modalità convergent/divergent
- [ ] `merlt/experts/config/synthesis_prompts.yaml` - Prompt esternalizzati

### Test

- [ ] Test agreement score con interpretazioni simili → alto
- [ ] Test agreement score con interpretazioni diverse → basso
- [ ] Test scelta modalità corretta
- [ ] Test confidence adjustment

---

## FASE 6: Policy Gradient Training

### Motivazione

I pesi apprendibili (θ_traverse, θ_gating) richiedono un training loop robusto basato su RLCF feedback.

### Architettura Training

```python
class PolicyGradientTrainer:
    """
    Training loop per pesi apprendibili.

    Usa REINFORCE con baseline per variance reduction.
    Training batch (non online) per stabilità.
    """

    def __init__(
        self,
        gating_network: NeuralGatingNetwork,
        traversal_weights: Dict[str, LearnableTraversalWeights],
        config: TrainingConfig
    ):
        self.gating = gating_network
        self.traversal = traversal_weights
        self.config = config
        self.baseline = 0.5  # Running average reward

    def compute_reward(
        self,
        feedback: RLCFFeedback,
        authority: float
    ) -> float:
        """
        Calcola reward da feedback.

        reward = authority * (rating - baseline)

        Usiamo rating - baseline per variance reduction:
        - Se rating > baseline → reward positivo → rinforza azione
        - Se rating < baseline → reward negativo → penalizza azione
        """
        rating = feedback.rating  # 0-1
        reward = authority * (rating - self.baseline)

        # Update baseline (exponential moving average)
        self.baseline = 0.9 * self.baseline + 0.1 * rating

        return reward

    async def training_step(
        self,
        batch: List[FeedbackRecord]
    ) -> Dict[str, float]:
        """
        Un passo di training su un batch di feedback.

        Returns:
            Metriche: loss, reward_mean, etc.
        """
        total_gating_loss = 0.0
        total_traversal_updates = 0
        rewards = []

        for record in batch:
            # Calcola authority multilivello
            authority = calculate_effective_authority(
                record.user,
                record.domain,
                record.level
            )

            # Calcola reward
            reward = self.compute_reward(record.feedback, authority)
            rewards.append(reward)

            # Update gating network
            if record.query_embedding is not None:
                gating_loss = self.gating.update_from_feedback(
                    torch.tensor(record.query_embedding),
                    record.expert_correctness,
                    authority
                )
                total_gating_loss += gating_loss

            # Update traversal weights
            for expert_type, traversal_feedback in record.traversal_feedbacks.items():
                if expert_type in self.traversal:
                    await self.traversal[expert_type].update_from_feedback(
                        traversal_feedback,
                        authority
                    )
                    total_traversal_updates += 1

        return {
            "gating_loss": total_gating_loss / len(batch),
            "reward_mean": np.mean(rewards),
            "reward_std": np.std(rewards),
            "traversal_updates": total_traversal_updates,
            "baseline": self.baseline,
        }

    async def train_epoch(
        self,
        feedback_records: List[FeedbackRecord],
        batch_size: int = 32
    ) -> Dict[str, float]:
        """
        Training su tutti i feedback disponibili.
        """
        # Shuffle
        random.shuffle(feedback_records)

        epoch_metrics = []
        for i in range(0, len(feedback_records), batch_size):
            batch = feedback_records[i:i + batch_size]
            metrics = await self.training_step(batch)
            epoch_metrics.append(metrics)

        # Aggregate
        return {
            key: np.mean([m[key] for m in epoch_metrics])
            for key in epoch_metrics[0].keys()
        }
```

### Scheduler e Hyperparameters

```python
@dataclass
class TrainingConfig:
    # Learning rates
    gating_lr: float = 1e-4
    traversal_lr: float = 0.1

    # Batch size
    batch_size: int = 32

    # Temporal discount (feedback vecchi contano meno)
    temporal_decay: float = 0.99  # Per giorno

    # Training frequency
    train_every_n_feedback: int = 100

    # Baseline momentum
    baseline_momentum: float = 0.9

    # Regularization
    weight_decay: float = 1e-5

    # Checkpointing
    save_every_n_epochs: int = 10
```

### File da Creare/Modificare

- [ ] `merlt/rlcf/training.py` - NUOVO: PolicyGradientTrainer
- [ ] `merlt/rlcf/orchestrator.py` - Integrazione training loop
- [ ] `merlt/rlcf/config/training.yaml` - Hyperparameters esternalizzati

### Test

- [ ] Test reward computation
- [ ] Test baseline update
- [ ] Test training step (loss decresce)
- [ ] Test temporal decay
- [ ] Test checkpointing

---

## Ordine di Implementazione

```
Fase 1: RLCF Multilivello
    ↓
Fase 2: θ_traverse Apprendibili
    ↓
Fase 3: θ_gating Neurale
    ↓
Fase 4: Tools Specifici Expert
    ↓
Fase 5: Synthesizer Modes
    ↓
Fase 6: Policy Gradient Training
```

Le fasi 1-3 sono propedeutiche perché:
- Fase 1 fornisce authority multilivello usata in Fase 2, 3, 6
- Fase 2-3 forniscono pesi apprendibili usati in Fase 6
- Fase 4-5 sono indipendenti ma completano il sistema

---

## Metriche di Successo

| Fase | Metrica | Target |
|------|---------|--------|
| 1 | Authority granularity | Domain × Level authority tracked |
| 2 | Traversal learning | Pesi convergono dopo N feedback |
| 3 | Gating accuracy | >70% accuracy su query type |
| 4 | Tool usage | Expert usa tools appropriati |
| 5 | Mode selection | Convergent/Divergent corretto |
| 6 | Training convergence | Loss decresce, reward aumenta |

---

## Rischi e Mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| Overfitting su pochi feedback | Temporal decay, regularization |
| Feedback rumoroso | Authority weighting, baseline |
| Cold start | Prior giuridici iniziali |
| Instabilità training | Batch training, clipping |

---

*Documento generato il 28 Dicembre 2025*
*Versione 1.0*
