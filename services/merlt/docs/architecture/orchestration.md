# Orchestration Layer Architecture (v2)

**Version**: 2.0
**Status**: 🚧 IN RIPROGETTAZIONE
**Last Updated**: Dicembre 2025

> **Nota**: Questo documento descrive l'architettura v2 con Expert autonomi.
> Per l'architettura v1 (retrieval centralizzato), vedere `archive/v1-02-orchestration-layer.md`

---

## 1. Cambio di Paradigma: v1 → v2

### Architettura v1 (Deprecata)

```
Query → Router → [RETRIEVAL CENTRALIZZATO] → 4 Expert passivi → Synthesis
                        │
                        ▼
                 KG + API + Vector
                 (un set di risultati per tutti)
```

**Problemi v1**:
- Un expert Letterale e uno Teleologico ricevono gli stessi dati
- Nessuna specializzazione nel retrieval
- Impossibile apprendere strategie expert-specific

### Architettura v2 (Nuova)

```
Query → Router → 4 EXPERT CON TOOLS AUTONOMI → Synthesis
                        │
            ┌───────────┼───────────┐───────────┐
            ▼           ▼           ▼           ▼
       [Literal]   [Systemic]  [Principles] [Precedent]
       + tools     + tools      + tools      + tools
            │           │           │           │
            ▼           ▼           ▼           ▼
       Retrieval   Retrieval    Retrieval   Retrieval
       specifico   specifico    specifico   specifico
```

**Vantaggi v2**:
- Ogni expert cerca ciò che serve alla sua prospettiva
- Pesi di traversal apprendibili per expert
- Parallelizzazione naturale
- Feedback granulare per RLCF

---

## 2. Componenti

### 2.1 Router (Semplificato)

Il Router in v2 ha un ruolo più semplice: decide **quali expert attivare** e con quale priorità.

```python
class RouterV2:
    """
    Router semplificato per architettura v2.

    NON decide più il retrieval - quello è delegato agli expert.
    Decide solo:
    1. Quali expert attivare (tutti o subset)
    2. Pesi iniziali per il gating
    3. Parametri di iterazione
    """

    def route(self, query_context: QueryContext) -> RoutingDecision:
        # LLM analizza la query e decide
        return RoutingDecision(
            active_experts=["literal", "systemic", "principles", "precedent"],
            initial_weights=[0.25, 0.25, 0.25, 0.25],  # Gating può modificare
            max_iterations=3,
            stop_threshold=0.85
        )
```

### 2.2 Expert Gating Network (θ_gating)

**PESI APPRENDIBILI** che determinano quanto pesare ogni expert.

```python
class ExpertGatingNetwork(nn.Module):
    """
    Mixture of Experts gating per expert giuridici.

    Apprende da RLCF: se un expert ha spesso ragione per
    un tipo di query, il gating impara a pesarlo di più.
    """

    def __init__(self, input_dim=1024, num_experts=4):
        super().__init__()
        self.gate = nn.Sequential(
            nn.Linear(input_dim, 256),
            nn.ReLU(),
            nn.Linear(256, num_experts)
        )
        self.expert_bias = nn.Parameter(torch.zeros(num_experts))

    def forward(self, query_context: torch.Tensor) -> torch.Tensor:
        """Ritorna pesi softmax per ogni expert."""
        logits = self.gate(query_context) + self.expert_bias
        return F.softmax(logits, dim=-1)
```

### 2.3 Expert con Tools

Ogni expert ha:
1. **Prompt specializzato** per la sua prospettiva interpretativa
2. **Tools** per interrogare autonomamente le fonti
3. **Pesi di traversal** (θ_traverse) specifici

