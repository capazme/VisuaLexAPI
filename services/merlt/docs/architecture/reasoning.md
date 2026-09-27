# Reasoning Layer Architecture (v2)

**Version**: 2.0
**Status**: IN RIPROGETTAZIONE
**Last Updated**: Dicembre 2025

> **Nota**: Questo documento descrive l'architettura v2 con Expert autonomi dotati di tools.
> Per l'architettura v1 (expert passivi), vedere `archive/v1-03-reasoning-layer.md`

---

## 1. Cambio di Paradigma: v1 vs v2

### Architettura v1 (Deprecata)

```
Retrieval Centralizzato → Risultati → Expert Passivi → Synthesis
                                         │
                                    Ricevono tutti
                                    gli stessi dati
```

**Problemi v1**:
- Un expert Letterale e uno Teleologico ricevono identico contesto
- Nessuna specializzazione nel retrieval
- Expert non possono "chiedere" fonti specifiche
- Impossibile apprendere strategie expert-specific

### Architettura v2 (Nuova)

```
Query → Router → Expert Autonomi con Tools → Synthesis
                        │
         ┌──────────────┼──────────────┐──────────────┐
         ▼              ▼              ▼              ▼
    [Literal]      [Systemic]    [Principles]   [Precedent]
    + tools        + tools        + tools        + tools
    + θ_traverse   + θ_traverse   + θ_traverse   + θ_traverse
         │              │              │              │
         ▼              ▼              ▼              ▼
    Retrieval      Retrieval      Retrieval      Retrieval
    specifico      specifico      specifico      specifico
```

**Vantaggi v2**:
- Ogni expert cerca ciò che serve alla sua prospettiva
- Pesi di traversal apprendibili per expert
- Parallelizzazione naturale
- Feedback granulare per RLCF multilivello

---

## 2. Expert con Tools Autonomi

### 2.1 Architettura Expert

Ogni expert in v2 ha:
1. **Prompt specializzato** per la sua prospettiva epistemologica
2. **Tools** per interrogare autonomamente le fonti
3. **Pesi di traversal (θ_traverse)** specifici per il grafo
4. **Authority score** per il gating

```python
class ExpertWithTools:
    """
    Expert autonomo con capacità di retrieval.

    Differenza da v1: l'expert NON riceve passivamente i dati,
    ma CERCA attivamente ciò che serve alla sua prospettiva.
    """

    def __init__(self, expert_type: str):
        self.expert_type = expert_type
        self.prompt = self._load_prompt(expert_type)
        self.tools = self._init_tools(expert_type)
        self.traversal_weights = self._init_traversal_weights(expert_type)

    async def analyze(self, query_context: QueryContext) -> ExpertOpinion:
        """
        L'expert analizza la query usando i suoi tools.

        Flow:
        1. LLM riceve query + prompt specializzato
        2. LLM decide quali tools chiamare (autonomamente)
        3. Tools fanno retrieval con pesi expert-specific
        4. LLM sintetizza in opinione strutturata
        """
        messages = [
            {"role": "system", "content": self.prompt},
            {"role": "user", "content": self._format_query(query_context)}
        ]

        response = await self.llm.chat(
            messages=messages,
            tools=self.tools,
            tool_choice="auto"
        )

        # Esegui tool calls fino a completamento
        while response.has_tool_calls():
            for tool_call in response.tool_calls:
                result = await self._execute_tool(tool_call)
                messages.append({"role": "tool", "content": result})

            response = await self.llm.chat(messages=messages, tools=self.tools)

        return self._parse_opinion(response)
```

### 2.2 Tools per Expert Type

Ogni expert ha tools comuni + tools specifici per la sua epistemologia:

