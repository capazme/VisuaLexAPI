import { useCallback, useRef } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

// Storage keys for each tour type
const TOUR_KEYS = {
    main: 'visualex_tour_main',
    commandPalette: 'visualex_tour_command_palette',
    workspaceTab: 'visualex_tour_workspace_tab',
    normaBlock: 'visualex_tour_norma_block',
    dossier: 'visualex_tour_dossier',
} as const;

type TourType = keyof typeof TOUR_KEYS;

/**
 * Main onboarding tour steps
 */
const MAIN_TOUR_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Benvenuto in VisuaLex! 👋',
            description: 'Ti guideremo attraverso le funzionalità principali in pochi secondi. Puoi chiudere il tour in qualsiasi momento.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-quick-search',
        popover: {
            title: 'Ricerca Veloce ⌘K',
            description: 'Premi ⌘K (o clicca qui) per aprire la ricerca intelligente. Scrivi citazioni come "Art. 2043 cc" o "D.Lgs 81/2008".',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-sidebar',
        popover: {
            title: 'Navigazione Principale',
            description: 'Da qui accedi a tutte le sezioni: Ricerca, Dossier e Cronologia.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-focus-toggle',
        popover: {
            title: 'Modalità Focus 🎯',
            description: 'Attiva la modalità concentrazione (⌘+Spazio) per leggere senza distrazioni.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        popover: {
            title: 'Tutto Pronto! 🚀',
            description: 'Premi ⌘K per la tua prima ricerca. Buon lavoro!',
            side: 'over',
            align: 'center',
        }
    }
];

/**
 * Command Palette tour - shown on first use of the palette
 */
