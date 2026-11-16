import { useCallback } from 'react';
import { TOUR_VERSION, TOUR_STORAGE_KEY, type TourType } from '../config/tourConfig';
import { openWelcomeGuide } from '../features/welcome/welcomeGuideStore';

// ==================== STORAGE HELPERS ====================

interface TourState {
    version: number;
    completed: Record<string, boolean>;
}

function getTourState(): TourState {
    const fresh = { version: TOUR_VERSION, completed: {} };
    if (typeof window === 'undefined') return fresh;
    try {
        const stored = localStorage.getItem(TOUR_STORAGE_KEY);
        if (!stored) return fresh;
        const state = JSON.parse(stored) as TourState;
        // A new version of the guide is shown again once.
        return state.version === TOUR_VERSION ? state : fresh;
    } catch {
        return fresh;
    }
}

function saveTourState(state: TourState): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('[Tour] Failed to save tour state:', e);
    }
}

// A first-run screen that must be answered (the MERL-T consent) holds the guide: asked meanwhile, it is not opened
// (the layout asks again once the screen has gone).
let held = false;

export function holdTours(hold: boolean): void {
    held = hold;
}

// ==================== HOOK ====================

interface UseTourOptions {
    /** Kept for the callers; the guide follows the app's theme by itself. */
    theme?: 'light' | 'dark';
    onComplete?: (tourType: TourType) => void;
    /** Kept for the callers; the guide is drawn on a phone too. */
    disableOnMobile?: boolean;
}

/**
 * The first-run guide (`WelcomeGuide`, two pages) in place of the eleven driver.js popover tours of before. Only the
 * welcome has anything to show: the pages' own tours (`dossier`, `practice`, …) are asked by their surfaces and do
 * nothing, since the pages explain themselves (empty states, labels, the shortcuts sheet).
 */
export function useTour(options: UseTourOptions = {}) {
    const { onComplete } = options;

    const hasSeenTour = useCallback((tourType: TourType = 'welcome'): boolean => {
        if (tourType !== 'welcome') return true;
        if (typeof window === 'undefined') return true;
        return getTourState().completed.welcome === true;
    }, []);

    const markTourComplete = useCallback((tourType: TourType): void => {
        const state = getTourState();
        state.completed[tourType] = true;
        saveTourState(state);
    }, []);

    const resetTour = useCallback((tourType?: TourType): void => {
        const state = getTourState();
        if (tourType) delete state.completed[tourType];
        else state.completed = {};
        saveTourState(state);
    }, []);

    const startTour = useCallback((tourType: TourType = 'welcome'): void => {
        if (tourType !== 'welcome' || held) return;
        openWelcomeGuide(() => {
            markTourComplete('welcome');
            onComplete?.('welcome');
        });
    }, [markTourComplete, onComplete]);

    const prepareTour = useCallback((): void => {}, []);
    const stopTour = useCallback((): void => {}, []);

    const resetAndStartTour = useCallback((tourType: TourType = 'welcome'): void => {
        resetTour(tourType);
        startTour(tourType);
    }, [resetTour, startTour]);

    const tryStartTour = useCallback((tourType: TourType): void => {
        if (!hasSeenTour(tourType)) startTour(tourType);
    }, [hasSeenTour, startTour]);

    const getTourVersion = useCallback((): number => TOUR_VERSION, []);

    return {
        startTour,
        prepareTour,
        stopTour,
        resetTour,
        resetAndStartTour,
        hasSeenTour,
        tryStartTour,
        markTourComplete,
        getTourVersion,
    };
}
