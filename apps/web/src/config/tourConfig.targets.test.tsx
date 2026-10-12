import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/features/search/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../components/features/search/QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../components/features/settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('../components/features/search/ReadingBackControl', () => ({ ReadingBackControl: () => null }));

import { appStore } from '../store/useAppStore';
import { SearchPanel } from '../components/features/search/SearchPanel';
import { SEARCH_STEPS, TOUR_KEYS, TOUR_STEPS_MAP } from './tourConfig';

// The sources of the app (not the tests, not the tour configuration): where a tour's target must be written.
const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.*', '!../config/tourConfig.ts', '!../test/**'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const corpus = Object.values(sources).join('\n');

// What a library draws, not the app: no source of ours names it.
const LIBRARY = new Set(['[cmdk-input]']);

describe('every tour points at something the app draws', () => {
  it('has a step list for every key, and no key without steps', () => {
    expect(Object.keys(TOUR_STEPS_MAP).sort()).toEqual(Object.keys(TOUR_KEYS).sort());
    for (const [key, steps] of Object.entries(TOUR_STEPS_MAP)) expect(steps.length, key).toBeGreaterThan(0);
  });

  it('writes every target in the source of a component (an id, a class)', () => {
    for (const [key, steps] of Object.entries(TOUR_STEPS_MAP)) {
      for (const step of steps) {
        if (typeof step.element !== 'string' || LIBRARY.has(step.element)) continue;
        const token = step.element.replace(/^[#.]/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // the whole word between quotes or spaces (an id, or one class of a list), not a part of a longer name
        expect(new RegExp(`["'\`\\s]${token}["'\`\\s]`).test(corpus), `${key}: ${step.element}`).toBe(true);
      }
    }
  });
});

describe('the search tour on the search page', () => {
  it('every step finds its element on the page a first visit shows (the sidebar\'s is checked with the sidebar)', () => {
    appStore.setState({ practices: [], activePracticeId: null });
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    const targets = SEARCH_STEPS.map((s) => s.element).filter((e): e is string => typeof e === 'string' && !e.startsWith('#tour-nav-'));
    expect(targets.length).toBeGreaterThan(1);
    for (const selector of targets) expect(document.querySelector(selector), selector).not.toBeNull();
  });
});
