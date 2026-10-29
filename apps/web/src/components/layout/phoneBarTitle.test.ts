import { describe, expect, it } from 'vitest';
import { phoneBarTitle } from './phoneBarTitle';

describe('phoneBarTitle', () => {
  it.each([
    ['/opus/oggi', 'Oggi'],
    ['/opus/prossimi', 'Prossimi giorni'],
    ['/opus/ingresso', "Lista d'ingresso"],
    ['/opus/cestino', 'Cestino dei compiti'],
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
  ])('names %s as the menu does: %s', (path, title) => {
    expect(phoneBarTitle(path, 'Opus')).toBe(title);
  });

  it.each(['/merlt/contribuisci', '/pagina-che-non-esiste', '/dossierx', '/opus'])('falls back to the section on %s', (path) => {
    expect(phoneBarTitle(path, 'Academia')).toBe('Academia');
  });
});
