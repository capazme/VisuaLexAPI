# Architettura Grafo Incrementale/Evolutivo

> **Versione**: 1.0 | **Data**: 10 Dicembre 2025 | **Status**: Design

## 1. Principi Fondamentali

### 1.1 Evoluzione del Grafo

```
FASE 1: BACKBONE (Completato)                    FASE 2: ENRICHMENT (Da fare)
════════════════════════════                     ════════════════════════════

   ┌─────────────────────┐                          ┌─────────────────────┐
   │      Normattiva     │                          │      Manuali        │
   │   (API ufficiale)   │                          │   Appunti, Dottrina │
   └──────────┬──────────┘                          └──────────┬──────────┘
              │                                                 │
              ▼                                                 ▼
   ┌─────────────────────┐                          ┌─────────────────────┐
   │  Backbone Nodi:     │                          │  Enrichment Nodi:   │
   │  • Norma            │◄─────── LINKING ────────►│  • ConcettoGiuridico│
   │  • Comma            │                          │  • Principio        │
   │  • AttoGiudiziario  │                          │  • Definizione      │
   │  • Dottrina(Brocardi)│                         │  • [altri in futuro]│
   └─────────────────────┘                          └─────────────────────┘
              │                                                 │
              └─────────────────────┬───────────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   GRAFO UNIFICATO   │
                         │   Retrocompatibile  │
                         │   Versionato        │
                         └─────────────────────┘
```

### 1.2 Invarianti Architetturali

1. **Backbone Immutabile**: I nodi Norma esistenti non vengono modificati, solo arricchiti con nuove relazioni
2. **Enrichment Additivo**: Nuovi nodi/relazioni si aggiungono senza rompere query esistenti
3. **Provenance Tracking**: Ogni nodo/relazione traccia la sua origine (fonte, data, confidence)
4. **Retrocompatibilità API**: `search()`, `get_node()` continuano a funzionare
5. **Versionamento Schema**: Migrazioni esplicite per cambi strutturali

---

## 2. Schema Evolutivo

### 2.1 Nodi Prioritari per Enrichment (Fase 2.1)

Basandosi sulle tue priorità (Concetto, Principio, Definizione):

#### A. ConcettoGiuridico (Legal Concept)

```cypher
CREATE (c:ConcettoGiuridico {
    node_id: "concept:buona_fede_contrattuale",
    nome: "Buona fede contrattuale",
    definizione: "Obbligo di comportamento leale e corretto...",
    ambito: "diritto_civile",

    -- Provenance
    fonte_primaria: "Manuale Diritto Civile - Torrente",
    pagina: "456-460",
    confidence: 0.85,
    extraction_model: "claude-3-5-sonnet",
    extraction_date: "2025-12-10",

    -- Versioning
    schema_version: "2.1",
    created_at: timestamp(),
    updated_at: timestamp()
})
```

**Relazioni principali:**
- `(Norma)-[:DISCIPLINA]->(ConcettoGiuridico)` - Art. 1337 disciplina la buona fede
- `(ConcettoGiuridico)-[:SPECIES]->(ConcettoGiuridico)` - Buona fede oggettiva → Buona fede
- `(Dottrina)-[:SPIEGA]->(ConcettoGiuridico)` - Commento spiega concetto

#### B. PrincipioGiuridico (Legal Principle)

```cypher
CREATE (p:PrincipioGiuridico {
    node_id: "principle:affidamento",
    nome: "Principio di affidamento",
    tipo: "generale_del_diritto",  -- costituzionale, generale, settoriale
    descrizione: "Tutela la legittima aspettativa...",
    livello: "fondamentale",

    -- Applicabilità
    derogabile: true,
    bilanciabile: true,
    ambito_applicazione: ["contratti", "atti_unilaterali", "responsabilità"],

    -- Provenance
    fonte_primaria: "Manuale Diritto Civile - Galgano",
    articoli_fondamento: ["1337", "1366", "1375"],
    confidence: 0.90,
    extraction_model: "claude-3-5-sonnet",
    extraction_date: "2025-12-10",

    -- Versioning
    schema_version: "2.1",
    created_at: timestamp()
})
```

