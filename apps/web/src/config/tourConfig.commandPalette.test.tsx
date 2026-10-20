import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { CommandPalette } from '../components/features/search/CommandPalette';
import { appStore } from '../store/useAppStore';
import { COMMAND_PALETTE_STEPS } from './tourConfig';

/**
 * The palette's tour, against the palette drawn: a target written in the source can still be missing from
 * the page — cmdk replaces an id given to `Command.List` with its own, and `#command-palette-results`
 * highlighted nothing.
 */
function asDesktop(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: desktop, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the palette\'s tour on the palette', () => {
  it.each([['a computer', true], ['a phone', false]])('finds every step\'s element on %s, with no favourite yet', (_, desktop) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ presets: {}, known_acts: [] }) })));
    appStore.setState({ quickNorms: [], customAliases: [] });
    asDesktop(desktop);
    render(<CommandPalette isOpen onClose={vi.fn()} onSearch={vi.fn()} />);

    const targets = COMMAND_PALETTE_STEPS.map((s) => s.element).filter((e): e is string => typeof e === 'string');
    expect(targets).toHaveLength(COMMAND_PALETTE_STEPS.length);
    for (const selector of targets) expect(document.querySelector(selector), selector).not.toBeNull();
  });
});
