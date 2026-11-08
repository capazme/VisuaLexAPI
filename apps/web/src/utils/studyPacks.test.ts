import { describe, expect, it } from 'vitest';
import { loadStudyPacks, packAlreadyAdded, packContent } from './studyPacks';
import { rebuildNormEntry } from './sources/normEntry';
import type { Dossier } from '../types';

describe('the ready-made study dossiers', () => {
  it('are the twenty packs, each with its dossiers and, where needed, its key articles', async () => {
    const STUDY_PACKS = await loadStudyPacks();
    expect(STUDY_PACKS).toHaveLength(20);
    const gdpr = STUDY_PACKS.find((p) => p.name.startsWith('GDPR'))!;
    expect(gdpr.dossiers.map((d) => d.title)).toEqual([
      'Diritti degli Interessati GDPR', 'Obblighi Informativi', 'Data Breach e Sicurezza', 'GDPR & Privacy Compliance: articoli chiave',
    ]);
    const key = gdpr.dossiers[3];
    // Art. 15 is in a dossier already; art. 5 only among the quick norms.
    const articles = key.items.map((i) => (i.type === 'norma' ? i.data.numero_articolo : ''));
    expect(articles).toContain('5');
    expect(articles).not.toContain('15');
  });

  it('carry only norms the server\'s rule rebuilds, so a pack is never refused', async () => {
    const STUDY_PACKS = await loadStudyPacks();
    for (const pack of STUDY_PACKS) {
      for (const dossier of pack.dossiers) {
        for (const item of dossier.items) {
          expect(item.type).toBe('norma');
          const rebuilt = rebuildNormEntry(item.data);
          expect(rebuilt.ok, `${pack.name} › ${dossier.title}: ${rebuilt.ok ? '' : rebuilt.reason}`).toBe(true);
        }
      }
    }
  });

  it('send their dossiers and nothing else', async () => {
    const STUDY_PACKS = await loadStudyPacks();
    const content = packContent(STUDY_PACKS[0]);
    expect(content.quickNorms).toEqual([]);
    expect(content.dossiers).toBe(STUDY_PACKS[0].dossiers);
  });

  it('are marked as added when a dossier di studio holds each of their names', async () => {
    const STUDY_PACKS = await loadStudyPacks();
    const pack = STUDY_PACKS[0];
    const mine = (kind: 'lavoro' | 'studio') => pack.dossiers.map((d): Pick<Dossier, 'title' | 'kind'> => ({ title: d.title, kind }));
    expect(packAlreadyAdded(pack, mine('studio'))).toBe(true);
    expect(packAlreadyAdded(pack, mine('lavoro'))).toBe(false);
    expect(packAlreadyAdded(pack, mine('studio').slice(1))).toBe(false);
  });
});