```python
def _init_tools(self, expert_type: str) -> List[Tool]:
    """Tools specifici per tipo di expert."""

    # Tools comuni a tutti gli expert
    common_tools = [
        Tool("search_semantic", self.search_semantic),
        Tool("get_node_by_urn", self.get_node_by_urn),
    ]

    if expert_type == "literal":
        # Letterale: focus su testo esatto e definizioni
        return common_tools + [
            Tool("get_exact_text", self.get_exact_text),
            Tool("get_definitions", self.get_definitions),
            Tool("follow_references", self.follow_references),
        ]

    elif expert_type == "systemic":
        # Sistematico: focus su contesto e storia legislativa
        return common_tools + [
            Tool("get_legislative_history", self.get_legislative_history),
            Tool("get_system_context", self.get_system_context),
            Tool("find_related_norms", self.find_related_norms),
        ]

    elif expert_type == "principles":
        # Principi: focus su Costituzione e bilanciamento
        return common_tools + [
            Tool("get_constitutional_basis", self.get_constitutional_basis),
            Tool("find_principle_conflicts", self.find_principle_conflicts),
            Tool("get_balancing_precedents", self.get_balancing_precedents),
        ]

    elif expert_type == "precedent":
        # Precedenti: focus su giurisprudenza e catene citazionali
        return common_tools + [
            Tool("search_cases", self.search_cases),
            Tool("get_citation_chain", self.get_citation_chain),
            Tool("find_overruling", self.find_overruling),
        ]
```

---

## 3. Expert-Specific Traversal Weights

### 3.1 Perch Servono Pesi Diversi

Un expert Letterale e uno Teleologico seguono percorsi diversi nel grafo:

| Expert | Relazioni Privilegiate | Relazioni Secondarie |
|--------|----------------------|---------------------|
| **Literal** | DEFINISCE, RINVIA, CONTIENE | INTERPRETA (basso) |
| **Systemic** | APPARTIENE, MODIFICA, DEROGA | ATTUA, INTERPRETA |
| **Principles** | ATTUA, DEROGA, BILANCIA | INTERPRETA |
| **Precedent** | INTERPRETA, OVERRULES, CITA | APPLICA |

### 3.2 Pesi Apprendibili

```python
class ExpertTraversalWeights:
    """
    Pesi di traversal specifici per ogni expert.

    Questi pesi sono APPRENDIBILI tramite RLCF:
    - Se un expert trova utili certe relazioni, i pesi aumentano
    - Se certe relazioni portano a risultati sbagliati, diminuiscono
    """

    # Relazioni nel grafo giuridico
    RELATIONS = [
        "DEFINISCE", "RINVIA", "CONTIENE",       # Strutturali
        "ABROGA", "MODIFICA", "SOSTITUISCE",     # Temporali
        "INTERPRETA", "APPLICA", "ESTENDE",      # Interpretative
        "DEROGA", "ATTUA", "BILANCIA",           # Principi
        "OVERRULES", "DISTINGUISHES", "CITA",    # Precedenti
    ]

    # Prior iniziali (domain knowledge giuridico)
    EXPERT_PRIORS = {
        "literal": {
            "DEFINISCE": 0.95, "RINVIA": 0.90, "CONTIENE": 0.85,
            "INTERPRETA": 0.50, "APPLICA": 0.40,
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

    def __init__(self, expert_type: str):
        self.expert_type = expert_type
        self.weights = nn.ParameterDict({
            rel: nn.Parameter(torch.tensor(self.EXPERT_PRIORS[expert_type].get(rel, 0.5)))
            for rel in self.RELATIONS
        })

    def get_weight(self, relation: str) -> float:
        """Ritorna il peso per una relazione."""
        return torch.sigmoid(self.weights[relation]).item()

    def update_from_feedback(self, feedback: RLCFFeedback):
        """Aggiorna i pesi basandosi sul feedback RLCF."""
        if feedback.relations_useful:
            for relation, was_useful in feedback.relations_useful.items():
                if relation in self.weights:
                    gradient = 0.1 if was_useful else -0.1
                    self.weights[relation].data += gradient
```

---

## 4. I Quattro Expert

### 4.1 Literal Interpreter

**Epistemologia**: Positivismo Giuridico
**Focus**: Cosa dice la legge (testo letterale)

