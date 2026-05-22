# Quickstart

> Guida rapida per iniziare con `merlt`

---

## Installazione

```bash
# Clone repository
git clone https://github.com/your-org/merlt.git
cd merlt

# Crea ambiente virtuale
python3.11 -m venv .venv
source .venv/bin/activate

# Installa dipendenze
pip install -e .
```

## Avvia i Database

```bash
# FalkorDB + Qdrant + PostgreSQL
docker-compose -f docker-compose.dev.yml up -d

# Verifica
docker-compose ps
```

## Primo Esempio

```python
import asyncio
from merlt import LegalKnowledgeGraph, MerltConfig

async def main():
    # Configurazione
    config = MerltConfig(
        falkordb_host="localhost",
        falkordb_port=6380,
        graph_name="merl_t_test",
    )

    # Connessione
    kg = LegalKnowledgeGraph(config)
    await kg.connect()

    # Ingestion di un articolo
    result = await kg.ingest_norm(
        tipo_atto="codice penale",
        articolo="52",
        include_brocardi=True,
    )

    print(f"Articolo: {result.article_urn}")
    print(f"Nodi creati: {len(result.nodes_created)}")
    print(f"Brocardi: {result.brocardi_enriched}")

    # Ricerca
    results = await kg.search("legittima difesa")
    for r in results:
        print(f"- Art. {r['numero_articolo']}: {r['score']:.3f}")

    await kg.close()

asyncio.run(main())
```

## Output Atteso

```
Articolo: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1930-10-19;1398:1~art52
Nodi creati: 15
Brocardi: True
- Art. 52: 0.892
- Art. 55: 0.756
- Art. 53: 0.734
```

---

## Prossimi Passi

- [Ingestion batch](ingestion.md) - Come fare ingestion di interi libri
- [Ricerca avanzata](search.md) - Query con contesto grafo
- [API Reference](../api/) - Documentazione completa
