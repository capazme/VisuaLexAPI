import { createContext } from 'react';

/** The dossier on the page, for what its entries' readers ask of the server by dossier and entry (D7b's proposals). */
export const CurrentDossierContext = createContext<string | null>(null);
