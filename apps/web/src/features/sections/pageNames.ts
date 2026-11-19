/**
 * The pages' names, the one list (L-37): each page's title (`PageFrame`'s `title`, under its section's phrase) and the
 * name in the middle of the phone's bar (`layout/phoneBarTitle.ts`) — the name the menu writes. Gymnasium's views
 * (`StudiaPage`), Opus's (`OpusPage`), the dossier list, the Forum's two pages and Academia's two read their titles
 * from here. The search page has none: its bar is the search field.
 */
export const DOSSIER_PAGE = 'Pratiche';
/** The Forum's two pages (S7a reads them for their titles). */
export const PUBLIC_DOSSIERS_PAGE = 'Dossier pubblici';
export const COMMUNITY_PAGE = 'Community';
/** Academia's two pages (S7b). */
export const ASSISTANT_PAGE = 'Assistente';
export const GRAPH_PAGE = 'Grafo';

const PAGES: ReadonlyArray<readonly [RegExp, string]> = [
  // Work's planner and Learn's (LC130), the same views.
  [/^\/(work|learn\/attivita)\/scadenziario(\/|$)/, 'Scadenziario'],
  [/^\/(work|learn\/attivita)\/prossimi(\/|$)/, 'Prossimi giorni'],
  [/^\/(work|learn\/attivita)\/ingresso(\/|$)/, "Lista d'ingresso"],
  [/^\/(work|learn\/attivita)\/cestino(\/|$)/, 'Cestino dei compiti'],
  [/^\/work\/pseudonimizzatore(\/|$)/, 'Pseudonimizzatore'],
  [/^\/work\/grafo-pratiche(\/|$)/, 'Grafo delle pratiche'],
  [/^\/learn\/ripasso(\/|$)/, 'Oggi'],
  [/^\/learn\/lezione(\/|$)/, 'Lezione breve'],
  [/^\/learn\/percorsi(\/|$)/, 'Percorsi'],
  [/^\/learn\/progressi(\/|$)/, 'Progressi'],
  [/^\/learn\/schede(\/|$)/, 'Le mie schede'],
  [/^\/learn\/valida(\/|$)/, 'Da validare'],
  [/^\/pratiche(\/|$)/, DOSSIER_PAGE],
  [/^\/forum\/community(\/|$)/, COMMUNITY_PAGE],
  [/^\/forum\/?$/, PUBLIC_DOSSIERS_PAGE],
  [/^\/history(\/|$)/, 'Cronologia'],
  [/^\/documents(\/|$)/, 'Analizza documento'],
  [/^\/rassegne(\/|$)/, 'Rassegne'],
  [/^\/collega-app(\/|$)/, 'Collega un’app AI'],
  [/^\/impostazioni(\/|$)/, 'Impostazioni'],
  [/^\/admin(\/|$)/, 'Amministrazione'],
  [/^\/labs\/?$/, ASSISTANT_PAGE],
  [/^\/labs\/grafo(\/|$)/, GRAPH_PAGE],
];

/** The page's name for an address, or undefined for a page the list does not name. */
export function pageName(pathname: string): string | undefined {
  return PAGES.find(([pattern]) => pattern.test(pathname))?.[1];
}
