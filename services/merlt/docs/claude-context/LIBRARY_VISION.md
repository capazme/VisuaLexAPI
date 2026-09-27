# MERL-T: Visione della Libreria

> **Missione**: Creare la libreria Python di riferimento per l'informatica giuridica italiana.
> Una libreria che i giuristi-programmatori del futuro useranno per costruire il codice civile digitale.

---

## Principi Fondamentali

### 1. Semplicità d'Uso

```python
# L'utente finale deve poter fare questo:
from merlt import LegalKnowledgeGraph

kg = LegalKnowledgeGraph()
await kg.connect()

# Una riga per ingestion
article = await kg.ingest("codice penale", "52")

# Una riga per ricerca
results = await kg.search("legittima difesa")
```

**Regola**: Se un'operazione comune richiede più di 3 righe, stiamo sbagliando.

### 2. Composabilità

```python
# Ogni componente deve funzionare da solo
from merlt.scrapers import NormattivaScraper
from merlt.graph import FalkorDBClient
from merlt.embeddings import EmbeddingService

# Ma anche insieme
from merlt import LegalKnowledgeGraph  # Orchestrazione automatica
```

**Regola**: Nessun componente deve dipendere dall'intero sistema.

### 3. Estensibilità

```python
# L'utente deve poter aggiungere le sue fonti
from merlt.scrapers import BaseScraper

class MyCustomScraper(BaseScraper):
    async def fetch(self, reference):
        # Logica custom
        pass

kg = LegalKnowledgeGraph(scrapers=[MyCustomScraper()])
```

**Regola**: Ogni punto di integrazione deve essere un'interfaccia, non un'implementazione.

### 4. Robustezza

```python
# Gestione errori graceful
result = await kg.ingest("codice penale", "52")
if result.errors:
    print(f"Completato con warning: {result.errors}")
# Ma l'operazione è comunque andata a buon fine per il resto
```

**Regola**: Mai fallire completamente. Degradare gracefully.

### 5. Documentazione Italiana

```python
def cerca(query: str, top_k: int = 5) -> List[Risultato]:
    """
    Cerca nel knowledge graph giuridico.

    Args:
        query: Domanda in linguaggio naturale (es. "Cos'è la legittima difesa?")
        top_k: Numero massimo di risultati

    Returns:
        Lista di Risultato con articoli pertinenti e contesto

    Example:
        >>> risultati = await kg.cerca("responsabilità del debitore")
        >>> print(risultati[0].articolo)
        "Art. 1218 c.c."
    """
```

**Regola**: Documentazione bilingue - docstring in italiano, codice in inglese.

---

## Struttura Package

```
merlt/
├── __init__.py              # API pubblica principale
├── core/                    # Orchestrazione
│   ├── __init__.py
│   ├── knowledge_graph.py   # LegalKnowledgeGraph
│   └── config.py            # MerltConfig
│
├── scrapers/                # Fonti dati
│   ├── __init__.py
│   ├── base.py              # BaseScraper (interfaccia)
│   ├── normattiva.py        # NormattivaScraper
│   ├── brocardi.py          # BrocardiScraper
│   └── eurlex.py            # EurlexScraper (futuro)
│
├── graph/                   # Storage grafo
│   ├── __init__.py
│   ├── client.py            # FalkorDBClient
│   └── models.py            # Norma, Dottrina, AttoGiudiziario
│
├── vectors/                 # Storage vettoriale
│   ├── __init__.py
│   ├── embeddings.py        # EmbeddingService
│   └── qdrant.py            # QdrantClient wrapper
│
├── bridge/                  # Integrazione grafo-vettori
│   ├── __init__.py
│   ├── table.py             # BridgeTable
│   └── builder.py           # BridgeBuilder
│
├── pipeline/                # Processing
│   ├── __init__.py
│   ├── ingestion.py         # IngestionPipeline
│   ├── chunking.py          # StructuralChunker
│   ├── parsing.py           # CommaParser
│   └── multivigenza.py      # MultivigenzaPipeline
│
├── retrieval/               # Ricerca
│   ├── __init__.py
│   ├── hybrid.py            # GraphAwareRetriever
│   └── reranking.py         # Reranker (futuro)
│
├── models/                  # Data models
│   ├── __init__.py
│   ├── norma.py             # Norma, NormaVisitata
│   ├── modifica.py          # Modifica, StoriaArticolo
│   └── results.py           # IngestionResult, SearchResult
│
└── utils/                   # Utilities
    ├── __init__.py
    ├── urn.py               # URN generator
    └── text.py              # Text operations
```

---

## API Pubblica

### Livello 1: High-Level (per la maggior parte degli utenti)

