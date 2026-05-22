# MERL-T API - Practical Examples

**Version**: 0.2.0
**Last Updated**: November 14, 2025

---

## Overview

This guide provides **real-world examples** for using the MERL-T API. All examples use actual Italian legal scenarios and demonstrate best practices for integration.

---

## Table of Contents

1. [Query Execution Examples](#query-execution-examples)
2. [Feedback Submission Examples](#feedback-submission-examples)
3. [Statistics & Analytics Examples](#statistics--analytics-examples)
4. [Error Handling Examples](#error-handling-examples)
5. [Complete Integration Examples](#complete-integration-examples)

---

## Query Execution Examples

### Example 1: Simple Contract Question

**Scenario**: A citizen wants to know if a contract signed by a 16-year-old is valid.

**Request**:
```bash
curl -X POST "http://localhost:8000/query/execute" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "È valido un contratto firmato da un sedicenne?",
    "context": {
      "temporal_reference": "latest",
      "jurisdiction": "nazionale",
      "user_role": "cittadino"
    },
    "options": {
      "max_iterations": 3,
      "return_trace": true
    }
  }'
```

**Response**:
```json
{
  "trace_id": "QRY-20251114-abc123",
  "query": "È valido un contratto firmato da un sedicenne?",
  "answer": {
    "primary_answer": "No, un contratto firmato da un sedicenne (minore di età) è annullabile ai sensi dell'art. 1425 del Codice Civile. Il contratto può essere impugnato dal minore o dal suo rappresentante legale entro 5 anni dalla maggiore età (art. 1442 c.c.).",
    "confidence": 0.92,
    "legal_basis": [
      {
        "norm_id": "cc_1425",
        "norm_title": "Codice Civile - Art. 1425",
        "article": "1425",
        "relevance": 0.95,
        "excerpt": "Il contratto è annullabile se una delle parti era legalmente incapace di contrattare."
      },
      {
        "norm_id": "cc_1442",
        "norm_title": "Codice Civile - Art. 1442",
        "article": "1442",
        "relevance": 0.88,
        "excerpt": "L'azione di annullamento si prescrive in cinque anni."
      }
    ],
    "alternatives": [
      {
        "position": "Il contratto potrebbe essere considerato valido se il minore ha occultato la sua età con raggiri.",
        "support_score": 0.15,
        "expert_count": 1
      }
    ],
    "uncertainty_preserved": true,
    "consensus_level": 0.85
  },
  "execution_trace": {
    "preprocessing": {"duration_ms": 245, "status": "completed"},
    "routing": {"duration_ms": 180, "status": "completed"},
    "retrieval": {"duration_ms": 420, "status": "completed"},
    "reasoning": {"duration_ms": 1850, "status": "completed"},
    "synthesis": {"duration_ms": 320, "status": "completed"},
    "total_duration_ms": 3015
  },
  "metadata": {
    "experts_consulted": ["literal_interpreter", "systemic_teleological", "principles_balancer"],
    "sources_count": 12,
    "iteration": 1
  },
  "timestamp": "2025-11-14T12:30:45Z"
}
```

### Example 2: Citizenship Requirements

**Scenario**: Someone wants to know the requirements for Italian citizenship by marriage.

**Python Code**:
```python
import requests

API_KEY = "your-api-key-here"
BASE_URL = "http://localhost:8000"

def get_citizenship_requirements():
    """Query citizenship requirements."""
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }

    payload = {
        "query": "Quali sono i requisiti per ottenere la cittadinanza italiana per matrimonio?",
        "session_id": "session_abc123",
        "context": {
            "temporal_reference": "latest",
            "jurisdiction": "nazionale",
            "user_role": "cittadino"
        },
        "options": {
            "max_iterations": 2,
            "return_trace": False
        }
    }

    response = requests.post(
        f"{BASE_URL}/query/execute",
        headers=headers,
        json=payload
    )

    if response.status_code == 200:
        result = response.json()
        print(f"Trace ID: {result['trace_id']}")
        print(f"\nAnswer:\n{result['answer']['primary_answer']}")
        print(f"\nConfidence: {result['answer']['confidence']:.2%}")

        # Print legal basis
        print("\nLegal Basis:")
        for basis in result['answer']['legal_basis']:
            print(f"  - {basis['norm_title']}, Art. {basis['article']}")
            print(f"    Relevance: {basis['relevance']:.2%}")

    else:
        print(f"Error: {response.status_code}")
        print(response.json())

if __name__ == "__main__":
    get_citizenship_requirements()
```

### Example 3: GDPR Compliance Check

**Scenario**: A lawyer needs to verify GDPR compliance for a website.

**JavaScript Code**:
```javascript
async function checkGDPRCompliance() {
  const API_KEY = "your-api-key-here";
  const BASE_URL = "http://localhost:8000";

  const query = {
    query: "Il mio sito web rispetta i requisiti del GDPR per il trattamento dei dati personali?",
    session_id: "compliance_check_001",
    context: {
      temporal_reference: "latest",
      jurisdiction: "comunitario",
      user_role: "avvocato"
    },
    options: {
      max_iterations: 3,
      return_trace: true
    }
  };

  const response = await fetch(`${BASE_URL}/query/execute`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(query)
  });

  if (response.ok) {
    const result = await response.json();
    console.log(`Trace ID: ${result.trace_id}`);
    console.log(`\nAnswer:\n${result.answer.primary_answer}`);
    console.log(`\nConfidence: ${(result.answer.confidence * 100).toFixed(0)}%`);

    // Check for uncertainties
    if (result.answer.uncertainty_preserved && result.answer.alternatives.length > 0) {
      console.log("\n⚠️  Alternative interpretations exist:");
      result.answer.alternatives.forEach((alt, i) => {
        console.log(`  ${i + 1}. ${alt.position} (support: ${(alt.support_score * 100).toFixed(0)}%)`);
      });
    }

    // Execution time
    const duration_s = result.execution_trace.total_duration_ms / 1000;
    console.log(`\n⏱️  Execution time: ${duration_s.toFixed(2)}s`);

  } else {
    console.error(`Error: ${response.status} - ${await response.text()}`);
  }
}

checkGDPRCompliance();
```

### Example 4: Multi-turn Conversation

**Scenario**: Follow-up question in an ongoing conversation.

**Request**:
```bash
curl -X POST "http://localhost:8000/query/execute" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "E se invece il contratto fosse stato firmato da un diciassettenne?",
    "session_id": "conv_xyz789",
    "context": {
      "temporal_reference": "latest",
      "jurisdiction": "nazionale",
      "user_role": "studente",
      "previous_queries": [
        "È valido un contratto firmato da un sedicenne?"
      ]
    },
    "options": {
      "max_iterations": 2,
      "return_trace": false
    }
  }'
```

---

## Feedback Submission Examples

### Example 5: User Feedback (Positive)

**Scenario**: User found the answer helpful and accurate.

**Request**:
```bash
curl -X POST "http://localhost:8000/feedback/user" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "QRY-20251114-abc123",
    "rating": 5,
    "helpful": true,
    "issues": [],
    "comment": "Risposta molto chiara e completa. I riferimenti normativi sono precisi.",
    "user_id": "user_12345"
  }'
```

**Response**:
```json
{
  "feedback_id": "FB-USER-20251114-def456",
  "status": "accepted",
  "trace_id": "QRY-20251114-abc123",
  "message": "User feedback accepted. Rating: 5/5"
}
```

### Example 6: User Feedback (Negative with Correction)

**Scenario**: User found errors and provides corrections.

**Python Code**:
```python
def submit_negative_feedback(trace_id):
    """Submit negative feedback with correction."""
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }

    feedback = {
        "trace_id": trace_id,
        "rating": 2,
        "helpful": False,
        "issues": ["incorrect", "incomplete"],
        "comment": "La risposta non considera la normativa più recente del 2024.",
        "correction": "Il D.L. 44/2024 ha modificato completamente il regime degli obblighi.",
        "user_id": "user_67890"
    }

    response = requests.post(
        f"{BASE_URL}/feedback/user",
        headers=headers,
        json=feedback
    )

    if response.status_code == 201:
        result = response.json()
        print(f"✅ Feedback submitted: {result['feedback_id']}")
    else:
        print(f"❌ Error: {response.status_code}")

submit_negative_feedback("QRY-20251114-abc123")
```

### Example 7: RLCF Expert Feedback

**Scenario**: Legal expert provides detailed corrections.

**Request**:
```bash
curl -X POST "http://localhost:8000/feedback/rlcf" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type": application/json" \
  -d '{
    "trace_id": "QRY-20251114-abc123",
    "expert_id": "expert_avv_rossi_001",
    "authority_score": 0.85,
    "corrections": {
      "answer_quality": "needs_revision",
      "legal_reasoning": "partially_correct",
      "legal_basis": "incomplete"
    },
    "suggested_changes": {
      "primary_answer": "La normativa sul Green Pass per l'accesso al posto di lavoro è stata abrogata dal D.L. 44/2023. Attualmente non sussistono obblighi generali, salvo per il personale sanitario (D.L. 73/2022).",
      "additional_legal_basis": [
        {
          "norm_id": "dl_44_2023",
          "norm_title": "D.L. 44/2023 - Cessazione obblighi Green Pass",
          "article": "1",
          "relevance": 0.95,
          "excerpt": "Sono abrogati gli obblighi di certificazione verde COVID-19..."
        }
      ]
    },
    "detailed_comment": "La risposta non considera l'abrogazione completa degli obblighi avvenuta nel 2023. Solo il personale sanitario ha ancora obblighi residuali.",
    "vote_confidence": 0.92
  }'
```

**Response**:
```json
{
  "feedback_id": "FB-RLCF-20251114-ghi789",
  "status": "accepted",
  "trace_id": "QRY-20251114-abc123",
  "authority_weight": 0.85,
  "training_examples_generated": 3,
  "scheduled_for_retraining": true,
  "next_retrain_date": "2025-11-21"
}
```

### Example 8: NER Correction

**Scenario**: Expert corrects entity recognition error.

**Request**:
```bash
curl -X POST "http://localhost:8000/feedback/ner" \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "QRY-20251114-abc123",
    "query_text": "Il D.L. 52/2021 introduce l'obbligo di Green Pass",
    "entity_text": "D.L. 52/2021",
    "entity_type": "NORMA",
    "start_char": 3,
    "end_char": 15,
    "correction_type": "MISSING_ENTITY",
    "expert_id": "expert_ner_001",
    "comment": "Il decreto legge 52/2021 non è stato riconosciuto come entità NORMA."
  }'
```

---

## Statistics & Analytics Examples

### Example 9: Pipeline Statistics

**Scenario**: Monitor system performance over the last 7 days.

**Request**:
```bash
curl -X GET "http://localhost:8000/stats/pipeline?period=last_7_days" \
  -H "X-API-Key: your-api-key-here"
```

**Response**:
```json
{
  "period": "last_7_days",
  "queries_total": 1543,
  "avg_response_time_ms": 2456.7,
  "p95_response_time_ms": 4200.0,
  "p99_response_time_ms": 5800.0,
  "success_rate": 0.987,
  "stages_performance": {
    "query_understanding": {
      "avg_ms": 245.3,
      "p95_ms": 320.0,
      "count": 1543
    },
    "kg_enrichment": {
      "avg_ms": 50.2,
      "p95_ms": 80.0,
      "count": 1543
    },
    "router": {
      "avg_ms": 1800.5,
      "p95_ms": 2500.0,
      "count": 1543
    },
    "retrieval": {
      "avg_ms": 280.4,
      "p95_ms": 450.0,
      "count": 1543
    },
    "experts": {
      "avg_ms": 2100.6,
      "p95_ms": 3500.0,
      "count": 1543
    },
    "synthesis": {
      "avg_ms": 800.2,
      "p95_ms": 1200.0,
      "count": 1543
    }
  },
  "avg_iterations": 1.2,
  "expert_usage": {
    "literal_interpreter": 0.92,
    "systemic_teleological": 0.68,
    "principles_balancer": 0.15,
    "precedent_analyst": 0.45
  },
  "agent_usage": {
    "kg_agent": 0.85,
    "api_agent": 0.72,
    "vectordb_agent": 0.68
  }
}
```

### Example 10: Feedback Statistics

**Python Code**:
```python
def get_feedback_stats(period="last_30_days"):
    """Retrieve feedback statistics."""
    headers = {"X-API-Key": API_KEY}

    response = requests.get(
        f"{BASE_URL}/stats/feedback?period={period}",
        headers=headers
    )

    if response.status_code == 200:
        stats = response.json()

        print(f"Feedback Statistics ({stats['period']})")
        print("=" * 60)
        print(f"User Feedback: {stats['user_feedback_count']}")
        print(f"Average Rating: {stats['avg_user_rating']:.1f}/5.0")
        print(f"RLCF Expert Feedback: {stats['rlcf_expert_feedback_count']}")
        print(f"NER Corrections: {stats['ner_corrections_count']}")

        # Model improvements
        print("\nModel Improvements:")
        for metric, values in stats['model_improvements'].items():
            print(f"  {metric}:")
            print(f"    Before: {values['before']:.2%}")
            print(f"    After: {values['after']:.2%}")
            print(f"    Improvement: +{values['improvement']:.2%}")

        # Retraining events
        print("\nRecent Retraining:")
        for event in stats['retraining_events']:
            print(f"  {event['model']}: {event['version']} ({event['date']})")

        # Rating distribution
        print("\nRating Distribution:")
        for rating, count in stats['feedback_distribution'].items():
            bar = "█" * int(count / 5)
            print(f"  {rating}⭐: {bar} {count}")

    else:
        print(f"Error: {response.status_code}")

get_feedback_stats()
```

---

## Error Handling Examples

### Example 11: Handle 400 Validation Error

**Python Code**:
```python
def execute_query_with_validation(query):
    """Execute query with validation error handling."""
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }

    response = requests.post(
        f"{BASE_URL}/query/execute",
        headers=headers,
        json={"query": query}
    )

    if response.status_code == 200:
        return response.json()

    elif response.status_code == 400:
        error = response.json()
        print("❌ Validation Error:")
        for detail in error.get('detail', []):
            field = " → ".join(str(x) for x in detail['loc'])
            print(f"  Field: {field}")
            print(f"  Error: {detail['msg']}")
        return None

    elif response.status_code == 408:
        print("❌ Query Timeout - Query took too long")
        return None

    elif response.status_code == 500:
        error = response.json()
        print(f"❌ Server Error: {error.get('detail', 'Unknown error')}")
        return None

    else:
        print(f"❌ Unexpected error: {response.status_code}")
        return None

# Test with invalid query (too short)
result = execute_query_with_validation("Breve")  # Will fail validation
```

### Example 12: Handle 429 Rate Limit

**JavaScript Code**:
```javascript
async function executeWithRateLimitHandling(query, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${BASE_URL}/query/execute`, {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    // Success
    if (response.ok) {
      return response.json();
    }

    // Rate limit exceeded
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "60");
      console.warn(`⚠️  Rate limit exceeded. Retrying in ${retryAfter}s...`);

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      } else {
        throw new Error("Max retries exceeded");
      }
    }

    // Other errors
    const error = await response.json();
    throw new Error(`HTTP ${response.status}: ${error.detail}`);
  }
}

// Usage
try {
  const result = await executeWithRateLimitHandling(
    "È valido un contratto firmato da un sedicenne?"
  );
  console.log("Answer:", result.answer.primary_answer);
} catch (error) {
  console.error("Failed:", error.message);
}
```

---

## Complete Integration Examples

### Example 13: Full Workflow (Python)

**Scenario**: Complete workflow from query to feedback submission.

```python
import requests
import time

class MERLTClient:
    """Complete MERL-T API client."""

    def __init__(self, api_key, base_url="http://localhost:8000"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        })

    def execute_query(self, query_text, context=None, options=None):
        """Execute a legal query."""
        payload = {"query": query_text}

        if context:
            payload["context"] = context
        if options:
            payload["options"] = options

        response = self.session.post(
            f"{self.base_url}/query/execute",
            json=payload
        )

        if response.status_code == 200:
            return response.json()
        elif response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", 60))
            raise RateLimitError(f"Rate limit exceeded. Retry after {retry_after}s")
        else:
            response.raise_for_status()

    def submit_user_feedback(self, trace_id, rating, helpful, comment=None):
        """Submit user feedback."""
        feedback = {
            "trace_id": trace_id,
            "rating": rating,
            "helpful": helpful,
            "issues": [],
            "comment": comment or ""
        }

        response = self.session.post(
            f"{self.base_url}/feedback/user",
            json=feedback
        )

        return response.json() if response.status_code == 201 else None

    def get_query_status(self, trace_id):
        """Get query execution status."""
        response = self.session.get(
            f"{self.base_url}/query/status/{trace_id}"
        )

        return response.json() if response.status_code == 200 else None

