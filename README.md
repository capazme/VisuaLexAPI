# VisuaLex Web/API

Applicazione Quart (async Flask-like) per ricercare e visualizzare testi normativi da Normattiva/EUR‑Lex e note da Brocardi, con UI web e API.

## Requisiti
- Python 3.10+
- macOS/Linux/Windows
- Google Chrome installato (per l'esportazione PDF)
- ChromeDriver nel PATH (necessario solo per `/export_pdf`)
  - macOS (Homebrew):
    ```bash
    brew install chromedriver
    ```

## Installazione
```bash
cd VisuaLexAPI
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
```

## Avvio (UI + API non namespaced)
```bash
cd VisuaLexAPI/src
# opzionale: HOST e PORT
HOST=0.0.0.0 PORT=5000 python app.py
```
- UI: http://localhost:5000
- Gli endpoint sono esposti alla root (es. `/fetch_article_text`).

## Avvio alternativo (API namespaced `/api/*` + Swagger)
```bash
cd VisuaLexAPI/src
python -m visualex_api.app
```
- Health: `GET /api/health`
- Swagger UI: `GET /api/docs`
- OpenAPI YAML: `GET /api/openapi.json`

> Nota: le funzionalità sono equivalenti; cambia solo il prefisso degli endpoint.

---

## Endpoints (istanza di default: `src/app.py`)

### GET `/`
Rende la pagina web (`templates/index.html`).

### POST `/fetch_norma_data`
Crea una o più strutture di norma a partire dai parametri forniti.
- Body (JSON):
  - `act_type` (string, richiesto)
  - `date` (string, opz.)
  - `act_number` (string, opz.)
  - `article` (string, richiesto; singolo, lista "1,2" o range "3-5")
  - `version` (string: `vigente` | `originale`, opz.)
  - `version_date` (string YYYY-MM-DD, opz.)
  - `annex` (string, opz.)
- 200: `{ "norma_data": [NormaVisitata...] }`
- 400/500: `{ "error": string }`

Esempio:
```bash
curl -X POST http://localhost:5000/fetch_norma_data \
  -H 'Content-Type: application/json' \
  -d '{"act_type":"codice civile","article":"2043"}'
```

### POST `/fetch_article_text`
Recupera in parallelo il testo degli articoli richiesti.
- Body: come sopra
- 200: `[{ article_text, norma_data, url } | { error, norma_data }]`

```bash
curl -X POST http://localhost:5000/fetch_article_text \
  -H 'Content-Type: application/json' \
  -d '{"act_type":"legge","act_number":"241","date":"1990-08-07","article":"22","version":"vigente"}'
```

### POST `/stream_article_text`
Streaming NDJSON dei risultati man mano che sono disponibili.
- Body: come sopra
- 200: stream con una riga JSON per articolo separata da `\n`.

```bash
curl -N -X POST http://localhost:5000/stream_article_text \
  -H 'Content-Type: application/json' \
  -d '{"act_type":"codice civile","article":"2043,2051"}'
```

### POST `/fetch_brocardi_info`
Recupera le note da Brocardi (se applicabile alla fonte).
- Body: come `/fetch_norma_data`
- 200: `[{ norma_data, brocardi_info | null } | { error, norma_data }]`

### POST `/fetch_all_data`
Combina testo articolo + info Brocardi in un'unica risposta per ciascuna norma.
- Body: come `/fetch_norma_data`
- 200: `[{ article_text, url, norma_data, brocardi_info } | { error, norma_data }]`

### POST `/fetch_tree`
Restituisce l'albero degli articoli (eventualmente con link e dettagli) per una `urn` completa.
- Body:
  - `urn` (string, richiesto)
  - `link` (bool, default false)
  - `details` (bool, default false)
- 200: `{ articles: any[], count: number }`

```bash
curl -X POST http://localhost:5000/fetch_tree \
  -H 'Content-Type: application/json' \
  -d '{"urn":"https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241","link":true,"details":false}'
```

### GET `/history`
Restituisce l'ultima history in memoria del server.
- 200: `{ history: any[] }`

### POST `/export_pdf`
Esporta in PDF la risorsa identificata da `urn`, utilizzando Selenium/Chrome.
- Body: `{ "urn": string }`
- 200: `application/pdf` (attachment)
- Requisiti: Google Chrome + ChromeDriver nel PATH

```bash
curl -X POST http://localhost:5000/export_pdf \
  -H 'Content-Type: application/json' \
  -d '{"urn":"https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"}' \
  -o legge_241_1990.pdf
```

---

## Endpoint equivalenti con prefisso `/api/*` (istanza `visualex_api/app.py`)
- `POST /api/fetch_norma_data`
- `POST /api/fetch_article_text`
- `POST /api/stream_article_text`
- `POST /api/fetch_brocardi_info`
- `POST /api/fetch_all_data`
- `POST /api/fetch_tree`
- `GET  /api/history`
- `POST /api/export_pdf`
- Extra: `GET /api/health`, `GET /api/docs`, `GET /api/openapi.json`

---

## Rate limiting
Configurabile in `src/visualex_api/tools/config.py`:
- `RATE_LIMIT`, `RATE_LIMIT_WINDOW` (per IP). Di default molto permissivo in sviluppo.

## Note su scraping e compatibilità
- Lo scraping dipende da Normattiva/EUR‑Lex/Brocardi: modifiche HTML dei siti possono richiedere aggiornamenti.
- Per `EUR‑Lex` gli atti (TUE/TFUE/CDFUE, regolamenti/direttive) usano mapping dedicato.

## Struttura progetto (estratto)
```
VisuaLexAPI/
  src/
    app.py                 # app principale (UI + API root)
    templates/             # pagine HTML
    static/                # CSS/JS
    visualex_api/
      app.py               # variante API con prefisso /api
      services/            # scraper e pdf
      tools/               # utilità (urn, parsing, config)
```

## Troubleshooting
- "selenium: no such driver": installa `chromedriver` ed assicurati sia nel PATH (`chromedriver --version`).
- PDF vuoto: riprova; assicurati che l'atto sia accessibile pubblicamente e che Chrome si apra in headless.
- CORS: di default è consentito `http://localhost:3000` (vedi app).

---

## Licenza
Uso interno/didattico. Verifica i termini d'uso delle fonti (Normattiva, EUR‑Lex, Brocardi) prima di utilizzi in produzione.
