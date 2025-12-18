# VisuaLex User Guide

Welcome to VisuaLex, your intelligent legal research assistant. This guide will help you navigate the workspace, search for regulations, and use the study tools effectively.

## Getting Started

VisuaLex is a web-based application. Once the server is running, access the interface through your web browser (typically at `http://localhost:5000` or the configured deployment URL).

## Core Features

### 1. Search & Navigation
The heart of VisuaLex is its ability to retrieve legal texts instantly.
- **Search Panel**: Use the floating search bar or the main "Search" tab.
- **Input Parameters**:
    - **Type**: Select the source (e.g., "Code", "Law", "Constitution", "Aulmann").
    - **Reference**: specific act name (e.g., "Civil Code") or number/year for laws (e.g., Law 241/1990).
    - **Article**: Enter a single number (e.g., "2043"), a range ("1-10"), or a list ("1,5,10").
- **Results**: Clicking "Search" fetches the text directly from official sources like Normattiva.

### 2. The Workspace
The Workspace is designed for multitasking and deep analysis.
- **Multi-Tab Design**: You can open multiple searches or documents in separate tabs within the application.
- **Panels**:
    - **Left - Structure Tree**: Shows the hierarchy of the current law (Books, Titles, Chapters). Click any node to jump to it.
    - **Center - Document View**: The main reading area. Displays the full text of articles.
    - **Right - Tools/Brocardi**: Contextual information, legal notes (Brocardi), and analysis tools.

### 3. Study Mode
For a distraction-free reading experience, toggle **Study Mode** (usually found in the header or view options).
- **Clean Interface**: Hides unnecessary sidebars and maximizes the text area.
- **Typography**: Optimized fonts and spacing for long reading sessions.
- **Annotations**: Highlight text and add personal notes (if supported by your version).

### 4. Brocardi Integration
VisuaLex automatically tries to fetch explanatory notes and legal maxims (Brocardi) for supported codes (e.g., Civil Code, Penal Code).
- Check the **"Brocardi" tab** in the right sidebar when viewing an article to see related jurisprudence or explanations.

### 5. Exporting
You can export your research for offline use.
- **PDF Export**: Converts the current view or selection into a formatted PDF document, preserving the legal structure.
- **Usage**: Look for the "Export" or "Print" icon in the toolbar.

## Keyboard Shortcuts
- `Esc`: Close the current modal or search panel.
- `Cmd/Ctrl + K`: Quick focus on the search bar (if enabled).

---
*Note: VisuaLex relies on real-time data from external institutional sites. Availability depends on the status of services like Normattiva.it.*