**Relazioni principali:**
- `(Norma)-[:ESPRIME_PRINCIPIO]->(PrincipioGiuridico)` - Art. 1337 esprime affidamento
- `(PrincipioGiuridico)-[:BILANCIA_CON]->(PrincipioGiuridico)` - Affidamento bilancia con autonomia
- `(AttoGiudiziario)-[:APPLICA_PRINCIPIO]->(PrincipioGiuridico)` - Sentenza applica principio

#### C. DefinizioneLegale (Legal Definition)

```cypher
CREATE (d:DefinizioneLegale {
    node_id: "def:contratto_1321",
    termine: "contratto",
    definizione: "accordo di due o più parti per costituire, regolare o estinguere...",
    ambito_applicazione: "codice_civile",

    -- Fonte normativa (se esplicita)
    norma_fonte: "urn:nir:stato:regio.decreto:1942-03-16;262~art1321",
    definizione_esplicita: true,  -- vs inferita da dottrina

    -- Sinonimi e varianti
    sinonimi: ["negozio giuridico bilaterale", "accordo"],

    -- Provenance
    fonte_primaria: "Codice Civile",
    confidence: 1.0,  -- definizione esplicita = massima confidence
    extraction_date: "2025-12-10",

    -- Versioning
    schema_version: "2.1",
    created_at: timestamp()
})
```

**Relazioni principali:**
- `(Norma)-[:DEFINISCE]->(DefinizioneLegale)` - Art. 1321 definisce "contratto"
- `(DefinizioneLegale)-[:USATO_IN]->(Norma)` - Definizione usata in altri articoli

---

## 3. Pipeline Enrichment Manuali

### 3.1 Flusso Generale

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MANUAL ENRICHMENT PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  INPUT                     PROCESSING                    OUTPUT             │
│  ─────                     ──────────                    ──────             │
│                                                                              │
│  ┌──────────┐    ┌─────────────────────────────────┐    ┌──────────────┐   │
│  │  PDF/MD  │───►│  1. Document Parser              │───►│ Chunks +     │   │
│  │ Manuale  │    │     (PyMuPDF, Markdown)          │    │ Metadata     │   │
│  └──────────┘    └─────────────────────────────────┘    └──────┬───────┘   │
│                                                                  │          │
│                  ┌─────────────────────────────────┐             │          │
│                  │  2. Scope Filter                 │◄────────────┘          │
│                  │     (Solo Libro IV CC)          │                        │
│                  └─────────────────────────────────┘                        │
│                              │                                              │
│                              ▼                                              │
│                  ┌─────────────────────────────────┐                        │
│                  │  3. LLM Entity Extraction        │                        │
│                  │     ├─ Concetti                  │                        │
│                  │     ├─ Principi                  │                        │
│                  │     └─ Definizioni               │                        │
│                  └─────────────────────────────────┘                        │
│                              │                                              │
│                              ▼                                              │
│                  ┌─────────────────────────────────┐                        │
│                  │  4. Entity Linking               │                        │
│                  │     (Match a Norma esistenti)    │                        │
│                  └─────────────────────────────────┘                        │
│                              │                                              │
│                              ▼                                              │
│                  ┌─────────────────────────────────┐    ┌──────────────┐   │
│                  │  5. Graph Writer                 │───►│ FalkorDB    │   │
│                  │     (Nodi + Relazioni)           │    │ + Qdrant    │   │
│                  └─────────────────────────────────┘    └──────────────┘   │
│                              │                                              │
│                              ▼                                              │
│                  ┌─────────────────────────────────┐    ┌──────────────┐   │
│                  │  6. Audit Log                    │───►│ enrichment_  │   │
│                  │     (Tracciabilità completa)     │    │ log.jsonl   │   │
│                  └─────────────────────────────────┘    └──────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Componenti

#### A. Document Parser

