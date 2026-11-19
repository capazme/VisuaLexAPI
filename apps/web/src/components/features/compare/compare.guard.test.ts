import { guardCommonControls } from '../../../test/commonControlsGuard';

// LC117: Il confronto speaks the common components' language, as Pratiche (LC106), Opus (LC110), Learn (LC112), the reader
// (LC113), the Forum (LC114) and Impostazioni (LC115).
guardCommonControls({
  name: 'Il confronto',
  dir: 'components/features/compare',
  expected: ['CompareBody.tsx', 'ArticleHeader.tsx'],
  windows: ['CompareView.tsx'],
  localLooks: ['FIELD', 'ACTION', 'LINK', 'ICON_BUTTON'],
});