```python
class ExpertWithTools:
    """
    Expert autonomo con capacità di retrieval.

    Ogni expert ha tools per:
    - Interrogare il grafo (con pesi specifici)
    - Fare ricerca semantica (con filtri specifici)
    - Chiamare API esterne
    """

    def __init__(self, expert_type: str):
        self.expert_type = expert_type
        self.prompt = self._load_prompt(expert_type)
        self.tools = self._init_tools(expert_type)
        self.traversal_weights = self._init_traversal_weights(expert_type)

    def _init_tools(self, expert_type: str) -> List[Tool]:
        """Tools specifici per tipo di expert."""

        common_tools = [
            Tool("search_semantic", self.search_semantic),
            Tool("get_node_by_urn", self.get_node_by_urn),
        ]

        if expert_type == "literal":
            return common_tools + [
                Tool("get_exact_text", self.get_exact_text),
                Tool("get_definitions", self.get_definitions),
                Tool("follow_references", self.follow_references),
            ]

        elif expert_type == "systemic":
            return common_tools + [
                Tool("get_legislative_history", self.get_legislative_history),
                Tool("get_system_context", self.get_system_context),
                Tool("find_related_norms", self.find_related_norms),
            ]

        elif expert_type == "principles":
            return common_tools + [
                Tool("get_constitutional_basis", self.get_constitutional_basis),
                Tool("find_principle_conflicts", self.find_principle_conflicts),
                Tool("get_balancing_precedents", self.get_balancing_precedents),
            ]

        elif expert_type == "precedent":
            return common_tools + [
                Tool("search_cases", self.search_cases),
                Tool("get_citation_chain", self.get_citation_chain),
                Tool("find_overruling", self.find_overruling),
            ]

    async def analyze(self, query_context: QueryContext) -> ExpertOpinion:
        """
        L'expert analizza la query usando i suoi tools.

        Il processo:
        1. LLM riceve query + prompt specializzato
        2. LLM decide quali tools chiamare
        3. Tools fanno retrieval con pesi expert-specific
        4. LLM sintetizza in opinione
        """
        # Tool calling con LLM
        messages = [
            {"role": "system", "content": self.prompt},
            {"role": "user", "content": self._format_query(query_context)}
        ]

        response = await self.llm.chat(
            messages=messages,
            tools=self.tools,
            tool_choice="auto"
        )

        # Esegui tool calls
        while response.has_tool_calls():
            for tool_call in response.tool_calls:
                result = await self._execute_tool(tool_call)
                messages.append({"role": "tool", "content": result})

            response = await self.llm.chat(messages=messages, tools=self.tools)

        return self._parse_opinion(response)
```

---

## 3. Expert-Specific Traversal (θ_traverse)

Ogni expert ha pesi diversi per le relazioni nel grafo.

```python
class ExpertTraversalWeights:
    """
    Pesi di traversal specifici per ogni expert.

    Questi pesi sono APPRENDIBILI tramite RLCF:
    - Se un expert trova utili certe relazioni, i pesi aumentano
    - Se certe relazioni portano a risultati sbagliati, i pesi diminuiscono
    """

    # Relazioni nel grafo giuridico
    RELATIONS = [
        "DEFINISCE", "RINVIA", "CONTIENE",       # Strutturali
        "ABROGA", "MODIFICA", "SOSTITUISCE",     # Temporali
        "INTERPRETA", "APPLICA", "ESTENDE",      # Interpretative
        "DEROGA", "ATTUA", "BILANCIA",           # Principi
        "OVERRULES", "DISTINGUISHES", "CITA",    # Precedenti
    ]

    # Prior iniziali (domain knowledge)
    EXPERT_PRIORS = {
        "literal": {
            "DEFINISCE": 0.95, "RINVIA": 0.90, "CONTIENE": 0.85,
            "INTERPRETA": 0.50, "APPLICA": 0.40,  # Meno importante per letterale
        },
        "systemic": {
            "APPARTIENE": 0.95, "MODIFICA": 0.90, "DEROGA": 0.85,
            "INTERPRETA": 0.80, "ATTUA": 0.75,
        },
        "principles": {
            "ATTUA": 0.95, "DEROGA": 0.90, "BILANCIA": 0.95,
            "INTERPRETA": 0.70,
        },
        "precedent": {
            "INTERPRETA": 0.95, "OVERRULES": 0.95, "DISTINGUISHES": 0.90,
            "APPLICA": 0.85, "CITA": 0.75,
        },
    }
```

---

## 4. Flow di Esecuzione

