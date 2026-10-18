import type { MerltConsentLevel } from '../merltConsent';

/** The three MERL-T consent levels as the consent screen, the dialog and Impostazioni name them. */
export interface LevelMeta {
  level: MerltConsentLevel;
  title: string;
  summary: string;
}

export const CONSENT_LEVELS: LevelMeta[] = [
  {
    level: 'none',
    title: 'Nessuna raccolta',
    summary: 'MERL-T non riceve nulla della tua attività. Tutto il resto di VisuaLex funziona come prima.',
  },
  {
    level: 'basic',
    title: 'Base',
    summary:
      'Le tue letture, evidenziazioni, note (mai il loro testo), segnalibri, citazioni aperte, segnali del Forum e le domande all’assistente.',
  },
  {
    level: 'full',
    title: 'Completo',
    summary:
      'In più i tuoi giudizi, le citazioni con il testo intorno, i documenti, le proposte e i voti per il grafo.',
  },
];

export const LEVEL_LABEL: Record<MerltConsentLevel, string> = {
  none: 'Nessuna raccolta',
  basic: 'Base',
  full: 'Completo',
};
