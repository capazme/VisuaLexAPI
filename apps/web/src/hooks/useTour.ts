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

// ==================== ONE TOUR AT A TIME ====================

// Two components can ask for a tour in the same moment (the table's, the act's): a second overlay
// over the first is worse than a missed tour. The driver on screen, if any, is module-wide.
let onScreen: Driver | null = null;

// A first-run screen that must be answered (the MERL-T consent) holds every tour: a tour asked
// meanwhile is not started (it is asked again the next time its surface mounts, unseen).
let held = false;

/**
 * The layout a width draws (the phone's, the rail's, the sidebar's): a tour started in one is closed when the window
 * passes to another (Y1: from 1920 to 390 the veil stayed at its old size, over a page laid out anew). Closed, not
 * done: it is asked again the next time its surface mounts.
 */
const layoutBand = (width: number) => (width < 768 ? 0 : width < 1024 ? 1 : 2);

/** The last input was a key (a tour opened by the keyboard shows its focus ring; one opened by itself or a click not). */
let keyboardLast = false;
let watchingInput = false;
function watchInput(): void {
    if (watchingInput || typeof window === 'undefined') return;
    watchingInput = true;
    window.addEventListener('keydown', () => { keyboardLast = true; }, true);
    window.addEventListener('pointerdown', () => { keyboardLast = false; }, true);
}

/** A focus driver.js gives its popover's button with no key pressed shows no ring (`data-pointer-focus`, `index.css`)
 *  until it leaves: the ✕ drew the focus square after a click (Y1). */
function quietFocus(target: EventTarget | null): void {
    if (keyboardLast || !(target instanceof HTMLElement)) return;
    target.setAttribute('data-pointer-focus', '');
    target.addEventListener('blur', () => target.removeAttribute('data-pointer-focus'), { once: true });
}

export function holdTours(hold: boolean): void {
    held = hold;
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

        // Another component's tour is on screen, or a screen holds them all: this one is not
        // started over it (its caller asks again the next time it mounts, a tour not seen stays unseen).
        if (held) return;
        if (onScreen?.isActive() && onScreen !== driverRef.current) return;

        // Destroy this hook's own existing tour
        if (driverRef.current) {
            driverRef.current.destroy();
        }

        watchInput();
        // A tour starts on its own (a surface mounted, a delay): the keys typed before it say nothing of how its first
        // focus came; a key pressed in the tour shows the ring again.
        keyboardLast = false;
        const band = layoutBand(window.innerWidth);
        // Cheap enough at every resize event (a width and one element's rectangles); driver.js redraws the rest itself.
        const onResize = () => {
            const tour = driverRef.current;
            if (!tour?.isActive()) return;
            const element = tour.getActiveElement();
            const gone = element && element.id !== 'driver-dummy-element' && (!element.isConnected || element.getClientRects().length === 0);
            // `destroy` closes it without `onDestroyStarted`: not marked as seen.
            if (layoutBand(window.innerWidth) !== band || gone) tour.destroy();
        };
        window.addEventListener('resize', onResize);
        const stopWatchingLayout = () => window.removeEventListener('resize', onResize);

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
            onPopoverRender: (popover) => {
                popover.closeButton.setAttribute('aria-label', TOUR_UI.closeBtnLabel);
                popover.wrapper.addEventListener('focusin', (event) => quietFocus(event.target));
                if (popover.wrapper.contains(document.activeElement)) quietFocus(document.activeElement);
            },
            onDestroyStarted: () => {
                markTourComplete(tourType);
                options.onComplete?.(tourType);
                driverRef.current?.destroy();
            },
            onDestroyed: () => {
                stopWatchingLayout();
                if (onScreen === driverRef.current) onScreen = null;
                driverRef.current = null;
            }
        });

        onScreen = driverRef.current;
        driverRef.current.drive();
    }, [options, markTourComplete, disableOnMobile]);

    // Reset all tours and immediately start the welcome tour.
    // Declared after startTour so it isn't referenced before declaration.
    const resetAndStartTour = useCallback((tourType: TourType = 'welcome'): void => {
        resetTour(tourType);
        // Small delay to ensure state is saved
        setTimeout(() => startTour(tourType), 100);
    }, [resetTour, startTour]);

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
            // Small delay to ensure DOM is ready; seen again when it fires, for a tour completed meanwhile
            setTimeout(() => {
                if (!hasSeenTour(tourType)) startTour(tourType);
            }, 300);
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
