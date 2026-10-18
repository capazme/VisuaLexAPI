import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { guardedStorage } from '../../utils/guardedStorage';
import { useDevMode } from '../devMode/useDevMode';
import { isStudiaEnabled } from '../studia/featureFlag';
import { SECTIONS, sectionForPath, type Section, type SectionId } from './sections';

/**
 * The last section the user was in, kept in the browser (spec S1): no migration, and a new device
 * starts in Opus (S2). A store, not component state: the sidebar is mounted twice (desktop and
 * phone) and the dossier page reads it too. A write the browser refuses (full or blocked storage) is
 * logged and the choice holds for the session; a read that fails leaves the default.
 */
export const sectionStore = create<{ section: SectionId; setSection: (section: SectionId) => void }>()(
  persist((set) => ({ section: 'opus', setSection: (section) => set({ section }) }), {
    name: 'visualex-section',
    storage: createJSONStorage(() =>
      guardedStorage(localStorage, ({ error }) => console.warn('[sections] the section could not be saved in the browser', error)),
    ),
  }),
);

/** The sections this user can enter: Academia with the development mode (S12), Gymnasium with its flag. */
function availableSections(devMode: boolean): Section[] {
  return SECTIONS.filter((s) => (s.id !== 'academia' || devMode) && (s.id !== 'gymnasium' || isStudiaEnabled()));
}

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

  const chooseSection = (id: SectionId) => {
    setSection(id);
    navigate(SECTIONS.find((s) => s.id === id)!.home);
  };

  return { section, active: SECTIONS.find((s) => s.id === section)!, sections, chooseSection };
}
