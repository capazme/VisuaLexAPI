/**
 * The pages' names, the one list (L-37): each page's title (`PageFrame`'s `title`, under its section's phrase) and the
 * name in the middle of the phone's bar (`layout/phoneBarTitle.ts`) — the name the menu writes. Gymnasium's views
 * (`StudiaPage`), Opus's (`OpusPage`) and the dossier list read their titles from here. The search page has none: its
 * bar is the search field.
 */
export const DOSSIER_PAGE = 'Dossier';

const PAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/opus\/oggi(\/|$)/, 'Oggi'],
  [/^\/opus\/prossimi(\/|$)/, 'Prossimi giorni'],
  [/^\/opus\/ingresso(\/|$)/, "Lista d'ingresso"],
  [/^\/opus\/cestino(\/|$)/, 'Cestino dei compiti'],
  [/^\/studia\/ripasso(\/|$)/, 'Oggi'],
  [/^\/studia\/progressi(\/|$)/, 'Progressi'],
  [/^\/studia\/schede(\/|$)/, 'Le mie schede'],
  [/^\/studia\/valida(\/|$)/, 'Da validare'],
  [/^\/dossier(\/|$)/, DOSSIER_PAGE],
  [/^\/forum\/community(\/|$)/, 'Community'],
  [/^\/forum\/?$/, 'Dossier pubblici'],
  [/^\/history(\/|$)/, 'Cronologia'],
  [/^\/documents(\/|$)/, 'Analizza documento'],
  [/^\/collega-app(\/|$)/, 'Collega un’app AI'],
  [/^\/merlt\/?$/, 'Assistente'],
  [/^\/grafo(\/|$)/, 'Grafo'],
];

/** The page's name for an address, or undefined for a page the list does not name. */
export function pageName(pathname: string): string | undefined {
  return PAGES.find(([pattern]) => pattern.test(pathname))?.[1];
}
