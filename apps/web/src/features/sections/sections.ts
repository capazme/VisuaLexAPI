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
}

export const SECTIONS: readonly Section[] = [
  { id: 'opus', name: 'Opus', line: 'Dossier di lavoro e strumenti per la professione', icon: Briefcase, home: '/dossier' },
  { id: 'gymnasium', name: 'Gymnasium', line: 'Schede, ripasso, esami e concorsi', icon: GraduationCap, home: '/studia/ripasso' },
  { id: 'academia', name: 'Academia', line: 'Grafo, feedback e validazione', icon: Landmark, home: '/merlt' },
  { id: 'forum', name: 'Forum', line: 'Glosse e dossier condivisi', icon: Users, home: '/forum' },
];

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/** The section a page belongs to, or null for a Corpus page, which keeps the last section (S1). */
export function sectionForPath(pathname: string): SectionId | null {
  if (under(pathname, '/studia')) return 'gymnasium';
  if (under(pathname, '/forum')) return 'forum';
  if (under(pathname, '/merlt') || under(pathname, '/grafo')) return 'academia';
  return null;
}
