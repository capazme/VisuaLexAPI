import { describe, expect, it } from 'vitest';
import { phoneBarTitle } from './phoneBarTitle';

describe('phoneBarTitle', () => {
  it.each([
    ['/studia/ripasso', 'Oggi'],
    ['/studia/progressi', 'Progressi'],
    ['/studia/schede', 'Le mie schede'],
    ['/studia/schede/c1', 'Le mie schede'],
    ['/studia/valida', 'Da validare'],
    ['/dossier', 'Dossier'],
    ['/forum', 'Dossier pubblici'],
    ['/forum/community', 'Community'],
    ['/history', 'Cronologia'],
    ['/documents', 'Analizza documento'],
    ['/collega-app', 'Collega un’app AI'],
    ['/merlt', 'Assistente'],
    ['/grafo', 'Grafo'],
    ['/sentenze/cassazione/1/2024', 'Sentenza'],
  ])('names %s as the menu does: %s', (path, title) => {
    expect(phoneBarTitle(path, 'Opus')).toBe(title);
  });

  it.each(['/merlt/contribuisci', '/pagina-che-non-esiste', '/dossierx'])('falls back to the section on %s', (path) => {
    expect(phoneBarTitle(path, 'Academia')).toBe('Academia');
  });
});