```python
# merlt/pipeline/enrichment/document_parser.py

@dataclass
class ManualChunk:
    """Chunk da manuale con metadata."""
    text: str
    source_file: str
    page_number: Optional[int]
    section_title: Optional[str]
    chapter: Optional[str]

    # Scope filtering
    libro_cc: Optional[str]  # "IV" se riguarda obbligazioni
    articoli_citati: List[str]  # ["1321", "1337", ...]


class ManualParser:
    """Parser per manuali PDF/Markdown."""

    async def parse(self, file_path: Path) -> List[ManualChunk]:
        """Estrae chunks dal documento."""
        if file_path.suffix == ".pdf":
            return await self._parse_pdf(file_path)
        elif file_path.suffix in [".md", ".txt"]:
            return await self._parse_markdown(file_path)
        else:
            raise ValueError(f"Formato non supportato: {file_path.suffix}")

    async def _parse_pdf(self, file_path: Path) -> List[ManualChunk]:
        """Parsing PDF con PyMuPDF."""
        import fitz
        doc = fitz.open(file_path)
        chunks = []
        for page_num, page in enumerate(doc):
            text = page.get_text()
            # Estrai articoli citati
            articoli = self._extract_article_refs(text)
            chunks.append(ManualChunk(
                text=text,
                source_file=str(file_path),
                page_number=page_num + 1,
                articoli_citati=articoli
            ))
        return chunks

    def _extract_article_refs(self, text: str) -> List[str]:
        """Estrae riferimenti ad articoli (Art. 1321, art. 1337, etc.)"""
        import re
        pattern = r'[Aa]rt\.?\s*(\d{1,4}(?:\s*-?\s*\w+)?)'
        matches = re.findall(pattern, text)
        return list(set(matches))
```

#### B. Scope Filter

```python
# merlt/pipeline/enrichment/scope_filter.py

class LibroIVFilter:
    """Filtra chunks che riguardano Libro IV CC (Obbligazioni)."""

    LIBRO_IV_RANGE = (1173, 2059)  # Art. 1173 - Art. 2059

    LIBRO_IV_KEYWORDS = [
        "obbligazione", "obbligazioni", "contratto", "contratti",
        "adempimento", "inadempimento", "risoluzione", "rescissione",
        "responsabilità contrattuale", "responsabilità extracontrattuale",
        "fatto illecito", "arricchimento senza causa"
    ]

    def filter(self, chunks: List[ManualChunk]) -> List[ManualChunk]:
        """Filtra solo chunks rilevanti per Libro IV."""
        filtered = []
        for chunk in chunks:
            if self._is_libro_iv_relevant(chunk):
                chunk.libro_cc = "IV"
                filtered.append(chunk)
        return filtered

    def _is_libro_iv_relevant(self, chunk: ManualChunk) -> bool:
        """Determina se chunk riguarda Libro IV."""
        # Check articoli citati
        for art in chunk.articoli_citati:
            try:
                num = int(re.search(r'\d+', art).group())
                if self.LIBRO_IV_RANGE[0] <= num <= self.LIBRO_IV_RANGE[1]:
                    return True
            except:
                pass

        # Check keywords
        text_lower = chunk.text.lower()
        keyword_count = sum(1 for kw in self.LIBRO_IV_KEYWORDS if kw in text_lower)
        return keyword_count >= 2  # Almeno 2 keywords
```

#### C. LLM Entity Extractor

