# CLAUDE.md - MERL-T Framework

> **Istruzioni per agenti AI che lavorano su questo repository**

---

## Contesto Progetto

**MERL-T** (Multi-Expert Legal Retrieval Transformer) è il **framework di machine learning** per l'analisi giuridica. Implementa:
- Sistema Multi-Expert (4 esperti che replicano i canoni ermeneutici)
- RLCF (Reinforcement Learning from Community Feedback)
- Knowledge Graph giuridico
- RAG Pipeline per risposte fondate

**Parte di**: Monorepo ALIS_CORE
**Tipo**: Python ML framework (pubblicato su PyPI)
**Licenza**: Apache 2.0 (Open Source)
**PyPI**: `pip install merlt`

---

## Fondamenti Teorici

Questo framework implementa i concetti descritti nei paper:

- **Allega, D., & Puzio, G. (2025b)**: *MERL-T: A multi-expert architecture for trustworthy artificial legal intelligence*
- **Allega, D., & Puzio, G. (2025c)**: *Reinforcement learning from community feedback (RLCF)*

### I 4 Expert (Art. 12 Preleggi)

| Expert | Canone | Implementazione |
|--------|--------|-----------------|
| LiteralExpert | Interpretazione letterale | Analisi testuale, definizioni |
| SystemicExpert | Interpretazione sistematica | Query Knowledge Graph |
| PrinciplesExpert | Ratio legis | Principi costituzionali |
| PrecedentExpert | Giurisprudenza | Massime, precedenti |

### I 4 Pilastri RLCF

1. **Dynamic Authority Scoring**: Peso feedback basato su competenza
2. **Uncertainty Preservation**: Mantiene incertezza dove appropriato
3. **Constitutional Governance**: Principi guida del sistema
4. **Devil's Advocate System**: Sfida deliberata per evitare conformismo

---

## Stack Tecnologico

- **Python 3.10+**
- **PyTorch** per modelli ML
- **Transformers** (HuggingFace) per LLM
- **FalkorDB** per Knowledge Graph
- **Qdrant** per vector search
- **FastAPI** per API server
- **Pydantic** per data models

---

## Comandi Utili

```bash
# Installazione development
pip install -e ".[dev]"

# Test
pytest                         # Tutti i test
pytest tests/unit/             # Solo unit test
pytest -k "expert"             # Test Expert

# Linting
black merlt/                   # Formattazione
ruff check merlt/              # Linting
mypy merlt/                    # Type checking

# API Server
./start_dev.sh                 # Docker + FastAPI (port 8000)

# Database
docker-compose up -d falkordb qdrant  # Solo DB

# Experiments
python -m merlt.experiments.run EXP-001  # Run experiment
```

---

## Struttura Cartelle

```
merlt/
├── merlt/
│   ├── __init__.py
│   │
│   ├── experts/               # I 4 Expert
│   │   ├── __init__.py
│   │   ├── base.py            # BaseExpert abstract
│   │   ├── literal.py         # LiteralExpert
│   │   ├── systemic.py        # SystemicExpert
│   │   ├── principles.py      # PrinciplesExpert
│   │   └── precedent.py       # PrecedentExpert
│   │
│   ├── rlcf/                  # Sistema RLCF
│   │   ├── __init__.py
│   │   ├── authority.py       # Calcolo autorità
│   │   ├── feedback.py        # Gestione feedback
│   │   ├── training.py        # Training loop
│   │   ├── dissent.py         # Devil's Advocate
│   │   └── governance.py      # Constitutional governance
│   │
│   ├── retrieval/             # Ricerca ibrida
│   │   ├── vector.py          # Qdrant search
│   │   ├── graph.py           # FalkorDB queries
│   │   └── hybrid.py          # Combinazione
│   │
│   ├── synthesis/             # Sintesi risposte
│   │   ├── synthesizer.py     # Combina Expert
│   │   └── weighting.py       # Pesi dinamici
│   │
│   ├── knowledge_graph/       # Knowledge Graph
│   │   ├── builder.py         # Costruzione grafo
│   │   ├── queries.py         # Query Cypher
│   │   ├── schema.py          # Schema nodi/archi
│   │   └── ingest.py          # Ingestion pipeline
│   │
│   ├── pipeline/              # Pipeline principale
│   │   ├── __init__.py
│   │   └── pipeline.py        # Orchestrazione
│   │
│   ├── api/                   # FastAPI server
│   │   ├── app.py             # Main app
│   │   ├── routes/            # Endpoint
│   │   └── schemas/           # Request/Response
│   │
│   └── config/                # Configurazione
│       ├── settings.py        # Pydantic Settings
│       └── defaults.yaml      # Valori default
│
├── docs/
│   ├── experiments/           # Documentazione esperimenti
│   └── archive/               # Documentazione storica
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docker-compose.yml
├── pyproject.toml
└── start_dev.sh
```

