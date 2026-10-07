import type { WorkspaceTab } from '../../../store/useAppStore';
import { DecisionTabView } from '../decisions/DecisionTabView';

function assertNever(x: never): never {
  throw new Error(`unhandled tab view ${JSON.stringify(x)}`);
}

/**
 * What a tab with a `view` draws, on the desktop panel and on the phone. One switch for both: a new
 * kind of view fails to compile here until it is drawn on each surface.
 */
export function renderTabView(tab: WorkspaceTab, view: NonNullable<WorkspaceTab['view']>): React.ReactNode {
  switch (view.kind) {
    case 'decision':
      return <DecisionTabView key={tab.id} tabId={tab.id} reference={view.reference} />;
    case 'decision-search':
      return null; // drawn by the search tab (Task 17)
    default:
      return assertNever(view);
  }
}
