# Piano Definitivo: Integrazione MERL-T ↔ VisuaLex

> **Versione**: 1.0 | **Data**: 7 Gennaio 2026
> **Autore**: Sistema Multi-Agente Claude
> **Scope**: Completamento integrazione per tesi di laurea
> **Rigore**: Informatico + Giuridico + Accademico

---

## EXECUTIVE SUMMARY

### Obiettivo
Completare l'integrazione tra **MERL-T** (Legal Knowledge Graph library) e **VisuaLex** (Legal Research Frontend) per creare un sistema completo di:
1. **Knowledge Graph Giuridico** con validazione comunitaria (RLCF)
2. **Expert System** multi-interpretativo basato sui canoni ermeneutici
3. **Feedback Loop** per miglioramento continuo tramite interazioni utente

### Stato Attuale
| Componente | Completamento | Note |
|------------|---------------|------|
| **MERL-T Core** | 94.3% | 66/70 features, 648+ test |
| **Expert System** | 100% | 4 Expert + Orchestrator + GatingPolicy |
| **RLCF Framework** | 95% | Authority, PolicyGradient, Persistence |
| **VisuaLex Integration** | 70% | Q&A OK, Enrichment parziale |
| **Graph Visualization** | 30% | GraphViewer esiste, API mancanti |

### Timeline Stimata
| Fase | Durata | Focus |
|------|--------|-------|
| **Fase 1** | 1 settimana | Critical fixes (persistence, FalkorDB write) |
| **Fase 2** | 2 settimane | UX Refinement + Graph API |
| **Fase 3** | 2 settimane | NER Training + Document Upload |
| **Fase 4** | 1 settimana | Testing E2E + Polish |
| **TOTALE** | **6 settimane** | MVP Completo per Tesi |

---

## PARTE I: ARCHITETTURA SISTEMA