---

## File Critici - Leggere Prima di Modificare

| File | Importanza | Note |
|------|------------|------|
| `experts/base.py` | **CRITICO** | Interfaccia base Expert - non modificare signature |
| `rlcf/authority.py` | **CRITICO** | Algoritmo autorità - richiede approvazione |
| `rlcf/governance.py` | **CRITICO** | Principi costituzionali - immutabili |
| `synthesis/synthesizer.py` | **ALTA** | Combina risposte Expert |
| `knowledge_graph/schema.py` | **ALTA** | Schema grafo - richiede migration |
| `pipeline/pipeline.py` | **ALTA** | Orchestrazione principale |

---

## Pattern da Seguire

### Expert Implementation
```python
# experts/nuovo_expert.py
from merlt.experts.base import BaseExpert, ExpertResponse
from merlt.retrieval import HybridRetriever

class NuovoExpert(BaseExpert):
    """Expert per interpretazione X."""

    def __init__(self, retriever: HybridRetriever):
        super().__init__(name="nuovo", retriever=retriever)

    async def analyze(self, query: str, context: dict) -> ExpertResponse:
        """
        Analizza query secondo canone X.

        Args:
            query: Domanda giuridica
            context: Contesto (articolo, dominio, etc.)

        Returns:
            ExpertResponse con answer, sources, confidence
        """
        # 1. Retrieve relevant documents
        docs = await self.retriever.search(query, filters=context)

        # 2. Generate response
        answer = await self._generate(query, docs)

        # 3. Calculate confidence
        confidence = self._calculate_confidence(docs, answer)

        return ExpertResponse(
            expert_name=self.name,
            answer=answer,
            sources=[d.source for d in docs],
            confidence=confidence,
            reasoning=self._explain_reasoning(docs)
        )
```

### RLCF Authority Calculation
```python
# rlcf/authority.py
from dataclasses import dataclass

@dataclass
class AuthorityScore:
    value: float  # 0.0 - 1.0
    components: dict  # breakdown

def calculate_authority(
    user_id: str,
    domain: str,
    feedback_history: list
) -> AuthorityScore:
    """
    Calcola autorità utente per dominio.

    Componenti:
    - background: Titoli, esperienza dichiarata
    - consistency: Coerenza feedback nel tempo
    - consensus: Allineamento con altri esperti
    - domain_expertise: Competenza specifica dominio
    """
    background = _evaluate_background(user_id)
    consistency = _evaluate_consistency(feedback_history)
    consensus = _evaluate_consensus(feedback_history)
    domain_exp = _evaluate_domain_expertise(user_id, domain)

    value = (
        0.25 * background +
        0.25 * consistency +
        0.30 * consensus +
        0.20 * domain_exp
    )

    return AuthorityScore(
        value=value,
        components={
            "background": background,
            "consistency": consistency,
            "consensus": consensus,
            "domain_expertise": domain_exp
        }
    )
```

### Knowledge Graph Query
```python
# knowledge_graph/queries.py
from merlt.knowledge_graph.schema import NodeType, EdgeType

CYPHER_QUERIES = {
    "neighbors": """
        MATCH (n)-[r]-(m)
        WHERE n.urn = $urn
        RETURN n, r, m
        LIMIT $limit
    """,

    "path_between": """
        MATCH path = shortestPath((a)-[*..5]-(b))
        WHERE a.urn = $urn1 AND b.urn = $urn2
        RETURN path
    """,

    "related_by_concept": """
        MATCH (n)-[:DEFINISCE]->(c:Concept)<-[:DEFINISCE]-(m)
        WHERE n.urn = $urn
        RETURN DISTINCT m
        LIMIT $limit
    """
}
```

---

## Convenzioni Codice

### Python Style
- **Black** formattazione (line length 88)
- **Ruff** linting
- **Type hints** obbligatori
- **Docstrings** Google style

### Naming
- Expert: `{Name}Expert` (PascalCase)
- Funzioni/variabili: snake_case
- Costanti: UPPER_SNAKE_CASE
- Query Cypher: UPPER_SNAKE_CASE

### Async
- Pipeline e Expert sono async
- Knowledge Graph queries sono async
- Database operations sono async

### Logging
```python
import structlog

logger = structlog.get_logger(__name__)

logger.info("analysis_started", query=query, expert=self.name)
logger.debug("documents_retrieved", count=len(docs))
```

