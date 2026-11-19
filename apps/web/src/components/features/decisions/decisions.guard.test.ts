import { guardCommonControls } from '../../../test/commonControlsGuard';

// LC117: Le sentenze speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112), the reader
// (LC113), the Forum (LC114) and Impostazioni (LC115).
guardCommonControls({
  name: 'Le sentenze',
  dir: 'components/features/decisions',
  expected: ['DecisionView.tsx', 'DecisionReadingToolbar.tsx', 'KeyPassagesMenu.tsx'],
  windows: ['DecisionPreviewDialog.tsx', 'KeyPassagesMenu.tsx'],
  localLooks: ['FIELD', 'ACTION', 'LINK', 'ICON_BUTTON', 'removeButton'],
});
