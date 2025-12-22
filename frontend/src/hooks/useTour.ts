import { useCallback, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import {
    TOUR_VERSION,
    TOUR_STORAGE_KEY,
    TOUR_KEYS,
    TOUR_STEPS_MAP,
    TOUR_UI,
    type TourType,
} from '../config/tourConfig';

// ==================== STORAGE HELPERS ====================

interface TourState {
    version: number;
    completed: Record<string, boolean>;
}

function getTourState(): TourState {
    if (typeof window === 'undefined') {
        return { version: TOUR_VERSION, completed: {} };
    }

    try {
        const stored = localStorage.getItem(TOUR_STORAGE_KEY);
        if (!stored) {
            return { version: TOUR_VERSION, completed: {} };
        }

        const state = JSON.parse(stored) as TourState;

        // Version mismatch - reset all tours
        if (state.version !== TOUR_VERSION) {
            console.log(`[Tour] Version changed from ${state.version} to ${TOUR_VERSION}, resetting tours`);
            return { version: TOUR_VERSION, completed: {} };
        }

        return state;
    } catch {
        return { version: TOUR_VERSION, completed: {} };
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

// ==================== MOBILE DETECTION ====================

function isMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ==================== HOOK ====================

interface UseTourOptions {
    theme?: 'light' | 'dark';
    onComplete?: (tourType: TourType) => void;
    disableOnMobile?: boolean;
}

export function useTour(options: UseTourOptions = {}) {
    const { disableOnMobile = true } = options;
    const driverRef = useRef<Driver | null>(null);

    // Check if a specific tour has been completed
    const hasSeenTour = useCallback((tourType: TourType = 'welcome'): boolean => {
        if (typeof window === 'undefined') return true;

        // Skip on mobile if disabled
        if (disableOnMobile && isMobileDevice()) return true;

        const state = getTourState();
        return state.completed[tourType] === true;
    }, [disableOnMobile]);

    // Mark a specific tour as completed
    const markTourComplete = useCallback((tourType: TourType): void => {
        const state = getTourState();
        state.completed[tourType] = true;
        saveTourState(state);
    }, []);

    // Reset a specific tour or all tours
    const resetTour = useCallback((tourType?: TourType): void => {
        const state = getTourState();

        if (tourType) {
            delete state.completed[tourType];
        } else {
            // Reset all tours
            state.completed = {};
        }

        saveTourState(state);
    }, []);

    // Reset all tours and immediately start the welcome tour
    const resetAndStartTour = useCallback((tourType: TourType = 'welcome'): void => {
        resetTour(tourType);
        // Small delay to ensure state is saved
        setTimeout(() => startTour(tourType), 100);
    }, []);

    // Start a specific tour
    const startTour = useCallback((tourType: TourType = 'welcome'): void => {
        // Skip on mobile if disabled
        if (disableOnMobile && isMobileDevice()) {
            console.log('[Tour] Skipped on mobile device');
            return;
        }

        const steps = TOUR_STEPS_MAP[tourType];
        if (!steps || steps.length === 0) return;

        // Filter out steps whose elements don't exist in DOM
        const availableSteps = steps.filter(step => {
            if (!step.element) return true; // Modal steps always show
            const el = document.querySelector(step.element as string);
            return el !== null;
        });

        if (availableSteps.length === 0) {
            console.log(`[Tour] No available steps for ${tourType}`);
            return;
        }

        const isDark = options.theme === 'dark';

        // Destroy any existing tour
        if (driverRef.current) {
            driverRef.current.destroy();
        }

        driverRef.current = driver({
            animate: true,
            showProgress: true,
            showButtons: ['next', 'previous', 'close'],
            nextBtnText: TOUR_UI.nextBtnText,
            prevBtnText: TOUR_UI.prevBtnText,
            doneBtnText: TOUR_UI.doneBtnText,
            progressText: TOUR_UI.progressText,
            steps: availableSteps,
            overlayColor: isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.7)',
            stagePadding: 8, // Padding around highlighted element
            stageRadius: 8, // Border radius of spotlight
            popoverClass: 'visualex-tour-popover',
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
    }, [options, markTourComplete, disableOnMobile]);

    // Stop tour programmatically
    const stopTour = useCallback((): void => {
        if (driverRef.current) {
            driverRef.current.destroy();
            driverRef.current = null;
        }
    }, []);

    // Try to start a contextual tour if not seen
    const tryStartTour = useCallback((tourType: TourType): void => {
        if (!hasSeenTour(tourType)) {
            // Small delay to ensure DOM is ready
            setTimeout(() => startTour(tourType), 300);
        }
    }, [hasSeenTour, startTour]);

    // Get current tour version
    const getTourVersion = useCallback((): number => {
        return TOUR_VERSION;
    }, []);

    return {
        startTour,
        stopTour,
        resetTour,
        resetAndStartTour,
        hasSeenTour,
        tryStartTour,
        getTourVersion,
        isActive: () => driverRef.current?.isActive() ?? false,
        isMobile: isMobileDevice,
    };
}

// Re-export types and keys for consumers
export { TOUR_KEYS, type TourType };