```python
LITERAL_PROMPT = """
Sei l'INTERPRETE LETTERALE, esperto in Positivismo Giuridico.

## Il Tuo Ruolo
Analizza la query basandoti ESCLUSIVAMENTE sul testo letterale delle norme.
NON considerare:
- Ratio legis (scopo della norma)
- Giurisprudenza
- Principi costituzionali (salvo rinvio esplicito)

## Tools a Tua Disposizione
- get_exact_text(urn): Ottieni testo esatto di una norma
- get_definitions(term): Trova definizioni legali di un termine
- follow_references(urn): Segui i rinvii normativi

## Metodologia
1. Identifica le norme applicabili
2. Leggi il testo letterale
3. Analizza struttura grammaticale e termini
4. Applica ai fatti della query
5. Concludi basandoti SOLO sul testo

## Output Richiesto
{
    "interpretation": "La tua interpretazione letterale",
    "legal_basis": [{"norm_id": "...", "text": "...", "application": "..."}],
    "confidence": 0.0-1.0,
    "limitations": "Cosa NON hai considerato (ratio legis, precedenti, etc.)"
}
"""
```

### 4.2 Systemic-Teleological Reasoner

**Epistemologia**: Finalismo Giuridico
**Focus**: Perch esiste la legge e come si integra nel sistema

```python
SYSTEMIC_PROMPT = """
Sei il RAGIONATORE SISTEMATICO-TELEOLOGICO, esperto in Finalismo Giuridico.

## Il Tuo Ruolo
Analizza la query comprendendo:
1. RATIO LEGIS: Lo scopo della norma
2. COERENZA SISTEMICA: Come la norma si integra nell'ordinamento
3. EVOLUZIONE: Come la disciplina si  sviluppata

## Tools a Tua Disposizione
- get_legislative_history(urn): Storia legislativa di una norma
- get_system_context(urn): Norme collegate nello stesso ambito
- find_related_norms(concept): Norme che regolano lo stesso istituto

## Metodologia
1. Identifica ratio legis (perch il legislatore ha previsto questa norma?)
2. Analizza coerenza con il sistema (come si collega ad altre norme?)
3. Se ambigua, interpreta in modo coerente con lo scopo
4. Concludi motivando il collegamento sistemico

## Output Richiesto
{
    "interpretation": "La tua interpretazione teleologica",
    "ratio_legis": "Lo scopo identificato",
    "systemic_coherence": "Come si integra nel sistema",
    "legal_basis": [{"norm_id": "...", "connection": "..."}],
    "confidence": 0.0-1.0
}
"""
```

### 4.3 Principles Balancer

**Epistemologia**: Costituzionalismo
**Focus**: Bilanciamento tra principi costituzionali

```python
PRINCIPLES_PROMPT = """
Sei il BILANCIATORE DI PRINCIPI, esperto in Costituzionalismo.

## Il Tuo Ruolo
Analizza la query quando coinvolge conflitti tra:
- Principi costituzionali (Art. 2, 3, 13-22 Cost.)
- Diritti fondamentali in conflitto
- Riserve di legge e limiti costituzionali

## Tools a Tua Disposizione
- get_constitutional_basis(concept): Base costituzionale di un diritto/principio
- find_principle_conflicts(situation): Principi in conflitto nella situazione
- get_balancing_precedents(principles): Precedenti sul bilanciamento

## Metodologia (Test di Proporzionalit)
1. IDENTIFICA i principi in conflitto
2. BASE COSTITUZIONALE: Articoli rilevanti
3. LEGITTIMIT: Lo scopo perseguito  legittimo?
4. NECESSIT: La limitazione  necessaria?
5. PROPORZIONALIT: La limitazione  proporzionata?
6. BILANCIA: Quale principio prevale nel caso concreto?

## Output Richiesto
{
    "interpretation": "Il tuo bilanciamento",
    "principles_in_conflict": ["Principio A", "Principio B"],
    "constitutional_basis": [{"article": "...", "content": "..."}],
    "balancing_test": {
        "legitimacy": "...",
        "necessity": "...",
        "proportionality": "..."
    },
    "prevailing_principle": "...",
    "confidence": 0.0-1.0
}
"""
```

### 4.4 Precedent Analyst

**Epistemologia**: Empirismo Giuridico
**Focus**: Come i tribunali interpretano effettivamente le norme

