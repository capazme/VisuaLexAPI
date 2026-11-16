/**
 * The first-run guide's keys and storage.
 *
 * Version 3 (consulenza anti-slop, 16 Nov 2026, Luca: «Il wizard guida iniziale … è veramente orribile»): the eleven
 * driver.js popover tours (53 steps, one per page and feature) give way to one guide of two pages, `WelcomeGuide`.
 * The other keys stay because their pages still ask for them (`tryStartTour('dossier')`, …); they show nothing.
 */
export const TOUR_VERSION = 3;

export const TOUR_STORAGE_KEY = 'visualex_tour';

export const TOUR_KEYS = {
    welcome: 'welcome',
    search: 'search',
    dossier: 'dossier',
    history: 'history',
    forum: 'forum',
    commandPalette: 'commandPalette',
    studyMode: 'studyMode',
    treeView: 'treeView',
    practice: 'practice',
    practiceAct: 'practiceAct',
    quickNorms: 'quickNorms',
} as const;

export type TourType = keyof typeof TOUR_KEYS;