const COMMAND_PALETTE_STEPS: DriveStep[] = [
    {
        element: '[cmdk-input]',
        popover: {
            title: 'Ricerca Intelligente 🔍',
            description: 'Scrivi qui la tua ricerca. Il sistema capisce citazioni come "art 2043 cc", "legge 241/1990" o "costituzione art 1".',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#command-palette-results',
        popover: {
            title: 'Selezione Atto',
            description: 'Scegli il tipo di atto dalla lista, oppure incolla direttamente una citazione nel campo di ricerca.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#command-palette-brocardi-toggle',
        popover: {
            title: 'Opzione Brocardi 📚',
            description: 'Attiva questa opzione per ottenere anche spiegazioni, ratio legis e massime giurisprudenziali.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Workspace Tab tour - shown when first result loads
 */
const WORKSPACE_TAB_STEPS: DriveStep[] = [
    {
        element: '#tour-workspace-dock',
        popover: {
            title: 'Gestione Schede 📑',
            description: 'Ogni norma aperta è una scheda. Puoi aprire più norme contemporaneamente e passare da una all\'altra.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '.workspace-tab-panel',
        popover: {
            title: 'Pannello Norma',
            description: 'Qui trovi il testo della norma. Puoi ridimensionare, spostare e minimizzare i pannelli.',
            side: 'left',
            align: 'start',
        }
    },
    {
        element: '#tour-quicknorms',
        popover: {
            title: 'Salva nei Preferiti ⭐',
            description: 'Aggiungi questa norma ai preferiti per accedervi rapidamente in futuro.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Norma Block tour - comprehensive article exploration (10 steps)
 */
const NORMA_BLOCK_STEPS: DriveStep[] = [
    // 1. Header & Controls
    {
        element: '.norma-block-header',
        popover: {
            title: 'Intestazione Norma 📖',
            description: 'Qui vedi tipo atto, numero e data. Clicca per espandere/comprimere. Trascina la maniglia per spostare.',
            side: 'bottom',
            align: 'start',
        }
    },
    // 2. Study Mode
    {
        element: '.norma-study-mode-btn',
        popover: {
            title: 'Modalità Studio 📚',
            description: 'Attiva la modalità immersiva per studiare l\'articolo senza distrazioni, con navigazione facilitata.',
            side: 'bottom',
            align: 'center',
        }
    },
    // 3. Structure Tree
    {
        element: '.norma-structure-btn',
        popover: {
            title: 'Struttura Atto 🌳',
            description: 'Visualizza la struttura completa dell\'atto (titoli, capi, sezioni). Clicca su un articolo per caricarlo.',
            side: 'bottom',
            align: 'center',
        }
    },
    // 4. Article Navigation
    {
        element: '.article-navigation',
        popover: {
            title: 'Navigazione Articoli ◀️ ▶️',
            description: 'Passa rapidamente all\'articolo precedente o successivo senza ricaricare la pagina.',
            side: 'bottom',
            align: 'center',
        }
    },
    // 5. Article Tabs
    {
        element: '.norma-article-tabs',
        popover: {
            title: 'Schede Articoli',
            description: 'Ogni articolo aperto è una scheda. Clicca per passare da uno all\'altro. Usa le icone per estrarre o chiudere.',
            side: 'bottom',
            align: 'start',
        }
    },
    // 6. Reading Toolbar
    {
        element: '.glass-toolbar',
        popover: {
            title: 'Barra Strumenti Lettura 🛠️',
            description: 'Da qui: aggiungi ai preferiti ⚡, annota ✏️, evidenzia 🖍️, copia 📋, esporta e altro ancora.',
            side: 'bottom',
            align: 'center',
        }
    },
    // 7. Highlight Feature
    {
        element: '[data-highlight-button]',
        popover: {
            title: 'Evidenziatore 🖍️',
            description: 'Seleziona del testo e clicca qui per evidenziarlo in diversi colori. Le evidenziazioni vengono salvate!',
            side: 'bottom',
            align: 'center',
        }
    },
    // 8. Notes Feature
    {
        element: '.glass-toolbar button[title="Note Personali"]',
        popover: {
            title: 'Note Personali ✏️',
            description: 'Aggiungi annotazioni personali all\'articolo. Perfetto per appunti di studio o promemoria.',
            side: 'bottom',
            align: 'center',
        }
    },
    // 9. Article Content & Cross-refs
    {
        element: '.legal-prose',
        popover: {
            title: 'Testo dell\'Articolo',
            description: 'Il testo formattato con stile giuridico. I riferimenti ad altri articoli sono cliccabili per la navigazione incrociata.',
            side: 'top',
            align: 'center',
        }
    },
    // 10. Brocardi Section
    {
        element: '.brocardi-display',
        popover: {
            title: 'Brocardi & Spiegazioni 📚',
            description: 'Spiegazioni, ratio legis, massime giurisprudenziali e riferimenti. Attiva "Brocardi" nella ricerca per visualizzarli.',
            side: 'top',
            align: 'center',
        }
    }
];

/**
 * Dossier page tour
 */
const DOSSIER_STEPS: DriveStep[] = [
    {
        element: '.dossier-create-button',
        popover: {
            title: 'Crea un Dossier 📁',
            description: 'Organizza le tue ricerche in raccolte tematiche. Perfetto per gestire casi o progetti.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.dossier-card',
        popover: {
            title: 'I tuoi Dossier',
            description: 'Clicca su un dossier per visualizzarne il contenuto.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '.dossier-export',
        popover: {
            title: 'Esportazione PDF',
            description: 'Esporta l\'intero dossier in PDF per condividerlo o archiviarlo.',
            side: 'left',
            align: 'center',
        }
    }
];

// Map tour types to their steps
const TOUR_STEPS_MAP: Record<TourType, DriveStep[]> = {
    main: MAIN_TOUR_STEPS,
    commandPalette: COMMAND_PALETTE_STEPS,
    workspaceTab: WORKSPACE_TAB_STEPS,
    normaBlock: NORMA_BLOCK_STEPS,
    dossier: DOSSIER_STEPS,
};

interface UseTourOptions {
    theme?: 'light' | 'dark';
    onComplete?: (tourType: TourType) => void;
}

export function useTour(options: UseTourOptions = {}) {
    const driverRef = useRef<Driver | null>(null);

    // Check if a specific tour has been seen
    const hasSeenTour = useCallback((tourType: TourType = 'main') => {
        if (typeof window === 'undefined') return true;
        return localStorage.getItem(TOUR_KEYS[tourType]) === 'true';
    }, []);

    // Mark a specific tour as completed
    const markTourComplete = useCallback((tourType: TourType) => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(TOUR_KEYS[tourType], 'true');
    }, []);

    // Reset a specific tour or all tours
    const resetTour = useCallback((tourType?: TourType) => {
        if (typeof window === 'undefined') return;
        if (tourType) {
            localStorage.removeItem(TOUR_KEYS[tourType]);
        } else {
            // Reset all tours
            Object.values(TOUR_KEYS).forEach(key => localStorage.removeItem(key));
        }
    }, []);

    // Start a specific tour
    const startTour = useCallback((tourType: TourType = 'main') => {
        const steps = TOUR_STEPS_MAP[tourType];

        // Filter out steps whose elements don't exist in DOM
        const availableSteps = steps.filter(step => {
            if (!step.element) return true; // Modal steps always show
            const el = document.querySelector(step.element as string);
            return el !== null;
        });

        if (availableSteps.length === 0) return;

        const isDark = options.theme === 'dark';

        driverRef.current = driver({
            animate: true,
            showProgress: true,
            showButtons: ['next', 'previous', 'close'],
            nextBtnText: 'Avanti',
            prevBtnText: 'Indietro',
            doneBtnText: 'Fine',
            progressText: '{{current}} di {{total}}',
            steps: availableSteps,
            overlayColor: isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.7)',
            onDestroyStarted: () => {
                markTourComplete(tourType);
                options.onComplete?.(tourType);
                driverRef.current?.destroy();
            },
            onDestroyed: () => {
                driverRef.current = null;
            }
        });

        driverRef.current.drive();
    }, [options, markTourComplete]);

    // Stop tour programmatically
    const stopTour = useCallback(() => {
        if (driverRef.current) {
            driverRef.current.destroy();
            driverRef.current = null;
        }
    }, []);

    // Try to start a contextual tour if not seen
    const tryStartTour = useCallback((tourType: TourType) => {
        if (!hasSeenTour(tourType)) {
            // Small delay to ensure DOM is ready
            setTimeout(() => startTour(tourType), 300);
        }
    }, [hasSeenTour, startTour]);

    return {
        startTour,
        stopTour,
        resetTour,
        hasSeenTour,
        tryStartTour,
        isActive: () => driverRef.current?.isActive() ?? false,
    };
}

// Re-export types for consumers
export type { TourType };
