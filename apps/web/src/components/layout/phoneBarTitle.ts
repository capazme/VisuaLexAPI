/**
 * The name in the middle of the phone's bar (M1): the page's name as the menu writes it, so the bar says where the
 * reader is in the menu while the page's own title, under it, keeps its sentence. A page the list does not name takes
 * the section's name. The search page has no title: its bar is the search field.
 */
const PAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/studia\/ripasso(\/|$)/, 'Oggi'],
  [/^\/studia\/progressi(\/|$)/, 'Progressi'],
  [/^\/studia\/schede(\/|$)/, 'Le mie schede'],
  [/^\/studia\/valida(\/|$)/, 'Da validare'],
  [/^\/dossier(\/|$)/, 'Dossier'],
  [/^\/forum\/community(\/|$)/, 'Community'],
  [/^\/forum\/?$/, 'Dossier pubblici'],
  [/^\/history(\/|$)/, 'Cronologia'],
  [/^\/documents(\/|$)/, 'Analizza documento'],
  [/^\/collega-app(\/|$)/, 'Collega un’app AI'],
  [/^\/merlt\/?$/, 'Assistente'],
  [/^\/grafo(\/|$)/, 'Grafo'],
  [/^\/sentenze(\/|$)/, 'Sentenza'],
];

export function phoneBarTitle(pathname: string, sectionName: string): string {
  return PAGES.find(([pattern]) => pattern.test(pathname))?.[1] ?? sectionName;
}
