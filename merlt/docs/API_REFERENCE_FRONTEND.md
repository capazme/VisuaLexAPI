# MERL-T API Reference per Frontend

**Base URL**: `http://localhost:8001`
**API Version**: v1
**Prefix**: `/api/v1`

> ⚠️ **IMPORTANTE**: Tutti gli endpoint sotto `/api/v1` richiedono il prefix completo.
> Esempio: `POST /api/v1/enrichment/live` (non `/enrichment/live`)

---

## 📋 Indice

1. [Health & Status](#health--status)
2. [Enrichment (Live Enrichment & Validazione)](#enrichment-live-enrichment--validazione)
3. [Documents (Upload & Parsing)](#documents-upload--parsing)
4. [Experts (Q&A Multi-Expert)](#experts-qa-multi-expert)
5. [Auth & Profile](#auth--profile)
6. [Tipi di Dato Comuni](#tipi-di-dato-comuni)

---

## Health & Status

### GET `/health`

Health check dell'API.

**Response:**
```json
{
  "status": "healthy",
  "database": "healthy",
  "version": "1.0.0"
}
```

---

## Enrichment (Live Enrichment & Validazione)

### GET `/api/v1/enrichment/check-article`

Verifica se un articolo esiste già nel knowledge graph.

**Query Params:**
- `tipo_atto` (string, required) - Es: `"codice civile"`, `"codice penale"`
- `articolo` (string, required) - Es: `"1453"`, `"52"`

**Response:**
```json
{
  "exists": true,
  "urn": "urn:nir:stato:regio.decreto:1942-03-16;262~art1453"
}
```

---

### POST `/api/v1/enrichment/live`

Esegue live enrichment di un articolo (scraping Normattiva + Brocardi + LLM extraction).

**Request Body:**
```json
{
  "tipo_atto": "codice civile",
  "articolo": "1453",
  "user_id": "user_123",
  "user_authority": 0.5,
  "include_brocardi": true,
  "extract_entities": true,
  "priority_types": ["principio", "concetto", "definizione"]
}
```

**Response:**
```json
{
  "success": true,
  "article": {
    "urn": "urn:nir:...",
    "tipo_atto": "codice civile",
    "numero_articolo": "1453",
    "rubrica": "Risoluzione per inadempimento",
    "testo_vigente": "Il contratto può essere risolto...",
    "estremi": "R.D. 16 marzo 1942, n. 262",
    "url": "https://www.normattiva.it/..."
  },
  "pending_entities": [
    {
      "id": "principio:abc123",
      "nome": "Principio di proporzionalità",
      "tipo": "principio",
      "descrizione": "L'inadempimento deve essere...",
      "articoli_correlati": ["urn:nir:..."],
      "ambito": "diritto_civile",
      "fonte": "llm",
      "llm_confidence": 0.95,
      "raw_context": "...",
      "validation_status": "pending",
      "approval_score": 0.0,
      "rejection_score": 0.0,
      "votes_count": 0,
      "contributed_by": "user_123",
      "contributor_authority": 0.5,
      "created_at": "2026-01-04T16:00:00Z"
    }
  ],
  "pending_relations": [],
  "graph_preview": {
    "nodes": [
      {
        "id": "principio:abc123",
        "label": "Principio di proporzionalità",
        "type": "principio",
        "status": "pending",
        "confidence": 0.95
      }
    ],
    "links": []
  },
  "extraction_time_ms": 3500,
  "sources_used": ["normattiva", "brocardi", "llm"]
}
```

---

### GET `/api/v1/enrichment/pending`

Ottieni lista di entità/relazioni pending da validare.

**Query Params:**
- `user_id` (string, required)
- `legal_domain` (string, optional) - Es: `"civile"`, `"penale"`
- `include_own` (boolean, optional, default: false) - Includere proprie proposte
- `entity_types` (array, optional) - Filtra per tipo: `["principio", "concetto"]`
- `limit` (int, optional, default: 20, max: 100)
- `offset` (int, optional, default: 0)

**Response:**
```json
{
  "pending_entities": [
    {
      "id": "principio:abc123",
      "nome": "Principio di proporzionalità",
      "tipo": "principio",
      "descrizione": "...",
      "validation_status": "pending",
      "approval_score": 1.2,
      "rejection_score": 0.3,
      "votes_count": 3,
      "fonte": "llm_extraction",
      "llm_confidence": 0.95,
      "contributed_by": "user_456",
      "contributor_authority": 0.7
    }
  ],
  "pending_relations": [],
  "total_entities": 15,
  "total_relations": 0,
  "user_can_vote": 12
}
```

---

### POST `/api/v1/enrichment/validate-entity`

Vota per validare un'entità pending.

**Request Body:**
```json
{
  "entity_id": "principio:abc123",
  "vote": "approve",
  "suggested_edits": {
    "descrizione": "Descrizione corretta..."
  },
  "reason": "La definizione è accurata",
  "user_id": "user_123",
  "user_authority": 0.5
}
```

**Valori `vote`:**
- `"approve"` - Approva l'entità
- `"reject"` - Rifiuta l'entità
- `"edit"` - Richiedi modifiche (usa `suggested_edits`)

**Response:**
```json
{
  "success": true,
  "entity_id": "principio:abc123",
  "new_status": "approved",
  "approval_score": 2.5,
  "rejection_score": 0.3,
  "votes_count": 5,
  "message": "Entity approved and written to graph",
  "graph_node_id": "principio:proporzionalita"
}
```

> ⚠️ **Auto-write al grafo**: Quando `approval_score >= 2.0` o `rejection_score >= 2.0`, il consensus trigger PostgreSQL scrive automaticamente al grafo FalkorDB.

---

### POST `/api/v1/enrichment/propose-entity`

Proponi una nuova entità manualmente.

**Request Body:**
```json
{
  "article_urn": "urn:nir:stato:...",
  "nome": "Principio del contraddittorio",
  "tipo": "principio",
  "descrizione": "Le parti devono essere poste in condizione di...",
  "articoli_correlati": ["urn:nir:..."],
  "ambito": "diritto_civile",
  "evidence": "Riferimento: art. 111 Cost.",
  "source_reference": "Torrente, p. 123",
  "user_id": "user_123",
  "user_authority": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "pending_entity": {
    "id": "principio:xyz789",
    "nome": "Principio del contraddittorio",
    "tipo": "principio",
    "validation_status": "pending",
    "contributed_by": "user_123"
  },
  "message": "Proposta inviata per validazione community"
}
```

---

### POST `/api/v1/enrichment/validate-relation`

Valida una relazione pending.

**Request Body:**
```json
{
  "relation_id": "rel:abc123",
  "vote": "approve",
  "suggested_edits": null,
  "reason": "La relazione è corretta",
  "user_id": "user_123",
  "user_authority": 0.5
}
```

**Response:**
```json
{
  "success": true,
  "relation_id": "rel:abc123",
  "new_status": "approved",
  "approval_score": 2.0,
  "rejection_score": 0.0,
  "votes_count": 4,
  "message": "Relation approved"
}
```

---

### POST `/api/v1/enrichment/propose-relation`

Proponi una nuova relazione manualmente.

**Request Body:**
```json
{
  "source_urn": "urn:nir:...:art1453",
  "target_urn": "urn:nir:...:art1455",
  "relation_type": "SPECIES",
  "evidence": "Art. 1455 è un caso specifico di art. 1453",
  "source_reference": "Sentenza Cass. n. 12345/2020",
  "user_id": "user_123",
  "user_authority": 0.5
}
```

**Tipi `relation_type`:**
- `"SPECIES"` - Caso specifico di
- `"GENUS"` - Genere di
- `"IMPLICA"` - Implica
- `"DEROGA"` - Deroga a
- `"INTEGRA"` - Integra
- `"RICHIAMA"` - Richiama
- `"MODIFICA"` - Modifica
- `"SOSTITUISCE"` - Sostituisce

**Response:**
```json
{
  "success": true,
  "pending_relation": {
    "id": "rel:xyz789",
    "source_urn": "...",
    "target_urn": "...",
    "relation_type": "SPECIES",
    "validation_status": "pending"
  },
  "message": "Proposta inviata per validazione community"
}
```

---

## Documents (Upload & Parsing)

### POST `/api/v1/documents/upload`

Upload di un documento (PDF, TXT, DOCX).

**Request:** `multipart/form-data`
- `file` (file, required) - Documento da uploadare
- `document_type` (string, optional) - Es: `"dottrina"`, `"manuale"`, `"sentenza"`
- `legal_domain` (string, optional) - Es: `"civile"`, `"penale"`
- `title` (string, optional) - Titolo del documento
- `author` (string, optional) - Autore
- `publication_year` (int, optional) - Anno pubblicazione
- `user_id` (string, required) - ID utente

**Example cURL:**
```bash
curl -X POST http://localhost:8001/api/v1/documents/upload \
  -F "file=@manuale_torrente.pdf" \
  -F "document_type=manuale" \
  -F "legal_domain=civile" \
  -F "title=Manuale di Diritto Civile" \
  -F "author=Torrente" \
  -F "publication_year=2020" \
  -F "user_id=user_123"
```

**Response:**
```json
{
  "success": true,
  "document_id": 42,
  "message": "Document uploaded successfully (2.5 MB)",
  "duplicate": false
}
```

> 🔍 **Deduplication**: Se il file è già stato caricato (stesso SHA-256 hash), ritorna `duplicate: true` con l'ID esistente.

---

### POST `/api/v1/documents/{document_id}/parse`

Parsing del documento con estrazione LLM.

**Request Body:**
```json
{
  "extract_entities": true,
  "extract_amendments": false,
  "legal_domain": "civile",
  "user_id": "user_123"
}
```

**Response:**
```json
{
  "success": true,
  "document_id": 42,
  "entities_extracted": 11,
  "relations_extracted": 0,
  "amendments_extracted": 0,
  "message": "Document parsed successfully"
}
```

> ✨ **Estrazione LLM**: Il parser usa Google Gemini 2.5 Flash per estrarre automaticamente:
> - Principi giuridici
> - Concetti legali
> - Definizioni
>
> Tutte le entità estratte vengono salvate come `pending_entities` e sono accessibili tramite `/api/v1/enrichment/pending`.

---

### GET `/api/v1/documents/{document_id}`

Informazioni su un documento specifico.

**Response:**
```json
{
  "id": 42,
  "filename": "manuale_torrente.pdf",
  "file_type": "pdf",
  "file_size_bytes": 2621440,
  "document_type": "manuale",
  "legal_domain": "civile",
  "title": "Manuale di Diritto Civile",
  "author": "Torrente",
  "publication_year": 2020,
  "processing_status": "completed",
  "processing_error": null,
  "entities_extracted": 11,
  "relations_extracted": 0,
  "amendments_extracted": 0,
  "uploaded_by": "user_123",
  "created_at": "2026-01-04T15:30:00Z",
  "processing_completed_at": "2026-01-04T15:31:45Z"
}
```

**Valori `processing_status`:**
- `"uploaded"` - Caricato, in attesa di parsing
- `"parsing"` - Parsing in corso
- `"completed"` - Parsing completato
- `"failed"` - Parsing fallito (vedi `processing_error`)

---

### GET `/api/v1/documents`

Lista documenti caricati dall'utente.

**Query Params:**
- `user_id` (string, required)
- `limit` (int, optional, default: 50)
- `offset` (int, optional, default: 0)

**Response:**
```json
{
  "documents": [
    {
      "id": 42,
      "filename": "manuale_torrente.pdf",
      "file_type": "pdf",
      "processing_status": "completed",
      "entities_extracted": 11,
      "created_at": "2026-01-04T15:30:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

---

## Experts (Q&A Multi-Expert)

### POST `/api/v1/api/experts/query`

Interroga il sistema multi-expert.

> ⚠️ **NOTA**: Questo endpoint ha un doppio prefix: `/api/v1/api/experts` (è intenzionale).

**Request Body:**
```json
{
  "user_id": "user_123",
  "question": "Quali sono i requisiti della legittima difesa?",
  "legal_domain": "penale",
  "context": {
    "previous_queries": [],
    "user_profile": {
      "qualification": "studente"
    }
  }
}
```

**Response:**
```json
{
  "query_id": "q_abc123",
  "answer": "La legittima difesa richiede...",
  "sources": [
    {
      "article_urn": "urn:nir:...:art52",
      "snippet": "...",
      "relevance_score": 0.95
    }
  ],
  "confidence_score": 0.9,
  "expert_used": "literal",
  "timestamp": "2026-01-04T16:00:00Z"
}
```

---

### POST `/api/v1/api/experts/feedback/inline`

Feedback inline su risposta (thumbs up/down).

**Request Body:**
```json
{
  "query_id": "q_abc123",
  "user_id": "user_123",
  "rating": 1,
  "comment": "Risposta chiara e completa"
}
```

**Valori `rating`:**
- `1` - Thumbs up (positivo)
- `-1` - Thumbs down (negativo)

**Response:**
```json
{
  "success": true,
  "message": "Feedback registrato"
}
```

---

### POST `/api/v1/api/experts/feedback/detailed`

Feedback dettagliato su risposta.

**Request Body:**
```json
{
  "query_id": "q_abc123",
  "user_id": "user_123",
  "completeness": 4,
  "accuracy": 5,
  "clarity": 4,
  "relevance": 5,
  "overall": 4,
  "comment": "Ottima risposta, molto dettagliata"
}
```

**Scala voti:** 1-5 (1 = pessimo, 5 = eccellente)

**Response:**
```json
{
  "success": true,
  "message": "Feedback dettagliato registrato"
}
```

---

### POST `/api/v1/api/experts/feedback/source`

Feedback su fonte citata.

**Request Body:**
```json
{
  "query_id": "q_abc123",
  "user_id": "user_123",
  "source_id": "src_xyz",
  "rating": 1,
  "comment": "Fonte molto pertinente"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Feedback fonte registrato"
}
```

---

### POST `/api/v1/api/experts/feedback/refine`

Richiedi raffinamento della risposta.

**Request Body:**
```json
{
  "query_id": "q_abc123",
  "user_id": "user_123",
  "refinement_request": "Puoi approfondire l'aspetto dell'eccesso colposo?",
  "preferred_style": "detailed"
}
```

**Valori `preferred_style`:**
- `"concise"` - Risposta breve
- `"detailed"` - Risposta dettagliata
- `"technical"` - Linguaggio tecnico
- `"simple"` - Linguaggio semplice

**Response:**
```json
{
  "query_id": "q_def456",
  "answer": "L'eccesso colposo nella legittima difesa...",
  "sources": [...],
  "confidence_score": 0.92,
  "expert_used": "principles",
  "timestamp": "2026-01-04T16:05:00Z"
}
```

---

## Auth & Profile

### POST `/api/v1/auth/sync`

Sincronizza credenziali utente e calcola authority.

**Request Body:**
```json
{
  "user_id": "user_123",
  "email": "mario.rossi@example.com",
  "full_name": "Mario Rossi",
  "qualification": "avvocato",
  "specializations": ["civile", "contratti"],
  "years_experience": 5
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "user_123",
  "authority_score": 0.65,
  "domain_authorities": {
    "civile": 0.75,
    "penale": 0.45,
    "amministrativo": 0.50
  }
}
```

---

### GET `/api/v1/auth/authority/{user_id}`

Recupera authority score utente.

**Response:**
```json
{
  "user_id": "user_123",
  "global_authority": 0.65,
  "domain_authorities": {
    "civile": 0.75,
    "penale": 0.45
  },
  "last_updated": "2026-01-04T12:00:00Z"
}
```

---

### POST `/api/v1/auth/delta`

Applica delta authority per una singola azione.

**Request Body:**
```json
{
  "user_id": "user_123",
  "action": "entity_validation",
  "outcome": "approved",
  "domain": "civile"
}
```

**Azioni supportate:**
- `"entity_validation"` - Validazione entità
- `"relation_validation"` - Validazione relazione
- `"entity_proposal"` - Proposta entità
- `"document_upload"` - Upload documento

**Outcomes:**
- `"approved"` - Azione approvata dalla community
- `"rejected"` - Azione rifiutata
- `"consensus_reached"` - Consensus raggiunto

**Response:**
```json
{
  "success": true,
  "old_authority": 0.65,
  "new_authority": 0.67,
  "delta": 0.02
}
```

---

### GET `/api/v1/profile/full`

Profilo completo utente.

**Query Params:**
- `user_id` (string, required)

**Response:**
```json
{
  "user_id": "user_123",
  "email": "mario.rossi@example.com",
  "full_name": "Mario Rossi",
  "qualification": "avvocato",
  "specializations": ["civile", "contratti"],
  "years_experience": 5,
  "global_authority": 0.65,
  "domain_authorities": {
    "civile": 0.75,
    "penale": 0.45
  },
  "contribution_stats": {
    "entities_proposed": 15,
    "entities_validated": 42,
    "documents_uploaded": 3,
    "total_votes": 57
  },
  "created_at": "2025-12-01T10:00:00Z"
}
```

---

### GET `/api/v1/profile/authority/domains`

Authority per dominio legale (breakdown dettagliato).

**Query Params:**
- `user_id` (string, required)

**Response:**
```json
{
  "user_id": "user_123",
  "domains": {
    "civile": {
      "authority": 0.75,
      "contributions": 28,
      "consensus_rate": 0.85
    },
    "penale": {
      "authority": 0.45,
      "contributions": 12,
      "consensus_rate": 0.70
    },
    "amministrativo": {
      "authority": 0.50,
      "contributions": 8,
      "consensus_rate": 0.75
    }
  }
}
```

---

### GET `/api/v1/profile/stats/detailed`

Statistiche contributi dettagliate.

**Query Params:**
- `user_id` (string, required)

**Response:**
```json
{
  "user_id": "user_123",
  "entities": {
    "proposed": 15,
    "approved": 12,
    "rejected": 3,
    "pending": 0
  },
  "relations": {
    "proposed": 8,
    "approved": 6,
    "rejected": 2,
    "pending": 0
  },
  "validations": {
    "total_votes": 57,
    "approve_votes": 48,
    "reject_votes": 9,
    "consensus_reached": 42
  },
  "documents": {
    "uploaded": 3,
    "entities_extracted": 47,
    "total_size_mb": 12.5
  },
  "streak": {
    "current_days": 7,
    "longest_days": 14
  }
}
```

---

### PATCH `/api/v1/profile/qualification`

Aggiorna qualifiche utente.

**Request Body:**
```json
{
  "user_id": "user_123",
  "qualification": "magistrato",
  "specializations": ["penale", "procedura_penale"],
  "years_experience": 10
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "user_123",
  "global_authority": 0.80,
  "message": "Qualifica aggiornata. Authority ricalcolata."
}
```

---

### PATCH `/api/v1/profile/notifications`

Aggiorna preferenze notifiche.

**Request Body:**
```json
{
  "user_id": "user_123",
  "email_on_consensus": true,
  "email_on_reply": false,
  "email_digest_frequency": "weekly"
}
```

**Valori `email_digest_frequency`:**
- `"never"` - Mai
- `"daily"` - Giornaliero
- `"weekly"` - Settimanale
- `"monthly"` - Mensile

**Response:**
```json
{
  "success": true,
  "preferences": {
    "email_on_consensus": true,
    "email_on_reply": false,
    "email_digest_frequency": "weekly"
  }
}
```

---

## Tipi di Dato Comuni

### EntityType (enum)

```typescript
type EntityType =
  | "principio"
  | "concetto"
  | "definizione"
  | "soggetto"
  | "fatto"
  | "procedura"
  | "termine"
  | "sanzione"
  | "rimedio"
  | "presunzione"
  | "onere"
  | "diritto"
  | "obbligo"
  | "eccezione"
  | "invalidita"
  | "inefficacia"
  | "decadenza";
```

### ValidationStatus (enum)

```typescript
type ValidationStatus =
  | "pending"       // In attesa di validazione
  | "approved"      // Approvata (consensus >= 2.0)
  | "rejected"      // Rifiutata (consensus < -2.0)
  | "needs_revision" // Richiede modifiche
  | "expired";      // Scaduta (timeout)
```

### RelationType (enum)

```typescript
type RelationType =
  | "SPECIES"        // È un caso specifico di
  | "GENUS"          // È un genere di
  | "IMPLICA"        // Implica
  | "DEROGA"         // Deroga a
  | "INTEGRA"        // Integra
  | "RICHIAMA"       // Richiama
  | "MODIFICA"       // Modifica
  | "SOSTITUISCE"    // Sostituisce
  | "DISCIPLINA"     // Disciplina (articolo → entità)
  | "ESPRIME_PRINCIPIO" // Esprime principio
  | "DEFINISCE";     // Definisce
```

### VoteType (enum)

```typescript
type VoteType =
  | "approve"  // Approva
  | "reject"   // Rifiuta
  | "edit";    // Richiedi modifiche
```

### LegalDomain (string)

```typescript
type LegalDomain =
  | "civile"
  | "penale"
  | "amministrativo"
  | "costituzionale"
  | "tributario"
  | "commerciale"
  | "lavoro"
  | "internazionale";
```

---

## 🔐 Autenticazione

> ⚠️ **NOTA**: Attualmente l'API non richiede autenticazione (dev mode).
> In produzione, tutti gli endpoint richiedono un token JWT nell'header `Authorization: Bearer <token>`.

---

## 🌐 CORS

CORS è abilitato per:
- `http://localhost:3000` (React dev server)
- `http://localhost:5173` (Vite dev server)

Metodi consentiti: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
Headers consentiti: Tutti (`*`)

---

## 📊 Rate Limiting

> ⚠️ **NOTA**: Non implementato in dev mode.
> In produzione, rate limit: 100 req/min per IP.

---

## 🐛 Gestione Errori

Tutti gli errori seguono il formato:

```json
{
  "detail": "Descrizione dell'errore"
}
```

**Codici HTTP:**
- `200` - Success
- `400` - Bad Request (dati non validi)
- `404` - Not Found (risorsa non trovata)
- `413` - Payload Too Large (file troppo grande, max 50MB)
- `500` - Internal Server Error (errore server)

---

## 📝 Note Importanti per il Frontend

### 1. Consensus Auto-Write

Quando un'entità o relazione raggiunge il consensus (`approval_score >= 2.0`):
- ✅ Viene automaticamente scritta al grafo FalkorDB
- ✅ Lo status diventa `"approved"`
- ✅ Il campo `graph_node_id` contiene l'ID del nodo nel grafo

**Non serve chiamare alcun endpoint aggiuntivo** - il trigger PostgreSQL gestisce tutto automaticamente.

### 2. Authority-Weighted Voting

Ogni voto è pesato dall'authority dell'utente:
```javascript
vote_weight = user_authority * vote_value
// vote_value: +1 (approve) o -1 (reject)
// user_authority: 0.0 - 1.0
```

Esempio:
- User A (authority 0.8) vota "approve" → +0.8 all'approval_score
- User B (authority 0.3) vota "reject" → +0.3 al rejection_score

### 3. Document Parsing Asincrono

Il parsing di documenti può richiedere tempo:
1. Upload → `processing_status: "uploaded"`
2. Parsing inizia → `processing_status: "parsing"`
3. Polling con `GET /documents/{id}` ogni 2-5 secondi
4. Completato → `processing_status: "completed"`

**Non usare long polling** - meglio polling ogni 3 secondi.

### 4. LLM Extraction

Il parsing documenti estrae automaticamente:
- Principi giuridici
- Concetti legali
- Definizioni

Tutte finiscono come `pending_entities` accessibili via `/api/v1/enrichment/pending`.

### 5. Deduplication Documenti

I documenti sono deduplicati per hash SHA-256:
- Se carichi lo stesso file 2 volte → ritorna l'ID esistente
- Utile per evitare duplicati accidentali

---

## 🎯 Workflow Completi Consigliati

### Workflow 1: Live Enrichment + Validation

```javascript
// 1. Enrichment di un articolo
const enrichResponse = await fetch('/api/v1/enrichment/live', {
  method: 'POST',
  body: JSON.stringify({
    tipo_atto: 'codice civile',
    articolo: '1453',
    user_id: currentUser.id,
    user_authority: currentUser.authority,
    extract_entities: true
  })
});

const { pending_entities } = await enrichResponse.json();

// 2. Mostra entità all'utente per validazione
pending_entities.forEach(entity => {
  // Render UI con approve/reject buttons
});

// 3. User vota
const voteResponse = await fetch('/api/v1/enrichment/validate-entity', {
  method: 'POST',
  body: JSON.stringify({
    entity_id: entity.id,
    vote: 'approve',
    user_id: currentUser.id,
    user_authority: currentUser.authority
  })
});

const { new_status, graph_node_id } = await voteResponse.json();

if (new_status === 'approved') {
  console.log('✅ Entity approved and written to graph!', graph_node_id);
}
```

### Workflow 2: Document Upload + Parse

```javascript
// 1. Upload documento
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('document_type', 'manuale');
formData.append('legal_domain', 'civile');
formData.append('user_id', currentUser.id);

const uploadResponse = await fetch('/api/v1/documents/upload', {
  method: 'POST',
  body: formData
});

const { document_id } = await uploadResponse.json();

// 2. Avvia parsing
await fetch(`/api/v1/documents/${document_id}/parse`, {
  method: 'POST',
  body: JSON.stringify({
    extract_entities: true,
    extract_amendments: false,
    legal_domain: 'civile',
    user_id: currentUser.id
  })
});

// 3. Polling status
const pollInterval = setInterval(async () => {
  const statusResponse = await fetch(`/api/v1/documents/${document_id}`);
  const { processing_status, entities_extracted } = await statusResponse.json();

  if (processing_status === 'completed') {
    clearInterval(pollInterval);
    console.log(`✅ Extracted ${entities_extracted} entities!`);

    // 4. Fetch entità estratte
    const entitiesResponse = await fetch(
      `/api/v1/enrichment/pending?user_id=${currentUser.id}`
    );
    // Mostra entità per validazione...
  }
}, 3000); // Poll ogni 3 secondi
```

### Workflow 3: Multi-Expert Q&A

```javascript
// 1. User fa una domanda
const queryResponse = await fetch('/api/v1/api/experts/query', {
  method: 'POST',
  body: JSON.stringify({
    user_id: currentUser.id,
    question: 'Quali sono i requisiti della legittima difesa?',
    legal_domain: 'penale'
  })
});

const { query_id, answer, sources, confidence_score } = await queryResponse.json();

// 2. Mostra risposta + sources
renderAnswer(answer, sources);

// 3. User dà feedback (thumbs up)
await fetch('/api/v1/api/experts/feedback/inline', {
  method: 'POST',
  body: JSON.stringify({
    query_id,
    user_id: currentUser.id,
    rating: 1 // thumbs up
  })
});

// 4. (Opzionale) User richiede raffinamento
const refineResponse = await fetch('/api/v1/api/experts/feedback/refine', {
  method: 'POST',
  body: JSON.stringify({
    query_id,
    user_id: currentUser.id,
    refinement_request: 'Puoi approfondire l\'eccesso colposo?',
    preferred_style: 'detailed'
  })
});

const refinedAnswer = await refineResponse.json();
renderAnswer(refinedAnswer.answer, refinedAnswer.sources);
```

---

## 📞 Supporto

Per domande o segnalazioni:
- **Docs**: http://localhost:8001/docs (Swagger UI)
- **Health**: http://localhost:8001/health

---

**Versione API**: 1.0.0
**Ultimo aggiornamento**: 4 Gennaio 2026
