# Pipeline Monitoring API

> **Module:** `merlt.api.pipeline_router`
> **Prefix:** `/api/v1/pipeline`
> **Tags:** `["pipeline"]`

---

## Overview

L'API di Pipeline Monitoring fornisce visibilità real-time sullo stato di pipeline di ingestion/enrichment. Supporta sia endpoint REST per query on-demand che WebSocket per aggiornamenti live.

**Use Cases:**
- Monitoraggio batch ingestion di articoli (codice civile, penale, etc.)
- Tracking enrichment multi-articolo con Brocardi
- Debug errori durante processing
- Retry automatico/manuale di item falliti

**Features:**
- Real-time progress updates via WebSocket
- Filtri per status (running, completed, failed)
- Dettagli errori con stack trace
- Supporto retry (future implementation)

---

## Endpoints REST

### 1. Lista Pipeline Runs

```http
GET /api/v1/pipeline/runs
```

Recupera lista di pipeline run con filtri opzionali.

**Query Parameters:**

| Parametro | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| `status` | `PipelineStatus` | `None` | Filtra per stato (running, completed, failed, paused) |
| `pipeline_type` | `PipelineType` | `None` | Filtra per tipo (ingestion, enrichment, batch_ingestion) |
| `limit` | `int` | `50` | Numero massimo di risultati (1-200) |

**Response:**

```json
[
  {
    "run_id": "batch_cc_libro_iv",
    "type": "batch_ingestion",
    "status": "running",
    "started_at": "2026-01-04T14:30:00Z",
    "completed_at": null,
    "progress": 67.3,
    "summary": {
      "success": 150,
      "failed": 8,
      "total": 232
    },
    "config": {
      "libro": "IV",
      "tipo_atto": "codice civile"
    }
  }
]
```

**Example:**

```bash
# Tutte le run attive
curl "http://localhost:8000/api/v1/pipeline/runs?status=running"

# Ultime 10 batch ingestion
curl "http://localhost:8000/api/v1/pipeline/runs?pipeline_type=batch_ingestion&limit=10"

# Tutte le run completate
curl "http://localhost:8000/api/v1/pipeline/runs?status=completed&limit=20"
```

**Python:**

```python
import httpx

async with httpx.AsyncClient() as client:
    response = await client.get(
        "http://localhost:8000/api/v1/pipeline/runs",
        params={"status": "running", "limit": 10}
    )
    runs = response.json()

    for run in runs:
        print(f"{run['run_id']}: {run['progress']}% - {run['status']}")
```

---

### 2. Dettagli Singola Run

```http
GET /api/v1/pipeline/run/{run_id}
```

Recupera dettagli completi di una pipeline run.

**Path Parameters:**

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `run_id` | `string` | ID univoco della run |

**Response:**

```json
{
  "run_id": "batch_cc_libro_iv",
  "type": "batch_ingestion",
  "status": "running",
  "started_at": "2026-01-04T14:30:00Z",
  "completed_at": null,
  "progress": 67.3,
  "total_items": 232,
  "processed": 156,
  "errors": 8,
  "config": {
    "libro": "IV",
    "tipo_atto": "codice civile"
  }
}
```

**Errors:**

- `404 Not Found`: Run non trovata

**Example:**

```bash
curl "http://localhost:8000/api/v1/pipeline/run/batch_cc_libro_iv"
```

**Python:**

```python
async with httpx.AsyncClient() as client:
    response = await client.get(
        f"http://localhost:8000/api/v1/pipeline/run/{run_id}"
    )

    if response.status_code == 200:
        run = response.json()
        print(f"Progress: {run['progress']}%")
        print(f"Errors: {run['errors']}")
    else:
        print(f"Run not found: {run_id}")
```

---

### 3. Lista Errori da Checkpoint

```http
GET /api/v1/pipeline/run/{run_id}/errors
```

Recupera lista di errori salvati nel checkpoint file.

**Path Parameters:**

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `run_id` | `string` | ID univoco della run |

**Response:**

