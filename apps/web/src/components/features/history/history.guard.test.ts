import { guardCommonControls } from '../../../test/commonControlsGuard';

// LC117: Cronologia speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112), the reader
// (LC113), the Forum (LC114) and Impostazioni (LC115).
guardCommonControls({
  name: 'Cronologia',
  dir: 'components/features/history',
  expected: ['HistoryView.tsx', 'DecisionHistoryRow.tsx', 'NormaChangesSection.tsx'],
  windows: ['HistoryView.tsx'],
  // A page: the clearing's question and «Crea nuova pratica» are its windows.
  callsAWindow: ['HistoryView.tsx'],
  localLooks: ['FIELD', 'ACTION', 'LINK', 'ICON_BUTTON'],
});
