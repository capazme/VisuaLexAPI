import { describe, expect, it } from 'vitest';
import { phoneBarTitle } from './phoneBarTitle';

describe('phoneBarTitle', () => {
  it.each([
    ['/work/scadenziario', 'Scadenziario'],
    ['/work/pseudonimizzatore', 'Pseudonimizzatore'],    ['/work/grafo-pratiche', 'Grafo delle pratiche'],
    ['/work/prossimi', 'Prossimi giorni'],
    ['/work/ingresso', "Lista d'ingresso"],
    ['/work/cestino', 'Cestino dei compiti'],
    ['/learn/ripasso', 'Oggi'],
    ['/learn/progressi', 'Progressi'],
    ['/learn/schede', 'Le mie schede'],
    ['/learn/schede/c1', 'Le mie schede'],
    ['/learn/valida', 'Da validare'],
    ['/dossier', 'Dossier'],
    ['/forum', 'Dossier pubblici'],
    ['/forum/community', 'Community'],
    ['/history', 'Cronologia'],
    ['/documents', 'Analizza documento'],
    ['/collega-app', 'Collega un’app AI'],
    ['/labs', 'Assistente'],
    ['/labs/grafo', 'Grafo'],
  ])('names %s as the menu does: %s', (path, title) => {
    expect(phoneBarTitle(path, 'Opus')).toBe(title);
  });

  it.each(['/labs/contribuisci', '/pagina-che-non-esiste', '/dossierx', '/work'])('falls back to the section on %s', (path) => {
    expect(phoneBarTitle(path, 'Academia')).toBe('Academia');
  });
});
