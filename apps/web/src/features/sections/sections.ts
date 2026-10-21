import { Briefcase, GraduationCap, Landmark, Users, type LucideIcon } from 'lucide-react';

/** The four sections over the common core, Corpus (D-076; spec 2026-10-18-sections-switcher). */
export type SectionId = 'opus' | 'gymnasium' | 'academia' | 'forum';

export interface Section {
  id: SectionId;
  /** The short name, «Gymnasium»; the full one is «VisuaLex Gymnasium» (S11). */
  name: string;
  /** The line under the name in the switcher (S3). */
  line: string;
  icon: LucideIcon;
  /** Where choosing the section leads (S4). */
  home: string;
  /** The name of that page, in the split button's «Vai a Gymnasium: Oggi» (S6). */
  homeName: string;
}

export const SECTIONS: readonly Section[] = [
  { id: 'opus', name: 'Opus', line: 'Dossier di lavoro e strumenti per la professione', icon: Briefcase, home: '/dossier', homeName: 'Dossier' },
  { id: 'gymnasium', name: 'Gymnasium', line: 'Schede, ripasso, esami e concorsi', icon: GraduationCap, home: '/studia/ripasso', homeName: 'Oggi' },
  { id: 'academia', name: 'Academia', line: 'Grafo, feedback e validazione', icon: Landmark, home: '/merlt', homeName: 'Assistente' },
  { id: 'forum', name: 'Forum', line: 'Dossier pubblici e community', icon: Users, home: '/forum', homeName: 'Dossier pubblici' },
];

/** The sections' titles with their phrase («Nome: …»), chosen by the owner on 19 October 2026; the one place to change
 *  them. The Forum's is the Community page's `h1`; Opus's is not shown yet: its page takes it in its own change. */
export const SECTION_TITLES = {
  forum: 'Forum: il luogo del dibattito giuridico',
  opus: 'Opus: la tua officina giuridica',
} as const satisfies Partial<Record<SectionId, string>>;

/**
 * The code of a section's home where it is loaded on demand (`App.tsx`'s `lazy` routes): fetched when the switcher
 * opens, so the change (T1) finds the page there instead of fading into «Caricamento…». The same modules as the
 * routes', so the same files.
 */
export const SECTION_HOME_CODE: Partial<Record<SectionId, () => Promise<unknown>>> = {
  gymnasium: () => Promise.all([import('../../components/features/studia/StudiaPage'), import('../../components/features/studia/ReviewHome')]),
  academia: () => import('../../pages/MerltHubPage'),
};

/** The split button's left part (S6): «Vai a Gymnasium: Oggi», «Vai ad Academia: Assistente». */
export const goToLabel = (section: Section) => `Vai ${section.name.startsWith('A') ? 'ad' : 'a'} ${section.name}: ${section.homeName}`;

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/** The section a page belongs to, or null for a Corpus page, which keeps the last section (S1). */
export function sectionForPath(pathname: string): SectionId | null {
  if (under(pathname, '/studia')) return 'gymnasium';
  if (under(pathname, '/forum')) return 'forum';
  if (under(pathname, '/merlt') || under(pathname, '/grafo')) return 'academia';
  return null;
}
