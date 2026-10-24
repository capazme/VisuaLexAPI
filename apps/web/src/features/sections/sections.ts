import { Briefcase, GraduationCap, Landmark, Users, type LucideIcon } from 'lucide-react';
import { PAGE_CODE } from '../../pageCode';

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
  { id: 'opus', name: 'Opus', line: 'Dossier di lavoro e strumenti per la professione', icon: Briefcase, home: '/opus/oggi', homeName: 'Oggi' },
  { id: 'gymnasium', name: 'Gymnasium', line: 'Schede, ripasso, esami e concorsi', icon: GraduationCap, home: '/studia/ripasso', homeName: 'Oggi' },
  { id: 'academia', name: 'Academia', line: 'Grafo, feedback e validazione', icon: Landmark, home: '/merlt', homeName: 'Assistente' },
  { id: 'forum', name: 'Forum', line: 'Dossier pubblici e community', icon: Users, home: '/forum', homeName: 'Dossier pubblici' },
];

/**
 * The sections' phrases (the owner's, 19 October 2026); the one place to change them. Since L-37 (the owner, 22 October
 * 2026) a section page's title is the page's name — «Oggi», «Progressi», «Community» — and the phrase goes over it, small,
 * after the section's name: «Gymnasium · la tua palestra giuridica» (`sectionKicker`, drawn by `PageFrame`'s `kicker`).
 */
export const SECTION_PHRASES = {
  gymnasium: 'la tua palestra giuridica',
  opus: 'la tua officina giuridica',
  forum: 'il luogo del dibattito giuridico',
  // Bill and the owner's choice for S7b, 22 October 2026.
  academia: 'il laboratorio del diritto',
} as const satisfies Partial<Record<SectionId, string>>;

/** A section with a phrase. */
export type PhrasedSection = keyof typeof SECTION_PHRASES;

/** The line over a section page's title (L-37): «Opus · la tua officina giuridica». */
export function sectionKicker(id: PhrasedSection): string {
  const name = SECTIONS.find((section) => section.id === id)?.name ?? id;
  return `${name} · ${SECTION_PHRASES[id]}`;
}

/**
 * The line over a page of any section, or nothing for a section with no phrase yet (a new one): its pages pass their
 * `kicker` all the same, and the line appears as soon as its phrase is written above.
 */
export function kickerOf(id: SectionId): string | null {
  return id in SECTION_PHRASES ? sectionKicker(id as PhrasedSection) : null;
}

/**
 * The code of a section's home where it is loaded on demand (`App.tsx`'s `lazy` routes): fetched when the switcher
 * opens, so the change (T1) finds the page there instead of fading into «Caricamento…». The same modules as the
 * routes', so the same files.
 */
export const SECTION_HOME_CODE: Partial<Record<SectionId, () => Promise<unknown>>> = {
  opus: PAGE_CODE.opus,
  forum: PAGE_CODE.forum,
  gymnasium: () => Promise.all([import('../../components/features/studia/StudiaPage'), import('../../components/features/studia/ReviewHome')]),
  academia: () => import('../../pages/MerltHubPage'),
};

/** The split button's left part (S6): «Vai a Gymnasium: Oggi», «Vai ad Academia: Assistente». */
export const goToLabel = (section: Section) => `Vai ${section.name.startsWith('A') ? 'ad' : 'a'} ${section.name}: ${section.homeName}`;

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/** The section a page belongs to, or null for a Corpus page, which keeps the last section (S1). */
export function sectionForPath(pathname: string): SectionId | null {
  if (under(pathname, '/opus')) return 'opus';
  if (under(pathname, '/studia')) return 'gymnasium';
  if (under(pathname, '/forum')) return 'forum';
  if (under(pathname, '/merlt') || under(pathname, '/grafo')) return 'academia';
  return null;
}
