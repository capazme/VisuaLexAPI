/**
 * Tour Configuration
 *
 * Configurazione centralizzata per il sistema di onboarding/tour.
 * 12 tour totali: 5 per pagina + 7 contestuali per feature.
 */
import type { DriveStep } from 'driver.js';

// ==================== VERSIONING ====================
// Incrementare quando si aggiungono tour significativi o si cambiano step importanti
// Version 2: Ristrutturazione completa con tour per tutte le pagine e feature
export const TOUR_VERSION = 2;

// ==================== STORAGE KEYS ====================
export const TOUR_STORAGE_KEY = 'visualex_tour';

// ==================== TOUR TYPES ====================
export const TOUR_KEYS = {
    // Page tours
    welcome: 'welcome',
    search: 'search',
    dossier: 'dossier',
    history: 'history',
    environments: 'environments',
    // Feature tours
    commandPalette: 'commandPalette',
    studyMode: 'studyMode',
    treeView: 'treeView',
    citationPreview: 'citationPreview',
    workspaceTab: 'workspaceTab',
    normaBlock: 'normaBlock',
    quickNorms: 'quickNorms',
} as const;

export type TourType = keyof typeof TOUR_KEYS;

// ==================== PAGE TOURS ====================

/**
 * Welcome Tour - Prima visita assoluta (3 step)
 */
export const WELCOME_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Benvenuto in VisuaLex',
            description: 'Il tuo assistente per la consultazione di normativa italiana ed europea. Ti guideremo alla scoperta delle funzionalità principali.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-sidebar',
        popover: {
            title: 'Navigazione Principale',
            description: 'Da qui accedi a tutte le sezioni: Ricerca, Dossier per organizzare le tue raccolte, Cronologia e Ambienti di lavoro.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-quick-search',
        popover: {
            title: 'Inizia a Cercare',
            description: 'Premi Cmd+K (Mac) o Ctrl+K (Windows) per aprire la ricerca veloce. Prova subito!',
            side: 'bottom',
            align: 'start',
        }
    }
];

/**
 * Search Page Tour - Panoramica ricerca (10 step)
 */