```python
# merlt/pipeline/enrichment/entity_extractor.py

@dataclass
class ExtractedEntity:
    """Entità estratta da LLM."""
    entity_type: str  # "concetto", "principio", "definizione"
    nome: str
    descrizione: str
    articoli_correlati: List[str]
    confidence: float
    raw_extraction: dict  # JSON originale da LLM


class LLMEntityExtractor:
    """Estrae entità giuridiche usando LLM."""

    def __init__(self, llm_service: OpenRouterService):
        self.llm = llm_service

    async def extract_concepts(self, chunk: ManualChunk) -> List[ExtractedEntity]:
        """Estrae Concetti Giuridici dal chunk."""
        prompt = CONCEPT_EXTRACTION_PROMPT.format(text=chunk.text)
        response = await self.llm.generate_response(prompt, task_type="extraction")
        return self._parse_concepts(response)

    async def extract_principles(self, chunk: ManualChunk) -> List[ExtractedEntity]:
        """Estrae Principi Giuridici dal chunk."""
        prompt = PRINCIPLE_EXTRACTION_PROMPT.format(text=chunk.text)
        response = await self.llm.generate_response(prompt, task_type="extraction")
        return self._parse_principles(response)

    async def extract_definitions(self, chunk: ManualChunk) -> List[ExtractedEntity]:
        """Estrae Definizioni Legali dal chunk."""
        prompt = DEFINITION_EXTRACTION_PROMPT.format(text=chunk.text)
        response = await self.llm.generate_response(prompt, task_type="extraction")
        return self._parse_definitions(response)


# Prompts in file separato
CONCEPT_EXTRACTION_PROMPT = """
Sei un esperto di diritto civile italiano. Analizza il seguente testo di manuale
e estrai tutti i CONCETTI GIURIDICI menzionati.

TESTO:
{text}

Un concetto giuridico è un'idea astratta o un istituto del diritto (es. "buona fede",
"simulazione", "dolo", "colpa", "causa del contratto").

Per ogni concetto trovato, fornisci:
1. nome: il nome del concetto (es. "buona fede oggettiva")
2. definizione: breve definizione basata sul testo
3. articoli_correlati: articoli del codice civile citati in relazione al concetto
4. confidence: quanto sei sicuro dell'estrazione (0.0-1.0)

Rispondi SOLO in JSON valido:
{
  "concetti": [
    {
      "nome": "...",
      "definizione": "...",
      "articoli_correlati": ["1337", "1375"],
      "confidence": 0.85
    }
  ]
}

Se non trovi concetti rilevanti, rispondi: {"concetti": []}
"""
```

#### D. Entity Linker

```python
# merlt/pipeline/enrichment/entity_linker.py

@dataclass
class LinkedEntity:
    """Entità collegata al backbone."""
    entity: ExtractedEntity
    linked_norms: List[str]  # URN delle Norma collegate
    is_new: bool  # True se entità non esisteva nel grafo


class EntityLinker:
    """Collega entità estratte al backbone esistente."""

    def __init__(self, graph_client: FalkorDBClient, embedding_service: EmbeddingService):
        self.graph = graph_client
        self.embeddings = embedding_service

    async def link_entity(self, entity: ExtractedEntity) -> LinkedEntity:
        """Collega entità a nodi Norma esistenti."""
        linked_norms = []

        # 1. Match esplicito per articoli citati
        for art_num in entity.articoli_correlati:
            urn = await self._find_norm_urn(art_num)
            if urn:
                linked_norms.append(urn)

        # 2. Match semantico se articoli non trovati
        if not linked_norms:
            linked_norms = await self._semantic_link(entity)

        # 3. Check se entità già esiste (deduplicazione)
        is_new = not await self._entity_exists(entity)

        return LinkedEntity(
            entity=entity,
            linked_norms=linked_norms,
            is_new=is_new
        )

    async def _find_norm_urn(self, article_num: str) -> Optional[str]:
        """Trova URN della Norma per numero articolo."""
        # Query semplificata - in produzione più sofisticata
        result = await self.graph.query(f"""
            MATCH (n:Norma)
            WHERE n.URN CONTAINS 'art{article_num}'
            RETURN n.URN LIMIT 1
        """)
        return result[0]["n.URN"] if result else None

    async def _entity_exists(self, entity: ExtractedEntity) -> bool:
        """Verifica se entità simile già esiste."""
        label = self._entity_type_to_label(entity.entity_type)
        result = await self.graph.query(f"""
            MATCH (e:{label})
            WHERE e.nome = $nome
            RETURN count(e) as cnt
        """, {"nome": entity.nome})
        return result[0]["cnt"] > 0
```

#### E. Graph Writer

