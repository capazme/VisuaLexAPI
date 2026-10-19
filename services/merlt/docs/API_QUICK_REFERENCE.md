# MERL-T API Quick Reference

**Base URL**: `http://localhost:8001/api/v1`

---

## 🚀 Quick Start Routes

| Endpoint | Method | Descrizione |
|----------|--------|-------------|
| `/health` | GET | Health check API |
| `/enrichment/live` | POST | Live enrichment articolo |
| `/enrichment/pending` | GET | Lista pending da validare |
| `/enrichment/validate-entity` | POST | Vota entità |
| `/enrichment/propose-entity` | POST | Proponi entità |
| `/documents/upload` | POST | Upload documento |
| `/documents/{id}/parse` | POST | Parsing documento con LLM |
| `/documents/{id}` | GET | Info documento |
| `/api/experts/query` | POST | Q&A multi-expert |
| `/profile/full` | GET | Profilo utente completo |

---

## 📦 Request/Response Examples

### 1. Live Enrichment

```bash
POST /api/v1/enrichment/live
```

```json
{
  "tipo_atto": "codice civile",
  "articolo": "1453",
  "user_id": "user_123",
  "user_authority": 0.5,
  "extract_entities": true
}
```

→ Returns: `{ success, article, pending_entities[], graph_preview }`

---

### 2. Validate Entity

```bash
POST /api/v1/enrichment/validate-entity
```

```json
{
  "entity_id": "principio:abc123",
  "vote": "approve",
  "user_id": "user_123",
  "user_authority": 0.5
}
```

→ Returns: `{ success, new_status, approval_score, graph_node_id }`

**⚠️ Auto-write**: Se `approval_score >= 2.0` → scrive automaticamente al grafo!

---

### 3. Upload Document

```bash
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```
file: [PDF/TXT/DOCX file]
document_type: "manuale"
legal_domain: "civile"
user_id: "user_123"
```

→ Returns: `{ success, document_id, duplicate }`

---

### 4. Parse Document

```bash
POST /api/v1/documents/69/parse
```

```json
{
  "extract_entities": true,
  "extract_amendments": false,
  "legal_domain": "civile",
  "user_id": "user_123"
}
```

→ Returns: `{ success, entities_extracted, relations_extracted }`

**✨ Estrae automaticamente** con LLM (Gemini 2.5 Flash):
- Principi
- Concetti
- Definizioni

---

### 5. Get Pending Queue

```bash
GET /api/v1/enrichment/pending?user_id=user_123&limit=20
```

→ Returns: `{ pending_entities[], pending_relations[], total_entities }`

---

### 6. Expert Q&A

```bash
POST /api/v1/api/experts/query
```

```json
{
  "user_id": "user_123",
  "question": "Requisiti legittima difesa?",
  "legal_domain": "penale"
}
```

→ Returns: `{ query_id, answer, sources[], confidence_score }`

---

## 🔑 Key Enums

### EntityType
```
principio | concetto | definizione | soggetto | fatto |
procedura | termine | sanzione | rimedio | presunzione |
onere | diritto | obbligo | eccezione | invalidita |
inefficacia | decadenza
```

### ValidationStatus
```
pending | approved | rejected | needs_revision | expired
```

### VoteType
```
approve | reject | edit
```

### RelationType
```
SPECIES | GENUS | IMPLICA | DEROGA | INTEGRA |
RICHIAMA | MODIFICA | SOSTITUISCE | DISCIPLINA |
ESPRIME_PRINCIPIO | DEFINISCE
```

---

## ⚡ Important Notes

1. **Consensus threshold**: 2.0 (weighted votes)
2. **Authority range**: 0.0 - 1.0
3. **Max file size**: 50 MB
4. **Polling interval**: 3 secondi per document parsing
5. **Auto-write**: Consensus trigger scrive automaticamente al grafo

---

## 🔗 Full Documentation

Vedi `API_REFERENCE_FRONTEND.md` per documentazione completa con:
- Tutti gli endpoint
- Request/response dettagliati
- Workflow completi
- Error handling
- Best practices

---

**Updated**: 4 Gennaio 2026
