import type { Materia } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';

/** The subject chosen last on this browser, shared by «Oggi» and «Progressi»: one choice for the area. */
const STORAGE_KEY = 'visualex.studia.ripasso.materia';
const MATERIE = Object.keys(MATERIA_LABEL) as Materia[];

/** A missing, unreadable or unknown value is «all subjects». */
export function rememberedMateria(): Materia | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MATERIE.find((materia) => materia === stored);
  } catch {
    return undefined;
  }
}

export function rememberMateria(materia: Materia | undefined): void {
  try {
    if (materia) localStorage.setItem(STORAGE_KEY, materia);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or a full store: the choice lasts for this visit only.
  }
}