```python
# merlt/pipeline/enrichment/graph_writer.py

class EnrichmentGraphWriter:
    """Scrive nodi/relazioni di enrichment nel grafo."""

    def __init__(self, graph_client: FalkorDBClient):
        self.graph = graph_client

    async def write_concept(
        self,
        entity: LinkedEntity,
        source_metadata: dict
    ) -> str:
        """Scrive ConcettoGiuridico e relazioni."""
        node_id = f"concept:{self._normalize_name(entity.entity.nome)}"

        # 1. Crea nodo
        await self.graph.query("""
            MERGE (c:ConcettoGiuridico {node_id: $node_id})
            SET c.nome = $nome,
                c.definizione = $definizione,
                c.fonte_primaria = $fonte,
                c.confidence = $confidence,
                c.extraction_model = $model,
                c.extraction_date = datetime(),
                c.schema_version = '2.1'
        """, {
            "node_id": node_id,
            "nome": entity.entity.nome,
            "definizione": entity.entity.descrizione,
            "fonte": source_metadata.get("source_file"),
            "confidence": entity.entity.confidence,
            "model": source_metadata.get("model", "claude-3-5-sonnet")
        })

        # 2. Crea relazioni DISCIPLINA con Norma
        for urn in entity.linked_norms:
            await self.graph.query("""
                MATCH (n:Norma {URN: $urn})
                MATCH (c:ConcettoGiuridico {node_id: $node_id})
                MERGE (n)-[r:DISCIPLINA]->(c)
                SET r.confidence = $confidence,
                    r.fonte = $fonte,
                    r.created_at = datetime()
            """, {
                "urn": urn,
                "node_id": node_id,
                "confidence": entity.entity.confidence,
                "fonte": source_metadata.get("source_file")
            })

        return node_id
```

---

## 4. Retrocompatibilità

### 4.1 Invarianti Query

```python
# Le query esistenti DEVONO continuare a funzionare

# Prima dell'enrichment
result = await kg.search("buona fede")
# → Trova nodi Norma e Dottrina(Brocardi)

# Dopo l'enrichment
result = await kg.search("buona fede")
# → Trova nodi Norma + Dottrina(Brocardi) + ConcettoGiuridico + PrincipioGiuridico
# → I risultati vecchi sono ancora presenti, i nuovi si aggiungono
```

### 4.2 Versioning Schema

```python
# merlt/storage/graph/migrations.py

SCHEMA_VERSIONS = {
    "1.0": {
        "nodes": ["Norma", "Comma", "AttoGiudiziario", "Dottrina"],
        "relations": ["contiene", "interpreta", "commenta"]
    },
    "2.0": {
        "nodes": ["Norma", "Comma", "AttoGiudiziario", "Dottrina",
                  "Parte", "Titolo", "Capo", "Sezione"],
        "relations": ["contiene", "interpreta", "commenta", "modifica"]
    },
    "2.1": {
        "nodes": ["Norma", "Comma", "AttoGiudiziario", "Dottrina",
                  "Parte", "Titolo", "Capo", "Sezione",
                  "ConcettoGiuridico", "PrincipioGiuridico", "DefinizioneLegale"],
        "relations": ["contiene", "interpreta", "commenta", "modifica",
                     "disciplina", "esprime_principio", "definisce", "bilancia_con"]
    }
}

async def migrate_to_2_1(graph_client):
    """Migrazione a schema 2.1 (aggiunge indici per nuovi nodi)."""
    # Crea indici per nuovi tipi di nodo
    await graph_client.query("CREATE INDEX ON :ConcettoGiuridico(node_id)")
    await graph_client.query("CREATE INDEX ON :ConcettoGiuridico(nome)")
    await graph_client.query("CREATE INDEX ON :PrincipioGiuridico(node_id)")
    await graph_client.query("CREATE INDEX ON :PrincipioGiuridico(nome)")
    await graph_client.query("CREATE INDEX ON :DefinizioneLegale(node_id)")
    await graph_client.query("CREATE INDEX ON :DefinizioneLegale(termine)")

    # Aggiorna metadata schema
    await graph_client.query("""
        MERGE (m:_SchemaMetadata)
        SET m.version = '2.1', m.updated_at = datetime()
    """)
```

---

## 5. Audit e Logging

### 5.1 Enrichment Log