---

## Anti-Pattern - Cosa NON Fare

❌ **Non** modificare authority algorithm senza approvazione
   - È il cuore del sistema RLCF

❌ **Non** modificare Constitutional Governance
   - I principi sono immutabili per design

❌ **Non** aggiungere Expert senza implementare tutti i metodi astratti
   - BaseExpert definisce il contratto

❌ **Non** bypassare Synthesizer per risposte dirette
   - Tutte le risposte devono passare dalla sintesi

❌ **Non** modificare schema Knowledge Graph senza migration
   - Dati esistenti devono essere preservati

❌ **Non** ignorare confidence scores
   - L'incertezza è parte del design (Uncertainty Preservation)

---

## Testing

### Unit Tests
```python
# tests/unit/test_literal_expert.py
import pytest
from merlt.experts import LiteralExpert
from merlt.experts.base import ExpertResponse

@pytest.fixture
def literal_expert(mock_retriever):
    return LiteralExpert(retriever=mock_retriever)

async def test_analyze_returns_response(literal_expert):
    response = await literal_expert.analyze(
        query="Cos'è la risoluzione del contratto?",
        context={"domain": "civile"}
    )

    assert isinstance(response, ExpertResponse)
    assert response.expert_name == "literal"
    assert 0 <= response.confidence <= 1
    assert len(response.sources) > 0
```

### Integration Tests
```python
# tests/integration/test_pipeline.py
import pytest
from merlt.pipeline import Pipeline

@pytest.mark.integration
async def test_full_pipeline():
    pipeline = Pipeline()

    result = await pipeline.analyze(
        document=test_document,
        question="Quali sono le conseguenze dell'inadempimento?"
    )

    assert result.answer is not None
    assert len(result.expert_responses) == 4
    assert result.agreement_score >= 0
```

---

## Experiments

Gli esperimenti sono documentati in `docs/experiments/`.

### Struttura Esperimento
```
EXP-XXX_nome_esperimento/
├── README.md           # Obiettivo, metodologia, risultati
├── config.yaml         # Configurazione
├── run.py              # Script esecuzione
├── results/            # Output
└── analysis.ipynb      # Analisi risultati
```

### Esecuzione
```bash
python -m merlt.experiments.run EXP-023
```

---

## API Server

### Endpoints Principali
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/analyze` | Analisi multi-expert |
| GET | `/api/v1/experts` | Lista Expert disponibili |
| POST | `/api/v1/feedback` | Submit RLCF feedback |
| GET | `/api/v1/authority/{user_id}` | Authority score |
| GET | `/api/v1/graph/neighbors/{urn}` | Graph neighbors |

### Avvio
```bash
./start_dev.sh              # Docker + FastAPI
uvicorn merlt.api.app:app   # Solo API
```

---

## Database

### FalkorDB (Knowledge Graph)
- **Port**: 6379 (default Redis port)
- **Browser**: Non disponibile di default
- **Query**: Cypher

### Qdrant (Vector Search)
- **Port**: 6333
- **Dashboard**: http://localhost:6333/dashboard
- **Collections**: `legal_chunks`, `case_law`

---

## Dipendenze del Progetto

### Usa
- **visualex**: Per scraping dati (PyPI)

### Usato da
- **visualex-merlt**: Integration layer
- **merlt-models**: Carica pesi addestrati

---

## Workflow di Sviluppo

1. **Branch** da main: `feature/nome-feature`
2. **Sviluppa** con test
3. **Test** con `pytest`
4. **Lint** con `black` e `ruff`
5. **Type check** con `mypy`
6. **Documenta** esperimento se rilevante
7. **PR** con descrizione dettagliata

---

## Agenti Consigliati per Task

| Task | Agente |
|------|--------|
| Nuovo Expert | `architect` poi `builder` |
| Modifica RLCF | Richiede approvazione, poi `builder` |
| Knowledge Graph | `graph-engineer` |
| Pipeline optimization | `builder` |
| Bug investigation | `debugger` |
| Esperimenti | `builder` + documentazione |
| API endpoints | `api-designer` poi `builder` |

---

## Riferimenti

- [README Principale](../README.md)
- [Architettura](../ARCHITETTURA.md)
- [Glossario](../GLOSSARIO.md)
- [Guida Navigazione](../GUIDA_NAVIGAZIONE.md)
- [Paper MERL-T](../papers/markdown/DA%20GP%20-%20MERLT.md)
- [Paper RLCF](../papers/markdown/DA%20GP%20-%20RLCF.md)
- [Experiments README](docs/experiments/README.md)

---

*Ultimo aggiornamento: Gennaio 2026*
