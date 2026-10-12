# VisuaLex Frontend - Documentazione Tecnica per UX Designer

> Documento tecnico che descrive tutti i componenti frontend, le loro funzionalità, stati e interazioni disponibili.

---

## Indice

1. [Architettura Generale](#1-architettura-generale)
2. [Componenti di Ricerca](#2-componenti-di-ricerca)
3. [Componenti Workspace (la pratica)](#3-componenti-workspace)
4. [Study Mode](#4-study-mode)
5. [Componenti UI Condivisi](#5-componenti-ui-condivisi)
6. [Struttura Dati](#6-struttura-dati)
7. [Sistema di Temi](#7-sistema-di-temi)
8. [Flussi Utente Principali](#8-flussi-utente-principali)

---

## 1. Architettura Generale

### Stack Tecnologico
- **React 18** con TypeScript
- **Tailwind CSS v4** per styling
- **Framer Motion** per animazioni
- **Zustand** per state management
- **dnd-kit** per drag & drop

### Layout Principale (`Layout.tsx`)
```
┌────────────────────────────────────────────────────────┐
│  Sidebar (collapsible)  │     Main Content Area        │
│  ┌──────────────────┐   │  ┌────────────────────────┐  │
│  │ Logo             │   │  │ Pratica attiva         │  │
│  │ ──────────────── │   │  │ ┌────────────────────┐ │  │
│  │ 🔍 Ricerca       │   │  │ │ Atto               │ │  │
│  │ 📁 Dossier       │   │  │ │  art. 1 · art. 2   │ │  │
│  │ 🎓 Studia        │   │  │ │ Giurisprudenza     │ │  │
│  │ 📜 Cronologia    │   │  │ └────────────────────┘ │  │
│  │ ──────────────── │   │  │ [finestre accanto]     │  │
│  │ ⚙️ Menu utente   │   │  │ [barra delle pratiche] │  │
│  └──────────────────┘   │  └────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

**Shortcut Tastiera Globali:**
- `Cmd/Ctrl + K` → Apre Command Palette
- `Cmd/Ctrl + B` → Toggle Sidebar
- `Cmd/Ctrl + D` → Apre Dossier

---

## 2. Componenti di Ricerca

### 2.1 SearchForm
**File:** `components/features/search/SearchForm.tsx`
**Scopo:** Form principale per cercare norme e articoli

**Campi Input:**
| Campo | Tipo | Obbligatorio | Note |
|-------|------|--------------|------|
| Tipo Atto | Select | ✅ | Codice Civile, Legge, D.Lgs, etc. |
| Numero Atto | Text | ❌ | Per leggi/decreti |
| Data | Date | ❌ | Formato GG/MM/AAAA |
| Articolo | Text | ✅ | Singolo, lista (1,2,3) o range (1-5) |
| Versione | Select | ✅ | "Vigente" o "Originale" |
| Data Versione | Date | ❌ | Per versioni storiche |

**Interazioni:**
- Bottoni +/- per navigare tra articoli (con lista pre-caricata)
- Invio automatico dopo selezione da lista
- Loading state durante fetch struttura atto

**Stati Visuali:**
- `idle` - Form vuoto/compilato
- `loading` - Caricamento struttura articoli
- `error` - Errore validazione

---

### 2.2 CommandPalette
**File:** `components/features/search/CommandPalette.tsx`
**Scopo:** Ricerca intelligente con parsing naturale citazioni legali

**Esempio Input:** `"art 2043 cc"` → Parsed automaticamente

**Flusso Step-by-Step:**
```
Step 1: Selezione Tipo Atto
  └─ Grid di bottoni con tipi atto raggruppati

Step 2: Input Dettagli (se necessario)
  └─ Numero atto, Data

Step 3: Input Articolo
  └─ Con toggle "Includi Brocardi"
```

**Features:**
- Smart parsing citazioni ("art 2043 codice civile")
- Accesso rapido a QuickNorms salvate
- Toggle Brocardi integrato
- Chiusura con `Escape`

---

### 2.3 NormaCard
**File:** `components/features/search/NormaCard.tsx`
**Scopo:** Card principale che visualizza una norma con i suoi articoli

**Layout Desktop:**
```
┌─────────────────────────────────────────────────┐
│ [▼] Codice Civile                    [📄] [🌳] │  ← Header (collapsible)
├─────────────────────────────────────────────────┤
│ [Art.1] [Art.2] [Art.3+]           [+Articolo] │  ← Tab articoli
├─────────────────────────────────────────────────┤
│                                                 │
│        Contenuto ArticleTabContent              │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Layout Mobile:**
```
┌─────────────────────────────────────┐
│ [▼] Codice Civile              [⋮] │
├─────────────────────────────────────┤
│ ▸ Art. 1 - Delle persone...        │  ← Lista collapsible
│ ▾ Art. 2 - Capacità giuridica      │
│   └─ Contenuto articolo espanso    │
│ ▸ Art. 3 - ...                     │
└─────────────────────────────────────┘
```

**Interazioni:**
- Click header → collapse/expand card
- Click tab → cambia articolo attivo
- Click "+" → aggiunta rapida articolo
- Click 📄 → export PDF
- Click 🌳 → apre TreeViewPanel

---

### 2.4 ArticleTabContent
**File:** `components/features/search/ArticleTabContent.tsx`
**Scopo:** Visualizzazione completa di un singolo articolo con tutte le funzionalità

**Layout:**
```
┌────────────────────────────────────────────────────────┐
│ ══════════════════ TOOLBAR ══════════════════════════ │
│ [📋 Copia] [📝 Note] [🎨 Evidenzia] [📁 Dossier]      │
│ [🔗 Condividi] [📤 Esporta] [📅 Versione]             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Art. 2043 - Risarcimento per fatto illecito          │
│  ──────────────────────────────────────────────       │
│  Qualunque fatto doloso o colposo che cagiona        │
│  ad altri un danno ingiusto, obbliga colui che       │
│  ha commesso il fatto a risarcire il danno.          │
│                                                        │
│  [Testo selezionabile con popup contestuale]          │
│                                                        │
├────────────────────────────────────────────────────────┤
│ ══════════════ BROCARDI DISPLAY ════════════════════ │
│ [▼ Brocardi] [▶ Ratio] [▶ Spiegazione] [▶ Massime]   │
│ [▶ Note Dispositivo] [▶ Relazioni] [▶ Riferimenti]   │
└────────────────────────────────────────────────────────┘
```

**Popup Selezione Testo (SelectionPopup):**
```
Quando l'utente seleziona testo appare:
┌─────────────────────────────┐
│ [🎨] [📝] [📋] [🔍]        │
│  H    N    C    S           │  ← Shortcuts tastiera
└─────────────────────────────┘
  │
  └─ Freccia che punta al testo selezionato

Azioni:
- H / 🎨 = Evidenzia (apre color picker)
- N / 📝 = Aggiungi nota
- C / 📋 = Copia
- S / 🔍 = Cerca articolo citato
```

**Color Picker Evidenziazioni:**
```
┌─────────────────────┐
│ 🟡 🟢 🔴 🔵        │
│ Giallo Verde Rosso Blu
└─────────────────────┘
```

**Toolbar Dettaglio:**

| Azione | Icona | Shortcut | Descrizione |
|--------|-------|----------|-------------|
| Copia | 📋 | - | Apre CopyModal con opzioni |
| Note | 📝 | - | Toggle pannello note |
| Evidenzia | 🎨 | - | Attiva modalità evidenziazione |
| Dossier | 📁 | - | Apre DossierModal |
| Condividi | 🔗 | - | Copia link diretto |
| Esporta | 📤 | - | Apre AdvancedExportModal |
| Versione | 📅 | - | Input data per versione storica |

---

### 2.5 BrocardiDisplay
**File:** `components/features/search/BrocardiDisplay.tsx`
**Scopo:** Mostra tutti i contenuti Brocardi.it per un articolo

**Sezioni Disponibili:**

| Sezione | Icona | Default | Contenuto |
|---------|-------|---------|-----------|
| Brocardi | 📜 | Aperta | Massime latine/principi |
| Ratio | 💡 | Chiusa | Motivazione giuridica |
| Spiegazione | 📖 | Chiusa | Spiegazione dettagliata |
| Massime | ⚖️ | Chiusa | Giurisprudenza con filtri |
| Note Dispositivo | 📝 | Chiusa | Note a piè di pagina |
| Relazioni | 📚 | Chiusa | Relazioni storiche |
| Riferimenti | 🔗 | Chiusa | Cross-references |

**MassimeSection - Features Avanzate:**
```
┌────────────────────────────────────────────────┐
│ ⚖️ Massime (47)                          [▼]  │
├────────────────────────────────────────────────┤
│ 🔍 [___Cerca massima___]  📅 [Tutti ▼]        │
├────────────────────────────────────────────────┤
│ 🔴 Cass. civ. n. 1234/2021                     │
│    Testo della massima...                [▼]  │
│                                                │
│ 🟣 Corte cost. n. 56/2020                      │
│    Testo della massima...                [▼]  │
├────────────────────────────────────────────────┤
│            [1] [2] [3] ... [5]                 │  ← Paginazione
└────────────────────────────────────────────────┘

Colori per autorità:
🔴 Cassazione civile
🟠 Cassazione penale
🟣 Corte costituzionale
🔵 Consiglio di Stato
⚫ Altre
```

---

### 2.6 TreeViewPanel
**File:** `components/features/search/TreeViewPanel.tsx`
**Scopo:** Pannello laterale con struttura completa dell'atto

```
┌─────────────────────────────────┐
│ Struttura Atto            [✕]  │
├─────────────────────────────────┤
│ Codice Civile                   │
│ 📊 Caricati: 3/2969             │
├─────────────────────────────────┤
│ ▾ Libro I - Delle persone       │
│   ▾ Titolo I - ...              │
│     ✓ Art. 1 ← (caricato)       │
│     ○ Art. 2                    │
│     ○ Art. 3                    │
│ ▸ Libro II - ...                │
│ ▸ Libro III - ...               │
└─────────────────────────────────┘

Legenda:
✓ = Articolo già caricato (cliccabile per navigare)
○ = Articolo non caricato (cliccabile per caricare)
```

---

### 2.7 QuickNormsManager
**File:** `components/features/search/QuickNormsManager.tsx`
**Scopo:** Modal per gestire norme preferite/frequenti

**Due modalità di input:**

```
┌─────────────────────────────────────────────────┐
│ Gestione Norme Rapide                     [✕]  │
├─────────────────────────────────────────────────┤
│ [📝 Manuale] [🔗 Da URL]  ← Tab switch          │
├─────────────────────────────────────────────────┤
│                                                 │
│ MODALITÀ MANUALE:                               │
│ Tipo Atto: [Codice Civile ▼]                   │
│ Numero:    [___________]                        │
│ Data:      [___________]                        │
│ Articolo:  [___________]                        │
│ Etichetta: [Art. 2043 CC - Risarcimento]       │
│                       [+ Aggiungi ai Preferiti] │
│                                                 │
│ MODALITÀ URL:                                   │
│ URL Normattiva: [_________________________]     │
│                              [📥 Importa]       │
├─────────────────────────────────────────────────┤
│ ═══════ NORME SALVATE ═══════                  │
│ ┌─────────────────────────────────────────┐    │
│ │ Art. 2043 CC - Risarcimento    [✏️] [🗑️] │   │
│ │ Art. 1175 CC - Correttezza     [✏️] [🗑️] │   │
│ │ Art. 844 CC - Immissioni       [✏️] [🗑️] │   │
│ └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## 3. Componenti Workspace

### 3.1 La pratica (`PracticeTable`, `ReadingRow`, `ReadingWindow`)
**File:** `components/features/practice/`
**Scopo:** Il tavolo di lavoro di una domanda. Sostituisce le finestre flottanti (le «tab» del
workspace), che non esistono più.

**Struttura (desktop):**
```
┌─────────────────────────────────────────────────────┐
│ Nome della pratica · 3 atti, 7 articoli  [Salva come dossier] [⋯] │
├─────────────────────────────────────────────────────┤
│ Atto (intestazione fissa: Studio, Struttura, PDF, ⋯)│
│   art. 2043 — rubrica            [Apri accanto] [✕] │  ← riga, si apre sul posto
│   art. 2059 — rubrica                               │
│ Giurisprudenza                                      │
│   Cass. civ., n. 10787/2024                         │
└─────────────────────────────────────────────────────┘
      [ Pratica 1 ] [ Pratica 2 ] [ + ]               ← barra delle pratiche
```

- Ogni ricerca, indice, sentenza o «Apri tutto» del dossier finisce nella pratica attiva
  (creata se manca): una sentenza è una voce della pratica, mai una scheda.
- «Apri accanto» apre una finestra leggera accanto al tavolo (mezzi o terzi di larghezza,
  altrimenti una colonna stretta che apre il tavolo); le finestre non si trascinano.
- Su telefono la pratica è una colonna con frecce e punti per cambiare pratica; «Apri accanto»
  apre il lettore a schermo intero, con «‹ Pratica» per tornare.
- «Salva come dossier» / «Aggiungi a un dossier…» salvano gli atti nell'ordine del tavolo.

**Tipi di Contenuto:**

1. **Atto** - una norma con i suoi articoli (anche senza articoli: l'indice)
2. **Giurisprudenza** - le sentenze della pratica, la più recente prima
3. **Ricerca per tema** - una finestra accanto, con le sentenze della Cassazione

**Trascinamento:**
- Gli atti si riordinano trascinandoli; gli articoli no
- Una norma citata in una finestra si apre accanto a quella finestra

---

### 3.2 ArticleNavigation
**File:** `components/features/workspace/ArticleNavigation.tsx`
**Scopo:** Navigazione tra articoli con frecce e indicatore posizione

```
┌─────────────────────────────────────┐
│     [◀]    3 / 15    [▶]           │
│            ↑                        │
│     Double-click per edit diretto   │
└─────────────────────────────────────┘

Stati:
- Freccia grigia = non disponibile
- Freccia blu = disponibile
- Pallino blu = articolo da caricare (non ancora fetched)
```

---

### 3.3 Dossier
**File:** `components/features/dossier/`
**Scopo:** Gestione raccolte di ricerca

```
┌──────────────────────────────────────────────────────┐
│ I Miei Dossier                    [+ Nuovo Dossier]  │
├──────────────────────────────────────────────────────┤
│ ┌────────────┐ ┌────────────┐ ┌────────────┐        │
│ │ 📁         │ │ 📁         │ │ 📁         │        │
│ │ Ricerca    │ │ Contratti  │ │ Penale     │        │
│ │ Civile     │ │ 2024       │ │ Tributario │        │
│ │            │ │            │ │            │        │
│ │ 5 articoli │ │ 12 articoli│ │ 3 articoli │        │
│ └────────────┘ └────────────┘ └────────────┘        │
├──────────────────────────────────────────────────────┤
│ ═══════ DETTAGLIO DOSSIER SELEZIONATO ═══════       │
│                                                      │
│ 📁 Ricerca Civile                                   │
│ Descrizione: Articoli per causa XYZ                 │
│ ───────────────────────────────────────────         │
│ ○ Art. 2043 CC          [unread]     [⋮]           │
│ ● Art. 1175 CC          [reading]    [⋮]           │
│ ★ Art. 844 CC           [important]  [⋮]           │
│ ✓ Art. 2059 CC          [done]       [⋮]           │
│ ───────────────────────────────────────────         │
│ [📤 Esporta PDF] [📋 Esporta JSON] [🗑️ Elimina]    │
└──────────────────────────────────────────────────────┘

Stati articolo:
○ unread    = Non letto
● reading   = In lettura
★ important = Importante
✓ done      = Completato
```

---

## 4. Study Mode

### 4.1 StudyMode (Modal Fullscreen)
**File:** `components/features/workspace/StudyMode/StudyMode.tsx`
**Scopo:** Modalità lettura concentrata con pannelli laterali

```
┌────────────────────────────────────────────────────────────────┐
│ [✕]  Study Mode - Art. 2043 CC            [⚙️ Settings]       │
├────────────────────────────────────────────────────────────────┤
│        │                                      │                │
│  TOOLS │         CONTENUTO ARTICOLO           │   BROCARDI    │
│  PANEL │                                      │    PANEL      │
│        │  Art. 2043 - Risarcimento            │               │
│ [📝]   │  ────────────────────────            │ [▼ Brocardi]  │
│ [🔍]   │  Qualunque fatto doloso              │ [▶ Ratio]     │
│ [📋]   │  o colposo che cagiona               │ [▶ Spiegaz.]  │
│ [🎨]   │  ad altri un danno...                │ [▶ Massime]   │
│        │                                      │ [▶ Note]      │
│        │                                      │               │
│        │                                      │ [🔗 Fonte]    │
├────────┴──────────────────────────────────────┴───────────────┤
│  [◀ Prev]              Pagina 1/1              [Next ▶]       │
│  [Light ○ ● Dark ○ Sepia]   Font: [A-] [A] [A+]              │
└────────────────────────────────────────────────────────────────┘
```

**Temi Disponibili:**
- `light` - Sfondo bianco, testo nero
- `dark` - Sfondo scuro, testo chiaro
- `sepia` - Sfondo caldo, testo marrone (per lettura prolungata)

**Tools Panel (sinistra):**
| Icona | Funzione |
|-------|----------|
| 📝 | Note personali |
| 🔍 | Cerca nel testo |
| 📋 | Copia formattato |
| 🎨 | Evidenzia testo |

**Brocardi Panel (destra):**
- Appare al hover sul bordo destro
- Può essere pinnato (rimane fisso)
- Contiene tutte le sezioni BrocardiDisplay
- Include **Note al Dispositivo** (nuova feature)

**Shortcut Tastiera:**
- `Escape` → Chiude Study Mode
- `←/→` → Articolo precedente/successivo
- `+/-` → Aumenta/diminuisci font

---

### 4.2 StudyModeBrocardiPanel
**File:** `components/features/workspace/StudyMode/StudyModeBrocardiPanel.tsx`
**Scopo:** Pannello laterale destro con approfondimenti

```
┌─────────────────────────────────┐
│ 💡 Approfondimenti    [📌][✕]  │
├─────────────────────────────────┤
│ [▼ Brocardi]                    │
│   • Nemo damnum facit...        │
│   • Qui iure suo utitur...      │
│                                 │
│ [▶ Ratio]                       │
│                                 │
│ [▶ Spiegazione]                 │
│                                 │
│ [▶ Massime (47)]                │
│                                 │
│ [▼ Note al Dispositivo (2)]     │  ← NUOVA SEZIONE
│   ① Modificato dall'art. 1...   │
│   ② Vedi anche art. 2059...     │
│                                 │
│ [🔗 Vedi fonte su Brocardi.it]  │
└─────────────────────────────────┘
```

**Note al Dispositivo:**
- Numero in cerchio ambra/giallo
- Testo della nota
- Aperte di default nel Panel, chiuse nel Popover

---

## 5. Componenti UI Condivisi

### 5.1 Modal Components

**DossierModal** (`components/ui/DossierModal.tsx`):
```
┌───────────────────────────────────┐
│ Aggiungi a Dossier          [✕]  │
├───────────────────────────────────┤
│ Seleziona dossier esistente:     │
│ ○ Ricerca Civile                 │
│ ○ Contratti 2024                 │
│ ● Penale Tributario              │
│ ─────────────────────────────    │
│ Oppure crea nuovo:               │
│ Nome: [_____________________]    │
│                                   │
│ [Annulla]           [+ Aggiungi] │
└───────────────────────────────────┘
```

**CopyModal** (`components/ui/CopyModal.tsx`):
```
┌───────────────────────────────────┐
│ Opzioni Copia               [✕]  │
├───────────────────────────────────┤
│ Includi:                          │
│ ☑️ Testo articolo                 │
│ ☑️ Citazione (Art. 2043 c.c.)    │
│ ☐ Note personali                  │
│ ☐ Evidenziazioni                  │
│ ───────────────────────────────   │
│ Formato:                          │
│ ○ Testo semplice                  │
│ ● Markdown                        │
│ ○ HTML                            │
│                                   │
│ [Annulla]              [📋 Copia] │
└───────────────────────────────────┘
```

**AdvancedExportModal** (`components/ui/AdvancedExportModal.tsx`):
```
┌───────────────────────────────────┐
│ Esporta Articolo            [✕]  │
├───────────────────────────────────┤
│ Formato: [PDF ▼]                  │
│                                   │
│ Contenuto:                        │
│ ☑️ Testo articolo                 │
│ ☑️ Informazioni Brocardi          │
│ ☐ Note personali                  │
│ ☐ Evidenziazioni                  │
│                                   │
│ [Annulla]           [📤 Esporta]  │
└───────────────────────────────────┘
```

---

### 5.2 Toast Notifications

```
Posizione: Bottom-right

┌────────────────────────────────┐
│ ✓ Articolo aggiunto al dossier │  ← Success (verde)
└────────────────────────────────┘

┌────────────────────────────────┐
│ ⚠️ Errore nel caricamento       │  ← Error (rosso)
└────────────────────────────────┘

┌────────────────────────────────┐
│ ℹ️ Link copiato negli appunti   │  ← Info (blu)
└────────────────────────────────┘

Auto-dismiss dopo 3 secondi
```

---

### 5.3 PDFViewer
**File:** `components/ui/PDFViewer.tsx`

```
┌────────────────────────────────────────────────┐
│ Anteprima PDF                            [✕]  │
├────────────────────────────────────────────────┤
│ [🔍-] [100%] [🔍+]  [📥 Download] [🖨️ Stampa] │
├────────────────────────────────────────────────┤
│                                                │
│              PDF Preview                       │
│                                                │
└────────────────────────────────────────────────┘
```

---

## 6. Struttura Dati

### Gerarchia Principale

```
Norma (documento legale)
  └── NormaVisitata (articolo specifico)
        ├── ArticleData (testo + metadata)
        │     └── BrocardiInfo
        │           ├── Brocardi[]
        │           ├── Ratio
        │           ├── Spiegazione
        │           ├── Massime[]
        │           ├── Footnotes[]      ← NUOVO
        │           ├── Relazioni[]
        │           └── CrossReferences[]
        │
        ├── Bookmark (salvataggio rapido)
        ├── DossierItem (in raccolta)
        └── QuickNorm (accesso veloce)
```

### Bookmark vs Dossier vs QuickNorm

| Feature | Bookmark | Dossier | QuickNorm |
|---------|----------|---------|-----------|
| **Scopo** | Salvataggio rapido | Raccolta ricerca | Accesso frequente |
| **Contenuto** | 1 articolo | N articoli | Parametri ricerca |
| **Organizzazione** | Tag | Cartelle | Lista ordinata per uso |
| **Export** | No | PDF/JSON | No |
| **Stato lettura** | No | Sì | No |
| **Uso tipico** | Bookmark browser | Progetto ricerca | Toolbar rapida |

---

## 7. Sistema di Temi

### Variabili CSS Disponibili

| Tema | Background | Text | Accent | Border |
|------|------------|------|--------|--------|
| Light | `#ffffff` | `#1a1a1a` | `#2563eb` | `#e5e7eb` |
| Dark | `#1f2937` | `#f3f4f6` | `#3b82f6` | `#374151` |
| Sepia | `#f4ecd8` | `#5c4b37` | `#b45309` | `#d4c4a8` |
| High Contrast | `#000000` | `#ffffff` | `#ffff00` | `#ffffff` |

### Dimensioni Font

| Size | Value | Uso |
|------|-------|-----|
| Small | 14px | Interfaccia compatta |
| Medium | 16px | Default |
| Large | 18px | Lettura confortevole |
| XLarge | 20px | Accessibilità |

### Font Family

| Family | Stack | Uso |
|--------|-------|-----|
| Sans | Inter, system-ui | Default UI |
| Serif | Georgia, Times | Lettura testi |
| Mono | JetBrains Mono, monospace | Codice/citazioni |

---

## 8. Flussi Utente Principali

### Flusso 1: Ricerca Articolo
```
1. Utente apre Command Palette (Cmd+K)
2. Digita "art 2043 cc"
3. Sistema parsa automaticamente
4. Click "Cerca" o Enter
5. Il risultato entra nel suo atto, sul tavolo della pratica attiva
6. Utente può:
   - Leggere testo
   - Aprire Study Mode
   - Salvare in Bookmark
   - Aggiungere a Dossier
```

### Flusso 2: Creazione Dossier
```
1. Utente cerca più articoli
2. Click "Aggiungi a Dossier" su ogni articolo
3. Seleziona dossier esistente o crea nuovo
4. Va su Dossier
5. Visualizza tutti gli articoli raccolti
6. Imposta stati (unread/reading/important/done)
7. Esporta PDF finale
```

### Flusso 3: Studio Approfondito
```
1. Utente trova articolo interessante
2. Click "Study Mode" (icona libro)
3. Si apre modal fullscreen
4. Hover destro → appare pannello Brocardi
5. Click pin → pannello resta fisso
6. Legge commenti, massime, note dispositivo
7. Evidenzia passaggi importanti
8. Aggiunge note personali
9. Escape per uscire
```

### Flusso 4: Navigazione Cross-Reference
```
1. Utente legge spiegazione in BrocardiDisplay
2. Vede link "v. art. 1175"
3. Click sul link
4. L'articolo citato entra nel suo atto, sul tavolo della pratica (o accanto, se la citazione è in una finestra)
5. Può tornare indietro con navigazione
```

---

## Appendice: Icone e Simboli

| Icona | Significato |
|-------|-------------|
| 🔍 | Ricerca |
| 📋 | Copia/Workspace |
| 📜 | Cronologia |
| ⭐ | Preferiti/Bookmark |
| 📁 | Dossier/Cartella |
| ⚙️ | Impostazioni |
| 🌙/☀️ | Tema scuro/chiaro |
| 💡 | Approfondimenti/Ratio |
| 📝 | Note/Annotazioni |
| 🎨 | Evidenziazioni |
| 📤 | Esporta |
| 🔗 | Link/Condividi |
| 📌 | Pin/Fissa |
| ✕ | Chiudi |
| ▶/▼ | Espandi/Comprimi |

---

## Appendice: File di Riferimento

### Componenti Search
- `frontend/src/components/features/search/SearchForm.tsx`
- `frontend/src/components/features/search/SearchPanel.tsx`
- `frontend/src/components/features/search/NormaCard.tsx`
- `frontend/src/components/features/search/ArticleTabContent.tsx`
- `frontend/src/components/features/search/BrocardiDisplay.tsx`
- `frontend/src/components/features/search/BrocardiContent.tsx`
- `frontend/src/components/features/search/MassimeSection.tsx`
- `frontend/src/components/features/search/CommandPalette.tsx`
- `frontend/src/components/features/search/SelectionPopup.tsx`
- `frontend/src/components/features/search/TreeViewPanel.tsx`
- `frontend/src/components/features/search/QuickNormsManager.tsx`
- `frontend/src/components/features/search/FootnoteTooltip.tsx`

### Componenti Workspace
- `frontend/src/components/features/practice/PracticeTable.tsx`
- `frontend/src/components/features/practice/ReadingRow.tsx`
- `frontend/src/components/features/practice/ReadingWindow.tsx`
- `frontend/src/components/features/practice/PracticeBar.tsx`
- `frontend/src/components/features/workspace/ArticleNavigation.tsx`

### Study Mode
- `frontend/src/components/features/workspace/StudyMode/StudyMode.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeHeader.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeContent.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeFooter.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeToolsPanel.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeBrocardiPanel.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeBrocardiPopover.tsx`
- `frontend/src/components/features/workspace/StudyMode/StudyModeSettings.tsx`

### State Management
- `frontend/src/store/useAppStore.ts`

### Tipi TypeScript
- `frontend/src/types/index.ts`

---

*Documento generato per VisuaLex Frontend v1.0*
*Ultimo aggiornamento: Dicembre 2024*