```json
[
  {
    "item_id": "art_1453_cc",
    "phase": "embedding",
    "error_message": "Qdrant connection timeout after 3 retries",
    "stack_trace": "Traceback (most recent call last):\n  File ...",
    "timestamp": "2026-01-04T14:35:12Z"
  }
]
```

**Note:**

- Ritorna lista vuota se nessun checkpoint trovato (run in-memory only)
- Cerca in `data/checkpoints/enrichment/`, `data/checkpoints/ingestion/`, `data/checkpoints/batch/`

**Example:**

```bash
curl "http://localhost:8000/api/v1/pipeline/run/batch_cc_libro_iv/errors"
```

**Python:**

```python
async with httpx.AsyncClient() as client:
    response = await client.get(
        f"http://localhost:8000/api/v1/pipeline/run/{run_id}/errors"
    )
    errors = response.json()

    for error in errors:
        print(f"❌ {error['item_id']} - {error['phase']}: {error['error_message']}")
```

---

### 4. Retry Item Falliti

```http
POST /api/v1/pipeline/run/{run_id}/retry
```

Riprova item falliti per una pipeline run.

**NOTA:** Feature non ancora completamente implementata. Richiede integrazione con checkpoint manager.

**Path Parameters:**

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `run_id` | `string` | ID univoco della run |

**Request Body:**

```json
{
  "item_ids": ["art_1453_cc", "art_1454_cc"]
}
```

- `item_ids`: Lista opzionale di item ID da riprovare. Se `null` o vuoto, riprova tutti i falliti.

**Response:**

```json
{
  "retried": 0,
  "message": "Retry not yet implemented for run 'batch_cc_libro_iv'. Full implementation requires checkpoint manager integration."
}
```

**Example:**

```bash
# Retry tutti gli item falliti
curl -X POST "http://localhost:8000/api/v1/pipeline/run/batch_cc_libro_iv/retry" \
  -H "Content-Type: application/json" \
  -d '{}'

# Retry item specifici
curl -X POST "http://localhost:8000/api/v1/pipeline/run/batch_cc_libro_iv/retry" \
  -H "Content-Type: application/json" \
  -d '{"item_ids": ["art_1453_cc", "art_1454_cc"]}'
```

---

## WebSocket Endpoint

### Real-Time Progress Updates

```
WS /api/v1/pipeline/ws/{run_id}
```

WebSocket endpoint per ricevere aggiornamenti real-time dello stato di una pipeline run.

**Path Parameters:**

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `run_id` | `string` | ID univoco della run da monitorare |

**Message Format (Server → Client):**

#### 1. Initial State

Inviato automaticamente al momento della connessione:

```json
{
  "event": "initial_state",
  "data": {
    "run_id": "batch_cc_libro_iv",
    "processed": 156,
    "total": 232,
    "progress": 67.3,
    "status": "running",
    "type": "batch_ingestion",
    "started_at": "2026-01-04T14:30:00Z",
    "errors": 8
  }
}
```

#### 2. Progress Update

Inviato periodicamente durante processing (via `pipeline_orchestrator.emit_progress()`):

```json
{
  "event": "progress_update",
  "data": {
    "run_id": "batch_cc_libro_iv",
    "processed": 158,
    "total": 232,
    "progress": 68.1,
    "current_item": "art. 1454 c.c.",
    "speed_per_sec": 2.3,
    "eta_seconds": 32,
    "elapsed_seconds": 70,
    "step_progress": {
      "parsing": "done",
      "embedding": "in_progress"
    }
  }
}
```

#### 3. Error Event

Inviato quando un item fallisce (via `pipeline_orchestrator.emit_error()`):

```json
{
  "event": "error",
  "data": {
    "item_id": "art_1455_cc",
    "phase": "graph_insertion",
    "error_message": "FalkorDB connection lost",
    "timestamp": "2026-01-04T14:36:00Z"
  }
}
```

**Keep-Alive Protocol:**

Il client può inviare ping per mantenere la connessione attiva:

