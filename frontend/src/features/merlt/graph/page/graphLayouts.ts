import type { GraphLayoutName } from '../shared/CytoscapeView';

/** Layouts offered in the explorer (subset of CytoscapeView's supported set). */
export const LAYOUT_OPTIONS: Array<{ value: GraphLayoutName; label: string }> = [
  { value: 'cose-bilkent', label: 'Forza' },
  { value: 'dagre', label: 'Gerarchico' },
  { value: 'breadthfirst', label: 'Ad albero' },
];