```
EXECUTION FLOW v2
══════════════════════════════════════════════════════════════════

1. QUERY INPUT
   │
   ▼
2. PREPROCESSING (invariato da v1)
   │ - NER, intent, domain detection
   │ - KG enrichment base
   │
   ▼
3. ROUTER
   │ - Decide quali expert attivare
   │ - NON fa retrieval
   │
   ▼
4. GATING NETWORK (θ_gating)
   │ - Calcola pesi iniziali per expert
   │ - Input: query embedding
   │ - Output: [w_literal, w_systemic, w_principles, w_precedent]
   │
   ▼
5. EXPERT EXECUTION (PARALLELO)
   │
   ├─► LITERAL EXPERT
   │   ├─ Tools: get_exact_text, get_definitions, follow_references
   │   ├─ Traversal: θ_traverse_literal
   │   └─► ExpertOpinion_literal
   │
   ├─► SYSTEMIC EXPERT
   │   ├─ Tools: get_legislative_history, get_system_context
   │   ├─ Traversal: θ_traverse_systemic
   │   └─► ExpertOpinion_systemic
   │
   ├─► PRINCIPLES EXPERT
   │   ├─ Tools: get_constitutional_basis, find_principle_conflicts
   │   ├─ Traversal: θ_traverse_principles
   │   └─► ExpertOpinion_principles
   │
   └─► PRECEDENT EXPERT
       ├─ Tools: search_cases, get_citation_chain, find_overruling
       ├─ Traversal: θ_traverse_precedent
       └─► ExpertOpinion_precedent
   │
   ▼
6. SYNTHESIS
   │ - Combina opinioni pesate per gating weights
   │ - Identifica convergenza/divergenza
   │ - Genera risposta finale
   │
   ▼
7. OUTPUT + RLCF FEEDBACK COLLECTION
```

---

## 5. Integrazione con RLCF

Il feedback degli esperti RLCF aggiorna:

| Componente | Pesi | Feedback Necessario |
|------------|------|---------------------|
| θ_gating | Gating network | "Quale expert aveva ragione?" |
| θ_traverse_* | Traversal per expert | "Le fonti trovate erano rilevanti?" |
| θ_rerank | Re-ranker (se presente) | "Il ranking era corretto?" |

```python
# Esempio: Update dei pesi dopo feedback
def update_from_feedback(feedback: RLCFFeedback):
    # 1. Aggiorna gating
    if feedback.expert_correctness:
        loss = gating_network.compute_loss(
            predicted_weights=feedback.gating_weights_used,
            expert_correctness=feedback.expert_correctness,
            expert_authority=feedback.expert_authority
        )
        loss.backward()
        gating_optimizer.step()

    # 2. Aggiorna traversal dell'expert che ha risposto
    for expert_type, was_relevant in feedback.retrieval_relevance.items():
        traversal_loss = compute_traversal_loss(
            expert_type=expert_type,
            relations_used=feedback.relations_used[expert_type],
            was_relevant=was_relevant,
            authority=feedback.expert_authority
        )
        traversal_loss.backward()
        traversal_optimizers[expert_type].step()
```

---

## 6. Differenze Chiave v1 vs v2

| Aspetto | v1 | v2 |
|---------|----|----|
| Retrieval | Centralizzato, prima degli expert | Distribuito, dentro gli expert |
| Expert | Passivi (ricevono dati) | Attivi (fanno retrieval) |
| Traversal weights | Un set globale | Un set per expert |
| Gating | Implicito nel synthesis | Esplicito con θ_gating |
| RLCF | Solo su risposta finale | Multilivello (retrieval, reasoning, synthesis) |
| Parallelismo | Agent paralleli, poi expert sequenziali | Expert paralleli con retrieval interno |

---

## 7. Implementazione Graduale

### Fase 1: Mantenere v1 funzionante
- [ ] Non rompere il codice esistente
- [ ] Aggiungere flag `ARCHITECTURE_VERSION=v1|v2`

### Fase 2: Implementare Expert con Tools
- [ ] Creare classe `ExpertWithTools`
- [ ] Definire tools per ogni expert
- [ ] Test unitari

### Fase 3: Implementare Gating Network
- [ ] Creare `ExpertGatingNetwork`
- [ ] Training loop con feedback sintetico
- [ ] Integrazione con RLCF

### Fase 4: Implementare Traversal Apprendibile
- [ ] Creare `ExpertTraversalWeights`
- [ ] Policy gradient update
- [ ] Prior initialization

### Fase 5: Cutover
- [ ] A/B test v1 vs v2
- [ ] Deprecare v1

---

## 8. File di Riferimento

**Codice (da creare/modificare)**:
- `merlt/orchestration/experts/expert_with_tools.py` - 🆕
- `merlt/orchestration/gating/gating_network.py` - 🆕
- `merlt/orchestration/traversal/expert_traversal.py` - 🆕

**Documentazione correlata**:
- `docs/03-architecture/03-reasoning-layer.md` - Expert details
- `docs/03-architecture/05-learning-layer.md` - RLCF multilivello
- `docs/03-architecture/04-storage-layer.md` - Bridge Table

---

**Changelog**:
- 2025-12-02: v2.0 - Riprogettazione con Expert autonomi
- 2025-11-14: v1.0 - Architettura originale (ora in archive/)