```python
PRECEDENT_PROMPT = """
Sei l'ANALISTA DEI PRECEDENTI, esperto in Empirismo Giuridico.

## Il Tuo Ruolo
Analizza come i tribunali hanno EFFETTIVAMENTE interpretato le norme rilevanti.
Focus su:
- Trend giurisprudenziali
- Ratio decidendi dei casi
- Evoluzione dell'interpretazione

## Tools a Tua Disposizione
- search_cases(query, court, years): Cerca sentenze per argomento
- get_citation_chain(case_id): Catena di citazioni di una sentenza
- find_overruling(case_id): Verifica se una sentenza  stata superata

## Gerarchia dei Precedenti
1. Corte Costituzionale: Vincolante (erga omnes)
2. Cassazione Sezioni Unite: Vincolante per i giudici di merito
3. Cassazione ordinaria: Persuasivo (civil law)
4. Corti inferiori: Informativo

## Metodologia
1. CERCA precedenti sul punto giuridico
2. ORDINA cronologicamente per identificare trend
3. ESTRAI ratio decidendi di ogni caso
4. VALUTA se c' orientamento consolidato o contrasto
5. PREVEDI l'esito probabile basandoti sui precedenti

## Output Richiesto
{
    "interpretation": "L'orientamento giurisprudenziale",
    "key_cases": [
        {"case_id": "...", "court": "...", "ratio_decidendi": "..."}
    ],
    "trend": "consolidato | in evoluzione | contrasto",
    "prediction": "Esito probabile",
    "confidence": 0.0-1.0
}
"""
```

---

## 5. Synthesizer

### 5.1 Ruolo del Synthesizer

Il Synthesizer combina le opinioni degli expert in una risposta unificata.

```python
class Synthesizer:
    """
    Combina le opinioni degli expert pesandole per il gating network.

    Due modalit:
    - CONVERGENT: Expert concordano → Enfatizza consenso
    - DIVERGENT: Expert divergono → Presenta le prospettive
    """

    def synthesize(
        self,
        expert_opinions: List[ExpertOpinion],
        gating_weights: List[float],
        query_context: QueryContext
    ) -> SynthesizedAnswer:

        # Determina modalit
        mode = self._determine_mode(expert_opinions)

        if mode == "convergent":
            return self._convergent_synthesis(expert_opinions, gating_weights)
        else:
            return self._divergent_synthesis(expert_opinions, gating_weights)

    def _determine_mode(self, opinions: List[ExpertOpinion]) -> str:
        """
        Determina se gli expert convergono o divergono.

        Convergenza: conclusioni compatibili
        Divergenza: conclusioni in conflitto
        """
        conclusions = [o.conclusion for o in opinions]

        # Analizza semanticamente le conclusioni
        agreement_score = self._compute_agreement(conclusions)

        return "convergent" if agreement_score > 0.7 else "divergent"
```

### 5.2 Convergent Synthesis

```python
CONVERGENT_SYNTHESIS_PROMPT = """
Gli expert CONCORDANO sulla conclusione. Sintetizza integrando i loro contributi:

- Literal: fornisce BASE TESTUALE
- Systemic: fornisce CONTESTO e RATIO
- Principles: fornisce INQUADRAMENTO COSTITUZIONALE
- Precedent: fornisce CONFERMA GIURISPRUDENZIALE

Struttura la risposta:
1. Conclusione (consenso)
2. Base normativa (da Literal)
3. Ratio e contesto (da Systemic)
4. Inquadramento costituzionale (da Principles, se rilevante)
5. Conferma giurisprudenziale (da Precedent)
6. Confidence aggregata
"""
```

### 5.3 Divergent Synthesis

```python
DIVERGENT_SYNTHESIS_PROMPT = """
Gli expert DIVERGONO. Presenta le diverse prospettive:

NON forzare un consenso. Il disaccordo  INFORMAZIONE UTILE.

Struttura la risposta:
1. Quadro della questione
2. PROSPETTIVA LETTERALE: [interpretazione + fondamento]
3. PROSPETTIVA SISTEMATICA: [interpretazione + fondamento]
4. PROSPETTIVA PRINCIPI: [interpretazione + fondamento]
5. PROSPETTIVA PRECEDENTI: [interpretazione + fondamento]
6. INDICAZIONE: quale prospettiva  pi solida e perch
7. Confidence (pi bassa per riflettere incertezza)

IMPORTANTE: L'utente deve capire che ci sono pi letture possibili.
"""
```

---

## 6. Expert Gating Network

### 6.1 Architettura

