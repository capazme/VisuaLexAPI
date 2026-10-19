import type { EnvironmentCategory } from '../types';

/** The Forum's categories, one list for every screen (spec 2026-10-13-environments-into-forum, D13). */
export const FORUM_CATEGORIES: ReadonlyArray<{ value: EnvironmentCategory; label: string }> = [
  { value: 'compliance', label: 'Compliance' },
  { value: 'civil', label: 'Civile' },
  { value: 'penal', label: 'Penale' },
  { value: 'administrative', label: 'Amministrativo' },
  { value: 'eu', label: 'UE' },
  { value: 'other', label: 'Altro' },
];
