# VisuaLex Architecture

VisuaLex is a full-stack web application designed for advanced legal research and visualization. This document outlines the high-level architecture, technical stack, and data flow of the system.

## System Overview

The application follows a modern **client-server architecture**:
- **Frontend**: A Single Page Application (SPA) built with React and Vite, serving as the user interface for searching, visualizing, and studying legal texts.
- **Backend**: An asynchronous Python API built with Quart (an async wrapper for Flask), handling data retrieval, scraping from external legal databases (Normattiva, EUR-Lex, Brocardi), and PDF generation.

```mermaid
graph TD
    Client[User Browser] <-->|HTTP/JSON| API[Backend API (Quart)]
    API <-->|Scraping| Normattiva[Normattiva.it]
    API <-->|Scraping| EurLex[EUR-Lex]
    API <-->|Scraping| Brocardi[Brocardi.it]
    API -->|Generation| PDF[PDF Service]
```

## Technical Stack

### Frontend (`/frontend`)
- **Core**: React 19, TypeScript, Vite.
- **Styling**: TailwindCSS v4, Framer Motion (animations).
- **State Management**: Zustand, Immer.
- **Routing**: React Router DOM v7.
- **Utilities**: Axios (HTTP), Zod (Validation), DOMPurify (Security), jsPDF.
- **UI Libraries**: Lucide React (Icons), React RND (Draggable/Resizable windows), Floating UI.

### Backend (`/visualex_api` & root)
- **Framework**: Quart (Async Python Web Microframework).
- **concurrency**: `asyncio`, `aiohttp`.
- **Scraping**: BeautifulSoup4, Playwright.
- **Logging**: Structlog.
- **Caching**: aiocache.
- **CORS**: quart_cors.

## Project Structure

### Backend
The backend logic is centralized in the `visualex_api` package.
- `app.py`: Main entry point. Defines API routes and CORS configuration.
- `visualex_api/services/`: Core business logic and external integrations.
    - `normattiva_scraper.py`: Handles retrieval and parsing of Italian laws.
    - `eurlex_scraper.py`: Handles European regulations and directives.
    - `brocardi_scraper.py`: Fetches legal notes and explanations.
    - `pdfextractor.py`: Utility for extracting text from PDFs.
- `visualex_api/tools/`: Helper utilities for URL parsing, configuration, and data formatting.

### Frontend
The frontend follows a feature-based folder structure inside `src/`.
- `services/`: API clients (e.g., `api.ts`) and data services (e.g., `bookmarkService.ts`, `dossierService.ts`).
- `components/features/`: Complex, domain-specific components.
    - `workspace/`: The main legal workspace environment.
    - `StudyMode/`: Dedicated mode for reading and simplified visualization.
- `components/ui/`: Reusable, atomic UI components (Buttons, Inputs, Modals).
- `components/layout/`: Structural layouts (Sidebars, wrappers).

## Data Flow

1.  **Search Request**: User enters a query (e.g., "Civil Code Art. 2043") in the Frontend Search Bar.
2.  **API Call**: Frontend `api.ts` sends a POST request to `/fetch_article_text` or `/fetch_norma_data`.
3.  **Route Handling**: `app.py` receives the request and delegates it to the appropriate scraper in `services/`.
4.  **External Retrieval**:
    - The scraper constructs a URL for the external source (e.g., Normattiva).
    - It fetches the HTML content (caching responses where possible).
5.  **Parsing**: BeautifulSoup parses the HTML to extract the meaningful legal text, removing ads and extraneous navigation.
6.  **Response**: The API returns a structured JSON object containing the article text, structure (headings), and metadata.
7.  **Rendering**: The Frontend updates the Zustand store and renders the `ArticleView` or `StructureTree` components.