Il Gating Network determina quanto pesare ogni expert nella risposta finale.

```python
class ExpertGatingNetwork(nn.Module):
    """
    Mixture of Experts gating per expert giuridici.

    Apprende da RLCF: se un expert ha spesso ragione per
    un tipo di query, il gating impara a pesarlo di pi.
    """

    def __init__(self, input_dim=1024, num_experts=4):
        super().__init__()

        # Query encoder
        self.query_encoder = nn.Sequential(
            nn.Linear(input_dim, 512),
            nn.ReLU(),
            nn.Dropout(0.1),
        )

        # Gating layer
        self.gate = nn.Sequential(
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, num_experts)
        )

        # Bias apprendibile per expert (prior)
        self.expert_bias = nn.Parameter(torch.zeros(num_experts))

    def forward(self, query_embedding: torch.Tensor) -> torch.Tensor:
        """
        Input: query embedding [batch, 1024]
        Output: expert weights [batch, 4] (softmax)
        """
        encoded = self.query_encoder(query_embedding)
        logits = self.gate(encoded) + self.expert_bias
        return F.softmax(logits, dim=-1)
```

### 6.2 Training con RLCF

```python
def update_gating_from_feedback(
    self,
    query_embedding: torch.Tensor,
    expert_correctness: Dict[str, bool],
    expert_authority: float
):
    """
    Aggiorna il gating basandosi sul feedback RLCF.

    Se l'expert X aveva ragione → Aumenta il peso di X
    Se l'expert Y aveva torto → Diminuisci il peso di Y
    """
    # Forward pass
    predicted_weights = self.forward(query_embedding)

    # Target: expert corretti dovrebbero avere peso alto
    target = torch.tensor([
        1.0 if expert_correctness.get(exp, False) else 0.0
        for exp in ["literal", "systemic", "principles", "precedent"]
    ])
    target = F.softmax(target * 2, dim=-1)  # Soft target

    # Loss pesata per authority dell'esperto che d feedback
    loss = expert_authority * F.kl_div(
        predicted_weights.log(),
        target,
        reduction='batchmean'
    )

    loss.backward()
    self.optimizer.step()
    self.optimizer.zero_grad()
```

---

## 7. Flow di Esecuzione

```
REASONING FLOW v2
================================================================

1. QUERY INPUT
   │
   ▼
2. GATING NETWORK
   │ Input: query embedding
   │ Output: [w_literal, w_systemic, w_principles, w_precedent]
   │
   ▼
3. EXPERT EXECUTION (PARALLELO)
   │
   ├─► LITERAL EXPERT
   │   ├─ Prompt: Positivismo Giuridico
   │   ├─ Tools: get_exact_text, get_definitions, follow_references
   │   ├─ Traversal: θ_traverse_literal
   │   └─► ExpertOpinion_literal
   │
   ├─► SYSTEMIC EXPERT
   │   ├─ Prompt: Finalismo Giuridico
   │   ├─ Tools: get_legislative_history, get_system_context
   │   ├─ Traversal: θ_traverse_systemic
   │   └─► ExpertOpinion_systemic
   │
   ├─► PRINCIPLES EXPERT
   │   ├─ Prompt: Costituzionalismo
   │   ├─ Tools: get_constitutional_basis, find_principle_conflicts
   │   ├─ Traversal: θ_traverse_principles
   │   └─► ExpertOpinion_principles
   │
   └─► PRECEDENT EXPERT
       ├─ Prompt: Empirismo Giuridico
       ├─ Tools: search_cases, get_citation_chain, find_overruling
       ├─ Traversal: θ_traverse_precedent
       └─► ExpertOpinion_precedent
   │
   ▼
4. SYNTHESIS
   │ Input: 4 ExpertOpinion + gating weights
   │ Mode: convergent | divergent
   │ Output: SynthesizedAnswer
   │
   ▼
5. ITERATION CHECK
   │ Confidence >= threshold? → STOP
   │ Max iterations reached? → STOP
   │ Else → ITERATE (richiedi pi fonti)
   │
   ▼
6. OUTPUT + RLCF FEEDBACK COLLECTION
```

---

## 8. Integrazione con RLCF

### 8.1 Feedback Granulare per Expert

