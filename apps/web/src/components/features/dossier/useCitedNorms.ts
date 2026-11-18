import { createContext } from 'react';
import type { CitedNorms } from '../decisions/DecisionReadingSurface';

/** How the dossier's decisions open the norms they cite (D7d); outside the dossier there is none. */
export const CitedNormsContext = createContext<CitedNorms | null>(null);
