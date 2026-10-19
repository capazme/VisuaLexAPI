import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const account = vi.hoisted(() => ({ devMode: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ devMode: account.devMode }) }));

import { sectionForPath } from './sections';
import { sectionStore, useSection } from './useSection';

function render(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  return renderHook(() => ({ ...useSection(), pathname: useLocation().pathname }), { wrapper });
}

beforeEach(() => {
  account.devMode = false;
  sectionStore.setState({ section: 'opus', dossierKind: 'lavoro' });
  vi.unstubAllEnvs();
});

describe('sectionForPath (spec S1)', () => {
  it.each([
    ['/studia', 'gymnasium'],
    ['/studia/ripasso/sessione', 'gymnasium'],
    ['/forum', 'forum'],
    ['/forum/community', 'forum'],
    ['/merlt', 'academia'],
    ['/merlt/valida', 'academia'],
    ['/grafo', 'academia'],
  ])('%s belongs to %s', (path, section) => expect(sectionForPath(path)).toBe(section));

  it.each(['/', '/dossier', '/documents', '/history', '/collega-app', '/sentenze/cass/1/2024', '/studiare', '/forums'])(
    '%s is a Corpus page, of no section',
    (path) => expect(sectionForPath(path)).toBeNull(),
  );
});

describe('useSection', () => {
  it('starts in Opus with nothing stored (S2)', () => {
    expect(render('/').result.current.section).toBe('opus');
  });

  it('takes the section from a page of one section, and keeps it on the Corpus pages after it (S1)', () => {
    render('/forum');
    expect(sectionStore.getState().section).toBe('forum');
    expect(render('/dossier').result.current.section).toBe('forum');
  });

  it('offers Academia only with the development mode, and falls back to Opus without it (S12)', () => {
    sectionStore.setState({ section: 'academia' });
    const off = render('/');
    expect(off.result.current.sections.map((s) => s.id)).toEqual(['opus', 'gymnasium', 'forum']);
    expect(off.result.current.section).toBe('opus');
    account.devMode = true;
    const on = render('/');
    expect(on.result.current.sections.map((s) => s.id)).toEqual(['opus', 'gymnasium', 'academia', 'forum']);
    expect(on.result.current.section).toBe('academia');
  });

  it('leaves Gymnasium out when VITE_FEATURE_STUDIA is off', () => {
    vi.stubEnv('VITE_FEATURE_STUDIA', 'false');
    sectionStore.setState({ section: 'gymnasium' });
    const { result } = render('/');
    expect(result.current.sections.map((s) => s.id)).toEqual(['opus', 'forum']);
    expect(result.current.section).toBe('opus');
  });

  it('switches section when the browser refuses to save it (full or blocked storage)', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = render('/');
      act(() => result.current.chooseSection('forum'));
      expect(result.current.pathname).toBe('/forum');
      expect(result.current.section).toBe('forum');
      expect(warn).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }
  });

  it('keeps the kind of the last of Opus and Gymnasium for the dossiers, through Academia and the Forum (S7)', () => {
    const { result } = render('/');
    act(() => result.current.chooseSection('gymnasium'));
    act(() => result.current.chooseSection('forum'));
    expect(sectionStore.getState().dossierKind).toBe('studio');
    act(() => result.current.chooseSection('opus'));
    expect(sectionStore.getState().dossierKind).toBe('lavoro');
  });

  it("stores a choice and goes to the section's page (S4)", () => {
    const { result } = render('/');
    act(() => result.current.chooseSection('gymnasium'));
    expect(sectionStore.getState().section).toBe('gymnasium');
    expect(result.current.pathname).toBe('/studia/ripasso');
    act(() => result.current.chooseSection('opus'));
    expect(result.current.pathname).toBe('/dossier');
  });
});
