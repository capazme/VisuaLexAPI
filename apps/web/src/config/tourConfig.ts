/**
 * Tour Configuration
 *
 * Configurazione centralizzata per il sistema di onboarding/tour.
 * 12 tour totali: 6 per pagina + 6 contestuali per feature.
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
    forum: 'forum',
    // Feature tours
    commandPalette: 'commandPalette',
    studyMode: 'studyMode',
    treeView: 'treeView',
    practice: 'practice',
    practiceAct: 'practiceAct',
    quickNorms: 'quickNorms',
} as const;

export type TourType = keyof typeof TOUR_KEYS;

// ==================== PAGE TOURS ====================

/**
 * Welcome Tour - Prima visita assoluta (4 step)
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
        element: '#tour-section-switcher',
        popover: {
            title: 'Le sezioni',
            description: 'Da questa icona passi da una sezione all\'altra: Opus per il lavoro, Gymnasium per lo studio, il Forum per la comunità. La barra laterale cambia con la sezione.',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-sidebar',
        popover: {
            title: 'Navigazione Principale',
            description: 'In ogni sezione trovi in cima la Ricerca e l\'analisi di un documento; sotto, gli strumenti della sezione, come i Dossier in Opus o Oggi e Le mie schede in Gymnasium. La Cronologia è nel menu del tuo profilo, in basso.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-nav-search',
        popover: {
            title: 'Inizia a Cercare',
            description: 'Ricerca ti porta al campo di ricerca, sempre in cima alla pagina. Da qualsiasi pagina, Cmd+K (Mac) o Ctrl+K (Windows) apre la ricerca veloce. Prova subito!',
            side: 'right',
            align: 'start',
        }
    }
];

/**
 * Search Page Tour - Panoramica ricerca (4 step)
 *
 * Parte sulla pagina di ricerca, che alla prima visita è vuota: i passi puntano a ciò che la
 * pagina mostra allora (il campo di ricerca in cima, la voce Ricerca, le norme preferite). Il tavolo di
 * lavoro ha i suoi tour (`practice`, `practiceAct`).
 */