```
Client → Server: "ping"
Server → Client: "pong"
```

---

### Example Usage (Python)

```python
import asyncio
import json
import websockets

async def monitor_pipeline(run_id: str):
    """Monitor pipeline progress via WebSocket."""
    uri = f"ws://localhost:8000/api/v1/pipeline/ws/{run_id}"

    async with websockets.connect(uri) as websocket:
        print(f"Connected to pipeline {run_id}")

        # Ricevi stato iniziale
        initial = await websocket.recv()
        data = json.loads(initial)

        if data["event"] == "initial_state":
            print(f"Initial progress: {data['data']['progress']}%")

        # Keep-alive task
        async def send_ping():
            while True:
                await asyncio.sleep(30)
                await websocket.send("ping")

        ping_task = asyncio.create_task(send_ping())

        try:
            # Loop aggiornamenti
            while True:
                message = await websocket.recv()

                if message == "pong":
                    continue

                data = json.loads(message)
                event = data.get("event")

                if event == "progress_update":
                    progress_data = data["data"]
                    print(f"Progress: {progress_data['progress']:.1f}% "
                          f"({progress_data['processed']}/{progress_data['total']}) "
                          f"- {progress_data.get('current_item', '')} "
                          f"- ETA: {progress_data['eta_seconds']}s")

                elif event == "error":
                    error_data = data["data"]
                    print(f"❌ Error: {error_data['item_id']} - "
                          f"{error_data['error_message']}")

        finally:
            ping_task.cancel()

# Run
asyncio.run(monitor_pipeline("batch_cc_libro_iv"))
```

### Example Usage (JavaScript)

```javascript
/**
 * Monitor pipeline progress via WebSocket.
 */
function monitorPipeline(runId) {
  const ws = new WebSocket(`ws://localhost:8000/api/v1/pipeline/ws/${runId}`);

  ws.onopen = () => {
    console.log(`Connected to pipeline ${runId}`);

    // Keep-alive ping every 30 seconds
    setInterval(() => ws.send('ping'), 30000);
  };

  ws.onmessage = (event) => {
    if (event.data === 'pong') return;

    const message = JSON.parse(event.data);

    switch (message.event) {
      case 'initial_state':
        console.log(`Initial progress: ${message.data.progress}%`);
        updateProgressBar(message.data.progress);
        break;

      case 'progress_update':
        const { progress, processed, total, current_item, eta_seconds } = message.data;
        console.log(`Progress: ${progress.toFixed(1)}% (${processed}/${total}) - ${current_item} - ETA: ${eta_seconds}s`);
        updateProgressBar(progress);
        updateCurrentItem(current_item);
        updateETA(eta_seconds);
        break;

      case 'error':
        const { item_id, error_message, phase } = message.data;
        console.error(`❌ Error in ${phase}: ${item_id} - ${error_message}`);
        addErrorToList(message.data);
        break;
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
  };

  return ws;
}

// Usage
const ws = monitorPipeline('batch_cc_libro_iv');

// Cleanup on page unload
window.addEventListener('beforeunload', () => ws.close());
```

---

## Integration with VisuaLex Frontend

### Pipeline Dashboard Component

```typescript
// frontend/src/components/features/pipeline/PipelineMonitor.tsx

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface PipelineRun {
  run_id: string;
  type: string;
  status: string;
  progress: number;
  processed: number;
  total_items: number;
  current_item?: string;
  eta_seconds?: number;
  errors: number;
}

