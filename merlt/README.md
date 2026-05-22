# MERL-T: Multi-Expert Reinforcement Learning from AI Feedback

> Advanced NLP framework for Italian legal text analysis

[![PyPI version](https://badge.fury.io/py/merlt.svg)](https://pypi.org/project/merlt/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview

MERL-T is a research framework for legal text analysis using:
- **Multi-Expert Architecture**: Specialized models for different legal interpretation tasks
- **RLCF**: Reinforcement Learning from AI Feedback for continuous improvement
- **Knowledge Graph**: FalkorDB-based legal knowledge representation
- **RAG Pipeline**: Retrieval-Augmented Generation for accurate responses

## Installation

```bash
pip install merlt
```

MERL-T depends on the `visualex` package for data scraping:
```bash
pip install visualex
```

## Architecture

```
                    +-------------------+
                    |   User Query      |
                    +--------+----------+
                             |
                    +--------v----------+
                    |   RAG Pipeline    |
                    +--------+----------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v--------+ +--------v--------+ +--------v--------+
|  Literal Expert | | Systemic Expert | | Precedent Expert|
+-----------------+ +-----------------+ +-----------------+
         |                   |                   |
         +-------------------+-------------------+
                             |
                    +--------v----------+
                    | Disagreement Mod  |
                    +--------+----------+
                             |
                    +--------v----------+
                    |   RLCF Scoring    |
                    +-------------------+
```

## Features

### Multi-Expert System
Four specialized experts for different interpretive approaches:
- **Literal Expert**: Textual interpretation
- **Systemic Expert**: System-wide legal coherence
- **Principles Expert**: Constitutional and fundamental principles
- **Precedent Expert**: Case law and jurisprudence

### RLCF Framework
- Authority scoring for knowledge sources
- Feedback aggregation from expert disagreement
- Policy gradient optimization

### Knowledge Graph
- Legal concepts and relationships
- Cross-reference resolution
- Temporal versioning (multivigenza)

## Quick Start

```python
from merlt.pipeline import Pipeline
from merlt.experts import LiteralExpert, SystemicExpert
from visualex.scrapers import NormattivaScraper

# Initialize pipeline
pipeline = Pipeline()

# Fetch a legal document
scraper = NormattivaScraper()
document = await scraper.fetch_by_urn(
    "urn:nir:stato:decreto.legislativo:2003-06-30;196"
)

# Process with multi-expert analysis
result = await pipeline.analyze(document, question="What are the main obligations?")

print(f"Answer: {result.answer}")
print(f"Confidence: {result.confidence}")
print(f"Expert agreement: {result.agreement_score}")
```

## Development

```bash
git clone https://github.com/merlt/merlt
cd merlt
pip install -e ".[dev]"
pytest
```

### Local start script

```bash
./start_dev.sh
```

This script starts the dev databases via Docker Compose and runs the FastAPI
server on `http://localhost:8000`.

## Research

This framework is part of ongoing research in:
- Legal AI and expert systems
- Reinforcement learning from human/AI feedback
- Knowledge graph construction for legal domains

## Citation

If you use MERL-T in your research, please cite:
```bibtex
@software{merlt2026,
  title = {MERL-T: Multi-Expert Reinforcement Learning from AI Feedback},
  year = {2026},
  url = {https://github.com/merlt/merlt}
}
```

## License

Apache License 2.0 - see [LICENSE](LICENSE)