export const SEARCH_STEPS: DriveStep[] = [
    {
        element: '#tour-search-form',
        popover: {
            title: 'Pannello di Ricerca',
            description: 'Da qui puoi cercare qualsiasi norma italiana o europea. Compila i campi e premi Cerca.',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-act-type',
        popover: {
            title: 'Tipo di Atto',
            description: 'Seleziona il tipo: Codice Civile, Costituzione, Legge, Decreto Legislativo, norme UE e molto altro.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-article-input',
        popover: {
            title: 'Numero Articolo',
            description: 'Inserisci l\'articolo. Supporta formati multipli: "1", "1,2,3", "1-5" oppure "1 bis".',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-version-select',
        popover: {
            title: 'Versione della Norma',
            description: 'Scegli "Vigente" per il testo attuale o seleziona una data per versioni storiche.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-brocardi-toggle',
        popover: {
            title: 'Informazioni Brocardi',
            description: 'Attiva per ottenere spiegazioni, ratio legis e massime giurisprudenziali insieme al testo.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-quick-search',
        popover: {
            title: 'Ricerca Veloce (Cmd+K)',
            description: 'Preferisci digitare? Usa la ricerca veloce per inserire citazioni naturali come "art. 2043 cc".',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-quick-norms',
        popover: {
            title: 'Norme Preferite',
            description: 'Le norme che consulti spesso vengono salvate qui per un accesso rapido con un solo click.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '#tour-results-area',
        popover: {
            title: 'Area Risultati',
            description: 'I risultati della ricerca appaiono qui. Ogni norma diventa una scheda che puoi spostare e ridimensionare.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '#tour-tree-view-btn',
        popover: {
            title: 'Struttura Documento',
            description: 'Visualizza l\'indice completo della norma con titoli, capi e sezioni. Clicca un articolo per caricarlo.',
            side: 'left',
            align: 'center',
        }
    },
    {
        popover: {
            title: 'Sei Pronto!',
            description: 'Hai scoperto le funzionalità principali. Ricorda: passa il mouse sulle citazioni per un\'anteprima rapida.',
            side: 'over',
            align: 'center',
        }
    }
];

/**
 * Dossier Page Tour - Gestione raccolte (10 step)
 */
export const DOSSIER_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'I tuoi Dossier',
            description: 'I dossier sono raccolte tematiche per organizzare le tue ricerche: casi, progetti, studi comparativi.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-create',
        popover: {
            title: 'Crea un Nuovo Dossier',
            description: 'Clicca qui per creare un dossier. Assegna un titolo, una descrizione e dei tag per organizzarlo.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-dossier-search',
        popover: {
            title: 'Cerca nei Dossier',
            description: 'Cerca per titolo, descrizione o contenuto. Filtra rapidamente tra i tuoi dossier.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-filters',
        popover: {
            title: 'Filtri per Tag',
            description: 'Clicca sui tag per filtrare i dossier. Puoi combinare più tag per ricerche precise.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-dossier-sort',
        popover: {
            title: 'Ordinamento',
            description: 'Ordina per data, nome o numero di elementi per trovare subito ciò che cerchi.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        element: '#tour-dossier-card',
        popover: {
            title: 'Card Dossier',
            description: 'Ogni card mostra titolo, tag, numero di elementi e data. Clicca per aprire e gestire il contenuto.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-pin',
        popover: {
            title: 'Fissa in Alto',
            description: 'Clicca la stella per fissare i dossier importanti in cima alla lista.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-stats',
        popover: {
            title: 'Statistiche Elementi',
            description: 'Vedi quanti elementi sono: da leggere, in lettura, importanti o completati.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-items',
        popover: {
            title: 'Gestione Elementi',
            description: 'Trascina per riordinare, cambia lo stato con il menu a tendina, elimina con il cestino.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-export',
        popover: {
            title: 'Esporta e Condividi',
            description: 'Esporta in PDF per stampa, JSON per backup, o genera un link per condividere con colleghi.',
            side: 'left',
            align: 'center',
        }
    }
];

/**
 * History Page Tour - Cronologia ricerche (5 step)
 */
export const HISTORY_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Cronologia Ricerche',
            description: 'Qui trovi tutte le tue ricerche passate. Nulla va perso, puoi sempre recuperare ciò che hai consultato.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-history-search',
        popover: {
            title: 'Cerca nella Cronologia',
            description: 'Filtra per tipo di atto, numero o data per trovare velocemente ricerche passate.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-history-item',
        popover: {
            title: 'Elemento Cronologia',
            description: 'Clicca per rieseguire la ricerca. Ogni voce mostra tipo atto, articoli e data della consultazione.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-history-actions',
        popover: {
            title: 'Azioni Rapide',
            description: 'Dal menu puoi: salvare come Norma Rapida, aggiungere a un Dossier o eliminare dalla cronologia.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '#tour-history-quick-norm',
        popover: {
            title: 'Salva come Norma Rapida',
            description: 'Le norme che consulti spesso meritano un accesso veloce. Salvale qui per trovarle sempre a portata di click.',
            side: 'left',
            align: 'center',
        }
    }
];

/**
 * Environments Page Tour - Ambienti di lavoro (6 step)
 */
export const ENVIRONMENTS_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Ambienti di Lavoro',
            description: 'Gli ambienti salvano configurazioni complete: dossier, norme rapide, annotazioni. Perfetti per passare tra progetti diversi.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-env-create',
        popover: {
            title: 'Crea Ambiente',
            description: 'Salva lo stato attuale del tuo workspace. Puoi includere dossier, norme rapide e annotazioni.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-env-categories',
        popover: {
            title: 'Categorie',
            description: 'Filtra per categoria: Compliance, Civile, Penale, Amministrativo, UE. Organizza gli ambienti per area.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-env-card',
        popover: {
            title: 'Card Ambiente',
            description: 'Ogni card mostra nome, categoria e statistiche. Clicca per vedere i dettagli o applicare l\'ambiente.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-env-apply',
        popover: {
            title: 'Applica Ambiente',
            description: 'Carica tutte le impostazioni salvate: dossier, norme rapide, annotazioni. Puoi scegliere se sostituire o unire.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '#tour-env-share',
        popover: {
            title: 'Condividi',
            description: 'Esporta come file JSON o genera un link per condividere l\'ambiente con colleghi o tra dispositivi.',
            side: 'left',
            align: 'center',
        }
    }
];

// ==================== FEATURE TOURS ====================

/**
 * Command Palette Tour - Ricerca veloce (4 step)
 */
export const COMMAND_PALETTE_STEPS: DriveStep[] = [
    {
        element: '[cmdk-input]',
        popover: {
            title: 'Ricerca Intelligente',
            description: 'Scrivi citazioni naturali: "art 2043 cc", "legge 241/1990", "costituzione art 1". Il sistema le interpreta automaticamente.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#command-palette-results',
        popover: {
            title: 'Risultati e Suggerimenti',
            description: 'Naviga con le frecce, premi Invio per selezionare. I risultati si aggiornano mentre digiti.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#command-palette-brocardi-toggle',
        popover: {
            title: 'Opzione Brocardi',
            description: 'Attiva per ottenere spiegazioni, ratio legis e massime giurisprudenziali insieme al testo.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '#command-palette-quick-norms',
        popover: {
            title: 'Norme Rapide',
            description: 'Le tue norme preferite appaiono qui per un accesso immediato. Premi il numero per selezionarle.',
            side: 'bottom',
            align: 'center',
        }
    }
];

/**
 * Study Mode Tour - Lettura immersiva (8 step)
 */
export const STUDY_MODE_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Modalità Studio',
            description: 'Benvenuto nella modalità studio: lettura immersiva a schermo intero per concentrarti sul testo.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-study-close',
        popover: {
            title: 'Chiudi Modalità Studio',
            description: 'Premi Escape o clicca qui per tornare alla vista normale.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        element: '#tour-study-typography',
        popover: {
            title: 'Controlli Tipografia',
            description: 'Regola dimensione del font e interlinea per una lettura ottimale secondo le tue preferenze.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-study-theme',
        popover: {
            title: 'Tema di Lettura',
            description: 'Scegli tra chiaro, scuro o seppia. Ogni tema è studiato per ridurre l\'affaticamento visivo.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-study-content',
        popover: {
            title: 'Area di Lettura',
            description: 'Il testo dell\'articolo in formato ottimizzato. Seleziona per evidenziare o aggiungere note.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '#tour-study-notes',
        popover: {
            title: 'Pannello Note',
            description: 'Aggiungi annotazioni personali che vengono salvate automaticamente. Le ritrovi anche fuori dalla modalità studio.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '#tour-study-highlights',
        popover: {
            title: 'Evidenziazioni',
            description: 'Seleziona il testo e scegli un colore per evidenziare i passaggi importanti. 4 colori disponibili.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '#tour-study-navigation',
        popover: {
            title: 'Navigazione Articoli',
            description: 'Passa all\'articolo precedente o successivo senza uscire dalla modalità studio.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Tree View Tour - Struttura documento (4 step)
 */
export const TREE_VIEW_STEPS: DriveStep[] = [
    {
        element: '#tour-tree-header',
        popover: {
            title: 'Struttura Documento',
            description: 'Visualizza l\'indice completo della norma: libri, titoli, capi, sezioni e articoli.',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-tree-content',
        popover: {
            title: 'Navigazione Gerarchica',
            description: 'Espandi le sezioni per vedere i contenuti. La struttura riflette l\'organizzazione ufficiale della norma.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-tree-article',
        popover: {
            title: 'Carica Articolo',
            description: 'Clicca su un articolo per caricarlo direttamente. Puoi selezionarne più di uno.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-tree-stats',
        popover: {
            title: 'Statistiche',
            description: 'Vedi il numero totale di articoli della norma e quanti ne hai già caricati.',
            side: 'right',
            align: 'end',
        }
    }
];

/**
 * Citation Preview Tour - Anteprima citazioni (3 step)
 */
export const CITATION_PREVIEW_STEPS: DriveStep[] = [
    {
        element: '.citation-hover',
        popover: {
            title: 'Citazioni nel Testo',
            description: 'Le citazioni normative sono sottolineate. Passa il mouse sopra per un\'anteprima.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '.citation-preview-popup',
        popover: {
            title: 'Anteprima Articolo',
            description: 'Leggi il contenuto dell\'articolo citato senza lasciare la pagina corrente.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.citation-preview-open',
        popover: {
            title: 'Apri in Nuova Tab',
            description: 'Clicca il pulsante per caricare l\'articolo completo in una nuova scheda del workspace.',
            side: 'bottom',
            align: 'center',
        }
    }
];

/**
 * Workspace Tab Tour - Gestione schede (5 step)
 */
export const WORKSPACE_TAB_STEPS: DriveStep[] = [
    {
        element: '#tour-workspace-dock',
        popover: {
            title: 'Dock delle Schede',
            description: 'Ogni norma aperta diventa una scheda nel dock. Clicca per passare da una all\'altra.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '.workspace-tab-panel',
        popover: {
            title: 'Pannello Norma',
            description: 'Qui trovi il testo. Puoi ridimensionare trascinando i bordi, spostare trascinando l\'intestazione.',
            side: 'left',
            align: 'start',
        }
    },
    {
        element: '#tour-workspace-minimize',
        popover: {
            title: 'Minimizza',
            description: 'Riduci a icona le schede che non stai consultando. Rimangono accessibili dal dock.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-workspace-close',
        popover: {
            title: 'Chiudi Scheda',
            description: 'Chiudi le schede che non ti servono più. Puoi sempre riaprirle dalla cronologia.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-quicknorms',
        popover: {
            title: 'Norme Preferite',
            description: 'Le norme che consulti spesso appaiono qui. Un click per aprirle direttamente.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Norma Block Tour - Esplorazione articolo (6 step)
 */
export const NORMA_BLOCK_STEPS: DriveStep[] = [
    {
        element: '.norma-block-header',
        popover: {
            title: 'Intestazione Norma',
            description: 'Tipo atto, numero e data. Clicca per espandere/comprimere, trascina per riordinare.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.norma-article-tabs',
        popover: {
            title: 'Schede Articoli',
            description: 'Ogni articolo caricato ha la sua scheda. Passa rapidamente da uno all\'altro.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.glass-toolbar',
        popover: {
            title: 'Barra Strumenti',
            description: 'Norme rapide, note personali, evidenziatore, copia, esportazione e altro.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.norma-study-mode-btn',
        popover: {
            title: 'Modalità Studio',
            description: 'Lettura immersiva a schermo intero con opzioni di tipografia e presa appunti.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.norma-structure-btn',
        popover: {
            title: 'Struttura Atto',
            description: 'Visualizza l\'indice completo con titoli, capi e sezioni. Clicca per caricare altri articoli.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.brocardi-display',
        popover: {
            title: 'Brocardi e Spiegazioni',
            description: 'Ratio legis, massime giurisprudenziali e riferimenti. Attiva "Brocardi" nella ricerca.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Quick Norms Tour - Norme preferite (4 step)
 */
export const QUICK_NORMS_STEPS: DriveStep[] = [
    {
        element: '#tour-quicknorms-panel',
        popover: {
            title: 'Le tue Norme Rapide',
            description: 'Qui trovi le norme che hai salvato per un accesso veloce. Un click per aprirle.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '#tour-quicknorms-add',
        popover: {
            title: 'Aggiungi Norma',
            description: 'Dalla barra strumenti di un articolo, clicca il fulmine per salvarlo qui.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-quicknorms-item',
        popover: {
            title: 'Usa Norma Rapida',
            description: 'Clicca per eseguire la ricerca. Il badge mostra quante volte l\'hai usata.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-quicknorms-manage',
        popover: {
            title: 'Gestisci',
            description: 'Apri il pannello di gestione per rinominare, riordinare o eliminare le norme salvate.',
            side: 'left',
            align: 'center',
        }
    }
];

// ==================== STEPS MAP ====================
export const TOUR_STEPS_MAP: Record<TourType, DriveStep[]> = {
    // Page tours
    welcome: WELCOME_STEPS,
    search: SEARCH_STEPS,
    dossier: DOSSIER_STEPS,
    history: HISTORY_STEPS,
    environments: ENVIRONMENTS_STEPS,
    // Feature tours
    commandPalette: COMMAND_PALETTE_STEPS,
    studyMode: STUDY_MODE_STEPS,
    treeView: TREE_VIEW_STEPS,
    citationPreview: CITATION_PREVIEW_STEPS,
    workspaceTab: WORKSPACE_TAB_STEPS,
    normaBlock: NORMA_BLOCK_STEPS,
    quickNorms: QUICK_NORMS_STEPS,
};

// ==================== UI STRINGS ====================
export const TOUR_UI = {
    nextBtnText: 'Avanti',
    prevBtnText: 'Indietro',
    doneBtnText: 'Fine',
    progressText: '{{current}} di {{total}}',
} as const;
