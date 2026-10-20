import { flushSync } from 'react-dom';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { guardedStorage } from '../../utils/guardedStorage';
import { useDevMode } from '../devMode/useDevMode';
import { isStudiaEnabled } from '../studia/featureFlag';
import type { DossierKind } from '../../types';
import { SECTIONS, sectionForPath, type Section, type SectionId } from './sections';
import { playSectionTransition, sectionHue } from './sectionTransition';

/**
 * The last section the user was in, kept in the browser (spec S1): no migration, and a new device
 * starts in Opus (S2). A store, not component state: the sidebar is mounted twice (desktop and
 * phone) and the dossier page reads it too. A write the browser refuses (full or blocked storage) is
 * logged and the choice holds for the session; a read that fails leaves the default.
 */
export const sectionStore = create<{
  section: SectionId;
  /** The kind of the last of Opus and Gymnasium: the dossiers `/dossier` lists from any section (S7). */
  dossierKind: DossierKind;
  setSection: (section: SectionId) => void;
}>()(
  persist(
    (set) => ({
      section: 'opus',
      dossierKind: 'lavoro',
      setSection: (section) =>
        set(section === 'opus' ? { section, dossierKind: 'lavoro' } : section === 'gymnasium' ? { section, dossierKind: 'studio' } : { section }),
    }),
    {
      name: 'visualex-section',
      storage: createJSONStorage(() =>
        guardedStorage(localStorage, ({ error }) => console.warn('[sections] the section could not be saved in the browser', error)),
      ),
    },
  ),
);

/**
 * The kind of dossier the section shows (S7): di lavoro in Opus, di studio in Gymnasium, and from
 * Academia or the Forum the last of the two. Null without Gymnasium (`VITE_FEATURE_STUDIA` off): then
 * every dossier is listed, or the study ones could not be reached.
 */
export function useDossierKind(): DossierKind | null {
  const kind = sectionStore((s) => s.dossierKind);
  return isStudiaEnabled() ? kind : null;
}

/** A dossier opened by its address takes the user to its kind's section (S7). */
export function showSectionOfDossier(kind: DossierKind | undefined) {
  if (isStudiaEnabled()) sectionStore.getState().setSection(kind === 'studio' ? 'gymnasium' : 'opus');
}

/** The sections this user can enter: Academia with the development mode (S12), Gymnasium with its flag. */
function availableSections(devMode: boolean): Section[] {
  return SECTIONS.filter((s) => (s.id !== 'academia' || devMode) && (s.id !== 'gymnasium' || isStudiaEnabled()));
}

/** The section change on screen, if one is: a second choice brings it to its end first. */
let finishRunning: (() => void) | null = null;

export function useSection() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const devMode = useDevMode();
  const stored = sectionStore((s) => s.section);
  const setSection = sectionStore((s) => s.setSection);
  const fromPath = sectionForPath(pathname);

  // A page of one section makes it the last one, so the Corpus pages after it keep it.
  useEffect(() => {
    if (fromPath) setSection(fromPath);
  }, [fromPath, setSection]);

  const sections = availableSections(devMode);
  const wanted = fromPath ?? stored;
  const section = sections.some((s) => s.id === wanted) ? wanted : 'opus';

  /** `origin`: where the tap was, in the viewport; the halftone prints from there. */
  const chooseSection = (id: SectionId, origin: { x: number; y: number } | null = null) => {
    finishRunning?.();
    finishRunning = null;
    const go = () => {
      setSection(id);
      navigate(SECTIONS.find((s) => s.id === id)!.home);
    };
    // The section's own home again: no change of section to show.
    if (id === section) {
      go();
      return;
    }
    // By hand under the colour: the app's BrowserRouter ignores navigate's `viewTransition` option, which needs a
    // data router, and the new page must be there before the screen lets it through.
    finishRunning = playSectionTransition({ origin, color: sectionHue(id), swap: () => flushSync(go) });
  };

  return { section, active: SECTIONS.find((s) => s.id === section)!, sections, chooseSection };
}