### 1.1 Stack Tecnologico

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ARCHITETTURA INTEGRATA                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  VisuaLex Frontend (React)          VisuaLex Backend (Express)         │
│  ═══════════════════════           ════════════════════════           │
│  ┌─────────────────────┐           ┌─────────────────────┐             │
│  │  QAPanel            │───────────│  /api/merlt/*       │─────────┐   │
│  │  MerltInspectorPanel│           │  (proxy to MERL-T)  │         │   │
│  │  KnowledgeGraphExplorer         └─────────────────────┘         │   │
│  │  ContributePage     │                                           │   │
│  │  ProfilePage        │                                           │   │
│  └─────────────────────┘                                           │   │
│           │                                                        │   │
│           │  API Calls                                             │   │
│           ▼                                                        ▼   │
│  ┌─────────────────────┐                              ┌──────────────┐ │
│  │  merltService.ts    │                              │  MERL-T API  │ │
│  │  ─────────────────  │                              │  (FastAPI)   │ │
│  │  • checkArticleInGraph                             │  Port: 8000  │ │
│  │  • requestLiveEnrich│◄─────────────────────────────│              │ │
│  │  • validateEntity   │                              └──────────────┘ │
│  │  • reportIssue      │                                      │        │
│  └─────────────────────┘                                      ▼        │
│                                                       ┌──────────────┐ │
│                                                       │  MERL-T Core │ │
│                                                       │  ────────────│ │
│                                                       │  • Experts   │ │
│                                                       │  • RLCF      │ │
│                                                       │  • Pipeline  │ │
│                                                       │  • Storage   │ │
│                                                       └──────────────┘ │
│                                                               │        │
│                              ┌─────────────────────────────────┤        │
│                              │                │                │        │
│                        ┌─────▼─────┐    ┌─────▼─────┐    ┌────▼────┐   │
│                        │ FalkorDB  │    │  Qdrant   │    │PostgreSQL│  │
│                        │  (Graph)  │    │ (Vectors) │    │  (RLCF)  │  │
│                        │ 27,740 N  │    │ 5,926 V   │    │ Pending  │  │
│                        │ 43,935 R  │    │ E5-large  │    │ Votes    │  │
│                        └───────────┘    └───────────┘    └──────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Moduli MERL-T

| Modulo | Path | Responsabilita' |
|--------|------|-----------------|
| **Expert System** | `merlt/experts/` | Interpretazione multi-canone (Art. 12-14 Preleggi) |
| **RLCF Framework** | `merlt/rlcf/` | Policy Gradient, Authority, Feedback Loop |
| **Storage Layer** | `merlt/storage/` | FalkorDB, Qdrant, PostgreSQL, BridgeTable |
| **Pipeline** | `merlt/pipeline/` | Ingestion, Parsing, Chunking, Enrichment |
| **API** | `merlt/api/` | FastAPI routers (enrichment, experts, graph) |

### 1.3 Flusso Dati RLCF

```
                    ┌─────────────────────────────────────────────┐
                    │              RLCF FEEDBACK LOOP              │
                    └─────────────────────────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
        ▼                                ▼                                ▼
┌───────────────┐              ┌───────────────┐              ┌───────────────┐
│   FLUSSO 1    │              │   FLUSSO 2    │              │   FLUSSO 3    │
│   Ingestion   │              │ Interaction   │              │    Expert     │
│  Comunitaria  │              │   Tracking    │              │   Feedback    │
└───────┬───────┘              └───────┬───────┘              └───────┬───────┘
        │                              │                              │
        │  • Live enrichment           │  • highlight_create          │  • Q&A rating
        │  • Entity validation         │  • bookmark_add              │  • Source quality
        │  • Relation proposal         │  • cross_ref_click           │  • Expert comparison
        │  • Issue reporting           │  • doctrine_read             │  • Refinement
        │                              │  • long_read                 │
        ▼                              ▼                              ▼
┌───────────────┐              ┌───────────────┐              ┌───────────────┐
│   Authority   │              │  Interaction  │              │  Multilevel   │
│    Update     │              │  Accumulator  │              │   Feedback    │
└───────┬───────┘              └───────┬───────┘              └───────┬───────┘
        │                              │                              │
        └──────────────────────────────┼──────────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │  PolicyGradientTrainer  │
                          │  ─────────────────────  │
                          │  • GatingPolicy update  │
                          │  • TraversalPolicy      │
                          │  • REINFORCE algorithm  │
                          └─────────────────────────┘
```

---

## PARTE II: FONDAMENTI GIURIDICI

### 2.1 Canoni Ermeneutici (Art. 12-14 Preleggi)

Il sistema Expert si basa sui canoni ermeneutici codificati nelle Disposizioni sulla legge in generale (Preleggi al Codice Civile):

| Expert | Canone | Fonte Normativa | Implementazione |
|--------|--------|-----------------|-----------------|
| **LiteralExpert** | Interpretazione letterale | Art. 12, comma 1 - "significato proprio delle parole" | Analisi lessicale, definizioni legali, glossari |
| **SystemicExpert** | Interpretazione sistematica | Art. 12, comma 1 - "connessione di esse" + Art. 14 (storico) | Relazioni tra norme, contesto codicistico |
| **PrinciplesExpert** | Interpretazione teleologica | Art. 12, comma 2 - "intenzione del legislatore" | Lavori preparatori, ratio legis, principi generali |
| **PrecedentExpert** | Interpretazione giurisprudenziale | Prassi applicativa | Massime Cassazione, giurisprudenza di merito |

### 2.2 Validazione Comunitaria (RLCF)

Il sistema RLCF (Reinforcement Learning from Community Feedback) implementa un meccanismo di validazione distribuita ispirato ai principi di:

1. **Peer Review Giuridico**: Validazione da parte di esperti qualificati
2. **Authority Dinamica**: Peso del voto proporzionale alla competenza dimostrata
3. **Consensus Building**: Soglie di approvazione basate su somma pesata

**Formula Authority**:
```
authority = λ × baseline + (1-λ) × (w_tr × track_record + w_perf × performance)

Dove:
- λ = 0.15 (peso baseline)
- baseline = 0.3 (studente) / 0.5 (laureato) / 0.7 (professionista)
- track_record = (voti_corretti / voti_totali)
- performance = media(quality_scores)
- w_tr = 0.35, w_perf = 0.25
```

**Soglie Consensus**:
- **Approvazione**: Σ(vote × authority) ≥ 2.0
- **Rigetto**: Σ(vote × authority) ≤ -1.5
- **Reopen (Issue)**: Σ(upvote × authority) ≥ 2.0

### 2.3 Tipi di Entita' Giuridiche

| Tipo | Descrizione | Esempio |
|------|-------------|---------|
| `concetto` | Concetto giuridico astratto | "buona fede", "colpa" |
| `istituto` | Istituto giuridico strutturato | "contratto", "responsabilita'" |
| `diritto` | Diritto soggettivo | "diritto di proprieta'" |
| `obbligo` | Obbligo giuridico | "obbligo di risarcimento" |
| `principio` | Principio generale | "principio di legalita'" |
| `fattispecie` | Fattispecie astratta | "dolo", "caso fortuito" |
| `sanzione` | Sanzione giuridica | "nullita'", "annullabilita'" |
| `procedura` | Procedura/iter | "procedimento sommario" |
| `soggetto` | Soggetto di diritto | "creditore", "fideiussore" |
| `termine` | Termine tecnico | "anatocismo" |

### 2.4 Tipi di Relazioni

| Tipo | Descrizione | Direzione |
|------|-------------|-----------|
| `RIFERIMENTO` | Riferimento normativo | Articolo → Articolo |
| `MODIFICA` | Modifica normativa | Nuovo → Vecchio |
| `ABROGA` | Abrogazione | Nuovo → Abrogato |
| `DEROGA` | Deroga/eccezione | Speciale → Generale |
| `INTERPRETA` | Interpretazione autentica | Interpretante → Interpretato |
| `APPLICA` | Applicazione giurisprudenziale | Sentenza → Norma |
| `DEFINISCE` | Definizione | Norma → Concetto |
| `GENUS` | Relazione genere-specie | Genere → Specie |
| `PRESUPPONE` | Presupposizione logica | Norma → Presupposto |

---

## PARTE III: FEATURE DA IMPLEMENTARE

### 3.1 Priorita' P0 - CRITICAL (Settimana 1)

#### P0.1: Fix PostgreSQL Persistence
**Problema**: Storage in-memory perde dati al restart

**Status**: ✅ GIA' RISOLTO (verificato in sessione precedente)
- `PendingEntity`, `PendingRelation`, `EntityVote` gia' su PostgreSQL
- `EntityIssueReport`, `EntityIssueVote` implementati

**Files**:
- `merlt/storage/enrichment/models.py` ✅
- `merlt/api/enrichment_router.py` ✅

---

#### P0.2: Fix FalkorDB Write on Approval
**Problema**: Entity/Relation approvate non vengono scritte nel grafo

**Status**: ✅ GIA' RISOLTO
- `_write_entity_to_graph()` implementato
- `_write_relation_to_graph()` implementato
- Chiamati automaticamente quando consensus reached

**Files**:
- `merlt/api/enrichment_router.py` ✅

---

#### P0.3: Fix Issue Reopen Entity
**Problema**: Bug nei nomi campi PendingEntity

**Status**: ✅ GIA' RISOLTO (commit `803acc5`)
- Corretto `nome` → `entity_text`
- Corretto `source` → `fonte`

---

### 3.2 Priorita' P1 - HIGH (Settimana 2-3)

#### P1.1: Drawer Laterale per Proposte (R1)
**Obiettivo**: Sostituire modal con drawer per mantenere visibilita' articolo

**Files da Creare**:
```
frontend/src/components/features/merlt/
├── ProposeEntityDrawer.tsx      # Pattern BrocardiDrawer
└── ProposeRelationDrawer.tsx    # Con autocomplete entita'
```

**Specifiche UI**:
```tsx
// ProposeEntityDrawer.tsx
<motion.div
  initial={{ x: '100%' }}
  animate={{ x: 0 }}
  exit={{ x: '100%' }}
  className="fixed right-0 top-0 h-full w-[500px] bg-slate-900 shadow-2xl z-50"
>
  <DrawerHeader title="Proponi Entita'" onClose={onClose} />
  <DrawerBody>
    <EntityForm
      initialName={selectedText}
      articleUrn={articleUrn}
      onSubmit={handleSubmit}
    />
  </DrawerBody>
</motion.div>
```

---

#### P1.2: Text Selection → Proposta (R2)
**Obiettivo**: Permettere proposta entita' da testo selezionato

**File da Modificare**:
- `frontend/src/components/features/search/SelectionPopup.tsx`

**Nuove Azioni**:
```tsx
const POPUP_ACTIONS = [
  // Esistenti
  { id: 'highlight', icon: Highlighter, label: 'Evidenzia' },
  { id: 'note', icon: MessageSquare, label: 'Nota' },
  { id: 'copy', icon: Copy, label: 'Copia' },
  // NUOVE
  { id: 'propose-entity', icon: Sparkles, label: 'Proponi entita'', color: 'text-amber-500' },
  { id: 'propose-relation', icon: Link2, label: 'Proponi relazione', color: 'text-purple-500' },
];
```

---

#### P1.3: Autocomplete Relation Linking (R3)
**Obiettivo**: Ricerca fuzzy entita' esistenti per relazioni

**Backend** - Nuovo endpoint:
```python
# merlt/api/graph_router.py

@router.get("/entities/search")
async def search_entities(
    q: str,
    article_urn: Optional[str] = None,
    limit: int = 10,
) -> List[EntitySearchResult]:
    """
    Ricerca fuzzy entita' nel grafo per autocomplete.
    Ordina per: exact match > approval_score > llm_confidence
    """
    query = """
    MATCH (e:Entity)
    WHERE toLower(e.nome) CONTAINS toLower($q)
       OR toLower(e.descrizione) CONTAINS toLower($q)
    RETURN e.id, e.nome, e.tipo, e.approval_score
    ORDER BY
      CASE WHEN toLower(e.nome) = toLower($q) THEN 0 ELSE 1 END,
      e.approval_score DESC
    LIMIT $limit
    """
```

**Frontend** - Combobox:
```tsx
// ProposeRelationDrawer.tsx
<Combobox value={targetEntity} onChange={setTargetEntity}>
  <ComboboxInput
    onChange={(e) => setSearchQuery(e.target.value)}
    placeholder="Cerca entita' esistente..."
  />
  <ComboboxOptions>
    {suggestions?.map(entity => (
      <ComboboxOption key={entity.id} value={entity}>
        <span className="font-medium">{entity.nome}</span>
        <Badge variant="outline">{entity.tipo}</Badge>
      </ComboboxOption>
    ))}
  </ComboboxOptions>
</Combobox>
```

---

#### P1.4: Unificare AI/Community (R4)
**Obiettivo**: Lista unica entita' con badge origine

**File da Modificare**:
- `frontend/src/components/features/merlt/MerltInspectorPanel.tsx`

**Nuovo Layout**:
```tsx
// Lista unica con badge
<EntityList>
  {allEntities.map(entity => (
    <EntityCard key={entity.id} entity={entity}>
      <Badge variant={entity.fonte === 'llm_extraction' ? 'ai' : 'community'}>
        {entity.fonte === 'llm_extraction' ? 'AI' : 'Community'}
      </Badge>
    </EntityCard>
  ))}
</EntityList>
```

---

#### P1.5: Norm Resolver (R5)
**Obiettivo**: Risoluzione URN da linguaggio naturale

**Backend** - Nuovo endpoint:
```python
# merlt/api/graph_router.py

@router.post("/resolve-norm")
async def resolve_norm(request: NormResolveRequest) -> NormResolveResponse:
    """
    Converte riferimento naturale in URN.
    Input: "Art. 1218 c.c."
    Output: "urn:nir:stato:codice.civile:1942-04-04;1218"
    """
    # Pattern matching
    patterns = [
        (r"art\.?\s*(\d+(?:-\w+)?)\s+c\.?c\.?", "codice.civile"),
        (r"art\.?\s*(\d+(?:-\w+)?)\s+c\.?p\.?", "codice.penale"),
        (r"art\.?\s*(\d+(?:-\w+)?)\s+cost\.?", "costituzione"),
    ]

    for pattern, atto in patterns:
        match = re.search(pattern, request.input.lower())
        if match:
            articolo = match.group(1)
            return NormResolveResponse(
                urn=build_urn(atto, articolo),
                tipo_atto=atto,
                articolo=articolo,
                confidence=0.95
            )

    # Fallback: LLM extraction
    return await llm_resolve_norm(request.input)
```

---

#### P1.6: Graph API Completo
**Obiettivo**: API per visualizzazione e navigazione grafo

**File da Creare**:
- `merlt/api/graph_router.py`

**Endpoints**:
```python
# GET /api/v1/graph/check-article
@router.get("/check-article")
async def check_article(
    tipo_atto: str,
    articolo: str,
) -> CheckArticleResponse:
    """Verifica se articolo esiste nel grafo."""

# GET /api/v1/graph/subgraph
@router.get("/subgraph")
async def get_subgraph(
    article_urn: str,
    depth: int = 2,
    max_nodes: int = 100,
) -> SubgraphResponse:
    """Ritorna subgraph centrato su articolo."""

# GET /api/v1/graph/node/{node_id}
@router.get("/node/{node_id}")
async def get_node_details(node_id: str) -> NodeDetailsResponse:
    """Dettagli completi di un nodo."""

# GET /api/v1/graph/node/{node_id}/relations
@router.get("/node/{node_id}/relations")
async def get_node_relations(node_id: str) -> List[RelationResponse]:
    """Tutte le relazioni di un nodo."""
```

---

### 3.3 Priorita' P2 - MEDIUM (Settimana 4)

#### P2.1: Domain Authority
**Obiettivo**: Calcolo authority per dominio giuridico

**Backend**:
```python
# merlt/api/profile_router.py

async def calculate_domain_authority(user_id: str) -> Dict[str, float]:
    """
    Calcola authority per dominio basata su accuracy voti.
    """
    domains = ["civile", "penale", "amministrativo", "tributario",
               "lavoro", "costituzionale", "europeo", "internazionale"]

    result = {}
    for domain in domains:
        stats = await get_user_domain_stats(user_id, domain)
        if stats.total_votes > 0:
            result[domain] = stats.correct_votes / stats.total_votes
        else:
            result[domain] = 0.3  # baseline

    return result
```

**Frontend** - ProfilePage:
```tsx
// pages/ProfilePage.tsx
<DomainAuthorityChart
  domains={domainAuthority}
  onChange={handleDomainClick}
/>
```

---

#### P2.2: Document Upload
**Obiettivo**: Upload PDF/DOCX per arricchire grafo

**Backend** - Text Extractors:
```python
# merlt/pipeline/text_extractors.py

class PDFExtractor:
    async def extract(self, file_path: Path) -> ExtractedDocument:
        import pdfplumber
        with pdfplumber.open(file_path) as pdf:
            text = "\n".join(page.extract_text() for page in pdf.pages)
        return ExtractedDocument(text=text, source="pdf")

class DOCXExtractor:
    async def extract(self, file_path: Path) -> ExtractedDocument:
        from docx import Document
        doc = Document(file_path)
        text = "\n".join(para.text for para in doc.paragraphs)
        return ExtractedDocument(text=text, source="docx")
```

**Frontend** - Upload Tab:
```tsx
// components/features/contribution/DocumentUploadTab.tsx
<DropZone
  accept={['.pdf', '.docx', '.txt']}
  onDrop={handleFileUpload}
  maxSize={10 * 1024 * 1024}  // 10MB
>
  <UploadIcon />
  <p>Trascina documenti qui o clicca per selezionare</p>
</DropZone>
```

---

#### P2.3: Authority Visualization in Graph
**Obiettivo**: Visualizzare authority tramite dimensione/glow nodi

**Modifiche a GraphViewer**:
```tsx
// components/features/contribution/GraphViewer.tsx

const getNodeSize = (node: GraphNode) => {
  const baseSize = 20;
  const authorityMultiplier = 0.7 + (node.approval_score || 0) * 0.8;
  return baseSize * authorityMultiplier;
};

const getNodeGlow = (node: GraphNode) => {
  if ((node.approval_score || 0) > 0.7) {
    return 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))';
  }
  return 'none';
};
```

---

### 3.4 Priorita' P3 - NER Training (Settimana 5)

#### P3.1: Citation NER Trainer
**Obiettivo**: Modello NER per citazioni giuridiche

**File**:
```python
# merlt/rlcf/citation_ner.py

class CitationNERTrainer:
    """
    Addestra modello NER per citazioni giuridiche usando RLCF.

    Labels:
    - ACT_TYPE: "codice civile", "legge", "d.lgs"
    - ACT_NUMBER: "241", "679"
    - DATE: "1990", "2016"
    - ARTICLE: "1218", "2043", "52-bis"
    """

    def __init__(self):
        self.nlp = spacy.load("it_core_news_lg")
        ner = self.nlp.get_pipe("ner")
        for label in ["ACT_TYPE", "ACT_NUMBER", "DATE", "ARTICLE"]:
            ner.add_label(label)

    async def train_from_feedback(
        self,
        feedback_batch: List[CitationFeedback]
    ) -> TrainingMetrics:
        """
        Addestra NER da feedback utente.
        Feedback positivo = user ha confermato parsing
        Feedback negativo = user ha corretto parsing
        """
        training_data = self._convert_feedback_to_spacy(feedback_batch)

        with self.nlp.disable_pipes(*[p for p in self.nlp.pipe_names if p != "ner"]):
            optimizer = self.nlp.resume_training()
            for _ in range(10):  # mini-epochs
                random.shuffle(training_data)
                losses = {}
                for text, annotations in training_data:
                    self.nlp.update([text], [annotations], sgd=optimizer, losses=losses)

        return TrainingMetrics(ner_loss=losses.get("ner", 0))
```

---

#### P3.2: Legal Entity NER Trainer
**Obiettivo**: NER per entita' giuridiche da text selection

**File**:
```python
# merlt/rlcf/legal_entity_ner.py

class LegalEntityNERTrainer:
    """
    Addestra NER per entita' giuridiche usando feedback R2.
    Ogni text selection → proposta entita' = training data.
    """

    ENTITY_TYPE_TO_NER = {
        "concetto": "CONCETTO",
        "istituto": "ISTITUTO",
        "diritto": "DIRITTO",
        "obbligo": "OBBLIGO",
        "principio": "PRINCIPIO",
        "fattispecie": "FATTISPECIE",
        "sanzione": "SANZIONE",
    }

    async def register_text_selection(
        self,
        text: str,
        selected_text: str,
        entity_type: str,
        article_urn: str,
    ) -> None:
        """
        Registra text selection come training data.
        """
        # Find span in text
        start = text.find(selected_text)
        end = start + len(selected_text)

        training_example = TrainingExample(
            text=text,
            entities=[(start, end, self.ENTITY_TYPE_TO_NER[entity_type])],
            article_urn=article_urn,
        )

        await self.training_buffer.add(training_example)
```

---

#### P3.3: Context-Aware NER
**Obiettivo**: Coreference resolution per citazioni distanti

**Problema**:
```
"Art. 1453 c.c. prevede la risoluzione per inadempimento.
[100 parole dopo...]
L'articolo stabilisce che il contraente..."
```

**Soluzione**:
```python
# merlt/rlcf/coreference_resolver.py

class CoreferenceResolver:
    """
    Risolve riferimenti anaforici a norme.
    "l'articolo" → "Art. 1453 c.c."
    """

    ANAPHORIC_PATTERNS = [
        r"l'articolo",
        r"la norma",
        r"il comma",
        r"la disposizione",
        r"tale articolo",
        r"detta norma",
    ]

    async def resolve(
        self,
        text: str,
        context_window: int = 200,
    ) -> List[ResolvedReference]:
        """
        Trova riferimenti anaforici e li risolve al referente piu' vicino.
        """
        # 1. Find all explicit citations
        explicit_citations = await self.citation_ner.extract(text)

        # 2. Find anaphoric references
        anaphoric = self._find_anaphoric(text)

        # 3. Resolve each anaphoric to nearest explicit
        resolved = []
        for anaphor in anaphoric:
            nearest = self._find_nearest_citation(
                anaphor.position,
                explicit_citations,
                context_window
            )
            if nearest:
                resolved.append(ResolvedReference(
                    anaphor=anaphor,
                    referent=nearest,
                    confidence=self._calculate_confidence(anaphor, nearest)
                ))

        return resolved
```

---

### 3.5 Priorita' P4 - Testing & Polish (Settimana 6)

#### P4.1: Integration Tests
**File**:
```typescript
// frontend/src/__tests__/integration/graph-qa-bridge.test.ts

describe('Graph-QA Bridge', () => {
  it('should navigate from Q&A source to graph node', async () => {
    // 1. Render Q&A with source
    const { getByText } = render(<QAPanel />);

    // 2. Submit query
    await userEvent.type(getByRole('textbox'), 'Art. 1218 c.c.');
    await userEvent.click(getByRole('button', { name: 'Chiedi' }));

    // 3. Click "Vedi nel grafo" on source
    await waitFor(() => {
      expect(getByText('Art. 1218 c.c.')).toBeInTheDocument();
    });
    await userEvent.click(getByText('Vedi nel grafo'));

    // 4. Verify graph navigation
    expect(mockNavigate).toHaveBeenCalledWith(
      '/contribute',
      expect.objectContaining({
        state: { selectedNode: 'urn:nir:stato:codice.civile:1942-04-04;1218' }
      })
    );
  });
});
```

#### P4.2: E2E Tests
```python
# tests/api/test_e2e_enrichment_workflow.py

@pytest.mark.asyncio
async def test_full_enrichment_workflow():
    """
    Test completo: enrichment → validation → graph write → issue report
    """
    # 1. Live enrichment
    response = await client.post("/api/v1/enrichment/live", json={
        "tipo_atto": "codice civile",
        "articolo": "1337",
        "include_brocardi": True,
    })
    assert response.status_code == 200
    entities = response.json()["pending_entities"]

    # 2. Validate entity (approve)
    entity_id = entities[0]["entity_id"]
    for _ in range(3):  # 3 votes to reach threshold
        await client.post("/api/v1/enrichment/validate-entity", json={
            "entity_id": entity_id,
            "user_id": f"user_{_}",
            "vote": "approve",
        })

    # 3. Verify written to graph
    graph_response = await client.get(f"/api/v1/graph/node/{entity_id}")
    assert graph_response.status_code == 200
    assert graph_response.json()["validation_status"] == "approved"

    # 4. Report issue
    issue_response = await client.post("/api/v1/enrichment/report-issue", json={
        "entity_id": entity_id,
        "issue_type": "factual_error",
        "description": "Test issue",
        "user_id": "reporter_1",
    })
    assert issue_response.status_code == 200

    # 5. Vote on issue to reach threshold
    issue_id = issue_response.json()["issue_id"]
    for _ in range(3):
        await client.post("/api/v1/enrichment/vote-issue", json={
            "issue_id": issue_id,
            "user_id": f"voter_{_}",
            "vote": "upvote",
        })

    # 6. Verify entity reopened
    entity_check = await client.get(f"/api/v1/graph/node/{entity_id}")
    assert entity_check.json()["validation_status"] == "needs_revision"
```

---

## PARTE IV: FILE INVENTORY

### 4.1 Files da Creare

#### Backend MERL-T (6 files)
```
/Users/gpuzio/Desktop/CODE/MERL-T_alpha/merlt/api/
├── graph_router.py                  # P1.6 - Graph API
└── profile_router.py                # P2.1 - Profile/Authority API

/Users/gpuzio/Desktop/CODE/MERL-T_alpha/merlt/pipeline/
└── text_extractors.py               # P2.2 - PDF/DOCX extraction

/Users/gpuzio/Desktop/CODE/MERL-T_alpha/merlt/rlcf/
├── citation_ner.py                  # P3.1 - Citation NER
├── legal_entity_ner.py              # P3.2 - Entity NER
└── coreference_resolver.py          # P3.3 - Coreference resolution
```

#### Frontend VisuaLex (14 files)
```
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/components/features/merlt/
├── ProposeEntityDrawer.tsx          # P1.1
├── ProposeRelationDrawer.tsx        # P1.1
└── IssueVoteCard.tsx                # Optional

/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/components/features/contribution/
├── DocumentUploadTab.tsx            # P2.2
└── GraphDetailPanel.tsx             # P1.6

/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/components/ui/
├── EmptyState.tsx                   # UI Polish
└── StatsCard.tsx                    # UI Polish

/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/pages/
└── ProfilePage.tsx                  # P2.1

/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/components/features/profile/
├── AuthorityBar.tsx                 # P2.1
├── DomainAuthorityChart.tsx         # P2.1
├── ContributionStatsGrid.tsx        # P2.1
└── ProfileSettingsForm.tsx          # P2.1

/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/hooks/
├── useGraphSync.ts                  # P1.6
├── useDocumentUpload.ts             # P2.2
└── useUserProfile.ts                # P2.1
```

### 4.2 Files da Modificare

#### Backend MERL-T (4 files)
```
merlt/api/enrichment_router.py       # P1.3, P1.5
merlt/api/app.py                     # Register new routers
merlt/api/models/enrichment_models.py # New request/response models
merlt/storage/enrichment/models.py   # ✅ Gia' aggiornato
```

#### Frontend VisuaLex (9 files)
```
src/components/features/search/SelectionPopup.tsx       # P1.2
src/components/features/merlt/MerltInspectorPanel.tsx   # P1.4
src/components/features/qa/SourcePanel.tsx              # P1.6
src/components/features/contribution/ContributePage.tsx # P1.6, P2.2
src/components/features/contribution/GraphViewer.tsx    # P1.6, P2.3
src/components/features/bulletin/CommunityValidationPage.tsx # UI Polish
src/components/features/bulletin/KnowledgeGraphExplorer.tsx # ✅ Search implementato
src/services/merltService.ts                            # New API calls
src/App.tsx                                             # Route /profile
```

---

## PARTE V: CHECKLIST IMPLEMENTAZIONE

### Settimana 1: Critical Fixes
- [x] P0.1: PostgreSQL Persistence ✅
- [x] P0.2: FalkorDB Write on Approval ✅
- [x] P0.3: Fix Issue Reopen ✅
- [ ] P1.6: `graph_router.py` base endpoints

### Settimana 2: UX Refinement
- [ ] P1.1: ProposeEntityDrawer.tsx
- [ ] P1.1: ProposeRelationDrawer.tsx
- [ ] P1.2: SelectionPopup.tsx azioni
- [ ] P1.3: `/graph/entities/search` endpoint
- [ ] P1.4: MerltInspectorPanel unificato

### Settimana 3: Graph Integration
- [ ] P1.5: `/graph/resolve-norm` endpoint
- [ ] P1.6: `/graph/subgraph` endpoint
- [ ] P1.6: `/graph/node/{id}` endpoint
- [ ] P1.6: GraphDetailPanel.tsx
- [ ] P1.6: SourcePanel.tsx badges

### Settimana 4: Domain Authority & Upload
- [ ] P2.1: `profile_router.py`
- [ ] P2.1: ProfilePage.tsx + componenti
- [ ] P2.2: `text_extractors.py`
- [ ] P2.2: DocumentUploadTab.tsx
- [ ] P2.3: GraphViewer authority viz

### Settimana 5: NER Training
- [ ] P3.1: `citation_ner.py`
- [ ] P3.2: `legal_entity_ner.py`
- [ ] P3.3: `coreference_resolver.py`
- [ ] Integration con R2 flow

### Settimana 6: Testing & Polish
- [ ] P4.1: Integration tests
- [ ] P4.2: E2E tests
- [ ] UI polish (EmptyState, StatsCard)
- [ ] Documentation update

---

## PARTE VI: METRICHE DI SUCCESSO

### 6.1 Metriche Tecniche
| Metrica | Target | Come Misurare |
|---------|--------|---------------|
| Test Coverage | > 80% | `pytest --cov` |
| Test Passing | > 95% | CI/CD pipeline |
| API Response Time | < 500ms | Prometheus metrics |
| Graph Query Time | < 200ms | FalkorDB profiling |

### 6.2 Metriche RLCF
| Metrica | Target | Come Misurare |
|---------|--------|---------------|
| Entity Approval Rate | > 60% | `approved / total_pending` |
| Authority Convergence | Stabilita' dopo 50 voti | `variance(authority)` |
| Issue Resolution | < 48h median | `resolved_at - created_at` |
| NER Accuracy | F1 > 0.80 | Test set manuale |

### 6.3 Metriche UX
| Metrica | Target | Come Misurare |
|---------|--------|---------------|
| Proposal Completion | > 70% | `submitted / started` |
| Validation Time | < 30s median | Analytics |
| User Retention | > 40% weekly | Active users |

---

## PARTE VII: RISCHI E MITIGAZIONI

| Rischio | Probabilita' | Impatto | Mitigazione |
|---------|--------------|---------|-------------|
| NER Training richiede troppi dati | Media | Alto | Fallback a rule-based |
| Performance grafo con molti nodi | Bassa | Medio | Pagination + caching |
| Coreference resolution impreciso | Media | Medio | Threshold confidence alto |
| User adoption bassa | Media | Alto | Gamification + onboarding |

---

## APPENDICE A: Convenzioni Codice

### A.1 Naming Conventions
```python
# Backend (Python)
class EntityValidator:          # PascalCase per classi
def validate_entity():          # snake_case per funzioni
APPROVAL_THRESHOLD = 2.0        # UPPER_SNAKE per costanti
entity_id: str                  # snake_case per variabili
```

```typescript
// Frontend (TypeScript)
interface EntityProps {}        // PascalCase per interface
function validateEntity() {}    // camelCase per funzioni
const APPROVAL_THRESHOLD = 2.0; // UPPER_SNAKE per costanti
const entityId: string;         // camelCase per variabili
```

### A.2 Database Naming
```sql
-- PostgreSQL
CREATE TABLE pending_entities (     -- snake_case plurale
    entity_id VARCHAR(100),         -- snake_case
    validation_status VARCHAR(20),
    created_at TIMESTAMP
);
```

```cypher
// FalkorDB
CREATE (n:Norma {                   // PascalCase per label
    urn: "...",                     // camelCase per proprieta'
    articleNumber: "1218"
})
```

### A.3 API Conventions
```
GET    /api/v1/resource            # Lista
GET    /api/v1/resource/{id}       # Dettaglio
POST   /api/v1/resource            # Creazione
PUT    /api/v1/resource/{id}       # Update completo
PATCH  /api/v1/resource/{id}       # Update parziale
DELETE /api/v1/resource/{id}       # Eliminazione
```

---

## APPENDICE B: Glossario

| Termine | Definizione |
|---------|-------------|
| **RLCF** | Reinforcement Learning from Community Feedback |
| **Authority** | Peso del voto di un utente nel sistema |
| **Consensus** | Soglia di approvazione/rigetto raggiunta |
| **Pending** | Entita'/relazione in attesa di validazione |
| **URN** | Uniform Resource Name per identificare norme |
| **Coreference** | Riferimento anaforico a entita' gia' menzionata |
| **NER** | Named Entity Recognition |

---

*Piano generato il 7 Gennaio 2026*
*Sistema Multi-Agente Claude Code*