class RateLimitError(Exception):
    pass

# Usage
if __name__ == "__main__":
    client = MERLTClient(api_key="your-api-key-here")

    # 1. Execute query
    print("Executing query...")
    result = client.execute_query(
        "È valido un contratto firmato da un sedicenne?",
        context={
            "jurisdiction": "nazionale",
            "temporal_reference": "latest",
            "user_role": "cittadino"
        }
    )

    trace_id = result['trace_id']
    answer = result['answer']['primary_answer']
    confidence = result['answer']['confidence']

    print(f"\n✅ Query executed (trace_id: {trace_id})")
    print(f"Confidence: {confidence:.2%}")
    print(f"\nAnswer:\n{answer}")

    # 2. Submit feedback
    print("\nSubmitting feedback...")
    feedback = client.submit_user_feedback(
        trace_id=trace_id,
        rating=5,
        helpful=True,
        comment="Risposta molto chiara e precisa!"
    )

    print(f"✅ Feedback submitted: {feedback['feedback_id']}")

    # 3. Check statistics
    print("\nRetrieving statistics...")
    response = client.session.get(f"{client.base_url}/stats/pipeline")
    stats = response.json()

    print(f"Total queries: {stats['queries_total']}")
    print(f"Avg response time: {stats['avg_response_time_ms']:.0f}ms")
    print(f"Success rate: {stats['success_rate']:.2%}")
```

---

## Support

For more examples and support:

- **API Documentation**: http://localhost:8000/docs
- **GitHub**: https://github.com/ALIS-ai/MERL-T
- **Email**: support@alis.ai

---

**Last Updated**: November 14, 2025
**Version**: 0.2.0
