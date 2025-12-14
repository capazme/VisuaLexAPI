import { Book, FileText, Globe, type LucideIcon } from 'lucide-react';

export interface ActType {
  label: string;
  value: string;
  group: string;
  icon: LucideIcon;
}

export const ACT_TYPES: ActType[] = [
  // Fonti Primarie
  { label: 'Costituzione', value: 'costituzione', group: 'Fonti Primarie', icon: FileText },
  { label: 'Legge', value: 'legge', group: 'Fonti Primarie', icon: FileText },
  { label: 'Decreto Legge', value: 'decreto legge', group: 'Fonti Primarie', icon: FileText },
  { label: 'Decreto Legislativo', value: 'decreto legislativo', group: 'Fonti Primarie', icon: FileText },
  { label: 'D.P.R.', value: 'decreto del presidente della repubblica', group: 'Fonti Primarie', icon: FileText },
  { label: 'Regio Decreto', value: 'regio decreto', group: 'Fonti Primarie', icon: FileText },

  // Codici Fondamentali
  { label: 'Codice Civile', value: 'codice civile', group: 'Codici Fondamentali', icon: Book },
  { label: 'Codice Penale', value: 'codice penale', group: 'Codici Fondamentali', icon: Book },
  { label: 'Codice Proc. Civile', value: 'codice di procedura civile', group: 'Codici Fondamentali', icon: Book },
  { label: 'Codice Proc. Penale', value: 'codice di procedura penale', group: 'Codici Fondamentali', icon: Book },
  { label: 'Preleggi', value: 'preleggi', group: 'Codici Fondamentali', icon: Book },
  { label: 'Disp. Att. Cod. Civile', value: 'disposizioni per l\'attuazione del Codice civile e disposizioni transitorie', group: 'Codici Fondamentali', icon: Book },
  { label: 'Disp. Att. Cod. Proc. Civile', value: 'disposizioni per l\'attuazione del Codice di procedura civile e disposizioni transitorie', group: 'Codici Fondamentali', icon: Book },

  // Codici Settoriali
  { label: 'Codice della Strada', value: 'codice della strada', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice della Navigazione', value: 'codice della navigazione', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice del Consumo', value: 'codice del consumo', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice della Privacy', value: 'codice in materia di protezione dei dati personali', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Ambiente', value: 'norme in materia ambientale', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Contratti Pubblici', value: 'codice dei contratti pubblici', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Beni Culturali', value: 'codice dei beni culturali e del paesaggio', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Assicurazioni', value: 'codice delle assicurazioni private', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Processo Tributario', value: 'codice del processo tributario', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Processo Amm.vo', value: 'codice del processo amministrativo', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Amm. Digitale', value: 'codice dell\'amministrazione digitale', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Proprietà Industriale', value: 'codice della proprietà industriale', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Comunicazioni', value: 'codice delle comunicazioni elettroniche', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Pari Opportunità', value: 'codice delle pari opportunità', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Ord. Militare', value: 'codice dell\'ordinamento militare', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice del Turismo', value: 'codice del turismo', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Antimafia', value: 'codice antimafia', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Giustizia Contabile', value: 'codice di giustizia contabile', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Terzo Settore', value: 'codice del Terzo settore', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Protezione Civile', value: 'codice della protezione civile', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Crisi Impresa', value: 'codice della crisi d\'impresa e dell\'insolvenza', group: 'Codici Settoriali', icon: Book },
  { label: 'Codice Nautica Diporto', value: 'codice della nautica da diporto', group: 'Codici Settoriali', icon: Book },

  // Unione Europea
  { label: 'TUE', value: 'TUE', group: 'Unione Europea', icon: Globe },
  { label: 'TFUE', value: 'TFUE', group: 'Unione Europea', icon: Globe },
  { label: 'CDFUE', value: 'CDFUE', group: 'Unione Europea', icon: Globe },
  { label: 'Regolamento UE', value: 'Regolamento UE', group: 'Unione Europea', icon: Globe },
  { label: 'Direttiva UE', value: 'Direttiva UE', group: 'Unione Europea', icon: Globe },
];

// Act types that require additional details (number and date)
export const ACT_TYPES_REQUIRING_DETAILS = [
  'legge', 'decreto legge', 'decreto legislativo',
  'decreto del presidente della repubblica', 'regio decreto',
  'Regolamento UE', 'Direttiva UE'
];

// Helper to get act types grouped by category
export const getActTypesByGroup = (): Record<string, ActType[]> => {
  return ACT_TYPES.reduce((acc, act) => {
    if (!acc[act.group]) acc[act.group] = [];
    acc[act.group].push(act);
    return acc;
  }, {} as Record<string, ActType[]>);
};

// Simple list for select dropdowns (without icons/groups)
export const ACT_TYPES_SIMPLE = ACT_TYPES.map(({ label, value }) => ({ label, value }));
