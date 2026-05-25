import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, EventObject } from 'cytoscape';
import CytoscapeComponent from 'react-cytoscapejs';
import coseBilkent from 'cytoscape-cose-bilkent';
import dagre from 'cytoscape-dagre';
import { buildGraphStylesheet } from './graphStyles';

/**
 * Shared Cytoscape wrapper for both the article side rail and the /grafo page.
 *
 * Intentionally a default export so consumers can code-split it via
 * `React.lazy(() => import('.../CytoscapeView'))` — cytoscape + the layout
 * extensions are ~290KB gzipped and must not land in the main bundle.
 *
 * Double-click is detected manually (cytoscape has no native dblclick): two
 * taps on the same node within 300ms. Single taps always fire onNodeClick.
 */

// Register layout extensions once per module load (idempotent).
let extensionsRegistered = false;
function registerExtensions(): void {
  if (extensionsRegistered) return;
  cytoscape.use(coseBilkent);
  cytoscape.use(dagre);
  extensionsRegistered = true;
}
registerExtensions();

export type GraphLayoutName =
  | 'cose-bilkent'
  | 'dagre'
  | 'breadthfirst'
  | 'concentric'
  | 'circle';

export interface CytoscapeViewProps {
  nodes: ElementDefinition[];
  edges: ElementDefinition[];
  layout?: GraphLayoutName;
  height?: number | string;
  onNodeClick?: (nodeId: string) => void;
  onNodeDblClick?: (nodeId: string) => void;
}

function buildLayoutOptions(name: GraphLayoutName): LayoutOptions {
  switch (name) {
    case 'dagre':
      return { name: 'dagre', rankDir: 'TB', nodeSep: 30, rankSep: 60 } as unknown as LayoutOptions;
    case 'breadthfirst':
      return { name: 'breadthfirst', directed: true, spacingFactor: 1.1, padding: 20 };
    case 'concentric':
      return { name: 'concentric', minNodeSpacing: 30, padding: 20 };
    case 'circle':
      return { name: 'circle', padding: 20 };
    case 'cose-bilkent':
    default:
      return {
        name: 'cose-bilkent',
        nodeRepulsion: 4500,
        idealEdgeLength: 80,
        animate: false,
        fit: true,
        padding: 20,
      } as unknown as LayoutOptions;
  }
}

const DOUBLE_TAP_MS = 300;

export default function CytoscapeView({
  nodes,
  edges,
  layout = 'cose-bilkent',
  height = 300,
  onNodeClick,
  onNodeDblClick,
}: CytoscapeViewProps): React.ReactElement {
  // Keep handlers in refs so the once-attached cytoscape listener never goes stale.
  const clickRef = useRef(onNodeClick);
  const dblClickRef = useRef(onNodeDblClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
    dblClickRef.current = onNodeDblClick;
  }, [onNodeClick, onNodeDblClick]);

  // Double-tap detection state in refs so it survives across renders (react-
  // cytoscapejs calls `cy` once, but refs make this robust regardless).
  const lastTapTsRef = useRef(0);
  const lastTapIdRef = useRef('');

  const handleCy = (cy: Core): void => {
    // Scope removal to node taps — leave any other internal listeners intact.
    cy.removeListener('tap', 'node');
    cy.on('tap', 'node', (evt: EventObject) => {
      const id = evt.target.id();
      const now = Date.now();
      if (dblClickRef.current && id === lastTapIdRef.current && now - lastTapTsRef.current < DOUBLE_TAP_MS) {
        lastTapTsRef.current = 0;
        lastTapIdRef.current = '';
        dblClickRef.current(id);
        return;
      }
      lastTapTsRef.current = now;
      lastTapIdRef.current = id;
      clickRef.current?.(id);
    });
  };

  return (
    <CytoscapeComponent
      elements={[...nodes, ...edges]}
      stylesheet={buildGraphStylesheet()}
      layout={buildLayoutOptions(layout)}
      style={{ width: '100%', height }}
      cy={handleCy}
      minZoom={0.2}
      maxZoom={3}
      wheelSensitivity={0.2}
    />
  );
}
