# Expert System API Reference
## Quick Guide per Frontend Developers

---

## BASE URL

```
Development: http://localhost:3001/api/merlt
Production: https://api.visualex.it/api/merlt
```

**Autenticazione**: Tutte le richieste richiedono header `Authorization: Bearer <token>`

---

## ENDPOINTS

### 1. Submit Query

**Endpoint**: `POST /experts/query`

**Request**:
```json
{
  "query": "Cos'è la legittima difesa?",
  "context": {
    "source": "article_page",
    "article_urn": "urn:nir:stato:codice.penale:1930;art52"
  },
  "max_experts": 4
}
```

**Response**:
```json
{
  "trace_id": "trace_a1b2c3d4e5f6",
  "synthesis": "La legittima difesa è un istituto giuridico previsto dall'art. 52 c.p. che esclude la punibilità...",
  "mode": "convergent",
  "alternatives": null,
  "sources": [
    {
      "article_urn": "urn:nir:stato:codice.penale:1930;art52",
      "expert": "literal",
      "relevance": 0.95,
      "quote": "Art. 52 c.p. - Non è punibile chi ha commesso il fatto..."
    }
  ],
  "experts_used": ["literal", "systemic", "principles"],
  "confidence": 0.87,
  "execution_time_ms": 2450
}
```

**Fields**:
- `trace_id`: ID univoco per feedback (SALVALO!)
- `synthesis`: Risposta sintetica
- `mode`: `"convergent"` (consensus) o `"divergent"` (interpretazioni multiple)
- `alternatives`: Array di interpretazioni alternative (solo se `mode="divergent"`)
- `sources`: Articoli citati con quote
- `experts_used`: Expert consultati
- `confidence`: Score 0-1 della confidence
- `execution_time_ms`: Tempo di esecuzione

---

### 2. Inline Feedback (Thumbs)

**Endpoint**: `POST /experts/feedback/inline`

**Request**:
```json
{
  "trace_id": "trace_a1b2c3d4e5f6",
  "rating": 5
}
```

**Rating scale**:
- `1`: 👎 Molto insoddisfatto
- `2`: 👎 Insoddisfatto
- `3`: 😐 Neutrale
- `4`: 👍 Soddisfatto
- `5`: 👍 Molto soddisfatto

**Response**:
```json
{
  "feedback_id": 123,
  "message": "Feedback saved successfully"
}
```

---

### 3. Detailed Feedback (3 Dimensions)

**Endpoint**: `POST /experts/feedback/detailed`

**Request**:
```json
{
  "trace_id": "trace_a1b2c3d4e5f6",
  "retrieval_score": 0.85,
  "reasoning_score": 0.90,
  "synthesis_score": 0.80,
  "comment": "Buona risposta, sintesi chiara e ben strutturata"
}
```

**Dimensions**:
- `retrieval_score` (0-1): Qualità delle fonti recuperate
- `reasoning_score` (0-1): Qualità del ragionamento giuridico
- `synthesis_score` (0-1): Qualità della sintesi finale
- `comment` (optional): Commento testuale

**Response**:
```json
{
  "feedback_id": 124,
  "message": "Detailed feedback saved successfully"
}
```

---

### 4. Per-Source Feedback (Star Rating)

**Endpoint**: `POST /experts/feedback/source`

**Request**:
```json
{
  "trace_id": "trace_a1b2c3d4e5f6",
  "source_id": "urn:nir:stato:codice.penale:1930;art52",
  "relevance": 5
}
```

**Relevance scale** (1-5 stars):
- `1`: ⭐ Non rilevante
- `2`: ⭐⭐ Poco rilevante
- `3`: ⭐⭐⭐ Moderatamente rilevante
- `4`: ⭐⭐⭐⭐ Molto rilevante
- `5`: ⭐⭐⭐⭐⭐ Perfettamente rilevante

**Response**:
```json
{
  "feedback_id": 125,
  "message": "Source feedback saved successfully"
}
```

**Note**: Puoi inviare feedback multipli per lo stesso `trace_id` ma diversi `source_id`.

---

### 5. Conversational Refinement (Follow-up)

**Endpoint**: `POST /experts/feedback/refine`

**Request**:
```json
{
  "trace_id": "trace_a1b2c3d4e5f6",
  "follow_up_query": "Quali sono i requisiti della proporzione nella legittima difesa?"
}
```

**Response**: Stesso formato di `POST /experts/query` (nuova query eseguita)

```json
{
  "trace_id": "trace_def456789abc",
  "synthesis": "I requisiti della proporzione nella legittima difesa...",
  "mode": "convergent",
  ...
}
```

**Note**: Il nuovo `trace_id` è linkato al precedente nel database MERL-T.

---

## TYPESCRIPT TYPES

