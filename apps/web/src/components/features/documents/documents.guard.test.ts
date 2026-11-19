import { guardCommonControls } from '../../../test/commonControlsGuard';

// LC117: Analizza documento speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112), the reader
// (LC113), the Forum (LC114) and Impostazioni (LC115).
guardCommonControls({
  name: 'Analizza documento',
  dir: 'components/features/documents',
  expected: ['DocumentReviewPage.tsx', 'CitationList.tsx', 'LinksPanel.tsx'],
  windows: ['CompletionPicker.tsx'],
  localLooks: ['FIELD', 'ACTION', 'LINK', 'ICON_BUTTON', 'MENU_TRIGGER'],
});