export function PipelineMonitor({ runId }: { runId: string }) {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [errors, setErrors] = useState<any[]>([]);

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/api/v1/pipeline/ws/${runId}`);

    ws.onmessage = (event) => {
      if (event.data === 'pong') return;

      const message = JSON.parse(event.data);

      if (message.event === 'initial_state' || message.event === 'progress_update') {
        setRun(message.data);
      }

      if (message.event === 'error') {
        setErrors(prev => [...prev, message.data]);
      }
    };

    // Keep-alive
    const interval = setInterval(() => ws.send('ping'), 30000);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [runId]);

  if (!run) return <div>Loading...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline: {run.run_id}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm">Progress</span>
              <span className="text-sm font-medium">
                {run.processed} / {run.total_items} ({run.progress.toFixed(1)}%)
              </span>
            </div>
            <Progress value={run.progress} />
          </div>

          {run.current_item && (
            <div className="text-sm text-muted-foreground">
              Current: {run.current_item}
            </div>
          )}

          {run.eta_seconds !== undefined && (
            <div className="text-sm">
              ETA: {Math.floor(run.eta_seconds / 60)}m {run.eta_seconds % 60}s
            </div>
          )}

          {errors.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-destructive mb-2">
                Errors ({errors.length})
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {errors.map((err, i) => (
                  <div key={i} className="text-xs bg-destructive/10 p-2 rounded">
                    <span className="font-medium">{err.item_id}</span>: {err.error_message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Data Models

### PipelineRun

```python
class PipelineRun(BaseModel):
    run_id: str
    type: PipelineType  # "ingestion" | "enrichment" | "batch_ingestion"
    status: PipelineStatus  # "running" | "completed" | "failed" | "paused"
    started_at: datetime
    completed_at: Optional[datetime] = None
    progress: float  # 0-100
    summary: Dict[str, int]  # {"success": 98, "failed": 2}
    config: Dict[str, Any]  # {"libro": "IV", "tipo_atto": "codice civile"}
```

### PipelineError

```python
class PipelineError(BaseModel):
    item_id: str
    phase: str  # "parsing" | "embedding" | "graph_insertion"
    error_message: str
    stack_trace: Optional[str] = None
    timestamp: datetime
```

### RetryRequest

```python
class RetryRequest(BaseModel):
    item_ids: Optional[List[str]] = None  # None = retry all
```

### RetryResponse

```python
class RetryResponse(BaseModel):
    retried: int
    message: str
```

---

## Future Enhancements

### 1. Full Retry Implementation

```python
# merlt/pipeline/checkpoint_manager.py
class CheckpointManager:
    async def load_checkpoint(self, run_id: str) -> Dict:
        """Carica checkpoint file."""
        ...

    async def retry_failed_items(
        self,
        run_id: str,
        item_ids: Optional[List[str]] = None
    ) -> int:
        """Riprova item falliti."""
        ...
```

### 2. Pause/Resume Support

```http
POST /api/v1/pipeline/run/{run_id}/pause
POST /api/v1/pipeline/run/{run_id}/resume
```

### 3. Cancel Support

```http
POST /api/v1/pipeline/run/{run_id}/cancel
```

### 4. Download Checkpoint/Logs

```http
GET /api/v1/pipeline/run/{run_id}/checkpoint
GET /api/v1/pipeline/run/{run_id}/logs
```

### 5. Statistics & Analytics

```http
GET /api/v1/pipeline/stats
# Response: aggregated stats (success rate, avg duration, etc.)
```

---

## Testing

### Manual Test

```bash
# Terminal 1: Start FastAPI server
uvicorn merlt.app:app --reload --port 8000

# Terminal 2: Start a batch ingestion
python scripts/batch_ingest_libro_iv.py

# Terminal 3: Monitor via REST
curl "http://localhost:8000/api/v1/pipeline/runs?status=running"

# Terminal 4: Monitor via WebSocket
python -c "
import asyncio
import websockets
import json

async def monitor():
    uri = 'ws://localhost:8000/api/v1/pipeline/ws/batch_cc_libro_iv'
    async with websockets.connect(uri) as ws:
        while True:
            msg = await ws.recv()
            if msg != 'pong':
                print(json.loads(msg))

asyncio.run(monitor())
"
```

---

**File:** `merlt/api/pipeline_router.py`
**Registered in:** `merlt/app.py` (prefix `/api/v1/pipeline`)
**Models:** `merlt/api/models/pipeline_models.py`
**Dependencies:** `merlt/pipeline/orchestrator.py`, `merlt/pipeline/websocket_manager.py`
