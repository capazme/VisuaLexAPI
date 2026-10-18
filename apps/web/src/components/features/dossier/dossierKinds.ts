import { Briefcase, BookOpen } from 'lucide-react';
import type { DossierKind } from '../../../types';

/** The two kinds of dossier and what each is for (spec 2026-10-13-environments-into-forum, D1-D2). */
export const DOSSIER_KINDS: ReadonlyArray<{ kind: DossierKind; label: string; hint: string; icon: typeof Briefcase }> = [
  { kind: 'lavoro', label: 'Di lavoro', hint: 'Per una pratica: può contenere dati dei clienti.', icon: Briefcase },
  { kind: 'studio', label: 'Di studio', hint: 'Per studiare un tema: norme, sentenze e note da riprendere.', icon: BookOpen },
];

/** «Dossier di lavoro» / «Dossier di studio»: a dossier with no kind is di lavoro. */
export const kindLabel = (kind: DossierKind | undefined): string => (kind === 'studio' ? 'Dossier di studio' : 'Dossier di lavoro');