```python
# Ogni operazione viene loggata per tracciabilità e debugging

@dataclass
class EnrichmentLogEntry:
    timestamp: datetime
    operation: str  # "create_node", "create_relation", "link_entity"
    entity_type: str
    entity_id: str
    source_file: str
    source_page: Optional[int]
    llm_model: str
    llm_prompt_hash: str  # Per reproducibilità
    llm_response_hash: str
    confidence: float
    linked_norms: List[str]
    success: bool
    error: Optional[str]


class EnrichmentAuditLog:
    """Audit log per operazioni di enrichment."""

    def __init__(self, log_path: Path):
        self.log_path = log_path

    def log(self, entry: EnrichmentLogEntry):
        """Appende entry al log JSONL."""
        with open(self.log_path, "a") as f:
            f.write(json.dumps(asdict(entry), default=str) + "\n")

    def get_entries_for_source(self, source_file: str) -> List[EnrichmentLogEntry]:
        """Recupera tutte le entry per un file sorgente."""
        entries = []
        with open(self.log_path, "r") as f:
            for line in f:
                entry = json.loads(line)
                if entry["source_file"] == source_file:
                    entries.append(EnrichmentLogEntry(**entry))
        return entries
```

---

## 6. Esempio Completo

### 6.1 Ingestion di un Capitolo Manuale

```python
# scripts/enrich_libro_iv_manual.py

async def main():
    """Ingerisce capitolo manuale sul Libro IV CC."""

    # 1. Setup
    graph = FalkorDBClient()
    embeddings = EmbeddingService()
    llm = OpenRouterService()
    audit_log = EnrichmentAuditLog(Path("logs/enrichment_libro_iv.jsonl"))

    # 2. Parse documento
    parser = ManualParser()
    chunks = await parser.parse(Path("data/manuali/torrente_libro_iv.pdf"))
    print(f"Parsed {len(chunks)} chunks")

    # 3. Filtra solo Libro IV
    filter = LibroIVFilter()
    filtered = filter.filter(chunks)
    print(f"Filtered to {len(filtered)} Libro IV chunks")

    # 4. Estrai entità
    extractor = LLMEntityExtractor(llm)
    linker = EntityLinker(graph, embeddings)
    writer = EnrichmentGraphWriter(graph)

    stats = {"concepts": 0, "principles": 0, "definitions": 0}

    for chunk in tqdm(filtered, desc="Processing chunks"):
        # Estrai concetti
        concepts = await extractor.extract_concepts(chunk)
        for concept in concepts:
            linked = await linker.link_entity(concept)
            if linked.is_new:
                node_id = await writer.write_concept(linked, {
                    "source_file": chunk.source_file,
                    "page": chunk.page_number,
                    "model": "claude-3-5-sonnet"
                })
                stats["concepts"] += 1
                audit_log.log(EnrichmentLogEntry(
                    timestamp=datetime.now(),
                    operation="create_node",
                    entity_type="ConcettoGiuridico",
                    entity_id=node_id,
                    source_file=chunk.source_file,
                    source_page=chunk.page_number,
                    llm_model="claude-3-5-sonnet",
                    confidence=concept.confidence,
                    linked_norms=linked.linked_norms,
                    success=True
                ))

        # Estrai principi e definizioni (simile)
        ...

    print(f"Enrichment completato: {stats}")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## 7. Prossimi Passi

1. **Setup ambiente**: Configurare API key LLM
2. **Preparare manuale**: Individuare PDF/file del manuale Libro IV
3. **Test su 5-10 pagine**: Validare qualità estrazione
4. **Ingestion completa**: Processare intero capitolo
5. **Verifica grafo**: Query per verificare nuovi nodi/relazioni
6. **Procedi con Expert Tools**: Ora con grafo arricchito

---

## 8. Stima Effort

| Fase | Descrizione | Ore |
|------|-------------|-----|
| Document Parser | PyMuPDF + Markdown | 4h |
| Scope Filter | Filtro Libro IV | 2h |
| LLM Extractor | Prompts + parsing | 8h |
| Entity Linker | Matching + dedup | 6h |
| Graph Writer | Cypher + relazioni | 4h |
| Audit Log | Logging + tests | 3h |
| Integration | Pipeline completa | 4h |
| Testing | Validazione qualità | 4h |
| **TOTALE** | | **35h** |

Costo API stimato: ~$30-50 per un capitolo manuale (~100 pagine)
