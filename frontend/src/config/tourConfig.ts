/**
 * Tour Configuration
 *
 * Configurazione centralizzata per il sistema di onboarding/tour.
 * Separata dal hook per facilitare manutenzione e localizzazione.
 */
import type { DriveStep } from 'driver.js';

// ==================== VERSIONING ====================
// Incrementare quando si aggiungono tour significativi o si cambiano step importanti
// Gli utenti che hanno completato una versione precedente vedranno di nuovo il tour
export const TOUR_VERSION = 1;

// ==================== STORAGE KEYS ====================
export const TOUR_STORAGE_KEY = 'visualex_tour';

export const TOUR_KEYS = {
    main: 'main',
    commandPalette: 'commandPalette',
    workspaceTab: 'workspaceTab',
    normaBlock: 'normaBlock',
    dossier: 'dossier',
} as const;

export type TourType = keyof typeof TOUR_KEYS;

// ==================== TOUR CONTENT ====================
// Tono: Professionale, Rassicurante, Sintetico

/**
 * Main onboarding tour - max 5 step
 * Segue il "Happy Path": Welcome -> Input -> Navigation -> Organization -> Output
 */
export const MAIN_TOUR_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Il tuo assistente legale',
            description: 'VisuaLex ti aiuta a consultare rapidamente normativa italiana ed europea. Vediamo insieme le funzioni principali.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-quick-search',
        popover: {
            title: 'Ricerca Veloce',
            description: 'Premi Cmd+K (o clicca qui) per cercare. Scrivi citazioni come "Art. 2043 cc" o "D.Lgs 81/2008" e il sistema le riconosce automaticamente.',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-sidebar',
        popover: {
            title: 'Navigazione',
            description: 'Accedi a Ricerca, Dossier (per organizzare le tue raccolte) e Cronologia delle consultazioni.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-focus-toggle',
        popover: {
            title: 'Modalità Focus',
            description: 'Attiva la modalità concentrazione (Cmd+Spazio) per leggere senza distrazioni.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        popover: {
            title: 'Pronto per iniziare',
            description: 'Premi Cmd+K per la tua prima ricerca. Tutto ciò che consulti viene salvato nella cronologia.',
            side: 'over',
            align: 'center',
        }
    }
];

/**
 * Command Palette tour - 3 step essenziali
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
            title: 'Selezione Atto',
            description: 'Scegli il tipo di atto dalla lista oppure incolla direttamente una citazione nel campo di ricerca.',
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
    }
];

/**
 * Workspace Tab tour - quando si apre il primo risultato
 */
export const WORKSPACE_TAB_STEPS: DriveStep[] = [
    {
        element: '#tour-workspace-dock',
        popover: {
            title: 'Gestione Schede',
            description: 'Ogni norma aperta diventa una scheda. Puoi consultare più norme contemporaneamente.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '.workspace-tab-panel',
        popover: {
            title: 'Pannello Norma',
            description: 'Qui trovi il testo. Puoi ridimensionare, spostare e minimizzare i pannelli secondo le tue esigenze.',
            side: 'left',
            align: 'start',
        }
    },
    {
        element: '#tour-quicknorms',
        popover: {
            title: 'Norme Preferite',
            description: 'Salva le norme che consulti spesso per accedervi con un click dalla ricerca veloce.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * NormaBlock tour - esplorazione articolo (6 step chiave)
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
        element: '.norma-study-mode-btn',
        popover: {
            title: 'Modalità Studio',
            description: 'Lettura immersiva a schermo intero con navigazione facilitata tra gli articoli.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.norma-structure-btn',
        popover: {
            title: 'Struttura Atto',
            description: 'Visualizza indice completo (titoli, capi, sezioni). Clicca su un articolo per caricarlo.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.norma-article-tabs',
        popover: {
            title: 'Schede Articoli',
            description: 'Ogni articolo aperto diventa una scheda. Passa rapidamente da uno all\'altro.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.glass-toolbar',
        popover: {
            title: 'Barra Strumenti',
            description: 'Preferiti, annotazioni personali, evidenziatore, copia ed esportazione.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.brocardi-display',
        popover: {
            title: 'Brocardi e Spiegazioni',
            description: 'Ratio legis, massime e riferimenti. Attiva "Brocardi" nella ricerca per visualizzarli.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Dossier page tour
 */
export const DOSSIER_STEPS: DriveStep[] = [
    {
        element: '.dossier-create-button',
        popover: {
            title: 'Crea un Dossier',
            description: 'Organizza le ricerche in raccolte tematiche: casi, progetti, studi.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.dossier-card',
        popover: {
            title: 'I tuoi Dossier',
            description: 'Clicca per aprire e gestire il contenuto. Puoi aggiungere tag e riordinare.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '.dossier-export',
        popover: {
            title: 'Esportazione',
            description: 'Esporta in PDF per condividere o archiviare. Disponibile anche JSON per backup.',
            side: 'left',
            align: 'center',
        }
    }
];

// ==================== STEPS MAP ====================
export const TOUR_STEPS_MAP: Record<TourType, DriveStep[]> = {
    main: MAIN_TOUR_STEPS,
    commandPalette: COMMAND_PALETTE_STEPS,
    workspaceTab: WORKSPACE_TAB_STEPS,
    normaBlock: NORMA_BLOCK_STEPS,
    dossier: DOSSIER_STEPS,
};

// ==================== UI STRINGS ====================
export const TOUR_UI = {
    nextBtnText: 'Avanti',
    prevBtnText: 'Indietro',
    doneBtnText: 'Fine',
    progressText: '{{current}} di {{total}}',
} as const;