export const SEARCH_STEPS: DriveStep[] = [
    {
        element: '#tour-search-field',
        popover: {
            title: 'Cerca una Norma',
            description: 'Scrivi qui una citazione naturale, come "art. 2043 cc" o "Cass. civ. 10787/2024", e premi Invio: non serve compilare dei campi. Il campo resta sempre in cima alla pagina, e ogni risultato finisce sul tavolo di una pratica.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-nav-search',
        popover: {
            title: 'Ricerca e Cmd+K',
            description: 'Ricerca riporta al campo. Preferisci la tastiera? Cmd+K (Ctrl+K) apre la ricerca veloce da qualsiasi pagina, con filtri, alias e tutti gli atti.',
            side: 'right',
            align: 'start',
        }
    },
    {
        element: '#tour-quick-norms',
        popover: {
            title: 'Norme Preferite',
            description: 'Le ricerche che ripeti spesso vengono salvate qui per un accesso rapido con un solo click.',
            side: 'top',
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
 * Dossier Page Tour - Gestione raccolte (8 step)
 *
 * Si muove solo sulla list view: gli step che toccavano dettaglio (pin,
 * stats, items, export) puntavano a DOM id che non esistono qui e
 * restavano orfani. L'ultimo step invita l'utente a entrare in un
 * dossier per scoprire gestione elementi e strumenti.
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
            description: 'Clicca qui per creare un dossier e assegnare titolo, descrizione e tag. Scorciatoia tastiera: <kbd>n</kbd>.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-dossier-search',
        popover: {
            title: 'Cerca nei Dossier',
            description: 'Cerca per titolo, descrizione o contenuto. Scorciatoia tastiera: <kbd>/</kbd> per mettere a fuoco il campo.',
            side: 'bottom',
            align: 'center',
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
        element: '#tour-dossier-filters',
        popover: {
            title: 'Filtra per categoria',
            description: 'Scegli una categoria dal menu per vedere solo i dossier che la portano; «Tutte le categorie» li mostra di nuovo tutti.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        element: '#tour-dossier-card',
        popover: {
            title: 'Card Dossier',
            description: 'Ogni card mostra titolo, tag, quante norme e note contiene e l\'ultimo aggiornamento. Clicca per aprire.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-dossier-card-actions',
        popover: {
            title: 'Azioni Rapide sulla Card',
            description: 'L\'icona <kbd>↗</kbd> apre direttamente tutte le norme del dossier sulla Dashboard senza entrare. Il menu <kbd>⋯</kbd> gestisce rinomina, apertura e eliminazione.',
            side: 'left',
            align: 'center',
        }
    },
    {
        popover: {
            title: 'Gestione dettagliata',
            description: 'Entra in un dossier (clic sulla card) per leggere gli articoli sul posto, riordinare gli elementi, selezionarne in blocco, esportare in PDF/JSON o condividere un link. Buon lavoro!',
            side: 'over',
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
 * Forum Page Tour - «Dossier pubblici», the community's dossiers di studio (6 step)
 *
 * Introduced ex novo when the page was renamed from Bacheca to Forum.
 * List-view-only: steps anchor on the Publish CTA, the tab nav, the
 * explore filters, the first card, and the card's 3-dot menu. The
 * `isFirst` prop on SharedEnvironmentCard marks the first card in the
 * grid with `#tour-forum-card` + `#tour-forum-actions` to avoid
 * duplicate DOM ids.
 */
export const FORUM_STEPS: DriveStep[] = [
    {
        popover: {
            title: 'Dossier pubblici',
            description: 'I dossier di studio pubblicati dalla comunità: aggiungili ai tuoi dossier, pubblica i tuoi e suggerisci contenuti agli altri. In cima trovi i dossier di studio pronti di VisuaLex.',
            side: 'over',
            align: 'center',
        }
    },
    {
        element: '#tour-forum-publish',
        popover: {
            title: 'Pubblica un dossier',
            description: 'Scegli uno dei tuoi dossier: vedi l\'anteprima di ciò che diventa pubblico, togli le note che vuoi tenere per te e conferma di aver controllato che non contenga dati personali.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        element: '#tour-forum-tabs',
        popover: {
            title: 'Tre sezioni',
            description: 'Esplora la comunità, gestisci i dossier che hai pubblicato (I miei pubblicati, con l\'archivio dei vecchi ambienti) e rivedi i suggerimenti ricevuti o inviati.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '#tour-forum-filters',
        popover: {
            title: 'Cerca e filtra',
            description: 'Cerca per titolo o descrizione, filtra per categoria (la stripe a sinistra delle card riflette la categoria) e ordina per data, popolarità o aggiunte.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-forum-card',
        popover: {
            title: 'Un dossier pubblicato',
            description: 'Categoria, versione, statistiche («Mi piace», aggiunte, visualizzazioni), autore e data di aggiornamento. «Ai miei dossier» lo aggiunge ai tuoi come dossier di studio.',
            side: 'right',
            align: 'center',
        }
    },
    {
        element: '#tour-forum-actions',
        popover: {
            title: 'Altre azioni',
            description: 'Dal menu ··· suggerisci contenuti all\'autore o segnala il dossier. Sui tuoi trovi modifica, versioni, ritira ed elimina.',
            side: 'left',
            align: 'center',
        }
    }
];

// ==================== FEATURE TOURS ====================

/**
 * Command Palette Tour - Ricerca veloce (3 step)
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
 * Study Mode Tour - Lettura immersiva (7 step)
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
        element: '#study-mode-article-body',
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
            description: 'Note ed evidenziazioni: seleziona il testo e scegli un colore, o aggiungi un\'annotazione personale. Vengono salvate automaticamente e le ritrovi anche fuori dalla modalità studio.',
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
 * Tree View Tour - Struttura documento (3 step)
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
        element: '#tour-tree-structure',
        popover: {
            title: 'Navigazione Gerarchica',
            description: 'Espandi le sezioni per vedere i contenuti. La struttura riflette l\'organizzazione ufficiale della norma.',
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
 * Practice Tour - Il tavolo di lavoro (4 step)
 *
 * Parte la prima volta che una pratica è sul tavolo (PracticeTable); al termine parte quello
 * dell'atto.
 */
export const PRACTICE_STEPS: DriveStep[] = [
    {
        element: '#tour-practice-bar',
        popover: {
            title: 'Le Pratiche',
            description: 'Ogni pratica è un tavolo di lavoro con le norme e le sentenze di una questione. Qui passi dall\'una all\'altra, ne apri una nuova e le riordini trascinando.',
            side: 'top',
            align: 'center',
        }
    },
    {
        element: '#tour-practice-header',
        popover: {
            title: 'Il Tavolo',
            description: 'Il nome della pratica (doppio clic per cambiarlo), quanto contiene e il menu delle azioni. Le ricerche e gli articoli che apri finiscono qui.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '#tour-practice-save',
        popover: {
            title: 'Salva come Dossier',
            description: 'Trasforma il tavolo in un dossier: gli articoli e le sentenze restano al loro posto, con il testo che stavi leggendo.',
            side: 'bottom',
            align: 'end',
        }
    },
    {
        element: '.practice-act',
        popover: {
            title: 'Un Atto sul Tavolo',
            description: 'Le norme sono raggruppate per atto, con i suoi articoli in fila: aprine uno per leggerlo qui, sul posto.',
            side: 'top',
            align: 'start',
        }
    }
];

/**
 * Practice Act Tour - Esplorazione di un atto (6 step)
 */
export const PRACTICE_ACT_STEPS: DriveStep[] = [
    {
        element: '.practice-act-head',
        popover: {
            title: 'Intestazione dell\'Atto',
            description: 'Tipo, numero e data dell\'atto. Clicca per comprimerlo, trascina la maniglia per riordinare, usa il menu per spostarlo in un\'altra pratica o toglierlo.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.practice-act-index',
        popover: {
            title: 'Gli Articoli sul Tavolo',
            description: 'Un chip per ogni articolo caricato: cliccalo per aprire e raggiungere la riga. Con le frecce scorri anche quelli non ancora caricati.',
            side: 'bottom',
            align: 'start',
        }
    },
    {
        element: '.practice-row-beside',
        popover: {
            title: 'Apri Accanto',
            description: 'Leggi un articolo o una sentenza in una finestra accanto al tavolo, per confrontarli senza perdere il posto. Se ne aprono due alla volta.',
            side: 'left',
            align: 'center',
        }
    },
    {
        element: '.practice-act-study',
        popover: {
            title: 'Modalità Studio',
            description: 'Lettura immersiva a schermo intero con opzioni di tipografia e presa appunti.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.practice-act-structure',
        popover: {
            title: 'Struttura Atto',
            description: 'Visualizza l\'indice completo con titoli, capi e sezioni. Clicca un articolo per caricarlo sul tavolo.',
            side: 'bottom',
            align: 'center',
        }
    },
    {
        element: '.glass-toolbar',
        popover: {
            title: 'Barra Strumenti',
            description: 'In una riga aperta: note personali, evidenziatore, glosse, ricerca nel testo, copia, esportazione e altro.',
            side: 'bottom',
            align: 'center',
        }
    }
];

/**
 * Quick Norms Tour - Norme preferite (3 step)
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
        element: '#tour-qn-add',
        popover: {
            title: 'Aggiungi Norma',
            description: 'Parti da una ricerca o compila i campi a mano, dai un nome e salva: la ricerca resta a un click.',
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
];

// ==================== STEPS MAP ====================
export const TOUR_STEPS_MAP: Record<TourType, DriveStep[]> = {
    // Page tours
    welcome: WELCOME_STEPS,
    search: SEARCH_STEPS,
    dossier: DOSSIER_STEPS,
    history: HISTORY_STEPS,
    forum: FORUM_STEPS,
    // Feature tours
    commandPalette: COMMAND_PALETTE_STEPS,
    studyMode: STUDY_MODE_STEPS,
    treeView: TREE_VIEW_STEPS,
    practice: PRACTICE_STEPS,
    practiceAct: PRACTICE_ACT_STEPS,
    quickNorms: QUICK_NORMS_STEPS,
};

// ==================== UI STRINGS ====================
export const TOUR_UI = {
    nextBtnText: 'Avanti',
    prevBtnText: 'Indietro',
    doneBtnText: 'Fine',
    progressText: '{{current}} di {{total}}',
} as const;
