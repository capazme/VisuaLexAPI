import { guardCommonControls } from '../../../test/commonControlsGuard';

// LC117: Rassegne speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112), the reader
// (LC113), the Forum (LC114) and Impostazioni (LC115).
guardCommonControls({
  name: 'Rassegne',
  dir: 'components/features/rassegne',
  expected: ['RassegnePanel.tsx', 'RassegnaResult.tsx', 'RassegneSearchPage.tsx'],
  localLooks: ['FIELD', 'ACTION', 'LINK', 'ICON_BUTTON'],
});