```typescript
// Request Types
interface ExpertQueryRequest {
  query: string;
  context?: Record<string, any>;
  max_experts?: number; // 1-4
}

interface InlineFeedbackRequest {
  trace_id: string;
  rating: number; // 1-5
}

interface DetailedFeedbackRequest {
  trace_id: string;
  retrieval_score: number; // 0-1
  reasoning_score: number; // 0-1
  synthesis_score: number; // 0-1
  comment?: string;
}

interface SourceFeedbackRequest {
  trace_id: string;
  source_id: string; // URN
  relevance: number; // 1-5
}

interface RefineFeedbackRequest {
  trace_id: string;
  follow_up_query: string;
}

// Response Types
interface ExpertQueryResponse {
  trace_id: string;
  synthesis: string;
  mode: 'convergent' | 'divergent';
  alternatives?: Array<{
    expert: string;
    interpretation: string;
    legal_basis: string;
  }> | null;
  sources: Array<{
    article_urn: string;
    expert: string;
    relevance: number;
    quote?: string;
  }>;
  experts_used: string[];
  confidence: number; // 0-1
  execution_time_ms: number;
}

interface FeedbackResponse {
  feedback_id: number;
  message: string;
}
```

---

## ERROR RESPONSES

**401 Unauthorized**:
```json
{
  "error": "Not authenticated"
}
```

**400 Bad Request** (Validation error):
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "query",
      "message": "String must contain at least 5 character(s)"
    }
  ]
}
```

**500 Internal Server Error**:
```json
{
  "error": "Query failed",
  "detail": "MERL-T service temporarily unavailable"
}
```

---

## AXIOS EXAMPLE

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api/merlt',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Submit query
const submitQuery = async (query: string) => {
  const response = await api.post<ExpertQueryResponse>('/experts/query', {
    query,
    max_experts: 4,
  });
  return response.data;
};

// Submit inline feedback
const submitInlineFeedback = async (traceId: string, rating: number) => {
  const response = await api.post<FeedbackResponse>('/experts/feedback/inline', {
    trace_id: traceId,
    rating,
  });
  return response.data;
};

// Submit detailed feedback
const submitDetailedFeedback = async (
  traceId: string,
  scores: {
    retrieval: number;
    reasoning: number;
    synthesis: number;
    comment?: string;
  }
) => {
  const response = await api.post<FeedbackResponse>('/experts/feedback/detailed', {
    trace_id: traceId,
    retrieval_score: scores.retrieval,
    reasoning_score: scores.reasoning,
    synthesis_score: scores.synthesis,
    comment: scores.comment,
  });
  return response.data;
};
```

---

## REACT HOOK EXAMPLE

```typescript
import { useState } from 'react';
import axios from 'axios';

export function useExpertQuery() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ExpertQueryResponse | null>(null);

  const submitQuery = async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<ExpertQueryResponse>('/experts/query', {
        query,
        max_experts: 4,
      });
      setResponse(data);
      return data;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Query failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const submitInlineFeedback = async (traceId: string, rating: number) => {
    try {
      await api.post('/experts/feedback/inline', {
        trace_id: traceId,
        rating,
      });
    } catch (err: any) {
      console.error('Feedback failed:', err);
    }
  };

  return {
    loading,
    error,
    response,
    submitQuery,
    submitInlineFeedback,
  };
}

// Usage
function QAPage() {
  const { loading, error, response, submitQuery, submitInlineFeedback } = useExpertQuery();
  const [query, setQuery] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitQuery(query);
  };

  const handleThumbsUp = () => {
    if (response?.trace_id) {
      submitInlineFeedback(response.trace_id, 5);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Fai una domanda giuridica..."
        />
        <button disabled={loading}>
          {loading ? 'Caricamento...' : 'Chiedi'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {response && (
        <div>
          <h3>Risposta</h3>
          <p>{response.synthesis}</p>
          <button onClick={handleThumbsUp}>👍 Utile</button>
        </div>
      )}
    </div>
  );
}
```

---

## BEST PRACTICES

### 1. Save trace_id immediatamente

```typescript
const response = await submitQuery(query);
// SAVE trace_id for feedback!
setTraceId(response.trace_id);
```

### 2. Debounce query input

```typescript
import { useDebounce } from '@/hooks/useDebounce';

const debouncedQuery = useDebounce(query, 500);
useEffect(() => {
  if (debouncedQuery.length >= 5) {
    // Show suggestions or validate
  }
}, [debouncedQuery]);
```

### 3. Loading states

```typescript
// Show skeleton while loading
{loading ? (
  <Skeleton height={200} />
) : (
  <ExpertResponseCard response={response} />
)}
```

### 4. Error handling

```typescript
try {
  const response = await submitQuery(query);
  showToast('Risposta ricevuta!', 'success');
} catch (error: any) {
  if (error.response?.status === 401) {
    showToast('Devi effettuare il login', 'error');
    router.push('/login');
  } else {
    showToast('Errore durante la query', 'error');
  }
}
```

### 5. Feedback UI timing

```typescript
// Wait for user to read before showing feedback
useEffect(() => {
  if (response) {
    setTimeout(() => {
      setShowFeedback(true);
    }, 3000); // 3s delay
  }
}, [response]);
```

---

## RATE LIMITS

**Development**: Nessun limite
**Production**:
- `POST /experts/query`: 10 requests/minuto
- `POST /experts/feedback/*`: 30 requests/minuto

---

## SUPPORT

**Issues**: https://github.com/your-org/visualex/issues
**Docs**: https://docs.visualex.it/api/expert-system
**Contact**: dev@visualex.it

---

*API Reference v1.0 - Updated 2026-01-03*
