/**
 * Ambient declarations for cytoscape packages that ship no TypeScript types:
 * react-cytoscapejs and the two layout extensions. Kept narrow on purpose —
 * only the surface the shared graph layer actually uses.
 */
declare module 'react-cytoscapejs' {
  import type { Component, CSSProperties } from 'react';
  import type { ElementDefinition, StylesheetJsonBlock, LayoutOptions, Core } from 'cytoscape';

  export interface CytoscapeComponentProps {
    elements: ElementDefinition[];
    stylesheet?: StylesheetJsonBlock[];
    layout?: LayoutOptions;
    style?: CSSProperties;
    className?: string;
    cy?: (cy: Core) => void;
    minZoom?: number;
    maxZoom?: number;
    wheelSensitivity?: number;
    userZoomingEnabled?: boolean;
    userPanningEnabled?: boolean;
  }

  export default class CytoscapeComponent extends Component<CytoscapeComponentProps> {
    static normalizeElements(
      data: { nodes: unknown[]; edges: unknown[] } | unknown[]
    ): ElementDefinition[];
  }
}

declare module 'cytoscape-cose-bilkent' {
  import type { Ext } from 'cytoscape';
  const ext: Ext;
  export default ext;
}

declare module 'cytoscape-dagre' {
  import type { Ext } from 'cytoscape';
  const ext: Ext;
  export default ext;
}