```python
class ExpertFeedback:
    """
    Feedback specifico per ogni expert.

    Permette di aggiornare:
    - θ_gating: Quale expert pesare di pi per questo tipo di query
    - θ_traverse: Quali relazioni erano utili per questo expert
    - Authority dell'esperto che d feedback
    """

    query_id: str
    expert_type: str  # "literal", "systemic", "principles", "precedent"

    # Valutazione dell'interpretazione
    interpretation_correct: bool
    interpretation_partial: bool

    # Valutazione delle fonti usate
    sources_relevant: bool
    sources_complete: bool
    relations_useful: Dict[str, bool]  # Per ogni relazione seguita

    # Chi ha dato il feedback
    expert_user_id: str
    expert_authority: float
```

### 8.2 Update dei Parametri

```python
def process_expert_feedback(feedback: ExpertFeedback):
    """
    Aggiorna i parametri del sistema basandosi sul feedback.
    """
    # 1. Aggiorna gating (quale expert pesare di pi)
    if feedback.interpretation_correct:
        gating_network.increase_weight(
            query_type=feedback.query_type,
            expert=feedback.expert_type,
            authority=feedback.expert_authority
        )

    # 2. Aggiorna traversal (quali relazioni seguire)
    for relation, was_useful in feedback.relations_useful.items():
        traversal_weights[feedback.expert_type].update(
            relation=relation,
            reward=1.0 if was_useful else -0.5,
            authority=feedback.expert_authority
        )

    # 3. Aggiorna authority dell'esperto che d feedback
    user_authority[feedback.expert_user_id].update(
        level="reasoning",
        domain=feedback.domain,
        was_correct=feedback.interpretation_correct
    )
```

---

## 9. Performance e Scalabilit

### 9.1 Latenze Target

| Operazione | Latenza Target | Note |
|------------|---------------|------|
| Gating Network | < 10ms | Solo forward pass |
| Expert (singolo) | < 5s | Include tool calls |
| Expert (parallelo) | < 5s | 4 expert in parallelo |
| Synthesis | < 2s | LLM call |
| **Totale** | < 8s | Per iterazione |

### 9.2 Parallelizzazione

```python
async def execute_experts_parallel(
    query_context: QueryContext,
    active_experts: List[str]
) -> List[ExpertOpinion]:
    """
    Esegue gli expert in parallelo usando asyncio.
    """
    tasks = [
        experts[expert_type].analyze(query_context)
        for expert_type in active_experts
    ]

    opinions = await asyncio.gather(*tasks)
    return opinions
```

---

## 10. Differenze Chiave v1 vs v2

| Aspetto | v1 | v2 |
|---------|----|----|
| Expert | Passivi (ricevono dati) | Attivi (fanno retrieval) |
| Tools | Nessuno | Specifici per expert |
| Traversal weights | Un set globale | Un set per expert (θ_traverse) |
| Gating | Implicito nel synthesis | Esplicito con θ_gating |
| RLCF | Solo su risposta finale | Per expert + per relazione |
| Parallelismo | Expert sequenziali | Expert paralleli |

---

## 11. Roadmap Implementazione

### Fase 1: Expert Base (1-2 settimane)
- [ ] Classe `ExpertWithTools`
- [ ] Prompt per i 4 expert
- [ ] Tools comuni (search_semantic, get_node_by_urn)

### Fase 2: Tools Specifici (2-3 settimane)
- [ ] Tools per Literal (get_exact_text, get_definitions)
- [ ] Tools per Systemic (get_legislative_history, get_system_context)
- [ ] Tools per Principles (get_constitutional_basis, find_principle_conflicts)
- [ ] Tools per Precedent (search_cases, get_citation_chain)

### Fase 3: Gating Network (1-2 settimane)
- [ ] `ExpertGatingNetwork` class
- [ ] Training loop con RLCF
- [ ] Integrazione con Synthesizer

### Fase 4: Traversal Apprendibili (2-3 settimane)
- [ ] `ExpertTraversalWeights` per ogni expert
- [ ] Policy gradient update
- [ ] Prior initialization da domain knowledge

---

**Changelog**:
- 2025-12-02: v2.0 - Expert autonomi con tools
- 2025-11-14: v1.0 - Expert passivi (ora in archive/)