```python
from merlt import LegalKnowledgeGraph, MerltConfig

# Setup
config = MerltConfig(
    database="localhost:6380",
    vectors="localhost:6333",
)
kg = LegalKnowledgeGraph(config)
await kg.connect()

# Ingestion
result = await kg.ingest("codice civile", "1453")
result = await kg.ingest_batch("codice civile", libro="IV")

# Search
results = await kg.search("risoluzione del contratto")
results = await kg.search_with_context("inadempimento", expand_graph=True)

# Export
dataset = await kg.export(format="huggingface")
```

### Livello 2: Mid-Level (per utenti avanzati)

```python
from merlt.scrapers import NormattivaScraper, BrocardiScraper
from merlt.pipeline import IngestionPipeline
from merlt.graph import FalkorDBClient

# Componenti individuali
scraper = NormattivaScraper()
text, url = await scraper.fetch("codice penale", "52")

pipeline = IngestionPipeline(graph=FalkorDBClient())
result = await pipeline.ingest(text, metadata={...})
```

### Livello 3: Low-Level (per contributtori)

```python
from merlt.models import Norma, NormaVisitata
from merlt.utils.urn import generate_urn
from merlt.pipeline.parsing import CommaParser

# Accesso diretto ai building blocks
norma = Norma(tipo_atto="codice civile", data="1942-03-16")
urn = generate_urn(norma, articolo="1453")
parser = CommaParser()
structure = parser.parse(article_text)
```

---

## Convenzioni di Codice

### Naming

| Tipo | Convenzione | Esempio |
|------|-------------|---------|
| Classi | PascalCase | `LegalKnowledgeGraph` |
| Funzioni | snake_case | `ingest_article()` |
| Costanti | UPPER_SNAKE | `DEFAULT_GRAPH_NAME` |
| Moduli | snake_case | `knowledge_graph.py` |
| Package | lowercase | `merlt` |

### Async/Await

```python
# Tutte le operazioni I/O sono async
async def ingest(self, tipo_atto: str, articolo: str) -> IngestionResult:
    ...

# Wrapper sync per CLI
def ingest_sync(self, tipo_atto: str, articolo: str) -> IngestionResult:
    return asyncio.run(self.ingest(tipo_atto, articolo))
```

### Type Hints

```python
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

@dataclass
class IngestionResult:
    article_urn: str
    nodes_created: List[str]
    errors: List[str]

async def search(
    self,
    query: str,
    top_k: int = 5,
    filters: Optional[Dict[str, Any]] = None,
) -> List[SearchResult]:
    ...
```

### Error Handling

```python
# Eccezioni custom
class MerltError(Exception):
    """Base exception per merlt."""
    pass

class ScraperError(MerltError):
    """Errore durante scraping."""
    pass

class GraphError(MerltError):
    """Errore database grafo."""
    pass

# Uso
try:
    result = await kg.ingest(...)
except ScraperError as e:
    logger.warning(f"Scraping fallito: {e}, continuo senza enrichment")
except GraphError as e:
    raise  # Errori critici propagati
```

---

## Testing Strategy

```
tests/
├── unit/                    # Test isolati con mock
│   ├── test_parser.py
│   ├── test_chunker.py
│   └── test_urn.py
│
├── integration/             # Test con servizi reali
│   ├── test_scraper.py
│   ├── test_graph.py
│   └── test_pipeline.py
│
└── e2e/                     # Test end-to-end
    ├── test_ingestion.py
    └── test_search.py
```

**Regola**: Ogni funzione pubblica deve avere almeno un test.

---

## Roadmap

### v0.1.0 - Foundation (Attuale)
- [x] Core components implementati
- [x] Ingestion pipeline funzionante
- [ ] Struttura package riorganizzata
- [ ] Tests completi
- [ ] Documentazione API

### v0.2.0 - Polish
- [ ] CLI tool (`merlt ingest`, `merlt search`)
- [ ] Configuration file support
- [ ] Logging strutturato
- [ ] Error recovery migliorato

### v0.3.0 - Features
- [ ] Batch ingestion ottimizzato
- [ ] Incremental updates
- [ ] Export per training ML
- [ ] Eurlex integration

### v1.0.0 - Production Ready
- [ ] API stabile
- [ ] Performance optimizations
- [ ] Full documentation
- [ ] PyPI publication

---

## Per Claude: Linee Guida di Sviluppo

1. **Pensa sempre alla libreria finale**
   - Ogni funzione potrebbe essere chiamata da un utente esterno
   - API chiare e documentate

2. **No duplicazione**
   - Prima cerca se esiste già
   - Riutilizza sempre

3. **Composabilità**
   - Ogni componente deve funzionare da solo
   - Dipendenze esplicite, mai implicite

4. **Test first**
   - Scrivi il test che vuoi far passare
   - Poi implementa

5. **Documentazione italiana**
   - L'utente finale è un giurista italiano
   - Docstring in italiano, codice in inglese

---

*Ultimo aggiornamento: 2025-12-07*
